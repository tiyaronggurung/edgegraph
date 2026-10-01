// Watch-only logistic regression: learns how much each logged signal matters
// and outputs p(BTC closes above strike). Reads btc_agreement_log only.
// Never places, blocks or sizes a bet.
import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

type Row = {
  window_start: string;
  bucket_sec: number;
  seconds_to_close: number | null;
  spot: number | string | null;
  strike: number | string | null;
  odds_p_up: number | string | null;
  vol_imbalance: number | string | null;
  model_side: string | null;
  model_confidence: number | string | null;
  study_side: string | null;
  study_confidence: number | string | null;
};

export const FEATURE_NAMES = [
  "bias",
  "our odds",
  "volume in/out",
  "model pick",
  "study pick",
  "distance to strike",
  "distance × time",
] as const;

const num = (v: unknown) => (v == null ? null : Number.isFinite(Number(v)) ? Number(v) : null);
const conf = (v: unknown) => {
  const c = num(v);
  if (c == null) return 0.5;
  return c > 1 ? c / 100 : c;
};
const sideSign = (s: string | null) => (s === "UP" ? 1 : s === "DOWN" ? -1 : 0);

function features(r: Row): number[] | null {
  const spot = num(r.spot);
  const strike = num(r.strike);
  if (spot == null || strike == null) return null;
  const pUp = num(r.odds_p_up);
  const tFrac = Math.max(0.02, Math.min(1, (r.seconds_to_close ?? 450) / 900));
  const dist = Math.max(-3, Math.min(3, (spot - strike) / 100));
  return [
    1,
    pUp == null ? 0 : (pUp - 0.5) * 2,
    num(r.vol_imbalance) ?? 0,
    sideSign(r.model_side) * (conf(r.model_confidence) - 0.5) * 2 || sideSign(r.model_side) * 0.2,
    sideSign(r.study_side) * (conf(r.study_confidence) - 0.5) * 2 || sideSign(r.study_side) * 0.2,
    dist,
    dist / Math.sqrt(tFrac),
  ];
}

const sigmoid = (z: number) => 1 / (1 + Math.exp(-Math.max(-30, Math.min(30, z))));

// L2-regularized logistic regression by gradient descent; each window weighted
// equally so long windows with many samples don't dominate.
function fit(X: number[][], y: number[], w: number[]): number[] {
  const k = X[0]?.length ?? FEATURE_NAMES.length;
  const beta = new Array(k).fill(0);
  const lambda = 0.05;
  const totalW = w.reduce((a, b) => a + b, 0) || 1;
  for (let it = 0; it < 400; it++) {
    const g = new Array(k).fill(0);
    for (let i = 0; i < X.length; i++) {
      const p = sigmoid(X[i].reduce((a, x, j) => a + x * beta[j], 0));
      const e = (p - y[i]) * w[i];
      for (let j = 0; j < k; j++) g[j] += e * X[i][j];
    }
    for (let j = 0; j < k; j++) beta[j] -= 0.5 * (g[j] / totalW + (j === 0 ? 0 : lambda * beta[j]));
  }
  return beta;
}

export interface LogisticModelView {
  trainedWindows: number;
  trainedSamples: number;
  weights: { name: string; weight: number }[];
  /** Out-of-sample accuracy: each window scored by a model trained without it. */
  holdoutAccuracy: number | null;
  holdoutLast4Min: number | null;
  current: { windowStart: number; secondsToClose: number | null; pUp: number } | null;
  enoughData: boolean;
}

let cache: { at: number; fit: { beta: number[]; stats: Omit<LogisticModelView, "current"> } } | null = null;
const TTL = 10 * 60_000;

export const getLogisticModel = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async (): Promise<LogisticModelView> => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const nowMs = Date.now();
    const curWin = Math.floor(nowMs / 900_000) * 900_000;

    if (!cache || nowMs - cache.at > TTL) {
      const rows: Row[] = [];
      for (let from = 0; from < 50_000; from += 1000) {
        const { data } = await supabaseAdmin
          .from("btc_agreement_log")
          .select("window_start,bucket_sec,seconds_to_close,spot,strike,odds_p_up,vol_imbalance,model_side,model_confidence,study_side,study_confidence")
          .lt("window_start", new Date(curWin).toISOString())
          .order("window_start", { ascending: true })
          .order("bucket_sec", { ascending: true })
          .range(from, from + 999);
        if (!data?.length) break;
        rows.push(...(data as Row[]));
        if (data.length < 1000) break;
      }

      // Group by window; label = last logged spot vs strike (close proxy).
      const byWin = new Map<string, Row[]>();
      for (const r of rows) {
        const a = byWin.get(r.window_start) ?? [];
        a.push(r);
        byWin.set(r.window_start, a);
      }
      const wins: { X: number[][]; y: number; tl: number[] }[] = [];
      for (const list of byWin.values()) {
        const last = list[list.length - 1];
        const s = num(last.spot), k = num(last.strike);
        if (s == null || k == null || (last.seconds_to_close ?? 999) > 60) continue;
        const X: number[][] = [];
        const tl: number[] = [];
        for (const r of list) {
          const f = features(r);
          if (f) { X.push(f); tl.push(r.seconds_to_close ?? 999); }
        }
        if (X.length) wins.push({ X, y: s >= k ? 1 : 0, tl });
      }

      const flatten = (ws: typeof wins) => {
        const X: number[][] = [], y: number[] = [], w: number[] = [];
        for (const win of ws) for (const x of win.X) { X.push(x); y.push(win.y); w.push(1 / win.X.length); }
        return { X, y, w };
      };
      const all = flatten(wins);
      const beta = all.X.length ? fit(all.X, all.y, all.w) : new Array(FEATURE_NAMES.length).fill(0);

      // Leave-one-window-out (grouped into 5 folds for speed).
      let hit = 0, tot = 0, hit4 = 0, tot4 = 0;
      if (wins.length >= 10) {
        for (let f = 0; f < 5; f++) {
          const train = flatten(wins.filter((_, i) => i % 5 !== f));
          const b = fit(train.X, train.y, train.w);
          wins.forEach((win, i) => {
            if (i % 5 !== f) return;
            win.X.forEach((x, j) => {
              const ok = (sigmoid(x.reduce((a, v, q) => a + v * b[q], 0)) >= 0.5 ? 1 : 0) === win.y;
              tot++; if (ok) hit++;
              if (win.tl[j] <= 240) { tot4++; if (ok) hit4++; }
            });
          });
        }
      }

      cache = {
        at: nowMs,
        fit: {
          beta,
          stats: {
            trainedWindows: wins.length,
            trainedSamples: all.X.length,
            weights: FEATURE_NAMES.map((name, i) => ({ name, weight: beta[i] ?? 0 })),
            holdoutAccuracy: tot ? hit / tot : null,
            holdoutLast4Min: tot4 ? hit4 / tot4 : null,
            enoughData: wins.length >= 200,
          },
        },
      };
    }

    const { data: latest } = await supabaseAdmin
      .from("btc_agreement_log")
      .select("window_start,bucket_sec,seconds_to_close,spot,strike,odds_p_up,vol_imbalance,model_side,model_confidence,study_side,study_confidence")
      .eq("window_start", new Date(curWin).toISOString())
      .order("bucket_sec", { ascending: false })
      .limit(1);
    const r = (latest?.[0] ?? null) as Row | null;
    const f = r ? features(r) : null;
    const beta = cache.fit.beta;
    return {
      ...cache.fit.stats,
      current: f
        ? { windowStart: curWin, secondsToClose: r!.seconds_to_close, pUp: sigmoid(f.reduce((a, v, i) => a + v * beta[i], 0)) }
        : null,
    };
  });
