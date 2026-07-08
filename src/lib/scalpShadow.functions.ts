import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

// Scalp Shadow — records simulated scalp trades on 15m Kalshi BTC markets.
// READ-ONLY / OBSERVER: never influences live auto-trade or auto-odds paths.
//
// Setups:
//   cliff        YES <= 12 or >= 88, |spot-strike| <= $250, ttc > 240s
//   compression  |spot-strike| <= $100, 60 <= ttc <= 300, |Δyes over 60s| >= 15
//
// Exits (per tick):
//   mean_revert   |mark - fair(spot)| <= 5c
//   strike_cross  our side already-in-the-money crossed (mark >= 70)
//   time_stop     ttc <= 60
//   settled       ttc <= 0 -> resolve on last spot vs strike

const InputSchema = z.object({ ticker: z.string().min(1).max(64) });

// Rough fair-value from spot vs strike + time. Not a model — just a sanity
// mean-revert target. Distance in $, time in seconds.
function fairYesCents(spot: number, strike: number, ttc: number): number {
  const dist = spot - strike; // + = spot above strike -> YES fairer
  // scale window: near close, small distance dominates; further out, wider.
  const scale = Math.max(15, Math.min(120, ttc * 0.2 + 15));
  const p = 1 / (1 + Math.exp(-dist / scale));
  return Math.round(p * 100);
}

export const evaluateScalpShadow = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => InputSchema.parse(input))
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    const { ticker } = data;

    // Pull the last ~2 minutes of tape for this ticker.
    const { data: tape, error: tapeErr } = await supabase
      .from("btc_odds_tape")
      .select("ticker,strike,spot,yes_cents,no_cents,seconds_to_close,snapped_at")
      .eq("ticker", ticker)
      .order("snapped_at", { ascending: false })
      .limit(40);
    if (tapeErr || !tape || tape.length === 0) {
      return { ok: true as const, note: "no-tape" };
    }

    const latest = tape[0];
    const strike = Number(latest.strike);
    const spot = Number(latest.spot);
    const yes = latest.yes_cents;
    const ttc = latest.seconds_to_close;
    const dist = spot - strike;
    const absDist = Math.abs(dist);

    // Δyes over ~60s (find sample closest to 60s older than latest).
    const latestTs = new Date(latest.snapped_at).getTime();
    let sixtyAgo = tape[tape.length - 1];
    for (const row of tape) {
      const age = (latestTs - new Date(row.snapped_at).getTime()) / 1000;
      if (age >= 55 && age <= 75) {
        sixtyAgo = row;
        break;
      }
    }
    const dYes = yes - sixtyAgo.yes_cents;

    // 1) Manage open positions.
    const { data: openRows } = await supabase
      .from("auto_odds_scalp_shadow")
      .select("*")
      .eq("ticker", ticker)
      .is("exited_at", null);

    const nowIso = new Date().toISOString();
    const fair = fairYesCents(spot, strike, ttc);
    // Mark for each side = last quote on that side.
    const yesMark = yes;
    const noMark = latest.no_cents;

    let opened = 0;
    let closed = 0;

    for (const pos of openRows ?? []) {
      const side = pos.entry_side as "YES" | "NO";
      const mark = side === "YES" ? yesMark : noMark;
      const sideFair = side === "YES" ? fair : 100 - fair;

      // Settled?
      if (ttc <= 0) {
        const settledYes = spot >= strike;
        const finalMark = side === "YES" ? (settledYes ? 100 : 0) : settledYes ? 0 : 100;
        await supabase
          .from("auto_odds_scalp_shadow")
          .update({
            exit_cents: finalMark,
            exit_reason: "settled",
            exit_spot: spot,
            exited_at: nowIso,
            pnl_cents: finalMark - pos.entry_cents,
            settled_yes: settledYes,
          })
          .eq("id", pos.id);
        closed++;
        continue;
      }

      // Strike cross in our favor: our mark rallied >= 70
      if (mark >= 70) {
        await supabase
          .from("auto_odds_scalp_shadow")
          .update({
            exit_cents: mark,
            exit_reason: "strike_cross",
            exit_spot: spot,
            exited_at: nowIso,
            pnl_cents: mark - pos.entry_cents,
          })
          .eq("id", pos.id);
        closed++;
        continue;
      }

      // Mean revert: our mark within 5c of fair for our side, and profit >= 6
      if (Math.abs(mark - sideFair) <= 5 && mark - pos.entry_cents >= 6) {
        await supabase
          .from("auto_odds_scalp_shadow")
          .update({
            exit_cents: mark,
            exit_reason: "mean_revert",
            exit_spot: spot,
            exited_at: nowIso,
            pnl_cents: mark - pos.entry_cents,
          })
          .eq("id", pos.id);
        closed++;
        continue;
      }

      // Time stop
      if (ttc <= 60) {
        await supabase
          .from("auto_odds_scalp_shadow")
          .update({
            exit_cents: mark,
            exit_reason: "time_stop",
            exit_spot: spot,
            exited_at: nowIso,
            pnl_cents: mark - pos.entry_cents,
          })
          .eq("id", pos.id);
        closed++;
      }
    }

    // 2) Detect new entries — only if no open row of that setup for this ticker.
    const openBySetup = new Set(
      (openRows ?? []).filter((r) => !r.exited_at).map((r) => r.setup_kind),
    );

    async function tryOpen(kind: "cliff" | "compression", side: "YES" | "NO", cents: number) {
      if (openBySetup.has(kind)) return;
      // Also skip if we already opened+closed a row for this exact ticker+kind
      // in the last 3 minutes (avoid churn).
      const threeMinAgo = new Date(Date.now() - 3 * 60_000).toISOString();
      const { data: recent } = await supabase
        .from("auto_odds_scalp_shadow")
        .select("id")
        .eq("ticker", ticker)
        .eq("setup_kind", kind)
        .gte("entered_at", threeMinAgo)
        .limit(1);
      if (recent && recent.length > 0) return;

      await supabase.from("auto_odds_scalp_shadow").insert({
        user_id: userId,
        ticker,
        strike,
        setup_kind: kind,
        entry_side: side,
        entry_cents: cents,
        entry_spot: spot,
        entry_dist_to_strike: dist,
        seconds_to_close_at_entry: ttc,
      });
      opened++;
    }

    // Cliff
    if (absDist <= 250 && ttc > 240) {
      if (yes <= 12) await tryOpen("cliff", "YES", yes);
      else if (yes >= 88) await tryOpen("cliff", "NO", latest.no_cents);
    }

    // Compression: fade the extreme against 60s mean
    if (absDist <= 100 && ttc >= 60 && ttc <= 300 && Math.abs(dYes) >= 15) {
      // If YES spiked up hard, buy NO (fade); if YES dropped hard, buy YES.
      if (dYes >= 15) await tryOpen("compression", "NO", latest.no_cents);
      else if (dYes <= -15) await tryOpen("compression", "YES", yes);
    }

    return { ok: true as const, opened, closed };
  });

const ReportSchema = z.object({ limit: z.number().int().min(1).max(200).optional() });

export const getScalpShadowReport = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => ReportSchema.parse(input ?? {}))
  .handler(async ({ data, context }) => {
    const limit = data.limit ?? 30;
    const { supabase } = context;

    const [openRes, closedRes] = await Promise.all([
      supabase
        .from("auto_odds_scalp_shadow")
        .select("*")
        .is("exited_at", null)
        .order("entered_at", { ascending: false })
        .limit(20),
      supabase
        .from("auto_odds_scalp_shadow")
        .select("*")
        .not("exited_at", "is", null)
        .order("exited_at", { ascending: false })
        .limit(limit),
    ]);

    const closed = closedRes.data ?? [];
    const summarize = (rows: typeof closed, kind: "cliff" | "compression") => {
      const r = rows.filter((x) => x.setup_kind === kind);
      const n = r.length;
      if (n === 0) return { kind, n: 0, wins: 0, hitRate: 0, avgPnl: 0, totalPnl: 0 };
      const wins = r.filter((x) => (x.pnl_cents ?? 0) > 0).length;
      const totalPnl = r.reduce((s, x) => s + (x.pnl_cents ?? 0), 0);
      return {
        kind,
        n,
        wins,
        hitRate: Math.round((wins / n) * 100),
        avgPnl: Math.round(totalPnl / n),
        totalPnl,
      };
    };

    return {
      open: openRes.data ?? [],
      closed,
      summary: {
        cliff: summarize(closed, "cliff"),
        compression: summarize(closed, "compression"),
      },
    };
  });
