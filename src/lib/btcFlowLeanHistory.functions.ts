import { binanceFetch } from "@/lib/binanceFetch";
// Read-only history: per-15m-window flow (BTC in vs out, USD in vs out, avg
// buy/sell price) + actual result, plus rolled-up totals by timeframe.
// Display only — nothing here touches entry, study, model or trendline paths.
import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

/** Standard-setting indicator snapshot (SMA 20, RSI 14, MACD 12/26/9). */
export interface IndicatorSnap {
  close: number | null;
  sma: number | null;
  /** close vs SMA as a fraction. */
  smaDistPct: number | null;
  rsi: number | null;
  macd: number | null;
  signal: number | null;
  hist: number | null;
}

export interface FlowLeanHistoryRow {
  windowStart: string;
  lean: string;
  imbWindow: number | null;
  buyBtc: number | null;
  sellBtc: number | null;
  volBtc: number | null;
  buyUsd: number | null;
  sellUsd: number | null;
  avgBuyPrice: number | null;
  avgSellPrice: number | null;
  /** Indicators on the 15m candles as of this window's close. */
  ind: IndicatorSnap;
  /**
   * "UP" | "DOWN" — prefer the actual settled market outcome (above/below the
   * strike); fall back to the Binance 15m candle open vs close. Null while
   * unsettled.
   */
  result: "UP" | "DOWN" | null;
  /** Where the result came from: settled market outcome or candle estimate. */
  resultSource: "settled" | "candle" | null;
  hit: boolean | null;
}

export interface FlowRollup {
  label: string;
  buyBtc: number;
  sellBtc: number;
  buyUsd: number;
  sellUsd: number;
  avgBuyPrice: number | null;
  avgSellPrice: number | null;
  /** USD imbalance: (in - out) / total. */
  netUsdPct: number | null;
  priceChangePct: number | null;
  /** Taker fee cost on both sides at FEE_RATE. */
  feeUsd: number;
  /** Avg buy price incl. fee paid, avg sell price net of fee received. */
  effAvgBuyPrice: number | null;
  effAvgSellPrice: number | null;
  /** Net USD flow after fees, as % of total traded USD. */
  netUsdPctAfterFees: number | null;
}

/** Taker fee assumption on each side (0.10%). */
export const FEE_RATE = 0.001;

export interface FlowLeanHistoryResult {
  rows: FlowLeanHistoryRow[];
  scored: number;
  hits: number;
  rollups: FlowRollup[];
  /** Live indicator readings: fast (1m), slow (15m) and the SMA stack (1m). */
  live: { m1: IndicatorSnap; m15: IndicatorSnap; stack: SmaStack };
}

const WINDOW_MS = 15 * 60 * 1000;

interface Agg {
  buyBtc: number;
  sellBtc: number;
  buyUsd: number;
  sellUsd: number;
  firstOpen: number | null;
  lastClose: number | null;
}

function emptyAgg(): Agg {
  return { buyBtc: 0, sellBtc: 0, buyUsd: 0, sellUsd: 0, firstOpen: null, lastClose: null };
}

function addKline(agg: Agg, k: number[]) {
  const vol = Number(k[5]) || 0;
  const quote = Number(k[7]) || 0;
  const buyBtc = Number(k[9]) || 0;
  const buyUsd = Number(k[10]) || 0;
  agg.buyBtc += buyBtc;
  agg.sellBtc += Math.max(0, vol - buyBtc);
  agg.buyUsd += buyUsd;
  agg.sellUsd += Math.max(0, quote - buyUsd);
  if (agg.firstOpen == null) agg.firstOpen = Number(k[1]);
  agg.lastClose = Number(k[4]);
}

function toRollup(label: string, agg: Agg): FlowRollup {
  const totalUsd = agg.buyUsd + agg.sellUsd;
  return {
    label,
    buyBtc: agg.buyBtc,
    sellBtc: agg.sellBtc,
    buyUsd: agg.buyUsd,
    sellUsd: agg.sellUsd,
    avgBuyPrice: agg.buyBtc > 0 ? agg.buyUsd / agg.buyBtc : null,
    avgSellPrice: agg.sellBtc > 0 ? agg.sellUsd / agg.sellBtc : null,
    netUsdPct: totalUsd > 0 ? (agg.buyUsd - agg.sellUsd) / totalUsd : null,
    priceChangePct:
      agg.firstOpen && agg.lastClose ? (agg.lastClose - agg.firstOpen) / agg.firstOpen : null,
    feeUsd: totalUsd * FEE_RATE,
    effAvgBuyPrice: agg.buyBtc > 0 ? (agg.buyUsd * (1 + FEE_RATE)) / agg.buyBtc : null,
    effAvgSellPrice: agg.sellBtc > 0 ? (agg.sellUsd * (1 - FEE_RATE)) / agg.sellBtc : null,
    netUsdPctAfterFees:
      totalUsd > 0
        ? (agg.buyUsd * (1 + FEE_RATE) - agg.sellUsd * (1 - FEE_RATE)) / totalUsd
        : null,
  };
}

// ---- Indicators (standard settings: SMA 20, RSI 14, MACD 12/26/9) ----
const SMA_LEN = 20;
const RSI_LEN = 14;
const MACD_FAST = 12;
const MACD_SLOW = 26;
const MACD_SIGNAL = 9;

const EMPTY_IND: IndicatorSnap = {
  close: null,
  sma: null,
  smaDistPct: null,
  rsi: null,
  macd: null,
  signal: null,
  hist: null,
};

/** EMA series over closes; index-aligned with the input. */
function emaSeries(values: number[], len: number): (number | null)[] {
  const k = 2 / (len + 1);
  const out: (number | null)[] = [];
  let prev: number | null = null;
  for (let i = 0; i < values.length; i++) {
    const v = values[i] as number;
    if (i + 1 < len) {
      out.push(null);
      continue;
    }
    if (prev == null) {
      let sum = 0;
      for (let j = i - len + 1; j <= i; j++) sum += values[j] as number;
      prev = sum / len;
    } else {
      prev = v * k + prev * (1 - k);
    }
    out.push(prev);
  }
  return out;
}

/** Wilder-smoothed RSI series; index-aligned with the input. */
function rsiSeries(values: number[], len: number): (number | null)[] {
  const out: (number | null)[] = new Array(values.length).fill(null);
  if (values.length <= len) return out;
  let gain = 0;
  let loss = 0;
  for (let i = 1; i <= len; i++) {
    const ch = (values[i] as number) - (values[i - 1] as number);
    if (ch >= 0) gain += ch;
    else loss -= ch;
  }
  gain /= len;
  loss /= len;
  out[len] = loss === 0 ? 100 : 100 - 100 / (1 + gain / loss);
  for (let i = len + 1; i < values.length; i++) {
    const ch = (values[i] as number) - (values[i - 1] as number);
    gain = (gain * (len - 1) + Math.max(0, ch)) / len;
    loss = (loss * (len - 1) + Math.max(0, -ch)) / len;
    out[i] = loss === 0 ? 100 : 100 - 100 / (1 + gain / loss);
  }
  return out;
}

/** Indicator snapshot at every candle index, from a list of closes. */
function indicatorSeries(closes: number[]): IndicatorSnap[] {
  const rsi = rsiSeries(closes, RSI_LEN);
  const emaFast = emaSeries(closes, MACD_FAST);
  const emaSlow = emaSeries(closes, MACD_SLOW);
  const macdLine = closes.map((_, i) => {
    const f = emaFast[i];
    const s = emaSlow[i];
    return f != null && s != null ? f - s : null;
  });
  const defined = macdLine.map((v) => v ?? 0);
  const signalRaw = emaSeries(defined, MACD_SIGNAL);

  return closes.map((close, i) => {
    let sma: number | null = null;
    if (i + 1 >= SMA_LEN) {
      let sum = 0;
      for (let j = i - SMA_LEN + 1; j <= i; j++) sum += closes[j] as number;
      sma = sum / SMA_LEN;
    }
    const macd = macdLine[i] ?? null;
    const signal = macd == null ? null : (signalRaw[i] ?? null);
    return {
      close,
      sma,
      smaDistPct: sma ? (close - sma) / sma : null,
      rsi: rsi[i] ?? null,
      macd,
      signal,
      hist: macd != null && signal != null ? macd - signal : null,
    };
  });
}

// ---- Multi-SMA stack (10 / 50 / 200) on 1m closes ----
// The lines themselves lag; the value is the ORDER of the stack, the
// separation of the fast line from the mid line, and the CROSS between them —
// all of which lead price rather than follow it.
export interface SmaStack {
  close: number | null;
  sma10: number | null;
  sma50: number | null;
  sma200: number | null;
  /** close vs each line as a fraction (positive = price above the line). */
  dist10Pct: number | null;
  dist50Pct: number | null;
  dist200Pct: number | null;
  /** Fast line vs mid line as a fraction; positive = fast above mid (bullish). */
  spread1050Pct: number | null;
  /** Same separation one minute ago — a sign change is a fresh cross. */
  spread1050PctPrev: number | null;
  /** Fast line's move over the last minute, as a fraction. */
  slope10Pct: number | null;
  /** Seconds since the fast line last crossed the mid line; null = none seen. */
  crossAgeSec: number | null;
  /** Side the fast line crossed INTO: UP = crossed above the mid, DOWN = below. */
  crossSide: "UP" | "DOWN" | null;
  /** Bull stack (10>50>200), bear stack (10<50<200), or mixed. */
  order: "BULL" | "BEAR" | "MIXED";
}

const STACK_FAST = 10;
const STACK_MID = 50;
const STACK_SLOW = 200;

const EMPTY_STACK: SmaStack = {
  close: null,
  sma10: null,
  sma50: null,
  sma200: null,
  dist10Pct: null,
  dist50Pct: null,
  dist200Pct: null,
  spread1050Pct: null,
  spread1050PctPrev: null,
  slope10Pct: null,
  crossAgeSec: null,
  crossSide: null,
  order: "MIXED",
};

function smaAt(values: number[], len: number, i: number): number | null {
  if (i + 1 < len) return null;
  let sum = 0;
  for (let j = i - len + 1; j <= i; j++) sum += values[j] as number;
  return sum / len;
}

/** Stack read at the latest candle, including the most recent fast/mid cross. */
function smaStack(closes: number[]): SmaStack {
  const i = closes.length - 1;
  if (i < 0) return EMPTY_STACK;
  const close = closes[i] ?? null;
  const sma10 = smaAt(closes, STACK_FAST, i);
  const sma50 = smaAt(closes, STACK_MID, i);
  const sma200 = smaAt(closes, STACK_SLOW, i);
  const dist = (sma: number | null) =>
    sma != null && sma > 0 && close != null ? (close - sma) / sma : null;
  const spread = (j: number) => {
    const f = smaAt(closes, STACK_FAST, j);
    const s = smaAt(closes, STACK_MID, j);
    return f != null && s != null && s > 0 ? (f - s) / s : null;
  };
  const spreadNow = spread(i);
  const spreadPrev = i >= 1 ? spread(i - 1) : null;
  const sma10Prev = i >= 1 ? smaAt(closes, STACK_FAST, i - 1) : null;
  const slope10Pct =
    sma10 != null && sma10Prev != null && sma10Prev > 0 ? (sma10 - sma10Prev) / sma10Prev : null;

  // Walk back to the most recent sign change in the fast/mid separation.
  let crossAgeSec: number | null = null;
  let crossSide: "UP" | "DOWN" | null = null;
  for (let j = i; j >= 1; j--) {
    const a = spread(j);
    const b = spread(j - 1);
    if (a == null || b == null) break;
    if (a === 0 || b === 0) continue;
    if (a > 0 !== b > 0) {
      crossAgeSec = (i - j) * 60;
      crossSide = a > 0 ? "UP" : "DOWN";
      break;
    }
  }

  const order: SmaStack["order"] =
    sma10 != null && sma50 != null && sma200 != null
      ? sma10 > sma50 && sma50 > sma200
        ? "BULL"
        : sma10 < sma50 && sma50 < sma200
          ? "BEAR"
          : "MIXED"
      : "MIXED";

  return {
    close,
    sma10,
    sma50,
    sma200,
    dist10Pct: dist(sma10),
    dist50Pct: dist(sma50),
    dist200Pct: dist(sma200),
    spread1050Pct: spreadNow,
    spread1050PctPrev: spreadPrev,
    slope10Pct,
    crossAgeSec,
    crossSide,
    order,
  };
}

async function fetchKlines(interval: string, limit: number): Promise<number[][]> {
  try {
    const res = await binanceFetch(
      `/api/v3/klines?symbol=BTCUSDT&interval=${interval}&limit=${limit}`,
    );
    if (!res.ok) return [];
    const kl = (await res.json()) as unknown[][];
    return kl.map((k) => k.map((x) => Number(x)));
  } catch {
    return [];
  }
}

/**
 * Live indicator context only (m1 / m15 / SMA stack) — no database, no auth.
 * Same computation the history handler does for its `live` field, exposed so
 * the server-side agreement recorder can build the odds context without a
 * browser. Additive: the handler below is unchanged.
 */
export async function loadBtcFlowLeanLive(): Promise<{
  m1: IndicatorSnap;
  m15: IndicatorSnap;
  stack: SmaStack;
}> {
  const [k15, k1m] = await Promise.all([fetchKlines("15m", 250), fetchKlines("1m", 250)]);
  const ind15 = indicatorSeries(k15.map((k) => Number(k[4]) || 0));
  const ind1m = indicatorSeries(k1m.map((k) => Number(k[4]) || 0));
  return {
    m1: ind1m[ind1m.length - 1] ?? EMPTY_IND,
    m15: ind15[ind15.length - 1] ?? EMPTY_IND,
    stack: smaStack(k1m.map((k) => Number(k[4]) || 0)),
  };
}

export const getBtcFlowLeanHistory = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<FlowLeanHistoryResult> => {
    const since = new Date(Date.now() - 12 * 60 * 60 * 1000).toISOString();
    const [{ data: logs }, { data: preds }, k15, k1m] = await Promise.all([
      context.supabase
        .from("btc_flow_lean_log")
        .select("window_start, seconds_to_close, lean")
        .gte("window_start", since)
        .order("window_start", { ascending: false })
        .order("seconds_to_close", { ascending: true })
        .limit(500),
      context.supabase
        .from("btc_model_predictions")
        .select("close_time, outcome")
        .gte("close_time", since)
        .not("outcome", "is", null)
        .limit(200),
      fetchKlines("15m", 250),
      fetchKlines("1m", 250),
    ]);

    // Actual settled outcomes keyed by window start (close_time − 15m).
    // YES = settled above strike (UP), NO = below (DOWN).
    const outcomeByWindow = new Map<string, "UP" | "DOWN">();
    for (const p of preds ?? []) {
      const ct = new Date(p.close_time as string).getTime();
      if (!Number.isFinite(ct)) continue;
      const key = new Date(ct - WINDOW_MS).toISOString();
      const o = p.outcome as string;
      if (o === "YES" || o === "NO") outcomeByWindow.set(key, o === "YES" ? "UP" : "DOWN");
    }

    // Keep the latest row (smallest seconds_to_close) per window.
    const leanByWindow = new Map<string, string>();
    for (const r of logs ?? []) {
      const key = new Date(r.window_start as string).toISOString();
      if (!leanByWindow.has(key)) leanByWindow.set(key, (r.lean as string) ?? "FLAT");
    }

    const now = Date.now();
    const nowWindow = Math.floor(now / WINDOW_MS) * WINDOW_MS;

    // Per-window flow + direction straight from the 15m candles.
    const perWindow = new Map<string, { agg: Agg; result: "UP" | "DOWN" | null }>();
    for (const k of k15) {
      const openTime = Number(k[0]);
      if (!Number.isFinite(openTime)) continue;
      const agg = emptyAgg();
      addKline(agg, k);
      const settled = openTime < nowWindow;
      perWindow.set(new Date(openTime).toISOString(), {
        agg,
        result: settled ? ((agg.lastClose ?? 0) >= (agg.firstOpen ?? 0) ? "UP" : "DOWN") : null,
      });
    }

    // Indicators per 15m candle close, keyed by window start.
    const ind15 = indicatorSeries(k15.map((k) => Number(k[4]) || 0));
    const indByWindow = new Map<string, IndicatorSnap>();
    k15.forEach((k, i) => {
      const snap = ind15[i];
      if (snap) indByWindow.set(new Date(Number(k[0])).toISOString(), snap);
    });
    const ind1m = indicatorSeries(k1m.map((k) => Number(k[4]) || 0));
    const live = {
      m1: ind1m[ind1m.length - 1] ?? EMPTY_IND,
      m15: ind15[ind15.length - 1] ?? EMPTY_IND,
      stack: smaStack(k1m.map((k) => Number(k[4]) || 0)),
    };

    let scored = 0;
    let hits = 0;
    const rows: FlowLeanHistoryRow[] = [...leanByWindow.entries()]
      .sort((a, b) => (a[0] < b[0] ? 1 : -1))
      .slice(0, 16)
      .map(([key, lean]) => {
        const w = perWindow.get(key);
        const agg = w?.agg ?? emptyAgg();
        // Prefer the real settled market outcome; fall back to the candle.
        const settled = outcomeByWindow.get(key);
        const result = settled ?? w?.result ?? null;
        const resultSource = settled ? "settled" : w?.result ? "candle" : null;
        let hit: boolean | null = null;
        if (result && (lean === "UP" || lean === "DOWN")) {
          hit = lean === result;
          scored += 1;
          if (hit) hits += 1;
        }
        const totalBtc = agg.buyBtc + agg.sellBtc;
        return {
          windowStart: key,
          lean,
          imbWindow: totalBtc > 0 ? (agg.buyBtc - agg.sellBtc) / totalBtc : null,
          buyBtc: agg.buyBtc || null,
          sellBtc: agg.sellBtc || null,
          volBtc: totalBtc || null,
          buyUsd: agg.buyUsd || null,
          sellUsd: agg.sellUsd || null,
          avgBuyPrice: agg.buyBtc > 0 ? agg.buyUsd / agg.buyBtc : null,
          avgSellPrice: agg.sellBtc > 0 ? agg.sellUsd / agg.sellBtc : null,
          ind: indByWindow.get(key) ?? EMPTY_IND,
          result,
          resultSource,
          hit,
        };
      });

    // Rollups. Short frames from 1m candles, longer ones from 15m candles.
    const rollups: FlowRollup[] = [];

    const agg15 = emptyAgg();
    for (const k of k1m) if (Number(k[0]) >= nowWindow) addKline(agg15, k);
    rollups.push(toRollup("15m", agg15));

    const spans: Array<[string, number]> = [
      ["1h", 60 * 60 * 1000],
      ["4h", 4 * 60 * 60 * 1000],
      ["24h", 24 * 60 * 60 * 1000],
    ];
    for (const [label, ms] of spans) {
      const agg = emptyAgg();
      for (const k of k15) if (Number(k[0]) >= now - ms) addKline(agg, k);
      rollups.push(toRollup(label, agg));
    }

    const dayStart = Date.UTC(
      new Date(now).getUTCFullYear(),
      new Date(now).getUTCMonth(),
      new Date(now).getUTCDate(),
    );
    const aggDay = emptyAgg();
    for (const k of k15) if (Number(k[0]) >= dayStart) addKline(aggDay, k);
    rollups.push(toRollup("Today (UTC)", aggDay));

    return { rows, scored, hits, rollups, live };
  });
