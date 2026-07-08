import { createFileRoute } from "@tanstack/react-router";
import { evaluateAtm, atmByTicker, type Row } from "@/lib/oddsShadowCore";

// Public cron endpoint — pg_cron hits this so the shadow trader keeps
// running when no browser tab is open. Uses service-role admin client.
// Guard: requires apikey header matching the Supabase anon key (attached
// by pg_cron); Lovable Cloud published /api/public/* also bypasses auth.

const BASE_STAKE_USD = 100;
const UNLOCK_PROFIT = 50;
const PROFIT_STAKE_PCT = 0.40;
const MAX_STAKE_USD = 500;
const UNLOCK_WINDOW = 3;

export const Route = createFileRoute("/api/public/hooks/odds-shadow-tick")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const apikey = request.headers.get("apikey");
        const expected = process.env.SUPABASE_PUBLISHABLE_KEY;
        if (!apikey || !expected || apikey !== expected) {
          return new Response(JSON.stringify({ error: "unauthorized" }), { status: 401 });
        }

        const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

        // Find users with recent tape activity (last 20 min).
        const cutoff = new Date(Date.now() - 20 * 60_000).toISOString();
        const { data: userRows, error: uErr } = await supabaseAdmin
          .from("btc_odds_tape")
          .select("user_id")
          .gte("snapped_at", cutoff);
        if (uErr) return new Response(JSON.stringify({ error: uErr.message }), { status: 500 });
        const userIds = Array.from(new Set((userRows ?? []).map(r => r.user_id).filter(Boolean)));

        let firedTotal = 0, settledTotal = 0, earlyExitsTotal = 0, skippedTotal = 0;

        for (const userId of userIds) {
          const { data: tape } = await supabaseAdmin
            .from("btc_odds_tape")
            .select("ticker, strike, spot, yes_cents, no_cents, seconds_to_close, snapped_at")
            .eq("user_id", userId)
            .gte("snapped_at", new Date(Date.now() - 15 * 60_000).toISOString())
            .order("snapped_at", { ascending: true });
          const groups = atmByTicker((tape as Row[] | null) ?? []);

          const { data: calRows } = await supabaseAdmin
            .from("auto_odds_calibration")
            .select("*")
            .eq("user_id", userId);
          const cal: Record<string, { min_cents: number; max_cents: number; min_velocity: number }> = {
            leader_chase: { min_cents: 60, max_cents: 90, min_velocity: 0 },
            flip_fade: { min_cents: 55, max_cents: 90, min_velocity: 2 },
          };
          for (const c of calRows ?? []) {
            cal[c.trigger as string] = {
              min_cents: Number(c.min_cents),
              max_cents: Number(c.max_cents),
              min_velocity: Number(c.min_velocity),
            };
          }

          const { data: fired } = await supabaseAdmin
            .from("auto_trade_odds_shadow")
            .select("ticker")
            .eq("user_id", userId);
          const firedSet = new Set((fired ?? []).map(r => r.ticker));

          // Dynamic stake: base $100, or 40% of profit bank once unlocked.
          const { data: allSettled } = await supabaseAdmin
            .from("auto_trade_odds_shadow")
            .select("pnl_usd")
            .eq("user_id", userId)
            .eq("settled", true)
            .order("settled_at", { ascending: false })
            .limit(1000);
          const bank = (allSettled ?? []).reduce((s, r) => s + Number(r.pnl_usd ?? 0), 0);
          const { data: recent } = await supabaseAdmin
            .from("auto_trade_odds_shadow")
            .select("pnl_usd")
            .eq("user_id", userId)
            .eq("settled", true)
            .order("settled_at", { ascending: false })
            .limit(UNLOCK_WINDOW);
          const recentPnl = (recent ?? []).reduce((s, r) => s + Number(r.pnl_usd ?? 0), 0);
          const unlocked = bank >= UNLOCK_PROFIT && recentPnl >= UNLOCK_PROFIT && (recent?.length ?? 0) >= UNLOCK_WINDOW;
          const dynStake = unlocked
            ? Math.min(Math.max(bank * PROFIT_STAKE_PCT, BASE_STAKE_USD), MAX_STAKE_USD)
            : BASE_STAKE_USD;

          const skipRows: Array<Record<string, unknown>> = [];
          for (const [tk, atm] of groups) {
            if (firedSet.has(tk)) continue;
            const res = evaluateAtm(atm, cal);
            if (res.decision) {
              const d = res.decision;
              const limitCents = d.side === "YES" ? d.yes_cents : d.no_cents;
              if (limitCents < 1 || limitCents > 99) continue;
              const contracts = Math.floor((dynStake * 100) / limitCents);
              if (contracts < 1) continue;
              const stake = (contracts * limitCents) / 100;
              const { error } = await supabaseAdmin.from("auto_trade_odds_shadow").insert({
                user_id: userId,
                ticker: d.ticker,
                strike: d.strike,
                side: d.side,
                trigger: d.trigger,
                seconds_to_close_at_fire: d.seconds_to_close,
                yes_cents_at_fire: d.yes_cents,
                no_cents_at_fire: d.no_cents,
                limit_cents: limitCents,
                contracts,
                stake_usd: stake,
                flip_count_at_fire: d.flip_count,
                spot_at_fire: d.spot,
                entry_velocity_cents: d.velocity,
              });
              if (!error) firedTotal++;
            } else if (res.skip) {
              skipRows.push({
                user_id: userId, ticker: tk,
                reason: res.skip.reason,
                trigger_candidate: res.skip.trigger_candidate ?? null,
                yes_cents: res.skip.yes_cents ?? null,
                no_cents: res.skip.no_cents ?? null,
                seconds_to_close: res.skip.seconds_to_close ?? null,
                flip_count: res.skip.flip_count ?? null,
                detail: res.skip.detail ?? null,
              });
            }
          }
          skippedTotal += skipRows.length;
          if (skipRows.length) {
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            await supabaseAdmin.from("auto_trade_odds_skip_log").insert(skipRows.slice(0, 10) as any);
          }

          // Settlement + adverse-flip early exit.
          const { data: open } = await supabaseAdmin
            .from("auto_trade_odds_shadow")
            .select("id, ticker, side, contracts, limit_cents, fired_at")
            .eq("user_id", userId)
            .eq("settled", false);
          for (const row of open ?? []) {
            const atm = groups.get(row.ticker as string);
            if (!atm || atm.length === 0) continue;
            const last = atm[atm.length - 1];
            if (last.seconds_to_close <= 0) {
              const yesWon = last.yes_cents >= 50;
              const sideWon = row.side === "YES" ? yesWon : !yesWon;
              const contracts = Number(row.contracts);
              const limit = Number(row.limit_cents);
              const pnl = sideWon
                ? (contracts * (100 - limit)) / 100
                : -(contracts * limit) / 100;
              const { error } = await supabaseAdmin
                .from("auto_trade_odds_shadow")
                .update({
                  settled: true, won: sideWon, pnl_usd: pnl,
                  final_yes_cents: last.yes_cents,
                  settled_at: new Date().toISOString(),
                })
                .eq("id", row.id);
              if (!error) settledTotal++;
              continue;
            }
            if (atm.length >= 2 && last.seconds_to_close > 60) {
              const ourCents = (r: Row) => (row.side === "YES" ? r.yes_cents : r.no_cents);
              const c1 = ourCents(atm[atm.length - 1]);
              const c2 = ourCents(atm[atm.length - 2]);
              const firedAtMs = row.fired_at ? new Date(String(row.fired_at)).getTime() : 0;
              const s2 = new Date(atm[atm.length - 2].snapped_at).getTime();
              if (firedAtMs < s2 && c1 <= 42 && c2 <= 42) {
                const contracts = Number(row.contracts);
                const limit = Number(row.limit_cents);
                const pnl = (contracts * (c1 - limit)) / 100;
                const { error } = await supabaseAdmin
                  .from("auto_trade_odds_shadow")
                  .update({
                    settled: true, won: pnl > 0, pnl_usd: pnl,
                    final_yes_cents: last.yes_cents,
                    settled_at: new Date().toISOString(),
                    early_exited: true, exit_cents: c1,
                    exit_reason: "adverse_flip",
                    exited_at: new Date().toISOString(),
                  })
                  .eq("id", row.id);
                if (!error) earlyExitsTotal++;
              }
            }
          }
        }

        return new Response(JSON.stringify({
          ok: true, users: userIds.length,
          fired: firedTotal, settled: settledTotal,
          earlyExits: earlyExitsTotal, skipped: skippedTotal,
        }), { headers: { "Content-Type": "application/json" } });
      },
    },
  },
});
