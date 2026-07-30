import { createFileRoute } from "@tanstack/react-router";
import { verifyCronRequest } from "@/lib/cronAuth";
import {
  readCvvConfig,
  getAtr7Usd,
  signedMomentumUsd,
  evaluateCvv,
} from "@/lib/cushionVolGate.server";
import { computeBookLeanTilt, type BookLedgerRow } from "@/lib/bookLeanTilt.server";

// Server-side Study Pick lock writer.
// Runs every 60s from pg_cron. Writes btc_model_predictions.study_locked_side
// for the current 15-min window based on spot-vs-strike physics measured from
// server-side btc_spot_ticks — so the lock lands even if no browser tab is
// open. Downstream real-money cron (study-auto-live-tick) picks the lock up
// on its next 15s tick.
//
// Windows targeted:
//   EARLY: 420 < seconds_to_close <= 480  → require ≥75% one-sided ratio
//   LATE : 120 <= seconds_to_close <= 420 → require ≥80% one-sided ratio
// Ratio window: last 120s of spot ticks vs the ticker's strike.
// Idempotent: skips any ticker whose study_locked_side is already set.

const KALSHI = "https://api.elections.kalshi.com/trade-api/v2";

async function fetchKalshiAskCents(ticker: string, side: "YES" | "NO"): Promise<number | null> {
  try {
    const res = await fetch(`${KALSHI}/markets/${encodeURIComponent(ticker)}`, {
      headers: { accept: "application/json" },
    });
    if (!res.ok) return null;
    const j = (await res.json()) as {
      market?: { yes_bid?: number; yes_ask?: number; yes_bid_dollars?: string; yes_ask_dollars?: string };
    };
    const m = j.market;
    if (!m) return null;
    const yesBid = typeof m.yes_bid === "number" ? m.yes_bid : (m.yes_bid_dollars != null ? Math.round(Number(m.yes_bid_dollars) * 100) : NaN);
    const yesAsk = typeof m.yes_ask === "number" ? m.yes_ask : (m.yes_ask_dollars != null ? Math.round(Number(m.yes_ask_dollars) * 100) : NaN);
    if (!Number.isFinite(yesBid) || !Number.isFinite(yesAsk)) return null;
    if (side === "YES") return Math.max(1, Math.min(99, Math.round(yesAsk)));
    return Math.max(1, Math.min(99, Math.round(100 - yesBid)));
  } catch {
    return null;
  }
}

export const Route = createFileRoute("/api/public/hooks/study-lock-tick")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const authFail = await verifyCronRequest(request);
        if (authFail) return authFail;

        const t0 = Date.now();
        const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

        // Load Skip Guard config (shadow by default).
        const { data: gcfg } = await supabaseAdmin
          .from("btc_gate_config")
          .select("skip_guard_mode, skip_guard_cushion_soft_usd, skip_guard_cushion_hard_usd, skip_guard_min_conf_tight, max_ask_mode, max_ask_cents, cvv_mode, cvv_atr_mult, cvv_momentum_max_usd, cvv_atr_lookback_hours")
          .eq("id", 1)
          .maybeSingle();
        const skipMode: "off" | "shadow" | "enforced" = ((gcfg as any)?.skip_guard_mode ?? "shadow");
        const cushionSoft = Number((gcfg as any)?.skip_guard_cushion_soft_usd ?? 25);
        const cushionHard = Number((gcfg as any)?.skip_guard_cushion_hard_usd ?? 15);
        const minConfTight = Number((gcfg as any)?.skip_guard_min_conf_tight ?? 0.82);
        // Max-Ask filter (#4): tag/skip locks whose entry price is too rich to be profitable.
        const maxAskMode: "off" | "shadow" | "enforced" = ((gcfg as any)?.max_ask_mode ?? "shadow");
        const maxAskCents = Number((gcfg as any)?.max_ask_cents ?? 85);

        // Cushion-vs-Volatility gate. Always evaluated + logged when not "off";
        // only blocks the lock when mode === "enforced".
        const cvvCfg = readCvvConfig(gcfg as any);
        const atr7Usd =
          cvvCfg.mode === "off" ? null : await getAtr7Usd(supabaseAdmin, cvvCfg.atrLookbackHours);


        const nowMs = Date.now();
        const earlyMinIso = new Date(nowMs + 421_000).toISOString(); // > 420s
        const earlyMaxIso = new Date(nowMs + 480_000).toISOString();
        const lateMinIso = new Date(nowMs + 120_000).toISOString();
        const lateMaxIso = new Date(nowMs + 420_000).toISOString();

        // Candidate windows: any open unlocked window in [T-480s, T-120s].
        const { data: preds, error: predsErr } = await supabaseAdmin
          .from("btc_model_predictions")
          .select("ticker, close_time, strike")
          .is("study_locked_side", null)
          .gte("close_time", lateMinIso)
          .lte("close_time", earlyMaxIso)
          .order("close_time", { ascending: true })
          .limit(20);
        if (predsErr) return Response.json({ ok: false, error: predsErr.message }, { status: 500 });

        const results: Array<Record<string, unknown>> = [];
        const sinceIso = new Date(nowMs - 120_000).toISOString();

        // ---- T+7min snapshot (always recorded, never gated) -----------------
        // Every 15-min window gets a permanent record of what the study saw at
        // the 7-minute mark, regardless of consensus thresholds or any gate.
        // This is what the dashboard shows so a window is never blank.
        const t7Results: Array<Record<string, unknown>> = [];
        {
          const { data: t7Rows } = await supabaseAdmin
            .from("btc_model_predictions")
            .select("ticker, close_time, strike")
            .is("study_t7_side", null)
            .gte("close_time", new Date(nowMs + 400_000).toISOString())
            .lte("close_time", new Date(nowMs + 545_000).toISOString())
            .limit(20);

          if ((t7Rows ?? []).length > 0) {
            const { data: t7Ticks } = await supabaseAdmin
              .from("btc_spot_ticks")
              .select("spot")
              .gte("observed_at", sinceIso)
              .order("observed_at", { ascending: false })
              .limit(240);
            const t7Spots = (t7Ticks ?? [])
              .map((t: any) => Number(t.spot))
              .filter((x: number) => Number.isFinite(x));

            for (const row of t7Rows ?? []) {
              const tk = (row as any).ticker as string;
              const stk = Number((row as any).strike);
              if (!stk || !Number.isFinite(stk) || t7Spots.length < 5) {
                t7Results.push({ ticker: tk, t7: "insufficient_data", n: t7Spots.length });
                continue;
              }
              const aboveN = t7Spots.filter((s) => s >= stk).length;
              const r7 = aboveN / t7Spots.length;
              const t7Side: "YES" | "NO" = r7 >= 0.5 ? "YES" : "NO";
              const t7Conf = Math.round(Math.max(r7, 1 - r7) * 100);
              const secs = Math.round((new Date((row as any).close_time as string).getTime() - nowMs) / 1000);
              await supabaseAdmin
                .from("btc_model_predictions")
                .update({
                  study_t7_side: t7Side,
                  study_t7_conf: t7Conf,
                  study_t7_ratio: Number(r7.toFixed(4)),
                  study_t7_spot: Number(t7Spots[0].toFixed(2)),
                  study_t7_seconds_to_close: secs,
                  study_t7_at: new Date().toISOString(),
                  study_t7_source: "live_spot_ticks",
                } as never)
                .eq("ticker", tk)
                .is("study_t7_side", null);
              t7Results.push({ ticker: tk, t7Side, t7Conf, secs });
            }
          }
        }


        // Wider tick window (newest-first) used only for the CVV 3-min momentum
        // term. The consensus window above stays at 120s — unchanged behaviour.
        let momentumSpots: number[] = [];
        if (cvvCfg.mode !== "off") {
          const { data: mTicks } = await supabaseAdmin
            .from("btc_spot_ticks")
            .select("spot")
            .gte("observed_at", new Date(nowMs - 190_000).toISOString())
            .order("observed_at", { ascending: false })
            .limit(400);
          momentumSpots = (mTicks ?? [])
            .map((t: any) => Number(t.spot))
            .filter((x: number) => Number.isFinite(x));
        }


        for (const p of preds ?? []) {
          const ticker = (p as any).ticker as string;
          const closeTime = (p as any).close_time as string;
          const strike = Number((p as any).strike);
          if (!strike || !Number.isFinite(strike)) {
            results.push({ ticker, skipped: "no_strike" });
            continue;
          }
          const secondsToClose = Math.round((new Date(closeTime).getTime() - nowMs) / 1000);
          const isEarly = closeTime > earlyMinIso && closeTime <= earlyMaxIso;
          const baseThreshold = isEarly ? 0.75 : 0.80;

          const { data: ticks } = await supabaseAdmin
            .from("btc_spot_ticks")
            .select("spot")
            .gte("observed_at", sinceIso)
            .order("observed_at", { ascending: false })
            .limit(240);
          const spots = (ticks ?? []).map((t: any) => Number(t.spot)).filter((x: number) => Number.isFinite(x));
          if (spots.length < 30) {
            results.push({ ticker, skipped: "too_few_ticks", n: spots.length });
            continue;
          }
          const above = spots.filter((s: number) => s >= strike).length;
          const ratio = above / spots.length;

          // ---- Book P/L lean tilt -------------------------------------
          // House economics for THIS window: the side Kalshi profits from
          // makes our agreeing lock a little easier and a fighting lock a
          // little harder. Physics still decides the side.
          const provSide: "YES" | "NO" = ratio >= 0.5 ? "YES" : "NO";
          const provConf = Math.max(ratio, 1 - ratio);
          const bookTilt = computeBookLeanTilt(bookByTicker.get(ticker) ?? null, provSide, provConf);
          const threshold = Math.min(0.95, Math.max(0.70, baseThreshold + bookTilt.thresholdDelta));

          let side: "YES" | "NO" | null = null;
          let confPct = 0;
          if (ratio >= threshold) { side = "YES"; confPct = Math.round(ratio * 100); }
          else if (1 - ratio >= threshold) { side = "NO"; confPct = Math.round((1 - ratio) * 100); }
          if (!side) {
            results.push({
              ticker, skipped: "no_consensus", ratio: Number(ratio.toFixed(3)),
              threshold: Number(threshold.toFixed(3)), book: bookTilt.reason,
            });
            continue;
          }

          if (bookTilt.block) {
            await supabaseAdmin
              .from("btc_model_predictions")
              .update({
                skip_guard_verdict: "SKIP",
                skip_guard_reason: `book:${bookTilt.reason}`,
              } as never)
              .eq("ticker", ticker)
              .is("study_locked_side", null);
            results.push({
              ticker, skipped: "book_lean", reason: bookTilt.reason,
              lean: bookTilt.lean, strength: bookTilt.strength, wouldLock: side, wouldConf: confPct,
            });
            continue;
          }



          // Physics sanity: latest spot must agree with picked side.
          const latestSpot = spots[0];
          const latestSide: "YES" | "NO" = latestSpot >= strike ? "YES" : "NO";
          if (latestSide !== side) {
            results.push({ ticker, skipped: "latest_spot_disagrees", ratio: Number(ratio.toFixed(3)) });
            continue;
          }

          // Skip Guard: cushion vs strike (avg of latest 10 spots).
          const recent = spots.slice(0, Math.min(10, spots.length));
          const avgSpot = recent.reduce((a, b) => a + b, 0) / recent.length;
          const cushion = Math.abs(avgSpot - strike);
          const confFrac = confPct / 100;
          let skipVerdict: "PROCEED" | "SKIP" = "PROCEED";
          let skipReason: string | null = null;
          if (cushion < cushionHard) {
            skipVerdict = "SKIP";
            skipReason = `cushion_hard<${cushionHard}`;
          } else if (cushion < cushionSoft && confFrac < minConfTight) {
            skipVerdict = "SKIP";
            skipReason = `cushion_soft<${cushionSoft}_and_conf<${Math.round(minConfTight * 100)}`;
          }

          // ---- Cushion-vs-Volatility gate (shadow + live at once) ----
          // Always computed and persisted when mode !== "off". In "enforced"
          // mode a SKIP blocks the lock but still records the side/confidence
          // that WOULD have been locked, so skipped windows stay scoreable.
          let cvv: ReturnType<typeof evaluateCvv> | null = null;
          if (cvvCfg.mode !== "off") {
            const momentumUsd = signedMomentumUsd(
              momentumSpots,
              side,
              180,
              190 / Math.max(momentumSpots.length, 1),
            );
            cvv = evaluateCvv({
              cfg: cvvCfg,
              spot: avgSpot,
              strike,
              side,
              atrUsd: atr7Usd,
              momentumUsd,
            });
          }
          const cvvFields = cvv
            ? {
                cvv_verdict: cvv.verdict,
                cvv_reason: cvv.reason,
                cvv_cushion_usd: cvv.cushionUsd,
                cvv_atr_usd: cvv.atrUsd,
                cvv_momentum_usd: cvv.momentumUsd,
              }
            : {};

          if (cvvCfg.mode === "enforced" && cvv?.verdict === "SKIP") {
            await supabaseAdmin
              .from("btc_model_predictions")
              .update({
                ...cvvFields,
                cvv_would_lock_side: side,
                cvv_would_lock_conf: confPct,
                skip_guard_verdict: "SKIP",
                skip_guard_reason: `cvv:${cvv.reason}`,
                skip_guard_cushion_usd: Number(cushion.toFixed(2)),
              } as never)
              .eq("ticker", ticker)
              .is("study_locked_side", null);
            results.push({
              ticker, skipped: "cvv_gate", reason: cvv.reason,
              cushion: cvv.cushionUsd, atr7: cvv.atrUsd, momentum: cvv.momentumUsd,
              wouldLock: side, wouldConf: confPct,
            });
            continue;
          }

          // Enforced: skip the lock entirely — record verdict without locking.

          if (skipMode === "enforced" && skipVerdict === "SKIP") {
            await supabaseAdmin
              .from("btc_model_predictions")
              .update({
                skip_guard_verdict: "SKIP",
                skip_guard_reason: skipReason,
                skip_guard_cushion_usd: Number(cushion.toFixed(2)),
              } as never)
              .eq("ticker", ticker)
              .is("study_locked_side", null);
            results.push({ ticker, skipped: "skip_guard", reason: skipReason, cushion: Number(cushion.toFixed(2)) });
            continue;
          }

          const askCents = await fetchKalshiAskCents(ticker, side);

          // Max-Ask filter: entry too rich => tag SKIP (shadow) or block the lock (enforced).
          if (maxAskMode !== "off" && askCents != null && Number(askCents) >= maxAskCents) {
            skipVerdict = "SKIP";
            skipReason = `max_ask>=${maxAskCents}`;
            if (maxAskMode === "enforced") {
              await supabaseAdmin
                .from("btc_model_predictions")
                .update({
                  skip_guard_verdict: "SKIP",
                  skip_guard_reason: skipReason,
                  skip_guard_cushion_usd: Number(cushion.toFixed(2)),
                  study_lock_kalshi_price_cents: askCents,
                } as never)
                .eq("ticker", ticker)
                .is("study_locked_side", null);
              results.push({ ticker, skipped: "max_ask", askCents });
              continue;
            }
          }

          const { error: upErr } = await supabaseAdmin
            .from("btc_model_predictions")
            .update({
              ...cvvFields,
              study_locked_side: side,
              study_lock_confidence: confPct,
              study_lock_source: isEarly ? "server_physics_early" : "server_physics_late",
              study_lock_seconds_to_close: secondsToClose,
              study_locked_at: new Date().toISOString(),
              study_lock_kalshi_price_cents: askCents,
              skip_guard_verdict: skipMode === "off" && maxAskMode === "off" ? null : skipVerdict,
              skip_guard_reason: skipMode === "off" && maxAskMode === "off" ? null : skipReason,
              skip_guard_cushion_usd: Number(cushion.toFixed(2)),
            } as never)
            .eq("ticker", ticker)
            .is("study_locked_side", null); // race guard
          if (upErr) {
            results.push({ ticker, skipped: "db_error", err: upErr.message });
            continue;
          }
          results.push({
            ticker, locked: side, confPct, ratio: Number(ratio.toFixed(3)),
            askCents, phase: isEarly ? "early" : "late",
            skipGuard: skipMode === "off" ? null : { verdict: skipVerdict, reason: skipReason, cushion: Number(cushion.toFixed(2)) },
            cvv: cvv ? { mode: cvvCfg.mode, verdict: cvv.verdict, reason: cvv.reason, cushion: cvv.cushionUsd, atr7: cvv.atrUsd, required: cvv.requiredCushionUsd, momentum: cvv.momentumUsd } : null,
          });
        }

        return Response.json({ ok: true, checked: (preds ?? []).length, results, t7: t7Results, durationMs: Date.now() - t0 });
      },
    },
  },
});
