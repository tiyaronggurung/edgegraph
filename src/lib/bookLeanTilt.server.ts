// Book-lean tilt for the Study Pick path — server only.
//
// Kalshi's book collects taker dollars on both sides of a 15m window. The side
// with the smaller payout liability is the side the house profits from
// ("house lean"). The house does not want to lose money, and historically the
// crowded (high-liability) side is the one that gets paid out less often.
//
// So we use the live book economics as a *tilt*, never as an override:
//   study side AGREES with house lean  -> easier consensus threshold
//   study side FIGHTS the house lean   -> harder threshold, and a hard skip
//                                          when the lean is heavy and the
//                                          study confidence is only marginal.
//
// Neutral books (small lean, thin volume) change nothing.

export interface BookLedgerRow {
  ticker: string;
  total_collected: number | null;
  house_if_yes: number | null;
  house_if_no: number | null;
  house_lean: string | null;
  yes_vol: number | null;
  no_vol: number | null;
}

export interface BookLeanTilt {
  lean: "YES" | "NO" | null;
  /** 0..1 — how lopsided the house economics are for this window. */
  strength: number;
  /** delta applied to the consensus threshold (negative = easier). */
  thresholdDelta: number;
  /** true when the lock should be blocked outright. */
  block: boolean;
  reason: string | null;
}

export const BOOK_LEAN_NEUTRAL: BookLeanTilt = {
  lean: null,
  strength: 0,
  thresholdDelta: 0,
  block: false,
  reason: null,
};

// Tuning knobs — deliberately gentle so the book never dominates physics.
const MIN_STRENGTH = 0.05; // below this the book is effectively balanced
const HEAVY_STRENGTH = 0.25; // lopsided book
const MIN_CONTRACTS = 5_000; // ignore thin windows
const AGREE_BONUS = 0.03; // threshold made easier
const FIGHT_PENALTY = 0.05; // threshold made harder
const FIGHT_MIN_CONF = 0.88; // conf needed to fight a heavy book

export function computeBookLeanTilt(
  row: BookLedgerRow | null | undefined,
  side: "YES" | "NO",
  confFrac: number,
): BookLeanTilt {
  if (!row) return BOOK_LEAN_NEUTRAL;

  const contracts = (Number(row.yes_vol) || 0) + (Number(row.no_vol) || 0);
  const hy = Number(row.house_if_yes);
  const hn = Number(row.house_if_no);
  const collected = Number(row.total_collected) || 0;
  if (!Number.isFinite(hy) || !Number.isFinite(hn) || collected <= 0) return BOOK_LEAN_NEUTRAL;
  if (contracts < MIN_CONTRACTS) return BOOK_LEAN_NEUTRAL;

  const lean: "YES" | "NO" = hy >= hn ? "YES" : "NO";
  const strength = Math.min(1, Math.abs(hy - hn) / collected);
  if (strength < MIN_STRENGTH) return { ...BOOK_LEAN_NEUTRAL, lean, strength: Number(strength.toFixed(3)) };

  const agrees = lean === side;
  if (agrees) {
    return {
      lean,
      strength: Number(strength.toFixed(3)),
      thresholdDelta: -AGREE_BONUS,
      block: false,
      reason: `book_lean_agrees_${lean}_${(strength * 100).toFixed(0)}pct`,
    };
  }

  const heavy = strength >= HEAVY_STRENGTH;
  const block = heavy && confFrac < FIGHT_MIN_CONF;
  return {
    lean,
    strength: Number(strength.toFixed(3)),
    thresholdDelta: FIGHT_PENALTY,
    block,
    reason: block
      ? `book_lean_against_${lean}_${(strength * 100).toFixed(0)}pct_conf<${Math.round(FIGHT_MIN_CONF * 100)}`
      : `book_lean_against_${lean}_${(strength * 100).toFixed(0)}pct`,
  };
}
