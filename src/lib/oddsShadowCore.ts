// Pure logic for the odds-flip shadow trader.
// No supabase/network here — safe to import from anywhere.

export const WINDOW = 900;
export const STALE_SECONDS = 20; // tape freshness cutoff (#2 proxy)
export const FLIP_COOLDOWN_SECONDS = 20; // (#5)
// Re-entry (pullback) params.
export const REENTRY_RAN_TO = 78;      // must have run ≥78¢ at some earlier snap
export const REENTRY_MIN_BAND = 55;    // current leader cents floor
export const REENTRY_MAX_BAND = 70;    // current leader cents ceiling (tighter than first-entry)
export const REENTRY_MIN_TIME = 120;   // ≥2 min left
export const STABILITY_TICKS = 3; // (#4) consecutive same-leader snaps
export const MIN_TIME_TO_ENTER = 30; // don't fire in the final 30s

export interface Row {
  ticker: string; strike: number; spot: number;
  yes_cents: number; no_cents: number;
  seconds_to_close: number; snapped_at: string;
}

export type Trigger = "leader_chase" | "flip_fade";

export interface Decision {
  ticker: string; strike: number; spot: number;
  side: "YES" | "NO"; trigger: Trigger;
  yes_cents: number; no_cents: number;
  seconds_to_close: number;
  flip_count: number;
  velocity: number;
}

export interface Skip {
  reason: string;
  trigger_candidate?: Trigger | null;
  yes_cents?: number; no_cents?: number;
  seconds_to_close?: number; flip_count?: number;
  detail?: Record<string, unknown> | null;
}

type CalMap = Record<string, { min_cents: number; max_cents: number; min_velocity: number }>;

function leaderOf(yes: number): "YES" | "NO" | "TIE" {
  if (yes > 50) return "YES";
  if (yes < 50) return "NO";
  return "TIE";
}

// Strict regression-based chop detector on the 15-min tape.
// Fits linear regression of yes_cents and no_cents vs time (minutes).
// Skip if: <8 points, R² of YES < 0.5, YES/NO slopes share sign, or |YES slope| < 0.3¢/min.
export function regressionChopSkip(atm: Row[]): Skip | null {
  if (atm.length < 8) {
    return { reason: "regression_insufficient_points", detail: { points: atm.length } };
  }
  const t0 = new Date(atm[0].snapped_at).getTime();
  const xs = atm.map(r => (new Date(r.snapped_at).getTime() - t0) / 60_000); // minutes
  const ys = atm.map(r => Number(r.yes_cents));
  const ns = atm.map(r => Number(r.no_cents));

  const fit = (x: number[], y: number[]) => {
    const n = x.length;
    const mx = x.reduce((a, b) => a + b, 0) / n;
    const my = y.reduce((a, b) => a + b, 0) / n;
    let num = 0, denX = 0, denY = 0;
    for (let i = 0; i < n; i++) {
      const dx = x[i] - mx, dy = y[i] - my;
      num += dx * dy; denX += dx * dx; denY += dy * dy;
    }
    const slope = denX === 0 ? 0 : num / denX;
    const r2 = denX === 0 || denY === 0 ? 0 : (num * num) / (denX * denY);
    return { slope, r2 };
  };

  const y = fit(xs, ys);
  const n = fit(xs, ns);

  if (y.r2 < 0.5) {
    return { reason: "regression_low_r2", detail: { r2_yes: y.r2, slope_yes: y.slope } };
  }
  if (Math.sign(y.slope) === Math.sign(n.slope) && y.slope !== 0 && n.slope !== 0) {
    return { reason: "regression_same_sign", detail: { slope_yes: y.slope, slope_no: n.slope } };
  }
  if (Math.abs(y.slope) < 0.3) {
    return { reason: "regression_flat", detail: { slope_yes: y.slope } };
  }
  return null;
}


export function atmByTicker(rows: Row[]): Map<string, Row[]> {
  const perTicker = new Map<string, Row[]>();
  for (const r of rows) {
    const a = perTicker.get(r.ticker) ?? []; a.push(r); perTicker.set(r.ticker, a);
  }
  const out = new Map<string, Row[]>();
  for (const [t, arr] of perTicker) {
    const bySnap = new Map<string, Row>();
    for (const r of arr) {
      const p = bySnap.get(r.snapped_at);
      if (!p || Math.abs(r.strike - r.spot) < Math.abs(p.strike - p.spot)) bySnap.set(r.snapped_at, r);
    }
    out.set(t, Array.from(bySnap.values()).sort((a, b) => a.snapped_at.localeCompare(b.snapped_at)));
  }
  return out;
}

export function evaluateAtm(
  atm: Row[],
  cal: CalMap,
): { decision?: Decision; skip?: Skip } {
  if (atm.length < STABILITY_TICKS) return { skip: { reason: "insufficient_history" } };
  const last = atm[atm.length - 1];

  // (#2) Freshness proxy for liquidity: if latest snap is > STALE_SECONDS old, tape is stale/thin.
  const ageMs = Date.now() - new Date(last.snapped_at).getTime();
  if (ageMs > STALE_SECONDS * 1000) {
    return { skip: { reason: "tape_stale", detail: { age_ms: ageMs } } };
  }

  if (last.seconds_to_close <= MIN_TIME_TO_ENTER) {
    return { skip: { reason: "too_late", seconds_to_close: last.seconds_to_close } };
  }

  // Strict regression chop skip.
  const chop = regressionChopSkip(atm);
  if (chop) return { skip: chop };


  const tElapsed = WINDOW - last.seconds_to_close;

  // Flip history + last flip time.
  let flips = 0;
  let lastFlipIdx = -1;
  let p = leaderOf(atm[0].yes_cents);
  for (let i = 1; i < atm.length; i++) {
    const c = leaderOf(atm[i].yes_cents);
    if (c !== "TIE" && p !== "TIE" && c !== p) { flips++; lastFlipIdx = i; }
    p = c;
  }
  const lastFlipAgeSec = lastFlipIdx >= 0
    ? Math.round((new Date(last.snapped_at).getTime() - new Date(atm[lastFlipIdx].snapped_at).getTime()) / 1000)
    : Infinity;

  const curL = leaderOf(last.yes_cents);
  if (curL === "TIE") return { skip: { reason: "tied", flip_count: flips } };

  // Velocity: cents-of-our-leader-side change over the last ~30s window.
  const now = new Date(last.snapped_at).getTime();
  let baseIdx = 0;
  for (let i = atm.length - 1; i >= 0; i--) {
    if (now - new Date(atm[i].snapped_at).getTime() >= 25_000) { baseIdx = i; break; }
  }
  const leaderCents = (r: Row) => (curL === "YES" ? r.yes_cents : r.no_cents);
  const velocity = leaderCents(last) - leaderCents(atm[baseIdx]);

  // (#5) Flip cooldown.
  if (lastFlipAgeSec < FLIP_COOLDOWN_SECONDS) {
    return { skip: { reason: "flip_cooldown", flip_count: flips, detail: { last_flip_age_sec: lastFlipAgeSec } } };
  }

  // Trigger 2: flip_fade — flip after T-10m, new leader in band, positive velocity.
  const fadeCal = cal.flip_fade;
  if (lastFlipIdx > 0 && lastFlipIdx >= atm.length - 2 && tElapsed >= 300) {
    const cents = leaderCents(last);
    if (cents >= fadeCal.min_cents && cents <= fadeCal.max_cents && velocity >= fadeCal.min_velocity) {
      return {
        decision: {
          ticker: last.ticker, strike: Number(last.strike), spot: Number(last.spot),
          side: curL, trigger: "flip_fade",
          yes_cents: last.yes_cents, no_cents: last.no_cents,
          seconds_to_close: last.seconds_to_close, flip_count: flips,
          velocity,
        },
      };
    }
    return {
      skip: {
        reason: cents < fadeCal.min_cents ? "cents_below_band"
          : cents > fadeCal.max_cents ? "cents_above_band"
          : "velocity_below_min",
        trigger_candidate: "flip_fade",
        yes_cents: last.yes_cents, no_cents: last.no_cents,
        seconds_to_close: last.seconds_to_close, flip_count: flips,
        detail: { velocity, min_velocity: fadeCal.min_velocity, band: [fadeCal.min_cents, fadeCal.max_cents] },
      },
    };
  }

  // Trigger 1: leader_chase — inside T-4m + multi-tick stability + in-band.
  const chaseCal = cal.leader_chase;
  if (tElapsed >= 660) {
    // (#4) Last STABILITY_TICKS snaps must all share curL.
    let stable = true;
    for (let i = atm.length - STABILITY_TICKS; i < atm.length; i++) {
      if (leaderOf(atm[i].yes_cents) !== curL) { stable = false; break; }
    }
    if (!stable) {
      return {
        skip: {
          reason: "not_stable",
          trigger_candidate: "leader_chase",
          yes_cents: last.yes_cents, no_cents: last.no_cents,
          seconds_to_close: last.seconds_to_close, flip_count: flips,
        },
      };
    }
    const cents = leaderCents(last);
    if (cents >= chaseCal.min_cents && cents <= chaseCal.max_cents) {
      return {
        decision: {
          ticker: last.ticker, strike: Number(last.strike), spot: Number(last.spot),
          side: curL, trigger: "leader_chase",
          yes_cents: last.yes_cents, no_cents: last.no_cents,
          seconds_to_close: last.seconds_to_close, flip_count: flips,
          velocity,
        },
      };
    }
    return {
      skip: {
        reason: cents < chaseCal.min_cents ? "cents_below_band" : "cents_above_band",
        trigger_candidate: "leader_chase",
        yes_cents: last.yes_cents, no_cents: last.no_cents,
        seconds_to_close: last.seconds_to_close, flip_count: flips,
        detail: { band: [chaseCal.min_cents, chaseCal.max_cents] },
      },
    };
  }

  return {
    skip: {
      reason: "too_early",
      seconds_to_close: last.seconds_to_close, flip_count: flips,
    },
  };
}

// Re-entry (pullback) detector — for tickers where price ran hot (≥78¢)
// and then pulled back into 55–70¢ band with time still on the clock.
// Returns a Decision that callers should half-stake and tag rotation_index=2.
export function evaluateReentry(atm: Row[]): Decision | null {
  if (atm.length < STABILITY_TICKS + 3) return null;
  const last = atm[atm.length - 1];
  const ageMs = Date.now() - new Date(last.snapped_at).getTime();
  if (ageMs > STALE_SECONDS * 1000) return null;
  if (last.seconds_to_close < REENTRY_MIN_TIME) return null;

  const curL = leaderOf(last.yes_cents);
  if (curL === "TIE") return null;
  const leaderCents = (r: Row) => (curL === "YES" ? r.yes_cents : r.no_cents);

  // Last STABILITY_TICKS must all agree on curL (pullback has stabilised).
  for (let i = atm.length - STABILITY_TICKS; i < atm.length; i++) {
    if (leaderOf(atm[i].yes_cents) !== curL) return null;
  }

  const nowCents = leaderCents(last);
  if (nowCents < REENTRY_MIN_BAND || nowCents > REENTRY_MAX_BAND) return null;

  // Max leader-side cents seen at ANY earlier snap (proves the run happened).
  let maxSeen = 0;
  for (let i = 0; i < atm.length - 1; i++) {
    const c = leaderCents(atm[i]);
    if (c > maxSeen) maxSeen = c;
  }
  if (maxSeen < REENTRY_RAN_TO) return null;

  // Velocity: cents change on our leader side over ~25s.
  const now = new Date(last.snapped_at).getTime();
  let baseIdx = 0;
  for (let i = atm.length - 1; i >= 0; i--) {
    if (now - new Date(atm[i].snapped_at).getTime() >= 25_000) { baseIdx = i; break; }
  }
  const velocity = leaderCents(last) - leaderCents(atm[baseIdx]);

  // Flip count over full history (for logging).
  let flips = 0;
  let p = leaderOf(atm[0].yes_cents);
  for (let i = 1; i < atm.length; i++) {
    const c = leaderOf(atm[i].yes_cents);
    if (c !== "TIE" && p !== "TIE" && c !== p) flips++;
    p = c;
  }

  return {
    ticker: last.ticker, strike: Number(last.strike), spot: Number(last.spot),
    side: curL, trigger: "leader_chase",
    yes_cents: last.yes_cents, no_cents: last.no_cents,
    seconds_to_close: last.seconds_to_close, flip_count: flips,
    velocity,
  };
}
