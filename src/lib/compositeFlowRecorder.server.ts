// Records the composite (Binance + Coinbase) in/out volume and average prices
// for the current 15m window, once per tick, into btc_composite_flow_log.
//
// Read-only with respect to every existing engine: it only writes its own
// table. The verdict stored on each row is what the verdict bet engine reads,
// so the log and the bets can never drift apart.

import { loadBtcSpotVolume } from "@/lib/btcSpotVolume.functions";
import { loadKalshiCurrentStrike } from "@/lib/kalshiCurrentStrike.functions";
import { getBtcMultiVenueVolume } from "@/lib/btcMultiVenueVolume.functions";
import { binanceFetch } from "@/lib/binanceFetch";
import { computeVerdict } from "@/lib/btcVerdict";

async function fetchSpot(): Promise<number | null> {
  try {
    const r = await binanceFetch("/api/v3/ticker/price?symbol=BTCUSDT", {
      headers: { accept: "application/json" },
    });
    if (!r.ok) return null;
    const j = (await r.json()) as { price?: string };
    const p = Number(j.price);
    return Number.isFinite(p) ? p : null;
  } catch {
    return null;
  }
}

export interface CompositeFlowSnapshot {
  windowStart: number;
  secondsToClose: number;
  spot: number | null;
  strike: number | null;
  compositeIn: number | null;
  compositeOut: number | null;
  compositeAvgIn: number | null;
  compositeAvgOut: number | null;
  verdict: "UP" | "DOWN" | null;
}

export async function recordCompositeFlow(): Promise<CompositeFlowSnapshot & { written: boolean }> {
  const now = Date.now();
  const windowStart = Math.floor(now / 900_000) * 900_000;
  const secondsToClose = Math.max(0, Math.round((windowStart + 900_000 - now) / 1000));

  let [vol, multi, strikeRes, spotPrice] = await Promise.all([
    loadBtcSpotVolume().catch(() => null),
    getBtcMultiVenueVolume().catch(() => null),
    loadKalshiCurrentStrike().catch(() => null),
    fetchSpot(),
  ]);

  // The Binance leg used to fail silently and still write a row, which made
  // the stored "composite" Coinbase-only. Retry once, then skip the row
  // rather than recording a half-composite as if it were whole.
  if (vol?.windowStart !== windowStart || !vol?.window) {
    vol = await loadBtcSpotVolume().catch(() => null);
  }

  const binWin = vol?.windowStart === windowStart ? (vol?.window ?? null) : null;
  const cb = multi?.windowStart === windowStart ? (multi?.coinbaseFlow ?? null) : null;

  const binIn = binWin?.buy ?? null;
  const binOut = binWin?.sell ?? null;
  const binAvgIn = binWin?.avgBuyPrice ?? null;
  const binAvgOut = binWin?.avgSellPrice ?? null;

  const cbIn = cb?.inBtc ?? null;
  const cbOut = cb?.outBtc ?? null;
  const cbAvgIn = cb?.avgIn ?? null;
  const cbAvgOut = cb?.avgOut ?? null;

  const sum = (a: number | null, b: number | null) =>
    a == null && b == null ? null : (a ?? 0) + (b ?? 0);
  const vwap = (
    aQty: number | null,
    aPx: number | null,
    bQty: number | null,
    bPx: number | null,
  ): number | null => {
    let q = 0,
      n = 0;
    if (aQty != null && aPx != null) {
      q += aQty;
      n += aQty * aPx;
    }
    if (bQty != null && bPx != null) {
      q += bQty;
      n += bQty * bPx;
    }
    return q > 0 ? n / q : null;
  };

  const compositeIn = sum(binIn, cbIn);
  const compositeOut = sum(binOut, cbOut);
  const compositeAvgIn = vwap(binIn, binAvgIn, cbIn, cbAvgIn);
  const compositeAvgOut = vwap(binOut, binAvgOut, cbOut, cbAvgOut);

  const spot = spotPrice ?? null;
  const strike = strikeRes?.strike ?? null;

  const v = computeVerdict({
    spot,
    strike,
    avgIn: compositeAvgIn,
    avgOut: compositeAvgOut,
    inBtc: compositeIn,
    outBtc: compositeOut,
  });

  const venueBtc = (name: string) =>
    multi?.venues.find((x) => x.venue === name)?.btc ?? null;

  // Never store a partial composite: without the Binance leg the totals and
  // averages would be Coinbase-only and silently wrong.
  if (binIn == null || binOut == null) {
    return {
      windowStart,
      secondsToClose,
      spot,
      strike,
      compositeIn,
      compositeOut,
      compositeAvgIn,
      compositeAvgOut,
      verdict: v.verdict,
      written: false,
    };
  }

  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const { error } = await supabaseAdmin.from("btc_composite_flow_log").insert({
    window_start: new Date(windowStart).toISOString(),
    seconds_to_close: secondsToClose,
    spot,
    strike,
    binance_in_btc: binIn,
    binance_out_btc: binOut,
    binance_avg_in: binAvgIn,
    binance_avg_out: binAvgOut,
    coinbase_in_btc: cbIn,
    coinbase_out_btc: cbOut,
    coinbase_avg_in: cbAvgIn,
    coinbase_avg_out: cbAvgOut,
    coinbase_partial: cb?.partial ?? null,
    kraken_btc: venueBtc("Kraken"),
    bitstamp_btc: venueBtc("Bitstamp"),
    total_btc: multi?.totalBtc ?? null,
    composite_in_btc: compositeIn,
    composite_out_btc: compositeOut,
    composite_net_btc:
      compositeIn != null && compositeOut != null ? compositeIn - compositeOut : null,
    composite_imbalance: v.imbalance,
    composite_avg_in: compositeAvgIn,
    composite_avg_out: compositeAvgOut,
    now_vs_avg_in: v.nowVsAvgInGap,
    leg_avgs: v.legs.avgs,
    leg_flow: v.legs.flow,
    leg_now_vs_avg: v.legs.nowVsAvgIn,
    verdict: v.verdict,
  } as never);

  return {
    windowStart,
    secondsToClose,
    spot,
    strike,
    compositeIn,
    compositeOut,
    compositeAvgIn,
    compositeAvgOut,
    verdict: v.verdict,
    written: !error,
  };
}
