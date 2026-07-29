// Cushion-vs-Volatility (CVV) gate — server only.
//
// Root cause of post-7min flips: locks are taken on *conviction* (ratio of
// ticks on one side) without checking whether the *distance* to the strike is
// large enough to survive normal BTC movement over the remaining time.
//
// Rule:
//   PASS  when  cushion >= cvv_atr_mult * ATR7   AND   adverse 3-min momentum <= cvv_momentum_max_usd
//   SKIP  otherwise
//
// ATR7 = median absolute 7-minute close-to-close move measured over a rolling
// lookback window (default 24h) of 1m candles. Rolling, so it adapts to regime.
//
// Modes:
//   off       -> never evaluated
//   shadow    -> evaluated + logged, lock proceeds regardless
//   enforced  -> evaluated + logged, SKIP blocks the lock (counterfactual still stored)

export interface CvvConfig {
  mode: "off" | "shadow" | "enforced";
  atrMult: number;
  momentumMaxUsd: number;
  atrLookbackHours: number;
}

export const DEFAULT_CVV_CONFIG: CvvConfig = {
  mode: "enforced",
  atrMult: 1.0,
  momentumMaxUsd: 25,
  atrLookbackHours: 24,
};

export interface CvvResult {
  verdict: "PASS" | "SKIP";
  reason: string | null;
  cushionUsd: number;
  atrUsd: number | null;
  momentumUsd: number; // signed; positive = moving toward the picked side
  requiredCushionUsd: number | null;
}

export function readCvvConfig(row: Record<string, unknown> | null | undefined): CvvConfig {
  if (!row) return DEFAULT_CVV_CONFIG;
  const mode = (row.cvv_mode as CvvConfig["mode"]) ?? DEFAULT_CVV_CONFIG.mode;
  return {
    mode: mode === "off" || mode === "shadow" || mode === "enforced" ? mode : "shadow",
    atrMult: Number(row.cvv_atr_mult ?? DEFAULT_CVV_CONFIG.atrMult),
    momentumMaxUsd: Number(row.cvv_momentum_max_usd ?? DEFAULT_CVV_CONFIG.momentumMaxUsd),
    atrLookbackHours: Number(row.cvv_atr_lookback_hours ?? DEFAULT_CVV_CONFIG.atrLookbackHours),
  };
}

function median(xs: number[]): number | null {
  if (!xs.length) return null;
  const s = [...xs].sort((a, b) => a - b);
  const m = s.length >> 1;
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

// Rolling ATR7 in dollars. Cached briefly — it barely moves minute to minute.
let atrCache: { at: number; hours: number; value: number | null } | null = null;
const ATR_TTL_MS = 120_000;

export async function getAtr7Usd(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  supabaseAdmin: any,
  lookbackHours: number,
): Promise<number | null> {
  const now = Date.now();
  if (atrCache && atrCache.hours === lookbackHours && now - atrCache.at < ATR_TTL_MS) {
    return atrCache.value;
  }
  try {
    const sinceIso = new Date(now - lookbackHours * 3_600_000).toISOString();
    const { data } = await supabaseAdmin
      .from("btc_candles")
      .select("c, bucket_start")
      .eq("tf", "1m")
      .gte("bucket_start", sinceIso)
      .order("bucket_start", { ascending: true })
      .limit(2000);
    const closes = ((data ?? []) as Array<{ c: number | string }>)
      .map((r) => Number(r.c))
      .filter((x) => Number.isFinite(x) && x > 0);
    if (closes.length < 60) {
      atrCache = { at: now, hours: lookbackHours, value: null };
      return null;
    }
    const moves: number[] = [];
    for (let i = 7; i < closes.length; i++) moves.push(Math.abs(closes[i] - closes[i - 7]));
    const value = median(moves);
    atrCache = { at: now, hours: lookbackHours, value };
    return value;
  } catch {
    return null;
  }
}

export function invalidateAtrCache() {
  atrCache = null;
}

/**
 * Signed 3-min momentum relative to the picked side.
 * Positive => price moved toward the picked side (good).
 * Negative => price moved against it (bad); magnitude compared to the cap.
 */
export function signedMomentumUsd(
  spotsNewestFirst: number[],
  side: "YES" | "NO",
  windowSeconds = 180,
  tickSpacingSeconds = 0.5,
): number {
  if (spotsNewestFirst.length < 4) return 0;
  const idx = Math.min(
    spotsNewestFirst.length - 1,
    Math.max(2, Math.round(windowSeconds / Math.max(tickSpacingSeconds, 0.1))),
  );
  const delta = spotsNewestFirst[0] - spotsNewestFirst[idx];
  return side === "YES" ? delta : -delta;
}

export function evaluateCvv(args: {
  cfg: CvvConfig;
  spot: number;
  strike: number;
  side: "YES" | "NO";
  atrUsd: number | null;
  momentumUsd: number;
}): CvvResult {
  const { cfg, spot, strike, side, atrUsd, momentumUsd } = args;
  const cushionUsd = Math.abs(spot - strike);
  const requiredCushionUsd = atrUsd != null ? atrUsd * cfg.atrMult : null;

  const reasons: string[] = [];
  if (requiredCushionUsd != null && cushionUsd < requiredCushionUsd) {
    reasons.push(`cushion_${cushionUsd.toFixed(0)}<atr7x${cfg.atrMult}_${requiredCushionUsd.toFixed(0)}`);
  }
  // Momentum is judged RELATIVE to the cushion: a $26 swing is harmless behind a
  // $149 cushion but fatal behind a $4 one. cvv_momentum_max_usd is now only an
  // absolute ceiling for very large cushions.
  const momentumLimitUsd = Math.min(0.6 * cushionUsd, Math.max(cfg.momentumMaxUsd, 0.6 * cushionUsd));
  if (momentumUsd < -momentumLimitUsd) {
    reasons.push(`adverse_momentum_${Math.abs(momentumUsd).toFixed(0)}>${momentumLimitUsd.toFixed(0)}`);
  }



  return {
    verdict: reasons.length ? "SKIP" : "PASS",
    reason: reasons.length ? reasons.join("+") : null,
    cushionUsd: Number(cushionUsd.toFixed(2)),
    atrUsd: atrUsd == null ? null : Number(atrUsd.toFixed(2)),
    momentumUsd: Number(momentumUsd.toFixed(2)),
    requiredCushionUsd: requiredCushionUsd == null ? null : Number(requiredCushionUsd.toFixed(2)),
  };
}

// Convenience for the hook: side is only known after consensus.
export { median as _median };
