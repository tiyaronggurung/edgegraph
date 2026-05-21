// Detect short-term Kalshi price movement and grade it against fair value.
// Pure function — operates on the series100 (0-100 YES%) we already compute.

export type MovementKind = "buy_dip" | "fade_spike" | "rising" | "falling" | null;

export interface MovementSignal {
  kind: MovementKind;
  deltaPts: number; // current - prior baseline, in percentage points
  label: string;
  tone: "buy" | "fade" | "info" | "none";
}

const NONE: MovementSignal = { kind: null, deltaPts: 0, label: "", tone: "none" };

/**
 * @param series100  YES probability over time, in percentage points (0..100). Oldest → newest.
 * @param fairProb   Optional fair probability (0..1) from the Fair Value Engine.
 */
export function detectMovement(series100: number[], fairProb?: number | null): MovementSignal {
  if (!series100 || series100.length < 6) return NONE;

  const n = series100.length;
  const current = avg(series100.slice(-3));
  const prior = avg(series100.slice(Math.max(0, n - 8), n - 3));
  const delta = current - prior;

  if (Math.abs(delta) < 5) return NONE;

  const rising = delta > 0;
  const fairPct = typeof fairProb === "number" ? fairProb * 100 : null;

  // Strong, fair-value-corroborated signals first.
  if (fairPct !== null) {
    if (!rising && fairPct >= current + 5) {
      return {
        kind: "buy_dip",
        deltaPts: delta,
        label: `BUY DIP ${delta.toFixed(0)}pts · fair ${fairPct.toFixed(0)}%`,
        tone: "buy",
      };
    }
    if (rising && fairPct <= current - 5) {
      return {
        kind: "fade_spike",
        deltaPts: delta,
        label: `FADE SPIKE +${delta.toFixed(0)}pts · fair ${fairPct.toFixed(0)}%`,
        tone: "fade",
      };
    }
  }

  // Info-only movement.
  return rising
    ? { kind: "rising", deltaPts: delta, label: `↑ Rising +${delta.toFixed(0)}pts`, tone: "info" }
    : { kind: "falling", deltaPts: delta, label: `↓ Falling ${delta.toFixed(0)}pts`, tone: "info" };
}

function avg(xs: number[]): number {
  if (xs.length === 0) return 0;
  return xs.reduce((a, b) => a + b, 0) / xs.length;
}
