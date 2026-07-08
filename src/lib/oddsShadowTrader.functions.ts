import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { evaluateAtm, atmByTicker, type Row } from "./oddsShadowCore";

// Odds-Flip Shadow Trader v2 — SHADOW-ONLY.
// Adds: velocity, spread proxy, multi-tick stability, flip cooldown,
// early-exit on adverse flip, live calibration, skip-reason log.

const STAKE_USD = 50;

export const runOddsShadowTick = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { supabase, userId } = context;

    // 1. Tape.
    const cutoff = new Date(Date.now() - 15 * 60_000).toISOString();
    const { data: tape, error: tapeErr } = await supabase
      .from("btc_odds_tape")
      .select("ticker, strike, spot, yes_cents, no_cents, seconds_to_close, snapped_at")
      .gte("snapped_at", cutoff)
      .order("snapped_at", { ascending: true });
    if (tapeErr) return { ok: false as const, error: tapeErr.message };

    const groups = atmByTicker((tape as Row[] | null) ?? []);

    // 2. Calibration.
    const { data: calRows } = await supabase
      .from("auto_odds_calibration")
      .select("*")
      .eq("user_id", userId);
    const cal: Record<string, { min_cents: number; max_cents: number; min_velocity: number }> = {
      leader_chase: { min_cents: 60, max_cents: 90, min_velocity: 0 },
      flip_fade: { min_cents: 55, max_cents: 90, min_velocity: 2 },
    };
    for (const c of calRows ?? []) {
      cal[c.trigger] = {
        min_cents: Number(c.min_cents),
        max_cents: Number(c.max_cents),
        min_velocity: Number(c.min_velocity),
      };
    }

    // 3. Fired tickers to skip.
    const { data: fired } = await supabase
      .from("auto_trade_odds_shadow")
      .select("ticker")
      .eq("user_id", userId);
    const firedSet = new Set((fired ?? []).map(r => r.ticker));

    // 4. Evaluate.
    let inserted = 0;
    const skipRows: {
      user_id: string; ticker: string; reason: string;
      trigger_candidate: string | null;
      yes_cents: number | null; no_cents: number | null;
      seconds_to_close: number | null; flip_count: number | null;
      detail: Record<string, unknown> | null;
    }[] = [];

    for (const [tk, atm] of groups) {
      if (firedSet.has(tk)) continue;
      const res = evaluateAtm(atm, cal);
      if (res.decision) {
        const d = res.decision;
        const limitCents = d.side === "YES" ? d.yes_cents : d.no_cents;
        if (limitCents < 1 || limitCents > 99) continue;
        const contracts = Math.floor((STAKE_USD * 100) / limitCents);
        if (contracts < 1) continue;
        const stake = (contracts * limitCents) / 100;
        const { error } = await supabase.from("auto_trade_odds_shadow").insert({
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
        if (!error) inserted++;
      } else if (res.skip) {
        skipRows.push({
          user_id: userId,
          ticker: tk,
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
    if (skipRows.length) {
      // Cap to prevent bloat.
      await supabase.from("auto_trade_odds_skip_log").insert(skipRows.slice(0, 20));
    }

    // 5. Settlement + early exit for open positions.
    const { data: open } = await supabase
      .from("auto_trade_odds_shadow")
      .select("id, ticker, side, contracts, limit_cents, fired_at")
      .eq("user_id", userId)
      .eq("settled", false);
    let settledCount = 0;
    let earlyExits = 0;
    for (const row of open ?? []) {
      const atm = groups.get(row.ticker as string);
      if (!atm || atm.length === 0) continue;
      const last = atm[atm.length - 1];

      // Settle if window closed.
      if (last.seconds_to_close <= 0) {
        const yesWon = last.yes_cents >= 50;
        const sideWon = row.side === "YES" ? yesWon : !yesWon;
        const contracts = Number(row.contracts);
        const limit = Number(row.limit_cents);
        const pnl = sideWon
          ? (contracts * (100 - limit)) / 100
          : -(contracts * limit) / 100;
        const { error: upErr } = await supabase
          .from("auto_trade_odds_shadow")
          .update({
            settled: true,
            won: sideWon,
            pnl_usd: pnl,
            final_yes_cents: last.yes_cents,
            settled_at: new Date().toISOString(),
          })
          .eq("id", row.id);
        if (!upErr) settledCount++;
        continue;
      }

      // Early-exit rule (#10): our side is losing leadership by ≥8¢
      // for at least 2 consecutive snaps, and we still have >60s to close.
      if (atm.length >= 2 && last.seconds_to_close > 60) {
        const ourCents = (r: Row) => (row.side === "YES" ? r.yes_cents : r.no_cents);
        const c1 = ourCents(atm[atm.length - 1]);
        const c2 = ourCents(atm[atm.length - 2]);
        // Only exit if trade already existed before both snaps.
        const firedAtMs = row.fired_at ? new Date(String(row.fired_at)).getTime() : 0;
        const s1 = new Date(atm[atm.length - 1].snapped_at).getTime();
        const s2 = new Date(atm[atm.length - 2].snapped_at).getTime();
        if (firedAtMs < s2 && c1 <= 42 && c2 <= 42) {
          // Realize at current cents.
          const contracts = Number(row.contracts);
          const limit = Number(row.limit_cents);
          const pnl = (contracts * (c1 - limit)) / 100;
          const { error: exErr } = await supabase
            .from("auto_trade_odds_shadow")
            .update({
              settled: true,
              won: pnl > 0,
              pnl_usd: pnl,
              final_yes_cents: last.yes_cents,
              settled_at: new Date().toISOString(),
              early_exited: true,
              exit_cents: c1,
              exit_reason: "adverse_flip",
              exited_at: new Date().toISOString(),
            })
            .eq("id", row.id);
          if (!exErr) earlyExits++;
        }
      }
    }

    // 6. Live calibration (#13). Once per tick, if any trigger has ≥20 settled trades,
    // tune min_cents up/down to push win rate above target.
    for (const trig of ["leader_chase", "flip_fade"] as const) {
      const { data: hist } = await supabase
        .from("auto_trade_odds_shadow")
        .select("won, limit_cents")
        .eq("user_id", userId)
        .eq("trigger", trig)
        .eq("settled", true)
        .order("settled_at", { ascending: false })
        .limit(50);
      const settled = hist ?? [];
      if (settled.length >= 20) {
        const winRate = settled.filter(r => r.won).length / settled.length;
        const cur = cal[trig];
        const next = { ...cur };
        // Target 62%+. Below → tighten. Above 75% with sample ≥30 → loosen a bit.
        if (winRate < 0.55) next.min_cents = Math.min(cur.min_cents + 3, 85);
        else if (winRate > 0.75 && settled.length >= 30) next.min_cents = Math.max(cur.min_cents - 2, trig === "flip_fade" ? 55 : 60);
        await supabase.from("auto_odds_calibration").upsert({
          user_id: userId,
          trigger: trig,
          min_cents: next.min_cents,
          max_cents: next.max_cents,
          min_velocity: next.min_velocity,
          sample_size: settled.length,
          win_rate: Math.round(winRate * 1000) / 1000,
          last_tuned_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        });
      }
    }

    return {
      ok: true as const,
      fired: inserted,
      settled: settledCount,
      earlyExits,
      skipped: skipRows.length,
      scanned: groups.size,
    };
  });

export const getOddsShadowReport = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { supabase, userId } = context;
    const { data, error } = await supabase
      .from("auto_trade_odds_shadow")
      .select("*")
      .eq("user_id", userId)
      .order("fired_at", { ascending: false })
      .limit(200);
    if (error) return { ok: false as const, error: error.message };
    const rows = data ?? [];
    const settled = rows.filter(r => r.settled);
    const wins = settled.filter(r => r.won);
    const totalPnl = settled.reduce((s, r) => s + Number(r.pnl_usd ?? 0), 0);
    const byTrigger = {
      leader_chase: aggByTrigger(rows, "leader_chase"),
      flip_fade: aggByTrigger(rows, "flip_fade"),
    };

    // Skip-reason summary (last 24h).
    const dayAgo = new Date(Date.now() - 24 * 3600_000).toISOString();
    const { data: skips } = await supabase
      .from("auto_trade_odds_skip_log")
      .select("reason, trigger_candidate, created_at")
      .eq("user_id", userId)
      .gte("created_at", dayAgo)
      .order("created_at", { ascending: false })
      .limit(500);
    const skipCounts: Record<string, number> = {};
    for (const s of skips ?? []) {
      const k = `${s.trigger_candidate ?? "any"}:${s.reason}`;
      skipCounts[k] = (skipCounts[k] ?? 0) + 1;
    }
    const skipTop = Object.entries(skipCounts)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 8)
      .map(([k, n]) => ({ key: k, count: n }));

    // Calibration state.
    const { data: cal } = await supabase
      .from("auto_odds_calibration")
      .select("*")
      .eq("user_id", userId);

    return {
      ok: true as const,
      totals: {
        fired: rows.length,
        settled: settled.length,
        wins: wins.length,
        losses: settled.length - wins.length,
        winPct: settled.length ? Math.round((wins.length / settled.length) * 1000) / 10 : 0,
        pnlUsd: Math.round(totalPnl * 100) / 100,
        earlyExits: settled.filter(r => r.early_exited).length,
      },
      byTrigger,
      skipTop,
      calibration: cal ?? [],
      recent: rows.slice(0, 25),
    };
  });

function aggByTrigger(rows: Array<Record<string, unknown>>, trig: string) {
  const filtered = rows.filter(r => r.trigger === trig);
  const settled = filtered.filter(r => r.settled);
  const wins = settled.filter(r => r.won);
  const pnl = settled.reduce((s, r) => s + Number(r.pnl_usd ?? 0), 0);
  return {
    fired: filtered.length,
    settled: settled.length,
    wins: wins.length,
    pnl: Math.round(pnl * 100) / 100,
  };
}
