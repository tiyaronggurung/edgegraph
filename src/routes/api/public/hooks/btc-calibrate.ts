// Nightly cron: refit btc_calibration table from settled predictions.
// Reads btc_model_predictions where outcome IS NOT NULL, buckets by
// (time_bucket × sigma_bucket), and upserts per-bucket win-rate, avg model /
// market / theory prob, and a correction factor (actual_rate / avg_model_prob,
// clamped to [0.5, 2.0]) so we can later multiply raw model prob by it.
import { createFileRoute } from "@tanstack/react-router";

function sigmaBucketOf(sigDist: number | null | undefined): string {
  const s = Number(sigDist);
  if (!Number.isFinite(s)) return "unknown";
  if (s < 0.5) return "0-0.5σ";
  if (s < 1.0) return "0.5-1σ";
  if (s < 2.0) return "1-2σ";
  if (s < 3.0) return "2-3σ";
  return "3σ+";
}

// distance-in-sigma from spot to strike given per-minute σ and minutes remaining
function sigDistFrom(row: {
  spot_at_snapshot: number | string;
  strike: number | string;
  sigma_at_snapshot: number | string | null;
  snapshot_seconds_to_close: number;
}): number | null {
  const spot = Number(row.spot_at_snapshot);
  const strike = Number(row.strike);
  const sigma = Number(row.sigma_at_snapshot);
  const secs = Number(row.snapshot_seconds_to_close);
  if (!spot || !strike || !sigma || sigma <= 0 || !secs) return null;
  const mins = secs / 60;
  const stdMoveUsd = (sigma / 100) * Math.sqrt(mins) * spot;
  if (stdMoveUsd <= 0) return null;
  return Math.abs(spot - strike) / stdMoveUsd;
}

export const Route = createFileRoute("/api/public/hooks/btc-calibrate")({
  server: {
    handlers: {
      POST: async () => {
        const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

        const { data: rows, error } = await supabaseAdmin
          .from("btc_model_predictions")
          .select("side, model_prob, market_yes_price, theory_yes_prob, sigma_at_snapshot, spot_at_snapshot, strike, snapshot_seconds_to_close, time_bucket, was_correct, settled_at")
          .not("outcome", "is", null)
          .not("time_bucket", "is", null)
          .order("settled_at", { ascending: false })
          .limit(10000);

        if (error) return new Response(JSON.stringify({ ok: false, error: error.message }), { status: 500 });
        if (!rows?.length) return new Response(JSON.stringify({ ok: true, fitted: 0, note: "no settled rows" }));

        interface Agg {
          time_bucket: string; sigma_bucket: string;
          n: number; wins: number;
          sModel: number; sMarket: number; sTheory: number; theoryN: number;
        }
        const map = new Map<string, Agg>();

        for (const r of rows) {
          const tb = r.time_bucket as string;
          const sb = sigmaBucketOf(sigDistFrom(r as any));
          const key = `${tb}|${sb}`;
          const agg = map.get(key) ?? {
            time_bucket: tb, sigma_bucket: sb,
            n: 0, wins: 0, sModel: 0, sMarket: 0, sTheory: 0, theoryN: 0,
          };
          agg.n += 1;
          if (r.was_correct) agg.wins += 1;
          const pModel = Number(r.model_prob);
          const pMarket = Number(r.market_yes_price);
          const pTheory = r.theory_yes_prob != null ? Number(r.theory_yes_prob) : null;
          // Convert to "on our locked side" so the average is comparable to actual_rate.
          const side = r.side as "YES" | "NO";
          const sideModel = side === "YES" ? pModel : 1 - pModel;
          const sideMarket = side === "YES" ? pMarket : 1 - pMarket;
          agg.sModel += sideModel;
          agg.sMarket += sideMarket;
          if (pTheory != null && Number.isFinite(pTheory)) {
            agg.sTheory += side === "YES" ? pTheory : 1 - pTheory;
            agg.theoryN += 1;
          }
          map.set(key, agg);
        }

        const now = new Date().toISOString();
        const upserts = [...map.values()].map(a => {
          const actual = a.n > 0 ? a.wins / a.n : 0;
          const avgModel = a.n > 0 ? a.sModel / a.n : 0;
          const raw = avgModel > 0.01 ? actual / avgModel : 1;
          const correction = Math.max(0.5, Math.min(2.0, raw));
          return {
            time_bucket: a.time_bucket,
            sigma_bucket: a.sigma_bucket,
            n_samples: a.n,
            n_correct: a.wins,
            avg_model_prob: avgModel,
            avg_market_prob: a.n > 0 ? a.sMarket / a.n : 0,
            avg_theory_prob: a.theoryN > 0 ? a.sTheory / a.theoryN : null,
            actual_rate: actual,
            correction_factor: correction,
            last_fitted_at: now,
          };
        });

        const { error: upErr } = await supabaseAdmin
          .from("btc_calibration")
          .upsert(upserts, { onConflict: "time_bucket,sigma_bucket" });

        if (upErr) return new Response(JSON.stringify({ ok: false, error: upErr.message }), { status: 500 });
        return new Response(JSON.stringify({ ok: true, fitted: upserts.length, rows: rows.length }));
      },
    },
  },
});
