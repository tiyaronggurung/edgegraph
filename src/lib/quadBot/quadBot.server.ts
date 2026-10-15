// Quad-Confirmation paper engine (PAPER ONLY — never places real orders).
// Runs three strategies side by side on the same live signals:
//   A  Quad entry: whale (rn1 ≥70% one side) + Study + Model + our odds >52% agree → $leg1, ride to settle.
//   B  Own-odds speed hedge (no whale): our screen odds ≥65% one side, minute 1:30–10:00, Kalshi ask 50–68¢.
//      Single leg sells at Kalshi bid ≥88¢. If our odds peaked ≥80¢ then fell to ≤65¢, buys the same number
//      of opposite contracts while Kalshi still lags (only if the pair guarantees profit). If our odds fall
//      to ≤38¢, a contract-matched rescue leg caps the loss. Fills at Kalshi's real ask plus taker fee.
//   C  Hybrid: A's entry (plus late tiebreaker), equal-dollar opposite leg at ≤ pair_max; no guaranteed lock.
// NULL fallback: if Study OR Model is missing, the other plus odds ≥60% stands in.
// If both are missing, or odds are stale, no new entries (open legs may still hedge).
// Fills priced at our odds (YES = p_up, NO = 1 − p_up); settled on logged spot vs strike.

import { fetchLiveAskCents, fetchLiveBidCents } from "@/lib/kalshiLiveQuote.server";
import { sizeCEqualDollarHedge } from "./cHedgeSizing";
import { calculateCSettlement } from "./cSettlement";
import { B_ENTRY_MAX_MS, B_ENTRY_MIN_MS, B_ENTRY_ODDS, B_REVERSAL_ODDS, decideBHedge, kalshiFee } from "./bReversal";

const B_TAKE_PROFIT_CENTS = 88; // B sells everything once the Kalshi bid reaches this
import { type TapeSample, computeUpProbability, effectiveVol, momentumTilt } from "@/lib/ourOdds";

const WINDOW_MS = 900_000;
const STALE_SEC = 30;
const RN1 = "0xb55fa1296e6ec55d0ce53d93b9237389f11764d4";
const STRATS = ["A", "B", "C"] as const;
type Side = "UP" | "DOWN";

async function whaleSplit(windowStartMs: number) {
  try {
    const slug = `btc-updown-15m-${Math.floor(windowStartMs / 1000)}`;
    const res = await fetch(
      `https://data-api.polymarket.com/activity?user=${RN1}&limit=300&type=TRADE`,
      { headers: { accept: "application/json", "user-agent": "Mozilla/5.0" } },
    );
    if (!res.ok) return null;
    const rows = (await res.json()) as any[];
    let up = 0, down = 0;
    for (const r of rows) {
      if (r.slug !== slug || r.side !== "BUY") continue;
      const v = Number(r.usdcSize) || 0;
      if (r.outcome === "Up") up += v; else if (r.outcome === "Down") down += v;
    }
    const total = up + down;
    if (total < 20) return { up, down, side: null as Side | null, share: 0 };
    const side: Side = up >= down ? "UP" : "DOWN";
    return { up, down, side, share: Math.max(up, down) / total };
  } catch {
    return null;
  }
}

// Live signals read directly from their sources (not the agreement log, which can stall):
//  strike + ticker  → btc_model_predictions row for this window (close_time)
//  odds             → spot tape (btc_spot_ticks) with the same math as /crypto
//  model / study    → same row
async function liveSignals(sb: any, wStartMs: number, secsLeft: number) {
  const closeIso = new Date(wStartMs + WINDOW_MS).toISOString();
  const [{ data: led }, { data: ticks }] = await Promise.all([
    sb.from("btc_model_predictions").select("ticker, strike, side, model_side_pre_study, model_prob, study_locked_side, study_lean_side")
      .eq("close_time", closeIso).order("created_at", { ascending: false }).limit(1).maybeSingle(),
    sb.from("btc_spot_ticks").select("observed_at, spot, source")
      .gte("observed_at", new Date(Date.now() - 5 * 60_000).toISOString())
      .in("source", ["coinbase", "consolidated"]).order("observed_at", { ascending: true }).limit(2000),
  ]);
  const rows = (ticks ?? []) as any[];
  const pref = rows.filter((r) => r.source === "coinbase");
  const tape: TapeSample[] = (pref.length >= 10 ? pref : rows)
    .map((r) => ({ t: Date.parse(r.observed_at), p: Number(r.spot) }))
    .filter((x) => Number.isFinite(x.t) && x.p > 0).sort((a, b) => a.t - b.t);
  // Strike fallback: if this window's model row is missing, use the first logged spot at window open.
  let strike = led?.strike != null ? Number(led.strike) : null;
  if (strike == null) {
    const { data: o } = await sb.from("btc_spot_ticks").select("spot").in("source", ["coinbase", "consolidated"])
      .gte("observed_at", new Date(wStartMs).toISOString()).lte("observed_at", new Date(wStartMs + 15_000).toISOString())
      .order("observed_at", { ascending: true }).limit(1).maybeSingle();
    if (o?.spot) strike = Number(o.spot);
  }
  let pUp: number | null = null;
  let tickAt: number | null = null;
  if (tape.length >= 10 && strike) {
    const last = tape[tape.length - 1];
    tickAt = last.t;
    const sigma = effectiveVol(tape, [], secsLeft) ?? 0.5;
    const base = computeUpProbability({ spot: last.p, strike, secondsToClose: secsLeft, sigmaAnnualized: sigma });
    if (base != null) pUp = Math.min(0.995, Math.max(0.005, base + momentumTilt(tape, 60_000, secsLeft)));
  }
  const yn = (v: any): Side | null => (v === "YES" ? "UP" : v === "NO" ? "DOWN" : null);
  const pr = led;
  const model: Side | null = yn(pr?.model_side_pre_study) ?? yn(pr?.side)
    ?? (pr?.model_prob != null ? (Number(pr.model_prob) >= 0.5 ? "UP" : "DOWN") : null);
  const study: Side | null = yn(pr?.study_locked_side);
  const studyLean: Side | null = yn(pr?.study_lean_side);
  return { pUp, tickAt, strike, spot: tape.length ? tape[tape.length - 1].p : null, ticker: led?.ticker ?? null, model, study, studyLean };
}

// Screen odds for B: the exact useStrikeOdds UP value plotted on the live chart,
// saved to live_odds_windows as [secondInWindow, up*1000]. Fresh only if the last
// point is ≤20s old; otherwise null (B must not trade).
const SCREEN_MAX_AGE_SEC = 20;
async function screenSeries(sb: any, wStartMs: number) {
  const { data } = await sb.from("live_odds_windows").select("points")
    .eq("window_start", new Date(wStartMs).toISOString()).maybeSingle();
  const pts = ((data?.points ?? []) as [number, number][])
    .map(([s, u]) => [Number(s), Number(u) / 1000] as [number, number])
    .filter(([s, u]) => Number.isFinite(s) && u > 0 && u < 1);
  if (!pts.length) return null;
  const [sec, up] = pts.reduce((a, b) => (b[0] > a[0] ? b : a));
  return { pts, up, ageSec: Math.round((Date.now() - (wStartMs + sec * 1000)) / 1000) };
}
async function screenOdds(sb: any, wStartMs: number): Promise<{ up: number; ageSec: number } | null> {
  const s = await screenSeries(sb, wStartMs);
  if (!s || !(s.ageSec >= 0 && s.ageSec <= SCREEN_MAX_AGE_SEC)) return null;
  return { up: s.up, ageSec: s.ageSec };
}

export async function runQuadBotTick() {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const sb = supabaseAdmin as any;
  const { data: s0 } = await sb.from("qc_settings").select("*").eq("id", 1).single();
  if (!s0?.running) return { skipped: "paused" };
  // Atomic claim so overlapping cron calls can't double-buy or double-settle.
  const { data: claimed } = await sb.from("qc_settings").update({ last_tick_at: new Date().toISOString() })
    .eq("id", 1).lt("last_tick_at", new Date(Date.now() - 1500).toISOString()).select("*");
  const s = claimed?.[0];
  if (!s) return { busy: true };

  const leg1 = Number(s.leg1_usd);
  const entryMax = Number(s.entry_max), pairMax = Number(s.pair_max);
  const nowMs = Date.now();
  const wStartMs = Math.floor(nowMs / WINDOW_MS) * WINDOW_MS;
  const wIso = new Date(wStartMs).toISOString();
  const msIn = nowMs - wStartMs;
  const secsLeft = Math.round((wStartMs + WINDOW_MS - nowMs) / 1000);
  const fills: any[] = [];
  let err: string | null = null;
  let signals: any = null;

  try {
    // 1. Settle closed windows (wait 20s after close so the closing data lands).
    // Sources, in order: logged window outcome → strike (window row, else 1m candle open)
    // vs close (spot tick in last 60s, else 1m candle close). Spot ticks are pruned after
    // ~25 min and the window row can be missing, so candles keep settlement from stalling.
    const { data: open } = await sb.from("qc_positions").select("*").eq("settled", false)
      .lt("window_start", new Date(wStartMs - (msIn < 20_000 ? WINDOW_MS : 0)).toISOString());
    for (const p of open ?? []) {
      const startMs = Date.parse(p.window_start);
      const closeMs = startMs + WINDOW_MS;
      const iso = (ms: number) => new Date(ms).toISOString();
      const [{ data: led }, { data: tk }, { data: cOpen }, { data: cClose }] = await Promise.all([
        sb.from("btc_model_predictions").select("strike, outcome").eq("close_time", iso(closeMs))
          .order("created_at", { ascending: false }).limit(1).maybeSingle(),
        sb.from("btc_spot_ticks").select("spot").in("source", ["coinbase", "consolidated"])
          .lte("observed_at", iso(closeMs)).gte("observed_at", iso(closeMs - 60_000))
          .order("observed_at", { ascending: false }).limit(1).maybeSingle(),
        sb.from("btc_candles").select("o").eq("tf", "1m").eq("bucket_start", iso(startMs)).limit(1).maybeSingle(),
        sb.from("btc_candles").select("c").eq("tf", "1m").eq("bucket_start", iso(closeMs - 60_000)).limit(1).maybeSingle(),
      ]);
      const strike = led?.strike != null ? Number(led.strike) : cOpen?.o != null ? Number(cOpen.o) : null;
      const spot = tk?.spot != null ? Number(tk.spot) : cClose?.c != null ? Number(cClose.c) : null;
      let result: Side | null = led?.outcome === "YES" ? "UP" : led?.outcome === "NO" ? "DOWN" : null;
      if (!result && strike != null && spot != null && spot !== strike) result = spot > strike ? "UP" : "DOWN";
      if (!result) continue;
      const last = { spot: spot ?? "n/a", strike: strike ?? "n/a" };
      const cSettlement = p.strategy === "C" ? calculateCSettlement({ ...p, result }) : null;
      const payout = cSettlement?.payout ?? (result === "UP" ? Number(p.up_ct) : Number(p.down_ct));
      const pnl = cSettlement?.pnl ?? Math.round((payout - Number(p.up_cost) - Number(p.down_cost)) * 100) / 100;
      const { data: upd } = await sb.from("qc_positions").update({ settled: true, result, payout, pnl, settled_at: new Date().toISOString() })
        .eq("id", p.id).eq("settled", false).select("id");
      if (!upd?.length) continue;
      fills.push({ strategy: p.strategy, window_start: p.window_start, side: result, kind: "settle", amount: payout,
        reason: `settled ${result} · spot ${last.spot} vs strike ${last.strike} · P&L ${pnl}` });
    }

    // 2. Signals — live sources first, agreement log only as a fallback.
    const [live, whale, { data: ag }] = await Promise.all([
      liveSignals(sb, wStartMs, secsLeft),
      whaleSplit(wStartMs),
      sb.from("btc_agreement_log").select("bucket_sec, odds_p_up, model_side, study_side")
        .eq("window_start", wIso).order("bucket_sec", { ascending: false }).limit(1).maybeSingle(),
    ]);
    const norm = (v: any): Side | null => (v ? (String(v).toUpperCase().startsWith("U") ? "UP" : "DOWN") : null);
    const agFresh = ag && Date.now() / 1000 - Number(ag.bucket_sec) <= STALE_SEC;
    const liveFresh = live.pUp != null && live.tickAt != null && Date.now() - live.tickAt <= STALE_SEC * 1000;
    const pUp = liveFresh ? live.pUp : agFresh && ag.odds_p_up != null ? Number(ag.odds_p_up) : null;
    const fresh = pUp != null && pUp > 0 && pUp < 1;
    // Study: real lock first; the always-on lean fills every window the lock skipped.
    const study = live.study ?? live.studyLean ?? (agFresh ? norm(ag.study_side) : null);
    const model = live.model ?? (agFresh ? norm(ag.model_side) : null);
    const oddsSide: Side | null = pUp == null ? null : pUp > 0.52 ? "UP" : pUp < 0.48 ? "DOWN" : null;
    const oddsFor = (side: Side) => (pUp == null ? 0 : side === "UP" ? pUp : 1 - pUp);
    const price = (side: Side) => (side === "UP" ? pUp! : 1 - pUp!);
    signals = { pUp, fresh, study, studyLocked: live.study, studyLean: live.studyLean, model, oddsSide, whale, secsLeft, strike: live.strike, spot: live.spot, ticker: live.ticker, oddsSource: liveFresh ? "live" : agFresh ? "log" : null };

    // Quad confirmation with NULL fallback.
    let quad: Side | null = null;
    let quadWhy = "";
    if (fresh && whale?.side && whale.share >= 0.7 && oddsSide === whale.side) {
      const side = whale.side;
      if (study === side && model === side) { quad = side; quadWhy = "whale+study+model+odds"; }
      else if (study == null && model === side && oddsFor(side) >= 0.6) { quad = side; quadWhy = "whale+model+odds≥60 (study null)"; }
      else if (model == null && study === side && oddsFor(side) >= 0.6) { quad = side; quadWhy = "whale+study+odds≥60 (model null)"; }
    }
    // Late tiebreaker (C only): last 3 min, Study≠Model, odds >55% for one of them.
    let late: Side | null = null;
    if (fresh && secsLeft <= 180 && study && model && study !== model) {
      const s2 = oddsFor(study) > 0.55 ? study : oddsFor(model) > 0.55 ? model : null;
      if (s2) late = s2;
    }
    signals.quad = quad; signals.late = late;

    // B take-profit: sell 100% at Kalshi's live bid once it reaches 88¢ (no stop loss).
    // Runs regardless of our odds freshness; the position is closed and P&L banked immediately.
    {
      const { data: bp } = await sb.from("qc_positions").select("*").eq("strategy", "B").eq("window_start", wIso)
        .eq("settled", false).maybeSingle();
      const ct = bp ? Math.max(Number(bp.up_ct), Number(bp.down_ct)) : 0;
      const singleLeg = bp && !bp.locked && (Number(bp.up_ct) === 0 || Number(bp.down_ct) === 0);
      if (bp && singleLeg && ct > 0 && live.ticker && secsLeft > 5) {
        const held: Side = Number(bp.up_ct) > 0 ? "UP" : "DOWN";
        const bidC = await fetchLiveBidCents(live.ticker, held === "UP" ? "YES" : "NO");
        if (bidC != null && bidC >= B_TAKE_PROFIT_CENTS) {
          const px = bidC / 100;
          const fee = Math.ceil(0.07 * ct * px * (1 - px) * 100 - 1e-9) / 100;
          const proceeds = Math.round((ct * px - fee) * 100) / 100;
          const pnl = Math.round((proceeds - Number(bp.up_cost) - Number(bp.down_cost)) * 100) / 100;
          const { data: upd } = await sb.from("qc_positions")
            .update({ settled: true, result: held, payout: proceeds, pnl, settled_at: new Date().toISOString() })
            .eq("id", bp.id).eq("settled", false).select("id");
          if (upd?.length) {
            fills.push({ strategy: "B", window_start: wIso, side: held, kind: "exit", contracts: ct, price: px, amount: proceeds,
              reason: `take profit at Kalshi bid ${bidC}¢ · fee $${fee.toFixed(2)} · banked P&L ${pnl >= 0 ? "+" : ""}$${pnl.toFixed(2)}`,
              signals, ms_from_start: msIn });
          }
        } else if (secsLeft > 15) {
          // B 2.0 speed hedge: our screen odds turned against the held side before Kalshi repriced.
          const series = await screenSeries(sb, wStartMs);
          if (series && series.ageSec <= SCREEN_MAX_AGE_SEC) {
            const entrySec = (Date.parse(bp.created_at) - wStartMs) / 1000;
            const toHeld = (u: number) => (held === "UP" ? u : 1 - u);
            const opp: Side = held === "UP" ? "DOWN" : "UP";
            const nowHeld = toHeld(series.up);
            const mayHedge = nowHeld <= B_REVERSAL_ODDS;
            const oppAskC = mayHedge ? await fetchLiveAskCents(live.ticker, opp === "UP" ? "YES" : "NO") : null;
            const d = mayHedge ? decideBHedge({
              heldOddsSinceEntry: series.pts.filter(([s]) => s >= entrySec).map(([, u]) => toHeld(u)),
              heldOddsNow: nowHeld, heldContracts: ct,
              heldCost: Number(bp.up_cost) + Number(bp.down_cost),
              oppAsk: oppAskC != null ? oppAskC / 100 : null,
            }) : null;
            if (d) {
              const patch: any = { locked: true };
              if (opp === "UP") { patch.up_ct = d.contracts; patch.up_cost = d.cost; }
              else { patch.down_ct = d.contracts; patch.down_cost = d.cost; }
              const { data: upd } = await sb.from("qc_positions").update(patch)
                .eq("id", bp.id).eq("settled", false).eq("locked", false).select("id");
              if (upd?.length) {
                fills.push({ strategy: "B", window_start: wIso, side: opp, kind: "hedge", contracts: d.contracts, price: d.px,
                  amount: d.cost, reason: `${d.why} · fee $${kalshiFee(d.contracts, d.px).toFixed(2)}`, signals, ms_from_start: msIn });
              }
            }
          }
        }
      }
    }

    const canEnter = fresh && msIn >= B_ENTRY_MIN_MS && secsLeft > 60;
    if (fresh && secsLeft > 60) {
      for (const strat of STRATS) {
        const { data: pos } = await sb.from("qc_positions").select("*").eq("strategy", strat).eq("window_start", wIso).maybeSingle();
        const empty = !pos || (Number(pos.up_ct) === 0 && Number(pos.down_ct) === 0);
        const buy = async (side: Side, usd: number, kind: string, why: string, lock = false, real?: { px: number }) => {
          const px = real?.px ?? price(side);
          // Real Kalshi fills: taker fee = ceil(0.07 × contracts × P × (1−P)) to the cent; fee counts in cost.
          const feeOf = (n: number) => (real ? Math.ceil(0.07 * n * px * (1 - px) * 100 - 1e-9) / 100 : 0);
          let ct = strat === "C" && kind === "hedge" ? sizeCEqualDollarHedge(usd, px) : Math.floor(usd / px);
          while (real && ct > 0 && ct * px + feeOf(ct) > usd) ct--;
          if (ct < 1) return;
          const fee = feeOf(ct);
          const cost = Math.round((ct * px + fee) * 100) / 100;
          // B's own reason already names the Kalshi ask it paid; here we only add the fee.
          if (real) why += ` · fee $${fee.toFixed(2)}`;
          const row: any = { strategy: strat, window_start: wIso };
          if (side === "UP") { row.up_ct = Number(pos?.up_ct ?? 0) + ct; row.up_cost = Number(pos?.up_cost ?? 0) + cost; }
          else { row.down_ct = Number(pos?.down_ct ?? 0) + ct; row.down_cost = Number(pos?.down_cost ?? 0) + cost; }
          if (lock) row.locked = true;
          await sb.from("qc_positions").upsert(row, { onConflict: "strategy,window_start" });
          fills.push({ strategy: strat, window_start: wIso, side, kind, contracts: ct, price: px, amount: cost,
            reason: why, signals, ms_from_start: msIn });
        };
        if (empty) {
          if (!canEnter) continue;
          if (strat === "A" && quad && price(quad) <= entryMax) await buy(quad, leg1, "entry", `quad: ${quadWhy}`);
          if (strat === "B" && msIn <= B_ENTRY_MAX_MS) {
            // B 2.0: our own screen odds only (no whale). ≥65% one side, Kalshi ask 50–68¢.
            const screen = await screenOdds(sb, wStartMs);
            signals.screenPUp = screen?.up ?? null;
            signals.screenAgeSec = screen?.ageSec ?? null;
            const side: Side | null = !screen ? null : screen.up >= B_ENTRY_ODDS ? "UP" : 1 - screen.up >= B_ENTRY_ODDS ? "DOWN" : null;
            const scr = side && screen ? (side === "UP" ? screen.up : 1 - screen.up) : null;
            const askC = side && live.ticker ? await fetchLiveAskCents(live.ticker, side === "UP" ? "YES" : "NO") : null;
            const px = askC != null ? askC / 100 : null;
            if (side && scr != null && px != null && px >= 0.5 && px <= 0.68) {
              await buy(side, leg1, "entry", `own odds ${(scr * 100).toFixed(1)}% ${side} (${screen!.ageSec}s old) · Kalshi ask ${askC}¢ · speed entry`, false, { px });
            }
          }
          if (strat === "C") {
            const side = quad ?? late;
            if (side && price(side) <= entryMax) await buy(side, leg1, "entry", quad ? `quad: ${quadWhy}` : "late tiebreaker (Study≠Model, odds >55%)");
          }
        } else if (strat === "C" && !pos.locked) {
          const have: Side = Number(pos.up_ct) > 0 ? "UP" : "DOWN";
          const opp: Side = have === "UP" ? "DOWN" : "UP";
          const avg = have === "UP" ? Number(pos.up_cost) / Number(pos.up_ct) : Number(pos.down_cost) / Number(pos.down_ct);
          const pair = avg + price(opp);
          if (pair <= pairMax) {
            // The legacy locked flag marks hedge completion only, preventing another hedge.
            await buy(opp, leg1, "hedge", `equal-dollar hedge ${opp} · $${leg1.toFixed(2)} budget · pair ${(pair * 100).toFixed(0)}¢ · unequal contracts, no guaranteed profit`, true);
          }
        }
      }
    } else if (!fresh) err = "waiting for fresh odds";
  } catch (e) {
    err = String((e as Error)?.message ?? e);
  }

  if (fills.length) {
    const { error } = await sb.from("qc_fills").insert(fills);
    if (error) console.error("qc_fills:", error.message);
  }
  await sb.from("qc_settings").update({ last_tick_at: new Date().toISOString(), last_error: err, last_signals: signals }).eq("id", 1);
  return { ok: true, fills: fills.length, error: err };
}
