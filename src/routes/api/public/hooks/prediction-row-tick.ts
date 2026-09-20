// Server-side "early row" writer for the prediction log.
//
// Problem it fixes: btc_model_predictions rows were only ever created by the
// browser tick (cryptoBtc.functions.ts), so any window where no tab was open
// never appeared in the log at all — the coverage audit showed large gaps.
//
// This job runs every minute from pg_cron and makes sure the window currently
// in progress has exactly one row, created as early as possible after the
// window opens. It writes ONLY the pending skeleton (ticker, strike, spot,
// market price, physics side/prob). Model Pick, Study Pick, TA fields and the
// outcome are still filled in later by their own existing paths — this never
// overwrites an existing row.
import { createFileRoute } from "@tanstack/react-router";
import { verifyCronRequest } from "@/lib/cronAuth";

const QUARTER_MS = 15 * 60 * 1000;

function phi(z: number): number {
  // Abramowitz-Stegun normal CDF
  const t = 1 / (1 + 0.2316419 * Math.abs(z));
  const d = 0.3989422804014327 * Math.exp(-(z * z) / 2);
  const p = d * t * (0.319381530 + t * (-0.356563782 + t * (1.781477937 + t * (-1.821255978 + t * 1.330274429))));
  return z >= 0 ? 1 - p : p;
}

function timeBucketOf(secondsToClose: number): string {
  if (secondsToClose <= 30) return "30s";
  if (secondsToClose <= 60) return "1m";
  if (secondsToClose <= 120) return "2m";
  if (secondsToClose <= 300) return "5m";
  if (secondsToClose <= 600) return "10m";
  return "13m+";
}

/** Per-second realized vol from the server-side spot tape (fallback prior when cold). */
async function sigmaPerSecond(supabaseAdmin: any): Promise<number> {
  const PRIOR_ANNUAL = 0.55;
  const prior = PRIOR_ANNUAL / Math.sqrt(365 * 24 * 3600);
  try {
    const since = new Date(Date.now() - 30 * 60 * 1000).toISOString();
    const { data } = await supabaseAdmin
      .from("btc_spot_ticks")
      .select("observed_at, spot")
      .gte("observed_at", since)
      .order("observed_at", { ascending: true })
      .limit(1000);
    const rows = (data ?? []) as { observed_at: string; spot: number | null }[];
    let sum = 0;
    let n = 0;
    for (let i = 1; i < rows.length; i++) {
      const p0 = Number(rows[i - 1]!.spot);
      const p1 = Number(rows[i]!.spot);
      const dt = (Date.parse(rows[i]!.observed_at) - Date.parse(rows[i - 1]!.observed_at)) / 1000;
      if (!Number.isFinite(p0) || !Number.isFinite(p1) || p0 <= 0 || p1 <= 0) continue;
      if (!Number.isFinite(dt) || dt < 5 || dt > 120) continue;
      const r = Math.log(p1 / p0);
      sum += (r * r) / dt;
      n++;
    }
    if (n < 10) return prior;
    const s = Math.sqrt(sum / n);
    // Clamp to 15%..150% annualized so a bad tape can't produce nonsense.
    const lo = 0.15 / Math.sqrt(365 * 24 * 3600);
    const hi = 1.5 / Math.sqrt(365 * 24 * 3600);
    return Math.min(hi, Math.max(lo, s));
  } catch {
    return prior;
  }
}

export const Route = createFileRoute("/api/public/hooks/prediction-row-tick")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const authFail = await verifyCronRequest(request);
        if (authFail) return authFail;

        const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

        // Most recent Kalshi snapshot (written every 30s by btc-snapshot-tick).
        const { data: snap } = await supabaseAdmin
          .from("btc_kalshi_odds_snapshots")
          .select("ticker, strike, snapped_at, seconds_to_close, kalshi_yes_bid, kalshi_yes_ask, spot_composite")
          .order("snapped_at", { ascending: false })
          .limit(1)
          .maybeSingle();

        if (!snap?.ticker || snap.strike == null || snap.seconds_to_close == null) {
          return Response.json({ ok: true, created: false, reason: "no kalshi snapshot" });
        }

        const ageMs = Date.now() - Date.parse(snap.snapped_at as string);
        if (!Number.isFinite(ageMs) || ageMs > 120_000) {
          return Response.json({ ok: true, created: false, reason: "snapshot stale" });
        }

        const stc = Math.max(1, Math.round(Number(snap.seconds_to_close) - ageMs / 1000));
        if (stc > QUARTER_MS / 1000) {
          return Response.json({ ok: true, created: false, reason: "not the live window" });
        }

        const ticker = snap.ticker as string;

        // Never touch an existing row — this writer only fills real gaps.
        const { data: existing } = await supabaseAdmin
          .from("btc_model_predictions")
          .select("id")
          .eq("ticker", ticker)
          .maybeSingle();
        if (existing) {
          return Response.json({ ok: true, created: false, reason: "already logged", ticker });
        }

        const strike = Number(snap.strike);
        const spot = snap.spot_composite == null ? null : Number(snap.spot_composite);
        if (!Number.isFinite(strike) || spot == null || !Number.isFinite(spot) || spot <= 0) {
          return Response.json({ ok: true, created: false, reason: "no spot", ticker });
        }

        const sPerSec = await sigmaPerSecond(supabaseAdmin);
        const sigmaT = sPerSec * Math.sqrt(stc);
        const pUp = Math.min(0.99, Math.max(0.01, phi(Math.log(spot / strike) / (sigmaT || 1e-9))));
        const side: "YES" | "NO" = pUp >= 0.5 ? "YES" : "NO";

        const yesAsk = snap.kalshi_yes_ask == null ? null : Number(snap.kalshi_yes_ask);
        const yesBid = snap.kalshi_yes_bid == null ? null : Number(snap.kalshi_yes_bid);
        const marketYes =
          yesAsk != null && yesBid != null ? (yesAsk + yesBid) / 2 : (yesAsk ?? yesBid ?? null);
        const edgePts = marketYes == null ? null : Number(((pUp - marketYes) * 100).toFixed(2));

        const closeTime = new Date(Math.round((Date.now() + stc * 1000) / QUARTER_MS) * QUARTER_MS).toISOString();

        const { error } = await supabaseAdmin.from("btc_model_predictions").insert({
          ticker,
          event_ticker: (snap as any).event_ticker ?? null,
          strike,
          side,
          model_prob: pUp,
          market_yes_price: marketYes,
          edge_pts: edgePts,
          spot_at_snapshot: spot,
          close_time: closeTime,
          snapshot_seconds_to_close: stc,
          sigma_at_snapshot: sPerSec * Math.sqrt(60),
          live_side: side,
          model_side_pre_study: side,
          time_bucket: timeBucketOf(stc),
        } as never);

        if (error) {
          // A concurrent browser tick may have inserted first — that's fine.
          return Response.json({ ok: true, created: false, reason: error.message, ticker });
        }

        return Response.json({ ok: true, created: true, ticker, secondsToClose: stc, side, pUp });
      },
    },
  },
});
