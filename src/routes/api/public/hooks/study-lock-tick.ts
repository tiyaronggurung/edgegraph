import { createFileRoute } from "@tanstack/react-router";
import { verifyCronRequest } from "@/lib/cronAuth";

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
          .select("skip_guard_mode, skip_guard_cushion_soft_usd, skip_guard_cushion_hard_usd, skip_guard_min_conf_tight")
          .eq("id", 1)
          .maybeSingle();
        const skipMode: "off" | "shadow" | "enforced" = ((gcfg as any)?.skip_guard_mode ?? "shadow");
        const cushionSoft = Number((gcfg as any)?.skip_guard_cushion_soft_usd ?? 25);
        const cushionHard = Number((gcfg as any)?.skip_guard_cushion_hard_usd ?? 15);
        const minConfTight = Number((gcfg as any)?.skip_guard_min_conf_tight ?? 0.82);

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
          const threshold = isEarly ? 0.75 : 0.80;

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
          let side: "YES" | "NO" | null = null;
          let confPct = 0;
          if (ratio >= threshold) { side = "YES"; confPct = Math.round(ratio * 100); }
          else if (1 - ratio >= threshold) { side = "NO"; confPct = Math.round((1 - ratio) * 100); }
          if (!side) {
            results.push({ ticker, skipped: "no_consensus", ratio: Number(ratio.toFixed(3)) });
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

          const { error: upErr } = await supabaseAdmin
            .from("btc_model_predictions")
            .update({
              study_locked_side: side,
              study_lock_confidence: confPct,
              study_lock_source: isEarly ? "server_physics_early" : "server_physics_late",
              study_lock_seconds_to_close: secondsToClose,
              study_locked_at: new Date().toISOString(),
              study_lock_kalshi_price_cents: askCents,
              skip_guard_verdict: skipMode === "off" ? null : skipVerdict,
              skip_guard_reason: skipMode === "off" ? null : skipReason,
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
          });
        }

        return Response.json({ ok: true, checked: (preds ?? []).length, results, durationMs: Date.now() - t0 });
      },
    },
  },
});
