import { createFileRoute } from "@tanstack/react-router";
import { verifyCronRequest } from "@/lib/cronAuth";

// Pin-Risk Shadow Detector.
// Runs every 15s from pg_cron. For every open 15m window that has a
// study_locked_side and is inside [30s, 480s] to close, compute 5 early-
// warning signals for a late-window flip and log a row to
// btc_pin_risk_shadow. No trading action — pure observation for now.
//
// Signals (each 0..20, total 0..100):
//   1. cushion_decay      — |spot-strike| shrinking toward losing side, $/min
//   2. losing_ask_climb   — losing-side Kalshi ask (cents) climb vs 2m ago
//   3. volume_asymmetry   — losing_vol_60s / winning_vol_60s
//   4. divergence         — |kalshi_implied_spot - composite_spot| toward losing side
//   5. ta_flip            — latest ta_score sign flipped against locked side

type SnapRow = {
  snapped_at: string;
  seconds_to_close: number | null;
  kalshi_yes_ask: number | null;
  kalshi_yes_bid: number | null;
  kalshi_yes_vol_60s: number | null;
  kalshi_no_vol_60s: number | null;
  kalshi_implied_spot: number | null;
  spot_composite: number | null;
};

function toNum(v: unknown): number | null {
  const n = typeof v === "number" ? v : Number(v);
  return Number.isFinite(n) ? n : null;
}

export const Route = createFileRoute("/api/public/hooks/pin-risk-shadow-tick")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const authFail = await verifyCronRequest(request);
        if (authFail) return authFail;

        const t0 = Date.now();
        const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

        const nowMs = Date.now();
        const minIso = new Date(nowMs + 30_000).toISOString();   // ≥ 30s to close
        const maxIso = new Date(nowMs + 480_000).toISOString();  // ≤ 8m to close

        const { data: preds, error: predsErr } = await supabaseAdmin
          .from("btc_model_predictions")
          .select("ticker, close_time, strike, study_locked_side, ta_score")
          .not("study_locked_side", "is", null)
          .gte("close_time", minIso)
          .lte("close_time", maxIso)
          .is("outcome", null)
          .order("close_time", { ascending: true })
          .limit(20);
        if (predsErr) return Response.json({ ok: false, error: predsErr.message }, { status: 500 });

        const sinceTicksIso = new Date(nowMs - 90_000).toISOString();
        const twoMinAgoIso = new Date(nowMs - 150_000).toISOString();
        const results: Array<Record<string, unknown>> = [];

        for (const p of preds ?? []) {
          const ticker = String((p as any).ticker);
          const closeTime = String((p as any).close_time);
          const strike = toNum((p as any).strike);
          const lockedSide = String((p as any).study_locked_side) as "YES" | "NO";
          const taScore = toNum((p as any).ta_score);
          if (!strike || (lockedSide !== "YES" && lockedSide !== "NO")) {
            results.push({ ticker, skipped: "bad_pred" });
            continue;
          }
          const secondsToClose = Math.round((new Date(closeTime).getTime() - nowMs) / 1000);

          // --- Spot ticks (90s window) ---
          const { data: ticks } = await supabaseAdmin
            .from("btc_spot_ticks")
            .select("observed_at, spot")
            .gte("observed_at", sinceTicksIso)
            .order("observed_at", { ascending: true })
            .limit(300);
          const spotSeries = (ticks ?? [])
            .map((t: any) => ({ ts: new Date(t.observed_at).getTime(), spot: Number(t.spot) }))
            .filter((r) => Number.isFinite(r.spot));
          if (spotSeries.length < 8) {
            results.push({ ticker, skipped: "too_few_ticks", n: spotSeries.length });
            continue;
          }
          const latest = spotSeries[spotSeries.length - 1];
          const spot = latest.spot;

          // cushion signed toward locked side (positive = we're winning)
          const cushionUsd = lockedSide === "YES" ? (spot - strike) : (strike - spot);

          // decay = rate of change of cushion in $/min (negative = shrinking)
          const first = spotSeries[0];
          const firstCushion = lockedSide === "YES" ? (first.spot - strike) : (strike - first.spot);
          const dtMin = Math.max(1e-3, (latest.ts - first.ts) / 60_000);
          const cushionDecayPerMin = (cushionUsd - firstCushion) / dtMin; // negative bad
          // Score: shrinking > $3/min → 20; > $1.5/min → 10; > $0.5/min → 5
          let scoreCushion = 0;
          if (cushionDecayPerMin <= -3) scoreCushion = 20;
          else if (cushionDecayPerMin <= -1.5) scoreCushion = 12;
          else if (cushionDecayPerMin <= -0.5) scoreCushion = 6;

          // --- Kalshi snapshots (last 150s) ---
          const { data: snaps } = await supabaseAdmin
            .from("btc_kalshi_odds_snapshots")
            .select("snapped_at, seconds_to_close, kalshi_yes_ask, kalshi_yes_bid, kalshi_yes_vol_60s, kalshi_no_vol_60s, kalshi_implied_spot, spot_composite")
            .eq("ticker", ticker)
            .gte("snapped_at", twoMinAgoIso)
            .order("snapped_at", { ascending: true })
            .limit(60);
          const snapRows = (snaps ?? []) as SnapRow[];
          const latestSnap = snapRows[snapRows.length - 1];
          const earlySnap = snapRows[0];

          // Losing-side ask (in cents). YES-locked → losing = NO ask = 100 - yes_bid.
          const losingAskFromSnap = (s: SnapRow | undefined): number | null => {
            if (!s) return null;
            const yesAsk = toNum(s.kalshi_yes_ask);
            const yesBid = toNum(s.kalshi_yes_bid);
            if (lockedSide === "YES") return yesBid != null ? 100 - yesBid : null;
            return yesAsk;
          };
          const latestLosingAsk = losingAskFromSnap(latestSnap);
          const earlyLosingAsk = losingAskFromSnap(earlySnap);
          const askClimb = latestLosingAsk != null && earlyLosingAsk != null
            ? latestLosingAsk - earlyLosingAsk : null;
          let scoreAskClimb = 0;
          if (askClimb != null) {
            if (askClimb >= 12) scoreAskClimb = 20;
            else if (askClimb >= 8) scoreAskClimb = 14;
            else if (askClimb >= 4) scoreAskClimb = 7;
          }

          // Volume asymmetry — losing / winning over last 60s
          const winVol = latestSnap ? toNum(lockedSide === "YES" ? latestSnap.kalshi_yes_vol_60s : latestSnap.kalshi_no_vol_60s) : null;
          const loseVol = latestSnap ? toNum(lockedSide === "YES" ? latestSnap.kalshi_no_vol_60s : latestSnap.kalshi_yes_vol_60s) : null;
          const losingVolRatio = winVol != null && loseVol != null && winVol > 0
            ? loseVol / winVol : null;
          let scoreVolume = 0;
          if (losingVolRatio != null) {
            if (losingVolRatio >= 3) scoreVolume = 20;
            else if (losingVolRatio >= 2) scoreVolume = 14;
            else if (losingVolRatio >= 1.3) scoreVolume = 6;
          }

          // Divergence — kalshi_implied_spot vs composite_spot, signed toward losing side.
          const impliedSpot = latestSnap ? toNum(latestSnap.kalshi_implied_spot) : null;
          const compSpot = latestSnap ? toNum(latestSnap.spot_composite) : spot;
          let divergenceTowardLose: number | null = null;
          if (impliedSpot != null && compSpot != null) {
            const diff = impliedSpot - compSpot; // positive → Kalshi says higher
            // "toward losing" means diff direction disagrees with our side
            divergenceTowardLose = lockedSide === "YES" ? -diff : diff;
          }
          let scoreDivergence = 0;
          if (divergenceTowardLose != null) {
            if (divergenceTowardLose >= 15) scoreDivergence = 20;
            else if (divergenceTowardLose >= 8) scoreDivergence = 12;
            else if (divergenceTowardLose >= 4) scoreDivergence = 5;
          }

          // TA flip — ta_score sign vs locked side. YES wants +, NO wants -.
          let taFlippedAgainst = false;
          let scoreTA = 0;
          if (taScore != null) {
            const want = lockedSide === "YES" ? 1 : -1;
            const have = Math.sign(taScore);
            if (have !== 0 && have !== want) {
              taFlippedAgainst = true;
              if (Math.abs(taScore) >= 30) scoreTA = 20;
              else if (Math.abs(taScore) >= 15) scoreTA = 12;
              else scoreTA = 6;
            }
          }

          const scoreTotal = scoreCushion + scoreAskClimb + scoreVolume + scoreDivergence + scoreTA;

          const { error: insErr } = await supabaseAdmin
            .from("btc_pin_risk_shadow")
            .insert({
              ticker,
              close_time: closeTime,
              seconds_to_close: secondsToClose,
              strike,
              locked_side: lockedSide,
              spot,
              cushion_usd: cushionUsd,
              cushion_decay_usd_per_min: cushionDecayPerMin,
              losing_ask_climb_cents: askClimb,
              losing_vol_ratio: losingVolRatio,
              implied_vs_composite_usd: divergenceTowardLose,
              ta_score: taScore,
              ta_flipped_against: taFlippedAgainst,
              score_cushion: scoreCushion,
              score_ask_climb: scoreAskClimb,
              score_volume: scoreVolume,
              score_divergence: scoreDivergence,
              score_ta: scoreTA,
              score_total: scoreTotal,
            } as never);
          if (insErr) {
            results.push({ ticker, err: insErr.message });
            continue;
          }
          results.push({ ticker, sec: secondsToClose, side: lockedSide, cushion: cushionUsd, score: scoreTotal });
        }

        return Response.json({ ok: true, checked: (preds ?? []).length, results, durationMs: Date.now() - t0 });
      },
    },
  },
});
