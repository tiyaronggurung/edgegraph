// Hedge Desk: paper hedge bot driven ENTIRELY by our own crypto-page data —
// our odds (btc_agreement_log), window volume (btc_composite_flow_log) and our
// composite price. No Kalshi orderbook calls, no real orders, paper money only.
//
// Strategy (from backtesting our odds history): our odds swing enough inside a
// 15-min window that both sides get cheap. Buy the cheap side at ≤ entry_max,
// then buy the opposite side when it also drops to ≤ hedge_max. Combined cost
// under $1 per pair locks a guaranteed profit at settlement. If the second leg
// never fills, the first leg rides to settlement (one-sided risk).
//
// Called every ~10s by pg_cron via /api/public/hooks/hedge-bot-tick.

const WINDOW_MS = 900_000;
const STALE_SEC = 90;
const EQUITY_EVERY_SEC = 30;

const nowS = () => Date.now() / 1000;
const iso = (s: number) => new Date(s * 1000).toISOString();
const r4 = (x: number) => Math.round(x * 1e4) / 1e4;

type Settings = {
  running: boolean;
  cash: number;
  start_cash: number;
  contracts_per_leg: number;
  entry_max: number;
  hedge_max: number;
  skip_final_seconds: number;
  reset_epoch: number;
  last_equity_at: string | null;
};

type WindowRow = {
  window_start: string;
  up_ct: number;
  up_cost: number;
  down_ct: number;
  down_cost: number;
  locked: boolean;
  settled: boolean;
};

async function latestAgreement(sb: any) {
  const { data } = await sb
    .from("btc_agreement_log")
    .select("bucket_sec, odds_p_up, spot, strike, seconds_to_close")
    .not("odds_p_up", "is", null)
    .order("bucket_sec", { ascending: false })
    .limit(1)
    .maybeSingle();
  return data;
}

async function latestFlow(sb: any, windowStartIso: string) {
  const { data } = await sb
    .from("btc_composite_flow_log")
    .select("composite_in_btc, composite_out_btc, composite_imbalance")
    .eq("window_start", windowStartIso)
    .order("recorded_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  return data;
}

export async function runHedgeBotTick() {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const sb = supabaseAdmin as any;

  const { data: settings, error } = await sb.from("hd_settings").select("*").eq("id", 1).single();
  if (error) throw error;
  const s = settings as Settings;
  if (!s.running) return { skipped: "paused" };

  const epoch = settings.reset_epoch;
  let cash = Number(s.cash);
  const startCash = Number(s.start_cash);
  const entryMax = Number(s.entry_max);
  const hedgeMax = Number(s.hedge_max);
  const contracts = Math.max(1, Number(s.contracts_per_leg));
  const skipFinal = Math.max(0, Number(s.skip_final_seconds));

  const nowMs = Date.now();
  const windowStartMs = Math.floor(nowMs / WINDOW_MS) * WINDOW_MS;
  const windowStartIso = new Date(windowStartMs).toISOString();
  const secondsToClose = Math.max(0, Math.round((windowStartMs + WINDOW_MS - nowMs) / 1000));

  let tickError: string | null = null;
  const fills: any[] = [];
  let action: string = "watching";

  try {
    // 1. Settle any older windows that have closed.
    const { data: unsettled } = await sb
      .from("hd_windows")
      .select("*")
      .eq("settled", false)
      .lt("window_start", windowStartIso);
    for (const w of unsettled ?? []) {
      const { data: lastTick } = await sb
        .from("btc_agreement_log")
        .select("spot, strike")
        .eq("window_start", w.window_start)
        .not("spot", "is", null)
        .not("strike", "is", null)
        .order("bucket_sec", { ascending: false })
        .limit(1)
        .maybeSingle();
      if (!lastTick) continue; // no data to settle against yet; try next tick
      const spot = Number(lastTick.spot);
      const strike = Number(lastTick.strike);
      if (spot === strike) continue;
      const result = spot > strike ? "UP" : "DOWN";
      const payout = result === "UP" ? Number(w.up_ct) : Number(w.down_ct);
      const cost = Number(w.up_cost) + Number(w.down_cost);
      const pnl = Math.round((payout - cost) * 100) / 100;
      cash += payout;
      await sb
        .from("hd_windows")
        .update({ settled: true, result, payout, pnl, settled_at: iso(nowS()) })
        .eq("window_start", w.window_start);
      fills.push({
        window_start: w.window_start,
        side: result,
        kind: "settle",
        contracts: result === "UP" ? w.up_ct : w.down_ct,
        price: null,
        amount: payout,
        reason: `window settled ${result} · spot ${spot} vs strike ${strike}`,
        spot,
        strike,
        pnl,
      });
      action = `settled ${result}`;
    }

    // 2. Read our odds.
    const ag = await latestAgreement(sb);
    const pUp = ag ? Number(ag.odds_p_up) : null;
    const fresh =
      ag && pUp != null && Number.isFinite(pUp) && pUp > 0 && pUp < 1 && nowS() - Number(ag.bucket_sec) <= STALE_SEC;

    if (!fresh) {
      tickError = "waiting for our odds";
    } else {
      const spot = ag.spot != null ? Number(ag.spot) : null;
      const strike = ag.strike != null ? Number(ag.strike) : null;
      const flow = await latestFlow(sb, windowStartIso);
      const flowNote = flow
        ? ` · vol in ${Number(flow.composite_in_btc).toFixed(2)} / out ${Number(flow.composite_out_btc).toFixed(2)} BTC`
        : "";

      // 3. Current window state.
      let { data: win } = await sb
        .from("hd_windows")
        .select("*")
        .eq("window_start", windowStartIso)
        .maybeSingle();
      if (!win) {
        const { data: created } = await sb
          .from("hd_windows")
          .insert({ window_start: windowStartIso })
          .select("*")
          .single();
        win = created;
      }
      const w = win as WindowRow;

      if (secondsToClose <= skipFinal) {
        action = "final minute — no new buys";
      } else if (w.up_ct === 0 && w.down_ct === 0) {
        // Entry: whichever side our odds price cheap.
        if (pUp! <= entryMax) {
          const price = pUp!;
          const cost = contracts * price;
          if (cost <= cash) {
            cash -= cost;
            await sb
              .from("hd_windows")
              .update({ up_ct: contracts, up_cost: cost })
              .eq("window_start", windowStartIso);
            fills.push({
              window_start: windowStartIso, side: "UP", kind: "entry", contracts, price, amount: cost,
              reason: `entry UP @ ${(price * 100).toFixed(0)}¢ · our ${(pUp! * 100).toFixed(0)}% up${flowNote}`,
              our_p_up: pUp, spot, strike,
            });
            action = "bought UP entry";
          }
        } else if (pUp! >= 1 - entryMax) {
          const price = 1 - pUp!;
          const cost = contracts * price;
          if (cost <= cash) {
            cash -= cost;
            await sb
              .from("hd_windows")
              .update({ down_ct: contracts, down_cost: cost })
              .eq("window_start", windowStartIso);
            fills.push({
              window_start: windowStartIso, side: "DOWN", kind: "entry", contracts, price, amount: cost,
              reason: `entry DOWN @ ${(price * 100).toFixed(0)}¢ · our ${(pUp! * 100).toFixed(0)}% up${flowNote}`,
              our_p_up: pUp, spot, strike,
            });
            action = "bought DOWN entry";
          }
        }
      } else if (!w.locked) {
        // Hedge: opposite side also cheap.
        if (w.up_ct > 0 && w.down_ct === 0 && pUp! >= 1 - hedgeMax) {
          const price = 1 - pUp!;
          const cost = contracts * price;
          if (cost <= cash) {
            cash -= cost;
            const combined = Number(w.up_cost) + cost;
            const lockedProfit = contracts - combined;
            await sb
              .from("hd_windows")
              .update({ down_ct: contracts, down_cost: cost, locked: true })
              .eq("window_start", windowStartIso);
            fills.push({
              window_start: windowStartIso, side: "DOWN", kind: "hedge", contracts, price, amount: cost,
              reason: `hedge DOWN @ ${(price * 100).toFixed(0)}¢ · pair ${(combined * 100).toFixed(0)}¢ locks +${(lockedProfit * 100).toFixed(0)}¢${flowNote}`,
              our_p_up: pUp, spot, strike,
            });
            action = "hedged DOWN — pair locked";
          }
        } else if (w.down_ct > 0 && w.up_ct === 0 && pUp! <= hedgeMax) {
          const price = pUp!;
          const cost = contracts * price;
          if (cost <= cash) {
            cash -= cost;
            const combined = Number(w.down_cost) + cost;
            const lockedProfit = contracts - combined;
            await sb
              .from("hd_windows")
              .update({ up_ct: contracts, up_cost: cost, locked: true })
              .eq("window_start", windowStartIso);
            fills.push({
              window_start: windowStartIso, side: "UP", kind: "hedge", contracts, price, amount: cost,
              reason: `hedge UP @ ${(price * 100).toFixed(0)}¢ · pair ${(combined * 100).toFixed(0)}¢ locks +${(lockedProfit * 100).toFixed(0)}¢${flowNote}`,
              our_p_up: pUp, spot, strike,
            });
            action = "hedged UP — pair locked";
          }
        }
      }
    }
  } catch (e) {
    tickError = String((e as Error)?.message ?? e);
  }

  // 4. Persist fills, equity, settings.
  if (fills.length) {
    const { error: e } = await sb.from("hd_fills").insert(fills);
    if (e) console.error("hd_fills insert:", e.message);
  }

  // Open value: current window legs marked at our latest odds.
  const { data: openWins } = await sb.from("hd_windows").select("*").eq("settled", false);
  const ag2 = await latestAgreement(sb);
  const mark = ag2 ? Number(ag2.odds_p_up) : null;
  let openValue = 0;
  for (const w of openWins ?? []) {
    if (mark != null && Number.isFinite(mark)) {
      openValue += Number(w.up_ct) * mark + Number(w.down_ct) * (1 - mark);
    }
  }

  const t = nowS();
  const patch: Record<string, unknown> = {
    cash: r4(cash),
    last_tick_at: iso(t),
    last_error: tickError,
  };
  const lastEq = s.last_equity_at ? Date.parse(s.last_equity_at) / 1000 : 0;
  if (t - lastEq >= EQUITY_EVERY_SEC) {
    patch.last_equity_at = iso(t);
    const equity = cash + openValue;
    await sb.from("hd_equity").insert({ ts: iso(t), equity, pnl: equity - startCash, cash, open_value: openValue });
  }
  await sb.from("hd_settings").update(patch).eq("id", 1).eq("reset_epoch", epoch);

  return { ok: true, action, error: tickError, cash };
}
