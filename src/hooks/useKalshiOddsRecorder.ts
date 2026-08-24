// Records per-second snapshots of Kalshi BTC 15m odds + our own computed
// odds into btc_kalshi_odds_snapshots. Runs while mounted; batches inserts.
import { useEffect, useRef } from "react";
import { useQuery, keepPreviousData } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { getKalshiImpliedSpot } from "@/lib/kalshiImpliedSpot.functions";
import { getBtcSpotVolume } from "@/lib/btcSpotVolume.functions";
import { insertKalshiOddsSnapshotBatch } from "@/lib/kalshiOddsSnapshots.functions";
import { useLiveCompositeSpot } from "@/hooks/useLiveCompositeSpot";
import {
  computeOurQuote,
  ewmaVolFromTape,
  momentumTilt,
  realizedVolFromCloses,
  type TapeSample,
} from "@/lib/ourOdds";

const TAPE_MAX = 240;
const TAPE_MIN_DT_MS = 250;
const FLUSH_EVERY_MS = 5_000;
const MAX_BATCH = 30;

interface QueuedRow {
  ticker: string;
  strike: number;
  snap_bucket_sec: number;
  seconds_to_close: number | null;
  kalshi_yes_bid: number | null;
  kalshi_yes_ask: number | null;
  kalshi_yes_mid: number | null;
  kalshi_implied_spot: number | null;
  spot_composite: number | null;
  our_mid: number | null;
  our_up_ask: number | null;
  our_down_ask: number | null;
  our_sigma: number | null;
  our_tilt: number | null;
  delta_up: number | null;
  kalshi_volume: number | null;
  kalshi_open_interest: number | null;
  kalshi_last_price_cents: number | null;
  kalshi_yes_vol_60s: number | null;
  kalshi_no_vol_60s: number | null;
  kalshi_trade_count_60s: number | null;
  spot_buy_vol_1m: number | null;
  spot_sell_vol_1m: number | null;
  spot_vol_imb_1m: number | null;
  spot_buy_vol_win: number | null;
  spot_sell_vol_win: number | null;
  spot_vol_imb_win: number | null;
}


/**
 * Continuously logs Kalshi BTC 15m odds vs our computed odds, 1 sample/sec.
 * @param closes1m Optional 1m closes for σ fallback while tape is cold.
 */
export function useKalshiOddsRecorder(closes1m: number[] = [], enabled = true): void {
  const kalshiFn = useServerFn(getKalshiImpliedSpot);
  const spotVolFn = useServerFn(getBtcSpotVolume);
  const insertFn = useServerFn(insertKalshiOddsSnapshotBatch);
  const live = useLiveCompositeSpot();

  // Share the SAME query key as the trendline panel so both consumers dedupe
  // onto one 1s Kalshi poll. Two independent paginated pulls per second was
  // tripping Kalshi rate limits, which blanked the flow/cost strip and odds.
  const { data: kalshi } = useQuery({
    queryKey: ["kalshi-implied-spot"],
    queryFn: () => kalshiFn(),
    enabled,
    refetchInterval: 1_000,
    staleTime: 500,
    placeholderData: keepPreviousData,
    refetchOnWindowFocus: false,
    refetchIntervalInBackground: false,
  });

  // Binance taker buy/sell split — 10s poll is plenty (1m candle granularity).
  const { data: spotVol } = useQuery({
    queryKey: ["btc-spot-volume-recorder"],
    queryFn: () => spotVolFn(),
    enabled,
    refetchInterval: 10_000,
    staleTime: 5_000,
    placeholderData: keepPreviousData,
    refetchOnWindowFocus: false,
    refetchIntervalInBackground: false,
  });

  const tapeRef = useRef<TapeSample[]>([]);
  const queueRef = useRef<QueuedRow[]>([]);
  const seenRef = useRef<Set<string>>(new Set());
  const closes1mRef = useRef<number[]>(closes1m);
  closes1mRef.current = closes1m;
  const kalshiRef = useRef(kalshi);
  kalshiRef.current = kalshi;
  const spotVolRef = useRef(spotVol);
  spotVolRef.current = spotVol;
  const spotRef = useRef<number | null>(live.spot);
  spotRef.current = live.spot;

  // Feed live tape.
  useEffect(() => {
    const spot = live.spot;
    if (spot == null || !Number.isFinite(spot) || !(spot > 0)) return;
    const now = Date.now();
    const tape = tapeRef.current;
    const last = tape[tape.length - 1];
    if (last && now - last.t < TAPE_MIN_DT_MS) return;
    tape.push({ t: now, p: spot });
    if (tape.length > TAPE_MAX) tape.splice(0, tape.length - TAPE_MAX);
  }, [live.spot]);

  // Sample every second — bucket by (ticker, wall-second) so overlapping
  // browser tabs still produce exactly one row per second.
  const enabledRef = useRef(enabled);
  enabledRef.current = enabled;

  useEffect(() => {
    const id = setInterval(() => {
      if (!enabledRef.current) return;
      const k = kalshiRef.current;
      if (!k?.ok || !k.ticker || k.strike == null || k.secondsToClose == null) return;
      const bucket = Math.floor(Date.now() / 1000);
      const dedupKey = `${k.ticker}:${bucket}`;
      if (seenRef.current.has(dedupKey)) return;

      const spot = spotRef.current ?? k.impliedSpot ?? null;
      const sv = spotVolRef.current;
      const tape = tapeRef.current;
      const sigma =
        ewmaVolFromTape(tape) ??
        realizedVolFromCloses(closes1mRef.current.slice(-30));
      const tilt = momentumTilt(tape);

      let ourMid: number | null = null;
      let ourUpAsk: number | null = null;
      let ourDownAsk: number | null = null;
      if (spot != null && sigma != null) {
        const q = computeOurQuote({
          spot,
          strike: k.strike,
          secondsToClose: k.secondsToClose,
          sigmaAnnualized: sigma,
          momentumTiltPct: tilt,
        });
        if (q) {
          ourMid = q.mid;
          ourUpAsk = q.pUpAsk;
          ourDownAsk = q.pDownAsk;
        }
      }

      seenRef.current.add(dedupKey);
      // Keep dedup set small.
      if (seenRef.current.size > 900) {
        const arr = Array.from(seenRef.current).slice(-600);
        seenRef.current = new Set(arr);
      }

      queueRef.current.push({
        ticker: k.ticker,
        strike: k.strike,
        snap_bucket_sec: bucket,
        seconds_to_close: k.secondsToClose,
        kalshi_yes_bid: k.yesBid,
        kalshi_yes_ask: k.yesAsk,
        kalshi_yes_mid: k.yesMid,
        kalshi_implied_spot: k.impliedSpot,
        spot_composite: spot,
        our_mid: ourMid,
        our_up_ask: ourUpAsk,
        our_down_ask: ourDownAsk,
        our_sigma: sigma,
        our_tilt: tilt || null,
        delta_up: ourMid != null && k.yesMid != null ? ourMid - k.yesMid : null,
        kalshi_volume: k.volume ?? null,
        kalshi_open_interest: k.openInterest ?? null,
        kalshi_last_price_cents: k.lastPriceCents ?? null,
        kalshi_yes_vol_60s: k.yesVol60s ?? null,
        kalshi_no_vol_60s: k.noVol60s ?? null,
        kalshi_trade_count_60s: k.tradeCount60s ?? null,
        spot_buy_vol_1m: sv?.m1?.buy ?? null,
        spot_sell_vol_1m: sv?.m1?.sell ?? null,
        spot_vol_imb_1m: sv?.m1?.imbalance ?? null,
        spot_buy_vol_win: sv?.window?.buy ?? null,
        spot_sell_vol_win: sv?.window?.sell ?? null,
        spot_vol_imb_win: sv?.window?.imbalance ?? null,
      });

    }, 1_000);
    return () => clearInterval(id);
  }, []);

  // Flush queue every 5s.
  useEffect(() => {
    let cancelled = false;
    const flush = async () => {
      if (cancelled) return;
      if (!enabledRef.current) return;
      const q = queueRef.current;
      if (q.length === 0) return;
      const batch = q.splice(0, MAX_BATCH);
      try {
        await insertFn({ data: { rows: batch } });
      } catch {
        // Drop batch on failure — recorder is best-effort.
      }
    };
    const id = setInterval(flush, FLUSH_EVERY_MS);
    return () => { cancelled = true; clearInterval(id); };
  }, [insertFn]);
}
