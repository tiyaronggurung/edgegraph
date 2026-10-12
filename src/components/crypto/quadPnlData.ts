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

// Plot realized results at window close, not at the delayed settlement-job time.
export function buildQuadPnlPoints(positions: QuadPnlPosition[]): QuadPnlPoint[] {
  const windows = new Map<number, Record<QuadStrategy, number>>();
  for (const position of positions) {
    if (!position.settled || !QUAD_STRATEGIES.some((s) => s === position.strategy)) continue;
    const start = Date.parse(position.window_start);
    if (!Number.isFinite(start) || position.pnl == null || !Number.isFinite(Number(position.pnl))) continue;
    const close = Math.floor(start / WINDOW_MS) * WINDOW_MS + WINDOW_MS;
    const result = windows.get(close) ?? { A: 0, B: 0, C: 0 };
    result[position.strategy as QuadStrategy] += Number(position.pnl);
    windows.set(close, result);
  }
  const times = [...windows.keys()].sort((a, b) => a - b);
  const first = times[0];
  const last = times.at(-1);
  if (first == null || last == null) return [];
  const totals = { A: 0, B: 0, C: 0 };
  const points: QuadPnlPoint[] = [{ time: first - WINDOW_MS, ...totals, windowA: 0, windowB: 0, windowC: 0 }];
  for (let time = first; time <= last; time += WINDOW_MS) {
    const delta = windows.get(time) ?? { A: 0, B: 0, C: 0 };
    for (const strategy of QUAD_STRATEGIES) totals[strategy] += delta[strategy];
    points.push({ time, ...totals, windowA: delta.A, windowB: delta.B, windowC: delta.C });
  }
  return points;
}