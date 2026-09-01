// Own Model engine loop — server side. Paper by default, disarmed by default.
// Reads Kalshi read-only; every fill lands in own_engine_orders and every
// refusal in own_engine_skips.
import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { z } from "zod";
import { getKalshiImpliedSpot } from "@/lib/kalshiImpliedSpot.functions";
import { feeCents } from "@/lib/opsManual/hedgeEngine";
import {
  OWN_RULES, OWN_MODEL_VERSION, probUp, realizedVol1m, driftUsdPerMin,
  decideEntry, decideExit, sizeContracts,
  blendWithSignals,
  type OwnRules, type OwnSide, type OwnSignals, type BookState, type EntryDecision, type ProbResult,
} from "@/lib/ownModel/ownModel";

export interface OwnEngineSettings extends OwnRules {
  armed: boolean;
  paper: boolean;
  bankrollCents: number;
}

export interface OwnEngineOrder {
  id: string;
  ticker: string;
  close_time: string | null;
  strike: number | null;
  side: OwnSide;
  contracts: number;
  price_cents: number;
  phase: string;
  model_prob: number | null;
  edge_cents: number | null;
  z_score: number | null;
  cushion_usd: number | null;
  seconds_left: number | null;
  paper: boolean;
  status: "open" | "closed" | "settled";
  exit_price_cents: number | null;
  exit_reason: string | null;
  pnl_cents: number | null;
  outcome: string | null;
  created_at: string;
}

export interface OwnEngineSkip {
  id: string;
  ticker: string | null;
  code: string;
  reason: string | null;
  created_at: string;
}

export interface OwnEngineState {
  ok: boolean;
  error: string | null;
  version: string;
  asOf: string;
  ticker: string | null;
  strike: number | null;
  spot: number | null;
  cushionUsd: number | null;
  secondsLeft: number | null;
  up: { bidCents: number | null; askCents: number | null };
  down: { bidCents: number | null; askCents: number | null };
  vol1m: number;
  driftUsdPerMin: number;
  expectedMoveUsd: number | null;
  probUp: number | null;
  z: number | null;
  /** What the engine would do right now, and the contract count. */
  decision: EntryDecision | null;
  signals: OwnSignals;
  settings: OwnEngineSettings;
  equity: { bankrollCents: number; realizedCents: number; exposureCents: number; cashCents: number };
}

const DEFAULTS = { armed: false, paper: true, bankrollCents: 1_000_000 };

const rowToSettings = (r: any): OwnEngineSettings => ({
  armed: !!r.armed,
  paper: r.paper !== false,
  bankrollCents: Number(r.bankroll_cents ?? DEFAULTS.bankrollCents),
  minEdgeCents: Number(r.min_edge_cents ?? OWN_RULES.minEdgeCents),
  minPriceCents: Number(r.min_price_cents ?? OWN_RULES.minPriceCents),
  maxPriceCents: Number(r.max_price_cents ?? OWN_RULES.maxPriceCents),
  lateBlockSeconds: Number(r.late_block_seconds ?? OWN_RULES.lateBlockSeconds),
  lateCushionUsd: Number(r.late_cushion_usd ?? OWN_RULES.lateCushionUsd),
  maxPairCostCents: Number(r.max_pair_cost_cents ?? OWN_RULES.maxPairCostCents),
  dominanceBlockCents: Number(r.dominance_block_cents ?? OWN_RULES.dominanceBlockCents),
  perSideWindowCapUsd: Number(r.per_side_window_cap_usd ?? OWN_RULES.perSideWindowCapUsd),
  perWindowCapUsd: Number(r.per_window_cap_usd ?? OWN_RULES.perWindowCapUsd),
  riskPerTradePct: Number(r.risk_per_trade_pct ?? OWN_RULES.riskPerTradePct),
  stackFraction: Number(r.stack_fraction ?? OWN_RULES.stackFraction),
  stackGainCents: Number(r.stack_gain_cents ?? OWN_RULES.stackGainCents),
  exitCapturePct: Number(r.exit_capture_pct ?? OWN_RULES.exitCapturePct),
  stopLossFraction: Number(r.stop_loss_fraction ?? OWN_RULES.stopLossFraction),
  requireSignalAgreement: r.require_signal_agreement !== false,
  verdictVeto: r.verdict_veto !== false,
  blendStudy: r.blend_study !== false,
  studyWeight: Number(r.study_weight ?? OWN_RULES.studyWeight),
  minStudyConf: Number(r.min_study_conf ?? OWN_RULES.minStudyConf),
});

async function loadSettings(supabase: any, userId: string): Promise<OwnEngineSettings> {
  const { data } = await supabase.from("own_engine_settings").select("*").eq("user_id", userId).maybeSingle();
  if (data) return rowToSettings(data);
  await supabase.from("own_engine_settings").insert({ user_id: userId }).select("user_id");
  return { ...OWN_RULES, ...DEFAULTS };
}

const cents = (d: number | null | undefined) =>
  d == null || !Number.isFinite(d) ? null : Math.round(d * 100);

interface Quote {
  ok: boolean;
  error: string | null;
  ticker: string | null;
  strike: number | null;
  closeTime: string | null;
  secondsLeft: number | null;
  spot: number | null;
  cushionUsd: number | null;
  up: { bidCents: number | null; askCents: number | null };
  down: { bidCents: number | null; askCents: number | null };
  signals: OwnSignals;
}

const EMPTY_SIGNALS: OwnSignals = {
  modelSide: null, modelConf: null, studySide: null, studyConf: null, verdict: null,
};

async function loadQuote(): Promise<Quote> {
  const empty: Quote = {
    ok: false, error: null, ticker: null, strike: null, closeTime: null, secondsLeft: null,
    spot: null, cushionUsd: null,
    up: { bidCents: null, askCents: null }, down: { bidCents: null, askCents: null },
    signals: EMPTY_SIGNALS,
  };
  const { getBtcConsensus } = await import("@/lib/btcConsensus.server");
  const [kRes, cRes] = await Promise.allSettled([getKalshiImpliedSpot(), getBtcConsensus()]);
  const k = kRes.status === "fulfilled" ? kRes.value : null;
  const con = cRes.status === "fulfilled" ? cRes.value : null;
  if (!k?.ok || !k.ticker || k.strike == null) {
    return { ...empty, error: k?.error ?? "no live kalshi 15m market" };
  }
  const yesBid = cents(k.yesBid);
  const yesAsk = cents(k.yesAsk);
  const stc = k.secondsToClose ?? null;
  const spot = con?.spot ?? null;
  return {
    ok: true,
    error: null,
    ticker: k.ticker,
    strike: k.strike,
    closeTime: stc != null ? new Date(Date.now() + stc * 1000).toISOString() : null,
    secondsLeft: stc,
    spot,
    cushionUsd: spot != null ? Number((spot - k.strike).toFixed(2)) : null,
    up: { bidCents: yesBid, askCents: yesAsk },
    down: { bidCents: yesAsk == null ? null : 100 - yesAsk, askCents: yesBid == null ? null : 100 - yesBid },
    signals: {
      modelSide: (con?.model.side ?? null) as OwnSide | null,
      modelConf: con?.model.confidence ?? null,
      studySide: (con?.study.side ?? null) as OwnSide | null,
      studyConf: con?.study.confidence ?? null,
      verdict: (con?.verdict ?? null) as OwnSignals["verdict"],
    },
  };
}

/** Realized vol + drift from the cached 1m candles. */
async function loadVol(supabase: any): Promise<{ vol1m: number; drift: number }> {
  const { data } = await supabase
    .from("btc_candles")
    .select("c,bucket_start")
    .eq("tf", "1m")
    .order("bucket_start", { ascending: false })
    .limit(60);
  const closes = ((data ?? []) as Array<{ c: number }>).map((r) => Number(r.c)).reverse();
  return { vol1m: realizedVol1m(closes), drift: driftUsdPerMin(closes) };
}

async function loadBook(supabase: any, userId: string, ticker: string, q: Quote) {
  const { data } = await supabase
    .from("own_engine_orders")
    .select("*")
    .eq("user_id", userId)
    .eq("ticker", ticker)
    .order("created_at", { ascending: true });
  const rows = (data ?? []) as OwnEngineOrder[];
  const open = rows.filter((r) => r.status === "open");
  const agg = (side: OwnSide) => {
    const legs = open.filter((r) => r.side === side);
    const n = legs.reduce((s, r) => s + r.contracts, 0);
    if (!n) return null;
    const cost = legs.reduce((s, r) => s + r.contracts * r.price_cents, 0);
    return { contracts: n, avgCostCents: cost / n };
  };
  const spent = (side: OwnSide) =>
    rows.filter((r) => r.side === side).reduce((s, r) => s + (r.contracts * r.price_cents) / 100, 0);
  const openYes = agg("YES");
  const openNo = agg("NO");
  const bids: number[] = [];
  if (openYes && q.up.bidCents != null) bids.push(q.up.bidCents);
  if (openNo && q.down.bidCents != null) bids.push(q.down.bidCents);
  const book: BookState = {
    spentYesUsd: spent("YES"),
    spentNoUsd: spent("NO"),
    heldSideBestBidCents: bids.length ? Math.max(...bids) : null,
    stackedYes: rows.some((r) => r.phase === "stack" && r.side === "YES"),
    stackedNo: rows.some((r) => r.phase === "stack" && r.side === "NO"),
    openYes,
    openNo,
  };
  return { book, rows, open };
}

async function loadEquity(supabase: any, userId: string, bankrollCents: number) {
  const { data } = await supabase
    .from("own_engine_orders")
    .select("contracts, price_cents, pnl_cents, status")
    .eq("user_id", userId)
    .limit(2000);
  const rows = (data ?? []) as Array<{ contracts: number; price_cents: number; pnl_cents: number | null; status: string }>;
  const realized = rows.reduce((s, r) => s + (r.status === "open" ? 0 : r.pnl_cents ?? 0), 0);
  const exposure = rows.filter((r) => r.status === "open").reduce((s, r) => s + r.contracts * r.price_cents, 0);
  return {
    bankrollCents,
    realizedCents: realized,
    exposureCents: exposure,
    cashCents: bankrollCents + realized - exposure,
  };
}

function buildProb(q: Quote, vol1m: number, drift: number): ProbResult | null {
  if (q.spot == null || q.cushionUsd == null || q.secondsLeft == null) return null;
  return probUp({
    cushionUsd: q.cushionUsd,
    secondsLeft: q.secondsLeft,
    vol1m,
    spotUsd: q.spot,
    driftUsdPerMin: drift,
  });
}

/** Live state + the exact decision (and contract count) for right now. */
export const getOwnEngineState = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<OwnEngineState> => {
    const { supabase, userId } = context;
    const settings = await loadSettings(supabase, userId);
    const [q, v] = await Promise.all([loadQuote(), loadVol(supabase)]);
    const equity = await loadEquity(supabase, userId, settings.bankrollCents);
    const prob = buildProb(q, v.vol1m, v.drift);

    let decision: EntryDecision | null = null;
    if (q.ok && q.ticker && prob) {
      const { book } = await loadBook(supabase, userId, q.ticker, q);
      decision = decideEntry(
        {
          askUpCents: q.up.askCents, bidUpCents: q.up.bidCents,
          askDownCents: q.down.askCents, bidDownCents: q.down.bidCents,
          secondsLeft: q.secondsLeft ?? 0,
          cushionUsd: q.cushionUsd ?? 0,
          feeCentsPerContract: feeCents(q.up.askCents ?? 50),
        },
        prob, book, settings, settings.bankrollCents, Math.max(0, equity.cashCents), q.signals,
      );
    }

    return {
      ok: q.ok,
      error: q.error,
      version: OWN_MODEL_VERSION,
      asOf: new Date().toISOString(),
      ticker: q.ticker,
      strike: q.strike,
      spot: q.spot,
      cushionUsd: q.cushionUsd,
      secondsLeft: q.secondsLeft,
      up: q.up,
      down: q.down,
      vol1m: v.vol1m,
      driftUsdPerMin: v.drift,
      expectedMoveUsd: prob?.expectedMoveUsd ?? null,
      probUp: prob?.probUp ?? null,
      z: prob?.z ?? null,
      decision,
      signals: q.signals,
      settings,
      equity,
    };
  });

const settingsSchema = z.object({
  armed: z.boolean().optional(),
  paper: z.boolean().optional(),
  bankrollCents: z.number().int().min(10_000).max(100_000_000).optional(),
  minEdgeCents: z.number().int().min(0).max(50).optional(),
  minPriceCents: z.number().int().min(1).max(99).optional(),
  maxPriceCents: z.number().int().min(1).max(99).optional(),
  riskPerTradePct: z.number().min(0.1).max(10).optional(),
  perSideWindowCapUsd: z.number().min(10).max(100_000).optional(),
  perWindowCapUsd: z.number().min(10).max(500_000).optional(),
  exitCapturePct: z.number().int().min(50).max(100).optional(),
});

export const saveOwnEngineSettings = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => settingsSchema.parse(d))
  .handler(async ({ data, context }) => {
    const patch: Record<string, unknown> = { user_id: context.userId };
    if (data.armed !== undefined) patch.armed = data.armed;
    if (data.paper !== undefined) patch.paper = data.paper;
    if (data.bankrollCents !== undefined) patch.bankroll_cents = data.bankrollCents;
    if (data.minEdgeCents !== undefined) patch.min_edge_cents = data.minEdgeCents;
    if (data.minPriceCents !== undefined) patch.min_price_cents = data.minPriceCents;
    if (data.maxPriceCents !== undefined) patch.max_price_cents = data.maxPriceCents;
    if (data.riskPerTradePct !== undefined) patch.risk_per_trade_pct = data.riskPerTradePct;
    if (data.perSideWindowCapUsd !== undefined) patch.per_side_window_cap_usd = data.perSideWindowCapUsd;
    if (data.perWindowCapUsd !== undefined) patch.per_window_cap_usd = data.perWindowCapUsd;
    if (data.exitCapturePct !== undefined) patch.exit_capture_pct = data.exitCapturePct;
    const { error } = await context.supabase
      .from("own_engine_settings")
      .upsert(patch as never, { onConflict: "user_id" });
    if (error) return { ok: false as const, error: error.message };
    return { ok: true as const };
  });

async function logSkip(
  supabase: any, userId: string, ticker: string | null,
  code: string, reason: string, snapshot: Record<string, unknown>,
) {
  try {
    await supabase.from("own_engine_skips").insert({ user_id: userId, ticker, code, reason, snapshot });
  } catch { /* never break the loop */ }
}

/**
 * One engine pass: settle finished windows, sweep exits, then evaluate entry.
 * Paper mode simulates fills at the live ask/bid. Live mode is refused until
 * the user's own exchange credentials are wired server-side.
 */
export const ownEngineTick = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { supabase, userId } = context;
    const settings = await loadSettings(supabase, userId);
    const [q, v] = await Promise.all([loadQuote(), loadVol(supabase)]);
    const settled = await settleDueOrders(supabase, userId);

    if (!q.ok || !q.ticker) {
      return { ok: false as const, error: q.error ?? "no market", settled, exits: 0, fills: [] as string[] };
    }
    const prob = buildProb(q, v.vol1m, v.drift);
    if (!prob) return { ok: false as const, error: "no spot", settled, exits: 0, fills: [] as string[] };

    const { book, open } = await loadBook(supabase, userId, q.ticker, q);

    /* ---- exits ---- */
    let exits = 0;
    for (const o of open) {
      const bid = o.side === "YES" ? q.up.bidCents : q.down.bidCents;
      const d = decideExit(
        { side: o.side, avgCostCents: o.price_cents, phase: o.phase },
        { bidCents: bid },
        prob, settings,
      );
      if (!d.exit || bid == null) continue;
      const pnl = Math.round((bid - o.price_cents) * o.contracts);
      const { error } = await supabase
        .from("own_engine_orders")
        .update({
          status: "closed", exit_price_cents: bid, exit_reason: d.reason,
          pnl_cents: pnl, closed_at: new Date().toISOString(),
        })
        .eq("id", o.id).eq("user_id", userId);
      if (!error) exits++;
    }

    /* ---- entry ---- */
    const equity = await loadEquity(supabase, userId, settings.bankrollCents);
    const market = {
      askUpCents: q.up.askCents, bidUpCents: q.up.bidCents,
      askDownCents: q.down.askCents, bidDownCents: q.down.bidCents,
      secondsLeft: q.secondsLeft ?? 0,
      cushionUsd: q.cushionUsd ?? 0,
      feeCentsPerContract: feeCents(q.up.askCents ?? 50),
    };
    const decision = decideEntry(market, prob, book, settings, settings.bankrollCents, Math.max(0, equity.cashCents), q.signals);
    const snapshot = {
      ticker: q.ticker, strike: q.strike, spot: q.spot, cushionUsd: q.cushionUsd,
      secondsLeft: q.secondsLeft, up: q.up, down: q.down,
      probUp: prob.probUp, z: prob.z, signals: q.signals, vol1m: v.vol1m, drift: v.drift, version: OWN_MODEL_VERSION,
    };

    const fills: string[] = [];
    if (!settings.armed) {
      return { ok: true as const, armed: false, settled, exits, decision, fills };
    }
    if (!settings.paper) {
      await logSkip(supabase, userId, q.ticker, "LIVE_NOT_CONFIGURED", "live mode needs your own exchange credentials", snapshot);
      return { ok: true as const, armed: true, settled, exits, decision, fills };
    }

    const insert = async (side: OwnSide, contracts: number, priceCents: number, phase: string, edge: number | null) => {
      const { error } = await supabase.from("own_engine_orders").insert({
        user_id: userId,
        ticker: q.ticker as string,
        close_time: q.closeTime,
        strike: q.strike,
        side, contracts, price_cents: priceCents, phase,
        model_prob: prob.probUp,
        edge_cents: edge,
        z_score: prob.z,
        cushion_usd: q.cushionUsd,
        spot: q.spot,
        seconds_left: q.secondsLeft,
        paper: true,
        status: "open",
      });
      if (!error) fills.push(`${phase} ${side} ${contracts} @ ${priceCents}¢`);
    };

    if (decision.action === "PAIR_LOCK" && decision.pair) {
      await insert("YES", decision.pair.contracts, decision.pair.upCents, "pair_lock", null);
      await insert("NO", decision.pair.contracts, decision.pair.downCents, "pair_lock", null);
    } else if (
      (decision.action === "DIRECTIONAL" || decision.action === "STACK") &&
      decision.side && decision.contracts && decision.priceCents
    ) {
      await insert(
        decision.side, decision.contracts, decision.priceCents,
        decision.action === "STACK" ? "stack" : "directional",
        decision.edgeCents ?? null,
      );
    } else if (decision.action === "SKIP" && decision.code && decision.code !== "NO_SIGNAL") {
      await logSkip(supabase, userId, q.ticker, decision.code, decision.reason, snapshot);
    }

    return { ok: true as const, armed: true, settled, exits, decision, fills };
  });

/** Settle open/closed orders whose window has finished, from Kalshi's result. */
async function settleDueOrders(supabase: any, userId: string): Promise<number> {
  const { data } = await supabase
    .from("own_engine_orders")
    .select("id, ticker, side, contracts, price_cents")
    .eq("user_id", userId)
    .eq("status", "open")
    .lt("close_time", new Date().toISOString())
    .limit(50);
  const due = (data ?? []) as Array<{ id: string; ticker: string; side: OwnSide; contracts: number; price_cents: number }>;
  if (!due.length) return 0;
  const { fetchKalshiSettlement } = await import("@/lib/kalshiSettle");
  const results = new Map<string, "YES" | "NO">();
  let n = 0;
  for (const o of due) {
    let outcome = results.get(o.ticker);
    if (!outcome) {
      const k = await fetchKalshiSettlement(o.ticker).catch(() => null);
      if (!k?.finalized || !k.result) continue;
      outcome = k.result === "yes" ? "YES" : "NO";
      results.set(o.ticker, outcome);
    }
    const pnl = Math.round((o.side === outcome ? 100 - o.price_cents : -o.price_cents) * o.contracts);
    const { error } = await supabase
      .from("own_engine_orders")
      .update({ status: "settled", outcome, pnl_cents: pnl, closed_at: new Date().toISOString() })
      .eq("id", o.id).eq("user_id", userId);
    if (!error) n++;
  }
  return n;
}

export const listOwnEngineOrders = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { limit?: number } | undefined) => d ?? {})
  .handler(async ({ context, data }): Promise<OwnEngineOrder[]> => {
    const { data: rows } = await context.supabase
      .from("own_engine_orders").select("*")
      .eq("user_id", context.userId)
      .order("created_at", { ascending: false })
      .limit(Math.min(Math.max(data.limit ?? 50, 1), 200));
    return (rows ?? []) as OwnEngineOrder[];
  });

export const listOwnEngineSkips = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { limit?: number } | undefined) => d ?? {})
  .handler(async ({ context, data }): Promise<OwnEngineSkip[]> => {
    const { data: rows } = await context.supabase
      .from("own_engine_skips").select("id, ticker, code, reason, created_at")
      .eq("user_id", context.userId)
      .order("created_at", { ascending: false })
      .limit(Math.min(Math.max(data.limit ?? 50, 1), 200));
    return (rows ?? []) as OwnEngineSkip[];
  });

/** Contract-count helper the panel shows: how many we'd buy at a given price. */
export const ownEngineSizeQuote = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({ priceCents: z.number().int().min(1).max(99) }).parse(d))
  .handler(async ({ data, context }) => {
    const settings = await loadSettings(context.supabase, context.userId);
    const equity = await loadEquity(context.supabase, context.userId, settings.bankrollCents);
    const contracts = sizeContracts(
      settings.bankrollCents, settings.riskPerTradePct, data.priceCents,
      settings.perSideWindowCapUsd, 0, Math.max(0, equity.cashCents),
    );
    return { contracts, costCents: contracts * data.priceCents, priceCents: data.priceCents };
  });
