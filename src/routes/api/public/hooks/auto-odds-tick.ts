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
          .select("user_id, enabled, consecutive_losses, model_gate_min, hedge_band_lo, hedge_band_hi, tp_cents, oscillation_max, skip_bucket_lt15s, skip_bucket_15_60s")
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
          // Per-user AI-tunable parameters. Each falls back to the hardcoded
          // default when the settings row has NULL. See TUNABLE_DEFS in
          // src/lib/oddsStudy.functions.ts — safe ranges are enforced there.
          const T = {
            modelGateMin: (u as any).model_gate_min != null ? Number((u as any).model_gate_min) : 0.55,
            hedgeLo: (u as any).hedge_band_lo != null ? Number((u as any).hedge_band_lo) : 0.60,
            hedgeHi: (u as any).hedge_band_hi != null ? Number((u as any).hedge_band_hi) : 0.68,
            tpCents: (u as any).tp_cents != null ? Number((u as any).tp_cents) : 98,
            oscMax: (u as any).oscillation_max != null ? Number((u as any).oscillation_max) : 2,
            skipLt15s: (u as any).skip_bucket_lt15s === true,
            skip15_60s: (u as any).skip_bucket_15_60s === true,
          };
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

            // Consecutive-loss auto-stop DISABLED per user request (overnight run).
            // Keep counting losses for telemetry, but never disable the loop.
            // To re-enable, restore the `if (losses >= 3)` block.
            // if (losses >= 3) { ...disable... }
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

              // 5-losses-per-day auto-off REMOVED per user request. The
              // odds-bet loop now trades regardless of daily loss count.
              // (Client-side 3-in-a-row stop still applies from the browser.)

            }




            // ── 2. WHIPSAW EXIT: for each tracked open order ──
            const { data: openTracked } = await supabaseAdmin
              .from("auto_odds_tracked_orders")
              .select("id, order_id, entry_side, entry_odds, whipsaw_armed, oscillation_count, last_zone")
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

                const entryCents = o.entry_price_cents ?? o.limit_cents;
                const entryAm = t.entry_odds ?? centsToAmerican(entryCents);
                const curCentsSide = o.side === "YES" ? (m.yesAsk || m.yesPrice) : (m.noAsk || (1 - m.yesPrice));
                const curCents = Math.max(1, Math.min(99, Math.round(curCentsSide * 100)));
                const curAm = centsToAmerican(curCents);

                // ── HARD PRICE FLOOR (≤25¢) ──
                // Backtest-proven crash-catcher: fires when our side has
                // truly flipped. <1% of wins ever touch 25¢, ~half of big
                // losses do. Runs FIRST — before the T-30 exit and the
                // ≤60s lockout — because most wipes happen in the final
                // minute and existing exits are disabled there.
                if (curCents <= 25) {
                  try {
                    const res = await sellOddsBetCore(supabaseAdmin as any, userId, o.id, "hard_floor_25c");
                    if (res.ok) {
                      exits += 1;
                      await supabaseAdmin
                        .from("auto_odds_tracked_orders")
                        .update({ closed_reason: "hard_floor_25c" })
                        .eq("id", t.id);
                    }
                  } catch { /* retry next tick */ }
                  continue;
                }

                // ── T-30s TIME EXIT ──
                // In the final 30s, if we're still underwater (curCents <
                // entryCents), market-sell to avoid a full $100 wipe on
                // expiry. Runs BEFORE the ≤60s lockout below.
                if (m.secondsToClose <= 30 && curCents < entryCents) {
                  try {
                    const res = await sellOddsBetCore(supabaseAdmin as any, userId, o.id, "time_exit_t30_server");
                    if (res.ok) {
                      exits += 1;
                      await supabaseAdmin
                        .from("auto_odds_tracked_orders")
                        .update({ closed_reason: "time_exit_t30_server" })
                        .eq("id", t.id);
                    }
                  } catch { /* retry next tick */ }
                  continue;
                }

                if (m.secondsToClose <= 60) continue; // disable other exits in final 60s


                let armed = t.whipsaw_armed === true;
                // Arm sooner: any ≥150am swing away from entry (was 200) —
                // catches coin-flip conditions earlier.
                if (!armed && Math.abs(curAm - entryAm) >= 150) {
                  armed = true;
                  await supabaseAdmin
                    .from("auto_odds_tracked_orders")
                    .update({ whipsaw_armed: true })
                    .eq("id", t.id);
                }
                // Fire sooner on the return leg: within 75am of entry (was 50).
                const whipsawFire = armed && Math.abs(curAm - entryAm) <= 75;

                // 40% implied-prob exit (of ENTRY prob)
                const impliedProb = (am: number) => am < 0 ? (-am) / ((-am) + 100) : 100 / (am + 100);
                const entryProb = impliedProb(entryAm);
                const curProb = impliedProb(curAm);
                const probFire = entryProb > 0 && curProb <= 0.4 * entryProb;

                // Flip stop-loss: entry American odds in [-750, -280] (favorite
                // we bought) AND current side has drifted to ≤65¢ implied.
                // Fires earlier than a full flip so we exit while the loss is
                // still small, before the final-60s lockout.
                const flipFire = entryAm <= -280 && entryAm >= -750 && curCents <= 65;

                // Take-profit: sell as soon as picked side hits `tpCents`
                // (default 98¢; AI can tune 95-99).
                const tp98Fire = curCents >= T.tpCents;

                // Oscillation exit: odds bouncing between "shallow" (≥ -1000)
                // and "deep" (≤ -4000). Count each zone change; sell on the
                // `oscMax`-th crossing (default 3; AI can tune 2-5).
                let zone: "shallow" | "deep" | null = null;
                if (curAm >= -1000) zone = "shallow";
                else if (curAm <= -4000) zone = "deep";
                let oscCount = t.oscillation_count ?? 0;
                let newZone = t.last_zone as string | null;
                if (zone && t.last_zone && zone !== t.last_zone) {
                  oscCount += 1;
                  newZone = zone;
                } else if (zone && !t.last_zone) {
                  newZone = zone;
                }
                if (newZone !== t.last_zone || oscCount !== (t.oscillation_count ?? 0)) {
                  await supabaseAdmin
                    .from("auto_odds_tracked_orders")
                    .update({ oscillation_count: oscCount, last_zone: newZone })
                    .eq("id", t.id);
                }
                const oscFire = oscCount >= T.oscMax;


                if (tp98Fire || oscFire || whipsawFire || probFire || flipFire) {
                  const reason = tp98Fire ? "tp98_server"
                    : oscFire ? "oscillation_server"
                    : flipFire ? "flip_server"
                    : whipsawFire ? "whipsaw_server"
                    : "prob40_server";
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

            // Widened odds-only entry band: [-750, -280] (74¢–88¢).
            // Backtest across 200 trades: bucket 04 (74-78¢) hit 93% win with
            // net +$167; combined with model≥0.55 + secs≥300 gates below,
            // the widened band yields 96% win vs 86% strict. -280 floor
            // excludes bucket 03 (60% win); -750 cap excludes bucket 08.
            const inRange = (a: number) => a <= -280 && a >= -750;              // widened band 74¢–88¢

            // Time-to-close gate: only enter with ≥300s (5 min) left. Backtest
            // showed <300s trades are much more flip-prone.
            const timeGateOk = atm.secondsToClose >= 300;

            let pick: { side: "YES" | "NO"; reason: string } | null = null;
            if (remainingMs > 0 && timeGateOk) {
              const yesIn = inRange(yesAm), noIn = inRange(noAm);
              if (yesIn && !noIn) pick = { side: "YES", reason: `YES ${yesAm} in [-750,-280]` };
              else if (noIn && !yesIn) pick = { side: "NO", reason: `NO ${noAm} in [-750,-280]` };
              else if (yesIn && noIn) pick = yesAm < noAm ? { side: "YES", reason: `both in-range, YES deeper ${yesAm}` } : { side: "NO", reason: `both in-range, NO deeper ${noAm}` };
              // else: neither side in band → skip
            }

            if (!pick) {
              summary.push({ user_id: userId, entries, exits, stopped });
              continue;
            }

            // ── STRICT MODEL GATE ── (AI-tunable via T.modelGateMin)
            // Never buy when our model disagrees or is under-confident on the
            // picked side. Default 0.60; AI safe range 0.55-0.75.
            const MODEL_MIN = T.modelGateMin;
            // Coinflip hedge window: fire $5 opposite-side hedge only when
            // the model is barely agreeing with Kalshi. AI-tunable band.
            const HEDGE_MIN = T.hedgeLo;
            const HEDGE_MAX = T.hedgeHi;

            // Bucket skip (AI-tunable). AI can turn off entries in the
            // most-volatile time buckets when flip rate is too high.
            const bucketNow = atm.secondsToClose > 60 ? "60-120s" : atm.secondsToClose > 15 ? "15-60s" : "<15s";
            if ((T.skipLt15s && bucketNow === "<15s") || (T.skip15_60s && bucketNow === "15-60s")) {
              summary.push({ user_id: userId, entries, exits, stopped, note: `skipped: bucket ${bucketNow} disabled by AI tuning` });
              continue;
            }


            const modelYes = atm.modelYesProb;
            const yesFav = yesCents >= noCents;
            const kalshiFavSide: "YES" | "NO" = yesFav ? "YES" : "NO";
            const hasModel = typeof modelYes === "number" && Number.isFinite(modelYes);
            const modelSideP = hasModel
              ? (pick.side === "YES" ? modelYes! : 1 - modelYes!)
              : null;

            // Study-log helper — one row per entry attempt regardless of gate.
            // Also computes flip-detector fields vs the most recent prior row
            // for the same ticker: Δ¢ on picked side, Δspot, seconds since,
            // crossed_50 flag (picked side crossed the 50¢ line), and a
            // time-to-close bucket label for aggregation.
            const bucketFor = (s: number): string =>
              s > 120 ? ">120s" : s > 60 ? "60-120s" : s > 15 ? "15-60s" : "<15s";
            const pickedYesCents = pick.side === "YES" ? yesCents : noCents;
            const logStudy = async (opts: { entered: boolean; hedge_fired: boolean; note: string }) => {
              try {
                // Fetch most recent prior snapshot for same ticker (same user).
                const { data: prior } = await supabaseAdmin
                  .from("auto_odds_study_log")
                  .select("yes_cents, no_cents, picked_side, spot, seconds_to_close, created_at")
                  .eq("user_id", userId)
                  .eq("ticker", atm.ticker)
                  .order("created_at", { ascending: false })
                  .limit(1)
                  .maybeSingle();

                let prior_yes_cents: number | null = null;
                let yes_cents_delta: number | null = null;
                let spot_delta: number | null = null;
                let seconds_since_prior: number | null = null;
                let crossed_50 = false;
                if (prior) {
                  const priorPicked: number | null = prior.picked_side === "YES" ? prior.yes_cents : prior.no_cents;
                  if (priorPicked != null) {
                    prior_yes_cents = priorPicked;
                    yes_cents_delta = pickedYesCents - priorPicked;
                    crossed_50 = (priorPicked < 50 && pickedYesCents >= 50) || (priorPicked >= 50 && pickedYesCents < 50);
                  }
                  if (prior.spot != null && atm.spot != null) spot_delta = atm.spot - Number(prior.spot);
                  if (prior.created_at) {
                    seconds_since_prior = Math.round((Date.now() - new Date(prior.created_at).getTime()) / 1000);
                  }
                }

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
                  prior_yes_cents,
                  yes_cents_delta,
                  spot_delta,
                  seconds_since_prior,
                  crossed_50,
                  time_bucket: bucketFor(atm.secondsToClose),
                });
              } catch { /* logging is best-effort */ }
            };


            // Model prob is intentionally NOT a gate on the odds-bet path.
            // It is still recorded in the study log below for analysis only.

            // ── COOLDOWN AFTER 2 BACK-TO-BACK WINS ──
            // If the user's last 2 settled odds-bet trades were both wins,
            // pause new entries for 15 minutes of wall-clock time from the
            // moment the 2nd win settled. The point is to sit out the
            // *flip window* that typically follows a hot streak — flip risk
            // is a time phenomenon, not a count. A subsequent loss/breakeven
            // ends the streak automatically (no longer "2 wins in a row").
            // Best-effort — never blocks on error.
            const COOLDOWN_MS = 15 * 60_000;
            try {
              const { data: recentClosed } = await supabaseAdmin
                .from("auto_odds_tracked_orders")
                .select("order_id, auto_trade_orders!inner(pnl_usd, status, settled_at)")
                .eq("user_id", userId)
                .in("auto_trade_orders.status", ["settled_win", "settled_loss"])
                .not("auto_trade_orders.settled_at", "is", null)
                .order("auto_trade_orders(settled_at)", { ascending: false })
                .limit(2);
              const rows = (recentClosed ?? []) as any[];
              if (rows.length === 2) {
                const w0 = Number(rows[0].auto_trade_orders?.pnl_usd ?? 0);
                const w1 = Number(rows[1].auto_trade_orders?.pnl_usd ?? 0);
                if (w0 > 0 && w1 > 0) {
                  const streakEndedAt = new Date(rows[0].auto_trade_orders.settled_at).getTime();
                  const elapsedMs = Date.now() - streakEndedAt;
                  if (elapsedMs >= 0 && elapsedMs < COOLDOWN_MS) {
                    const remainMin = Math.max(1, Math.ceil((COOLDOWN_MS - elapsedMs) / 60_000));
                    note = `skipped: cooldown after 2 wins (${remainMin}m left)`;
                    await logStudy({ entered: false, hedge_fired: false, note });
                    summary.push({ user_id: userId, entries, exits, stopped, note });
                    continue;
                  }
                }
              }
            } catch { /* cooldown check is best-effort — never block on error */ }




            // ── PRE-ENTRY CHAOS GATE ──
            // Look at the last few study-log snapshots for this ticker in the
            // past ~2 min. If odds have been flip-flopping (multiple 50¢
            // crossings, or big total oscillation), skip entry — we don't
            // want to bet into a coin-flip market. Best-effort: on any error,
            // fall through to normal entry (never blocks by default).
            try {
              const since = new Date(Date.now() - 120_000).toISOString();
              const { data: recent } = await supabaseAdmin
                .from("auto_odds_study_log")
                .select("yes_cents, no_cents, picked_side, created_at")
                .eq("user_id", userId)
                .eq("ticker", atm.ticker)
                .gte("created_at", since)
                .order("created_at", { ascending: true });
              if (recent && recent.length >= 3) {
                let crossings = 0;
                let totalAbsDelta = 0;
                let prevPicked: number | null = null;
                for (const r of recent as any[]) {
                  const px = pick.side === "YES" ? r.yes_cents : r.no_cents;
                  if (px == null) continue;
                  if (prevPicked != null) {
                    totalAbsDelta += Math.abs(px - prevPicked);
                    if ((prevPicked < 50 && px >= 50) || (prevPicked >= 50 && px < 50)) crossings += 1;
                  }
                  prevPicked = px;
                }
                if (crossings >= 2 || totalAbsDelta >= 30) {
                  note = `skipped: chaotic market on ${atm.ticker} (${crossings} 50¢ flips, ${totalAbsDelta}¢ osc in 2min)`;
                  await logStudy({ entered: false, hedge_fired: false, note });
                  summary.push({ user_id: userId, entries, exits, stopped, note });
                  continue;
                }
              }
            } catch { /* chaos check is best-effort — never block on error */ }




            // ── 2-SECOND PERSISTENCE CHECK ──
            // Kalshi odds can flicker in/out of -450/-750 in <2s during
            // volatile moves. Wait 2s, re-fetch, and require the picked side
            // to STILL satisfy the same window's threshold. If the odds
            // moved out of range, treat as a flicker and skip.
            await new Promise(r => setTimeout(r, 2000));
            let persist: Awaited<ReturnType<typeof computeBtcMarkets>>["markets"] | null = null;
            try {
              const r = await computeBtcMarkets();
              persist = r.markets;
            } catch { /* if refetch fails, skip conservatively */ }

            const atm2 = persist?.find(m => m.ticker === atm.ticker) ?? null;
            if (!atm2) {
              note = `skipped: 2s re-check unavailable on ${atm.ticker} (was ${pick.reason})`;
              await logStudy({ entered: false, hedge_fired: false, note });
              summary.push({ user_id: userId, entries, exits, stopped, note });
              continue;
            }
            const yesCents2 = Math.max(1, Math.min(99, Math.round((atm2.yesAsk || atm2.yesPrice) * 100)));
            const noCents2 = Math.max(1, Math.min(99, Math.round((atm2.noAsk || (1 - atm2.yesPrice)) * 100)));
            const yesAm2 = centsToAmerican(yesCents2);
            const noAm2 = centsToAmerican(noCents2);
            const sideAm2 = pick.side === "YES" ? yesAm2 : noAm2;

            // Strict band on re-check for ALL phases.
            let persistOk = sideAm2 <= -450 && sideAm2 >= -750;
            let thresholdLabel = "[-750,-450]";
            if (!persistOk) {
              note = `skipped: 2s flicker — ${pick.side} was ${pick.reason}, now ${sideAm2} outside ${thresholdLabel}`;
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
              note = `entered ${placed.ticker} ${placed.side} @ ${entryCents}¢ (${pick.reason})`;

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
              // Filter out informational log lines (equity/odds-bet/force headers) so
              // the real failure reason (IOC 0-fill, kalshi order failed, insert
              // error, etc.) surfaces instead of being truncated.
              const realReasons = placeResult.skipReasons.filter(r =>
                !/^equity:/i.test(r) && !/^odds-bet:/i.test(r) && !/^force:/i.test(r));
              const shown = (realReasons.length ? realReasons : placeResult.skipReasons).slice(0, 3);
              note = `skipped: ${shown.join(" · ") || "no fill"}`;

              // Auto-disable auto-odds when Kalshi rejects this user's credentials.
              // Stops a runaway loop of failed orders; user must re-save their key
              // on Settings → Kalshi and toggle auto-odds back on.
              const authFailed = placeResult.skipReasons.some(r =>
                /authentication_error|401\s*UNAUTHORIZED|Kalshi\s*401/i.test(r));
              if (authFailed) {
                await supabaseAdmin
                  .from("auto_odds_settings")
                  .update({ enabled: false })
                  .eq("user_id", userId);
                stopped = true;
                note += " · auto-odds DISABLED (Kalshi rejected credentials — re-save your API key in Settings and re-enable)";
              }

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
