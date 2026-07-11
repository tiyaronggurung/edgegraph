// Server-only helpers for snapshotting + settling BTC model predictions.
// Filename .server.ts blocks any client-side import.
import { supabaseAdmin } from "@/integrations/supabase/client.server";

const COINBASE = "https://api.exchange.coinbase.com";

export interface SnapshotInput {
  ticker: string;
  eventTicker: string | null;
  strike: number;
  side: "YES" | "NO";
  modelProb: number;
  marketYesPrice: number;
  edgePts: number;
  spot: number;
  closeTime: string;
  secondsToClose: number;
  sigmaMinEffective?: number;
  theoryYesProb?: number;
  anchorZ?: number;
  liveSide?: "YES" | "NO";
  chartVerdict?: "YES" | "NO" | "neutral";
  chartStrength?: number;
}

export function timeBucketOf(secondsToClose: number): string {
  if (secondsToClose <= 30) return "30s";
  if (secondsToClose <= 60) return "1m";
  if (secondsToClose <= 120) return "2m";
  if (secondsToClose <= 300) return "5m";
  if (secondsToClose <= 600) return "10m";
  return "13m+";
}

async function priceAt(unixSec: number): Promise<number | null> {
  const start = new Date((unixSec - 60) * 1000).toISOString();
  const end = new Date((unixSec + 120) * 1000).toISOString();
  try {
    const res = await fetch(
      `${COINBASE}/products/BTC-USD/candles?granularity=60&start=${start}&end=${end}`,
      { headers: { Accept: "application/json", "User-Agent": "edgegraph/1.0" } },
    );
    if (!res.ok) return null;
    const rows = (await res.json()) as number[][];
    if (!rows.length) return null;
    let best = rows[0];
    let bestDiff = Math.abs(rows[0][0] - unixSec);
    for (const r of rows) {
      const d = Math.abs(r[0] - unixSec);
      if (d < bestDiff) { bestDiff = d; best = r; }
    }
    return Number(best[4]);
  } catch {
    return null;
  }
}

export async function snapshotPrediction(input: SnapshotInput): Promise<void> {
  try {
    const { data: existing } = await supabaseAdmin
      .from("btc_model_predictions")
      .select("id, snapshot_seconds_to_close, outcome, side, live_side, flip_count")
      .eq("ticker", input.ticker)
      .maybeSingle();

    if (!existing) {
      // Skip "noise" rows where both model and market agree on a near-certain
      // outcome — these have |edge| < 1pt and pollute the hit-rate denominator
      // without representing any real signal.
      if (Math.abs(input.edgePts) < 1) return;
      // First snapshot: store the model's pick (side) — this is LOCKED for the
      // life of the market, even if model prob drifts across 50% later.
      await supabaseAdmin.from("btc_model_predictions").insert({
        ticker: input.ticker,
        event_ticker: input.eventTicker,
        strike: input.strike,
        side: input.side,
        model_prob: input.modelProb,
        market_yes_price: input.marketYesPrice,
        edge_pts: input.edgePts,
        spot_at_snapshot: input.spot,
        close_time: input.closeTime,
        snapshot_seconds_to_close: input.secondsToClose,
        sigma_at_snapshot: input.sigmaMinEffective ?? null,
        theory_yes_prob: input.theoryYesProb ?? null,
        anchor_z: input.anchorZ ?? null,
        live_side: input.liveSide ?? input.side,
        chart_verdict: input.chartVerdict ?? null,
        chart_strength: input.chartStrength ?? null,
        time_bucket: timeBucketOf(input.secondsToClose),
      });
      return;
    }
    if (existing.outcome) return;
    if (input.secondsToClose < (existing.snapshot_seconds_to_close ?? 1e9)) {
      // IMPORTANT: do NOT touch `side` — original pick is locked. Refresh only
      // the transient telemetry so exit signals can see live drift.
      // Live-side flip tracking: increment counter if the incoming liveSide
      // differs from what we last stored.
      const prevLive = (existing.live_side as string | null) ?? (existing.side as string);
      const nextLive = input.liveSide ?? prevLive;
      const flipped = nextLive !== prevLive;
      await supabaseAdmin.from("btc_model_predictions").update({
        model_prob: input.modelProb,
        market_yes_price: input.marketYesPrice,
        edge_pts: input.edgePts,
        spot_at_snapshot: input.spot,
        snapshot_seconds_to_close: input.secondsToClose,
        sigma_at_snapshot: input.sigmaMinEffective ?? null,
        theory_yes_prob: input.theoryYesProb ?? null,
        anchor_z: input.anchorZ ?? null,
        live_side: nextLive,
        chart_verdict: input.chartVerdict ?? null,
        chart_strength: input.chartStrength ?? null,
        time_bucket: timeBucketOf(input.secondsToClose),
        ...(flipped ? {
          flip_count: Number(existing.flip_count ?? 0) + 1,
          flipped_at: new Date().toISOString(),
        } : {}),
      }).eq("id", existing.id);
    }
  } catch (e) {
    console.warn("snapshotPrediction failed:", e);
  }
}

// Read the locked sides for a batch of tickers (one round-trip).
export async function getLockedSides(tickers: string[]): Promise<Map<string, "YES" | "NO">> {
  const out = new Map<string, "YES" | "NO">();
  if (!tickers.length) return out;
  try {
    const { data } = await supabaseAdmin
      .from("btc_model_predictions")
      .select("ticker, side")
      .in("ticker", tickers);
    for (const r of data ?? []) out.set(r.ticker as string, r.side as "YES" | "NO");
  } catch (e) {
    console.warn("getLockedSides failed:", e);
  }
  return out;
}

export async function settleDuePredictions(): Promise<{ settled: number }> {
  try {
    const { data: due } = await supabaseAdmin
      .from("btc_model_predictions")
      .select("id, ticker, strike, side, close_time")
      .is("outcome", null)
      .lt("close_time", new Date(Date.now() - 30_000).toISOString())
      .order("close_time", { ascending: true })
      .limit(200);

    if (!due?.length) return { settled: 0 };

    // Fetch settle prices in parallel (Coinbase can handle it) so a batch of
    // 200 doesn't take 200×latency serially.
    const results = await Promise.all(due.map(async (r) => {
      const closeSec = Math.floor(new Date(r.close_time as string).getTime() / 1000);
      const settle = await priceAt(closeSec);
      return { r, settle };
    }));

    let settled = 0;
    await Promise.all(results.map(async ({ r, settle }) => {
      if (settle == null) return;
      const outcome: "YES" | "NO" = settle >= Number(r.strike) ? "YES" : "NO";
      const wasCorrect = outcome === r.side;
      await supabaseAdmin
        .from("btc_model_predictions")
        .update({
          settle_price: settle,
          outcome,
          was_correct: wasCorrect,
          settled_at: new Date().toISOString(),
        })
        .eq("id", r.id);
      settled++;
    }));
    return { settled };
  } catch (e) {
    console.warn("settleDuePredictions failed:", e);
    return { settled: 0 };
  }
}


export interface PredictionStatsResult {
  total: number;
  settled: number;
  correct: number;
  winRate: number;
  byWindow: {
    last24h: { settled: number; correct: number; winRate: number };
    last7d: { settled: number; correct: number; winRate: number };
  };
  recent: Array<{
    ticker: string;
    side: "YES" | "NO";
    strike: number;
    modelProb: number;
    marketYesPrice: number;
    edgePts: number;
    outcome: "YES" | "NO" | null;
    wasCorrect: boolean | null;
    settlePrice: number | null;
    closeTime: string;
    liveSide: "YES" | "NO" | null;
    flipCount: number;
    chartVerdict: "YES" | "NO" | "neutral" | null;
    chartStrength: number | null;
  }>;
}

// Fresh-start cutoff: model accuracy panel (Tracked / Correct / Win rate 7d /
// Win rate 24h / Awaiting settle) ignores anything with close_time before
// this instant. Set to today 00:00 UTC. Change to bring history back.
const STATS_RESET_ISO = "2026-07-09T00:00:00Z";

export async function computePredictionStats(): Promise<PredictionStatsResult> {
  const since7d = new Date(Date.now() - 7 * 86400_000).toISOString();
  const since24h = new Date(Date.now() - 12 * 3600_000).toISOString(); // 12h window (field name kept for compat)
  const cutoff = since7d > STATS_RESET_ISO ? since7d : STATS_RESET_ISO;

  const { data: rows } = await supabaseAdmin
    .from("btc_model_predictions")
    .select("ticker, side, strike, model_prob, market_yes_price, edge_pts, outcome, was_correct, settle_price, close_time, live_side, flip_count, chart_verdict, chart_strength")
    .gte("close_time", cutoff)
    .order("close_time", { ascending: false })
    .limit(500);

  const all = rows ?? [];
  const settledAll = all.filter(r => r.outcome);
  const correctAll = settledAll.filter(r => r.was_correct).length;
  const in24 = settledAll.filter(r => (r.close_time as string) >= since24h);
  const correct24 = in24.filter(r => r.was_correct).length;

  return {
    total: all.length,
    settled: settledAll.length,
    correct: correctAll,
    winRate: settledAll.length ? correctAll / settledAll.length : 0,
    byWindow: {
      last24h: {
        settled: in24.length,
        correct: correct24,
        winRate: in24.length ? correct24 / in24.length : 0,
      },
      last7d: {
        settled: settledAll.length,
        correct: correctAll,
        winRate: settledAll.length ? correctAll / settledAll.length : 0,
      },
    },
    recent: all.map(r => ({
      ticker: r.ticker as string,
      side: r.side as "YES" | "NO",
      strike: Number(r.strike),
      modelProb: Number(r.model_prob),
      marketYesPrice: Number(r.market_yes_price),
      edgePts: Number(r.edge_pts),
      outcome: (r.outcome as "YES" | "NO" | null) ?? null,
      wasCorrect: (r.was_correct as boolean | null) ?? null,
      settlePrice: r.settle_price != null ? Number(r.settle_price) : null,
      closeTime: r.close_time as string,
      liveSide: (r.live_side as "YES" | "NO" | null) ?? null,
      flipCount: Number(r.flip_count ?? 0),
      chartVerdict: (r.chart_verdict as "YES" | "NO" | "neutral" | null) ?? null,
      chartStrength: r.chart_strength != null ? Number(r.chart_strength) : null,
    })),
  };
}
