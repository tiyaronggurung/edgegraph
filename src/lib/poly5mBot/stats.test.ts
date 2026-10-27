import { describe, expect, it } from "vitest";
import { paperStats, readAllStatsPositions } from "./stats";

describe("5m paper statistics", () => {
  it("includes all settled history and separates the New York day", () => {
    const stats = paperStats([
      { settled: true, pnl: 10, window_start: "2026-10-27T03:59:00Z" },
      { settled: true, pnl: -3, window_start: "2026-10-27T04:00:00Z" },
      { settled: true, pnl: 5, window_start: "2026-10-27T14:00:00Z" },
      { settled: false, pnl: 100, window_start: "2026-10-27T14:05:00Z" },
    ], new Date("2026-10-27T14:12:00Z"));
    expect(stats.all).toEqual({ pnl: 12, count: 3, wins: 2 });
    expect(stats.today).toEqual({ pnl: 2, count: 2, wins: 1 });
  });
  it("reads beyond the 1000-row API cap", async () => {
    const rows = Array.from({ length: 1001 }, () => ({ settled: true, pnl: 1, window_start: "2026-10-27T14:00:00Z" }));
    const calls: number[][] = [];
    const result = await readAllStatsPositions(async (from, to) => {
      calls.push([from, to]);
      return rows.slice(from, to + 1);
    });
    expect(calls).toEqual([[0, 999], [1000, 1999]]);
    expect(paperStats(result).all.pnl).toBe(1001);
  });
});