import { describe, expect, it } from "vitest";
import { buildHourlyForecast } from "@/lib/hourlyBtcForecast";
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
});