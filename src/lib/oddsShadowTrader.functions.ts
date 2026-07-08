import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

// Odds-Flip Shadow Trader — SHADOW-ONLY. Decides trades purely from Kalshi
// ATM YES/NO tape. Two triggers:
//   1) leader_chase: inside T-4m, stable leader in 60..90¢ band, no flip in last 2 snaps
//   2) flip_fade:    ATM leader just flipped after T-10m, new leader ≥55¢
// Whichever fires first per ticker is logged. Never places a real order.
// Settlement compares final ATM YES cents (>=50 → YES wins) to the fired side.

const WINDOW = 900;
const STAKE_USD = 50;

interface Row {
  ticker: string; strike: number; spot: number;
  yes_cents: number; no_cents: number;
  seconds_to_close: number; snapped_at: string;
}

function leader(yes: number): "YES" | "NO" | "TIE" {
  if (yes > 50) return "YES";
  if (yes < 50) return "NO";
  return "TIE";
}

interface Decision {
  ticker: string; strike: number; spot: number;
  side: "YES" | "NO"; trigger: "leader_chase" | "flip_fade";
  yes_cents: number; no_cents: number;
  seconds_to_close: number;
  flip_count: number;
}

function evaluate(atm: Row[]): Decision | null {
  if (atm.length < 2) return null;
  const last = atm[atm.length - 1];
  const prev = atm[atm.length - 2];
  if (last.seconds_to_close <= 30) return null; // no time to enter
  const tElapsed = WINDOW - last.seconds_to_close;

  // Count flips over full history.
  let flips = 0;
  let p = leader(atm[0].yes_cents);
  for (let i = 1; i < atm.length; i++) {
    const c = leader(atm[i].yes_cents);
    if (c !== "TIE" && p !== "TIE" && c !== p) flips++;
    p = c;
  }

  const curL = leader(last.yes_cents);
  const prvL = leader(prev.yes_cents);

  // Trigger 2: flip_fade — just flipped, past T-10m, new leader ≥55¢.
  if (curL !== "TIE" && prvL !== "TIE" && curL !== prvL && tElapsed >= 300) {
    const cents = curL === "YES" ? last.yes_cents : last.no_cents;
    if (cents >= 55 && cents <= 90) {
      return {
        ticker: last.ticker, strike: Number(last.strike), spot: Number(last.spot),
        side: curL, trigger: "flip_fade",
        yes_cents: last.yes_cents, no_cents: last.no_cents,
        seconds_to_close: last.seconds_to_close, flip_count: flips,
      };
    }
  }

  // Trigger 1: leader_chase — inside T-4m, stable, 60..90¢.
  if (tElapsed >= 660 && curL !== "TIE" && curL === prvL) {
    const cents = curL === "YES" ? last.yes_cents : last.no_cents;
    if (cents >= 60 && cents <= 90) {
      return {
        ticker: last.ticker, strike: Number(last.strike), spot: Number(last.spot),
        side: curL, trigger: "leader_chase",
        yes_cents: last.yes_cents, no_cents: last.no_cents,
        seconds_to_close: last.seconds_to_close, flip_count: flips,
      };
    }
  }

  return null;
}

// Group tape rows by ticker, pick ATM row per snap.
function atmByTicker(rows: Row[]): Map<string, Row[]> {
  const perTicker = new Map<string, Row[]>();
  for (const r of rows) {
    const a = perTicker.get(r.ticker) ?? []; a.push(r); perTicker.set(r.ticker, a);
  }
  const out = new Map<string, Row[]>();
  for (const [t, arr] of perTicker) {
    const bySnap = new Map<string, Row>();
    for (const r of arr) {
      const p = bySnap.get(r.snapped_at);
      if (!p || Math.abs(r.strike - r.spot) < Math.abs(p.strike - p.spot)) bySnap.set(r.snapped_at, r);
    }
    out.set(t, Array.from(bySnap.values()).sort((a, b) => a.snapped_at.localeCompare(b.snapped_at)));
  }
  return out;
}

export const runOddsShadowTick = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { supabase, userId } = context;

    // 1. Pull last ~15min of tape (enough context for flip detection & checkpoints).
    const cutoff = new Date(Date.now() - 15 * 60_000).toISOString();
    const { data: tape, error: tapeErr } = await supabase
      .from("btc_odds_tape")
      .select("ticker, strike, spot, yes_cents, no_cents, seconds_to_close, snapped_at")
      .gte("snapped_at", cutoff)
      .order("snapped_at", { ascending: true });
    if (tapeErr) return { ok: false as const, error: tapeErr.message };

    const groups = atmByTicker((tape as Row[] | null) ?? []);

    // 2. Find already-fired tickers to skip.
    const { data: fired } = await supabase
      .from("auto_trade_odds_shadow")
      .select("ticker")
      .eq("user_id", userId);
    const firedSet = new Set((fired ?? []).map(r => r.ticker));

    // 3. Evaluate each ticker.
    const decisions: Decision[] = [];
    for (const [tk, atm] of groups) {
      if (firedSet.has(tk)) continue;
      const d = evaluate(atm);
      if (d) decisions.push(d);
    }

    // 4. Insert paper trades.
    let inserted = 0;
    for (const d of decisions) {
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
      });
      if (!error) inserted++;
    }

    // 5. Settle any unsettled shadow rows whose window has closed.
    // Final ATM YES cents at close: yes_cents of last snap when seconds_to_close <= 0.
    const { data: unsettled } = await supabase
      .from("auto_trade_odds_shadow")
      .select("id, ticker, side, contracts, limit_cents")
      .eq("user_id", userId)
      .eq("settled", false);
    let settledCount = 0;
    for (const row of unsettled ?? []) {
      const atm = groups.get(row.ticker as string);
      if (!atm || atm.length === 0) continue;
      const last = atm[atm.length - 1];
      if (last.seconds_to_close > 0) continue; // still open
      const yesWon = last.yes_cents >= 50;
      const sideWon = row.side === "YES" ? yesWon : !yesWon;
      // PnL: win → contracts*(100-limit)/100, loss → -contracts*limit/100.
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
    }

    return { ok: true as const, fired: inserted, settled: settledCount, scanned: groups.size };
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
      leader_chase: {
        fired: rows.filter(r => r.trigger === "leader_chase").length,
        settled: settled.filter(r => r.trigger === "leader_chase").length,
        wins: wins.filter(r => r.trigger === "leader_chase").length,
        pnl: settled.filter(r => r.trigger === "leader_chase").reduce((s, r) => s + Number(r.pnl_usd ?? 0), 0),
      },
      flip_fade: {
        fired: rows.filter(r => r.trigger === "flip_fade").length,
        settled: settled.filter(r => r.trigger === "flip_fade").length,
        wins: wins.filter(r => r.trigger === "flip_fade").length,
        pnl: settled.filter(r => r.trigger === "flip_fade").reduce((s, r) => s + Number(r.pnl_usd ?? 0), 0),
      },
    };
    return {
      ok: true as const,
      totals: {
        fired: rows.length,
        settled: settled.length,
        wins: wins.length,
        losses: settled.length - wins.length,
        winPct: settled.length ? Math.round((wins.length / settled.length) * 1000) / 10 : 0,
        pnlUsd: Math.round(totalPnl * 100) / 100,
      },
      byTrigger,
      recent: rows.slice(0, 25),
    };
  });
