export const QUAD_STRATEGIES = ["A", "B", "C"] as const;
export type QuadStrategy = (typeof QUAD_STRATEGIES)[number];
export type QuadPnlPosition = {
  strategy: string;
  window_start: string;
  settled: boolean;
  pnl: number | string | null;
};
export type QuadPnlPoint = {
  time: number;
  A: number; B: number; C: number;
  windowA: number; windowB: number; windowC: number;
};
const WINDOW_MS = 15 * 60 * 1000;

// One point per real settlement moment (window close = start + 15m), so the
// line connects results directly (Polymarket-style) instead of flat staircases.
export function buildQuadPnlPoints(positions: QuadPnlPosition[]): QuadPnlPoint[] {
  const events = new Map<number, Record<QuadStrategy, number>>();
  for (const position of positions) {
    if (!position.settled || !QUAD_STRATEGIES.some((s) => s === position.strategy)) continue;
    const start = Date.parse(position.window_start);
    if (!Number.isFinite(start) || position.pnl == null || !Number.isFinite(Number(position.pnl))) continue;
    const close = start + WINDOW_MS;
    const result = events.get(close) ?? { A: 0, B: 0, C: 0 };
    result[position.strategy as QuadStrategy] += Number(position.pnl);
    events.set(close, result);
  }
  const times = [...events.keys()].sort((a, b) => a - b);
  if (!times.length) return [];
  const totals = { A: 0, B: 0, C: 0 };
  const points: QuadPnlPoint[] = [{ time: times[0] - WINDOW_MS, ...totals, windowA: 0, windowB: 0, windowC: 0 }];
  for (const time of times) {
    const delta = events.get(time)!;
    for (const strategy of QUAD_STRATEGIES) totals[strategy] += delta[strategy];
    points.push({ time, ...totals, windowA: delta.A, windowB: delta.B, windowC: delta.C });
  }
  return points;
}
