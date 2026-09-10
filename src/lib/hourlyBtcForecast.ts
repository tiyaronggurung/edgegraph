import { normCdf, realizedVol1m } from "@/lib/ownModel/ownModel";
import { detectTrendlines, type TCandle } from "@/lib/ta/trendlines";
import { emaSeries, structure } from "@/lib/ta/taEngine";
import type { Candle } from "@/lib/ta/chartSignals";

export const HOURLY_MODEL_VERSION = "h1-diffusion-v1";
export const HOURLY_STUDY_LOCK_MINUTE = 15;

export type HourlySide = "UP" | "DOWN";

export interface HourlyForecastInput {
  nowMs: number;
  spot: number;
  candles1m: TCandle[];
  candles5m: TCandle[];
  candles15m: TCandle[];
  candles1h: TCandle[];
}

export interface HourlyLadderRow {
  target: number;
  aboveProbability: number;
  belowProbability: number;
  distanceUsd: number;
}

export interface HourlyLockedPick {
  side: HourlySide;
  confidence: number;
  lockedAt: number;
  score: number;
}

export interface HourlyForecast {
  windowStart: number;
  windowEnd: number;
  secondsLeft: number;
  hourlyOpen: number;
  expectedMoveUsd: number;
  buy: number | null;
  mid: number | null;
  sell: number | null;
  vwap: number | null;
  model: HourlyLockedPick | null;
  study: HourlyLockedPick | null;
  verdict: "AGREE" | "DISAGREE" | "STUDYING" | "INSUFFICIENT_DATA";
  ladder: HourlyLadderRow[];
  volumeNow: number;
  volumeAverage: number;
  dataAsOf: number | null;
  modelVersion: string;
}

const HOUR_MS = 3_600_000;
const MINUTE_MS = 60_000;
const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));

function indicatorCandles(candles: TCandle[]): Candle[] {
  return candles.map((candle) => ({ ...candle, v: candle.v ?? 0 }));
}

function lastCloseAt(candles: TCandle[], cutoff: number): number | null {
  const eligible = candles.filter((candle) => candle.t <= cutoff);
  return eligible.length ? eligible[eligible.length - 1].c : null;
}

function trendVote(candles: TCandle[], cutoff: number): number {
  const eligible = candles.filter((candle) => candle.t <= cutoff).slice(-60);
  if (eligible.length < 10) return 0;
  const closes = eligible.map((candle) => candle.c);
  const fast = emaSeries(closes, 9);
  const slow = emaSeries(closes, 21);
  const emaVote = fast[fast.length - 1] >= slow[slow.length - 1] ? 1 : -1;
  const shape = structure(indicatorCandles(eligible), 5);
  return emaVote + (shape === "up" ? 1 : shape === "down" ? -1 : 0);
}

function makeLockedPick(score: number, lockedAt: number): HourlyLockedPick {
  const bounded = clamp(score, -4, 4);
  return {
    side: bounded >= 0 ? "UP" : "DOWN",
    confidence: clamp(0.5 + Math.abs(bounded) * 0.105, 0.52, 0.92),
    lockedAt,
    score: bounded,
  };
}

function openingPrice(candles: TCandle[], windowStart: number, fallback: number): number {
  const opening = candles.find((candle) => candle.t >= windowStart && candle.t < windowStart + MINUTE_MS);
  return opening?.o ?? lastCloseAt(candles, windowStart) ?? fallback;
}

function modelPick(input: HourlyForecastInput, windowStart: number): HourlyLockedPick | null {
  const prior1m = input.candles1m.filter((candle) => candle.t < windowStart).slice(-60);
  if (prior1m.length < 20) return null;
  const closes = prior1m.map((candle) => candle.c);
  const drift20 = closes[closes.length - 1] - closes[Math.max(0, closes.length - 21)];
  const scale = Math.max(closes[closes.length - 1] * realizedVol1m(closes) * Math.sqrt(60), 1);
  const diffusionScore = clamp(drift20 / scale, -1.5, 1.5);
  const score = diffusionScore
    + trendVote(input.candles5m, windowStart) * 0.55
    + trendVote(input.candles15m, windowStart) * 0.7
    + trendVote(input.candles1h, windowStart) * 0.45;
  return makeLockedPick(score, windowStart);
}

function studyPick(
  input: HourlyForecastInput,
  windowStart: number,
  hourlyOpen: number,
): HourlyLockedPick | null {
  const lockAt = windowStart + HOURLY_STUDY_LOCK_MINUTE * MINUTE_MS;
  if (input.nowMs < lockAt) return null;
  const lockSpot = lastCloseAt(input.candles1m, lockAt);
  if (lockSpot == null) return null;
  const lockTrend = detectTrendlines(input.candles5m.filter((candle) => candle.t <= lockAt));
  const lockBuy = lockTrend.lowerAtNow;
  const lockSell = lockTrend.upperAtNow;
  const lockMid = lockBuy != null && lockSell != null && lockBuy < lockSell
    ? (lockBuy + lockSell) / 2
    : null;
  const moveScale = Math.max(hourlyOpen * realizedVol1m(
    input.candles1m.filter((candle) => candle.t <= lockAt).slice(-60).map((candle) => candle.c),
  ) * Math.sqrt(45), 1);
  const openingMove = clamp((lockSpot - hourlyOpen) / moveScale, -1.5, 1.5);
  const midVote = lockMid == null ? 0 : lockSpot >= lockMid ? 1 : -1;
  const breakoutVote = lockSell != null && lockSpot > lockSell
    ? 0.8
    : lockBuy != null && lockSpot < lockBuy ? -0.8 : 0;
  const score = openingMove
    + midVote * 0.8
    + breakoutVote
    + trendVote(input.candles5m, lockAt) * 0.45
    + trendVote(input.candles15m, lockAt) * 0.55;
  return makeLockedPick(score, lockAt);
}

function ladderTargets(spot: number): number[] {
  const center = Math.round(spot / 100) * 100;
  return Array.from({ length: 9 }, (_, index) => center + (index - 4) * 100);
}

function weightedTypicalPrice(candles: TCandle[]): number | null {
  if (!candles.length) return null;
  let priceVolume = 0;
  let volume = 0;
  for (const candle of candles) {
    const weight = candle.v ?? 1;
    priceVolume += ((candle.h + candle.l + candle.c) / 3) * weight;
    volume += weight;
  }
  return volume > 0 ? priceVolume / volume : null;
}

export function buildHourlyForecast(input: HourlyForecastInput): HourlyForecast {
  const windowStart = Math.floor(input.nowMs / HOUR_MS) * HOUR_MS;
  const windowEnd = windowStart + HOUR_MS;
  const secondsLeft = Math.max(1, Math.floor((windowEnd - input.nowMs) / 1000));
  const hourlyOpen = openingPrice(input.candles1m, windowStart, input.spot);
  const closed5m = input.candles5m.filter((candle) => candle.t < input.nowMs).slice(-90);
  const channelCandles = input.candles15m.filter((candle) => candle.t < input.nowMs).slice(-90);
  const trend = detectTrendlines(channelCandles);
  const validChannel = trend.lowerAtNow != null && trend.upperAtNow != null && trend.lowerAtNow < trend.upperAtNow;
  const buy = validChannel ? trend.lowerAtNow : null;
  const sell = validChannel ? trend.upperAtNow : null;
  const mid = buy != null && sell != null ? (buy + sell) / 2 : null;
  const vwap = weightedTypicalPrice(closed5m.filter((candle) => candle.t >= windowStart));
  const closes1m = input.candles1m.filter((candle) => candle.t <= input.nowMs).slice(-120).map((candle) => candle.c);
  const volatility = realizedVol1m(closes1m);
  const expectedMoveUsd = Math.max(input.spot * volatility * Math.sqrt(secondsLeft / 60), 1);
  const currentBias = trendVote(input.candles5m, input.nowMs) * 0.08
    + trendVote(input.candles15m, input.nowMs) * 0.1
    + trendVote(input.candles1h, input.nowMs) * 0.08;
  const model = modelPick(input, windowStart);
  const study = studyPick(input, windowStart, hourlyOpen);
  const driftUsd = clamp(currentBias * expectedMoveUsd, -expectedMoveUsd * 0.35, expectedMoveUsd * 0.35);
  const ladder = ladderTargets(input.spot).map((target) => {
    const z = (input.spot + driftUsd - target) / expectedMoveUsd;
    const aboveProbability = clamp(normCdf(z), 0.005, 0.995);
    return { target, aboveProbability, belowProbability: 1 - aboveProbability, distanceUsd: target - input.spot };
  });
  const recent5m = closed5m.slice(-12);
  const volumeNow = recent5m[recent5m.length - 1]?.v ?? 0;
  const volumeAverage = recent5m.length
    ? recent5m.reduce((sum, candle) => sum + (candle.v ?? 0), 0) / recent5m.length
    : 0;
  const dataAsOf = Math.max(
    input.candles1m[input.candles1m.length - 1]?.t ?? 0,
    input.candles5m[input.candles5m.length - 1]?.t ?? 0,
  ) || null;
  const verdict = model == null
    ? "INSUFFICIENT_DATA"
    : study == null
      ? "STUDYING"
      : model.side === study.side ? "AGREE" : "DISAGREE";

  return {
    windowStart, windowEnd, secondsLeft, hourlyOpen, expectedMoveUsd,
    buy, mid, sell, vwap, model, study, verdict, ladder,
    volumeNow, volumeAverage, dataAsOf, modelVersion: HOURLY_MODEL_VERSION,
  };
}