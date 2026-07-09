// Client-side tracker for the 3-window Polymarket/Binance shadow log.
// Polls Polymarket every 2s while a Kalshi 15m market is in flight and logs
// W1/W2/W3 summary stats to `btc_polymarket_triple_window`. Purely diagnostic.
import { useEffect, useRef } from "react";
import { useServerFn } from "@tanstack/react-start";
import { useBinanceBtcTicks } from "./useBinanceBtcTicks";
import { computeTrendlineAnalysis } from "./useTrendlineAnalysis";
import { useChartVerdict } from "./useChartVerdict";
import { fetchPolymarketBtcOdds } from "@/lib/polymarketOdds.functions";
import { upsertTripleWindow, settleTripleWindow } from "@/lib/polymarketTripleWindow.functions";

export interface ActiveMarket {
  ticker: string;
  openMs: number;
  closeMs: number;
}

interface WindowAcc {
  open: number | null;
  close: number | null;
  min: number;
  max: number;
  sum: number;
  count: number;
  trendline: string | null;
  chartVerdict: string | null;
  chartStrength: number | null;
}
function emptyWin(): WindowAcc {
  return {
    open: null, close: null, min: Infinity, max: -Infinity,
    sum: 0, count: 0, trendline: null, chartVerdict: null, chartStrength: null,
  };
}
interface State {
  openMs: number;
  closeMs: number;
  w: [WindowAcc, WindowAcc, WindowAcc];
  lastFlushed: number;
  finalFlushed: boolean;
}

export function useTripleWindowTracker(markets: ActiveMarket[]): void {
  const fetchPoly = useServerFn(fetchPolymarketBtcOdds);
  const upsertFn = useServerFn(upsertTripleWindow);
  const settleFn = useServerFn(settleTripleWindow);
  const { ticks } = useBinanceBtcTicks();
  const cv = useChartVerdict();
  const state = useRef<Map<string, State>>(new Map());
  const ticksRef = useRef(ticks);
  ticksRef.current = ticks;
  const cvRef = useRef(cv);
  cvRef.current = cv;
  const marketsRef = useRef(markets);
  marketsRef.current = markets;

  useEffect(() => {
    let cancelled = false;
    async function tick() {
      const now = Date.now();
      let upProb: number | null = null;
      let downMid: number | null = null;
      let lastTrade: number | null = null;
      let rawUpMid: number | null = null;
      try {
        const o = await fetchPoly();
        if (o) {
          upProb = o.effectiveUpProb;   // A: use blended prob, not raw Up mid
          rawUpMid = o.upProb;
          downMid = o.downMid;
          lastTrade = o.lastTrade > 0 ? o.lastTrade : null;
        }
      } catch { /* ignore */ }
      if (cancelled) return;

      const analysis = computeTrendlineAnalysis(ticksRef.current);
      const trend5m = analysis.ready
        ? (analysis.bias === "bull" ? "up" : analysis.bias === "bear" ? "down" : "flat")
        : null;
      const c = analysis.candles;
      const trend1m = c.length >= 3
        ? (c[c.length - 1].c > c[c.length - 3].c ? "up"
          : c[c.length - 1].c < c[c.length - 3].c ? "down" : "flat")
        : null;
      const verdict = cvRef.current;
      const chartDir = verdict.bias === "up" ? "YES" : verdict.bias === "down" ? "NO" : "neutral";
      const chartStrength = verdict.ready ? Math.abs(verdict.score - 50) / 50 : null;

      for (const m of marketsRef.current) {
        if (now < m.openMs) continue;
        // Give a 60s grace period after close for the final flush.
        // Keep the market in the loop for 5 min post-close so we can retry
        // Kalshi settlement (usually finalized within 30s but occasionally slower).
        if (now > m.closeMs + 5 * 60_000) continue;

        let st = state.current.get(m.ticker);
        if (!st) {
          st = {
            openMs: m.openMs, closeMs: m.closeMs,
            w: [emptyWin(), emptyWin(), emptyWin()],
            lastFlushed: 0, finalFlushed: false,
          };
          state.current.set(m.ticker, st);
        }
        const elapsed = now - m.openMs;
        const phase = Math.min(2, Math.max(0, Math.floor(elapsed / (5 * 60_000))));
        const acc = st.w[phase];
        if (upProb != null) {
          if (acc.open == null) acc.open = upProb;
          acc.close = upProb;
          if (upProb < acc.min) acc.min = upProb;
          if (upProb > acc.max) acc.max = upProb;
          acc.sum += upProb;
          acc.count += 1;
        }
        acc.trendline = trend5m;
        acc.chartVerdict = chartDir;
        acc.chartStrength = chartStrength;

        const shouldFlush =
          (now - st.lastFlushed > 15_000) ||
          (now > m.closeMs && !st.finalFlushed);
        if (!shouldFlush) continue;
        st.lastFlushed = now;
        if (now > m.closeMs) st.finalFlushed = true;

        const stats = st.w.map(w => ({
          open_prob: w.open,
          close_prob: w.close,
          avg_prob: w.count > 0 ? w.sum / w.count : null,
          min_prob: w.count > 0 ? w.min : null,
          max_prob: w.count > 0 ? w.max : null,
          samples: w.count,
          trendline_dir: w.trendline,
          chart_verdict: w.chartVerdict,
          chart_strength: w.chartStrength,
        }));
        // Combined signal: prefer latest window with data (W3 > W2 > W1).
        let combinedDir: string | null = null;
        let combinedConf: number | null = null;
        for (let i = 2; i >= 0; i--) {
          const w = stats[i];
          if (w.close_prob != null) {
            combinedDir = w.close_prob >= 0.5 ? "YES" : "NO";
            combinedConf = Math.abs(w.close_prob - 0.5) * 2;
            break;
          }
        }

        try {
          await upsertFn({ data: {
            ticker: m.ticker,
            market_open_ms: m.openMs,
            market_close_ms: m.closeMs,
            w1: stats[0], w2: stats[1], w3: stats[2],
            trendline_1m: trend1m,
            trendline_5m: trend5m,
            combined_dir: combinedDir,
            combined_conf: combinedConf,
          }});
        } catch { /* silent — shadow log is best-effort */ }

        // Final flush → try to record Kalshi settlement. Retries next tick if
        // the market isn't finalized yet (Kalshi usually takes 5–30s post-close).
        if (now > m.closeMs) {
          try { await settleFn({ data: { ticker: m.ticker } }); } catch { /* ignore */ }
        }
      }
    }


    const id = setInterval(tick, 2_000);
    tick();
    return () => { cancelled = true; clearInterval(id); };
  }, [fetchPoly, upsertFn, settleFn]);
}
