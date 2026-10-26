// Situation buckets for the 5m paper bot's learning table. Pure.
import type { Side } from "./decide";

export type SituationInput = {
  side: Side;
  odds: number; // our odds on the side
  edge: number; // our odds minus Polymarket ask
  elapsedSec: number;
  flowImbalance: number | null; // + = buyers
  areaUp: number | null; // 0–1 share of 50-lobe area on UP
  rangePct: number | null; // last-2-min price range as % of price
};

export function situationKey(s: SituationInput): string {
  const conv = s.odds >= 0.8 ? "c80+" : s.odds >= 0.7 ? "c70-80" : "c65-70";
  const edge = s.edge >= 0.2 ? "e20+" : s.edge >= 0.1 ? "e10-20" : "e5-10";
  const time = s.elapsedSec < 120 ? "early" : "mid";
  const dir = s.side === "UP" ? 1 : -1;
  const flow = s.flowImbalance == null || s.flowImbalance === 0 ? "flow?" : s.flowImbalance * dir > 0 ? "flow+" : "flow-";
  const area = s.areaUp == null ? "area?" : (s.areaUp - 0.5) * dir > 0 ? "area+" : "area-";
  const vol = s.rangePct == null ? "vol?" : s.rangePct >= 0.08 ? "fast" : "calm";
  return [conv, edge, time, flow, area, vol].join("|");
}

/** Expiration-weighted 50-lobe area share on UP from [sec, upMilli] points. */
export function areaUpFromPoints(points: [number, number][], winSec = 300): number | null {
  let aUp = 0, aDn = 0;
  for (let i = 1; i < points.length; i++) {
    const [s0, u0] = points[i - 1];
    const [s1] = points[i];
    const dt = Math.min(s1 - s0, 10);
    if (!(dt > 0)) continue;
    const w = dt / Math.sqrt(Math.max(1, winSec - s1));
    const m = u0 / 1000 - 0.5;
    if (m > 0) aUp += m * w; else aDn += -m * w;
  }
  return aUp + aDn > 0 ? aUp / (aUp + aDn) : null;
}
