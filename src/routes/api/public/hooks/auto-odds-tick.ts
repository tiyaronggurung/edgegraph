// Auto-Odds server tick — called by pg_cron every minute.
// Runs the Odds-Bet strategy (entry + whipsaw exit + 2-loss stop) for every
// user with auto_odds_settings.enabled = true, so trading continues even when
// their browser is closed.
//
// Public route: bypasses site auth. Caller must send the anon key in the
// `apikey` header (the cron job does). We ALSO accept unauthenticated calls
// from the pg_cron process; the route itself performs no privileged action on
// behalf of arbitrary callers because all writes are scoped by user_id from
// the auto_odds_settings table (only pre-enabled users are touched).

import { createFileRoute } from "@tanstack/react-router";
import { runAutoTradeCore, sellOddsBetCore } from "@/lib/cryptoAutoTrade.functions";
import { computeBtcMarkets } from "@/lib/cryptoBtc.functions";

const WINDOW_MS = 15 * 60 * 1000;
const AUTO_ODDS_STAKE = 100;
const HEDGE_STAKE = 5; // Coinflip hedge: $5 on opposite side when model disagrees with Kalshi pick.

// American odds from Kalshi ¢ (favorites negative, dogs positive).
function centsToAmerican(cents: number): number {
  const p = Math.max(0.01, Math.min(0.99, cents / 100));
  return p >= 0.5 ? -Math.round((p / (1 - p)) * 100) : Math.round(((1 - p) / p) * 100);
}

// Kalshi weekly maintenance: Thursday 2:30–5:30 AM ET (widened around the
// official 3–5 window). Skip ALL entries and exits during this window to avoid
// suspicious-request flags from the exchange.
function isKalshiMaintenanceWindow(d: Date = new Date()): boolean {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/New_York",
    weekday: "short",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).formatToParts(d);
  const wd = parts.find(p => p.type === "weekday")?.value; // "Thu"
  const hh = parseInt(parts.find(p => p.type === "hour")?.value ?? "0", 10);
  const mm = parseInt(parts.find(p => p.type === "minute")?.value ?? "0", 10);
  if (wd !== "Thu") return false;
  const mins = hh * 60 + mm;
  return mins >= 150 && mins < 330; // 02:30 .. 05:30
}

export const Route = createFileRoute("/api/public/hooks/auto-odds-tick")({
  server: {
    handlers: {
      POST: async () => {
        if (isKalshiMaintenanceWindow()) {
          return Response.json({ ok: true, skipped: "kalshi_maintenance" });
        }

        const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

        const { data: enabledUsers } = await supabaseAdmin
          .from("auto_odds_settings")
          .select("user_id, enabled, consecutive_losses")
          .eq("enabled", true);

        if (!enabledUsers || enabledUsers.length === 0) {
          return Response.json({ ok: true, users: 0 });
        }

        let markets: Awaited<ReturnType<typeof computeBtcMarkets>>["markets"] | null = null;
        try {
          const mres = await computeBtcMarkets();
          markets = mres.markets;
        } catch (e: any) {
          return Response.json({ ok: false, error: `markets unavailable: ${e?.message ?? "err"}` }, { status: 500 });
        }

        const now = Date.now();
        const currentWindow = Math.floor(now / WINDOW_MS) * WINDOW_MS;
        const remainingMs = WINDOW_MS - (now - currentWindow);
        const currentWindowStartIso = new Date(currentWindow).toISOString();

        const summary: Array<{ user_id: string; entries: number; exits: number; stopped: boolean; note?: string }> = [];

        for (const u of enabledUsers) {
          const userId = u.user_id as string;
          let entries = 0, exits = 0, stopped = false;
          let note: string | undefined;

          try {
            // ── 1. LOSS-STOP: derive counter fresh from tail of tracked
            // orders. Race-proof: does NOT depend on processed_settle, so
            // overlapping ticks can't double-count the same settled_loss.
            // We still update processed_settle for bookkeeping / whipsaw
            // exclusion, but the count itself is a pure read.
            const { data: recentTracked } = await supabaseAdmin
              .from("auto_odds_tracked_orders")
              .select("id, order_id, processed_settle, created_at")
              .eq("user_id", userId)
              .order("created_at", { ascending: false })
              .limit(10);

            let losses = 0;
            if (recentTracked && recentTracked.length > 0) {
              const orderIds = recentTracked.map((r: any) => r.order_id);
              const { data: rows } = await supabaseAdmin
                .from("auto_trade_orders")
                .select("id, status")
                .in("id", orderIds);
              const statusMap = new Map<string, string>((rows ?? []).map((r: any) => [r.id, r.status]));

              // Walk newest → oldest; count tail-run of settled_loss until
              // any settled_win (reset) or unsettled order (stop scanning).
              for (const r of recentTracked as any[]) {
                const st = statusMap.get(r.order_id);
                if (st === "settled_loss") { losses += 1; continue; }
                if (st === "settled_win") break;
                // still open / placed / cancelled → skip (doesn't reset, doesn't count)
                continue;
              }

              // Bookkeeping: mark settled tracked rows as processed so the
              // whipsaw-exit loop below skips them.
              const settledIds = (recentTracked as any[])
                .filter(r => {
                  const st = statusMap.get(r.order_id);
                  return !r.processed_settle && (st === "settled_win" || st === "settled_loss");
                })
                .map(r => r.id);
              if (settledIds.length > 0) {
                await supabaseAdmin
                  .from("auto_odds_tracked_orders")
                  .update({ processed_settle: true })
                  .in("id", settledIds);
              }
            }

            if (losses >= 3) {
              await supabaseAdmin
                .from("auto_odds_settings")
                .update({ enabled: false, consecutive_losses: losses, stopped_reason: "three_losses", last_tick_at: new Date().toISOString() })
                .eq("user_id", userId);
              stopped = true;
              summary.push({ user_id: userId, entries, exits, stopped, note: "stopped: 2 losses" });
              continue;
            }
            if (losses !== (u.consecutive_losses ?? 0)) {
              await supabaseAdmin
                .from("auto_odds_settings")
                .update({ consecutive_losses: losses })
                .eq("user_id", userId);
            }

            // ── 1b. DAILY 5-LOSSES CAP ──
            // Count settled losses across tracked auto-odds orders since ET
            // midnight. At ≥5 → hard stop for the rest of the ET day.
            // No override: rule re-arms only at next ET midnight.
            {
              const nowD = new Date();
              const partsD = new Intl.DateTimeFormat("en-US", {
                timeZone: "America/New_York",
                year: "numeric", month: "2-digit", day: "2-digit",
                hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: false,
              }).formatToParts(nowD);
              const getP = (t: string) => partsD.find(p => p.type === t)?.value ?? "0";
              const yy = +getP("year"), mo = +getP("month"), dd = +getP("day");
              const hh2 = +getP("hour"), mi2 = +getP("minute"), ss2 = +getP("second");
              const wallUtc = Date.UTC(yy, mo - 1, dd, hh2, mi2, ss2);
              const offset = wallUtc - nowD.getTime();
              const etMidnightUtc = new Date(Date.UTC(yy, mo - 1, dd, 0, 0, 0) - offset);

              const { data: todayTracked } = await supabaseAdmin
                .from("auto_odds_tracked_orders")
                .select("order_id")
                .eq("user_id", userId)
                .gte("created_at", etMidnightUtc.toISOString());
              const todayIds = (todayTracked ?? []).map((r: any) => r.order_id);
              if (todayIds.length > 0) {
                const { count: lossCount } = await supabaseAdmin
                  .from("auto_trade_orders")
                  .select("id", { count: "exact", head: true })
                  .in("id", todayIds)
                  .eq("status", "settled_loss");
                if ((lossCount ?? 0) >= 5) {
                  await supabaseAdmin
                    .from("auto_odds_settings")
                    .update({ enabled: false, stopped_reason: "daily_5_losses", last_tick_at: new Date().toISOString() })
                    .eq("user_id", userId);
                  stopped = true;
                  summary.push({ user_id: userId, entries, exits, stopped, note: `stopped: ${lossCount} losses today` });
                  continue;
                }
              }
            }




            // ── 2. WHIPSAW EXIT: for each tracked open order ──
            const { data: openTracked } = await supabaseAdmin
              .from("auto_odds_tracked_orders")
              .select("id, order_id, entry_side, entry_odds, whipsaw_armed")
              .eq("user_id", userId)
              .eq("processed_settle", false);

            if (openTracked && openTracked.length > 0) {
              const orderIds = openTracked.map((r: any) => r.order_id);
              const { data: openOrders } = await supabaseAdmin
                .from("auto_trade_orders")
                .select("id, ticker, side, status, contracts, contracts_remaining, entry_price_cents, limit_cents, close_time")
                .in("id", orderIds)
                .eq("status", "placed");
              const orderMap = new Map<string, any>((openOrders ?? []).map((r: any) => [r.id, r]));

              for (const t of openTracked as any[]) {
                const o = orderMap.get(t.order_id);
                if (!o) continue;
                const remaining = o.contracts_remaining ?? o.contracts;
                if (remaining <= 0) continue;

                const m = markets.find(mm => mm.ticker === o.ticker);
                if (!m) continue;
                if (m.secondsToClose <= 60) continue; // disable in final 60s

                const entryCents = o.entry_price_cents ?? o.limit_cents;
                const entryAm = t.entry_odds ?? centsToAmerican(entryCents);
                const curCentsSide = o.side === "YES" ? (m.yesAsk || m.yesPrice) : (m.noAsk || (1 - m.yesPrice));
                const curCents = Math.max(1, Math.min(99, Math.round(curCentsSide * 100)));
                const curAm = centsToAmerican(curCents);

                let armed = t.whipsaw_armed === true;
                if (!armed && Math.abs(curAm - entryAm) >= 200) {
                  armed = true;
                  await supabaseAdmin
                    .from("auto_odds_tracked_orders")
                    .update({ whipsaw_armed: true })
                    .eq("id", t.id);
                }
                const whipsawFire = armed && Math.abs(curAm - entryAm) <= 50;

                // 40% implied-prob exit (of ENTRY prob)
                const impliedProb = (am: number) => am < 0 ? (-am) / ((-am) + 100) : 100 / (am + 100);
                const entryProb = impliedProb(entryAm);
                const curProb = impliedProb(curAm);
                const probFire = entryProb > 0 && curProb <= 0.4 * entryProb;

                // Flip stop-loss: entry American odds in [-750, -450] (deep
                // favorite we bought) AND current side has drifted to ≤65¢
                // implied. Fires earlier than a full flip so we exit while
                // the loss is still small, before the final-60s lockout.
                const flipFire = entryAm <= -450 && entryAm >= -750 && curCents <= 65;

                if (whipsawFire || probFire || flipFire) {
                  const reason = flipFire ? "flip_server" : whipsawFire ? "whipsaw_server" : "prob40_server";
                  try {
                    const res = await sellOddsBetCore(supabaseAdmin as any, userId, o.id, reason);
                    if (res.ok) {
                      exits += 1;
                      await supabaseAdmin
                        .from("auto_odds_tracked_orders")
                        .update({ closed_reason: reason })
                        .eq("id", t.id);
                    }
                  } catch { /* retry next tick */ }
                }

              }
            }

            // ── 3. ENTRY: only if no tracked order yet in current 15m window ──
            if (remainingMs > 12 * 60_000 + 30_000) {
              summary.push({ user_id: userId, entries, exits, stopped });
              continue;
            }

            const { count: winTracked } = await supabaseAdmin
              .from("auto_odds_tracked_orders")
              .select("id", { count: "exact", head: true })
              .eq("user_id", userId)
              .gte("created_at", currentWindowStartIso);
            if ((winTracked ?? 0) > 0) {
              summary.push({ user_id: userId, entries, exits, stopped, note: "already fired this window" });
              continue;
            }

            const active = markets.filter(m => m.secondsToClose > 0 && m.secondsToClose <= 15 * 60 + 60);
            if (active.length === 0) {
              summary.push({ user_id: userId, entries, exits, stopped });
              continue;
            }
            const spotRef = active[0].spot ?? 0;
            const atm = active.slice().sort((a, b) => Math.abs(a.strike - spotRef) - Math.abs(b.strike - spotRef))[0];
            const yesCents = Math.max(1, Math.min(99, Math.round((atm.yesAsk || atm.yesPrice) * 100)));
            const noCents = Math.max(1, Math.min(99, Math.round((atm.noAsk || (1 - atm.yesPrice)) * 100)));
            const yesAm = centsToAmerican(yesCents);
            const noAm = centsToAmerican(noCents);

            const inRange = (a: number) => a <= -450 && a >= -750;
            const deepFav = (a: number) => a <= -300;

            let pick: { side: "YES" | "NO"; reason: string } | null = null;
            if (remainingMs > 2 * 60_000) {
              const yesIn = inRange(yesAm), noIn = inRange(noAm);
              if (yesIn && !noIn) pick = { side: "YES", reason: `YES ${yesAm} in [-750,-450]` };
              else if (noIn && !yesIn) pick = { side: "NO", reason: `NO ${noAm} in [-750,-450]` };
              else if (yesIn && noIn) pick = yesAm < noAm ? { side: "YES", reason: `both in-range, YES deeper ${yesAm}` } : { side: "NO", reason: `both in-range, NO deeper ${noAm}` };
            } else if (remainingMs > 15_000) {
              const yesDeep = deepFav(yesAm), noDeep = deepFav(noAm);
              if (yesDeep && !noDeep) pick = { side: "YES", reason: `≤2:00 fallback YES ${yesAm}` };
              else if (noDeep && !yesDeep) pick = { side: "NO", reason: `≤2:00 fallback NO ${noAm}` };
              else if (yesDeep && noDeep) pick = yesAm < noAm ? { side: "YES", reason: `both ≤-300, YES deeper ${yesAm}` } : { side: "NO", reason: `both ≤-300, NO deeper ${noAm}` };
            } else if (remainingMs > 0) {
              const distTo = (a: number) => a > -450 ? Math.abs(-450 - a) : a < -750 ? Math.abs(a - -750) : 0;
              const yd = distTo(yesAm), nd = distTo(noAm);
              pick = yd <= nd ? { side: "YES", reason: `close-window closest YES ${yesAm}` } : { side: "NO", reason: `close-window closest NO ${noAm}` };
            }

            if (!pick) {
              summary.push({ user_id: userId, entries, exits, stopped });
              continue;
            }

            // ── STRICT MODEL GATE ──
            // Never buy when our model disagrees or is under-confident on the
            // picked side. Blocks real-money entries at model <60% no matter
            // how deep Kalshi's odds are. Applies to all three windows.
            const MODEL_MIN = 0.60;
            // Coinflip hedge window: fire $5 opposite-side hedge only when
            // the model is barely agreeing with Kalshi (right above the gate
            // floor). Naturally fires ~1 in 4-5 trades since most passes sit
            // higher than 68%.
            const HEDGE_MIN = 0.60;
            const HEDGE_MAX = 0.68;

            const modelYes = atm.modelYesProb;
            const yesFav = yesCents >= noCents;
            const kalshiFavSide: "YES" | "NO" = yesFav ? "YES" : "NO";
            const hasModel = typeof modelYes === "number" && Number.isFinite(modelYes);
            const modelSideP = hasModel
              ? (pick.side === "YES" ? modelYes! : 1 - modelYes!)
              : null;

            // Study-log helper — one row per entry attempt regardless of gate.
            const logStudy = async (opts: { entered: boolean; hedge_fired: boolean; note: string }) => {
              try {
                await supabaseAdmin.from("auto_odds_study_log").insert({
                  user_id: userId,
                  window_start_at: currentWindowStartIso,
                  ticker: atm.ticker,
                  seconds_to_close: atm.secondsToClose,
                  spot: atm.spot ?? null,
                  yes_cents: yesCents,
                  no_cents: noCents,
                  yes_american: yesAm,
                  no_american: noAm,
                  model_yes_prob: hasModel ? modelYes : null,
                  kalshi_favorite_side: kalshiFavSide,
                  picked_side: pick.side,
                  model_side_prob: modelSideP,
                  entered: opts.entered,
                  hedge_fired: opts.hedge_fired,
                  note: opts.note.slice(0, 500),
                });
              } catch { /* logging is best-effort */ }
            };

            if (!hasModel) {
              note = `skipped: no model prob on ${atm.ticker} (Kalshi ${pick.reason})`;
              await logStudy({ entered: false, hedge_fired: false, note });
              summary.push({ user_id: userId, entries, exits, stopped, note });
              continue;
            }
            if ((modelSideP as number) < MODEL_MIN) {
              note = `skipped: model ${((modelSideP as number) * 100).toFixed(1)}% on ${pick.side} < ${(MODEL_MIN * 100).toFixed(0)}% (Kalshi ${pick.reason})`;
              await logStudy({ entered: false, hedge_fired: false, note });
              summary.push({ user_id: userId, entries, exits, stopped, note });
              continue;
            }

            const placeResult = await runAutoTradeCore(supabaseAdmin as any, userId, {
              mode: "live",
              confirm: "I_UNDERSTAND_LIVE",
              force: true,
              isMartingale: false,
              maxOrders: 1,
              stakeUsd: AUTO_ODDS_STAKE,
              forceTicker: atm.ticker,
              forceSide: pick.side,
            });

            let hedgeFired = false;

            if (placeResult.placed > 0 && placeResult.orders[0]) {
              const placed = placeResult.orders[0];
              entries += 1;
              const entryCents = placed.entry_price_cents ?? placed.limit_cents;
              await supabaseAdmin
                .from("auto_odds_tracked_orders")
                .insert({
                  user_id: userId,
                  order_id: placed.id,
                  entry_side: placed.side,
                  entry_odds: centsToAmerican(entryCents),
                });
              note = `entered ${placed.ticker} ${placed.side} @ ${entryCents}¢ · model ${((modelSideP as number) * 100).toFixed(1)}% (${pick.reason})`;

              // ── 3b. COINFLIP-ZONE HEDGE ──
              // Fire $5 hedge on the OPPOSITE side only when the model is in
              // the true coinflip zone [60%, 68%] on our picked side — i.e.
              // barely above the gate floor. NOT inserted into
              // auto_odds_tracked_orders: does NOT count toward the 2-loss
              // tail stop, daily 5-loss cap, or trigger whipsaw exits.
              try {
                const p = modelSideP as number;
                if (p >= HEDGE_MIN && p <= HEDGE_MAX) {
                  const oppSide: "YES" | "NO" = pick.side === "YES" ? "NO" : "YES";
                  const hedgeRes = await runAutoTradeCore(supabaseAdmin as any, userId, {
                    mode: "live",
                    confirm: "I_UNDERSTAND_LIVE",
                    force: true,
                    isMartingale: false,
                    maxOrders: 1,
                    stakeUsd: HEDGE_STAKE,
                    forceTicker: atm.ticker,
                    forceSide: oppSide,
                  });
                  if (hedgeRes.placed > 0) {
                    hedgeFired = true;
                    note += ` · coinflip hedge ${oppSide} $${HEDGE_STAKE}`;
                  } else {
                    note += ` · hedge skipped: ${hedgeRes.skipReasons.slice(0, 1).join("") || "no fill"}`;
                  }
                }
              } catch (e: any) {
                note += ` · hedge err: ${e?.message?.slice(0, 60) ?? "err"}`;
              }

              await logStudy({ entered: true, hedge_fired: hedgeFired, note });
            } else {
              note = `skipped: ${placeResult.skipReasons.slice(0, 2).join(" · ") || "no fill"}`;
              await logStudy({ entered: false, hedge_fired: false, note });
            }
          } catch (e: any) {
            note = `err: ${e?.message?.slice(0, 120) ?? String(e).slice(0, 120)}`;
          }

          await supabaseAdmin
            .from("auto_odds_settings")
            .update({ last_tick_at: new Date().toISOString() })
            .eq("user_id", userId);

          summary.push({ user_id: userId, entries, exits, stopped, note });
        }

        return Response.json({ ok: true, users: enabledUsers.length, summary });
      },
    },
  },
});
