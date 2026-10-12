// Paper Desk: two-sided Kalshi PAPER bot (port of Claude's kit edge function).
// PAPER ONLY — reads Kalshi public data, never places orders, needs no Kalshi keys.
// Fully isolated: writes only pb_* tables. Called every ~10s by pg_cron; each call
// polls up to RUN_SECONDS at POLL interval, guarded by a DB lock.
import {
  type Book,
  type Position,
  type StrategyConfig,
  avg,
  coinFor,
  decide,
  DEFAULT_CONFIG,
  kalshiTakerFee,
  pairCost,
} from "./strategy";
import {
  type TapeSample,
  computeUpProbability,
  effectiveVol,
  momentumTilt,
} from "@/lib/ourOdds";

const KALSHI = "https://api.elections.kalshi.com";
const RUN_SECONDS = 8;
const LOCK_SECONDS = 12;
const EQUITY_EVERY = 10;

type MarketRow = {
  ticker: string; event_ticker: string; title: string; coin: string; strike: number | null;
  open_ts: string; close_ts: string; yes_ct: number; yes_cost: number; no_ct: number; no_cost: number;
  fees: number; fills: number; last_buy_ts: string | null; yes_bid: number | null; no_bid: number | null;
  index_price: number | null; index_ts: string | null; settled: boolean; result: string | null;
  payout: number; pnl: number | null; settled_at: string | null;
};

const sec = (s: string | null) => (s ? Date.parse(s) / 1000 : 0);
const iso = (s: number) => new Date(s * 1000).toISOString();
const nowS = () => Date.now() / 1000;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const r4 = (x: number | null) => (x === null ? null : Math.round(x * 1e4) / 1e4);

async function kget(path: string, params: Record<string, string | number> = {}): Promise<any> {
  const url = new URL(KALSHI + path);
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, String(v));
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const r = await fetch(url, { headers: { accept: "application/json" }, signal: AbortSignal.timeout(4000) });
      if (r.status === 429) { await sleep(700 * (attempt + 1)); continue; }
      if (!r.ok) throw new Error(`${r.status} ${path}`);
      return await r.json();
    } catch (e) {
      if (attempt === 2) throw e;
      await sleep(300 * (attempt + 1));
    }
  }
  throw new Error(`rate limited ${path}`);
}

const openMarkets = async (series: string) =>
  ((await kget("/trade-api/v2/markets", { series_ticker: series, status: "open", limit: 50 })).markets ?? []) as any[];
const marketInfo = async (ticker: string) => (await kget(`/trade-api/v2/markets/${ticker}`)).market ?? {};

async function indexPrice(eventTicker: string, coin: string): Promise<[number, number] | null> {
  try {
    const j = await kget(`/v1/live_data/events/${eventTicker}`, { last_sec: 5 });
    const ts = j?.live_data?.details?.timeseries ?? [];
    if (ts.length) return [Number(ts[ts.length - 1].v), ts[ts.length - 1].t / 1000];
  } catch { /* fall through */ }
  if (!coin) return null;
  try {
    const r = await fetch(`https://kalshi-public-docs.s3.amazonaws.com/external/crypto/${coin}_current.json`, {
      signal: AbortSignal.timeout(4000),
    });
    if (r.ok) {
      const j = await r.json();
      const s = j?.timeseries?.second ?? [];
      if (s.length) return [Number(s[s.length - 1]), Date.now() / 1000];
    }
  } catch { /* ignore */ }
  return null;
}

// Live tape from the server-written spot ticks — the same source and the same
// math the crypto page uses, so the bot sees the same odds with no extra lag.
async function loadSpotTape(sb: any): Promise<TapeSample[]> {
  const { data } = await sb.from("btc_spot_ticks")
    .select("observed_at, spot, source")
    .gte("observed_at", new Date(Date.now() - 5 * 60_000).toISOString())
    .in("source", ["coinbase", "consolidated"])
    .order("observed_at", { ascending: true })
    .limit(2000);
  const rows = (data ?? []) as Array<{ observed_at: string; spot: number | string; source: string }>;
  const preferred = rows.filter((r) => r.source === "coinbase");
  const pool = preferred.length >= 10 ? preferred : rows;
  const tape: TapeSample[] = [];
  for (const r of pool) {
    const t = Date.parse(r.observed_at);
    const p = Number(r.spot);
    if (Number.isFinite(t) && Number.isFinite(p) && p > 0) tape.push({ t, p });
  }
  tape.sort((a, b) => a.t - b.t);
  return tape;
}

// Identical formula to the crypto page: fair value + momentum tilt, clamped.
function pUpFromTape(tape: TapeSample[], strike: number | null, secsToClose: number): number | null {
  if (tape.length < 10 || !(strike != null && strike > 0)) return null;
  const last = tape[tape.length - 1];
  if (Date.now() - last.t > 30_000) return null; // feed stalled — don't trade stale odds
  const sigma = effectiveVol(tape, [], secsToClose) ?? 0.5;
  const base = computeUpProbability({ spot: last.p, strike, secondsToClose: secsToClose, sigmaAnnualized: sigma });
  if (base == null) return null;
  return Math.min(0.995, Math.max(0.005, base + momentumTilt(tape, 60_000, secsToClose)));
}

// Fallback: last odds row from the agreement log (used only if the tape is empty).
async function loadOurPUp(sb: any): Promise<number | null> {
  const { data } = await sb.from("btc_agreement_log")
    .select("bucket_sec, odds_p_up").not("odds_p_up", "is", null)
    .order("bucket_sec", { ascending: false }).limit(1).maybeSingle();
  if (!data) return null;
  if (nowS() - Number(data.bucket_sec) > 90) return null; // stale
  const p = Number(data.odds_p_up);
  return Number.isFinite(p) && p > 0 && p < 1 ? p : null;
}

export async function runPaperBotTick() {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const sb = supabaseAdmin as any;
  const { data: gotLock, error: lockErr } = await sb.rpc("paper_bot_acquire_lock", { seconds: LOCK_SECONDS });
  if (lockErr) throw lockErr;
  if (!gotLock) return { skipped: "another run is active" };

  try {
    const { data: settings, error } = await sb.from("pb_settings").select("*").eq("id", 1).single();
    if (error) throw error;
    if (!settings.running) return { skipped: "paused" };

    const epoch = settings.reset_epoch;
    let cash = Number(settings.cash);
    const startCash = Number(settings.start_cash);
    const feeRate = Number(settings.taker_fee_rate);
    const pollMs = 1000; // poll every second — same cadence as the crypto page
    let cfg: StrategyConfig = { ...DEFAULT_CONFIG, ...(settings.strategy ?? {}) };
    let series: string[] = settings.series?.length ? settings.series : ["KXBTC15M"];

    // LIVE mode: real Kalshi orders, real money. Guards: daily loss stop,
    // one buy per window (shared with every other engine), no final-minute
    // buys, and a hard cap on total open real exposure (default $10).
    const liveMode = Boolean(settings.live_enabled) && !!settings.live_user_id;
    const liveUserId = (settings.live_user_id as string | null) ?? null;
    const liveMaxOpenCents = Math.max(100, Number(settings.live_max_open_cents) || 1000);
    const liveCfg = (c: StrategyConfig): StrategyConfig =>
      liveMode ? { ...c, no_new_buys_last_seconds: Math.max(60, c.no_new_buys_last_seconds) } : c;
    cfg = liveCfg(cfg);

    const { data: openRows, error: rowsErr } = await sb.from("pb_markets").select("*").eq("settled", false);
    if (rowsErr) throw rowsErr;
    const markets = new Map<string, MarketRow>();
    for (const r of openRows ?? []) {
      for (const k of ["strike", "yes_ct", "yes_cost", "no_ct", "no_cost", "fees", "yes_bid", "no_bid", "index_price", "payout"]) {
        r[k] = r[k] === null ? null : Number(r[k]);
      }
      markets.set(r.ticker, r as MarketRow);
    }

    let lastEquity = sec(settings.last_equity_at);
    let fillsThisRun = 0, settledThisRun = 0;
    const deadline = Date.now() + RUN_SECONDS * 1000;

    while (Date.now() < deadline) {
      const loopStart = Date.now();
      let tickError: string | null = null;
      const fillRows: any[] = [];
      const dirty = new Set<string>();
      const indexUpdates = new Map<string, { coin: string; price: number; ts: string }>();

      const { data: s2 } = await sb.from("pb_settings")
        .select("running, reset_epoch, strategy, series").eq("id", 1).single();
      if (!s2 || !s2.running || s2.reset_epoch !== epoch) break;
      cfg = liveCfg({ ...DEFAULT_CONFIG, ...(s2.strategy ?? {}) });
      series = s2.series?.length ? s2.series : series;

      try {
        const open = (await Promise.all(series.map(openMarkets))).flat();
        const idxCache = new Map<string, [number, number] | null>();
        // Our odds (crypto page: price + volume) drive BOTH the decision and the
        // fill price. Computed live from the spot tape every poll — same math as
        // the crypto page, no waiting for logged rows. No Kalshi orderbook calls.
        const tape = await loadSpotTape(sb);
        const fallbackPUp = tape.length >= 10 ? null : await loadOurPUp(sb);

        // Live guards, refreshed every loop: daily loss stop, total open real
        // exposure, and every ticker any engine already bought this window.
        let liveOpenCents = 0;
        let liveLossStop = false;
        // Windows another engine already bought (shared one-buy guard). Paper
        // Desk's OWN windows are excluded so the live bot can still buy the
        // opposite hedge leg in a window it opened itself.
        const liveWindowBought = new Set<string>();
        // Paper Desk's own open live trades, for the take-profit check below.
        const liveOpenTrades: any[] = [];
        if (liveMode && liveUserId) {
          const { getDailyLossCounts, dailyLossStopHit } = await import("@/lib/dailyLossGuard.server");
          liveLossStop = dailyLossStopHit(await getDailyLossCounts(sb as never), liveUserId);
          const { data: openLive } = await sb.from("crypto_trades")
            .select("id, ticker, side, contracts, stake_usd, inputs_snapshot")
            .in("status", ["submitted", "pending"])
            .gt("close_time", iso(nowS()));
          for (const r of openLive ?? []) {
            if ((r.inputs_snapshot as any)?.source === "paper_desk_live") {
              liveOpenCents += Math.round(Number(r.stake_usd ?? 0) * 100);
              liveOpenTrades.push(r);
            } else {
              liveWindowBought.add(String(r.ticker));
            }
          }
        }

        for (const m of open) {
          const ticker: string = m.ticker;
          let row = markets.get(ticker);
          if (!row) {
            row = {
              ticker, event_ticker: m.event_ticker ?? ticker.split("-").slice(0, -1).join("-"),
              title: [m.title, m.yes_sub_title].filter(Boolean).join(" · "), coin: coinFor(ticker),
              strike: m.floor_strike ?? null, open_ts: m.open_time, close_ts: m.close_time,
              yes_ct: 0, yes_cost: 0, no_ct: 0, no_cost: 0, fees: 0, fills: 0, last_buy_ts: null,
              yes_bid: null, no_bid: null, index_price: null, index_ts: null,
              settled: false, result: null, payout: 0, pnl: null, settled_at: null,
            };
            markets.set(ticker, row);
          }
          if (row.strike === null && m.floor_strike != null) row.strike = Number(m.floor_strike);
          const openTs = sec(row.open_ts), closeTs = sec(row.close_ts);
          if (nowS() >= closeTs) continue;

          if (!idxCache.has(row.event_ticker)) idxCache.set(row.event_ticker, await indexPrice(row.event_ticker, row.coin));
          const idx = idxCache.get(row.event_ticker);
          if (idx) {
            row.index_price = idx[0];
            row.index_ts = iso(idx[1]);
            const key = row.coin || row.event_ticker;
            indexUpdates.set(key, { coin: key, price: idx[0], ts: iso(idx[1]) });
          }

          if (row.coin !== "btc") continue;
          const secsToClose = Math.max(0, closeTs - nowS());
          const ourPUp = pUpFromTape(tape, row.strike, secsToClose) ?? fallbackPUp;
          if (ourPUp === null) { tickError = "waiting for our odds"; continue; }
          const book: Book = {
            yes_bid: r4(ourPUp), yes_ask: r4(ourPUp), yes_ask_size: 1e6,
            no_bid: r4(1 - ourPUp), no_ask: r4(1 - ourPUp), no_ask_size: 1e6,
          };
          row.yes_bid = book.yes_bid;
          row.no_bid = book.no_bid;
          if (row.fills > 0) dirty.add(ticker);

          // ---- LIVE take-profit: bid ≥ 1.5× entry → sell 90%, let 10% ride ----
          if (liveMode && liveUserId) {
            for (const tr of liveOpenTrades) {
              if (String(tr.ticker) !== ticker) continue;
              const ct = Number(tr.contracts ?? 0);
              if (ct < 2) continue;
              const entryCents = Math.round((Number(tr.stake_usd) / ct) * 100);
              if (entryCents <= 0) continue;
              const bidCents = Math.round((tr.side === "YES" ? ourPUp : 1 - ourPUp) * 100);
              if (bidCents < entryCents * 1.5) continue;
              const sellN = Math.floor(ct * 0.9);
              if (sellN < 1) continue;
              try {
                const { sellKalshiContracts } = await import("@/lib/cryptoTrades.functions");
                const tp = await sellKalshiContracts(sb, liveUserId, {
                  tradeId: String(tr.id),
                  contracts: sellN,
                  limitPriceCents: Math.max(1, Math.min(99, bidCents)),
                });
                if (tp.ok) {
                  tr.contracts = ct - sellN;
                  tr.stake_usd = ((ct - sellN) * entryCents) / 100;
                  liveOpenCents -= sellN * entryCents;
                  fillsThisRun++;
                  fillRows.push({
                    ticker,
                    side: tr.side === "YES" ? "yes" : "no",
                    contracts: sellN,
                    price: bidCents / 100,
                    fee: 0,
                    reason: `LIVE take-profit +50% · sold ${sellN}/${ct} @ ${bidCents}¢ (entry ${entryCents}¢)`,
                    ts: iso(nowS()),
                  });
                } else {
                  tickError = `take-profit error: ${String(tp.error).slice(0, 100)}`;
                }
              } catch (e) {
                tickError = `take-profit error: ${String((e as Error)?.message ?? e).slice(0, 100)}`;
              }
            }
          }

          const pos: Position = {
            yes: { contracts: row.yes_ct, cost: row.yes_cost },
            no: { contracts: row.no_ct, cost: row.no_cost },
            last_buy_ts: sec(row.last_buy_ts),
          };
          const t = nowS();
          const dOurs = decide(cfg, pos, book, t, openTs, closeTs);
          if (!dOurs) continue;
          const d = {
            ...dOurs,
            reason: `${dOurs.reason} · our ${(ourPUp * 100).toFixed(0)}% up`,
          };
          // ---- LIVE (real money) path ----
          if (liveMode && liveUserId) {
            if (liveLossStop) { tickError = "daily give-back stop (losses ≥ 50% of today's gains)"; continue; }
            if (liveWindowBought.has(ticker)) continue; // one buy per window, shared across engines
            const limitCents = Math.max(1, Math.min(99, Math.round(d.price * 100)));
            const remaining = liveMaxOpenCents - liveOpenCents;
            const n = Math.min(d.contracts, Math.floor(remaining / limitCents));
            if (n <= 0) { tickError = `live cap reached ($${(liveMaxOpenCents / 100).toFixed(0)} open)`; continue; }
            try {
              const { submitKalshiBuy } = await import("@/lib/cryptoTrades.functions");
              const r = await submitKalshiBuy(sb, liveUserId, {
                ticker,
                side: d.side === "yes" ? "YES" : "NO",
                contracts: n,
                limitPriceCents: limitCents,
                strike: row.strike ?? undefined,
                closeTime: row.close_ts,
                stakeUsd: (n * limitCents) / 100,
                inputsSnapshot: {
                  source: "paper_desk_live",
                  reason: d.reason,
                  our_p_up: ourPUp,
                  seconds_to_close: Math.round(closeTs - t),
                },
              } as never);
              if (r.fillCount <= 0) { tickError = "live order unfilled"; continue; }
              const realPrice = r.filledCents / 100;
              const fee = kalshiTakerFee(n, realPrice, feeRate);
              const cost = n * realPrice + fee;
              cash -= cost;
              if (d.side === "yes") { row.yes_ct += n; row.yes_cost += n * realPrice; }
              else { row.no_ct += n; row.no_cost += n * realPrice; }
              row.fees += fee;
              row.fills += 1;
              row.last_buy_ts = iso(t);
              dirty.add(ticker);
              fillsThisRun++;
              // Do NOT lock the window here — the live bot may still buy the
              // opposite hedge leg in its own window (cap + pair-cost rule gate it).
              liveOpenCents += n * r.filledCents;
              const p2: Position = { yes: { contracts: row.yes_ct, cost: row.yes_cost }, no: { contracts: row.no_ct, cost: row.no_cost }, last_buy_ts: t };
              const gap = row.index_price !== null && row.strike !== null ? row.index_price - row.strike : null;
              fillRows.push({
                ts: iso(t), ticker, title: row.title, side: d.side, contracts: n, price: realPrice, fee,
                reason: `LIVE ${d.reason} · filled ${r.fillCount} @ ${r.filledCents}¢`,
                yes_ct: row.yes_ct, yes_avg: r4(avg(p2.yes)), no_ct: row.no_ct, no_avg: r4(avg(p2.no)),
                pair_cost: r4(pairCost(p2)), index_price: row.index_price, strike: row.strike,
                gap: gap === null ? null : Math.round(gap * 100) / 100,
              });
            } catch (e) {
              tickError = `live error: ${String((e as Error)?.message ?? e).slice(0, 120)}`;
            }
            continue;
          }

          const fee = kalshiTakerFee(d.contracts, d.price, feeRate);
          const cost = d.contracts * d.price + fee;
          if (cost > cash) continue;

          cash -= cost;
          if (d.side === "yes") { row.yes_ct += d.contracts; row.yes_cost += d.contracts * d.price; }
          else { row.no_ct += d.contracts; row.no_cost += d.contracts * d.price; }
          row.fees += fee;
          row.fills += 1;
          row.last_buy_ts = iso(t);
          dirty.add(ticker);
          fillsThisRun++;
          const p2: Position = { yes: { contracts: row.yes_ct, cost: row.yes_cost }, no: { contracts: row.no_ct, cost: row.no_cost }, last_buy_ts: t };
          const gap = row.index_price !== null && row.strike !== null ? row.index_price - row.strike : null;
          fillRows.push({
            ts: iso(t), ticker, title: row.title, side: d.side, contracts: d.contracts, price: d.price, fee,
            reason: d.reason, yes_ct: row.yes_ct, yes_avg: r4(avg(p2.yes)), no_ct: row.no_ct, no_avg: r4(avg(p2.no)),
            pair_cost: r4(pairCost(p2)), index_price: row.index_price, strike: row.strike,
            gap: gap === null ? null : Math.round(gap * 100) / 100,
          });
        }

        for (const row of [...markets.values()]) {
          if (row.settled || nowS() < sec(row.close_ts)) continue;
          if (row.fills === 0) { markets.delete(row.ticker); continue; }
          const info = await marketInfo(row.ticker);
          const result = String(info.result ?? "").toLowerCase();
          if (result !== "yes" && result !== "no") continue;
          const payout = result === "yes" ? row.yes_ct : row.no_ct;
          cash += payout;
          row.settled = true;
          row.result = result;
          row.payout = payout;
          row.pnl = Math.round((payout - (row.yes_cost + row.no_cost + row.fees)) * 100) / 100;
          row.settled_at = iso(nowS());
          dirty.add(row.ticker);
          settledThisRun++;
        }
      } catch (e) {
        tickError = String((e as Error)?.message ?? e);
      }

      let openValue = 0;
      for (const r of markets.values()) {
        if (!r.settled && r.fills > 0) openValue += r.yes_ct * (r.yes_bid ?? 0) + r.no_ct * (r.no_bid ?? 0);
      }
      if (fillRows.length) {
        const { error: e } = await sb.from("pb_fills").insert(fillRows);
        if (e) console.error("pb_fills insert:", e.message);
      }
      const toUpsert = [...dirty].map((t) => markets.get(t)).filter((r): r is MarketRow => !!r && r.fills > 0);
      if (toUpsert.length) {
        const { error: e } = await sb.from("pb_markets").upsert(toUpsert, { onConflict: "ticker" });
        if (e) console.error("pb_markets upsert:", e.message);
      }
      for (const r of toUpsert) if (r.settled) markets.delete(r.ticker);
      if (indexUpdates.size) await sb.from("pb_index_prices").upsert([...indexUpdates.values()], { onConflict: "coin" });

      const t = nowS();
      const patch: Record<string, unknown> = {
        cash: Math.round(cash * 1e4) / 1e4, open_value: Math.round(openValue * 1e4) / 1e4,
        last_tick_at: iso(t), last_error: tickError,
      };
      if (t - lastEquity >= EQUITY_EVERY) {
        lastEquity = t;
        patch.last_equity_at = iso(t);
        const equity = cash + openValue;
        await sb.from("pb_equity").insert({ ts: iso(t), equity, pnl: equity - startCash, cash, open_value: openValue });
      }
      await sb.from("pb_settings").update(patch).eq("id", 1).eq("reset_epoch", epoch);

      const wait = pollMs - (Date.now() - loopStart);
      if (Date.now() + wait < deadline) await sleep(Math.max(0, wait));
      else break;
    }
    return { ok: true, fills: fillsThisRun, settled: settledThisRun, cash };
  } finally {
    await sb.rpc("paper_bot_release_lock");
  }
}
