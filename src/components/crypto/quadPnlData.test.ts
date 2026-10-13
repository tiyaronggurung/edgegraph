import { describe, expect, it } from "vitest";
import { buildQuadPnlPoints } from "./quadPnlData";

describe("quad paper P&L points", () => {
  it("plots one point per window close and keeps independent totals", () => {
    const points = buildQuadPnlPoints([
      { strategy: "C", window_start: "2026-10-12T12:30:00Z", settled: true, pnl: -3 },
      { strategy: "A", window_start: "2026-10-12T12:00:00Z", settled: true, pnl: "5" },
      { strategy: "B", window_start: "2026-10-12T12:00:00Z", settled: true, pnl: 2 },
      { strategy: "A", window_start: "2026-10-12T12:30:00Z", settled: true, pnl: -1 },
      { strategy: "B", window_start: "2026-10-12T12:45:00Z", settled: false, pnl: 100 },
    ]);
    expect(points).toHaveLength(3);
    expect(points[0]).toMatchObject({ time: Date.parse("2026-10-12T12:00:00Z"), A: 0, B: 0, C: 0 });
    expect(points[1]).toMatchObject({ time: Date.parse("2026-10-12T12:15:00Z"), A: 5, B: 2, windowA: 5, windowB: 2 });
    expect(points[2]).toMatchObject({ time: Date.parse("2026-10-12T12:45:00Z"), A: 4, B: 2, C: -3, windowA: -1, windowC: -3 });
  });
  it("renders a baseline for a single settled window", () => {
    expect(buildQuadPnlPoints([{ strategy: "B", window_start: "2026-10-12T12:00:00Z", settled: true, pnl: 0 }])).toHaveLength(2);
  });
  it("ignores absent or invalid results", () => {
    expect(buildQuadPnlPoints([
      { strategy: "A", window_start: "bad", settled: true, pnl: 2 },
      { strategy: "D", window_start: "2026-10-12T12:00:00Z", settled: true, pnl: 2 },
      { strategy: "A", window_start: "2026-10-12T12:00:00Z", settled: true, pnl: null },
    ])).toEqual([]);
  });
});
