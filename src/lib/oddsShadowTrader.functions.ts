import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { evaluateAtm, evaluateReentry, atmByTicker, type Row } from "./oddsShadowCore";

// Odds-Flip Shadow Trader v2 — SHADOW-ONLY.
// Adds: velocity, spread proxy, multi-tick stability, flip cooldown,
// early-exit on adverse flip, live calibration, skip-reason log,
// profit-bankroll staking (play with profit, not principal).

const BASE_STAKE_USD = 100;
const PROFIT_STAKE_PCT = 0.50; // after 3 wins, stake 50% of profit bank only
const MAX_STAKE_USD = 500;     // safety cap
const UNLOCK_WINDOW = 3;       // rolling window size
// Profit bank seeded at $71 starting 2026-07-08 04:47 UTC. Trades settled
// before this cutoff are ignored for bank + 3-win unlock streak.
const BANK_SEED_USD = 71;
const BANK_CUTOFF_ISO = "2026-07-08T04:47:00Z";

async function computeStake(
  supabase: any,
  userId: string,
): Promise<{ stake: number; mode: "base" | "profit"; bank: number }> {
  // Cumulative PnL since cutoff, plus seed — sourced from LIVE Kalshi orders.
  const { data: allSettled } = await supabase
    .from("auto_trade_orders")
    .select("pnl_usd")
    .eq("user_id", userId)
    .eq("mode", "live")
    .in("status", ["settled_win", "settled_loss"])
    .gte("settled_at", BANK_CUTOFF_ISO)
    .order("settled_at", { ascending: false })
    .limit(1000);
  const bank = Math.max(
    0,
    BANK_SEED_USD + (allSettled ?? []).reduce((s: number, r: any) => s + Number(r.pnl_usd ?? 0), 0),
  );

  // Unlock check: last N settled LIVE trades (since cutoff) are all wins.
  const { data: recent } = await supabase
    .from("auto_trade_orders")
    .select("pnl_usd, stake_usd, settled_at, status")
    .eq("user_id", userId)
    .eq("mode", "live")
    .in("status", ["settled_win", "settled_loss"])
    .gte("settled_at", BANK_CUTOFF_ISO)
    .order("settled_at", { ascending: false })
    .limit(UNLOCK_WINDOW);
  const recentArr = (recent ?? []) as Array<{ pnl_usd: number | string | null; stake_usd: number | string | null; status: string }>;
  const winStreakUnlocked = recentArr.length >= UNLOCK_WINDOW
    && recentArr.every((r) => r.status === "settled_win");

  if (winStreakUnlocked && bank > 0) {
    const baseStake = Math.min(bank * PROFIT_STAKE_PCT, MAX_STAKE_USD);
    // Martingale: if last settled trade was a loss, double previous stake — only if bank covers it.
    const last = recentArr[0];
    if (last && Number(last.pnl_usd ?? 0) <= 0) {
      const doubled = Math.min(Number(last.stake_usd ?? baseStake) * 2, MAX_STAKE_USD);
      if (bank >= doubled) return { stake: doubled, mode: "profit", bank };
    }
    return { stake: baseStake, mode: "profit", bank };
  }
  return { stake: BASE_STAKE_USD, mode: "base", bank };
}


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
    let reentries = 0;
    const skipRows: Array<Record<string, unknown>> = [];

    // Compute dynamic stake once per tick — same bankroll basis for every fire this cycle.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const stakeInfo = await computeStake(supabase as any, userId);

    for (const [tk, atm] of groups) {
      if (firedSet.has(tk)) continue;
      const res = evaluateAtm(atm, cal);
      if (res.decision) {
        const d = res.decision;
        const limitCents = d.side === "YES" ? d.yes_cents : d.no_cents;
        if (limitCents < 1 || limitCents > 99) continue;
        const contracts = Math.floor((stakeInfo.stake * 100) / limitCents);
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
        else if ((error as { code?: string })?.code === "23505") {
          await supabase.from("auto_trade_odds_skip_log").insert({
            user_id: userId, ticker: d.ticker, reason: "duplicate_window_lock",
            trigger_candidate: d.trigger, yes_cents: d.yes_cents, no_cents: d.no_cents,
            seconds_to_close: d.seconds_to_close, flip_count: d.flip_count,
            detail: { rotation_index: 0, source: "browser" },
          });
        }
      } else {
        // Re-entry (pullback) check — half stake, rotation_index=2, one per ticker.
        const rd = evaluateReentry(atm);
        if (rd) {
          const limitCents = rd.side === "YES" ? rd.yes_cents : rd.no_cents;
          const halfStake = stakeInfo.mode === "profit" ? stakeInfo.stake * 0.5 : 50;
          const contracts = Math.floor((halfStake * 100) / limitCents);
          if (contracts >= 1) {
            const stake = (contracts * limitCents) / 100;
            const { error } = await supabase.from("auto_trade_odds_shadow").insert({
              user_id: userId,
              ticker: rd.ticker,
              strike: rd.strike,
              side: rd.side,
              trigger: rd.trigger,
              seconds_to_close_at_fire: rd.seconds_to_close,
              yes_cents_at_fire: rd.yes_cents,
              no_cents_at_fire: rd.no_cents,
              limit_cents: limitCents,
              contracts,
              stake_usd: stake,
              flip_count_at_fire: rd.flip_count,
              spot_at_fire: rd.spot,
              entry_velocity_cents: rd.velocity,
              rotation_index: 2,
            });
            if (!error) reentries++;
            else if ((error as { code?: string })?.code === "23505") {
              await supabase.from("auto_trade_odds_skip_log").insert({
                user_id: userId, ticker: rd.ticker, reason: "duplicate_window_lock",
                trigger_candidate: rd.trigger, yes_cents: rd.yes_cents, no_cents: rd.no_cents,
                seconds_to_close: rd.seconds_to_close, flip_count: rd.flip_count,
                detail: { rotation_index: 2, source: "browser" },
              });
            }
          }
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
    }
    if (skipRows.length) {
      // Cap to prevent bloat.
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      await supabase.from("auto_trade_odds_skip_log").insert(skipRows.slice(0, 20) as any);
    }

    // 5. Settlement + early exit + flip rotation for open positions.
    const { data: open } = await supabase
      .from("auto_trade_odds_shadow")
      .select("id, ticker, strike, side, contracts, limit_cents, fired_at, rotation_index, spot_at_fire")
      .eq("user_id", userId)
      .eq("settled", false);
    let settledCount = 0;
    let earlyExits = 0;
    let rotations = 0;
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

      // Adverse-flip early exit + optional 1x rotation into the new leader side.
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

          // Flip rotation: only if this trade wasn't already a rotation and
          // there's ≥90s left. Buy the OPPOSITE side at its current cents.
          const rotIdx = Number(row.rotation_index ?? 0);
          if (!exErr && rotIdx === 0 && last.seconds_to_close >= 90) {
            const newSide: "YES" | "NO" = row.side === "YES" ? "NO" : "YES";
            const newCents = newSide === "YES" ? last.yes_cents : last.no_cents;
            if (newCents >= 30 && newCents <= 90) {
              const rotContracts = Math.floor((stakeInfo.stake * 100) / newCents);
              if (rotContracts >= 1) {
                const rotStake = (rotContracts * newCents) / 100;
                const { error: insErr } = await supabase.from("auto_trade_odds_shadow").insert({
                  user_id: userId,
                  ticker: row.ticker as string,
                  strike: Number(row.strike),
                  side: newSide,
                  trigger: "flip_fade",
                  seconds_to_close_at_fire: last.seconds_to_close,
                  yes_cents_at_fire: last.yes_cents,
                  no_cents_at_fire: last.no_cents,
                  limit_cents: newCents,
                  contracts: rotContracts,
                  stake_usd: rotStake,
                  flip_count_at_fire: 0,
                  spot_at_fire: Number(row.spot_at_fire ?? 0) || null,
                  entry_velocity_cents: 0,
                  rotation_index: 1,
                  parent_shadow_id: row.id,
                });
                if (!insErr) rotations++;
                else if ((insErr as { code?: string })?.code === "23505") {
                  await supabase.from("auto_trade_odds_skip_log").insert({
                    user_id: userId, ticker: row.ticker as string, reason: "duplicate_window_lock",
                    trigger_candidate: "flip_fade", yes_cents: last.yes_cents, no_cents: last.no_cents,
                    seconds_to_close: last.seconds_to_close,
                    detail: { rotation_index: 1, source: "browser" },
                  });
                }
              }
            }
          }
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
      rotations,
      reentries,
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
      .select("reason, trigger_candidate, ticker, yes_cents, no_cents, detail, created_at")
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

    // Recent regression skips (chop detector) with slope/R² detail.
    const regressionSkips = (skips ?? [])
      .filter((s: any) => typeof s.reason === "string" && s.reason.startsWith("regression_"))
      .slice(0, 15)
      .map((s: any) => ({
        ticker: String(s.ticker ?? ""),
        reason: String(s.reason),
        yes_cents: s.yes_cents ?? null,
        no_cents: s.no_cents ?? null,
        detail: s.detail ?? null,
        created_at: s.created_at,
      }));

    // Calibration state.
    const { data: cal } = await supabase
      .from("auto_odds_calibration")
      .select("*")
      .eq("user_id", userId);

    // Bankroll / staking info for UI.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const stakeInfo = await computeStake(supabase as any, userId);

    // Win-streak progress from LIVE Kalshi orders post-cutoff.
    const BANK_CUTOFF_ISO_UI = "2026-07-08T04:47:00Z";
    const { data: streakRows } = await supabase
      .from("auto_trade_orders")
      .select("status, settled_at")
      .eq("user_id", userId)
      .eq("mode", "live")
      .in("status", ["settled_win", "settled_loss"])
      .gte("settled_at", BANK_CUTOFF_ISO_UI)
      .order("settled_at", { ascending: false })
      .limit(3);
    let winStreak = 0;
    for (const r of (streakRows ?? []) as Array<{ status: string }>) {
      if (r.status === "settled_win") winStreak++;
      else break;
    }

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
        rotations: rows.filter(r => Number(r.rotation_index) === 1).length,
        reentries: rows.filter(r => Number(r.rotation_index) === 2).length,
      },
      bankroll: {
        bank: Math.round(stakeInfo.bank * 100) / 100,
        mode: stakeInfo.mode,
        nextStake: Math.round(stakeInfo.stake * 100) / 100,
        unlockThreshold: 50,
        stakePct: 40,
        winStreak,
        unlockNeeded: 3,
      },
      byTrigger,
      skipTop,
      regressionSkips,
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
