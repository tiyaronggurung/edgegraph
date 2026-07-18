// Market Context orchestrator — fetches Binance candles for multiple TFs,
// computes all indicators, and writes a checkpoint row to btc_market_context.
// Idempotent via UNIQUE (ticker, checkpoint_type).
//
// Shadow-only telemetry: no live trading path reads this output.

import {
  type Candle,
  rsi,
  macd,
  bollinger,
  adx,
  atr,
  sessionVwap,
  volumeProfile,
  emaTrend,
  type TrendDir,
} from "./indicators";
import { computeSrZones, nearestSr, type SrZone } from "./htfLevels";

const CONTEXT_ENGINE_VERSION = "v1";
const SR_ALGORITHM_VERSION = "v1";
const VOLUME_PROFILE_VERSION = "v1";

async function fetchKlines(interval: string, limit: number, endMs?: number): Promise<Candle[]> {
  const suffix = endMs ? `&endTime=${endMs}` : "";
  const url = `https://api.binance.com/api/v3/klines?symbol=BTCUSDT&interval=${interval}&limit=${limit}${suffix}`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`binance ${interval} ${res.status}`);
  const raw = (await res.json()) as unknown[];
  return raw.map((row) => {
    const r = row as [number, string, string, string, string, string];
    return {
      t: Number(r[0]),
      o: parseFloat(r[1]),
      h: parseFloat(r[2]),
      l: parseFloat(r[3]),
      c: parseFloat(r[4]),
      v: parseFloat(r[5]),
    } satisfies Candle;
  });
}

export interface MarketContextSnapshot {
  spot_price: number;
  strike_price: number | null;
  strike_distance_usd: number | null;
  strike_distance_pct: number | null;
  strike_distance_atr: number | null;
  strike_distance_em: number | null;

  rsi_5m: number | null;
  rsi_15m: number | null;
  rsi_1h: number | null;

  macd_5m_line: number | null;
  macd_5m_signal: number | null;
  macd_5m_hist: number | null;
  macd_5m_cross: string | null;
  macd_15m_line: number | null;
  macd_15m_signal: number | null;
  macd_15m_hist: number | null;
  macd_15m_cross: string | null;

  bb_5m_upper: number | null;
  bb_5m_mid: number | null;
  bb_5m_lower: number | null;
  bb_5m_pctb: number | null;
  bb_5m_bandwidth: number | null;
  bb_5m_squeeze: boolean | null;

  adx_15m: number | null;
  adx_15m_plus_di: number | null;
  adx_15m_minus_di: number | null;

  vwap_session: number | null;
  vwap_distance_usd: number | null;
  vwap_distance_pct: number | null;
  vwap_above: boolean | null;

  vp_poc: number | null;
  vp_vah: number | null;
  vp_val: number | null;
  vp_price_position: string | null;

  trend_1m: TrendDir;
  trend_5m: TrendDir;
  trend_15m: TrendDir;
  trend_1h: TrendDir;
  trend_4h: TrendDir;
  trend_alignment_score: number;

  nearest_support: number | null;
  nearest_support_touches: number | null;
  nearest_support_tf: string | null;
  nearest_support_distance_usd: number | null;
  nearest_support_distance_pct: number | null;
  nearest_resistance: number | null;
  nearest_resistance_touches: number | null;
  nearest_resistance_tf: string | null;
  nearest_resistance_distance_usd: number | null;
  nearest_resistance_distance_pct: number | null;
  sr_zones: SrZone[];
}

function scoreTrend(t: TrendDir): number {
  return t === "up" ? 1 : t === "down" ? -1 : 0;
}

/**
 * Compute the full market-context snapshot from live Binance data.
 * @param strikePrice - optional strike for the current Kalshi window (for distance metrics)
 */
export async function computeMarketContext(
  strikePrice: number | null,
): Promise<MarketContextSnapshot> {
  // Fetch all timeframes in parallel. Limits sized for each indicator's need.
  const [c1m, c5m, c15m, c1h, c4h] = await Promise.all([
    fetchKlines("1m", 120),
    fetchKlines("5m", 120),
    fetchKlines("15m", 200), // volume profile 24h = 96 bars; extra for pivots
    fetchKlines("1h", 200),
    fetchKlines("4h", 200),
  ]);

  const price = c1m[c1m.length - 1]?.c ?? c5m[c5m.length - 1]?.c ?? 0;
  const atr15 = atr(c15m, 14);

  const bb = bollinger(c5m, 20, 2);
  const macd5 = macd(c5m);
  const macd15 = macd(c15m);
  const adx15 = adx(c15m, 14);
  const vwap = sessionVwap(c1m);
  const vp = volumeProfile(c15m.slice(-96), price, 50); // last 24h of 15m
  const zones = computeSrZones(c15m, c1h, c4h);
  const ns = nearestSr(zones, price);

  const t1 = emaTrend(c1m);
  const t5 = emaTrend(c5m);
  const t15 = emaTrend(c15m);
  const t1h = emaTrend(c1h);
  const t4h = emaTrend(c4h);
  const weights = [0.05, 0.15, 0.25, 0.25, 0.30];
  const trends = [t1, t5, t15, t1h, t4h];
  const alignment = trends.reduce((a, t, i) => a + weights[i] * scoreTrend(t), 0);

  // Expected move for 15min using recent 1m realized vol.
  let em15: number | null = null;
  if (c1m.length >= 30) {
    const closes = c1m.slice(-30).map((c) => c.c);
    let sqsum = 0;
    for (let i = 1; i < closes.length; i++) {
      const r = Math.log(closes[i] / closes[i - 1]);
      sqsum += r * r;
    }
    const sigmaPerMin = Math.sqrt(sqsum / (closes.length - 1));
    em15 = price * sigmaPerMin * Math.sqrt(15);
  }

  const strikeDist = strikePrice != null ? strikePrice - price : null;
  const strikeDistPct = strikePrice != null ? strikeDist! / price : null;
  const strikeDistAtr = strikePrice != null && atr15 ? strikeDist! / atr15 : null;
  const strikeDistEm = strikePrice != null && em15 ? strikeDist! / em15 : null;

  return {
    spot_price: price,
    strike_price: strikePrice,
    strike_distance_usd: strikeDist,
    strike_distance_pct: strikeDistPct,
    strike_distance_atr: strikeDistAtr,
    strike_distance_em: strikeDistEm,

    rsi_5m: rsi(c5m, 14),
    rsi_15m: rsi(c15m, 14),
    rsi_1h: rsi(c1h, 14),

    macd_5m_line: macd5?.line ?? null,
    macd_5m_signal: macd5?.signal ?? null,
    macd_5m_hist: macd5?.hist ?? null,
    macd_5m_cross: macd5?.cross ?? null,
    macd_15m_line: macd15?.line ?? null,
    macd_15m_signal: macd15?.signal ?? null,
    macd_15m_hist: macd15?.hist ?? null,
    macd_15m_cross: macd15?.cross ?? null,

    bb_5m_upper: bb?.upper ?? null,
    bb_5m_mid: bb?.mid ?? null,
    bb_5m_lower: bb?.lower ?? null,
    bb_5m_pctb: bb?.pctB ?? null,
    bb_5m_bandwidth: bb?.bandwidth ?? null,
    bb_5m_squeeze: bb?.squeeze ?? null,

    adx_15m: adx15?.adx ?? null,
    adx_15m_plus_di: adx15?.plusDi ?? null,
    adx_15m_minus_di: adx15?.minusDi ?? null,

    vwap_session: vwap,
    vwap_distance_usd: vwap != null ? price - vwap : null,
    vwap_distance_pct: vwap != null ? (price - vwap) / vwap : null,
    vwap_above: vwap != null ? price > vwap : null,

    vp_poc: vp?.poc ?? null,
    vp_vah: vp?.vah ?? null,
    vp_val: vp?.val ?? null,
    vp_price_position: vp?.position ?? null,

    trend_1m: t1,
    trend_5m: t5,
    trend_15m: t15,
    trend_1h: t1h,
    trend_4h: t4h,
    trend_alignment_score: alignment,

    nearest_support: ns.support?.price ?? null,
    nearest_support_touches: ns.support?.touches ?? null,
    nearest_support_tf: ns.support?.tf ?? null,
    nearest_support_distance_usd: ns.support ? price - ns.support.price : null,
    nearest_support_distance_pct: ns.support ? (price - ns.support.price) / price : null,
    nearest_resistance: ns.resistance?.price ?? null,
    nearest_resistance_touches: ns.resistance?.touches ?? null,
    nearest_resistance_tf: ns.resistance?.tf ?? null,
    nearest_resistance_distance_usd: ns.resistance ? ns.resistance.price - price : null,
    nearest_resistance_distance_pct: ns.resistance ? (ns.resistance.price - price) / price : null,
    sr_zones: zones,
  };
}

export type CheckpointType = "first_valid" | "t_minus_10" | "t_minus_5" | "t_minus_2" | "fire" | "final";

/**
 * Write a market-context snapshot to btc_market_context. Idempotent — unique
 * on (ticker, checkpoint_type). Additional calls for the same key are ignored.
 */
export async function writeMarketContext(params: {
  ticker: string;
  windowStart: Date;
  windowEnd: Date;
  checkpointType: CheckpointType;
  strikePrice: number | null;
  modelProb?: number | null;
  modelSide?: string | null;
  sideConf?: number | null;
  fired?: boolean;
  orderId?: string | null;
}): Promise<{ ok: true; id: string | null; skipped: boolean } | { ok: false; error: string }> {
  try {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const snap = await computeMarketContext(params.strikePrice);
    const row = {
      ticker: params.ticker,
      window_start_ts: params.windowStart.toISOString(),
      window_end_ts: params.windowEnd.toISOString(),
      checkpoint_type: params.checkpointType,
      context_engine_version: CONTEXT_ENGINE_VERSION,
      sr_algorithm_version: SR_ALGORITHM_VERSION,
      volume_profile_version: VOLUME_PROFILE_VERSION,
      spot_price: snap.spot_price,
      strike_price: snap.strike_price,
      strike_distance_usd: snap.strike_distance_usd,
      strike_distance_pct: snap.strike_distance_pct,
      strike_distance_atr: snap.strike_distance_atr,
      strike_distance_em: snap.strike_distance_em,
      rsi_5m: snap.rsi_5m,
      rsi_15m: snap.rsi_15m,
      rsi_1h: snap.rsi_1h,
      macd_5m_line: snap.macd_5m_line,
      macd_5m_signal: snap.macd_5m_signal,
      macd_5m_hist: snap.macd_5m_hist,
      macd_5m_cross: snap.macd_5m_cross,
      macd_15m_line: snap.macd_15m_line,
      macd_15m_signal: snap.macd_15m_signal,
      macd_15m_hist: snap.macd_15m_hist,
      macd_15m_cross: snap.macd_15m_cross,
      bb_5m_upper: snap.bb_5m_upper,
      bb_5m_mid: snap.bb_5m_mid,
      bb_5m_lower: snap.bb_5m_lower,
      bb_5m_pctb: snap.bb_5m_pctb,
      bb_5m_bandwidth: snap.bb_5m_bandwidth,
      bb_5m_squeeze: snap.bb_5m_squeeze,
      adx_15m: snap.adx_15m,
      adx_15m_plus_di: snap.adx_15m_plus_di,
      adx_15m_minus_di: snap.adx_15m_minus_di,
      vwap_session: snap.vwap_session,
      vwap_distance_usd: snap.vwap_distance_usd,
      vwap_distance_pct: snap.vwap_distance_pct,
      vwap_above: snap.vwap_above,
      vp_poc: snap.vp_poc,
      vp_vah: snap.vp_vah,
      vp_val: snap.vp_val,
      vp_price_position: snap.vp_price_position,
      trend_1m: snap.trend_1m,
      trend_5m: snap.trend_5m,
      trend_15m: snap.trend_15m,
      trend_1h: snap.trend_1h,
      trend_4h: snap.trend_4h,
      trend_alignment_score: snap.trend_alignment_score,
      nearest_support: snap.nearest_support,
      nearest_support_touches: snap.nearest_support_touches,
      nearest_support_tf: snap.nearest_support_tf,
      nearest_support_distance_usd: snap.nearest_support_distance_usd,
      nearest_support_distance_pct: snap.nearest_support_distance_pct,
      nearest_resistance: snap.nearest_resistance,
      nearest_resistance_touches: snap.nearest_resistance_touches,
      nearest_resistance_tf: snap.nearest_resistance_tf,
      nearest_resistance_distance_usd: snap.nearest_resistance_distance_usd,
      nearest_resistance_distance_pct: snap.nearest_resistance_distance_pct,
      sr_zones_json: snap.sr_zones as unknown as Record<string, unknown>[],
      model_prob: params.modelProb ?? null,
      model_side: params.modelSide ?? null,
      side_conf: params.sideConf ?? null,
      fired: params.fired ?? false,
      order_id: params.orderId ?? null,
    };
    const { data, error } = await supabaseAdmin
      .from("btc_market_context")
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      .upsert(row as any, { onConflict: "ticker,checkpoint_type", ignoreDuplicates: true })
      .select("id")
      .maybeSingle();
    if (error) {
      // Ignore duplicate-conflict — that's the idempotent path.
      if (String(error.code) === "23505") return { ok: true, id: null, skipped: true };
      return { ok: false, error: error.message };
    }
    return { ok: true, id: data?.id ?? null, skipped: false };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}
