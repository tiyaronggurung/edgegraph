// BTC 15m Cross-Exit / Late-Flip shadow engine.
//
// Read-only w.r.t. live trading. This module:
//   1) Detects the first post-entry strike cross from dense snapshots.
//   2) Recommends: exit the original position at bid; if cross lands inside T-3m
//      and opposite-side ask <= 40c, also buy the opposite side (flip).
//   3) Grades hold vs exit vs exit+flip PnL once the window settles.
//
// Two entry sources:
//   - simulated_t5: hypothetical market-leader entry at T-5m.
//   - ops_trade: an actual row in ops_trades.

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type SB = any;

export const CROSS_EXIT_RULES = {
  // Fire the hypothetical entry at T-5m.
  T5_SECONDS_TO_CLOSE: 5 * 60,
  // Flip only when cross happens with <= 3m left and the opposite side is cheap.
  FLIP_TIME_CUTOFF_SECONDS: 3 * 60,
  MAX_FLIP_ASK_CENTS: 40,
} as const;

export type CrossExitSource = "simulated_t5" | "ops_trade";

export interface CrossExitEntry {
  ticker: string;
  closeTime: string;
  source: CrossExitSource;
  tradeId?: string | null;
  entrySide: "YES" | "NO";
  entryTime: string;
  entrySecondsToClose: number | null;
  entrySpot: number | null;
  entryPriceCents: number;
  entryBidCents: number | null;
  strike: number;
}

export interface CrossExitSnapshot {
  capturedAt: string;
  secondsToClose: number;
  spotUsd: number | null;
  yesBidCents: number | null;
  yesAskCents: number | null;
  noBidCents: number | null;
  noAskCents: number | null;
}

export interface CrossEvalResult {
  crossDetected: boolean;
  crossTime: string | null;
  crossSecondsToClose: number | null;
  crossSpot: number | null;
  crossCushionUsd: number | null;
  exitBidCents: number | null;
  wouldExit: boolean;
  exitReason: string | null;
  flipSide: "YES" | "NO" | null;
  flipAskCents: number | null;
  wouldFlip: boolean;
  flipReason: string | null;
}

export interface PnlGrading {
  settled: boolean;
  outcome: "YES" | "NO" | null;
  holdPnlCents: number | null;
  exitPnlCents: number | null;
  flipPnlCents: number | null;
  combinedPnlCents: number | null;
}

function num(v: unknown): number | null {
  if (v == null) return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

function sidePrice(side: "YES" | "NO", snap: Pick<CrossExitSnapshot, "yesAskCents" | "noAskCents">): number | null {
  if (side === "YES") return snap.yesAskCents;
  return snap.noAskCents;
}

function sideBid(side: "YES" | "NO", snap: Pick<CrossExitSnapshot, "yesBidCents" | "noBidCents">): number | null {
  if (side === "YES") return snap.yesBidCents;
  return snap.noBidCents;
}

function oppositeSide(side: "YES" | "NO"): "YES" | "NO" {
  return side === "YES" ? "NO" : "YES";
}

/** Market leader at the snapshot = side with the higher ask (favorite). */
export function leaderSide(snap: CrossExitSnapshot): "YES" | "NO" | null {
  const yes = snap.yesAskCents;
  const no = snap.noAskCents;
  if (yes == null || no == null) return null;
  if (yes > no) return "YES";
  if (no > yes) return "NO";
  return null;
}

/** Build a snapshot from a btc_window_snapshots row. */
export function rowToSnapshot(row: Record<string, unknown>): CrossExitSnapshot {
  const yesBid = num(row.yes_bid_cents);
  const yesAsk = num(row.yes_ask_cents);
  return {
    capturedAt: String(row.captured_at ?? row.created_at ?? ""),
    secondsToClose: Math.max(0, Math.round(num(row.seconds_to_close) ?? 0)),
    spotUsd: num(row.spot_usd),
    yesBidCents: yesBid,
    yesAskCents: yesAsk,
    noBidCents: yesAsk == null ? null : 100 - yesAsk,
    noAskCents: yesBid == null ? null : 100 - yesBid,
  };
}

/** Does the given snapshot represent a strike cross relative to the entry spot? */
function isCross(entry: CrossExitEntry, snap: CrossExitSnapshot): boolean {
  const strike = entry.strike;
  const entrySpot = entry.entrySpot;
  const spot = snap.spotUsd;
  if (spot == null || strike == null) return false;
  if (entrySpot == null) return false;
  const wasAbove = entrySpot > strike;
  const isAbove = spot > strike;
  if (wasAbove && !isAbove) return true;
  if (!wasAbove && isAbove) return true;
  return false;
}

/** Evaluate the cross-exit/flip decision for a single current snapshot. */
export function evaluateCrossExit(entry: CrossExitEntry, snap: CrossExitSnapshot): CrossEvalResult {
  const crossDetected = isCross(entry, snap);

  if (!crossDetected) {
    return {
      crossDetected: false,
      crossTime: null,
      crossSecondsToClose: null,
      crossSpot: null,
      crossCushionUsd: null,
      exitBidCents: null,
      wouldExit: false,
      exitReason: null,
      flipSide: null,
      flipAskCents: null,
      wouldFlip: false,
      flipReason: null,
    };
  }

  const exitBid = sideBid(entry.entrySide, snap);
  const flipSide = oppositeSide(entry.entrySide);
  const flipAsk = sidePrice(flipSide, snap);
  const crossCushion = snap.spotUsd != null ? Math.abs(snap.spotUsd - entry.strike) : null;

  const wouldExit = exitBid != null;
  const exitReason = wouldExit ? "spot_crossed_strike" : "cross_detected_no_bid";

  const wouldFlip =
    wouldExit &&
    flipAsk != null &&
    flipAsk <= CROSS_EXIT_RULES.MAX_FLIP_ASK_CENTS &&
    snap.secondsToClose <= CROSS_EXIT_RULES.FLIP_TIME_CUTOFF_SECONDS;

  const flipReason = !wouldExit
    ? null
    : snap.secondsToClose > CROSS_EXIT_RULES.FLIP_TIME_CUTOFF_SECONDS
      ? "cross_after_t3"
      : flipAsk == null
        ? "no_opposite_ask"
        : flipAsk > CROSS_EXIT_RULES.MAX_FLIP_ASK_CENTS
          ? "opposite_ask_too_high"
          : "flip_allowed";

  return {
    crossDetected: true,
    crossTime: snap.capturedAt,
    crossSecondsToClose: snap.secondsToClose,
    crossSpot: snap.spotUsd,
    crossCushionUsd: crossCushion,
    exitBidCents: exitBid,
    wouldExit,
    exitReason,
    flipSide,
    flipAskCents: flipAsk,
    wouldFlip,
    flipReason,
  };
}

/** Find the first snapshot after entry where the spot crosses the strike. */
export function findFirstCross(entry: CrossExitEntry, snapshots: CrossExitSnapshot[]): CrossEvalResult {
  const afterEntry = snapshots
    .filter((s) => new Date(s.capturedAt) > new Date(entry.entryTime))
    .sort((a, b) => new Date(a.capturedAt).getTime() - new Date(b.capturedAt).getTime());

  for (const snap of afterEntry) {
    const r = evaluateCrossExit(entry, snap);
    if (r.crossDetected) return r;
  }

  return {
    crossDetected: false,
    crossTime: null,
    crossSecondsToClose: null,
    crossSpot: null,
    crossCushionUsd: null,
    exitBidCents: null,
    wouldExit: false,
    exitReason: null,
    flipSide: null,
    flipAskCents: null,
    wouldFlip: false,
    flipReason: null,
  };
}

/** Grade PnL once the window outcome is known. */
export function gradePnl(entry: CrossExitEntry, cross: CrossEvalResult, outcome: "YES" | "NO" | null): PnlGrading {
  if (!outcome) {
    return {
      settled: false,
      outcome: null,
      holdPnlCents: null,
      exitPnlCents: null,
      flipPnlCents: null,
      combinedPnlCents: null,
    };
  }

  const hold = outcome === entry.entrySide ? 100 - entry.entryPriceCents : -entry.entryPriceCents;

  let exit: number | null = null;
  if (cross.wouldExit && cross.exitBidCents != null) {
    exit = cross.exitBidCents - entry.entryPriceCents;
  }

  let flip: number | null = null;
  let combined: number | null = null;
  if (cross.wouldFlip && exit != null && cross.flipSide && cross.flipAskCents != null) {
    flip = outcome === cross.flipSide ? 100 - cross.flipAskCents : -cross.flipAskCents;
    combined = exit + flip;
  }

  return {
    settled: true,
    outcome,
    holdPnlCents: hold,
    exitPnlCents: exit,
    flipPnlCents: flip,
    combinedPnlCents: combined,
  };
}

/** Build a simulated T-5m market-leader entry from a snapshot row. */
export function buildSimulatedT5Entry(
  ticker: string,
  closeTime: string,
  strike: number,
  snap: CrossExitSnapshot,
): CrossExitEntry | null {
  const side = leaderSide(snap);
  if (!side) return null;
  const price = sidePrice(side, snap);
  const bid = sideBid(side, snap);
  if (price == null) return null;
  return {
    ticker,
    closeTime,
    source: "simulated_t5",
    tradeId: null,
    entrySide: side,
    entryTime: snap.capturedAt,
    entrySecondsToClose: snap.secondsToClose,
    entrySpot: snap.spotUsd,
    entryPriceCents: price,
    entryBidCents: bid,
    strike,
  };
}

// ---------------------------------------------------------------------------
// Database helpers
// ---------------------------------------------------------------------------

function entryToInsert(entry: CrossExitEntry, cross: CrossEvalResult, pnl?: PnlGrading) {
  return {
    ticker: entry.ticker,
    close_time: entry.closeTime,
    source: entry.source,
    trade_id: entry.tradeId,
    entry_side: entry.entrySide,
    entry_time: entry.entryTime,
    entry_seconds_to_close: entry.entrySecondsToClose,
    entry_spot: entry.entrySpot,
    entry_price_cents: entry.entryPriceCents,
    entry_bid_cents: entry.entryBidCents,
    strike: entry.strike,
    cross_detected: cross.crossDetected,
    cross_time: cross.crossTime,
    cross_seconds_to_close: cross.crossSecondsToClose,
    cross_spot: cross.crossSpot,
    cross_cushion_usd: cross.crossCushionUsd,
    exit_bid_cents: cross.exitBidCents,
    would_exit: cross.wouldExit,
    exit_reason: cross.exitReason,
    flip_side: cross.flipSide,
    flip_ask_cents: cross.flipAskCents,
    would_flip: cross.wouldFlip,
    flip_reason: cross.flipReason,
    max_flip_ask_cents: CROSS_EXIT_RULES.MAX_FLIP_ASK_CENTS,
    flip_time_cutoff_seconds: CROSS_EXIT_RULES.FLIP_TIME_CUTOFF_SECONDS,
    settled: pnl?.settled ?? false,
    outcome: pnl?.outcome,
    hold_pnl_cents: pnl?.holdPnlCents,
    exit_pnl_cents: pnl?.exitPnlCents,
    flip_pnl_cents: pnl?.flipPnlCents,
    combined_pnl_cents: pnl?.combinedPnlCents,
  };
}

/** Upsert a shadow row for a given entry. */
export async function upsertCrossExitShadow(db: SB, entry: CrossExitEntry, cross: CrossEvalResult, pnl?: PnlGrading) {
  const payload = entryToInsert(entry, cross, pnl);
  // The unique index includes trade_id, which is NULL for simulated rows — and
  // NULLs never collide in Postgres — so do an explicit find-then-write.
  let q = db
    .from("btc_cross_exit_shadow")
    .select("id")
    .eq("ticker", entry.ticker)
    .eq("close_time", entry.closeTime)
    .eq("source", entry.source);
  q = entry.tradeId ? q.eq("trade_id", entry.tradeId) : q.is("trade_id", null);
  const { data: existing } = await q.maybeSingle();

  const { error } = existing?.id
    ? await db.from("btc_cross_exit_shadow").update(payload).eq("id", existing.id)
    : await db.from("btc_cross_exit_shadow").insert(payload);
  if (error) throw new Error(`btc_cross_exit_shadow upsert failed: ${error.message}`);
}

/** Backfill cross-exit shadow for one settled window using dense snapshots. */
export async function backfillWindowCrossExit(
  db: SB,
  ticker: string,
  closeTime: string,
  strike: number,
  outcome: "YES" | "NO" | null,
): Promise<{ ok: boolean; entryCreated: boolean; crossDetected: boolean; error?: string }> {
  try {
    // Look for an existing row first.
    const { data: existing } = await db
      .from("btc_cross_exit_shadow")
      .select("id")
      .eq("ticker", ticker)
      .eq("close_time", closeTime)
      .eq("source", "simulated_t5")
      .maybeSingle();

    // Fetch all snapshots for this window, newest first, then reverse for chronology.
    const { data: rows, error } = await db
      .from("btc_window_snapshots")
      .select("captured_at,seconds_to_close,spot_usd,yes_bid_cents,yes_ask_cents")
      .eq("ticker", ticker)
      .eq("close_time", closeTime)
      .order("captured_at", { ascending: true });
    if (error) throw error;
    if (!rows || rows.length === 0) return { ok: true, entryCreated: false, crossDetected: false };

    const snapshots: CrossExitSnapshot[] = rows.map(rowToSnapshot);

    // Build T-5m entry from the snapshot closest to 300s remaining.
    let entry: CrossExitEntry | null = null;
    if (existing?.id) {
      // If a row exists we trust its entry columns, but for the simulated path
      // we always reconstruct from snapshots so the entry stays consistent.
      const t5 = snapshots.reduce(
        (best, s) => {
          const d = Math.abs(s.secondsToClose - CROSS_EXIT_RULES.T5_SECONDS_TO_CLOSE);
          return d < best.d ? { d, snap: s } : best;
        },
        { d: Infinity, snap: null as CrossExitSnapshot | null },
      ).snap;
      if (!t5) return { ok: true, entryCreated: false, crossDetected: false };
      entry = buildSimulatedT5Entry(ticker, closeTime, strike, t5);
    } else {
      const t5 = snapshots.reduce(
        (best, s) => {
          const d = Math.abs(s.secondsToClose - CROSS_EXIT_RULES.T5_SECONDS_TO_CLOSE);
          return d < best.d ? { d, snap: s } : best;
        },
        { d: Infinity, snap: null as CrossExitSnapshot | null },
      ).snap;
      if (!t5) return { ok: true, entryCreated: false, crossDetected: false };
      entry = buildSimulatedT5Entry(ticker, closeTime, strike, t5);
    }

    if (!entry) return { ok: true, entryCreated: false, crossDetected: false };

    const cross = findFirstCross(entry, snapshots);
    const pnl = gradePnl(entry, cross, outcome);

    await upsertCrossExitShadow(db, entry, cross, pnl);
    return { ok: true, entryCreated: true, crossDetected: cross.crossDetected };
  } catch (e) {
    return { ok: false, entryCreated: false, crossDetected: false, error: e instanceof Error ? e.message : String(e) };
  }
}

/** Backfill shadow rows for all settled windows in a date range. */
export async function backfillCrossExitShadowRange(
  db: SB,
  startDate: string,
  endDate: string,
): Promise<{ ok: boolean; processed: number; errors: string[] }> {
  const errors: string[] = [];
  const startTs = new Date(startDate).toISOString();
  const endTs = new Date(`${endDate}T23:59:59.999Z`).toISOString();

  const { data: windows, error } = await db
    .from("btc_window_snapshots")
    .select("ticker, close_time, strike_usd, outcome")
    .gte("close_time", startTs)
    .lte("close_time", endTs)
    .not("outcome", "is", null)
    .order("close_time", { ascending: false });

  if (error) throw new Error(`failed to list windows: ${error.message}`);

  const unique = new Map<string, { ticker: string; close_time: string; strike: number; outcome: "YES" | "NO" }>();
  for (const r of windows ?? []) {
    const key = `${r.ticker}|${r.close_time}`;
    if (!unique.has(key) && r.outcome != null) {
      unique.set(key, {
        ticker: r.ticker as string,
        close_time: r.close_time as string,
        strike: Number(r.strike_usd),
        outcome: String(r.outcome) as "YES" | "NO",
      });
    }
  }

  let processed = 0;
  for (const w of unique.values()) {
    const res = await backfillWindowCrossExit(db, w.ticker, w.close_time, w.strike, w.outcome);
    processed++;
    if (res.error) errors.push(`${w.ticker}@${w.close_time}: ${res.error}`);
  }

  return { ok: errors.length === 0, processed, errors };
}

/** Real-time cross-exit check using the latest dense snapshot.
 *  Creates the simulated T-5m entry row if missing, then detects/records any cross.
 */
export async function logCrossExitForSnapshot(
  db: SB,
  ticker: string,
  closeTime: string,
  strike: number,
  currentSnapshot: CrossExitSnapshot,
): Promise<{ ok: boolean; entryCreated: boolean; crossDetected: boolean; error?: string }> {
  try {
    // Fetch or create the simulated T-5m entry for this window.
    const { data: existing } = await db
      .from("btc_cross_exit_shadow")
      .select(
        "entry_side,entry_time,entry_seconds_to_close,entry_spot,entry_price_cents,entry_bid_cents,strike,cross_detected",
      )
      .eq("ticker", ticker)
      .eq("close_time", closeTime)
      .eq("source", "simulated_t5")
      .maybeSingle();

    let entry: CrossExitEntry | null = null;

    if (existing) {
      entry = {
        ticker,
        closeTime,
        source: "simulated_t5",
        tradeId: null,
        entrySide: existing.entry_side as "YES" | "NO",
        entryTime: existing.entry_time as string,
        entrySecondsToClose: num(existing.entry_seconds_to_close),
        entrySpot: num(existing.entry_spot),
        entryPriceCents: Number(existing.entry_price_cents),
        entryBidCents: num(existing.entry_bid_cents),
        strike: Number(existing.strike),
      };
    } else {
      // Build from the historical snapshots closest to T-5m.
      const { data: rows } = await db
        .from("btc_window_snapshots")
        .select("captured_at,seconds_to_close,spot_usd,yes_bid_cents,yes_ask_cents")
        .eq("ticker", ticker)
        .eq("close_time", closeTime)
        .order("captured_at", { ascending: true });
      const snapshots: CrossExitSnapshot[] = (rows ?? []).map(rowToSnapshot);
      const t5 = snapshots.reduce(
        (best, s) => {
          const d = Math.abs(s.secondsToClose - CROSS_EXIT_RULES.T5_SECONDS_TO_CLOSE);
          return d < best.d ? { d, snap: s } : best;
        },
        { d: Infinity, snap: null as CrossExitSnapshot | null },
      ).snap;
      if (!t5) return { ok: true, entryCreated: false, crossDetected: false };
      entry = buildSimulatedT5Entry(ticker, closeTime, strike, t5);
    }

    if (!entry) return { ok: true, entryCreated: false, crossDetected: false };

    // If a cross was already recorded, leave it alone (first cross wins).
    if (existing?.cross_detected) {
      return { ok: true, entryCreated: !existing, crossDetected: true };
    }

    const cross = evaluateCrossExit(entry, currentSnapshot);
    await upsertCrossExitShadow(db, entry, cross);

    return { ok: true, entryCreated: !existing, crossDetected: cross.crossDetected };
  } catch (e) {
    return { ok: false, entryCreated: false, crossDetected: false, error: e instanceof Error ? e.message : String(e) };
  }
}

/** Grade any ungraded shadow rows whose windows have now settled. */
export async function gradeSettledCrossExitShadow(db: SB): Promise<{ graded: number; errors: string[] }> {
  const errors: string[] = [];
  const { data: pending, error } = await db
    .from("btc_cross_exit_shadow")
    .select("ticker,close_time,entry_side,entry_price_cents,exit_bid_cents,flip_side,flip_ask_cents,would_exit,would_flip")
    .eq("settled", false);
  if (error) throw new Error(`failed to list pending shadow rows: ${error.message}`);

  const tickers = [...new Set((pending ?? []).map((r: Record<string, unknown>) => r.ticker as string))];
  if (tickers.length === 0) return { graded: 0, errors: [] };

  const { data: outcomes, error: outErr } = await db
    .from("btc_model_predictions")
    .select("ticker,outcome")
    .in("ticker", tickers)
    .not("outcome", "is", null);
  if (outErr) throw new Error(`failed to fetch outcomes: ${outErr.message}`);

  const outcomeByTicker = new Map<string, "YES" | "NO">();
  for (const o of outcomes ?? []) {
    outcomeByTicker.set(o.ticker as string, String(o.outcome) as "YES" | "NO");
  }

  let graded = 0;
  for (const row of pending ?? []) {
    const outcome = outcomeByTicker.get(row.ticker as string);
    if (!outcome) continue;

    const entry: CrossExitEntry = {
      ticker: row.ticker as string,
      closeTime: row.close_time as string,
      source: "simulated_t5",
      tradeId: null,
      entrySide: row.entry_side as "YES" | "NO",
      entryTime: "",
      entrySecondsToClose: null,
      entrySpot: null,
      entryPriceCents: Number(row.entry_price_cents),
      entryBidCents: null,
      strike: 0,
    };
    const cross: CrossEvalResult = {
      crossDetected: false,
      crossTime: null,
      crossSecondsToClose: null,
      crossSpot: null,
      crossCushionUsd: null,
      exitBidCents: row.exit_bid_cents == null ? null : Number(row.exit_bid_cents),
      wouldExit: Boolean(row.would_exit),
      exitReason: null,
      flipSide: row.flip_side as "YES" | "NO" | null,
      flipAskCents: row.flip_ask_cents == null ? null : Number(row.flip_ask_cents),
      wouldFlip: Boolean(row.would_flip),
      flipReason: null,
    };
    const pnl = gradePnl(entry, cross, outcome);

    const { error: upErr } = await db
      .from("btc_cross_exit_shadow")
      .update({
        settled: true,
        outcome: pnl.outcome,
        hold_pnl_cents: pnl.holdPnlCents,
        exit_pnl_cents: pnl.exitPnlCents,
        flip_pnl_cents: pnl.flipPnlCents,
        combined_pnl_cents: pnl.combinedPnlCents,
      })
      .eq("ticker", row.ticker as string)
      .eq("close_time", row.close_time as string)
      .eq("source", "simulated_t5");

    if (upErr) errors.push(`${row.ticker}@${row.close_time}: ${upErr.message}`);
    else graded++;
  }

  return { graded, errors };
}
