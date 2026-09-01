// Paper (fake-money) Kalshi 15m trading — entry, hedge, exit, flip detection.
// Read-only against Kalshi: never places or cancels a real order. All writes
// land in public.paper_kalshi_positions, scoped to the calling user by RLS.
import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { z } from "zod";
import { getKalshiImpliedSpot } from "@/lib/kalshiImpliedSpot.functions";
import { evaluateSecondLeg, feeCents, HEDGE_RULES } from "@/lib/opsManual/hedgeEngine";

export type PaperSide = "YES" | "NO";

export interface PaperKalshiWindow {
  ok: boolean;
  asOf: string;
  ticker: string | null;
  strike: number | null;
  closeTime: string | null;
  secondsToClose: number | null;
  spot: number | null;
  cushionUsd: number | null;
  /** Side the spot currently favours (YES = above strike). */
  spotSide: PaperSide | null;
  up: { bidCents: number | null; askCents: number | null };
  down: { bidCents: number | null; askCents: number | null };
  model: { side: PaperSide | null; confidence: number | null };
  study: { side: PaperSide | null; confidence: number | null };
  verdict: string | null;
  reasons: string[];
  error: string | null;
}

export interface PaperKalshiPosition {
  id: string;
  ticker: string;
  close_time: string;
  strike: number | null;
  entry_side: PaperSide;
  entry_contracts: number;
  entry_price_cents: number;
  entry_spot: number | null;
  entry_seconds_left: number | null;
  entry_reason: string | null;
  hedge_side: PaperSide | null;
  hedge_contracts: number | null;
  hedge_price_cents: number | null;
  hedged_at: string | null;
  exit_price_cents: number | null;
  exit_contracts: number | null;
  exited_at: string | null;
  exit_reason: string | null;
  crossed_strike: boolean;
  crossed_at: string | null;
  auto_hedge: boolean;
  status: "open" | "hedged" | "closed" | "settled" | "void";
  outcome: PaperSide | null;
  pnl_cents: number | null;
  settled_at: string | null;
  created_at: string;
}

const c = (dollars: number | null | undefined): number | null =>
  dollars == null || !Number.isFinite(dollars) ? null : Math.round(dollars * 100);

const flip = (s: PaperSide): PaperSide => (s === "YES" ? "NO" : "YES");

export type PaperEventKind =
  | "entry" | "hedge" | "exit" | "flip" | "settle" | "skip";

export interface PaperKalshiEvent {
  id: string;
  position_id: string | null;
  ticker: string;
  kind: PaperEventKind;
  side: PaperSide | null;
  contracts: number | null;
  price_cents: number | null;
  /** Negative = cash out (buy), positive = cash in (sell / settle). */
  cash_cents: number | null;
  pnl_cents: number | null;
  spot: number | null;
  strike: number | null;
  seconds_left: number | null;
  note: string | null;
  auto: boolean;
  created_at: string;
}

/** Append one row to the activity/transaction log. Never throws. */
async function logEvent(
  supabase: any,
  userId: string,
  e: {
    positionId?: string | null;
    ticker: string;
    kind: PaperEventKind;
    side?: PaperSide | null;
    contracts?: number | null;
    priceCents?: number | null;
    cashCents?: number | null;
    pnlCents?: number | null;
    spot?: number | null;
    strike?: number | null;
    secondsLeft?: number | null;
    note?: string | null;
    auto?: boolean;
  },
): Promise<void> {
  try {
    await supabase.from("paper_kalshi_events").insert({
      user_id: userId,
      position_id: e.positionId ?? null,
      ticker: e.ticker,
      kind: e.kind,
      side: e.side ?? null,
      contracts: e.contracts ?? null,
      price_cents: e.priceCents ?? null,
      cash_cents: e.cashCents ?? null,
      pnl_cents: e.pnlCents ?? null,
      spot: e.spot ?? null,
      strike: e.strike ?? null,
      seconds_left: e.secondsLeft ?? null,
      note: e.note ?? null,
      auto: e.auto ?? false,
    });
  } catch { /* logging must never break a trade */ }
}

async function loadWindow(): Promise<PaperKalshiWindow> {
    const asOf = new Date().toISOString();
    const base: PaperKalshiWindow = {
      ok: false, asOf, ticker: null, strike: null, closeTime: null, secondsToClose: null,
      spot: null, cushionUsd: null, spotSide: null,
      up: { bidCents: null, askCents: null },
      down: { bidCents: null, askCents: null },
      model: { side: null, confidence: null },
      study: { side: null, confidence: null },
      verdict: null, reasons: [], error: null,
    };

    const { getBtcConsensus } = await import("@/lib/btcConsensus.server");
    const [kRes, cRes] = await Promise.allSettled([getKalshiImpliedSpot(), getBtcConsensus()]);
    const k = kRes.status === "fulfilled" ? kRes.value : null;
    const con = cRes.status === "fulfilled" ? cRes.value : null;

    if (!k?.ok || !k.ticker || k.strike == null) {
      return { ...base, error: k?.error ?? "no live kalshi 15m market" };
    }

    const yesBid = c(k.yesBid);
    const yesAsk = c(k.yesAsk);
    const stc = k.secondsToClose ?? null;
    const closeTime = stc != null ? new Date(Date.now() + stc * 1000).toISOString() : null;
    const spot = con?.spot ?? null;
    const cushion = spot != null && k.strike != null ? Number((spot - k.strike).toFixed(2)) : null;

    return {
      ...base,
      ok: true,
      ticker: k.ticker,
      strike: k.strike,
      closeTime,
      secondsToClose: stc,
      spot,
      cushionUsd: cushion,
      spotSide: cushion == null ? null : cushion >= 0 ? "YES" : "NO",
      up: { bidCents: yesBid, askCents: yesAsk },
      down: {
        bidCents: yesAsk == null ? null : 100 - yesAsk,
        askCents: yesBid == null ? null : 100 - yesBid,
      },
      model: { side: (con?.model.side ?? null) as PaperSide | null, confidence: con?.model.confidence ?? null },
      study: { side: (con?.study.side ?? null) as PaperSide | null, confidence: con?.study.confidence ?? null },
      verdict: con?.verdict ?? null,
      reasons: con?.reasons ?? [],
    };
}

/** Live Kalshi quote + model/study signal for the current 15m window. */
export const getPaperKalshiWindow = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async (): Promise<PaperKalshiWindow> => loadWindow());

export const listPaperKalshiPositions = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { limit?: number } | undefined) => d ?? {})
  .handler(async ({ context, data }): Promise<PaperKalshiPosition[]> => {
    const limit = Math.min(Math.max(data.limit ?? 50, 1), 200);
    const { data: rows } = await context.supabase
      .from("paper_kalshi_positions")
      .select("*")
      .eq("user_id", context.userId)
      .order("created_at", { ascending: false })
      .limit(limit);
    return (rows ?? []) as PaperKalshiPosition[];
  });

/** Open a paper position at the live ask of the chosen side. */
export const paperKalshiEnter = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) =>
    z.object({
      side: z.enum(["YES", "NO"]),
      contracts: z.number().int().min(1).max(1000),
      reason: z.string().max(200).optional(),
    }).parse(d),
  )
  .handler(async ({ data, context }) => {
    const w = await loadWindow();
    if (!w.ok || !w.ticker || !w.closeTime) return { ok: false as const, error: w.error ?? "no live market" };
    const ask = data.side === "YES" ? w.up.askCents : w.down.askCents;
    if (ask == null || ask < 1 || ask > 99) return { ok: false as const, error: `no tradeable ask (${ask}¢)` };

    const { data: row, error } = await context.supabase
      .from("paper_kalshi_positions")
      .insert({
        user_id: context.userId,
        ticker: w.ticker,
        close_time: w.closeTime,
        strike: w.strike,
        entry_side: data.side,
        entry_contracts: data.contracts,
        entry_price_cents: ask,
        entry_spot: w.spot,
        entry_seconds_left: w.secondsToClose,
        entry_reason: data.reason ?? null,
        status: "open",
      })
      .select("id")
      .single();
    if (error) return { ok: false as const, error: error.message };
    await logEvent(context.supabase, context.userId, {
      positionId: row.id as string,
      ticker: w.ticker,
      kind: "entry",
      side: data.side,
      contracts: data.contracts,
      priceCents: ask,
      cashCents: -(ask * data.contracts),
      spot: w.spot,
      strike: w.strike,
      secondsLeft: w.secondsToClose,
      note: data.reason ?? "manual entry",
      auto: data.reason === "auto",
    });
    return { ok: true as const, id: row.id as string, side: data.side, priceCents: ask, contracts: data.contracts };
  });

/** Core hedge evaluation/execution shared by the manual button and auto-hedge. */
async function hedgeOne(
  supabase: any,
  userId: string,
  pos: any,
  w: PaperKalshiWindow,
  execute: boolean,
  auto: boolean,
) {
  const oppSide = flip(pos.entry_side as PaperSide);
  const oppAsk = oppSide === "YES" ? w.up.askCents : w.down.askCents;
  const domPrice = Math.max(w.up.bidCents ?? 0, w.down.bidCents ?? 0);
  if (oppAsk == null) return { ok: false as const, error: "no opposite ask" };

  const entryCost = pos.entry_price_cents + feeCents(pos.entry_price_cents);
  const evaluation = evaluateSecondLeg(
    {
      sideA: pos.entry_side,
      sharesA: pos.entry_contracts,
      avgCostA: entryCost,
      sharesB: pos.hedge_contracts ?? 0,
      dominantSidePrice: domPrice,
      sideSpendUsd: ((pos.hedge_contracts ?? 0) * (pos.hedge_price_cents ?? 0)) / 100,
      windowSpendUsd: (pos.entry_contracts * pos.entry_price_cents) / 100,
    },
    { oppAskCents: oppAsk, secondsLeft: w.secondsToClose ?? 0 },
  );

  if (!execute || evaluation.decision !== "BUY") {
    if (auto) {
      // Only log auto skips that were a real near-miss, not every quiet tick.
      if (evaluation.decision === "BLOCK") {
        await logEvent(supabase, userId, {
          positionId: pos.id, ticker: pos.ticker, kind: "skip", side: oppSide,
          priceCents: oppAsk, spot: w.spot, strike: w.strike,
          secondsLeft: w.secondsToClose, note: evaluation.message, auto: true,
        });
      }
    }
    return { ok: true as const, executed: false, evaluation, rules: HEDGE_RULES };
  }

  const { error } = await supabase
    .from("paper_kalshi_positions")
    .update({
      hedge_side: oppSide,
      hedge_contracts: (pos.hedge_contracts ?? 0) + evaluation.shares,
      hedge_price_cents: evaluation.limitPriceCents,
      hedged_at: new Date().toISOString(),
      status: "hedged",
    })
    .eq("id", pos.id)
    .eq("user_id", userId);
  if (error) return { ok: false as const, error: error.message };

  await logEvent(supabase, userId, {
    positionId: pos.id,
    ticker: pos.ticker,
    kind: "hedge",
    side: oppSide,
    contracts: evaluation.shares,
    priceCents: evaluation.limitPriceCents,
    cashCents: -((evaluation.limitPriceCents ?? 0) * evaluation.shares),
    spot: w.spot,
    strike: w.strike,
    secondsLeft: w.secondsToClose,
    note: evaluation.message,
    auto,
  });
  return { ok: true as const, executed: true, evaluation, rules: HEDGE_RULES };
}

/** Evaluate (and optionally take) the opposite leg using the hedge engine. */
export const paperKalshiHedge = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) =>
    z.object({ id: z.string().uuid(), execute: z.boolean().default(false) }).parse(d),
  )
  .handler(async ({ data, context }) => {
    const { data: pos } = await context.supabase
      .from("paper_kalshi_positions")
      .select("*")
      .eq("id", data.id)
      .eq("user_id", context.userId)
      .maybeSingle();
    if (!pos) return { ok: false as const, error: "position not found" };
    if (pos.status !== "open" && pos.status !== "hedged") {
      return { ok: false as const, error: `position is ${pos.status}` };
    }
    const w = await loadWindow();
    if (!w.ok) return { ok: false as const, error: w.error ?? "no live market" };
    return hedgeOne(context.supabase, context.userId, pos, w, data.execute, false);
  });

/**
 * Auto-hedge sweep: for every live position with auto_hedge on, run the
 * two-sided engine and take the opposite leg the moment it qualifies
 * (matched pair ≤96¢, no ≥70¢ dominance, no new legs inside T−5m).
 */
export const paperKalshiAutoHedgeTick = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const w = await loadWindow();
    if (!w.ok) return { ok: false as const, error: w.error ?? "no live market", hedged: 0 };

    const { data: rows } = await context.supabase
      .from("paper_kalshi_positions")
      .select("*")
      .eq("user_id", context.userId)
      .eq("auto_hedge", true)
      .in("status", ["open", "hedged"])
      .limit(25);

    let hedged = 0;
    const messages: string[] = [];
    for (const pos of (rows ?? []) as any[]) {
      const r = await hedgeOne(context.supabase, context.userId, pos, w, true, true);
      if ("executed" in r && r.executed) {
        hedged++;
        messages.push(`${pos.ticker}: ${r.evaluation.message}`);
      }
    }
    return { ok: true as const, hedged, messages };
  });

/** Toggle auto-hedge for one position. */
export const paperKalshiSetAutoHedge = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) =>
    z.object({ id: z.string().uuid(), enabled: z.boolean() }).parse(d),
  )
  .handler(async ({ data, context }) => {
    const { error } = await context.supabase
      .from("paper_kalshi_positions")
      .update({ auto_hedge: data.enabled })
      .eq("id", data.id)
      .eq("user_id", context.userId);
    if (error) return { ok: false as const, error: error.message };
    return { ok: true as const };
  });

/** Activity + transaction log for the paper book. */
export const listPaperKalshiEvents = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { limit?: number } | undefined) => d ?? {})
  .handler(async ({ context, data }): Promise<PaperKalshiEvent[]> => {
    const limit = Math.min(Math.max(data.limit ?? 100, 1), 500);
    const { data: rows } = await context.supabase
      .from("paper_kalshi_events")
      .select("*")
      .eq("user_id", context.userId)
      .order("created_at", { ascending: false })
      .limit(limit);
    return (rows ?? []) as PaperKalshiEvent[];
  });

/** Sell out of a paper position at the live bid(s). */
export const paperKalshiExit = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) =>
    z.object({ id: z.string().uuid(), reason: z.string().max(200).optional() }).parse(d),
  )
  .handler(async ({ data, context }) => {
    const { data: pos } = await context.supabase
      .from("paper_kalshi_positions")
      .select("*")
      .eq("id", data.id)
      .eq("user_id", context.userId)
      .maybeSingle();
    if (!pos) return { ok: false as const, error: "position not found" };
    if (pos.status !== "open" && pos.status !== "hedged") {
      return { ok: false as const, error: `position is ${pos.status}` };
    }

    const w = await loadWindow();
    if (!w.ok) return { ok: false as const, error: w.error ?? "no live market" };
    const bidFor = (s: PaperSide) => (s === "YES" ? w.up.bidCents : w.down.bidCents);
    const entryBid = bidFor(pos.entry_side as PaperSide);
    if (entryBid == null) return { ok: false as const, error: "no bid to sell into" };

    let pnl = (entryBid - pos.entry_price_cents) * pos.entry_contracts;
    if (pos.hedge_side && pos.hedge_contracts) {
      const hb = bidFor(pos.hedge_side as PaperSide);
      if (hb != null) pnl += (hb - (pos.hedge_price_cents ?? 0)) * pos.hedge_contracts;
    }

    const { error } = await context.supabase
      .from("paper_kalshi_positions")
      .update({
        exit_price_cents: entryBid,
        exit_contracts: pos.entry_contracts,
        exited_at: new Date().toISOString(),
        exit_reason: data.reason ?? "manual_exit",
        pnl_cents: Math.round(pnl),
        status: "closed",
      })
      .eq("id", pos.id)
      .eq("user_id", context.userId);
    if (error) return { ok: false as const, error: error.message };
    await logEvent(context.supabase, context.userId, {
      positionId: pos.id,
      ticker: pos.ticker,
      kind: "exit",
      side: pos.entry_side as PaperSide,
      contracts: pos.entry_contracts,
      priceCents: entryBid,
      cashCents: entryBid * pos.entry_contracts,
      pnlCents: Math.round(pnl),
      spot: w.spot,
      strike: w.strike,
      secondsLeft: w.secondsToClose,
      note: data.reason ?? "manual_exit",
    });
    return { ok: true as const, exitCents: entryBid, pnlCents: Math.round(pnl) };
  });

/**
 * Flip watch: mark any live position whose spot has crossed back over the
 * strike against the held side. Pure bookkeeping — the panel decides what to
 * do with the flag (exit, or exit + buy the cheap other side).
 */
export const paperKalshiFlipWatch = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const w = await loadWindow();
    if (!w.ok || !w.ticker || w.spotSide == null) return { ok: false as const, error: w.error ?? "no live market" };

    const { data: rows } = await context.supabase
      .from("paper_kalshi_positions")
      .select("id, entry_side, crossed_strike")
      .eq("user_id", context.userId)
      .eq("ticker", w.ticker)
      .in("status", ["open", "hedged"]);

    const flipped: string[] = [];
    for (const r of (rows ?? []) as Array<{ id: string; entry_side: PaperSide; crossed_strike: boolean }>) {
      if (r.crossed_strike || r.entry_side === w.spotSide) continue;
      await context.supabase
        .from("paper_kalshi_positions")
        .update({ crossed_strike: true, crossed_at: new Date().toISOString() })
        .eq("id", r.id)
        .eq("user_id", context.userId);
      await logEvent(context.supabase, context.userId, {
        positionId: r.id,
        ticker: w.ticker,
        kind: "flip",
        side: r.entry_side,
        spot: w.spot,
        strike: w.strike,
        secondsLeft: w.secondsToClose,
        note: `spot crossed strike against ${r.entry_side} (cushion ${w.cushionUsd})`,
        auto: true,
      });
      flipped.push(r.id);
    }
    return {
      ok: true as const,
      spotSide: w.spotSide,
      cushionUsd: w.cushionUsd,
      secondsToClose: w.secondsToClose,
      flipped,
    };
  });

/** Settle any due paper positions from Kalshi's official result. */
export const settlePaperKalshiPositions = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<{ settled: number }> => {
    const { data: due } = await context.supabase
      .from("paper_kalshi_positions")
      .select("id, ticker, entry_side, entry_contracts, entry_price_cents, hedge_side, hedge_contracts, hedge_price_cents")
      .eq("user_id", context.userId)
      .in("status", ["open", "hedged"])
      .lt("close_time", new Date().toISOString())
      .limit(50);
    const pending = (due ?? []) as Array<Record<string, any>>;
    if (!pending.length) return { settled: 0 };

    const { fetchKalshiSettlement } = await import("@/lib/kalshiSettle");
    let settled = 0;
    for (const p of pending) {
      const k = await fetchKalshiSettlement(p.ticker).catch(() => null);
      if (!k?.finalized || !k.result) continue;
      const outcome: PaperSide = k.result === "yes" ? "YES" : "NO";

      const legPnl = (side: PaperSide | null, n: number | null, price: number | null) => {
        if (!side || !n || price == null) return 0;
        return (side === outcome ? 100 - price : -price) * n;
      };
      const pnl =
        legPnl(p.entry_side as PaperSide, p.entry_contracts, p.entry_price_cents) +
        legPnl(p.hedge_side as PaperSide | null, p.hedge_contracts, p.hedge_price_cents);

      const { error } = await context.supabase
        .from("paper_kalshi_positions")
        .update({
          status: "settled",
          outcome,
          pnl_cents: Math.round(pnl),
          settled_at: new Date().toISOString(),
        })
        .eq("id", p.id)
        .eq("user_id", context.userId);
      if (!error) {
        settled++;
        await logEvent(context.supabase, context.userId, {
          positionId: p.id,
          ticker: p.ticker,
          kind: "settle",
          side: outcome,
          pnlCents: Math.round(pnl),
          note: `settled ${outcome}`,
          auto: true,
        });
      }
    }
    return { settled };
  });

/* ────────────────────────────────────────────────────────────────────────
   Paper cash account ($10,000 start), equity curve and auto-buy engine.
   Cash is derived from position history so it can never drift:
     realized  = Σ pnl of closed/settled positions
     exposure  = Σ cost of open/hedged positions
     cash      = starting + realized − exposure
     equity    = starting + realized
   ──────────────────────────────────────────────────────────────────────── */

export const PAPER_STARTING_CENTS = 1_000_000; // $10,000

export interface PaperAccount {
  startingCents: number;
  cashCents: number;
  equityCents: number;
  realizedCents: number;
  exposureCents: number;
  openPositions: number;
  autoBuy: boolean;
  autoBuyContracts: number;
  maxAskCents: number;
  minConf: number;
  minCushionUsd: number;
}

const posCost = (p: any) =>
  p.entry_price_cents * p.entry_contracts +
  (p.hedge_price_cents ?? 0) * (p.hedge_contracts ?? 0);

async function readAccount(supabase: any, userId: string): Promise<PaperAccount> {
  let { data: acct } = await supabase
    .from("paper_kalshi_account")
    .select("*")
    .eq("user_id", userId)
    .maybeSingle();

  if (!acct) {
    const ins = await supabase
      .from("paper_kalshi_account")
      .insert({ user_id: userId })
      .select("*")
      .maybeSingle();
    acct = ins.data ?? {
      starting_cents: PAPER_STARTING_CENTS,
      auto_buy: false,
      auto_buy_contracts: 10,
      auto_buy_max_ask_cents: 70,
      auto_buy_min_conf: 0.75,
      auto_buy_min_cushion_usd: 40,
    };
  }

  const { data: rows } = await supabase
    .from("paper_kalshi_positions")
    .select("status, pnl_cents, entry_price_cents, entry_contracts, hedge_price_cents, hedge_contracts")
    .eq("user_id", userId)
    .limit(1000);

  let realized = 0;
  let exposure = 0;
  let open = 0;
  for (const p of (rows ?? []) as any[]) {
    if (p.status === "closed" || p.status === "settled") realized += p.pnl_cents ?? 0;
    else if (p.status === "open" || p.status === "hedged") { exposure += posCost(p); open++; }
  }

  const starting = Number(acct.starting_cents ?? PAPER_STARTING_CENTS);
  return {
    startingCents: starting,
    realizedCents: Math.round(realized),
    exposureCents: Math.round(exposure),
    cashCents: Math.round(starting + realized - exposure),
    equityCents: Math.round(starting + realized),
    openPositions: open,
    autoBuy: !!acct.auto_buy,
    autoBuyContracts: Number(acct.auto_buy_contracts ?? 10),
    maxAskCents: Number(acct.auto_buy_max_ask_cents ?? 70),
    minConf: Number(acct.auto_buy_min_conf ?? 0.75),
    minCushionUsd: Number(acct.auto_buy_min_cushion_usd ?? 40),
  };
}

export const getPaperKalshiAccount = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<PaperAccount> =>
    readAccount(context.supabase, context.userId),
  );

export const updatePaperKalshiAccount = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) =>
    z.object({
      autoBuy: z.boolean().optional(),
      autoBuyContracts: z.number().int().min(1).max(500).optional(),
      maxAskCents: z.number().int().min(5).max(95).optional(),
      minConf: z.number().min(0.5).max(0.99).optional(),
      minCushionUsd: z.number().min(0).max(500).optional(),
      reset: z.boolean().optional(),
    }).parse(d),
  )
  .handler(async ({ data, context }): Promise<PaperAccount> => {
    await readAccount(context.supabase, context.userId); // ensure row exists
    const patch: Record<string, unknown> = {};
    if (data.autoBuy !== undefined) patch.auto_buy = data.autoBuy;
    if (data.autoBuyContracts !== undefined) patch.auto_buy_contracts = data.autoBuyContracts;
    if (data.maxAskCents !== undefined) patch.auto_buy_max_ask_cents = data.maxAskCents;
    if (data.minConf !== undefined) patch.auto_buy_min_conf = data.minConf;
    if (data.minCushionUsd !== undefined) patch.auto_buy_min_cushion_usd = data.minCushionUsd;
    if (Object.keys(patch).length) {
      await context.supabase
        .from("paper_kalshi_account")
        .update(patch)
        .eq("user_id", context.userId);
    }
    if (data.reset) {
      // Wipe the paper book and start again from $10,000.
      await context.supabase.from("paper_kalshi_events").delete().eq("user_id", context.userId);
      await context.supabase.from("paper_kalshi_positions").delete().eq("user_id", context.userId);
      await context.supabase
        .from("paper_kalshi_account")
        .update({ starting_cents: PAPER_STARTING_CENTS, cash_cents: PAPER_STARTING_CENTS })
        .eq("user_id", context.userId);
    }
    return readAccount(context.supabase, context.userId);
  });

export interface PaperEquityPoint {
  t: string;
  equityCents: number;
  pnlCents: number;
  label: string;
}

/** Polymarket-style equity curve: $10,000 start + cumulative realized P/L. */
export const getPaperKalshiEquityCurve = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { limit?: number } | undefined) => d ?? {})
  .handler(async ({ context, data }): Promise<{ points: PaperEquityPoint[]; account: PaperAccount }> => {
    const limit = Math.min(Math.max(data.limit ?? 300, 10), 1000);
    const account = await readAccount(context.supabase, context.userId);

    const { data: rows } = await context.supabase
      .from("paper_kalshi_positions")
      .select("ticker, pnl_cents, settled_at, exited_at, created_at, status")
      .eq("user_id", context.userId)
      .in("status", ["closed", "settled"])
      .order("created_at", { ascending: true })
      .limit(limit);

    const closed = ((rows ?? []) as any[])
      .map((r) => ({
        t: r.settled_at ?? r.exited_at ?? r.created_at,
        pnl: r.pnl_cents ?? 0,
        ticker: r.ticker as string,
      }))
      .sort((a, b) => new Date(a.t).getTime() - new Date(b.t).getTime());

    const points: PaperEquityPoint[] = [
      { t: closed[0]?.t ?? new Date().toISOString(), equityCents: account.startingCents, pnlCents: 0, label: "start" },
    ];
    let run = account.startingCents;
    for (const cl of closed) {
      run += cl.pnl;
      points.push({ t: cl.t, equityCents: Math.round(run), pnlCents: cl.pnl, label: cl.ticker });
    }
    return { points, account };
  });

export interface PaperAutoBuyResult {
  ok: boolean;
  fired: boolean;
  reason: string;
  ticker: string | null;
  side: PaperSide | null;
  askCents: number | null;
  contracts: number | null;
}

/**
 * Auto-buy: fires ONE paper entry per window when every requirement is met.
 *   • auto-buy enabled on the paper account
 *   • T−8m … T−2m (no late chases, no pre-study entries)
 *   • model and study agree on a side
 *   • study confidence ≥ minConf
 *   • |cushion| ≥ minCushionUsd and cushion favours the picked side
 *   • ask ≤ maxAskCents and enough paper cash
 *   • no existing position on this ticker
 */
export const paperKalshiAutoBuyTick = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<PaperAutoBuyResult> => {
    const none = (reason: string, extra: Partial<PaperAutoBuyResult> = {}): PaperAutoBuyResult => ({
      ok: true, fired: false, reason, ticker: null, side: null, askCents: null, contracts: null, ...extra,
    });

    const account = await readAccount(context.supabase, context.userId);
    if (!account.autoBuy) return none("auto-buy off");

    const w = await loadWindow();
    if (!w.ok || !w.ticker || !w.closeTime) return none(w.error ?? "no live market");

    const stc = w.secondsToClose ?? 0;
    if (stc > 480) return none(`waiting for study window (T−${Math.round(stc / 60)}m)`, { ticker: w.ticker });
    if (stc < 120) return none("too late in window (<T−2m)", { ticker: w.ticker });

    const side = w.study.side ?? w.model.side;
    if (!side) return none("no signal side", { ticker: w.ticker });
    if (w.model.side && w.study.side && w.model.side !== w.study.side) {
      return none("model/study disagree", { ticker: w.ticker });
    }

    const conf = w.study.confidence ?? w.model.confidence ?? 0;
    if (conf < account.minConf) {
      return none(`confidence ${(conf * 100).toFixed(0)}% < ${(account.minConf * 100).toFixed(0)}%`, { ticker: w.ticker, side });
    }

    const cushion = w.cushionUsd;
    if (cushion == null || Math.abs(cushion) < account.minCushionUsd) {
      return none(`cushion $${cushion == null ? "—" : Math.abs(cushion).toFixed(0)} < $${account.minCushionUsd}`, { ticker: w.ticker, side });
    }
    if (w.spotSide !== side) return none("cushion is against the pick", { ticker: w.ticker, side });

    const ask = side === "YES" ? w.up.askCents : w.down.askCents;
    if (ask == null || ask < 1 || ask > 99) return none("no tradeable ask", { ticker: w.ticker, side });
    if (ask > account.maxAskCents) {
      return none(`ask ${ask}¢ > cap ${account.maxAskCents}¢`, { ticker: w.ticker, side, askCents: ask });
    }

    const { data: existing } = await context.supabase
      .from("paper_kalshi_positions")
      .select("id")
      .eq("user_id", context.userId)
      .eq("ticker", w.ticker)
      .limit(1);
    if ((existing ?? []).length) return none("already traded this window", { ticker: w.ticker, side });

    const contracts = account.autoBuyContracts;
    const cost = ask * contracts;
    if (cost > account.cashCents) {
      return none(`not enough paper cash ($${(account.cashCents / 100).toFixed(2)})`, { ticker: w.ticker, side, askCents: ask });
    }

    const { data: row, error } = await context.supabase
      .from("paper_kalshi_positions")
      .insert({
        user_id: context.userId,
        ticker: w.ticker,
        close_time: w.closeTime,
        strike: w.strike,
        entry_side: side,
        entry_contracts: contracts,
        entry_price_cents: ask,
        entry_spot: w.spot,
        entry_seconds_left: w.secondsToClose,
        entry_reason: `auto-buy conf ${(conf * 100).toFixed(0)}% cushion $${cushion.toFixed(0)}`,
        auto_hedge: true,
        status: "open",
      })
      .select("id")
      .single();
    if (error) return { ...none(error.message), ok: false };

    await logEvent(context.supabase, context.userId, {
      positionId: row.id as string,
      ticker: w.ticker,
      kind: "entry",
      side,
      contracts,
      priceCents: ask,
      cashCents: -cost,
      spot: w.spot,
      strike: w.strike,
      secondsLeft: w.secondsToClose,
      note: `AUTO-BUY ${side} @ ${ask}¢ · conf ${(conf * 100).toFixed(0)}% · cushion $${cushion.toFixed(0)}`,
      auto: true,
    });

    return { ok: true, fired: true, reason: "auto-buy filled", ticker: w.ticker, side, askCents: ask, contracts };
  });
