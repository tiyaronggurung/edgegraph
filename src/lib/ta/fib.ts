// Fibonacci retracement / extension helpers. Pure math — no I/O.
// Given a swing high and low we produce the standard 6-level retrace grid
// (0/23.6/38.2/50/61.8/78.6/100) plus two extension targets (127.2/161.8).

export interface FibLevel { label: string; ratio: number; price: number; kind: "retrace" | "ext" }

export function fibLevels(hi: number, lo: number): FibLevel[] {
  if (!(hi > lo)) return [];
  const range = hi - lo;
  const rets = [0, 0.236, 0.382, 0.5, 0.618, 0.786, 1] as const;
  const exts = [1.272, 1.618] as const;
  return [
    ...rets.map<FibLevel>((r) => ({
      label: `${(r * 100).toFixed(r === 0 || r === 1 || r === 0.5 ? 0 : 1)}%`,
      ratio: r,
      // For retracement grid we display prices from top (100%) to bottom (0%):
      // 100% = hi, 0% = lo (standard on trading charts when the swing is up).
      price: lo + range * r,
      kind: "retrace",
    })),
    ...exts.map<FibLevel>((r) => ({
      label: `${(r * 100).toFixed(1)}%`,
      ratio: r,
      price: lo + range * r,
      kind: "ext",
    })),
  ];
}

// Standard color per ratio (roughly TradingView palette).
export const FIB_COLORS: Record<string, string> = {
  "0%":     "rgba(148, 163, 184, 0.55)",
  "23.6%":  "rgba(248, 113, 113, 0.60)",
  "38.2%":  "rgba(251, 146, 60, 0.60)",
  "50%":    "rgba(250, 204, 21, 0.65)",
  "61.8%":  "rgba(52, 211, 153, 0.65)",
  "78.6%":  "rgba(96, 165, 250, 0.60)",
  "100%":   "rgba(148, 163, 184, 0.55)",
  "127.2%": "rgba(167, 139, 250, 0.55)",
  "161.8%": "rgba(232, 121, 249, 0.55)",
};
