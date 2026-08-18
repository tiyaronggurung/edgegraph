import { createFileRoute } from "@tanstack/react-router";
import { verifyCronRequest } from "@/lib/cronAuth";
import { evaluateBtcEntry } from "@/lib/btcEntryGate";
import { getBtcGateConfig } from "@/lib/btcGateConfig.server";
import { logBtcGateDecision } from "@/lib/btcGateLog.server";

// Server-side cron: fires the Model Bet auto-trade for every opted-in user
// every minute, 24/7 — independent of whether their browser tab is open.
// Rule: only fires when the model's side is currently ≤ 10¢ (cheap entry),
// at any point in the market's life. Base stake $5, shrunk so payout ≤ $20
// max at the observed entry price. One order per ticker per user.

export const Route = createFileRoute("/api/public/hooks/auto-model-bet-tick")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const __cronAuth = await verifyCronRequest(request); if (__cronAuth) return __cronAuth;
        const t0 = Date.now();
        const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
        const { runAutoTradeCore } = await import("@/lib/cryptoAutoTrade.functions");

        // Opted-in users only.
        const { data: settingsRows, error: settingsErr } = await supabaseAdmin
          .from("auto_odds_settings")
          .select("user_id")
          .eq("enabled", true)
          .eq("auto_button_type", "model_bet");
        if (settingsErr) {
          return Response.json({ ok: false, error: settingsErr.message }, { status: 500 });
        }
        const userIds = (settingsRows ?? []).map((r) => r.user_id).filter(Boolean);
        if (userIds.length === 0) {
          return Response.json({ ok: true, userCount: 0, results: [], durationMs: Date.now() - t0 });
        }

        // Must have Kalshi creds on profile.
        const { data: creds, error: credsErr } = await supabaseAdmin
          .from("profiles")
          .select("id, kalshi_api_key_id, kalshi_private_key_pem")
          .in("id", userIds);
        if (credsErr) {
          return Response.json({ ok: false, error: credsErr.message }, { status: 500 });
        }
        const usersWithCreds = (creds ?? []).filter(
          (p) => (p.kalshi_api_key_id ?? "").trim() && (p.kalshi_private_key_pem ?? "").trim(),
        );

        // Newest open predictions — any that are still live. Entry gate is
        // price-based (our-side ≤ 10¢), not time-based.
        const nowIso = new Date().toISOString();
        const { data: preds } = await supabaseAdmin
          .from("btc_model_predictions")
          .select("ticker, side, close_time, model_prob, study_locked_side")
          .gt("close_time", nowIso)
          .order("close_time", { ascending: true })
          .limit(10);
        const openPreds = ((preds ?? []) as Array<{ ticker: string; side: "YES" | "NO"; close_time: string; model_prob: number | null; study_locked_side: string | null }>)
          // Study-override rule: never bet the raw model side. A T7 study lock
          // must exist AND agree. Model-only entries before T+7m were coin
          // flips bought at a premium (Study won 80.4% of 209 disagreements).
          .filter((p) => (p.study_locked_side ?? "").toUpperCase() === String(p.side).toUpperCase());

        const results: Array<{ userId: string; placed: number; skipped: number; ticker?: string; error?: string; priceCents?: number; stakeUsd?: number }> = [];

        // Payout cap: max $20 per order. Contracts = floor(stake*100/price),
        // each contract pays $1, so stake ≤ price¢ / 5 keeps payout ≤ $20.
        // Base stake $5, but shrunk to hit the payout cap given the entry price.
        // Also gate: only fire if our-side price ≤ 10¢ (cheap late-window entry).
        const MAX_ENTRY_CENTS = 70;
        const BASE_STAKE = 10;
        const PAYOUT_CAP = 20;

        const MIN_SIDE_PROB = 0.60;

        for (const u of usersWithCreds) {
          let pick: {
            ticker: string; side: "YES" | "NO"; priceCents: number;
            yesCents: number | null; noCents: number | null;
            modelProbYes: number | null; closeTime: string;
          } | null = null;
          try {
            // Pick the newest open prediction the user hasn't been filled on,
            // AND whose our-side price is currently ≤ MAX_ENTRY_CENTS.

            for (const p of openPreds) {
              const { data: existing } = await supabaseAdmin
                .from("auto_trade_orders")
                .select("id")
                .eq("user_id", u.id)
                .eq("ticker", p.ticker)
                .eq("mode", "live")
                .limit(1);
              if (existing && existing.length > 0) continue;

              // Latest odds snapshot for this ticker (any user — public price).
              const { data: tape } = await supabaseAdmin
                .from("btc_odds_tape")
                .select("yes_cents, no_cents, snapped_at")
                .eq("ticker", p.ticker)
                .order("snapped_at", { ascending: false })
                .limit(1);
              const row = tape?.[0] as { yes_cents: number | null; no_cents: number | null; snapped_at: string } | undefined;
              if (!row) continue;
              // Stale > 90s → skip (odds can flip fast in the last 5 min).
              if (Date.now() - new Date(row.snapped_at).getTime() > 90_000) continue;
              const priceCents = p.side === "YES" ? Number(row.yes_cents) : Number(row.no_cents);
              if (!Number.isFinite(priceCents) || priceCents <= 0 || priceCents > MAX_ENTRY_CENTS) {
                // Additive observability: previously this filter skipped silently,
                // creating hours-long gaps in auto_model_bet_errors whenever every
                // open market printed at 99¢/0.1¢ (BTC deep on one side of strikes).
                // Log the reason so those windows show up on the health panel.
                await supabaseAdmin.from("auto_model_bet_errors").insert({
                  user_id: u.id,
                  ticker: p.ticker,
                  side: p.side,
                  price_cents: Number.isFinite(priceCents) ? priceCents : null,
                  stage: "oob_price",
                  error: `our-side price ${Number.isFinite(priceCents) ? priceCents.toFixed(1) + "¢" : "n/a"} outside (0, ${MAX_ENTRY_CENTS}¢] — market pinned`.slice(0, 500),
                });
                continue;
              }

              // Low-confidence gate: side-locked model prob must be ≥ 0.60.
              // Historical analysis: the 50–55% bucket only wins 15.6%.
              const rawProb = p.model_prob == null ? null : Number(p.model_prob);
              const sideProb = rawProb == null ? null : (p.side === "YES" ? rawProb : 1 - rawProb);
              if (sideProb == null || sideProb < MIN_SIDE_PROB) {
                await supabaseAdmin.from("auto_model_bet_errors").insert({
                  user_id: u.id,
                  ticker: p.ticker,
                  side: p.side,
                  price_cents: priceCents,
                  stage: "low_conf",
                  error: `side-locked prob ${sideProb == null ? "null" : sideProb.toFixed(3)} < ${MIN_SIDE_PROB}`.slice(0, 500),
                });
                continue;
              }

              pick = {
                ticker: p.ticker, side: p.side, priceCents,
                yesCents: Number.isFinite(Number(row.yes_cents)) ? Number(row.yes_cents) : null,
                noCents:  Number.isFinite(Number(row.no_cents))  ? Number(row.no_cents)  : null,
                modelProbYes: rawProb,
                closeTime: p.close_time,
              };
              break;
            }
            if (!pick) {
              results.push({ userId: u.id, placed: 0, skipped: 0 });
              continue;
            }

            // ── Confirmation-candle gate (Auto Model Bet only) ─────────────
            // Pull last ~5 minutes of BTC spot ticks and evaluate:
            //   1. Counter-spike: |spot(now) - spot(60s ago)| > $100 against side → skip
            //   2. Last-tick agreement: last 2 tick deltas both against side → skip
            //   3. Coin-flip chop: ≥2 direction flips across last 5 ticks → skip
            // Skips are logged to auto_model_bet_errors, never placed.
            {
              const sinceIso = new Date(Date.now() - 5 * 60_000).toISOString();
              const { data: spotRows } = await supabaseAdmin
                .from("btc_spot_ticks")
                .select("spot, observed_at")
                .gte("observed_at", sinceIso)
                .order("observed_at", { ascending: false })
                .limit(60);
              const ticks = (spotRows ?? []).map((r) => ({
                spot: Number(r.spot),
                t: new Date(r.observed_at as string).getTime(),
              })).filter((r) => Number.isFinite(r.spot));

              if (ticks.length >= 3) {
                const now = ticks[0];
                // Find tick closest to 60s ago (ticks sorted desc by time).
                const target60 = now.t - 60_000;
                let sixty = ticks[ticks.length - 1];
                for (const t of ticks) {
                  if (t.t <= target60) { sixty = t; break; }
                }
                const move60 = now.spot - sixty.spot;
                const sideSign = pick.side === "YES" ? 1 : -1;

                // 1. Counter-spike >$100 against side
                if (Math.abs(move60) > 100 && Math.sign(move60) !== sideSign) {
                  await supabaseAdmin.from("auto_model_bet_errors").insert({
                    user_id: u.id,
                    ticker: pick.ticker,
                    side: pick.side,
                    price_cents: pick.priceCents,
                    stage: "counter_spike",
                    error: `spot moved ${move60.toFixed(0)}$ in 60s against ${pick.side}`.slice(0, 500),
                  });
                  results.push({ userId: u.id, placed: 0, skipped: 1, ticker: pick.ticker });
                  continue;
                }

                // Build newest→oldest 5 deltas (each = newer - older).
                const sample = ticks.slice(0, 6);
                const deltas: number[] = [];
                for (let i = 0; i < sample.length - 1; i++) {
                  deltas.push(sample[i].spot - sample[i + 1].spot);
                }

                // 2. Last-tick agreement: last 2 deltas both against side
                if (deltas.length >= 2) {
                  const d0sign = Math.sign(deltas[0]);
                  const d1sign = Math.sign(deltas[1]);
                  if (d0sign !== 0 && d1sign !== 0 && d0sign === d1sign && d0sign !== sideSign) {
                    await supabaseAdmin.from("auto_model_bet_errors").insert({
                      user_id: u.id,
                      ticker: pick.ticker,
                      side: pick.side,
                      price_cents: pick.priceCents,
                      stage: "last_tick_disagree",
                      error: `last 2 ticks moved against ${pick.side} (${deltas[0].toFixed(1)}, ${deltas[1].toFixed(1)})`.slice(0, 500),
                    });
                    results.push({ userId: u.id, placed: 0, skipped: 1, ticker: pick.ticker });
                    continue;
                  }
                }

                // 3. Coin-flip chop: ≥2 direction flips across last 5 deltas
                if (deltas.length >= 5) {
                  let flips = 0;
                  let prevSign = 0;
                  for (const d of deltas.slice(0, 5)) {
                    const s = Math.sign(d);
                    if (s === 0) continue;
                    if (prevSign !== 0 && s !== prevSign) flips++;
                    prevSign = s;
                  }
                  if (flips >= 2) {
                    await supabaseAdmin.from("auto_model_bet_errors").insert({
                      user_id: u.id,
                      ticker: pick.ticker,
                      side: pick.side,
                      price_cents: pick.priceCents,
                      stage: "coin_flip",
                      error: `chop: ${flips} flips in last 5 ticks [${deltas.slice(0,5).map(d=>d.toFixed(1)).join(", ")}]`.slice(0, 500),
                    });
                    results.push({ userId: u.id, placed: 0, skipped: 1, ticker: pick.ticker });
                    continue;
                  }
                }
              }
            }

            // ── Shared central BTC entry gate (universal) ──
            // Uses ask from btc_odds_tape (converted cents → probability once).
            {
              const btcGateCfg = await getBtcGateConfig();
              // Convert cents → probability exactly once (cents / 100).
              const yesAskProb = pick.yesCents != null ? pick.yesCents / 100 : NaN;
              const noAskProb  = pick.noCents  != null ? pick.noCents  / 100 : NaN;
              const validYes = Number.isFinite(yesAskProb) && yesAskProb > 0 && yesAskProb < 1 ? yesAskProb : null;
              const validNo  = Number.isFinite(noAskProb)  && noAskProb  > 0 && noAskProb  < 1 ? noAskProb  : null;
              // Reconstruct P(YES) from the stored model_prob. If missing,
              // derive from side + our-side price fallback (60% floor above).
              const modelProbYes = pick.modelProbYes ?? (pick.side === "YES" ? 0.6 : 0.4);
              const secondsToClose = Math.max(0, Math.ceil((new Date(pick.closeTime).getTime() - Date.now()) / 1000));
              const decision = evaluateBtcEntry({
                lockedSide: pick.side,
                liveSide: pick.side,   // no independent live-side signal on this path
                modelProb: modelProbYes,
                yesAsk: validYes,
                noAsk: validNo,
                config: btcGateCfg,
              });
              void logBtcGateDecision({
                decision,
                sourcePath: "auto_model_bet_tick",
                ticker: pick.ticker,
                closeTime: pick.closeTime,
                secondsToClose,
                modelProb: modelProbYes,
                yesAsk: validYes,
                noAsk: validNo,
                config: btcGateCfg,
              });
              if (decision.action !== "BET") {
                await supabaseAdmin.from("auto_model_bet_errors").insert({
                  user_id: u.id,
                  ticker: pick.ticker,
                  side: pick.side,
                  price_cents: pick.priceCents,
                  stage: "central_gate",
                  error: decision.reason.slice(0, 500),
                });
                results.push({ userId: u.id, placed: 0, skipped: 1, ticker: pick.ticker });
                continue;
              }
            }

            // Size stake to keep payout ≤ $20 at the observed price.
            const stakeUsd = Math.max(1, Math.min(BASE_STAKE, Math.floor((PAYOUT_CAP * pick.priceCents) / 100 * 100) / 100));

            const res = await runAutoTradeCore(supabaseAdmin as never, u.id, {
              mode: "live",
              stakeUsd,
              confirm: "I_UNDERSTAND_LIVE",
              skipLadder: true,
              force: true,
              isMartingale: false,
              forceTicker: pick.ticker,
              forceSide: pick.side,
              maxEntryCents: MAX_ENTRY_CENTS,
              maxOrders: 1,
            });
            const placed = res.placed ?? 0;
            const skipped = res.skipped ?? 0;
            // If the core returned 0 placed AND 0 skipped it usually means a
            // Kalshi-side rejection (bad key / no balance / market closed).
            // Capture whatever reason string the core exposes so the user can
            // see it in auto_model_bet_errors instead of losing it to console.
            if (placed === 0) {
              const reason =
                (res as { reason?: string; error?: string; message?: string }).reason ??
                (res as { error?: string }).error ??
                (res as { message?: string }).message ??
                null;
              if (reason) {
                await supabaseAdmin.from("auto_model_bet_errors").insert({
                  user_id: u.id,
                  ticker: pick.ticker,
                  side: pick.side,
                  price_cents: pick.priceCents,
                  stake_usd: stakeUsd,
                  stage: "core_no_fill",
                  error: String(reason).slice(0, 500),
                });
              }
            }
            results.push({
              userId: u.id,
              placed,
              skipped,
              ticker: pick.ticker,
              priceCents: pick.priceCents,
              stakeUsd,
            });
          } catch (e) {
            const msg = (e as Error)?.message ?? String(e);
            console.error("[auto-model-bet-tick] user", u.id, msg);
            try {
              await supabaseAdmin.from("auto_model_bet_errors").insert({
                user_id: u.id,
                ticker: pick?.ticker ?? null,
                side: pick?.side ?? null,
                price_cents: pick?.priceCents ?? null,
                stage: "exception",
                error: msg.slice(0, 500),
              });
            } catch { /* swallow */ }
            results.push({ userId: u.id, placed: 0, skipped: 0, error: msg });
          }

        }

        return Response.json({
          ok: true,
          durationMs: Date.now() - t0,
          userCount: results.length,
          results,
        });
      },
    },
  },
});
