import { describe, expect, it } from "vitest";
import { buildHourlyForecast } from "@/lib/hourlyBtcForecast";
import { checkpointFor } from "@/lib/hourlyForecastTracking.functions";
import type { TCandle } from "@/lib/ta/trendlines";

const HOUR = 3_600_000;
const MINUTE = 60_000;
const windowStart = Date.UTC(2026, 8, 10, 18, 0, 0);

function candles(count: number, stepMs: number, startPrice: number, stepPrice: number, endAt = windowStart): TCandle[] {
  return Array.from({ length: count }, (_, index) => {
    const close = startPrice + index * stepPrice;
    return {
      t: endAt - (count - index) * stepMs,
      o: close - stepPrice / 2,
      h: close + 12,
      l: close - 12,
      c: close,
      v: 100 + index,
    };
  });
}

function input(nowMs: number) {
  const prior = candles(120, MINUTE, 76_000, 2);
  const opening = candles(20, MINUTE, 76_240, 3, windowStart + 20 * MINUTE);
  return {
    nowMs,
    spot: 76_300,
    candles1m: [...prior, ...opening],
    candles5m: candles(120, 5 * MINUTE, 75_800, 8, nowMs),
    candles15m: candles(120, 15 * MINUTE, 75_000, 12, nowMs),
    candles1h: candles(120, HOUR, 70_000, 45, nowMs),
  };
}

describe("buildHourlyForecast", () => {
  it("keeps higher target probabilities monotonically lower", () => {
    const result = buildHourlyForecast(input(windowStart + 20 * MINUTE));
    for (let index = 1; index < result.ladder.length; index += 1) {
      expect(result.ladder[index].aboveProbability).toBeLessThanOrEqual(result.ladder[index - 1].aboveProbability);
    }
  });

  it("holds Study in studying state before the 15-minute lock", () => {
    const result = buildHourlyForecast(input(windowStart + 10 * MINUTE));
    expect(result.model).not.toBeNull();
    expect(result.study).toBeNull();
    expect(result.verdict).toBe("STUDYING");
  });

  it("locks Study after the observation period", () => {
    const result = buildHourlyForecast(input(windowStart + 20 * MINUTE));
    expect(result.study).not.toBeNull();
    expect(result.study?.lockedAt).toBe(windowStart + 15 * MINUTE);
  });

  it("widens the expected move when realized volatility increases", () => {
    const quiet = input(windowStart + 20 * MINUTE);
    const volatile = input(windowStart + 20 * MINUTE);
    volatile.candles1m = volatile.candles1m.map((candle, index) => ({
      ...candle,
      c: candle.c + (index % 2 === 0 ? 180 : -180),
    }));
    expect(buildHourlyForecast(volatile).expectedMoveUsd).toBeGreaterThan(buildHourlyForecast(quiet).expectedMoveUsd);
  });

  it("maps time to fixed hourly checkpoints", () => {
    expect(checkpointFor(3_570, 30)).toBe("OPEN");
    expect(checkpointFor(2_700, 900)).toBe("STUDY_LOCK");
    expect(checkpointFor(1_800, 1_800)).toBe("T30");
    expect(checkpointFor(300, 3_300)).toBe("T5");
  });
});