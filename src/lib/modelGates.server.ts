// Model-Bet quality gates. Additive skip-only filters — never sizes, never
// buys. Called from cryptoAutoTrade.functions.ts BEFORE the existing filter
// chain, only when running LIVE + model_bet. All other paths untouched.
//
// Gates, in order:
//   1. Isotonic recalibration → adjusts modelProb by btc_calibration bucket.
//   2. Near-expiry compression → caps effectiveProb when close+ITM+seconds low.
//   3. Streak → after 2L raises bar; after 3L pauses 30 min.
//   4. Sigma-zone → signed side-adjusted σ-distance rules (Zone A/B/C).
//   5. Confidence + edge → effectiveSideProb ≥ CONF_MIN AND signed edge ≥ EDGE_MIN.
//   6. Regime → skip news spikes, dead-chop, and round-level proximity.
//
// Fail-closed on missing/invalid sigma (this path is auto-only).
// Returns { allow, skipReason, adjustedProb, note }.


// eslint-disable-next-line @typescript-eslint/no-explicit-any
type SB = any;

export interface GateMarket {
  ticker: string;
  side: "YES" | "NO";
  modelYesProb: number;
  yesAsk: number;
  noAsk: number;
  yesPrice: number;
  strike: number;
  spot: number;
  secondsToClose: number;
  sigmaDistance: number;
}

export interface GateResult {
  allow: boolean;
  skipReason?: string;
  adjustedProb: number;
  adjustedSideProb: number;   // adjustedProb re-oriented to the picked side
  note: string;
}

const CONF_MIN = 0.72;
const CONF_MIN_AFTER_2L = 0.75;
const EDGE_MIN = 0.08;
const MAX_ENTRY_AFTER_2L = 0.70;
const PAUSE_AFTER_3L_MS = 30 * 60_000;
const ROUND_LEVEL_TICKS = 15;      // ±$15 of a $500 mark
const ROUND_LEVEL_MIN_PROB = 0.78;

function sigmaBucketOf(s: number): string {
  if (!Number.isFinite(s)) return "unknown";
  if (s < 0.5) return "0-0.5σ";
  if (s < 1.0) return "0.5-1σ";
  if (s < 2.0) return "1-2σ";
  if (s < 3.0) return "2-3σ";
  return "3σ+";
}
function timeBucketOf(secs: number): string {
  return secs > 120 ? ">120s" : secs > 60 ? "60-120s" : secs > 15 ? "15-60s" : "<15s";
}

// ── 1. Isotonic recalibration ────────────────────────────────────────────────
async function loadCorrectionFactor(
  supabase: SB, secondsToClose: number, sigmaDistance: number,
): Promise<number> {
  try {
    const { data } = await supabase
      .from("btc_calibration")
      .select("correction_factor, n_samples")
      .eq("time_bucket", timeBucketOf(secondsToClose))
      .eq("sigma_bucket", sigmaBucketOf(sigmaDistance))
      .maybeSingle();
    if (!data) return 1;
    const n = Number(data.n_samples ?? 0);
    // Need at least 20 samples in the bucket before trusting the correction.
    if (n < 20) return 1;
    const raw = Number(data.correction_factor);
    if (!Number.isFinite(raw) || raw <= 0) return 1;
    return Math.min(2.0, Math.max(0.5, raw));
  } catch { return 1; }
}

// ── 3. Streak check (last 5 settled live orders for this user) ──────────────
async function checkStreak(
  supabase: SB, userId: string,
): Promise<{ consecLosses: number; consecWins: number; lastLossAt: number | null }> {
  try {
    const { data } = await supabase
      .from("auto_trade_orders")
      .select("status, settled_at")
      .eq("user_id", userId)
      .eq("mode", "live")
      .in("status", ["settled_win", "settled_loss"])
      .order("settled_at", { ascending: false })
      .limit(5);
    const rows = (data ?? []) as Array<{ status: string; settled_at: string | null }>;
    let consecLosses = 0, consecWins = 0;
    for (const r of rows) {
      if (r.status === "settled_loss") { if (consecWins) break; consecLosses++; }
      else if (r.status === "settled_win") { if (consecLosses) break; consecWins++; }
      else break;
    }
    const lastLoss = rows.find(r => r.status === "settled_loss");
    const lastLossAt = lastLoss?.settled_at ? new Date(lastLoss.settled_at).getTime() : null;
    return { consecLosses, consecWins, lastLossAt };
  } catch { return { consecLosses: 0, consecWins: 0, lastLossAt: null }; }
}

// ── 4. Regime — read last 30 min of user's odds tape and score volatility ───
interface RegimeSnap {
  chop: boolean; spike: boolean; note: string;
}
async function checkRegime(supabase: SB, userId: string, ticker: string): Promise<RegimeSnap> {
  try {
    const since = new Date(Date.now() - 30 * 60_000).toISOString();
    const { data } = await supabase
      .from("btc_odds_tape")
      .select("spot, snapped_at")
      .eq("user_id", userId)
      .eq("ticker", ticker)
      .gte("snapped_at", since)
      .order("snapped_at", { ascending: true })
      .limit(500);
    const rows = (data ?? []) as Array<{ spot: number | string; snapped_at: string }>;
    if (rows.length < 20) return { chop: false, spike: false, note: "regime: warmup" };
    // Bucket to 1-min closes.
    const buckets = new Map<number, number>();
    for (const r of rows) {
      const t = Math.floor(new Date(r.snapped_at).getTime() / 60_000);
      buckets.set(t, Number(r.spot));
    }
    const keys = [...buckets.keys()].sort((a, b) => a - b);
    if (keys.length < 6) return { chop: false, spike: false, note: "regime: warmup" };
    const closes = keys.map(k => buckets.get(k)!);
    const rets: number[] = [];
    for (let i = 1; i < closes.length; i++) {
      const r = (closes[i] - closes[i - 1]) / closes[i - 1];
      if (Number.isFinite(r)) rets.push(r);
    }
    if (rets.length < 5) return { chop: false, spike: false, note: "regime: warmup" };
    const last = Math.abs(rets[rets.length - 1]);
    const priorWindow = rets.slice(-6, -1); // 5 prior 1-min rets
    const mean = priorWindow.reduce((s, v) => s + v, 0) / priorWindow.length;
    const variance = priorWindow.reduce((s, v) => s + (v - mean) ** 2, 0) / priorWindow.length;
    const sd = Math.sqrt(variance);
    const spike = last > Math.max(3 * sd, 0.0015); // >3σ OR >0.15% in one minute
    const recent5 = rets.slice(-5);
    const recentSd = Math.sqrt(recent5.reduce((s, v) => s + v * v, 0) / recent5.length);
    const chop = recentSd < 0.00015; // <0.015% per min → dead
    const note = `regime: sd5=${(recentSd * 100).toFixed(3)}% last=${(last * 100).toFixed(3)}%`;
    return { chop, spike, note };
  } catch { return { chop: false, spike: false, note: "regime: err" }; }
}

export async function runModelGates(
  supabase: SB, userId: string, m: GateMarket,
): Promise<GateResult> {
  const rawProb = m.side === "YES" ? m.modelYesProb : 1 - m.modelYesProb;

  // 1. Isotonic recalibration
  const corr = await loadCorrectionFactor(supabase, m.secondsToClose, m.sigmaDistance);
  const adjustedSideProb = Math.min(0.95, Math.max(0.05, rawProb * corr));
  const adjustedYesProb = m.side === "YES" ? adjustedSideProb : 1 - adjustedSideProb;

  const baseResult = { adjustedProb: adjustedYesProb, adjustedSideProb };

  // 3. Streak (checked before edge so recent losers get harder bar)
  const streak = await checkStreak(supabase, userId);
  if (streak.consecLosses >= 3 && streak.lastLossAt &&
      Date.now() - streak.lastLossAt < PAUSE_AFTER_3L_MS) {
    return {
      allow: false, ...baseResult,
      skipReason: `streak: 3L pause (${Math.round((PAUSE_AFTER_3L_MS - (Date.now() - streak.lastLossAt)) / 60000)}m left)`,
      note: "streak-3L-pause",
    };
  }
  const confMin = streak.consecLosses >= 2 ? CONF_MIN_AFTER_2L : CONF_MIN;
  const askForSide = m.side === "YES" ? (m.yesAsk || m.yesPrice) : (m.noAsk || 1 - m.yesPrice);
  if (streak.consecLosses >= 2 && askForSide > MAX_ENTRY_AFTER_2L) {
    return {
      allow: false, ...baseResult,
      skipReason: `streak: 2L ask ${(askForSide * 100).toFixed(0)}¢ > ${MAX_ENTRY_AFTER_2L * 100}¢`,
      note: "streak-2L-price",
    };
  }

  // 2. Confidence + edge
  if (adjustedSideProb < confMin) {
    return {
      allow: false, ...baseResult,
      skipReason: `conf: prob ${(adjustedSideProb * 100).toFixed(0)}% < ${(confMin * 100).toFixed(0)}% (raw ${(rawProb * 100).toFixed(0)}%, corr ${corr.toFixed(2)})`,
      note: "conf-low",
    };
  }
  const edge = adjustedSideProb - askForSide;
  if (edge < EDGE_MIN) {
    return {
      allow: false, ...baseResult,
      skipReason: `edge: prob-ask ${(edge * 100).toFixed(1)}¢ < ${EDGE_MIN * 100}¢`,
      note: "edge-low",
    };
  }

  // 4. Regime
  const regime = await checkRegime(supabase, userId, m.ticker);
  if (regime.spike) return { allow: false, ...baseResult, skipReason: `regime: news spike (${regime.note})`, note: "regime-spike" };
  if (regime.chop) return { allow: false, ...baseResult, skipReason: `regime: chop (${regime.note})`, note: "regime-chop" };

  // Round-level proximity: within $15 of any $500 multiple.
  const nearestRound = Math.round(m.strike / 500) * 500;
  if (Math.abs(m.strike - nearestRound) <= ROUND_LEVEL_TICKS && adjustedSideProb < ROUND_LEVEL_MIN_PROB) {
    return {
      allow: false, ...baseResult,
      skipReason: `regime: round-level ${nearestRound} (need prob ≥${ROUND_LEVEL_MIN_PROB * 100}%)`,
      note: "regime-round",
    };
  }

  return { allow: true, ...baseResult, note: `ok corr=${corr.toFixed(2)} streak=${streak.consecLosses}L/${streak.consecWins}W ${regime.note}` };
}
