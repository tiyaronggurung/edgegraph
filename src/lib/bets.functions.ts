import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

const SaveBetSchema = z.object({
  game: z.string().min(1).max(255),
  pick: z.string().min(1).max(255),
  sport: z.string().min(1).max(64),
  odds: z.number().min(0).max(1).optional(),
  pattern_type: z.string().max(64).optional(),
  confidence_score: z.number().min(0).max(100).optional(),
  edge_score: z.number().min(-100).max(100).optional(),
  stake: z.number().min(0).max(1_000_000).optional(),
  notes: z.string().max(2000).optional(),
});

export const saveBetFromMarket = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => SaveBetSchema.parse(input))
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;

    // Link to user's latest analysis (if any).
    const { data: latest } = await supabase
      .from("analyses")
      .select("id")
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    const { data: bet, error } = await supabase
      .from("bets")
      .insert({
        user_id: userId,
        analysis_id: latest?.id ?? null,
        game: data.game,
        pick: data.pick,
        sport: data.sport,
        odds: data.odds ?? null,
        pattern_type: data.pattern_type ?? null,
        confidence_score: data.confidence_score ?? null,
        edge_score: data.edge_score ?? null,
        notes: data.notes ?? null,
        result: "Pending",
        stake: data.stake ?? 0,
      })
      .select("id, analysis_id")
      .single();

    if (error) throw new Error(error.message);
    return { ok: true, betId: bet.id, linkedAnalysisId: bet.analysis_id };
  });

export const getBankrollStats = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { supabase } = context;
    const [{ data: prof }, { data: bets }] = await Promise.all([
      supabase.from("profiles").select("bankroll").maybeSingle(),
      supabase.from("bets").select("stake, profit_loss, result"),
    ]);
    const bankroll = Number(prof?.bankroll ?? 1000);
    let openStake = 0;
    let realized = 0;
    let openCount = 0;
    let settledCount = 0;
    for (const b of bets ?? []) {
      const stake = Number(b.stake ?? 0);
      const pl = Number(b.profit_loss ?? 0);
      const result = String(b.result ?? "Pending");
      if (result === "Pending") {
        openStake += stake;
        openCount += 1;
      } else {
        realized += pl;
        settledCount += 1;
      }
    }
    return { bankroll, openStake, openCount, realized, settledCount };
  });

/**
 * CLV (Closing Line Value) capture.
 * For decimal odds: clv% = (entry_odds / closing_odds - 1) * 100
 * Positive CLV = locked a better price than close — best long-run +EV signal.
 */
const CaptureClosingSchema = z.object({
  betId: z.string().uuid(),
  closingOdds: z.number().min(1.01).max(1000),
});

export const captureClosingLine = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => CaptureClosingSchema.parse(input))
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    const { data: bet, error: fetchErr } = await supabase
      .from("bets")
      .select("id, odds, user_id")
      .eq("id", data.betId)
      .maybeSingle();
    if (fetchErr) throw new Error(fetchErr.message);
    if (!bet || bet.user_id !== userId) throw new Error("Bet not found");
    const entry = Number(bet.odds ?? 0);
    if (!entry || entry < 1.01) throw new Error("Entry odds missing or invalid");
    const clv = (entry / data.closingOdds - 1) * 100;
    const { error: updErr } = await supabase
      .from("bets")
      .update({
        closing_odds: data.closingOdds,
        closing_captured_at: new Date().toISOString(),
        clv_percent: clv,
      })
      .eq("id", data.betId);
    if (updErr) throw new Error(updErr.message);
    return { ok: true, clvPercent: clv };
  });

export const getClvStats = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { supabase } = context;
    const { data: bets } = await supabase
      .from("bets")
      .select("id, clv_percent")
      .not("clv_percent", "is", null);
    const rows = bets ?? [];
    if (!rows.length) return { avgClv: 0, captured: 0, positiveRate: 0 };
    const sum = rows.reduce((s, b) => s + Number(b.clv_percent ?? 0), 0);
    const pos = rows.filter((b) => Number(b.clv_percent ?? 0) > 0).length;
    return {
      avgClv: sum / rows.length,
      captured: rows.length,
      positiveRate: (pos / rows.length) * 100,
    };
  });



// ──────────────────────────────────────────────────────────────────
// Place Bet directly from a verdict — creates a bets row and links
// it to the verdict_log row via bet_id. Idempotent: if the verdict
// already has a bet_id, returns the existing bet.
// ──────────────────────────────────────────────────────────────────
const PlaceBetFromVerdictSchema = z.object({
  verdictId: z.string().uuid(),
  stake: z.number().min(0.01).max(1_000_000),
  entryPrice: z.number().min(0.01).max(0.99),
});

export const placeBetFromVerdict = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => PlaceBetFromVerdictSchema.parse(input))
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    const { data: vrow, error: vErr } = await supabase
      .from("verdict_log")
      .select("id, user_id, market_ticker, market_title, side, side_label, pattern, edge_pts, bet_id")
      .eq("id", data.verdictId)
      .maybeSingle();
    if (vErr) throw new Error(vErr.message);
    if (!vrow || vrow.user_id !== userId) throw new Error("Verdict not found");
    if (vrow.bet_id) return { ok: true, betId: vrow.bet_id, alreadyExisted: true };

    const { data: bet, error: insErr } = await supabase
      .from("bets")
      .insert({
        user_id: userId,
        game: vrow.market_title ?? vrow.market_ticker,
        pick: `${vrow.side_label ?? vrow.side} (${vrow.market_ticker})`,
        sport: "Kalshi",
        odds: data.entryPrice,
        stake: data.stake,
        pattern_type: vrow.pattern,
        edge_score: vrow.edge_pts ?? null,
        result: "Pending",
        notes: "Placed from VerdictCard",
      })
      .select("id")
      .single();
    if (insErr || !bet) throw new Error(insErr?.message ?? "Failed to create bet");

    await supabase.from("verdict_log").update({ bet_id: bet.id }).eq("id", data.verdictId);
    return { ok: true, betId: bet.id, alreadyExisted: false };
  });

// ──────────────────────────────────────────────────────────────────
// Auto-settle pending Kalshi verdicts by polling each market status.
// For every pending verdict_log row with a market_ticker, fetch
// Kalshi market status; if settled (result yes/no), mark verdict +
// linked bet with WIN/LOSS and compute P/L.
// ──────────────────────────────────────────────────────────────────
export const settlePendingKalshiBets = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { supabase, userId } = context;
    const { data: pending } = await supabase
      .from("verdict_log")
      .select("id, market_ticker, side, bet_id")
      .eq("user_id", userId)
      .eq("result", "Pending")
      .limit(100);

    const rows = pending ?? [];
    if (rows.length === 0) return { checked: 0, settled: 0 };

    const tickers = Array.from(new Set(rows.map((r) => r.market_ticker).filter(Boolean)));

    const BASE = "https://api.elections.kalshi.com/trade-api/v2";
    const statuses = await Promise.all(
      tickers.map(async (ticker) => {
        try {
          const res = await fetch(`${BASE}/markets/${encodeURIComponent(ticker)}`, {
            headers: { Accept: "application/json" },
          });
          if (!res.ok) return { ticker, status: "unknown", result: "" };
          const json = await res.json();
          const m = json.market ?? {};
          return { ticker, status: String(m.status ?? ""), result: String(m.result ?? "") };
        } catch {
          return { ticker, status: "unknown", result: "" };
        }
      }),
    );
    const statusMap = new Map(statuses.map((s) => [s.ticker, s]));

    let settled = 0;
    for (const r of rows) {
      const s = statusMap.get(r.market_ticker);
      if (!s) continue;
      const isSettled = s.status === "settled" || s.status === "finalized";
      if (!isSettled) continue;
      const yesWon = s.result === "yes";
      const noWon = s.result === "no";
      if (!yesWon && !noWon) continue;

      const verdictResult = (r.side === "YES" && yesWon) || (r.side === "NO" && noWon) ? "WIN" : "LOSS";

      await supabase
        .from("verdict_log")
        .update({ result: verdictResult, resolved_at: new Date().toISOString() })
        .eq("id", r.id);

      if (r.bet_id) {
        const { data: bet } = await supabase
          .from("bets")
          .select("stake, odds")
          .eq("id", r.bet_id)
          .maybeSingle();
        const stake = Number(bet?.stake ?? 0);
        const odds = Number(bet?.odds ?? 0);
        let pl = 0;
        let betResult = "Pending";
        if (verdictResult === "WIN") {
          betResult = "Win";
          pl = odds > 0 && odds < 1 ? stake * ((1 - odds) / odds) : 0;
        } else {
          betResult = "Loss";
          pl = -stake;
        }
        await supabase
          .from("bets")
          .update({ result: betResult, profit_loss: pl })
          .eq("id", r.bet_id);
      }
      settled += 1;
    }
    return { checked: rows.length, settled };
  });

// ──────────────────────────────────────────────────────────────────
// Cashout signals — for each pending bet, fetch current Kalshi price
// and compute a recommendation: LOCK_PROFIT / CUT_LOSS / HOLD.
// Pure read; the user decides whether to act via cashOutBet.
// ──────────────────────────────────────────────────────────────────
export type CashoutTier = "LOCK_PROFIT" | "CUT_LOSS" | "HOLD";

export interface CashoutSignal {
  verdictId: string;
  betId: string;
  ticker: string;
  title: string | null;
  side: "YES" | "NO" | string;
  sideLabel: string | null;
  stake: number;
  entryPrice: number; // 0..1, price of the side bought
  currentPrice: number; // 0..1, current price of the side held
  estValue: number; // dollars you'd receive selling now
  estPl: number; // estValue - stake
  ratio: number; // currentPrice / entryPrice
  tier: CashoutTier;
  reason: string;
}

const LOCK_RATIO = 1.40;
const CUT_RATIO = 0.55;

export const getCashoutSignals = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<{ signals: CashoutSignal[] }> => {
    const { supabase, userId } = context;
    const { data: pending } = await supabase
      .from("verdict_log")
      .select("id, market_ticker, market_title, side, side_label, bet_id")
      .eq("user_id", userId)
      .eq("result", "Pending")
      .not("bet_id", "is", null)
      .limit(50);

    const rows = pending ?? [];
    if (rows.length === 0) return { signals: [] };

    const betIds = rows.map((r) => r.bet_id!).filter(Boolean);
    const { data: bets } = await supabase
      .from("bets")
      .select("id, stake, odds")
      .in("id", betIds);
    const betMap = new Map((bets ?? []).map((b) => [b.id, b]));

    const tickers = Array.from(new Set(rows.map((r) => r.market_ticker).filter(Boolean)));
    const BASE = "https://api.elections.kalshi.com/trade-api/v2";
    const prices = await Promise.all(
      tickers.map(async (ticker) => {
        try {
          const res = await fetch(`${BASE}/markets/${encodeURIComponent(ticker)}`, {
            headers: { Accept: "application/json" },
          });
          if (!res.ok) return { ticker, yesPrice: null as number | null };
          const json = await res.json();
          const m = json.market ?? {};
          // Prefer mid of bid/ask; fall back to last price.
          const bid = Number(m.yes_bid_dollars ?? 0);
          const ask = Number(m.yes_ask_dollars ?? 0);
          const last = Number(m.last_price_dollars ?? 0);
          let yesPrice: number | null = null;
          if (bid > 0 && ask > 0) yesPrice = (bid + ask) / 2;
          else if (last > 0) yesPrice = last;
          else if (bid > 0) yesPrice = bid;
          else if (ask > 0) yesPrice = ask;
          return { ticker, yesPrice };
        } catch {
          return { ticker, yesPrice: null as number | null };
        }
      }),
    );
    const priceMap = new Map(prices.map((p) => [p.ticker, p.yesPrice]));

    const signals: CashoutSignal[] = [];
    for (const r of rows) {
      const bet = betMap.get(r.bet_id!);
      if (!bet) continue;
      const stake = Number(bet.stake ?? 0);
      const entry = Number(bet.odds ?? 0);
      const yesPrice = priceMap.get(r.market_ticker);
      if (!stake || !entry || entry <= 0 || entry >= 1 || yesPrice == null) continue;

      const currentPrice = r.side === "NO" ? Math.max(0, Math.min(1, 1 - yesPrice)) : Math.max(0, Math.min(1, yesPrice));
      const shares = stake / entry;
      const estValue = shares * currentPrice;
      const estPl = estValue - stake;
      const ratio = currentPrice / entry;

      let tier: CashoutTier = "HOLD";
      let reason = `Holding — price moved ${((ratio - 1) * 100).toFixed(0)}%, edge intact`;
      if (ratio >= LOCK_RATIO) {
        tier = "LOCK_PROFIT";
        reason = `Price up ${((ratio - 1) * 100).toFixed(0)}% — lock in +$${estPl.toFixed(2)} before reversal`;
      } else if (ratio <= CUT_RATIO) {
        tier = "CUT_LOSS";
        reason = `Price down ${((1 - ratio) * 100).toFixed(0)}% — cut loss, recover $${estValue.toFixed(2)} of $${stake.toFixed(0)}`;
      }

      signals.push({
        verdictId: r.id,
        betId: r.bet_id!,
        ticker: r.market_ticker,
        title: r.market_title,
        side: r.side,
        sideLabel: r.side_label,
        stake,
        entryPrice: entry,
        currentPrice,
        estValue,
        estPl,
        ratio,
        tier,
        reason,
      });
    }

    // Sort: actionable alerts first (LOCK_PROFIT, CUT_LOSS), then HOLD by abs(ratio-1) desc
    signals.sort((a, b) => {
      const rank = (t: CashoutTier) => (t === "HOLD" ? 1 : 0);
      const dr = rank(a.tier) - rank(b.tier);
      if (dr !== 0) return dr;
      return Math.abs(b.ratio - 1) - Math.abs(a.ratio - 1);
    });

    return { signals };
  });

// ──────────────────────────────────────────────────────────────────
// Cash out a pending bet — records the partial settle in our DB.
// (Kalshi sell happens on Kalshi.com; this captures the result here.)
// ──────────────────────────────────────────────────────────────────
const CashOutSchema = z.object({
  verdictId: z.string().uuid(),
  exitPrice: z.number().min(0.01).max(0.99),
});

export const cashOutBet = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => CashOutSchema.parse(input))
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    const { data: vrow, error: vErr } = await supabase
      .from("verdict_log")
      .select("id, user_id, side, bet_id, result")
      .eq("id", data.verdictId)
      .maybeSingle();
    if (vErr) throw new Error(vErr.message);
    if (!vrow || vrow.user_id !== userId) throw new Error("Verdict not found");
    if (vrow.result !== "Pending") throw new Error("Bet already settled");
    if (!vrow.bet_id) throw new Error("No bet linked to this verdict");

    const { data: bet } = await supabase
      .from("bets")
      .select("id, stake, odds")
      .eq("id", vrow.bet_id)
      .maybeSingle();
    if (!bet) throw new Error("Linked bet not found");
    const stake = Number(bet.stake ?? 0);
    const entry = Number(bet.odds ?? 0);
    if (!stake || !entry) throw new Error("Bet has no stake/entry price");

    // exitPrice is YES price; flip for NO side
    const sideExit = vrow.side === "NO" ? 1 - data.exitPrice : data.exitPrice;
    const shares = stake / entry;
    const proceeds = shares * sideExit;
    const pl = proceeds - stake;
    const betResult = pl > 0.01 ? "Win" : pl < -0.01 ? "Loss" : "Push";
    const verdictResult = pl > 0.01 ? "WIN" : pl < -0.01 ? "LOSS" : "VOID";

    await supabase
      .from("verdict_log")
      .update({ result: verdictResult, resolved_at: new Date().toISOString() })
      .eq("id", data.verdictId);
    await supabase
      .from("bets")
      .update({
        result: betResult,
        profit_loss: pl,
        notes: `Cashed out @ ${sideExit.toFixed(2)} (entry ${entry.toFixed(2)})`,
      })
      .eq("id", vrow.bet_id);

    return { ok: true, pl, exitPrice: sideExit };
  });
