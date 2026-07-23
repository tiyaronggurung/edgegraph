import { createFileRoute, Link } from "@tanstack/react-router";
import { supabase } from "@/integrations/supabase/client";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useMemo, useState, useEffect, useRef, lazy } from "react";
import { LazyOnVisible } from "@/components/LazyOnVisible";
import { Activity, ExternalLink, RefreshCw, Loader2, Zap, AlertTriangle, CheckCircle2, XCircle, ArrowUp, ArrowDown, Volume2, VolumeX } from "lucide-react";
import { playOrderPlaced, playOrderFilled, playModelBetPing } from "@/lib/orderSounds";
import { getBtcMarkets, type BtcMarket, type BtcCandle } from "@/lib/cryptoBtc.functions";
import { placeKalshiOrder, listMyCryptoTrades, checkKalshiConfigured, sellKalshiOrder, settleExpiredTrades, checkKalshiBalance, diagnoseKalshiAuth, type KalshiDiagStep } from "@/lib/cryptoTrades.functions";
import { getPredictionStats, getCalibrationReport, type CalibrationRow } from "@/lib/cryptoPredictions.functions";
import { listAutoTradeOrders, settleAutoTradeOrders, runAutoTrade, autoExitLivePositions, settleAutoTradeSkipLog, getSkipReport, sellOddsBetOrder, type AutoTradeOrderRow } from "@/lib/cryptoAutoTrade.functions";
import { recordOddsTape } from "@/lib/oddsTape.functions";
import { getRecentOddsFlip } from "@/lib/oddsFlipAlert.functions";
import { detectBigFlip } from "@/lib/bigFlipDetector.functions";
import { diagnoseRecentMisses, studyMissesWithAI, getLatestStudy, setRecommendationFeedback, type StudyRecommendation } from "@/lib/cryptoMisses.functions";
import { recomputeShadowSim, getShadowSimReport, type ShadowSimGateStat } from "@/lib/cryptoShadowSim.functions";
import { useBinanceBtcSpot } from "@/hooks/useBinanceBtcSpot";
import { useBtcVelocity } from "@/hooks/useBtcVelocity";
import { ChartVerdictBadge } from "@/components/crypto/ChartVerdictBadge";
import { MultiTfShadowPanel } from "@/components/MultiTfShadowPanel";
const TrendlineChartPanel = lazy(() => import("@/components/crypto/TrendlineChartPanel").then(m => ({ default: m.TrendlineChartPanel })));
import { KalshiSentimentBadge } from "@/components/crypto/KalshiSentimentBadge";
import { NextStakeBanner } from "@/components/crypto/NextStakeBanner";
import { useChartVerdict } from "@/hooks/useChartVerdict";
import { useCalibrationShift } from "@/hooks/useCalibrationShift";
import { useMarketRegime } from "@/hooks/useMarketRegime";
import { useCoinbaseBtcSpot } from "@/hooks/useCoinbaseBtcSpot";
import { useBinanceBtcTicks } from "@/hooks/useBinanceBtcTicks";
import { shouldSkipForMagnet } from "@/lib/roundLevelGate";
import { useTrendlineAnalysis } from "@/hooks/useTrendlineAnalysis";
import { useCandleMomentum } from "@/hooks/useCandleMomentum";
import { computeKalshiSentiment } from "@/lib/kalshiSentiment";
import { KalshiMaintenanceBanner } from "@/components/KalshiMaintenanceBanner";
import { PolymarketChip } from "@/components/crypto/PolymarketChip";
import { useTripleWindowTracker } from "@/hooks/useTripleWindowTracker";
import { listTripleWindows, type TripleWindowRow } from "@/lib/polymarketTripleWindow.functions";
import { savePredLock, listPredLocks } from "@/lib/predLocks.functions";
import { getAutoTradeGreenStats } from "@/lib/autoTradeGreenStats.functions";
import { recordPaperFire, getPaperBalance, settleMyPaperFills } from "@/lib/paperTrading.functions";

// Lazy-loaded panels: mounted only when scrolled near the viewport (LazyOnVisible).
// Keeps first paint fast — these panels don't fire queries or parse JS on load.
const EquityMomentumPanel = lazy(() => import("@/components/EquityMomentumPanel").then(m => ({ default: m.EquityMomentumPanel })));
const OddsStudyPanel = lazy(() => import("@/components/crypto/OddsStudyPanel").then(m => ({ default: m.OddsStudyPanel })));
const IocLadderPanel = lazy(() => import("@/components/crypto/IocLadderPanel").then(m => ({ default: m.IocLadderPanel })));
const FlipShadowPanel = lazy(() => import("@/components/crypto/FlipShadowPanel").then(m => ({ default: m.FlipShadowPanel })));
const ScalpShadowPanel = lazy(() => import("@/components/crypto/ScalpShadowPanel").then(m => ({ default: m.ScalpShadowPanel })));
const TaShadowPanel = lazy(() => import("@/components/crypto/TaShadowPanel").then(m => ({ default: m.TaShadowPanel })));
const SkipBucketPanel = lazy(() => import("@/components/crypto/SkipBucketPanel").then(m => ({ default: m.SkipBucketPanel })));
const LossCapPanel = lazy(() => import("@/components/crypto/LossCapPanel").then(m => ({ default: m.LossCapPanel })));
const FlipRecorderPanel = lazy(() => import("@/components/crypto/FlipRecorderPanel").then(m => ({ default: m.FlipRecorderPanel })));
const OddsShadowTraderPanel = lazy(() => import("@/components/crypto/OddsShadowTraderPanel").then(m => ({ default: m.OddsShadowTraderPanel })));
const MartingaleRecoveryPanel = lazy(() => import("@/components/crypto/MartingaleRecoveryPanel").then(m => ({ default: m.MartingaleRecoveryPanel })));
const ManualTradesPanel = lazy(() => import("@/components/crypto/ManualTradesPanel").then(m => ({ default: m.ManualTradesPanel })));
const ModelScorecardPanel = lazy(() => import("@/components/crypto/ModelScorecardPanel").then(m => ({ default: m.ModelScorecardPanel })));
const DailyPerformancePanel = lazy(() => import("@/components/crypto/DailyPerformancePanel").then(m => ({ default: m.DailyPerformancePanel })));
const ModelAblationPanel = lazy(() => import("@/components/crypto/ModelAblationPanel").then(m => ({ default: m.ModelAblationPanel })));
const EvReportPanel = lazy(() => import("@/components/crypto/EvReportPanel").then(m => ({ default: m.EvReportPanel })));
const JumpBacktestPanel = lazy(() => import("@/components/crypto/JumpBacktestPanel").then(m => ({ default: m.JumpBacktestPanel })));
const JumpRecommendationCard = lazy(() => import("@/components/crypto/JumpRecommendationCard").then(m => ({ default: m.JumpRecommendationCard })));
const SignedEdgeVetoPanel = lazy(() => import("@/components/crypto/SignedEdgeVetoPanel").then(m => ({ default: m.SignedEdgeVetoPanel })));
const ConvictionExitPanel = lazy(() => import("@/components/crypto/ConvictionExitPanel").then(m => ({ default: m.ConvictionExitPanel })));
const MarketIntelHealthPanel = lazy(() => import("@/components/crypto/MarketIntelHealthPanel").then(m => ({ default: m.MarketIntelHealthPanel })));





import { toast } from "sonner";

export const Route = createFileRoute("/_authenticated/crypto")({
  head: () => ({
    meta: [
      { title: "Crypto Predictions — BTC 15min Up/Down — EdgeGraph AI" },
      { name: "description", content: "Live model predictions for Kalshi BTC 15-minute up/down markets with edge vs market price." },
      { property: "og:title", content: "Crypto Predictions — BTC 15min Up/Down — EdgeGraph AI" },
      { property: "og:description", content: "Live model predictions for Kalshi BTC 15-minute up/down markets with edge vs market price." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  // Fire-and-forget prefetch of the three hottest queries so they load in
  // parallel with the JS chunk instead of waiting for the component to mount.
  // Errors are swallowed — useQuery will re-fetch normally if these fail.
  loader: async ({ context }) => {
    // Only prefetch authed queries when a session actually exists — otherwise
    // the managed _authenticated gate is mid-redirect to /auth and these
    // server fns 401 with "No authorization header", blank-screening the app.
    const { supabase } = await import("@/integrations/supabase/client");
    const { data } = await supabase.auth.getSession();
    if (!data.session) return;
    context.queryClient.prefetchQuery({ queryKey: ["crypto-trades"], queryFn: () => listMyCryptoTrades() }).catch(() => {});
    context.queryClient.prefetchQuery({ queryKey: ["btc-markets"], queryFn: () => getBtcMarkets() }).catch(() => {});
    context.queryClient.prefetchQuery({ queryKey: ["btc-pred-stats"], queryFn: () => getPredictionStats() }).catch(() => {});
    // Prefetch the trendline/candle snapshot so the chart is warm before the
    // lazy panel scrolls into view. 25s staleTime matches the panel's config.
    import("@/lib/trendlineShadow.functions").then(({ evalTrendlineShadow }) =>
      context.queryClient.prefetchQuery({
        queryKey: ["trendline-shadow"],
        queryFn: () => evalTrendlineShadow(),
        staleTime: 25_000,
      }).catch(() => {})
    ).catch(() => {});
  },
  component: CryptoPage,
});

const fmt$ = (n: number) => n.toLocaleString(undefined, { style: "currency", currency: "USD", maximumFractionDigits: 0 });
const fmtTime = (iso: string | null) => iso ? new Date(iso).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" }) : "—";
const fmtCountdown = (s: number) => s <= 0 ? "closed" : `${Math.floor(s/60)}m ${(s%60).toString().padStart(2,"0")}s`;
// Kalshi BTC 15m: YES = price closes ABOVE strike, NO = at/below. Show "UP" / "DOWN" to users.
const dirLabel = (side: string) => side === "YES" ? "UP" : "DOWN";
// Kalshi ¢ → American odds (favorites negative, dogs positive).
const centsToAmerican = (c: number): string => {
  const p = Math.max(0.01, Math.min(0.99, c / 100));
  if (p >= 0.5) return `-${Math.round((p / (1 - p)) * 100)}`;
  return `+${Math.round(((1 - p) / p) * 100)}`;
};

// Kalshi weekly maintenance: Thursday 2:30–5:30 AM ET. Skip all Auto-Odds
// entries and exits during this window to avoid suspicious-request flags.
const isKalshiMaintenanceWindow = (d: Date = new Date()): boolean => {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/New_York",
    weekday: "short",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).formatToParts(d);
  const wd = parts.find(p => p.type === "weekday")?.value;
  const hh = parseInt(parts.find(p => p.type === "hour")?.value ?? "0", 10);
  const mm = parseInt(parts.find(p => p.type === "minute")?.value ?? "0", 10);
  if (wd !== "Thu") return false;
  const mins = hh * 60 + mm;
  return mins >= 150 && mins < 330; // 02:30 .. 05:30 ET
};

function Sparkline({ candles, strike }: { candles: BtcCandle[]; strike?: number }) {
  if (!candles.length) return <div className="h-12 text-xs text-muted-foreground">no data</div>;
  const closes = candles.map(c => c.c);
  const min = Math.min(...closes, strike ?? Infinity);
  const max = Math.max(...closes, strike ?? -Infinity);
  const span = max - min || 1;
  const w = 160, h = 44, pad = 2;
  const pts = closes.map((v, i) => {
    const x = pad + (i / (closes.length - 1 || 1)) * (w - 2 * pad);
    const y = h - pad - ((v - min) / span) * (h - 2 * pad);
    return `${x},${y}`;
  }).join(" ");
  const up = closes[closes.length-1] >= closes[0];
  const stroke = up ? "#10b981" : "#ef4444";
  const strikeY = strike ? h - pad - ((strike - min) / span) * (h - 2 * pad) : null;
  return (
    <svg width={w} height={h} className="block">
      {strikeY !== null && <line x1={0} x2={w} y1={strikeY} y2={strikeY} stroke="var(--color-primary)" strokeDasharray="3 3" strokeOpacity="0.6" />}
      <polyline points={pts} fill="none" stroke={stroke} strokeWidth="1.5" />
    </svg>
  );
}

interface SizingState { bankroll: number; kellyMult: number; }

function suggestedStake(m: BtcMarket, s: SizingState): { contracts: number; stakeUsd: number; limitCents: number } {
  // Raw Kelly bankroll fraction × user multiplier (0.10–1.0 of QUARTER-Kelly already in m.kellyFraction).
  const frac = Math.max(0, Math.min(0.10, m.kellyFraction * (s.kellyMult / 0.25)));
  const stakeUsd = frac * s.bankroll;
  const price = m.side === "YES" ? Math.max(m.yesAsk || m.yesPrice, 0.01) : Math.max(m.noAsk || (1 - m.yesPrice), 0.01);
  const limitCents = Math.max(1, Math.min(99, Math.round(price * 100)));
  const contracts = Math.max(0, Math.floor(stakeUsd / (limitCents / 100)));
  return { contracts, stakeUsd, limitCents };
}

function MarketRow({
  m, candles, sizing, onPlace, live,
}: {
  m: BtcMarket; candles: BtcCandle[]; sizing: SizingState;
  onPlace: (m: BtcMarket) => void;
  live: { price: number | null; direction: "up" | "down" | "flat"; lastTickMs: number | null; connected: boolean };
}) {
  const spot = live.price ?? m.spot;
  const above = spot >= m.strike;
  const distance = spot - m.strike;
  const distPct = (distance / m.strike) * 100;
  const conf = m.edgeAbs >= 10 ? "HIGH" : m.edgeAbs >= 5 ? "MED" : "LOW";
  const confColor = conf === "HIGH" ? "text-emerald-400" : conf === "MED" ? "text-yellow-400" : "text-muted-foreground";
  const sideColor = m.side === "YES"
    ? "bg-emerald-500/15 text-emerald-400 border-emerald-500/40"
    : "bg-red-500/15 text-red-400 border-red-500/40";
  const sug = suggestedStake(m, sizing);
  const tradable = m.gateAction === "BET" && sug.contracts > 0;

  // Flash background briefly on each tick
  const fresh = live.lastTickMs && Date.now() - live.lastTickMs < 600;
  const tickBg = fresh && live.direction === "up"
    ? "bg-emerald-500/20"
    : fresh && live.direction === "down"
    ? "bg-red-500/20"
    : "bg-transparent";
  const TickIcon = live.direction === "up" ? ArrowUp : live.direction === "down" ? ArrowDown : null;
  const tickColor = live.direction === "up" ? "text-emerald-400" : live.direction === "down" ? "text-red-400" : "text-muted-foreground";

  return (
    <div className="border border-border rounded-lg bg-card p-4 grid grid-cols-1 lg:grid-cols-[1fr_auto_auto_auto] gap-4 items-center">
      <div className="space-y-1">
        <div className="flex items-center gap-2">
          <span className="text-xs uppercase tracking-wider text-muted-foreground">{m.subTitle || m.title}</span>
          <a href={`https://kalshi.com/markets/kxbtc15m/bitcoin-price-up-down/${m.eventTicker.toLowerCase()}`} target="_blank" rel="noreferrer" className="text-muted-foreground hover:text-foreground">
            <ExternalLink className="h-3 w-3" />
          </a>
        </div>
        <div className="text-base font-semibold flex flex-wrap items-center gap-x-2 gap-y-1">
          <span>Strike <span className="text-[color:var(--color-primary)]">{fmt$(m.strike)}</span></span>
          <span className="text-muted-foreground">·</span>
          <span className={`inline-flex items-center gap-1 px-1.5 py-0.5 rounded transition-colors duration-300 ${tickBg}`}>
            Spot
            <span className={above ? "text-emerald-400" : "text-red-400"}>{fmt$(spot)}</span>
            {TickIcon && <TickIcon className={`h-3.5 w-3.5 ${tickColor}`} />}
          </span>
          <span className={`text-xs font-mono ${above ? "text-emerald-400" : "text-red-400"}`}>
            {distance >= 0 ? "+" : ""}{fmt$(Math.round(distance))} ({distPct >= 0 ? "+" : ""}{distPct.toFixed(2)}%) vs strike
          </span>
          {live.connected && <span className="text-[9px] text-emerald-400 uppercase tracking-wider">live</span>}
          <span className="text-muted-foreground">·</span>
          <span className="text-xs text-muted-foreground">closes {fmtTime(m.closeTime)} ({fmtCountdown(m.secondsToClose)})</span>
        </div>
        <div className="flex items-center gap-3 text-xs text-muted-foreground flex-wrap">
          <span>YES {(m.yesPrice*100).toFixed(0)}¢ (bid {(m.yesBid*100).toFixed(0)}/ask {(m.yesAsk*100).toFixed(0)})</span>
          <span>OI ${m.openInterest.toFixed(0)}</span>
          <span>vol24h ${m.volume24h.toFixed(0)}</span>
          <span>realized {m.realizedMoveBps >= 0 ? "+" : ""}{m.realizedMoveBps.toFixed(0)}bps</span>
          <span className={
            m.sigmaDistance >= 2 ? "text-emerald-400 font-semibold" :
            m.sigmaDistance >= 1 ? "text-yellow-400" :
            "text-red-400"
          } title="How many σ of remaining-window vol stand between spot and strike. >2 = ~97% safe on locked side, <0.5 = coin flip.">
            safety {m.sigmaDistance.toFixed(2)}σ
          </span>
        </div>
      </div>


      <div className="flex flex-col items-end gap-1">
        <Sparkline candles={candles} strike={m.strike} />
        <span className="text-[10px] text-muted-foreground">BTC 60m · dashed = strike</span>
      </div>

      <div className="flex flex-col items-end gap-1 min-w-[220px]">
        <div className="flex items-center gap-2 flex-wrap justify-end">
          <div className={`px-2 py-0.5 text-[11px] uppercase tracking-wider border rounded ${sideColor}`}>
            {m.studying ? "Model: —" : `Model: ${dirLabel(m.side)}`}
          </div>
          {m.studying ? (
            <div className="px-2 py-0.5 text-[11px] font-bold uppercase tracking-wider border rounded bg-amber-500/20 text-amber-300 border-amber-500/60 animate-pulse">
              ⏳ STUDYING {m.studyingSecondsLeft}s
            </div>
          ) : (
            <div className={`px-2 py-0.5 text-[11px] font-bold uppercase tracking-wider border rounded ${
              m.gateAction === "BET"
                ? "bg-[color:var(--color-primary)]/20 text-[color:var(--color-primary)] border-[color:var(--color-primary)]/60"
                : "bg-muted/30 text-muted-foreground border-border"
            }`}>
              {m.gateAction === "BET" ? "✓ BET" : "✕ PASS"}
            </div>
          )}
          {!m.studying && m.strikeVerdict && (
            <div className={`px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider border rounded ${
              m.strikeVerdict === "SOLID"
                ? "bg-emerald-500/20 text-emerald-300 border-emerald-500/60"
                : m.strikeVerdict === "CHOPPY"
                ? "bg-red-500/20 text-red-300 border-red-500/60"
                : "bg-amber-500/10 text-amber-300 border-amber-500/40"
            }`} title={m.strikeVerdictReason}>
              {m.strikeVerdict}
            </div>
          )}
        </div>
        <div className="text-sm">Model YES <span className="font-bold">{(m.modelYesProb*100).toFixed(1)}%</span> vs mkt {(m.yesPrice*100).toFixed(0)}¢</div>
        <div className="text-[10px] text-muted-foreground text-right">
          base {(m.modelBaseProb*100).toFixed(1)}% {m.microAdjPts >= 0 ? "+" : ""}{m.microAdjPts.toFixed(2)}pts micro
          {m.optionsImpliedProb !== null && (
            <> · opt {(m.optionsImpliedProb*100).toFixed(1)}% <span className={m.optionsBlendPts >= 0 ? "text-emerald-400" : "text-red-400"}>({m.optionsBlendPts >= 0 ? "+" : ""}{m.optionsBlendPts.toFixed(2)}pts)</span></>
          )}
          {m.calibActive && (
            <> · <span className={m.calibAdjPts >= 0 ? "text-emerald-400" : "text-red-400"}>calib {m.calibAdjPts >= 0 ? "+" : ""}{m.calibAdjPts.toFixed(2)}pts</span></>
          )}
        </div>
        <div className="text-xs">Edge <span className={confColor+" font-semibold"}>{m.edgePts>=0?"+":""}{m.edgePts.toFixed(1)}pts</span> / req <span className="font-mono">{m.requiredEdgePts.toFixed(1)}pts</span> <span className={"ml-1 "+confColor}>[{conf}]</span></div>
        <div className="text-[10px] text-muted-foreground text-right">
          thr: {m.thresholdParts.base.toFixed(1)}b
          {m.thresholdParts.calib > 0 && <> +{m.thresholdParts.calib.toFixed(1)}cal</>}
          {m.thresholdParts.time > 0 && <> +{m.thresholdParts.time.toFixed(1)}t</>}
          {m.thresholdParts.spread > 0 && <> +{m.thresholdParts.spread.toFixed(1)}spr</>}
          {m.thresholdParts.regime > 0 && <> +{m.thresholdParts.regime.toFixed(1)}reg</>}
          {m.thresholdParts.whale !== 0 && <> <span className={m.thresholdParts.whale < 0 ? "text-emerald-400" : "text-red-400"}>{m.thresholdParts.whale > 0 ? "+" : ""}{m.thresholdParts.whale.toFixed(1)}whl</span></>}
        </div>
        <div className={`text-[10px] text-right ${m.gateAction === "BET" ? "text-emerald-400" : "text-muted-foreground"}`}>{m.gateReason}</div>
        <div className={`text-[10px] text-right font-mono ${m.gapAnalysis.momentumAlignsWithSide ? "text-emerald-400/80" : "text-amber-400/80"}`} title="Gap analysis: $ spot must traverse for locked side to win, in σ of remaining-window vol, plus momentum sign.">
          gap {m.gapAnalysis.gapUsd >= 0 ? "+" : ""}${Math.round(m.gapAnalysis.gapUsd)} ({m.gapAnalysis.gapInSigmas.toFixed(2)}σ to flip) · mom {m.gapAnalysis.momentumSign > 0 ? "↑" : m.gapAnalysis.momentumSign < 0 ? "↓" : "—"} {m.gapAnalysis.momentumAlignsWithSide ? "with" : "vs"} {m.side}
        </div>
        {m.studyFindings && m.studyFindings.length > 0 && (
          <div className={`mt-1 w-full text-[10px] font-mono text-left rounded border p-1.5 ${
            m.studying
              ? "bg-amber-500/5 border-amber-500/30 text-amber-200/90"
              : m.strikeVerdict === "SOLID"
              ? "bg-emerald-500/5 border-emerald-500/30 text-emerald-200/80"
              : m.strikeVerdict === "CHOPPY"
              ? "bg-red-500/5 border-red-500/30 text-red-200/80"
              : "bg-muted/20 border-border text-muted-foreground"
          }`}>
            <div className="uppercase tracking-wider text-[9px] opacity-70 mb-0.5">
              {m.studying ? `⏳ Studying strike · ${m.studyingSecondsLeft}s left` : `📊 Strike Study · ${m.strikeVerdict ?? ""}`}
            </div>
            {m.studyFindings.map((f, i) => (
              <div key={i} className="leading-tight">• {f}</div>
            ))}
            {!m.studying && m.strikeVerdictReason && (
              <div className="mt-1 pt-1 border-t border-current/20 opacity-90">→ {m.strikeVerdictReason}</div>
            )}
          </div>
        )}
      </div>


      <div className="flex flex-col items-stretch gap-1 min-w-[160px]">
        <div className="text-xs text-right text-muted-foreground">Suggested stake</div>
        <div className="text-right font-mono text-sm">{fmt$(sug.stakeUsd)} <span className="text-muted-foreground">·</span> {sug.contracts}× @ {sug.limitCents}¢</div>
        <button
          disabled={!tradable}
          onClick={() => onPlace(m)}
          className="text-xs uppercase tracking-wider px-3 py-1.5 border border-[color:var(--color-primary)] rounded text-[color:var(--color-primary)] hover:bg-[color:var(--color-primary)]/10 disabled:opacity-30 disabled:cursor-not-allowed"
        >
          Place on Kalshi
        </button>
      </div>
    </div>
  );
}

function TopPick({ markets }: { markets: BtcMarket[] }) {
  const pick = useMemo(() => {
    const eligible = markets.filter(m => m.gateAction === "BET");
    if (!eligible.length) return null;
    return [...eligible].sort((a,b) => (b.edgeAbs - b.requiredEdgePts) - (a.edgeAbs - a.requiredEdgePts))[0];
  }, [markets]);
  if (!pick) return (
    <div className="border border-border rounded-lg bg-card p-4 text-sm text-muted-foreground">
      No high-edge BTC 15m market right now. Model needs ≥3pt edge to issue a top pick.
    </div>
  );
  const upProb = pick.modelYesProb * 100;
  const downProb = 100 - upProb;
  const spotVsStrike = pick.spot - pick.strike;
  return (
    <div className="border border-[color:var(--color-primary)]/60 rounded-lg bg-[color:var(--color-primary)]/5 p-4">
      <div className="flex items-center justify-between gap-2 mb-2">
        <div className="flex items-center gap-2">
          <Zap className="h-4 w-4 text-[color:var(--color-primary)]" />
          <span className="text-xs uppercase tracking-wider text-[color:var(--color-primary)]">Model Top Pick</span>
        </div>
        <span className="text-[10px] uppercase tracking-wider text-muted-foreground">closes {fmtTime(pick.closeTime)} · {fmtCountdown(pick.secondsToClose)}</span>
      </div>

      {/* Realtime BTC price + strike delta */}
      <div className="flex items-baseline gap-3 mb-3">
        <span className="text-2xl font-bold tabular-nums">{fmt$(pick.spot)}</span>
        <span className={`text-sm font-semibold tabular-nums ${spotVsStrike >= 0 ? "text-emerald-400" : "text-rose-400"}`}>
          {spotVsStrike >= 0 ? "+" : ""}{fmt$(spotVsStrike)} vs strike {fmt$(pick.strike)}
        </span>
      </div>

      {/* Realtime UP / DOWN probability bar */}
      <div className="mb-3">
        <div className="flex h-6 w-full overflow-hidden rounded border border-border">
          <div
            className="flex items-center justify-start pl-2 bg-emerald-500/25 text-emerald-300 text-xs font-bold tabular-nums transition-all"
            style={{ width: `${Math.max(upProb, 6)}%` }}
          >
            ▲ {upProb.toFixed(1)}%
          </div>
          <div
            className="flex items-center justify-end pr-2 bg-rose-500/25 text-rose-300 text-xs font-bold tabular-nums transition-all"
            style={{ width: `${Math.max(downProb, 6)}%` }}
          >
            {downProb.toFixed(1)}% ▼
          </div>
        </div>
        <div className="flex justify-between text-[10px] uppercase tracking-wider text-muted-foreground mt-1">
          <span>Model UP</span>
          <span>Model DOWN</span>
        </div>
      </div>

      <div className="text-sm font-semibold">
        Bet BTC goes <span className="text-[color:var(--color-primary)]">{dirLabel(pick.side)}</span> · market {(pick.yesPrice*100).toFixed(0)}¢ · edge {pick.edgePts>=0?"+":""}{pick.edgePts.toFixed(1)}pts
      </div>
    </div>
  );
}

function ConfirmModal({
  market, sizing, onClose, onConfirm, submitting,
}: {
  market: BtcMarket; sizing: SizingState;
  onClose: () => void; onConfirm: () => void; submitting: boolean;
}) {
  const sug = suggestedStake(market, sizing);
  return (
    <div className="fixed inset-0 z-50 bg-black/70 flex items-center justify-center p-4" onClick={onClose}>
      <div className="bg-card border border-border rounded-lg p-5 max-w-md w-full" onClick={e => e.stopPropagation()}>
        <div className="flex items-center gap-2 mb-2">
          <AlertTriangle className="h-4 w-4 text-yellow-400" />
          <h3 className="font-bold">Confirm Kalshi order</h3>
        </div>
        <div className="space-y-1 text-sm mb-4">
          <div><span className="text-muted-foreground">Market:</span> <code className="text-xs">{market.ticker}</code></div>
          <div><span className="text-muted-foreground">Direction:</span> <span className="font-bold">{dirLabel(market.side)}</span> ({market.side}) @ <span className="font-bold">{sug.limitCents}¢</span> limit</div>
          <div><span className="text-muted-foreground">Contracts:</span> <span className="font-bold">{sug.contracts}</span></div>
          <div><span className="text-muted-foreground">Max risk:</span> <span className="font-bold">{fmt$(sug.stakeUsd)}</span> ({((sug.stakeUsd/sizing.bankroll)*100).toFixed(2)}% of bankroll)</div>
          <div><span className="text-muted-foreground">Edge:</span> {market.edgePts>=0?"+":""}{market.edgePts.toFixed(1)} pts</div>
          <div><span className="text-muted-foreground">Closes:</span> {fmtTime(market.closeTime)} ({fmtCountdown(market.secondsToClose)})</div>
        </div>
        <p className="text-[11px] text-muted-foreground mb-3">Real money. This submits a live limit order to Kalshi.</p>
        <div className="flex gap-2 justify-end">
          <button onClick={onClose} className="px-3 py-1.5 text-xs uppercase tracking-wider border border-border rounded">Cancel</button>
          <button onClick={onConfirm} disabled={submitting} className="px-3 py-1.5 text-xs uppercase tracking-wider bg-[color:var(--color-primary)] text-black rounded disabled:opacity-50">
            {submitting ? <Loader2 className="h-3 w-3 animate-spin inline" /> : "Confirm & submit"}
          </button>
        </div>
      </div>
    </div>
  );
}

interface OpenPosSignal {
  action: "CASH_OUT_PROFIT" | "CASH_OUT_FLIP" | "STOP_LOSS" | "STOP_LOSS_SPOT" | "HOLD";
  label: string;
  reason: string;
  exitEdgePts: number;       // (currentSidePrice − modelSideProb) × 100. Positive = market overpaying us.
  pnlUsd: number;
  pnlPct: number;
  exitCents: number;         // current best bid in cents on our side (sell-back price)
  currentSideProb: number;
}

// Rule 1 — spot-crash threshold: BTC moves against our side by this %
// over the last 3min ⇒ force an immediate exit even if the model still likes us.
const SPOT_CRASH_PCT_3MIN = 0.25;
// Rule 2 — no-flip lockout: with ≤180s to close AND we're on the ≥80% side,
// suppress FLIP/STOP_LOSS "panic" exits — market almost never flips this late.
const NO_FLIP_MAX_SECS = 180;
const NO_FLIP_MIN_MARKET_PROB = 0.80;

function computeExitSignal(
  trade: any,
  market: BtcMarket | undefined,
  velocity?: { pctChange3min: number | null } | null,
): OpenPosSignal | null {
  if (!market) return null;
  const contracts = Number(trade.contracts);
  const stake = Number(trade.stake_usd);
  if (!contracts || !stake) return null;
  const entrySidePrice = stake / contracts; // dollars per contract on our side
  const currentSidePrice = trade.side === "YES" ? market.yesBid : market.noBid;
  if (!currentSidePrice || currentSidePrice <= 0) return null;
  const modelSideProb = trade.side === "YES" ? market.modelYesProb : 1 - market.modelYesProb;
  const exitEdgePts = (currentSidePrice - modelSideProb) * 100;
  const pnlUsd = (currentSidePrice - entrySidePrice) * contracts;
  const pnlPct = (currentSidePrice / entrySidePrice - 1) * 100;
  const exitCents = Math.max(1, Math.min(99, Math.round(currentSidePrice * 100)));

  // Decision logic:
  //  • STOP_LOSS_SPOT : BTC spot moved against us ≥ threshold in last 3min (Rule 1)
  //  • CASH_OUT_PROFIT: market overpays vs model by ≥3pts AND we're up money
  //  • CASH_OUT_FLIP  : model now disagrees with our side (model side prob < 0.40) AND we're still up
  //  • STOP_LOSS      : model strongly against (< 0.25) AND down ≥30% of stake
  //  • HOLD           : otherwise
  let action: OpenPosSignal["action"] = "HOLD";
  let label = "Hold";
  let reason = `Model still ${(modelSideProb * 100).toFixed(0)}% on ${trade.side === "YES" ? "UP" : "DOWN"}`;

  // Rule 1 — spot crash exit (highest priority; overrides no-flip lockout).
  const v3 = velocity?.pctChange3min;
  if (v3 != null && Number.isFinite(v3)) {
    const against = trade.side === "YES" ? -v3 : v3; // positive = moving against us
    if (against >= SPOT_CRASH_PCT_3MIN) {
      return {
        action: "STOP_LOSS_SPOT",
        label: "Exit — spot crash",
        reason: `BTC ${v3 >= 0 ? "+" : ""}${v3.toFixed(2)}% in 3min vs ${trade.side === "YES" ? "UP" : "DOWN"} — exit ASAP`,
        exitEdgePts, pnlUsd, pnlPct, exitCents, currentSideProb: modelSideProb,
      };
    }
  }

  if (exitEdgePts >= 3 && pnlUsd > 0) {
    action = "CASH_OUT_PROFIT";
    label = "Cash out (profit)";
    reason = `Market pays ${exitEdgePts.toFixed(1)}pts over fair — lock $${pnlUsd.toFixed(2)}`;
  } else if (modelSideProb < 0.40 && pnlUsd > 0) {
    action = "CASH_OUT_FLIP";
    label = "Cash out (model flipped)";
    reason = `Model side prob dropped to ${(modelSideProb*100).toFixed(0)}% — take $${pnlUsd.toFixed(2)} while ahead`;
  } else if (modelSideProb < 0.25 && pnlUsd < -0.30 * stake) {
    action = "STOP_LOSS";
    label = "Stop loss";
    reason = `Model only ${(modelSideProb*100).toFixed(0)}% — cap loss at $${pnlUsd.toFixed(2)}`;
  }

  // Rule 2 — no-flip lockout: if we're on the winning side (market ≥ 80%) with
  // ≤3min left, override CASH_OUT_FLIP / STOP_LOSS back to HOLD. Market almost
  // never flips from 80/20 in the final 3min. STOP_LOSS_SPOT already returned.
  if (
    market.secondsToClose <= NO_FLIP_MAX_SECS &&
    currentSidePrice >= NO_FLIP_MIN_MARKET_PROB &&
    (action === "CASH_OUT_FLIP" || action === "STOP_LOSS")
  ) {
    action = "HOLD";
    label = "Hold (no-flip)";
    reason = `${(currentSidePrice*100).toFixed(0)}¢ on our side w/ ${market.secondsToClose}s left — flip unlikely`;
  }

  return { action, label, reason, exitEdgePts, pnlUsd, pnlPct, exitCents, currentSideProb: modelSideProb };
}

function OpenPositions({ markets }: { markets: BtcMarket[] }) {
  const listFn = useServerFn(listMyCryptoTrades);
  const sellFn = useServerFn(sellKalshiOrder);
  const settleFn = useServerFn(settleExpiredTrades);
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ["crypto-trades"], queryFn: () => listFn(), refetchInterval: 10_000 });

  // Auto-settle: 10s after a position's close_time, fetch the resolved market
  // from Kalshi and stamp WIN/LOSS + realized P&L on the trade row.
  useEffect(() => {
    let stopped = false;
    const tick = async () => {
      try {
        const res: any = await settleFn({});
        if (!stopped && res?.settled > 0) {
          for (const r of res.results ?? []) {
            toast[r.outcome === "WIN" ? "success" : "error"](
              `${r.outcome}: ${r.pnl >= 0 ? "+" : ""}$${Number(r.pnl).toFixed(2)} (settled @ ${r.settleCents}¢)`,
              { duration: 8000 },
            );
          }
          qc.invalidateQueries({ queryKey: ["crypto-trades"] });
          qc.invalidateQueries({ queryKey: ["btc-pred-stats"] });
        }
      } catch { /* swallow — next tick retries */ }
    };
    tick();
    const id = setInterval(tick, 10_000);
    return () => { stopped = true; clearInterval(id); };
  }, [settleFn, qc]);

  const sell = useMutation({
    mutationFn: (vars: { tradeId: string; limitPriceCents: number }) => sellFn({ data: vars }),
    onSuccess: (res: any) => {
      toast.success(`Closed: realized $${Number(res.realizedPnl).toFixed(2)} @ ${res.exitCents}¢`);
      qc.invalidateQueries({ queryKey: ["crypto-trades"] });
    },
    onError: (e: any) => toast.error(`Close failed: ${e?.message ?? "unknown"}`),
  });
  const [confirm, setConfirm] = useState<{ trade: any; sig: OpenPosSignal } | null>(null);
  const velocity = useBtcVelocity();
  const autoExitedRef = useRef<Set<string>>(new Set());

  const open = useMemo(() => {
    const trades = (q.data?.trades ?? []) as any[];
    const now = Date.now();
    const byTicker = new Map(markets.map(m => [m.ticker, m]));
    return trades
      .filter(t => t.status === "submitted" && t.close_time && new Date(t.close_time).getTime() > now)
      .map(t => ({ trade: t, market: byTicker.get(t.ticker), sig: computeExitSignal(t, byTicker.get(t.ticker), velocity) }))
      .filter(x => x.sig !== null)
      .sort((a, b) => {
        const rank = (s: OpenPosSignal | null) =>
          s?.action === "STOP_LOSS_SPOT" ? 0
          : s?.action === "STOP_LOSS" ? 1
          : s?.action === "CASH_OUT_PROFIT" ? 2
          : s?.action === "CASH_OUT_FLIP" ? 3 : 4;
        return rank(a.sig) - rank(b.sig);
      });
  }, [q.data, markets, velocity]);

  // Rule 1 auto-exit: on STOP_LOSS_SPOT, fire market sell exactly once per trade.
  useEffect(() => {
    for (const { trade: t, sig } of open) {
      if (sig?.action !== "STOP_LOSS_SPOT") continue;
      if (autoExitedRef.current.has(t.id)) continue;
      if (sell.isPending) continue;
      autoExitedRef.current.add(t.id);
      toast.error(`Auto-exit: spot crash on ${t.ticker}`, { description: sig.reason, duration: 10_000 });
      sell.mutate({ tradeId: t.id, limitPriceCents: sig.exitCents });
    }
  }, [open, sell]);


  if (!open.length) return null;

  return (
    <div className="border border-[color:var(--color-primary)]/40 rounded-lg bg-card">
      <div className="px-4 py-2 border-b border-border flex items-center justify-between">
        <h2 className="text-sm uppercase tracking-wider text-[color:var(--color-primary)]">Open positions · live exit signals</h2>
        <span className="text-[10px] text-muted-foreground">refreshes 10s</span>
      </div>
      <div className="divide-y divide-border">
        {open.map(({ trade: t, market, sig }) => {
          if (!sig || !market) return null;
          const isExit = sig.action !== "HOLD";
          const actionColor = sig.action === "STOP_LOSS_SPOT"
            ? "border-red-600 bg-red-600/20 text-red-300 animate-pulse"
            : sig.action === "STOP_LOSS"
            ? "border-red-500/60 bg-red-500/10 text-red-400"
            : sig.action === "CASH_OUT_PROFIT"
              ? "border-emerald-500/60 bg-emerald-500/10 text-emerald-400"
              : sig.action === "CASH_OUT_FLIP"
                ? "border-yellow-500/60 bg-yellow-500/10 text-yellow-400"
                : "border-border bg-muted/20 text-muted-foreground";
          return (
            <div key={t.id} className="p-3 grid grid-cols-1 lg:grid-cols-[1.5fr_1fr_1fr_auto] gap-3 items-center">
              <div>
                <div className="text-xs text-muted-foreground">{t.ticker}</div>
                <div className="text-sm font-semibold">
                  {t.contracts}× <span className={t.side === "YES" ? "text-emerald-400" : "text-red-400"}>{dirLabel(t.side)}</span> from {fmt$(Number(t.strike))} · closes {fmtCountdown(market.secondsToClose)}
                </div>
                <div className="text-[10px] text-muted-foreground">stake {fmt$(Number(t.stake_usd))} · entry {Math.round((Number(t.stake_usd)/Number(t.contracts))*100)}¢ · now {sig.exitCents}¢</div>
              </div>
              <div className="text-xs">
                <div>Model now <span className="font-bold">{(sig.currentSideProb*100).toFixed(0)}%</span> on {dirLabel(t.side)}</div>
                <div className="text-muted-foreground">exit edge {sig.exitEdgePts >= 0 ? "+" : ""}{sig.exitEdgePts.toFixed(1)}pts</div>
              </div>
              <div className="text-sm font-mono">
                <div className={sig.pnlUsd >= 0 ? "text-emerald-400" : "text-red-400"}>
                  {sig.pnlUsd >= 0 ? "+" : ""}{fmt$(sig.pnlUsd)} ({sig.pnlPct >= 0 ? "+" : ""}{sig.pnlPct.toFixed(0)}%)
                </div>
                <div className={`text-[10px] inline-block px-1.5 py-0.5 rounded border mt-1 ${actionColor}`}>{sig.label}</div>
              </div>
              <div className="flex flex-col items-end gap-1 min-w-[140px]">
                <button
                  onClick={() => setConfirm({ trade: t, sig })}
                  disabled={sell.isPending}
                  className={`text-xs uppercase tracking-wider px-3 py-1.5 border rounded disabled:opacity-30 disabled:cursor-not-allowed ${
                    isExit
                      ? "border-[color:var(--color-primary)] text-[color:var(--color-primary)] hover:bg-[color:var(--color-primary)]/10"
                      : "border-border text-muted-foreground hover:bg-muted/30"
                  }`}
                  title={sig.reason}
                >
                  Cash out @ {sig.exitCents}¢
                </button>
                <div className="text-[10px] text-muted-foreground text-right max-w-[180px]">{sig.reason}</div>
              </div>
            </div>
          );
        })}
      </div>
      {confirm && (
        <div className="fixed inset-0 z-50 bg-black/70 flex items-center justify-center p-4" onClick={() => setConfirm(null)}>
          <div className="bg-card border border-border rounded-lg p-5 max-w-md w-full" onClick={e => e.stopPropagation()}>
            <div className="flex items-center gap-2 mb-2">
              <AlertTriangle className="h-4 w-4 text-yellow-400" />
              <h3 className="font-bold">Confirm close — sell back to Kalshi</h3>
            </div>
            <div className="space-y-1 text-sm mb-4">
              <div><span className="text-muted-foreground">Position:</span> {confirm.trade.contracts}× <span className="font-bold">{dirLabel(confirm.trade.side)}</span> ({confirm.trade.side}) @ {confirm.trade.ticker}</div>
              <div><span className="text-muted-foreground">Sell @:</span> <span className="font-bold">{confirm.sig.exitCents}¢</span> limit ({confirm.trade.contracts} contracts)</div>
              <div><span className="text-muted-foreground">Realized P&amp;L if filled:</span> <span className={`font-bold ${confirm.sig.pnlUsd >= 0 ? "text-emerald-400" : "text-red-400"}`}>{confirm.sig.pnlUsd >= 0 ? "+" : ""}{fmt$(confirm.sig.pnlUsd)}</span></div>
              <div className="text-xs text-muted-foreground pt-2">{confirm.sig.reason}</div>
            </div>
            <div className="flex gap-2 justify-end">
              <button onClick={() => setConfirm(null)} className="px-3 py-1.5 text-xs uppercase tracking-wider border border-border rounded">Cancel</button>
              <button
                onClick={() => { sell.mutate({ tradeId: confirm.trade.id, limitPriceCents: confirm.sig.exitCents }); setConfirm(null); }}
                disabled={sell.isPending}
                className="px-3 py-1.5 text-xs uppercase tracking-wider bg-[color:var(--color-primary)] text-black rounded disabled:opacity-50"
              >
                {sell.isPending ? <Loader2 className="h-3 w-3 animate-spin inline" /> : "Confirm close"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function TradeLog() {
  const fn = useServerFn(listMyCryptoTrades);
  const q = useQuery({ queryKey: ["crypto-trades"], queryFn: () => fn(), refetchInterval: 30_000 });
  const trades = q.data?.trades ?? [];
  if (!trades.length) return (
    <div className="border border-border rounded-lg bg-card p-4 text-sm text-muted-foreground">No trades logged yet.</div>
  );
  return (
    <div className="border border-border rounded-lg bg-card overflow-x-auto">
      <table className="w-full text-xs">
        <thead className="bg-muted/30 text-muted-foreground uppercase tracking-wider">
          <tr>
            <th className="text-left p-2">Time</th>
            <th className="text-left p-2">Ticker</th>
            <th className="text-left p-2">Side</th>
            <th className="text-right p-2">Strike</th>
            <th className="text-right p-2">Spot@Entry</th>
            <th className="text-right p-2">Model%</th>
            <th className="text-right p-2">Edge</th>
            <th className="text-right p-2">Contracts</th>
            <th className="text-right p-2">Stake</th>
            <th className="text-left p-2">Status</th>
            <th className="text-right p-2">P&amp;L</th>
          </tr>
        </thead>
        <tbody>
          {trades.map((t: any) => (
            <tr key={t.id} className="border-t border-border">
              <td className="p-2">{new Date(t.created_at).toLocaleString([], { hour: "2-digit", minute: "2-digit", month: "short", day: "numeric" })}</td>
              <td className="p-2 font-mono">{t.ticker}</td>
              <td className="p-2"><span className={t.side === "YES" ? "text-emerald-400" : "text-red-400"}>{dirLabel(t.side)}</span></td>
              <td className="p-2 text-right">{t.strike ? fmt$(Number(t.strike)) : "—"}</td>
              <td className="p-2 text-right">{t.spot_at_entry ? fmt$(Number(t.spot_at_entry)) : "—"}</td>
              <td className="p-2 text-right">{t.model_prob != null ? (Number(t.model_prob)*100).toFixed(1) + "%" : "—"}</td>
              <td className="p-2 text-right">{t.edge_pts != null ? (Number(t.edge_pts) >= 0 ? "+" : "") + Number(t.edge_pts).toFixed(1) : "—"}</td>
              <td className="p-2 text-right">{t.contracts}</td>
              <td className="p-2 text-right">{fmt$(Number(t.stake_usd || 0))}</td>
              <td className="p-2">
                {t.status === "submitted" && <span className="inline-flex items-center gap-1 text-emerald-400"><CheckCircle2 className="h-3 w-3" />submitted</span>}
                {t.status === "settled" && (Number(t.pnl_usd ?? 0) >= 0
                  ? <span className="inline-flex items-center gap-1 text-emerald-400 font-bold">WIN</span>
                  : <span className="inline-flex items-center gap-1 text-red-400 font-bold">LOSS</span>)}
                {t.status === "closed" && <span className="text-yellow-400">closed</span>}
                {t.status === "error" && <span className="inline-flex items-center gap-1 text-red-400" title={t.error}><XCircle className="h-3 w-3" />error</span>}
                {t.status === "pending" && <span className="text-yellow-400">pending</span>}
                {!["submitted","settled","closed","error","pending"].includes(t.status) && <span>{t.status}</span>}
              </td>
              <td className="p-2 text-right">{t.pnl_usd != null ? <span className={Number(t.pnl_usd) >= 0 ? "text-emerald-400" : "text-red-400"}>{Number(t.pnl_usd) >= 0 ? "+" : ""}{fmt$(Number(t.pnl_usd))}</span> : "—"}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function fmtProb(p: number | null | undefined): string {
  if (p == null || !Number.isFinite(p)) return "—";
  return (p * 100).toFixed(1) + "¢";
}
function buildTripleWindowTooltip(r: TripleWindowRow): string {
  const win = (label: string, o: number | null, c: number | null, avg: number | null, mn: number | null, mx: number | null, n: number | null, tr: string | null, cv: string | null, cs: number | null) => {
    const strengthPct = cs != null ? Math.round(cs * 100) + "%" : "—";
    return `${label}: open ${fmtProb(o)} → close ${fmtProb(c)} · avg ${fmtProb(avg)} · min ${fmtProb(mn)} / max ${fmtProb(mx)} · n=${n ?? 0} · trend ${tr ?? "—"} · chart ${cv ?? "—"} (${strengthPct})`;
  };
  const combined = r.combined_dir
    ? `${r.combined_dir} · conf ${r.combined_conf != null ? Math.round(r.combined_conf * 100) + "%" : "—"}`
    : "—";
  let resultLine = "Result: pending";
  if (r.actual_outcome) {
    const ev = r.expiration_value != null ? ` @ $${Number(r.expiration_value).toLocaleString()}` : "";
    const hit = r.combined_dir && r.combined_dir === r.actual_outcome ? "✓ HIT" : r.combined_dir ? "✗ MISS" : "—";
    resultLine = `Result: ${r.actual_outcome}${ev} · Combined ${hit}`;
  }
  return [
    "Polymarket 5m Up/Down + Binance chart · 3-window shadow log",
    "",
    win("W1 (T-15→T-10)", r.w1_open_prob, r.w1_close_prob, r.w1_avg_prob, r.w1_min_prob, r.w1_max_prob, r.w1_samples, r.w1_trendline_dir, r.w1_chart_verdict, r.w1_chart_strength),
    win("W2 (T-10→T-5) ", r.w2_open_prob, r.w2_close_prob, r.w2_avg_prob, r.w2_min_prob, r.w2_max_prob, r.w2_samples, r.w2_trendline_dir, r.w2_chart_verdict, r.w2_chart_strength),
    win("W3 (T-5→T-0)  ", r.w3_open_prob, r.w3_close_prob, r.w3_avg_prob, r.w3_min_prob, r.w3_max_prob, r.w3_samples, r.w3_trendline_dir, r.w3_chart_verdict, r.w3_chart_strength),
    "",
    `Combined: ${combined} · 1m trend ${r.trendline_1m ?? "—"} · 5m trend ${r.trendline_5m ?? "—"}`,
    resultLine,
  ].join("\n");
}

function ModelAccuracyPanel() {
  const fn = useServerFn(getPredictionStats);
  const q = useQuery({
    queryKey: ["btc-pred-stats"],
    queryFn: () => fn(),
    refetchInterval: 60_000,
    staleTime: 30_000,
    placeholderData: (prev) => prev,
  });
  const s = q.data;

  // Live auto-trade green-hour stats (real fires from auto_trade_orders,
  // fresh cutoff — replaces the misleading raw-model green-hour subset).
  const greenStatsFn = useServerFn(getAutoTradeGreenStats);
  const greenStatsQ = useQuery({
    queryKey: ["auto-trade-green-stats"],
    queryFn: () => greenStatsFn(),
    refetchInterval: 60_000,
    staleTime: 30_000,
    placeholderData: (prev) => prev,
  });
  const gs = greenStatsQ.data;

  // Locked PRED verdicts. Merges server-persisted locks (device-independent,
  // durable) with localStorage locks (fast/instant), giving server precedence
  // when both exist for the same ticker.
  const [predVerdicts, setPredVerdicts] = useState<Record<string, PredLockedRecord>>({});
  const listPredLocksFn = useServerFn(listPredLocks);
  const predLocksQ = useQuery({
    queryKey: ["pred-locks"],
    queryFn: () => listPredLocksFn(),
    refetchInterval: 60_000,
    staleTime: 30_000,
  });
  useEffect(() => {
    const local = readPredVerdicts();
    const serverRows = predLocksQ.data?.rows ?? [];
    const merged: Record<string, PredLockedRecord> = { ...local };
    for (const row of serverRows) {
      const action = (row.side ?? "SKIP") as "UP" | "DOWN" | "SKIP";
      const v2Action = ((row.v2_action ?? row.side) ?? "SKIP") as "UP" | "DOWN" | "SKIP";
      merged[row.ticker] = {
        action,
        ask: Number(row.ask ?? 0),
        edge: Number(row.edge ?? 0),
        reasons: [],
        lockedAt: row.locked_at ? new Date(row.locked_at).getTime() : Date.now(),
        taScore: undefined,
        v2Action,
        v2Reasons: row.v2_reason ? String(row.v2_reason).split(",") : [],
      };
    }
    setPredVerdicts(merged);
  }, [predLocksQ.data]);
  useEffect(() => {
    const refresh = () => {
      const local = readPredVerdicts();
      setPredVerdicts((prev) => ({ ...prev, ...local }));
    };
    const onStorage = (e: StorageEvent) => { if (e.key === PRED_BET_LS_VERDICTS) refresh(); };
    window.addEventListener("storage", onStorage);
    window.addEventListener("crypto.predBet.verdicts.updated", refresh as EventListener);
    return () => {
      window.removeEventListener("storage", onStorage);
      window.removeEventListener("crypto.predBet.verdicts.updated", refresh as EventListener);
    };
  }, []);

  const listTripleFn = useServerFn(listTripleWindows);
  // Only refetch triple-window when the SET of tickers changes, not on every stats poll.
  const tickers = useMemo(() => (s?.recent ?? []).map(r => r.ticker), [s]);
  const tickersKey = useMemo(() => [...tickers].sort().join(","), [tickers]);
  const twQ = useQuery({
    queryKey: ["btc-triple-window", tickersKey],
    queryFn: () => listTripleFn({ data: { tickers } }),
    enabled: tickers.length > 0,
    refetchInterval: 60_000,
    staleTime: 30_000,
    placeholderData: (prev) => prev,
  });
  const twMap = useMemo(() => {
    const m = new Map<string, TripleWindowRow>();
    for (const row of twQ.data?.rows ?? []) m.set(row.kalshi_ticker, row);
    return m;
  }, [twQ.data]);


  const pct = (n: number) => (n * 100).toFixed(1) + "%";
  const Cell = ({ label, value, sub }: { label: string; value: React.ReactNode; sub?: React.ReactNode }) => (
    <div className="px-3 py-2">
      <div className="text-[10px] uppercase tracking-wider text-muted-foreground">{label}</div>
      <div className="text-lg font-bold font-mono">{value}</div>
      {sub && <div className="text-[10px] text-muted-foreground">{sub}</div>}
    </div>
  );

  // ---- PRED action per row: prefer the locked verdict (persisted by
  // PredBetPanel), else fall back to the live formula for historical rows
  // never seen while their window was open.
  const predActionFor = (r: { ticker: string; side: "YES" | "NO"; modelProb: number; marketYesPrice: number; edgePts: number; liveSide: "YES" | "NO" | null; }): "UP" | "DOWN" | "SKIP" => {
    const locked = predVerdicts[r.ticker];
    if (locked) return locked.action;
    // Fallback for rows never seen while their window was open — mirror the
    // LIVE PredBetPanel gate exactly (edge, ask band, flip, side-confidence).
    const sideAsk = r.side === "YES" ? r.marketYesPrice : 1 - r.marketYesPrice;
    const sideConf = r.side === "YES" ? r.modelProb : 1 - r.modelProb;
    const edgeOk = Math.abs(r.edgePts) >= PRED_MIN_EDGE_ABS;
    const askOk = sideAsk >= PRED_MIN_ASK && sideAsk <= PRED_MAX_ASK;
    const flipOk = !r.liveSide || r.liveSide === r.side;
    const confOk = sideConf >= PRED_MIN_SIDE_CONF;
    if (edgeOk && askOk && flipOk && confOk) return r.side === "YES" ? "UP" : "DOWN";
    return "SKIP";
  };
  // WIN iff PRED action matches which side actually settled. SKIP → null.
  const predResultFor = (r: { ticker: string; side: "YES" | "NO"; modelProb: number; marketYesPrice: number; edgePts: number; liveSide: "YES" | "NO" | null; wasCorrect: boolean | null; }): boolean | null => {
    if (r.wasCorrect == null) return null;
    const action = predActionFor(r);
    if (action === "SKIP") return null;
    const yesWon = (r.side === "YES" && r.wasCorrect === true) || (r.side === "NO" && r.wasCorrect === false);
    return action === "UP" ? yesWon : !yesWon;
  };

  // ---- PRED v2 (SHADOW, TA-align filter) ------------------------------
  // v2 only exists for tickers that were locked while open (chart verdict
  // captured). Historical rows w/o a locked record return SKIP so they
  // don't pollute v2 win-rate math.
  const predV2ActionFor = (r: { ticker: string }): "UP" | "DOWN" | "SKIP" => {
    const locked = predVerdicts[r.ticker];
    return locked?.v2Action ?? "SKIP";
  };
  const predV2ResultFor = (r: { ticker: string; side: "YES" | "NO"; wasCorrect: boolean | null }): boolean | null => {
    if (r.wasCorrect == null) return null;
    const action = predV2ActionFor(r);
    if (action === "SKIP") return null;
    const yesWon = (r.side === "YES" && r.wasCorrect === true) || (r.side === "NO" && r.wasCorrect === false);
    return action === "UP" ? yesWon : !yesWon;
  };


  return (
    <div className="border border-border rounded-lg bg-card">
      <div className="px-4 py-2 border-b border-border flex items-center justify-between">
        <h2 className="text-sm uppercase tracking-wider text-muted-foreground">Model accuracy (all predictions — bet or not)</h2>
        {q.isFetching && <Loader2 className="h-3 w-3 animate-spin text-muted-foreground" />}
      </div>
      {!s ? (
        <div className="p-6 text-center text-sm text-muted-foreground">
          {q.isLoading ? "Loading…" : "No predictions tracked yet. Refresh the page in a few minutes."}
        </div>
      ) : (
        <>
          {(() => {
            const last20 = s.recent
              .filter(r => r.wasCorrect !== null && r.settledAt)
              .slice()
              .sort((a, b) => (b.settledAt ?? "").localeCompare(a.settledAt ?? ""))
              .slice(0, 20);
            const wins20 = last20.reduce((n, r) => n + (r.wasCorrect === true ? 1 : 0), 0);
            const losses20 = last20.reduce((n, r) => n + (r.wasCorrect === false ? 1 : 0), 0);
            // Streak analysis across ALL settled (most recent first).
            const settledDesc = s.recent
              .filter(r => r.wasCorrect !== null && r.settledAt)
              .slice()
              .sort((a, b) => (b.settledAt ?? "").localeCompare(a.settledAt ?? ""));
            let currentStreak = 0;
            for (const r of settledDesc) {
              if (r.wasCorrect === true) currentStreak++;
              else break;
            }
            let longestStreak = 0;
            let run = 0;
            for (const r of settledDesc) {
              if (r.wasCorrect === true) { run++; if (run > longestStreak) longestStreak = run; }
              else run = 0;
            }
            // ---- Green-hour subset now sourced from LIVE auto_trade_orders (gs).
            // Fresh cutoff — see getAutoTradeGreenStats.
            return (
          <>
          <div className="grid grid-cols-2 md:grid-cols-8 divide-x divide-border">
            <Cell label="Tracked (7d)" value={String(s.total)} sub={`${s.settled} settled`} />
            <Cell label="Correct (7d)" value={`${s.correct} / ${s.settled}`} />
            <Cell
              label="Win rate (7d)"
              value={s.settled ? pct(s.winRate) : "—"}
              sub={s.settled ? (s.winRate >= 0.5 ? "above coin flip" : "below coin flip") : ""}
            />
            <Cell
              label="Win rate (24h)"
              value={s.byWindow.last24h.settled ? pct(s.byWindow.last24h.winRate) : "—"}
              sub={`${s.byWindow.last24h.correct}/${s.byWindow.last24h.settled}`}
            />
            <Cell
              label="Win rate (12h)"
              value={s.byWindow.last12h.settled ? pct(s.byWindow.last12h.winRate) : "—"}
              sub={`${s.byWindow.last12h.correct}/${s.byWindow.last12h.settled}`}
            />
            <Cell
              label={`Last ${last20.length} settled`}
              value={last20.length ? (
                <span>
                  <span className="font-bold text-emerald-400">{wins20}W</span>
                  <span className="text-muted-foreground"> / </span>
                  <span className="font-bold text-red-400">{losses20}L</span>
                </span>
              ) : "—"}
              sub={last20.length ? `${pct(wins20 / last20.length)} · of last ${last20.length}` : "not enough settled"}
            />

            <Cell
              label="Win streak"
              value={
                <span>
                  <span className="font-bold text-emerald-400">{currentStreak}W</span>
                  {currentStreak > 0 && <span className="text-muted-foreground text-xs ml-1">🔥</span>}
                </span>
              }
              sub={longestStreak > 0 ? `best: ${longestStreak}W (7d)` : "no wins yet"}
            />

            <Cell
              label="Awaiting settle"
              value={String(s.total - s.settled)}
              sub="close time passed but BTC price pending"
            />
          </div>

          <div className="border-t border-border">
            <div
              className="px-3 py-1.5 text-[10px] uppercase tracking-wider text-muted-foreground bg-muted/10"
              title="LIVE auto-trade fires only (auto_trade_orders, mode=live, settled) — filtered to green hours (UTC 08/11/12/16/19–22). Fresh cutoff starting 2026-07-21."
            >
              🟢 Auto-Trade LIVE fires (green hours · since {gs ? new Date(gs.cutoffIso).toISOString().slice(0, 10) : "…"})
            </div>
            {!gs ? (
              <div className="p-4 text-xs text-muted-foreground">Loading live fires…</div>
            ) : (
              <div className="grid grid-cols-2 md:grid-cols-8 divide-x divide-border">
                <Cell label="Fires (settled)" value={String(gs.settled)} sub={`${gs.totalFires} total`} />
                <Cell label="W / L" value={`${gs.wins} / ${gs.losses}`} />
                <Cell
                  label="Win rate"
                  value={gs.winRate != null ? pct(gs.winRate) : "—"}
                  sub={gs.winRate != null ? (gs.winRate >= 0.7 ? "target ≥70%" : gs.winRate >= 0.55 ? "above kill-switch" : "kill-switch risk") : ""}
                />
                <Cell
                  label="Win rate (24h)"
                  value={gs.last24hFires ? pct(gs.last24hWins / gs.last24hFires) : "—"}
                  sub={`${gs.last24hWins}/${gs.last24hFires}`}
                />
                <Cell
                  label={`Last ${gs.last20.length} fires`}
                  value={gs.last20.length ? (
                    <span>
                      <span className="font-bold text-emerald-400">{gs.last20.filter(r => r.won).length}W</span>
                      <span className="text-muted-foreground"> / </span>
                      <span className="font-bold text-red-400">{gs.last20.filter(r => !r.won).length}L</span>
                    </span>
                  ) : "—"}
                  sub={gs.last20.length ? `${pct(gs.last20.filter(r => r.won).length / gs.last20.length)} · of last ${gs.last20.length}` : "no fires yet"}
                />
                <Cell
                  label="Win streak"
                  value={
                    <span>
                      <span className="font-bold text-emerald-400">{gs.streak}W</span>
                      {gs.streak > 0 && <span className="text-muted-foreground text-xs ml-1">🔥</span>}
                    </span>
                  }
                  sub="consecutive live wins"
                />
                <Cell
                  label="P/L (real)"
                  value={
                    <span className={gs.pnlUsd >= 0 ? "text-emerald-400" : "text-red-400"}>
                      {gs.settled ? `${gs.pnlUsd >= 0 ? "+" : ""}$${gs.pnlUsd.toFixed(2)}` : "—"}
                    </span>
                  }
                  sub={`24h: ${gs.last24hPnlUsd >= 0 ? "+" : ""}$${gs.last24hPnlUsd.toFixed(2)}`}
                />
                <Cell
                  label="Kill-switch"
                  value={
                    gs.killSwitch === "PAUSE"
                      ? <span className="text-red-400">PAUSE</span>
                      : gs.killSwitch === "LIVE"
                        ? <span className="text-emerald-400">LIVE</span>
                        : <span className="text-muted-foreground">warm-up</span>
                  }
                  sub={gs.settled >= 20 ? "≥55% WR to stay live" : `${gs.settled}/20 fires`}
                />
              </div>
            )}
          </div>
          </>
            );
          })()}

          {(() => {
            const now = Date.now();
            const h24 = now - 24 * 3600e3;
            const h12 = now - 12 * 3600e3;
            const settledDesc = s.recent
              .filter(r => r.wasCorrect !== null && r.settledAt)
              .slice()
              .sort((a, b) => (b.settledAt ?? "").localeCompare(a.settledAt ?? ""));
            let fires = 0, wins = 0, losses = 0, skipped = 0;
            let w24 = 0, l24 = 0, w12 = 0, l12 = 0;
            const results: boolean[] = [];
            for (const r of settledDesc) {
              const action = predActionFor(r);
              if (action === "SKIP") { skipped++; continue; }
              const res = predResultFor(r);
              if (res == null) continue;
              fires++;
              if (res) wins++; else losses++;
              const t = new Date(r.settledAt!).getTime();
              if (t >= h24) { if (res) w24++; else l24++; }
              if (t >= h12) { if (res) w12++; else l12++; }
              results.push(res);
            }
            const last20 = results.slice(0, 20);
            const w20 = last20.filter(Boolean).length;
            const l20 = last20.length - w20;
            let cur = 0;
            for (const x of results) { if (x) cur++; else break; }
            let best = 0, run = 0;
            for (const x of results) { if (x) { run++; if (run > best) best = run; } else run = 0; }
            const settled24 = w24 + l24;
            const settled12 = w12 + l12;

            // ---- PRED v2 shadow tally (TA-align, live-locked rows only) ----
            let v2Fires = 0, v2Wins = 0, v2Losses = 0, v2SkipsFromBase = 0, v2SkipsFromTa = 0;
            for (const r of settledDesc) {
              const locked = predVerdicts[r.ticker];
              if (!locked?.v2Action) continue; // no live lock → not part of v2 sample
              if (locked.v2Action === "SKIP") {
                if (locked.action === "SKIP") v2SkipsFromBase++; else v2SkipsFromTa++;
                continue;
              }
              const res = predV2ResultFor(r);
              if (res == null) continue;
              v2Fires++;
              if (res) v2Wins++; else v2Losses++;
            }
            return (
              <div className="border-t border-border">
                <div className="px-3 py-1.5 text-[10px] uppercase tracking-wider text-muted-foreground bg-muted/10">
                  PRED accuracy (fires only · SKIPs excluded)
                </div>
                <div className="grid grid-cols-2 md:grid-cols-8 divide-x divide-border">
                  <Cell label="PRED fires (7d)" value={String(fires)} sub={`${skipped} skipped`} />
                  <Cell label="Correct (7d)" value={`${wins} / ${fires}`} />
                  <Cell
                    label="Win rate (7d)"
                    value={fires ? pct(wins / fires) : "—"}
                    sub={fires ? (wins / fires >= 0.5 ? "above coin flip" : "below coin flip") : ""}
                  />
                  <Cell
                    label="Win rate (24h)"
                    value={settled24 ? pct(w24 / settled24) : "—"}
                    sub={`${w24}/${settled24}`}
                  />
                  <Cell
                    label="Win rate (12h)"
                    value={settled12 ? pct(w12 / settled12) : "—"}
                    sub={`${w12}/${settled12}`}
                  />
                  <Cell
                    label={`Last ${last20.length} fires`}
                    value={last20.length ? (
                      <span>
                        <span className="font-bold text-emerald-400">{w20}W</span>
                        <span className="text-muted-foreground"> / </span>
                        <span className="font-bold text-red-400">{l20}L</span>
                      </span>
                    ) : "—"}
                    sub={last20.length ? `${pct(w20 / last20.length)} · of last ${last20.length}` : "not enough fires"}
                  />
                  <Cell
                    label="PRED streak"
                    value={
                      <span>
                        <span className="font-bold text-emerald-400">{cur}W</span>
                        {cur > 0 && <span className="text-muted-foreground text-xs ml-1">🔥</span>}
                      </span>
                    }
                    sub={best > 0 ? `best: ${best}W (7d)` : "no wins yet"}
                  />
                  <Cell
                    label="Est P/L ($10)"
                    value={
                      <span className={wins - losses >= 0 ? "text-emerald-400" : "text-red-400"}>
                        {fires ? `${(wins * 10 * 0.45 - losses * 10) >= 0 ? "+" : ""}$${(wins * 10 * 0.45 - losses * 10).toFixed(0)}` : "—"}
                      </span>
                    }
                    sub="rough: 45¢ avg win"
                  />
                </div>
                <div className="px-3 py-1.5 text-[10px] uppercase tracking-wider text-muted-foreground bg-muted/5 border-t border-border flex items-center gap-3 flex-wrap">
                  <span>🧪 PRED v2 shadow (TA-align)</span>
                  <span className="normal-case text-muted-foreground/80">
                    fires <span className="font-mono text-foreground">{v2Fires}</span>
                    {" · "}wr <span className="font-mono text-foreground">{v2Fires ? pct(v2Wins / v2Fires) : "—"}</span>
                    {" · "}<span className="text-emerald-400 font-mono">{v2Wins}W</span>
                    {" / "}<span className="text-red-400 font-mono">{v2Losses}L</span>
                    {" · "}filtered by TA <span className="font-mono text-foreground">{v2SkipsFromTa}</span>
                    {" · "}base SKIPs <span className="font-mono text-foreground">{v2SkipsFromBase}</span>
                    {" · "}vs base PRED wr <span className="font-mono text-foreground">{fires ? pct(wins / fires) : "—"}</span>
                    {v2Fires < 20 && <span className="ml-2 text-amber-500/80">· need ~50 fires for signal</span>}
                  </span>
                </div>
              </div>
            );
          })()}

          {s.recent.length > 0 && (
            <div className="border-t border-border">
              <div className="px-3 py-1.5 text-[10px] uppercase tracking-wider text-muted-foreground bg-muted/10 flex items-center justify-between">
                <span>Recent predictions · {s.recent.length} entries</span>
                <span>scroll for more ↓</span>
              </div>
              <div className="max-h-[420px] overflow-y-auto overflow-x-auto">
                <table className="w-full text-xs">
                  <thead className="bg-muted/30 text-muted-foreground uppercase tracking-wider sticky top-0 z-10">
                    <tr>
                      <th className="text-left p-2">Closed</th>
                      <th className="text-left p-2">Ticker</th>
                      <th className="text-left p-2" title="Study Pick — locked side after the 420s Strike Study. On Study/Model disagreement the side leans to Study. This is now the pick compared to settlement.">Study Pick</th>
                      <th className="text-left p-2" title="Model Pick — the original raw model pick (p ≥ 50%) frozen at the first snapshot. Never overwritten by Study/Fight. This is the classic model pick shown for a long time.">Model Pick</th>
                      <th className="text-left p-2" title="Raw model direction (live): P(YES) ≥ 50%? Updates with the current tick — no longer the win/loss comparator.">Raw model</th>
                      {/* Live column hidden (kept in data model) */}
                      <th className="text-right p-2">Strike</th>
                      <th className="text-right p-2">Model%</th>
                      <th className="text-right p-2">Market¢</th>
                      <th className="text-right p-2">Edge</th>
                      <th className="text-right p-2">Settle</th>
                      <th className="text-center p-2" title="Study Pick vs actual settle. WIN = Study Pick matched settled side.">Result</th>
                    </tr>
                  </thead>

                  <tbody>
                    {s.recent.map((r) => {
                      const rawSide: "YES" | "NO" = r.modelProb >= 0.5 ? "YES" : "NO";
                      // Raw dir wins if settle direction matches rawSide's direction.
                      // We infer from wasCorrect + side agreement: raw wins iff (side===rawSide ? wasCorrect : !wasCorrect).
                      const rawCorrect: boolean | null = r.wasCorrect == null
                        ? null
                        : (r.side === rawSide ? r.wasCorrect : !r.wasCorrect);
                      // Suppress Study Pick / Raw model display while the window is still
                      // inside the 420s Strike Study warm-up (side hasn't locked yet).
                      const windowOpenMs = new Date(r.closeTime).getTime() - 15 * 60_000;
                      const msSinceOpen = Date.now() - windowOpenMs;
                      const isStudying = msSinceOpen >= 0 && msSinceOpen < 420_000;
                      return (
                      <tr key={r.ticker} className="border-t border-border transition-all duration-150 ease-out hover:bg-primary/10 hover:shadow-[inset_2px_0_0_hsl(var(--primary))] hover:scale-[1.005] hover:relative hover:z-10">
                        <td className="p-2">{new Date(r.closeTime).toLocaleString([], { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" })}</td>
                        <td className="p-2 font-mono">{r.ticker}</td>
                        <td className="p-2">
                          {isStudying ? (
                            <span className="text-muted-foreground text-[10px]" title="Strike Study in progress · Study Pick locks at T+420s (min 7)">⏳ STUDYING</span>
                          ) : (
                            <span className={r.side === "YES" ? "text-emerald-400" : "text-red-400"} title="Study Pick — locked after 420s study; leans to Study on Study/Model disagreement">{dirLabel(r.side)}</span>
                          )}
                        </td>
                        <td className="p-2">
                          {(() => {
                            const mp = (r as { modelSidePreStudy?: "YES" | "NO" | null }).modelSidePreStudy ?? r.side;
                            const mpCorrect: boolean | null = r.wasCorrect == null
                              ? null
                              : (r.side === mp ? r.wasCorrect : !r.wasCorrect);
                            return (
                              <>
                                <span className={mp === "YES" ? "text-emerald-400" : "text-red-400"} title="Model Pick — original raw model side frozen at first snapshot; never overridden by Study">{dirLabel(mp)}</span>
                                {mpCorrect === true && <span className="ml-1 text-[10px] text-emerald-400">✓</span>}
                                {mpCorrect === false && <span className="ml-1 text-[10px] text-red-400">✗</span>}
                              </>
                            );
                          })()}
                        </td>
                        <td className="p-2">
                          {isStudying ? (
                            <span className="text-muted-foreground text-[10px]">—</span>
                          ) : (
                            <>
                              <span className={rawSide === "YES" ? "text-emerald-400" : "text-red-400"}>{dirLabel(rawSide)}</span>
                              {rawCorrect === true && <span className="ml-1 text-[10px] text-emerald-400">✓</span>}
                              {rawCorrect === false && <span className="ml-1 text-[10px] text-red-400">✗</span>}
                            </>
                          )}
                        </td>
                        <td className="p-2 text-right">{fmt$(r.strike)}</td>
                        <td className="p-2 text-right">{(r.modelProb * 100).toFixed(1)}%</td>
                        <td className="p-2 text-right">{(r.marketYesPrice * 100).toFixed(0)}</td>
                        <td className="p-2 text-right">{r.edgePts >= 0 ? "+" : ""}{r.edgePts.toFixed(1)}</td>
                        <td className="p-2 text-right">{r.settlePrice != null ? fmt$(r.settlePrice) : "—"}</td>
                        <td className="p-2 text-center">
                          {r.wasCorrect === true && <span className="inline-flex items-center gap-1 text-emerald-400"><CheckCircle2 className="h-3 w-3" />WIN</span>}
                          {r.wasCorrect === false && <span className="inline-flex items-center gap-1 text-red-400"><XCircle className="h-3 w-3" />LOSS</span>}
                          {r.wasCorrect === null && <span className="text-muted-foreground">pending</span>}
                        </td>
                      </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
}

// ============================================================
// Model Bet: flat auto-bet ($10 default, user-editable) that fires
// ONCE per new model prediction, on the exact Value-pick side (r.side).
// No gates, no reverse, no confidence filter, no martingale.
// Mutually exclusive with Auto-Odds and Auto-Martingale — turning
// this ON forces the other two OFF via a shared mutex event.
// ============================================================
const MODEL_BET_DEFAULT_STAKE = 10;
const MODEL_BET_MIN_STAKE = 1;
const MODEL_BET_MAX_STAKE = 500;
const MODEL_BET_LS_ENABLED = "crypto.modelBet";
const MODEL_BET_LS_STAKE = "crypto.modelBet.stake";
const MODEL_BET_LS_TICKERS = "crypto.modelBet.tickers";
const AUTO_BET_MUTEX_EVENT = "crypto.autoBet.mutex";

export function ModelBetPanel() {
  const runFn = useServerFn(runAutoTrade);
  const statsFn = useServerFn(getPredictionStats);
  const statsQ = useQuery({ queryKey: ["btc-pred-stats"], queryFn: () => statsFn(), refetchInterval: 60_000 });

  const [enabled, setEnabled] = useState<boolean>(() => {
    if (typeof window === "undefined") return false;
    return window.localStorage.getItem(MODEL_BET_LS_ENABLED) === "on";
  });
  const stake = MODEL_BET_DEFAULT_STAKE;
  const [firing, setFiring] = useState(false);
  const [lastFired, setLastFired] = useState<string | null>(null);

  useEffect(() => {
    if (typeof window === "undefined") return;
    window.localStorage.setItem(MODEL_BET_LS_STAKE, String(stake));
  }, [stake]);


  useEffect(() => {
    if (typeof window === "undefined") return;
    window.localStorage.setItem(MODEL_BET_LS_ENABLED, enabled ? "on" : "off");
    // Mirror to DB so server-side auto-model-bet tick sees this user's state.
    (async () => {
      try {
        const { data: u } = await supabase.auth.getUser();
        const uid = u?.user?.id;
        if (!uid) return;
        if (enabled) {
          await supabase.from("auto_odds_settings").upsert({
            user_id: uid,
            enabled: true,
            auto_button_type: "model_bet",
            stopped_reason: null,
          }, { onConflict: "user_id" });
        } else {
          await supabase.from("auto_odds_settings")
            .update({ enabled: false })
            .eq("user_id", uid)
            .eq("auto_button_type", "model_bet");
        }
      } catch { /* non-fatal */ }
    })();
  }, [enabled]);

  const persistEnabled = async (on: boolean) => {
    try {
      const { data: u } = await supabase.auth.getUser();
      const uid = u?.user?.id;
      if (!uid) return;
      if (on) {
        await supabase.from("auto_odds_settings").upsert({
          user_id: uid,
          enabled: true,
          auto_button_type: "model_bet",
          stopped_reason: null,
        }, { onConflict: "user_id" });
      } else {
        // Only clear when this row belongs to Model Bet; never touch odds_bet rows.
        await supabase.from("auto_odds_settings")
          .update({ enabled: false })
          .eq("user_id", uid)
          .eq("auto_button_type", "model_bet");
      }
    } catch { /* non-fatal; local loop still runs */ }
  };

  const toggleOn = () => {
    if (typeof window !== "undefined") {
      window.localStorage.setItem("crypto.autoOdds", "off");
      window.localStorage.setItem("crypto.autoMart", "off");
      window.dispatchEvent(new CustomEvent(AUTO_BET_MUTEX_EVENT, { detail: "modelBet" }));
    }
    setEnabled(true);
    void persistEnabled(true);
    toast.success(`Model Bet ON · $${stake} per prediction (Value pick side)`);
  };
  const toggleOff = () => {
    setEnabled(false);
    void persistEnabled(false);
    toast.info("Model Bet OFF");
  };

  useEffect(() => {
    const onMutex = (e: Event) => {
      const which = (e as CustomEvent).detail;
      if (which && which !== "modelBet" && typeof window !== "undefined") {
        if (window.localStorage.getItem(MODEL_BET_LS_ENABLED) === "on") {
          window.localStorage.setItem(MODEL_BET_LS_ENABLED, "off");
        }
        setEnabled(false);
      }
    };
    window.addEventListener(AUTO_BET_MUTEX_EVENT, onMutex as EventListener);
    return () => window.removeEventListener(AUTO_BET_MUTEX_EVENT, onMutex as EventListener);
  }, []);

  useEffect(() => {
    // Always-on paper auto-runner — fires regardless of the Model Bet toggle
    // because all 3 bet buttons are locked to mode:"paper" and touch no real money.
    if (typeof window === "undefined") return;
    let cancelled = false;
    let inFlight = false;

    const readProcessed = (): string[] => {
      try {
        const raw = window.localStorage.getItem(MODEL_BET_LS_TICKERS);
        return raw ? JSON.parse(raw) : [];
      } catch { return []; }
    };
    const writeProcessed = (arr: string[]) => {
      try { window.localStorage.setItem(MODEL_BET_LS_TICKERS, JSON.stringify(arr.slice(-100))); } catch { /* ignore */ }
    };

    const tick = async () => {
      if (cancelled || inFlight) return;
      const s = statsQ.data;
      if (!s) return;
      const now = Date.now();
      const processed = new Set(readProcessed());
      const candidates = s.recent.filter(r =>
        !r.outcome &&
        new Date(r.closeTime).getTime() > now &&
        !processed.has(r.ticker)
      );
      if (candidates.length === 0) return;
      candidates.sort((a, b) => new Date(a.closeTime).getTime() - new Date(b.closeTime).getTime());
      const pick = candidates[0];
      inFlight = true;
      setFiring(true);
      processed.add(pick.ticker);
      writeProcessed(Array.from(processed));
      try {
        const res = await runFn({ data: {
          mode: "paper",
          stakeUsd: stake,
          maxOrders: 1,
          force: true,
          forceTicker: pick.ticker,
          forceSide: pick.side,
          maxEntryCents: 79,
          skipLadder: true,
        } });

        if (res.placed > 0 && res.orders?.[0]) {
          const o = res.orders[0];
          try { playModelBetPing(); } catch { /* noop */ }
          toast.success(`Model Bet $${stake}: ${pick.side === "YES" ? "UP" : "DOWN"} ${pick.ticker} @ ${o.limit_cents}¢`);
          setLastFired(`${pick.ticker} ${pick.side} @ ${o.limit_cents}¢`);
          try {
            const r = await recordPaperFire({ data: {
              ticker: o.ticker, closeTime: o.close_time, button: "model",
              side: o.side, contracts: o.contracts, fillPriceCents: o.limit_cents,
              snapshot: { edge: pick.edgePts, prob: pick.modelProb, sideConf: (pick as any).sideConfidence ?? null },
            }});
            if (!r.ok) toast.warning(`Paper: ${r.reason}`);
          } catch (e: any) { /* silent — trade still logged in auto_trade_orders */ }
        } else {
          const realReasons = (res.skipReasons ?? []).filter((r: string) => !/^(equity:|force:)/i.test(r));
          toast.info(`Model Bet skipped ${pick.ticker}: ${(realReasons.length ? realReasons : res.skipReasons ?? []).slice(0, 2).join(" · ") || "no fill"}`);
        }
      } catch (e: any) {
        toast.error(`Model Bet failed ${pick.ticker}`, { description: e?.message ?? String(e) });
      } finally {
        inFlight = false;
        setFiring(false);
      }
    };

    tick();
    const h = setInterval(tick, 5_000);
    return () => { cancelled = true; clearInterval(h); };
  }, [enabled, statsQ.data, runFn]);

  return (
    <div className="border border-border rounded-lg bg-card">
      <div className="px-4 py-3 flex items-center justify-between gap-3 flex-wrap">
        <div className="flex items-center gap-3">
          <button
            onClick={enabled ? toggleOff : toggleOn}
            className={`text-xs font-semibold px-3 py-1.5 rounded border flex items-center gap-1.5 ${enabled ? "border-sky-500/50 bg-sky-500/15 text-sky-300" : "border-border bg-muted/30 hover:bg-muted/50"}`}
          >
            <span className={`h-1.5 w-1.5 rounded-full ${enabled ? "bg-sky-400 animate-pulse" : "bg-muted-foreground"}`} />
            {enabled ? `Model Bet ON · $${stake}` : `Model Bet OFF · $${stake}`}
          </button>
          <span className="text-[11px] text-muted-foreground">
            Fixed $10 stake · fires on every new model prediction (entry ≤ 79¢) · one bet per ticker
          </span>

        </div>
        <div className="flex items-center gap-2 text-[11px] text-muted-foreground">
          {firing && <Loader2 className="h-3 w-3 animate-spin" />}
          {lastFired && <span>last: {lastFired}</span>}
        </div>
      </div>
    </div>
  );
}


// ============================================================
// PRED BET — sibling to Model Bet, uses ONLY the two signals
// the accuracy-log studies proved carry real edge:
//   1) value pick = model raw_dir side
//   2) edge target: |edge_pts| >= 3  AND  side_ask in 50–78¢
// One bet per ticker · $10 flat · hold to settle (skipLadder).
// Mutually exclusive with Model Bet / Auto-Odds / Auto-Mart.
// ============================================================
const PRED_BET_LS_ENABLED = "crypto.predBet";
const PRED_BET_LS_TICKERS = "crypto.predBet.tickers";
const PRED_BET_LS_VERDICTS = "crypto.predBet.verdicts";
const PRED_BET_VERDICTS_MAX = 500;
const PRED_BET_STAKE = 10;
const PRED_MIN_EDGE_ABS = 3;
const PRED_MIN_ASK = 0.50;
const PRED_MAX_ASK = 0.78;
const PRED_MIN_SIDE_CONF = 0.70;

type PredLockedRecord = {
  action: "UP" | "DOWN" | "SKIP";
  ask: number;
  edge: number;
  reasons: string[];
  lockedAt: number;
  // ---- Shadow: PRED v2 (TA-align filter, no live behavior change) ----
  // Captures chart verdict bias at lock time so we can score TA-align
  // performance side-by-side with base PRED after ~50 fires.
  taBias?: "up" | "down" | "flat";
  taScore?: number;               // 0..100 chart verdict score at lock
  v2Action?: "UP" | "DOWN" | "SKIP";
  v2Reasons?: string[];
};

function readPredVerdicts(): Record<string, PredLockedRecord> {
  if (typeof window === "undefined") return {};
  try {
    const raw = window.localStorage.getItem(PRED_BET_LS_VERDICTS);
    return raw ? (JSON.parse(raw) as Record<string, PredLockedRecord>) : {};
  } catch { return {}; }
}

function writePredVerdict(ticker: string, rec: PredLockedRecord) {
  if (typeof window === "undefined") return;
  try {
    const all = readPredVerdicts();
    if (all[ticker]) return; // never overwrite once locked
    all[ticker] = rec;
    const entries = Object.entries(all);
    if (entries.length > PRED_BET_VERDICTS_MAX) {
      entries.sort((a, b) => (a[1].lockedAt ?? 0) - (b[1].lockedAt ?? 0));
      const trimmed = Object.fromEntries(entries.slice(-PRED_BET_VERDICTS_MAX));
      window.localStorage.setItem(PRED_BET_LS_VERDICTS, JSON.stringify(trimmed));
    } else {
      window.localStorage.setItem(PRED_BET_LS_VERDICTS, JSON.stringify(all));
    }
    window.dispatchEvent(new CustomEvent("crypto.predBet.verdicts.updated"));
  } catch { /* ignore */ }
}

export function PredBetPanel() {
  const runFn = useServerFn(runAutoTrade);
  const statsFn = useServerFn(getPredictionStats);
  const statsQ = useQuery({ queryKey: ["btc-pred-stats"], queryFn: () => statsFn(), refetchInterval: 60_000 });

  const [enabled, setEnabled] = useState<boolean>(() => {
    if (typeof window === "undefined") return false;
    return window.localStorage.getItem(PRED_BET_LS_ENABLED) === "on";
  });
  const [firing, setFiring] = useState(false);
  const [lastFired, setLastFired] = useState<string | null>(null);
  const [lastSkip, setLastSkip] = useState<string | null>(null);

  // Shadow-only: chart verdict at lock time drives PRED v2 (TA-align).
  // No influence on live PRED fires — pure logging for A/B comparison.
  const chartV = useChartVerdict();
  const taBiasNow: "up" | "down" | "flat" = !chartV.ready
    ? "flat"
    : chartV.score >= 55 ? "up"
    : chartV.score <= 45 ? "down"
    : "flat";

  // Locked verdict: snapshot the first pred-formula result for each active
  // window and hold it fixed until that window closes or a new one starts.
  const [lockedVerdict, setLockedVerdict] = useState<{ ticker: string; verdict: PredVerdict } | null>(null);

  const activeWindow = useMemo(() => {
    const s = statsQ.data;
    if (!s || !s.recent?.length) return null;
    const now = Date.now();
    return [...s.recent]
      .filter((r) => !r.outcome && new Date(r.closeTime).getTime() > now)
      .sort((a, b) => new Date(a.closeTime).getTime() - new Date(b.closeTime).getTime())[0] ?? null;
  }, [statsQ.data]);

  const computeVerdict = (r: any): PredVerdict => {
    const sideAsk = r.side === "YES" ? r.marketYesPrice : 1 - r.marketYesPrice;
    const sideConf = r.side === "YES" ? r.modelProb : 1 - r.modelProb;
    const edgeOk = Math.abs(r.edgePts) >= PRED_MIN_EDGE_ABS;
    const askOk = sideAsk >= PRED_MIN_ASK && sideAsk <= PRED_MAX_ASK;
    const flipOk = !r.liveSide || r.liveSide === r.side;
    const confOk = sideConf >= PRED_MIN_SIDE_CONF;
    if (edgeOk && askOk && flipOk && confOk) {
      return { action: (r.side === "YES" ? "UP" : "DOWN") as "UP" | "DOWN", ask: sideAsk, edge: r.edgePts, reasons: [] as string[] };
    }
    const reasons: string[] = [];
    if (!edgeOk) reasons.push(`edge ${r.edgePts.toFixed(1)}`);
    if (!askOk) reasons.push(`ask ${Math.round(sideAsk * 100)}¢`);
    if (!flipOk) reasons.push("flip");
    if (!confOk) reasons.push(`conf ${Math.round(sideConf * 100)}%`);
    return { action: "SKIP" as const, ask: sideAsk, edge: r.edgePts, reasons };
  };

  const liveVerdict = useMemo(() => activeWindow ? computeVerdict(activeWindow) : null, [activeWindow]);

  const savePredLockFn = useServerFn(savePredLock);

  useEffect(() => {
    if (!activeWindow) {
      if (lockedVerdict) setLockedVerdict(null);
      return;
    }
    if (lockedVerdict?.ticker !== activeWindow.ticker) {
      setLockedVerdict({ ticker: activeWindow.ticker, verdict: liveVerdict });
      if (liveVerdict) {
        // ---- PRED v2 (shadow): base action + TA-align filter ----
        let v2Action: "UP" | "DOWN" | "SKIP" = liveVerdict.action;
        const v2Reasons: string[] = [...liveVerdict.reasons];
        if (liveVerdict.action !== "SKIP") {
          const disagree =
            (liveVerdict.action === "UP" && taBiasNow === "down") ||
            (liveVerdict.action === "DOWN" && taBiasNow === "up");
          if (disagree) {
            v2Action = "SKIP";
            v2Reasons.push(`ta ${taBiasNow}`);
          }
        }
        writePredVerdict(activeWindow.ticker, {
          action: liveVerdict.action,
          ask: liveVerdict.ask,
          edge: liveVerdict.edge,
          reasons: liveVerdict.reasons,
          lockedAt: Date.now(),
          taBias: taBiasNow,
          taScore: chartV.ready ? chartV.score : undefined,
          v2Action,
          v2Reasons,
        });
        // Persist to server so future backtests can replay PRED/PRED v2
        // regardless of device or localStorage state. Fire-and-forget.
        const closeIso = (activeWindow as any).closeTime;
        if (closeIso) {
          void savePredLockFn({
            data: {
              ticker: activeWindow.ticker,
              window_start: new Date(closeIso).toISOString(),
              side: liveVerdict.action,
              ask: Number.isFinite(liveVerdict.ask) ? liveVerdict.ask : null,
              edge: Number.isFinite(liveVerdict.edge) ? liveVerdict.edge : null,
              side_conf: (() => {
                const p = (activeWindow as any).modelProb;
                const s = (activeWindow as any).side;
                if (typeof p !== "number") return null;
                return s === "YES" ? p : 1 - p;
              })(),
              spot: (activeWindow as any).spot ?? null,
              strike: (activeWindow as any).strike ?? null,
              v1_fired: liveVerdict.action !== "SKIP",
              v2_action: v2Action,
              v2_side: v2Action === "SKIP" ? null : v2Action,
              v2_reason: v2Reasons.join(",") || null,
              meta: {
                taBias: taBiasNow,
                taScore: chartV.ready ? chartV.score : null,
                reasons: liveVerdict.reasons,
              },
            },
          }).catch(() => { /* non-fatal */ });
        }
      }
    }
  }, [activeWindow, liveVerdict, lockedVerdict, taBiasNow, chartV.ready, chartV.score, savePredLockFn]);


  const verdict = lockedVerdict?.verdict ?? liveVerdict;

  const persistEnabled = async (on: boolean) => {
    try {
      const { data: u } = await supabase.auth.getUser();
      const uid = u?.user?.id;
      if (!uid) return;
      if (on) {
        await supabase.from("auto_odds_settings").upsert({
          user_id: uid,
          enabled: true,
          auto_button_type: "pred_bet",
          stopped_reason: null,
        }, { onConflict: "user_id" });
      } else {
        await supabase.from("auto_odds_settings")
          .update({ enabled: false })
          .eq("user_id", uid)
          .eq("auto_button_type", "pred_bet");
      }
    } catch { /* non-fatal */ }
  };

  useEffect(() => {
    if (typeof window === "undefined") return;
    window.localStorage.setItem(PRED_BET_LS_ENABLED, enabled ? "on" : "off");
  }, [enabled]);

  const toggleOn = () => {
    if (typeof window !== "undefined") {
      window.localStorage.setItem(MODEL_BET_LS_ENABLED, "off");
      window.localStorage.setItem("crypto.autoOdds", "off");
      window.localStorage.setItem("crypto.autoMart", "off");
      window.dispatchEvent(new CustomEvent(AUTO_BET_MUTEX_EVENT, { detail: "predBet" }));
    }
    setEnabled(true);
    void persistEnabled(true);
    toast.success(`PRED Bet ON · $${PRED_BET_STAKE} · edge≥${PRED_MIN_EDGE_ABS} · ask ${Math.round(PRED_MIN_ASK*100)}–${Math.round(PRED_MAX_ASK*100)}¢`);
  };
  const toggleOff = () => {
    setEnabled(false);
    void persistEnabled(false);
    toast.info("PRED Bet OFF");
  };

  useEffect(() => {
    const onMutex = (e: Event) => {
      const which = (e as CustomEvent).detail;
      if (which && which !== "predBet" && typeof window !== "undefined") {
        if (window.localStorage.getItem(PRED_BET_LS_ENABLED) === "on") {
          window.localStorage.setItem(PRED_BET_LS_ENABLED, "off");
        }
        setEnabled(false);
      }
    };
    window.addEventListener(AUTO_BET_MUTEX_EVENT, onMutex as EventListener);
    return () => window.removeEventListener(AUTO_BET_MUTEX_EVENT, onMutex as EventListener);
  }, []);

  useEffect(() => {
    // Always-on paper auto-runner for PRED (paper mode only).
    if (typeof window === "undefined") return;
    let cancelled = false;
    let inFlight = false;

    const readProcessed = (): string[] => {
      try {
        const raw = window.localStorage.getItem(PRED_BET_LS_TICKERS);
        return raw ? JSON.parse(raw) : [];
      } catch { return []; }
    };
    const writeProcessed = (arr: string[]) => {
      try { window.localStorage.setItem(PRED_BET_LS_TICKERS, JSON.stringify(arr.slice(-100))); } catch { /* ignore */ }
    };

    const tick = async () => {
      if (cancelled || inFlight) return;
      const s = statsQ.data;
      if (!s) return;
      const now = Date.now();
      const processed = new Set(readProcessed());

      const candidates = s.recent.filter(r => {
        if (r.outcome) return false;
        if (new Date(r.closeTime).getTime() <= now) return false;
        if (processed.has(r.ticker)) return false;
        if (r.liveSide && r.liveSide !== r.side) return false;
        if (Math.abs(r.edgePts) < PRED_MIN_EDGE_ABS) return false;
        const sideAsk = r.side === "YES" ? r.marketYesPrice : 1 - r.marketYesPrice;
        if (sideAsk < PRED_MIN_ASK || sideAsk > PRED_MAX_ASK) return false;
        const sideConf = r.side === "YES" ? r.modelProb : 1 - r.modelProb;
        if (sideConf < PRED_MIN_SIDE_CONF) return false;
        return true;
      });
      if (candidates.length === 0) return;
      candidates.sort((a, b) => new Date(a.closeTime).getTime() - new Date(b.closeTime).getTime());
      const pick = candidates[0];
      const sideAsk = pick.side === "YES" ? pick.marketYesPrice : 1 - pick.marketYesPrice;

      inFlight = true;
      setFiring(true);
      processed.add(pick.ticker);
      writeProcessed(Array.from(processed));
      try {
        const res = await runFn({ data: {
          mode: "paper",
          stakeUsd: PRED_BET_STAKE,
          maxOrders: 1,
          force: true,
          forceTicker: pick.ticker,
          forceSide: pick.side,
          maxEntryCents: Math.round(PRED_MAX_ASK * 100),
          skipLadder: true,
        } });

        if (res.placed > 0 && res.orders?.[0]) {
          const o = res.orders[0];
          try { playModelBetPing(); } catch { /* noop */ }
          toast.success(`PRED $${PRED_BET_STAKE}: ${pick.side === "YES" ? "UP" : "DOWN"} ${pick.ticker} @ ${o.limit_cents}¢ · edge ${pick.edgePts.toFixed(1)}`);
          setLastFired(`${pick.ticker} ${pick.side} @ ${o.limit_cents}¢ · edge ${pick.edgePts.toFixed(1)}`);
          try {
            const r = await recordPaperFire({ data: {
              ticker: o.ticker, closeTime: o.close_time, button: "pred",
              side: o.side, contracts: o.contracts, fillPriceCents: o.limit_cents,
              snapshot: { edge: pick.edgePts, sideAsk, marketYesPrice: pick.marketYesPrice },
            }});
            if (!r.ok) toast.warning(`Paper: ${r.reason}`);
          } catch { /* silent */ }
        } else {
          const realReasons = (res.skipReasons ?? []).filter((r: string) => !/^(equity:|force:)/i.test(r));
          const reason = (realReasons.length ? realReasons : res.skipReasons ?? []).slice(0, 2).join(" · ") || "no fill";
          toast.info(`PRED skipped ${pick.ticker}: ${reason}`);
          setLastSkip(`${pick.ticker} · ask ${(sideAsk*100).toFixed(0)}¢ · ${reason}`);
        }
      } catch (e: any) {
        toast.error(`PRED failed ${pick.ticker}`, { description: e?.message ?? String(e) });
      } finally {
        inFlight = false;
        setFiring(false);
      }
    };

    tick();
    const h = setInterval(tick, 5_000);
    return () => { cancelled = true; clearInterval(h); };
  }, [enabled, statsQ.data, runFn]);

  return (
    <div className="border border-border rounded-lg bg-card">
      <div className="px-4 py-3 flex items-center justify-between gap-3 flex-wrap">
        <div className="flex items-center gap-3">
          <button
            onClick={enabled ? toggleOff : toggleOn}
            className={`text-xs font-semibold px-3 py-1.5 rounded border flex items-center gap-1.5 ${enabled ? "border-fuchsia-500/50 bg-fuchsia-500/15 text-fuchsia-300" : "border-border bg-muted/30 hover:bg-muted/50"}`}
          >
            <span className={`h-1.5 w-1.5 rounded-full ${enabled ? "bg-fuchsia-400 animate-pulse" : "bg-muted-foreground"}`} />
            {enabled ? `PRED Bet ON · $${PRED_BET_STAKE}` : `PRED Bet OFF · $${PRED_BET_STAKE}`}
          </button>
          <span className="text-[11px] text-muted-foreground">
            Value pick (raw_dir) · |edge|≥{PRED_MIN_EDGE_ABS}pt · ask {Math.round(PRED_MIN_ASK*100)}–{Math.round(PRED_MAX_ASK*100)}¢ · hold to settle · one bet / ticker
          </span>
        </div>
        <div className="flex items-center gap-3">
          <PredVerdictBox verdict={verdict} locked={!!lockedVerdict} closeTime={activeWindow?.closeTime ?? null} ticker={activeWindow?.ticker ?? null} />
          <div className="flex flex-col items-end gap-0.5 text-[11px] text-muted-foreground">
            {firing && <Loader2 className="h-3 w-3 animate-spin" />}
            {lastFired && <span>last: {lastFired}</span>}
            {lastSkip && <span className="opacity-60">skip: {lastSkip}</span>}
          </div>
        </div>
      </div>
    </div>
  );
}

// ============================================================
// GREEN HOURS BET — sibling to Model Bet / PRED Bet.
// Fires runAutoTrade in LIVE mode with NO force flag, so the server
// applies ALL existing hard gates: green-hour whitelist (UTC 08,11,12,
// 16,19-22), σ-dist, TA-outlier kill, price band, flip gate, 7d
// kill-switch. Exactly the same fires shown in the
// "🟢 Auto-Trade LIVE fires" card. $10 flat, one attempt per tick.
// Mutually exclusive with Model Bet / PRED Bet / Auto-Odds / Auto-Mart
// via the shared AUTO_BET_MUTEX_EVENT.
// ============================================================
const GREEN_BET_LS_ENABLED = "crypto.greenBet";
const GREEN_BET_STAKE = 10;
const GREEN_HOURS_UTC = new Set<number>([8, 11, 12, 16, 19, 20, 21, 22]);

type PredVerdict = { action: "UP" | "DOWN" | "SKIP"; ask: number; edge: number; reasons: string[] } | null;

export function GreenHoursBetPanel() {
  const runFn = useServerFn(runAutoTrade);

  const [enabled, setEnabled] = useState<boolean>(() => {
    if (typeof window === "undefined") return false;
    return window.localStorage.getItem(GREEN_BET_LS_ENABLED) === "on";
  });
  const [firing, setFiring] = useState(false);
  const [lastFired, setLastFired] = useState<string | null>(null);
  const [lastSkip, setLastSkip] = useState<string | null>(null);
  const [nowUtcHour, setNowUtcHour] = useState<number>(() => new Date().getUTCHours());

  useEffect(() => {
    const h = setInterval(() => setNowUtcHour(new Date().getUTCHours()), 30_000);
    return () => clearInterval(h);
  }, []);

  const inGreenHour = GREEN_HOURS_UTC.has(nowUtcHour);

  useEffect(() => {
    if (typeof window === "undefined") return;
    window.localStorage.setItem(GREEN_BET_LS_ENABLED, enabled ? "on" : "off");
  }, [enabled]);

  const toggleOn = () => {
    if (typeof window !== "undefined") {
      window.localStorage.setItem(MODEL_BET_LS_ENABLED, "off");
      window.localStorage.setItem(PRED_BET_LS_ENABLED, "off");
      window.localStorage.setItem("crypto.autoOdds", "off");
      window.localStorage.setItem("crypto.autoMart", "off");
      window.dispatchEvent(new CustomEvent(AUTO_BET_MUTEX_EVENT, { detail: "greenBet" }));
    }
    setEnabled(true);
    toast.success(`Green Hours Bet ON · $${GREEN_BET_STAKE} · UTC 08,11,12,16,19–22 only`);
  };
  const toggleOff = () => {
    setEnabled(false);
    toast.info("Green Hours Bet OFF");
  };

  useEffect(() => {
    const onMutex = (e: Event) => {
      const which = (e as CustomEvent).detail;
      if (which && which !== "greenBet" && typeof window !== "undefined") {
        if (window.localStorage.getItem(GREEN_BET_LS_ENABLED) === "on") {
          window.localStorage.setItem(GREEN_BET_LS_ENABLED, "off");
        }
        setEnabled(false);
      }
    };
    window.addEventListener(AUTO_BET_MUTEX_EVENT, onMutex as EventListener);
    return () => window.removeEventListener(AUTO_BET_MUTEX_EVENT, onMutex as EventListener);
  }, []);

  useEffect(() => {
    // Always-on paper auto-runner for Green Hours (paper mode only).
    if (typeof window === "undefined") return;
    let cancelled = false;
    let inFlight = false;

    const tick = async () => {
      if (cancelled || inFlight) return;
      // Skip client-side calls entirely outside green hours — saves round-trips.
      // Server-side gate is still authoritative.
      const hourUtc = new Date().getUTCHours();
      if (!GREEN_HOURS_UTC.has(hourUtc)) {
        setLastSkip(`red hour ${String(hourUtc).padStart(2, "0")}:00 UTC`);
        return;
      }
      inFlight = true;
      setFiring(true);
      try {
        const res = await runFn({ data: {
          mode: "paper",
          stakeUsd: GREEN_BET_STAKE,
          maxOrders: 1,
        } });
        if (res.placed > 0 && res.orders?.[0]) {
          const o = res.orders[0];
          try { playModelBetPing(); } catch { /* noop */ }
          const label = `${o.ticker} ${o.side} @ ${o.limit_cents}¢`;
          toast.success(`Green Bet $${GREEN_BET_STAKE}: ${label}`);
          setLastFired(label);
          try {
            const r = await recordPaperFire({ data: {
              ticker: o.ticker, closeTime: o.close_time, button: "green_hours",
              side: o.side, contracts: o.contracts, fillPriceCents: o.limit_cents,
              snapshot: { edge: o.edge_pts, prob: o.model_prob, sigmaDist: o.sigma_distance },
            }});
            if (!r.ok) toast.warning(`Paper: ${r.reason}`);
          } catch { /* silent */ }
        } else {
          const realReasons = (res.skipReasons ?? []).filter((r: string) => !/^(equity:|force:)/i.test(r));
          const reason = (realReasons.length ? realReasons : res.skipReasons ?? []).slice(0, 1).join(" · ") || "no candidate";
          setLastSkip(reason);
        }
      } catch (e: any) {
        toast.error("Green Bet failed", { description: e?.message ?? String(e) });
      } finally {
        inFlight = false;
        setFiring(false);
      }
    };

    tick();
    const h = setInterval(tick, 15_000);
    return () => { cancelled = true; clearInterval(h); };
  }, [enabled, runFn]);

  return (
    <div className="border border-border rounded-lg bg-card">
      <div className="px-4 py-3 flex items-center justify-between gap-3 flex-wrap">
        <div className="flex items-center gap-3">
          <button
            onClick={enabled ? toggleOff : toggleOn}
            className={`text-xs font-semibold px-3 py-1.5 rounded border flex items-center gap-1.5 ${enabled ? "border-emerald-500/50 bg-emerald-500/15 text-emerald-300" : "border-border bg-muted/30 hover:bg-muted/50"}`}
          >
            <span className={`h-1.5 w-1.5 rounded-full ${enabled ? "bg-emerald-400 animate-pulse" : "bg-muted-foreground"}`} />
            {enabled ? `Green Hours Bet ON · $${GREEN_BET_STAKE}` : `Green Hours Bet OFF · $${GREEN_BET_STAKE}`}
          </button>
          <span className="text-[11px] text-muted-foreground">
            LIVE auto-trade · green hours only (UTC 08,11,12,16,19–22) · full gate stack + 7d kill-switch
          </span>
        </div>
        <div className="flex items-center gap-3">
          <span className={`text-[11px] px-2 py-0.5 rounded border ${inGreenHour ? "border-emerald-500/40 text-emerald-300 bg-emerald-500/10" : "border-border text-muted-foreground bg-muted/30"}`}>
            {inGreenHour ? "🟢 GREEN HOUR" : `⚪ ${String(nowUtcHour).padStart(2, "0")}:00 UTC`}
          </span>
          <div className="flex flex-col items-end gap-0.5 text-[11px] text-muted-foreground">
            {firing && <Loader2 className="h-3 w-3 animate-spin" />}
            {lastFired && <span>last: {lastFired}</span>}
            {lastSkip && <span className="opacity-60">skip: {lastSkip}</span>}
          </div>
        </div>
      </div>
    </div>
  );
}

// ============================================================
// T-5m KALSHI CONFIRMATION BET (paper only) — verdict-driven fire.
// Rule: model firm (side conf ≥ 65%) AND Kalshi ask on model side ≥ 55¢
// AND time-to-close between 3:00 and 5:00 minutes.
// One shot per window, $10 flat, hold to settle. Paper only.
// Sandbox-only — mutex with other paper bet panels.
// ============================================================
const T5M_BET_LS_ENABLED = "crypto.t5mBet";
const T5M_BET_LS_TICKERS = "crypto.t5mBet.tickers";
const T5M_BET_STAKE = 10;
const T5M_MIN_SIDE_CONF = 0.65;
const T5M_MIN_ASK = 0.55;
const T5M_MAX_ASK = 0.99;
const T5M_WIN_MIN_MS = 180_000; // T-3m
const T5M_WIN_MAX_MS = 300_000; // T-5m

export function T5mBetPanel() {
  const runFn = useServerFn(runAutoTrade);
  const statsFn = useServerFn(getPredictionStats);
  const statsQ = useQuery({ queryKey: ["btc-pred-stats"], queryFn: () => statsFn(), refetchInterval: 30_000 });

  const [enabled, setEnabled] = useState<boolean>(() => {
    if (typeof window === "undefined") return false;
    return window.localStorage.getItem(T5M_BET_LS_ENABLED) === "on";
  });
  const [firing, setFiring] = useState(false);
  const [lastFired, setLastFired] = useState<string | null>(null);
  const [lastSkip, setLastSkip] = useState<string | null>(null);
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    const h = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(h);
  }, []);

  useEffect(() => {
    if (typeof window === "undefined") return;
    window.localStorage.setItem(T5M_BET_LS_ENABLED, enabled ? "on" : "off");
  }, [enabled]);

  const toggleOn = () => {
    if (typeof window !== "undefined") {
      window.dispatchEvent(new CustomEvent(AUTO_BET_MUTEX_EVENT, { detail: "t5mBet" }));
    }
    setEnabled(true);
    toast.success(`T-5m Confirmation ON · $${T5M_BET_STAKE} · paper only`);
  };
  const toggleOff = () => {
    setEnabled(false);
    toast.info("T-5m Confirmation OFF");
  };

  useEffect(() => {
    const onMutex = (e: Event) => {
      const which = (e as CustomEvent).detail;
      if (which && which !== "t5mBet" && typeof window !== "undefined") {
        if (window.localStorage.getItem(T5M_BET_LS_ENABLED) === "on") {
          window.localStorage.setItem(T5M_BET_LS_ENABLED, "off");
        }
        setEnabled(false);
      }
    };
    window.addEventListener(AUTO_BET_MUTEX_EVENT, onMutex as EventListener);
    return () => window.removeEventListener(AUTO_BET_MUTEX_EVENT, onMutex as EventListener);
  }, []);

  // Compute current verdict for the soonest active window.
  const verdict = useMemo(() => {
    const s = statsQ.data;
    if (!s?.recent?.length) return null as null | {
      ticker: string; closeTime: string; action: "UP" | "DOWN" | "WAIT" | "SKIP";
      sideAsk: number; sideConf: number; msLeft: number; reasons: string[]; side: "YES" | "NO";
    };
    const active = [...s.recent]
      .filter(r => !r.outcome && new Date(r.closeTime).getTime() > now)
      .sort((a, b) => new Date(a.closeTime).getTime() - new Date(b.closeTime).getTime())[0];
    if (!active) return null;
    const msLeft = new Date(active.closeTime).getTime() - now;
    const sideAsk = active.side === "YES" ? active.marketYesPrice : 1 - active.marketYesPrice;
    const sideConf = active.side === "YES" ? active.modelProb : 1 - active.modelProb;
    const reasons: string[] = [];
    const confOk = sideConf >= T5M_MIN_SIDE_CONF;
    const askOk = sideAsk >= T5M_MIN_ASK && sideAsk <= T5M_MAX_ASK;
    const flipOk = !active.liveSide || active.liveSide === active.side;
    const inWin = msLeft <= T5M_WIN_MAX_MS && msLeft >= T5M_WIN_MIN_MS;
    if (!confOk) reasons.push(`conf ${Math.round(sideConf * 100)}%`);
    if (!askOk) reasons.push(`ask ${Math.round(sideAsk * 100)}¢`);
    if (!flipOk) reasons.push("flip");
    if (!inWin) reasons.push(msLeft > T5M_WIN_MAX_MS ? "too early" : "too late");
    const action: "UP" | "DOWN" | "WAIT" | "SKIP" =
      confOk && askOk && flipOk && inWin
        ? (active.side === "YES" ? "UP" : "DOWN")
        : (msLeft > T5M_WIN_MAX_MS && confOk && askOk && flipOk ? "WAIT" : "SKIP");
    return { ticker: active.ticker, closeTime: active.closeTime, action, sideAsk, sideConf, msLeft, reasons, side: active.side as "YES" | "NO" };
  }, [statsQ.data, now]);

  // Paper auto-runner: fires once per ticker when verdict crosses into fire zone.
  useEffect(() => {
    if (!enabled) return;
    if (typeof window === "undefined") return;
    if (!verdict || (verdict.action !== "UP" && verdict.action !== "DOWN")) return;
    if (firing) return;

    const readProcessed = (): string[] => {
      try { return JSON.parse(window.localStorage.getItem(T5M_BET_LS_TICKERS) || "[]"); } catch { return []; }
    };
    const writeProcessed = (arr: string[]) => {
      try { window.localStorage.setItem(T5M_BET_LS_TICKERS, JSON.stringify(arr.slice(-100))); } catch { /* ignore */ }
    };
    const processed = new Set(readProcessed());
    if (processed.has(verdict.ticker)) return;

    let cancelled = false;
    (async () => {
      setFiring(true);
      processed.add(verdict.ticker);
      writeProcessed(Array.from(processed));
      try {
        const res = await runFn({ data: {
          mode: "paper",
          stakeUsd: T5M_BET_STAKE,
          maxOrders: 1,
          force: true,
          forceTicker: verdict.ticker,
          forceSide: verdict.side,
          maxEntryCents: Math.round(T5M_MAX_ASK * 100),
          skipLadder: true,
        } });
        if (cancelled) return;
        if (res.placed > 0 && res.orders?.[0]) {
          const o = res.orders[0];
          try { playModelBetPing(); } catch { /* noop */ }
          const label = `${verdict.action} ${verdict.ticker} @ ${o.limit_cents}¢ · conf ${Math.round(verdict.sideConf * 100)}%`;
          toast.success(`T-5m paper $${T5M_BET_STAKE}: ${label}`);
          setLastFired(label);
          try {
            const r = await recordPaperFire({ data: {
              ticker: o.ticker, closeTime: o.close_time, button: "t5m",
              side: o.side, contracts: o.contracts, fillPriceCents: o.limit_cents,
              snapshot: { sideAsk: verdict.sideAsk, sideConf: verdict.sideConf, msLeft: verdict.msLeft },
            }});
            if (!r.ok) toast.warning(`Paper: ${r.reason}`);
          } catch { /* silent */ }
        } else {
          const reason = (res.skipReasons ?? []).slice(0, 2).join(" · ") || "no fill";
          toast.info(`T-5m skipped ${verdict.ticker}: ${reason}`);
          setLastSkip(`${verdict.ticker} · ${reason}`);
        }
      } catch (e: any) {
        toast.error(`T-5m failed ${verdict?.ticker}`, { description: e?.message ?? String(e) });
      } finally {
        if (!cancelled) setFiring(false);
      }
    })();
    return () => { cancelled = true; };
  }, [enabled, verdict, firing, runFn]);

  const mmss = (ms: number) => {
    if (!Number.isFinite(ms) || ms < 0) return "--:--";
    const s = Math.floor(ms / 1000);
    return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
  };
  const actionColor =
    verdict?.action === "UP" ? "text-emerald-300 border-emerald-500/40 bg-emerald-500/10" :
    verdict?.action === "DOWN" ? "text-red-300 border-red-500/40 bg-red-500/10" :
    verdict?.action === "WAIT" ? "text-amber-300 border-amber-500/40 bg-amber-500/10" :
    "text-muted-foreground border-border bg-muted/30";

  return (
    <div className="border border-border rounded-lg bg-card">
      <div className="px-4 py-3 flex items-center justify-between gap-3 flex-wrap">
        <div className="flex items-center gap-3">
          <button
            onClick={enabled ? toggleOff : toggleOn}
            className={`text-xs font-semibold px-3 py-1.5 rounded border flex items-center gap-1.5 ${enabled ? "border-sky-500/50 bg-sky-500/15 text-sky-300" : "border-border bg-muted/30 hover:bg-muted/50"}`}
          >
            <span className={`h-1.5 w-1.5 rounded-full ${enabled ? "bg-sky-400 animate-pulse" : "bg-muted-foreground"}`} />
            {enabled ? `T-5m Confirmation ON · $${T5M_BET_STAKE}` : `T-5m Confirmation OFF · $${T5M_BET_STAKE}`}
          </button>
          <span className="text-[11px] text-muted-foreground">
            Paper only · model conf ≥ {Math.round(T5M_MIN_SIDE_CONF*100)}% · Kalshi ask ≥ {Math.round(T5M_MIN_ASK*100)}¢ · fire T-5m → T-3m · hold to settle
          </span>
        </div>
        <div className="flex items-center gap-3">
          <div className={`px-3 py-1.5 rounded border text-[11px] font-mono ${actionColor}`}>
            <div className="flex items-center gap-2">
              <span className="font-bold text-sm">{verdict?.action ?? "—"}</span>
              {verdict && <span className="opacity-70">T-{mmss(verdict.msLeft)}</span>}
            </div>
            {verdict && (
              <div className="opacity-80 mt-0.5">
                conf {Math.round(verdict.sideConf * 100)}% · ask {Math.round(verdict.sideAsk * 100)}¢
                {verdict.action === "SKIP" && verdict.reasons.length > 0 && <> · {verdict.reasons.slice(0,2).join(" · ")}</>}
              </div>
            )}
          </div>
          <div className="flex flex-col items-end gap-0.5 text-[11px] text-muted-foreground">
            {firing && <Loader2 className="h-3 w-3 animate-spin" />}
            {lastFired && <span>last: {lastFired}</span>}
            {lastSkip && <span className="opacity-60">skip: {lastSkip}</span>}
          </div>
        </div>
      </div>
    </div>
  );
}



function PredVerdictBox({ verdict, locked, closeTime, ticker }: { verdict: PredVerdict; locked?: boolean; closeTime?: string | null; ticker?: string | null }) {
  const action = verdict?.action ?? "SKIP";
  const cfg =
    action === "UP"
      ? { text: "text-emerald-300", ring: "#10b981", label: "UP" }
      : action === "DOWN"
      ? { text: "text-rose-300", ring: "#f43f5e", label: "DOWN" }
      : { text: "text-amber-300", ring: "#f59e0b", label: "SKIP" };
  const subtitle = !verdict
    ? "waiting for next window"
    : action === "SKIP"
    ? verdict.reasons.slice(0, 2).join(" · ") || "no setup"
    : `ask ${Math.round(verdict.ask * 100)}¢ · edge ${verdict.edge.toFixed(1)}`;

  // One-line local-time label matching the model accuracy "Closed" column:
  // "Jul 21, 2:15 PM · BTC-15M-..."
  const windowLabel = (() => {
    if (!closeTime) return null;
    const end = new Date(closeTime);
    if (isNaN(end.getTime())) return null;
    // Match the Model Accuracy Log "Closed" column: show the window CLOSE
    // time (the ticker's settle moment), not the window open time.
    const timePart = end.toLocaleString([], { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit", hour12: true });
    return ticker ? `${timePart} · ${ticker}` : timePart;
  })();

  return (
    <div className="relative rounded-md p-[2px] overflow-hidden" title={locked ? "Verdict locked for this window" : undefined}>
      <style>{`@keyframes pred-verdict-spin { to { transform: rotate(360deg); } }`}</style>
      <span
        aria-hidden
        className="absolute left-1/2 top-1/2 -z-0"
        style={{
          width: "300%",
          height: "300%",
          transform: "translate(-50%, -50%)",
          background: `conic-gradient(from 0deg, transparent 0 55%, ${cfg.ring} 70%, transparent 85% 100%)`,
          animation: "pred-verdict-spin 2.8s linear infinite",
        }}
      />
      <div className={`relative z-10 rounded bg-card px-3 py-1.5 min-w-[110px] text-center ${cfg.text}`}>
        <div className="text-xs font-bold leading-tight tracking-wider flex items-center justify-center gap-1">
          {locked && <span className="text-[9px] opacity-70">🔒</span>}
          {cfg.label}
        </div>
        {windowLabel && (
          <div className="text-[9px] text-muted-foreground/80 leading-tight mt-0.5 tabular-nums">{windowLabel}</div>
        )}
        <div className="text-[10px] text-muted-foreground leading-tight mt-0.5">{subtitle}</div>
      </div>
    </div>
  );
}





function OddsFlipAlert() {
  const fn = useServerFn(getRecentOddsFlip);
  const q = useQuery({
    queryKey: ["odds-flip-alert"],
    queryFn: () => fn(),
    refetchInterval: 5_000,
    staleTime: 3_000,
  });
  const lastToastKey = useRef<string | null>(null);
  useEffect(() => {
    const r = q.data;
    if (!r || !r.ok || !r.flipped || !r.crossedAt || !r.toSide) return;
    const key = `${r.ticker}:${r.crossedAt}`;
    if (lastToastKey.current === key) return;
    lastToastKey.current = key;
    toast.warning(`Kalshi odds FLIPPED → ${r.toSide}`, {
      description: `${r.fromSide} → ${r.toSide} · YES now ${r.latestYes}¢ / NO ${r.latestNo}¢ · ${r.ticker?.slice(-16) ?? ""}`,
    });
  }, [q.data]);

  const r = q.data;
  if (!r || !r.ok || r.sampled < 3) return null;
  if (!r.flipped) {
    return (
      <div className="mt-1.5 rounded border border-border/50 bg-muted/10 px-2 py-1 text-[10px] font-mono text-muted-foreground flex items-center gap-2">
        <span className="h-1.5 w-1.5 rounded-full bg-muted-foreground/60" />
        <span>Odds tape stable · leader <span className="text-foreground">{r.latestSide}</span> · YES {r.latestYes}¢ / NO {r.latestNo}¢ · n={r.sampled}</span>
      </div>
    );
  }
  const toColor = r.toSide === "YES" ? "text-emerald-300" : "text-red-300";
  const borderColor = r.toSide === "YES" ? "border-emerald-500/50 bg-emerald-500/10" : "border-red-500/50 bg-red-500/10";
  return (
    <div className={`mt-1.5 rounded border px-2 py-1.5 text-[11px] font-mono flex items-center gap-2 ${borderColor}`}>
      <AlertTriangle className={`h-3 w-3 ${toColor}`} />
      <span className={`font-semibold ${toColor}`}>SIDE FLIPPED</span>
      <span className="text-muted-foreground">·</span>
      <span>{r.fromSide} → <span className={`font-bold ${toColor}`}>{r.toSide}</span></span>
      <span className="text-muted-foreground">·</span>
      <span>YES {r.latestYes}¢ / NO {r.latestNo}¢</span>
      <span className="text-muted-foreground">·</span>
      <span className="text-muted-foreground truncate">{r.ticker?.slice(-16)}</span>
      <span className="text-muted-foreground ml-auto">n={r.sampled}</span>
    </div>
  );
}

function BigFlipMonitor() {
  const fn = useServerFn(detectBigFlip);
  const q = useQuery({
    queryKey: ["big-flip-monitor"],
    queryFn: () => fn(),
    refetchInterval: 3_000,
    staleTime: 2_000,
  });
  const lastToastKey = useRef<string | null>(null);
  useEffect(() => {
    const r = q.data;
    if (!r || !r.ok || !r.passed || !r.flipAt || !r.toSide) return;
    const key = `${r.ticker}:${r.flipAt}`;
    if (lastToastKey.current === key) return;
    lastToastKey.current = key;
    toast.success(`🎯 CHEAP FLIP → ${r.toSide} @ ${r.minAskCents ?? r.newYes}¢ · LIVE $10`, {
      description: `model conf ${r.modelSideConf != null ? (r.modelSideConf * 100).toFixed(0) : "?"}% · ${r.secondsToClose}s left`,
    });
    try { playOrderPlaced(); } catch { /* noop */ }
  }, [q.data]);

  // Realtime: catch flips fired by the server cron while the page is idle.
  useEffect(() => {
    let active = true;
    (async () => {
      const { data: u } = await supabase.auth.getUser();
      const uid = u.user?.id;
      if (!uid || !active) return;
      const channel = supabase
        .channel(`big-flip-signals-${uid}`)
        .on(
          "postgres_changes",
          { event: "INSERT", schema: "public", table: "big_flip_signals", filter: `user_id=eq.${uid}` },
          (payload) => {
            const row = payload.new as { ticker: string; to_side: string; min_ask_cents: number | null; new_yes: number; model_side_conf: number | null; seconds_to_close: number; passed_rules: boolean; flip_at: string; trigger_kind: string };
            if (!row.passed_rules || row.trigger_kind !== "cheap_flip_15c") return;
            const key = `${row.ticker}:${row.flip_at}`;
            if (lastToastKey.current === key) return;
            lastToastKey.current = key;
            const ask = row.min_ask_cents ?? row.new_yes;
            const conf = row.model_side_conf != null ? `${(Number(row.model_side_conf) * 100).toFixed(0)}%` : "?";
            toast.success(`🎯 CHEAP FLIP → ${row.to_side} @ ${ask}¢ · LIVE $10`, {
              description: `model conf ${conf} · ${row.seconds_to_close}s left`,
            });
            try { playOrderPlaced(); } catch { /* noop */ }
          },
        )
        .subscribe();
      return () => { supabase.removeChannel(channel); };
    })();
    return () => { active = false; };
  }, []);

  // Killswitch state (auto-halt after too many losing 15-min windows).
  const [ks, setKs] = useState<{ halted: boolean; reason: string | null } | null>(null);
  const refreshKs = async () => {
    const { data: u } = await supabase.auth.getUser();
    const uid = u.user?.id;
    if (!uid) return;
    const { data } = await supabase
      .from("big_flip_killswitch")
      .select("halted,reason")
      .eq("user_id", uid)
      .maybeSingle();
    setKs({ halted: !!data?.halted, reason: data?.reason ?? null });
  };
  useEffect(() => { refreshKs(); const t = setInterval(refreshKs, 5_000); return () => clearInterval(t); }, []);
  const reEnable = async () => {
    const { data: u } = await supabase.auth.getUser();
    const uid = u.user?.id;
    if (!uid) return;
    await supabase.from("big_flip_killswitch").upsert({
      user_id: uid, halted: false, reason: null, updated_at: new Date().toISOString(),
    }, { onConflict: "user_id" });
    toast.success("Big-flip auto-trade re-enabled");
    refreshKs();
  };

  const r = q.data;
  if (!r || !r.ok) return null;
  const fresh = r.flipAt && r.ageSeconds != null && r.ageSeconds < 120;

  if (ks?.halted) {
    return (
      <div className="mt-1 rounded border border-red-500/60 bg-red-500/15 px-2 py-1.5 text-[11px] font-mono flex items-center gap-2">
        <AlertTriangle className="h-3 w-3 text-red-300" />
        <span className="font-semibold text-red-300">AUTO-TRADE HALTED</span>
        <span className="text-muted-foreground">·</span>
        <span className="text-muted-foreground truncate">{ks.reason ?? "killswitch on"}</span>
        <button
          onClick={reEnable}
          className="ml-auto rounded border border-red-400/60 px-2 py-0.5 text-[10px] uppercase text-red-200 hover:bg-red-500/20"
        >
          Re-enable
        </button>
      </div>
    );
  }

  if (!r.passed || !fresh) {
    return (
      <div className="mt-1 rounded border border-border/50 bg-muted/10 px-2 py-1 text-[10px] font-mono text-muted-foreground flex items-center gap-2">
        <span className="h-1.5 w-1.5 rounded-full bg-muted-foreground/60" />
        <span>Cheap-flip hunter · LIVE $10 · always on · arm T-9m→T-3m · ask ≤15¢ · model conf ≥70% · cap 6/day · {r.rejectReason ? `skip: ${r.rejectReason}` : "waiting for setup"}</span>
      </div>
    );
  }
  const toColor = r.toSide === "YES" ? "text-emerald-300" : "text-red-300";
  const borderColor = r.toSide === "YES" ? "border-emerald-500/60 bg-emerald-500/15" : "border-red-500/60 bg-red-500/15";
  const ask = r.minAskCents ?? r.newYes;
  const conf = r.modelSideConf != null ? `${(r.modelSideConf * 100).toFixed(0)}%` : "?";
  return (
    <div className={`mt-1 rounded border px-2 py-1.5 text-[11px] font-mono flex items-center gap-2 ${borderColor}`}>
      <Zap className={`h-3 w-3 ${toColor}`} />
      <span className={`font-semibold ${toColor}`}>CHEAP FLIP → {r.toSide}</span>
      <span className="text-muted-foreground">·</span>
      <span><span className={`font-bold ${toColor}`}>{ask}¢</span> ask</span>
      <span className="text-muted-foreground">·</span>
      <span>model {conf}</span>
      <span className="text-muted-foreground">·</span>
      <span>{r.secondsToClose}s</span>
      <span className="text-muted-foreground">·</span>
      <span className="text-[10px] uppercase text-yellow-300 font-semibold">LIVE $10</span>
      <span className="text-muted-foreground ml-auto">{r.ageSeconds}s ago</span>
    </div>
  );
}

function AutoTradePanel({ markets }: { markets: BtcMarket[] }) {
  const qc = useQueryClient();
  const listFn = useServerFn(listAutoTradeOrders);
  const settleFn = useServerFn(settleAutoTradeOrders);
  const autoExitFn = useServerFn(autoExitLivePositions);
  const settleSkipFn = useServerFn(settleAutoTradeSkipLog);
  const skipReportFn = useServerFn(getSkipReport);
  const runFn = useServerFn(runAutoTrade);
  const balanceFn = useServerFn(checkKalshiBalance);
  const diagFn = useServerFn(diagnoseKalshiAuth);
  const sellOddsFn = useServerFn(sellOddsBetOrder);
  // Read the shared btc-markets cache populated by CryptoPage. React Query
  // dedupes by key — no extra fetch, we just subscribe to updates.
  const marketsFn = useServerFn(getBtcMarkets);
  const marketsQ = useQuery({ queryKey: ["btc-markets"], queryFn: () => marketsFn(), refetchInterval: 2_000, staleTime: 1_000 });

  const [liveBusy, setLiveBusy] = useState(false);
  const [forceBusy, setForceBusy] = useState(false);
  const [testBusy, setTestBusy] = useState(false);
  const [diagBusy, setDiagBusy] = useState(false);
  const [diag, setDiag] = useState<null | { ok: boolean; steps: KalshiDiagStep[]; summary: string; serverTimeIso: string }>(null);
  const [diagOpen, setDiagOpen] = useState(false);

  async function testKalshi() {
    setTestBusy(true);
    try {
      const r = await balanceFn();
      if (r.ok) {
        const bal = r.balanceCents != null ? `$${(r.balanceCents / 100).toFixed(2)}` : "—";
        toast.success("Kalshi connection OK", { description: `Balance: ${bal}` });
      } else {
        toast.error("Kalshi connection failed", { description: `${r.status ? `[${r.status}] ` : ""}${r.error ?? "unknown"}` });
      }
    } catch (e: any) {
      toast.error("Pre-flight failed", { description: e?.message ?? String(e) });
    } finally {
      setTestBusy(false);
    }
  }

  async function runDiagnostics() {
    setDiagBusy(true);
    setDiagOpen(true);
    try {
      const r = await diagFn();
      setDiag(r);
    } catch (e: any) {
      toast.error("Diagnostics failed", { description: e?.message ?? String(e) });
    } finally {
      setDiagBusy(false);
    }
  }

  const list = useQuery({
    queryKey: ["auto-trade-orders"],
    queryFn: () => listFn(),
    refetchInterval: 30_000,
  });

  // Opportunistic client-side settle + auto-exit (cron also runs server-side).
  // Auto-exit checks open live positions every minute against TP/SL/edge-decay
  // thresholds and closes via Kalshi sell when triggered.
  useEffect(() => {
    let cancelled = false;
    const tick = async () => {
      try {
        await autoExitFn();
        await settleFn();
        await settleSkipFn();
        if (!cancelled) qc.invalidateQueries({ queryKey: ["auto-trade-orders"] });
      } catch { /* ignore */ }
    };
    tick();
    const h = setInterval(tick, 60_000);
    return () => { cancelled = true; clearInterval(h); };
  }, [settleFn, autoExitFn, settleSkipFn, qc]);

  // Counterfactual "would-have" report — shows whether gates saved us money.
  const skipReport = useQuery({
    queryKey: ["auto-trade-skip-report"],
    queryFn: () => skipReportFn(),
    refetchInterval: 120_000,
  });

  const orders = list.data?.orders ?? [];
  const liveOrders = orders.filter(o => o.mode === "live");
  const liveTotals = liveOrders.reduce(
    (acc, o) => {
      acc.placed += 1;
      if (o.status === "settled_win") acc.wins += 1;
      if (o.status === "settled_loss") acc.losses += 1;
      acc.pnlUsd += Number(o.pnl_usd) || 0;
      return acc;
    },
    { placed: 0, wins: 0, losses: 0, pnlUsd: 0 },
  );
  const liveCount24h = liveOrders.filter(o => Date.now() - new Date(o.created_at).getTime() < 24 * 60 * 60 * 1000).length;
  const liveRealized24h = liveOrders
    .filter(o => Date.now() - new Date(o.created_at).getTime() < 24 * 60 * 60 * 1000)
    .reduce((s, o) => s + (Number(o.pnl_usd) || 0), 0);

  // Sound notifications for new live orders / fills (settled).
  const [soundOn, setSoundOn] = useState<boolean>(() => {
    if (typeof window === "undefined") return true;
    return window.localStorage.getItem("crypto.orderSound") !== "off";
  });
  useEffect(() => {
    if (typeof window !== "undefined") {
      window.localStorage.setItem("crypto.orderSound", soundOn ? "on" : "off");
    }
  }, [soundOn]);
  const prevOrdersRef = (useMemo(() => ({ current: null as null | Map<string, string> }), []));
  useEffect(() => {
    const next = new Map(liveOrders.map(o => [o.id, o.status]));
    const prev = prevOrdersRef.current;
    if (prev && soundOn) {
      let placed = 0;
      let filled = 0;
      for (const [id, status] of next) {
        const before = prev.get(id);
        if (before === undefined) {
          if (status === "placed") placed += 1;
        } else if (before === "placed" && (status === "settled_win" || status === "settled_loss")) {
          filled += 1;
        }
      }
      if (placed > 0) playOrderPlaced();
      if (filled > 0) setTimeout(() => playOrderFilled(), placed > 0 ? 250 : 0);
    }
    prevOrdersRef.current = next;
  }, [liveOrders, soundOn, prevOrdersRef]);

  async function runLive() {
    const ok = window.confirm(
      "PLACE REAL MONEY ORDERS on Kalshi?\n\n" +
      "ENTRY (all must pass):\n" +
      "  • edge ≥ 5pts, sigma ≥ 1.25σ, ≥120s to close\n" +
      "  • momentum aligned, equity overlay not blocking\n" +
      "  • not already traded this ticker in 24h\n\n" +
      "SIZE: $100/order · up to 3 orders this click · $300 max exposure\n" +
      "DAILY: halt after 10 orders or realized ≤ -$60 in 24h\n\n" +
      "EXIT (auto, checked every 60s):\n" +
      "  • Take-profit: mark PnL ≥ +70% of stake\n" +
      "  • Stop-loss:   mark PnL ≤ -50% of stake\n" +
      "  • Edge decay:  price moved ≥2¢ against position\n" +
      "  • Otherwise held to 15-min expiry & settled by Kalshi\n\n" +
      "Click OK to proceed.",
    );
    if (!ok) return;
    setLiveBusy(true);
    try {
      const res = await runFn({ data: { mode: "live", confirm: "I_UNDERSTAND_LIVE", stakeUsd: 10, maxOrders: 3 } });
      if (res.placed > 0) {
        toast.success(`Placed ${res.placed} live order${res.placed === 1 ? "" : "s"} on Kalshi.`);
      } else {
        toast.info("No live orders placed.", { description: res.skipReasons.slice(0, 3).join(" · ") || "No eligible markets." });
      }
      qc.invalidateQueries({ queryKey: ["auto-trade-orders"] });
      qc.invalidateQueries({ queryKey: ["crypto-trades"] });
    } catch (e: any) {
      toast.error("Live auto-trade failed", { description: e?.message ?? String(e) });
    } finally {
      setLiveBusy(false);
    }
  }

  async function runForce(opts?: { silent?: boolean }) {
    const silent = opts?.silent === true;
    if (!silent) {
      const ok = window.confirm(
        "FORCE LIVE orders on Kalshi at current price?\n\n" +
        "Picks the model's top |edge| markets (UP or DOWN) and places\n" +
        "up to 2 × $10 orders at current Kalshi quotes.\n\n" +
        "BYPASSED: edge/σ/momentum/equity/24h-dedupe/loss-cap gates.\n" +
        "ENFORCED: kill switch, key health, 40 orders in 24h,\n" +
        "auto-exit (TP +70% / SL -50% / edge-decay 2¢).\n\n" +
        "Click OK to proceed.",
      );
      if (!ok) return;
    }
    setForceBusy(true);
    try {
      const res = await runFn({ data: { mode: "live", confirm: "I_UNDERSTAND_LIVE", stakeUsd: 10, maxOrders: 2, force: true } });
      if (res.placed > 0) {
        toast.success(`Forced ${res.placed} order${res.placed === 1 ? "" : "s"}: ${res.orders.map(o => `${o.side === "YES" ? "UP" : "DOWN"} ${o.ticker} @ ${o.limit_cents}¢`).join(", ")}`);
      } else if (!silent) {
        toast.error("Force order not placed", { description: res.skipReasons.slice(0, 3).join(" · ") || "No tradeable market." });
      }
      qc.invalidateQueries({ queryKey: ["auto-trade-orders"] });
      qc.invalidateQueries({ queryKey: ["crypto-trades"] });
    } catch (e: any) {
      if (!silent) toast.error("Force order failed", { description: e?.message ?? String(e) });
    } finally {
      setForceBusy(false);
    }
  }

  // Auto-loop: every 60s, fire force-buy on top model picks. Order cap still applies.
  const [autoLoop, setAutoLoop] = useState<boolean>(() => {
    if (typeof window === "undefined") return false;
    return window.localStorage.getItem("crypto.autoLoop") === "on";
  });
  useEffect(() => {
    if (typeof window !== "undefined") {
      window.localStorage.setItem("crypto.autoLoop", autoLoop ? "on" : "off");
    }
  }, [autoLoop]);
  useEffect(() => {
    if (!autoLoop) return;
    let cancelled = false;
    const tick = async () => { if (!cancelled) await runForce({ silent: true }); };
    tick();
    const h = setInterval(tick, 60_000);
    return () => { cancelled = true; clearInterval(h); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [autoLoop]);

  // Auto-Martingale order placement removed — no loss doubling or Paroli upsize.
  const WINDOW_MS = 15 * 60 * 1000;
  const [autoMart, setAutoMart] = useState<boolean>(() => {
    // Auto-Martingale permanently disabled — remove any persisted "on" state.
    if (typeof window !== "undefined") {
      window.localStorage.removeItem("crypto.autoMart");
    }
    return false;
  });
  // Opt-in chart gate: if ON, auto-mart skips windows where the chart is chop
  // (|score - 50| < CHART_GATE_MIN_SKEW). Default OFF — never blocks unless user turns on.
  const CHART_GATE_MIN_SKEW = 8;
  const [chartGate, setChartGate] = useState<boolean>(() => {
    if (typeof window === "undefined") return false;
    return window.localStorage.getItem("crypto.autoMart.chartGate") === "on";
  });
  useEffect(() => {
    if (typeof window === "undefined") return;
    window.localStorage.setItem("crypto.autoMart.chartGate", chartGate ? "on" : "off");
  }, [chartGate]);
  // Opt-in regime detector (Phase 2). When ON, chart-verdict weights swap
  // based on last-30-min tape (trend / chop / mixed). OFF = static baseline.
  const [regimeOn, setRegimeOn] = useState<boolean>(() => {
    if (typeof window === "undefined") return false;
    return window.localStorage.getItem("crypto.autoMart.regime") === "on";
  });
  useEffect(() => {
    if (typeof window === "undefined") return;
    window.localStorage.setItem("crypto.autoMart.regime", regimeOn ? "on" : "off");
  }, [regimeOn]);
  const marketRegime = useMarketRegime();
  // Opt-in Coinbase second feed (Phase 3). When ON, small ±3 pt flow nudge
  // from Coinbase-Binance mid divergence. OFF = single-venue baseline.
  const [cbFeed, setCbFeed] = useState<boolean>(() => {
    if (typeof window === "undefined") return false;
    return window.localStorage.getItem("crypto.autoMart.cbFeed") === "on";
  });
  useEffect(() => {
    if (typeof window === "undefined") return;
    window.localStorage.setItem("crypto.autoMart.cbFeed", cbFeed ? "on" : "off");
  }, [cbFeed]);
  const coinbase = useCoinbaseBtcSpot();
  // Phase 4 — Round-number magnet gate (proximity + confirmed break).
  const [magnetGate, setMagnetGate] = useState<boolean>(() => {
    if (typeof window === "undefined") return false;
    return window.localStorage.getItem("crypto.autoMart.magnetGate") === "on";
  });
  useEffect(() => {
    if (typeof window === "undefined") return;
    window.localStorage.setItem("crypto.autoMart.magnetGate", magnetGate ? "on" : "off");
  }, [magnetGate]);
  const btcTicks = useBinanceBtcTicks();

  // Trendline gate — skip fires that oppose the trendline+fib bias.
  const [trendGate, setTrendGate] = useState<boolean>(() => {
    if (typeof window === "undefined") return false;
    return window.localStorage.getItem("crypto.autoMart.trendGate") === "on";
  });
  useEffect(() => {
    if (typeof window === "undefined") return;
    window.localStorage.setItem("crypto.autoMart.trendGate", trendGate ? "on" : "off");
  }, [trendGate]);
  const trendAnalysis = useTrendlineAnalysis();

  // Candle momentum gate — big-red forming = SELL (block longs / block window),
  // big-green forming = HOLD (skip fresh entry, existing position is fine).
  const [candleGate, setCandleGate] = useState<boolean>(() => {
    if (typeof window === "undefined") return false;
    return window.localStorage.getItem("crypto.autoMart.candleGate") === "on";
  });
  useEffect(() => {
    if (typeof window === "undefined") return;
    window.localStorage.setItem("crypto.autoMart.candleGate", candleGate ? "on" : "off");
  }, [candleGate]);
  const candleMomentum = useCandleMomentum();
  const chartVerdict = useChartVerdict({
    regime: regimeOn ? marketRegime.regime : "mixed",
    coinbase: cbFeed ? { price: coinbase.price, connected: coinbase.connected } : undefined,
  });

  // Opt-in rolling calibration (Phase 1 of accuracy plan). When ON, shifts the
  // live verdict score by up to ±8 pts based on which score bin has been most
  // profitable in the last 200 settled trades. OFF = identical behavior.
  const [calibrate, setCalibrate] = useState<boolean>(() => {
    if (typeof window === "undefined") return false;
    return window.localStorage.getItem("crypto.autoMart.calibrate") === "on";
  });
  useEffect(() => {
    if (typeof window === "undefined") return;
    window.localStorage.setItem("crypto.autoMart.calibrate", calibrate ? "on" : "off");
  }, [calibrate]);
  const calShift = useCalibrationShift(chartVerdict.score, calibrate);

  // Opt-in Kalshi-sentiment gate: skip windows where ATM YES sits in the chop
  // belt (48–52¢). Uses market consensus instead of Binance ticks.
  const [sentimentGate, setSentimentGate] = useState<boolean>(() => {
    if (typeof window === "undefined") return false;
    return window.localStorage.getItem("crypto.autoMart.sentimentGate") === "on";
  });
  useEffect(() => {
    if (typeof window === "undefined") return;
    window.localStorage.setItem("crypto.autoMart.sentimentGate", sentimentGate ? "on" : "off");
  }, [sentimentGate]);
  const kalshiSentiment = useMemo(
    () => computeKalshiSentiment(marketsQ.data?.markets ?? []),
    [marketsQ.data],
  );

  // Opt-in Round-number gate: skip windows where the ATM strike is NOT a
  // multiple of 50. Round strikes (65000, 65050) act as magnets / S&R levels;
  // non-round strikes (65024, 65037) are unreliable — spot drifts to the
  // nearest round level. Default OFF.
  const ROUND_STEP = 50;
  const [roundGate, setRoundGate] = useState<boolean>(() => {
    if (typeof window === "undefined") return false;
    return window.localStorage.getItem("crypto.autoMart.roundGate") === "on";
  });
  useEffect(() => {
    if (typeof window === "undefined") return;
    window.localStorage.setItem("crypto.autoMart.roundGate", roundGate ? "on" : "off");
  }, [roundGate]);

  // Opt-in HTF (5m EMA20/50) trend gate — only fires when auto-mart's intended
  // side agrees with the higher-timeframe trend. Default OFF.
  const [htfGate, setHtfGate] = useState<boolean>(() => {
    if (typeof window === "undefined") return false;
    return window.localStorage.getItem("crypto.autoMart.htfGate") === "on";
  });
  useEffect(() => {
    if (typeof window === "undefined") return;
    window.localStorage.setItem("crypto.autoMart.htfGate", htfGate ? "on" : "off");
  }, [htfGate]);

  // Opt-in ETH agreement gate — skip windows when BTC and ETH are moving
  // in opposite directions (>0.1% each, opposite signs). Default OFF.
  const [ethGate, setEthGate] = useState<boolean>(() => {
    if (typeof window === "undefined") return false;
    return window.localStorage.getItem("crypto.autoMart.ethGate") === "on";
  });
  useEffect(() => {
    if (typeof window === "undefined") return;
    window.localStorage.setItem("crypto.autoMart.ethGate", ethGate ? "on" : "off");
  }, [ethGate]);

  // Server-side "NO-side only" auto-trade filter — persisted to auto_odds_settings.vp_no_only.
  // When ON, auto-trader skips value-picks whose side = YES. Backtest: +3.8% ROI vs +1.8% blind.
  const [vpNoOnly, setVpNoOnly] = useState<boolean>(false);
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const { data: u } = await supabase.auth.getUser();
        const uid = u?.user?.id;
        if (!uid || cancelled) return;
        const { data: row } = await supabase
          .from("auto_odds_settings")
          .select("vp_no_only")
          .eq("user_id", uid)
          .maybeSingle();
        if (!cancelled) setVpNoOnly(Boolean((row as { vp_no_only?: boolean } | null)?.vp_no_only));
      } catch { /* ignore */ }
    })();
    return () => { cancelled = true; };
  }, []);
  const toggleVpNoOnly = async () => {
    const next = !vpNoOnly;
    setVpNoOnly(next);
    try {
      const { data: u } = await supabase.auth.getUser();
      const uid = u?.user?.id;
      if (!uid) return;
      await supabase.from("auto_odds_settings").upsert(
        { user_id: uid, vp_no_only: next },
        { onConflict: "user_id" },
      );
    } catch { /* non-fatal */ }
  };







  useEffect(() => {
    if (typeof window === "undefined") return;
    window.localStorage.setItem("crypto.autoMart", autoMart ? "on" : "off");
  }, [autoMart]);

  // ============================================================
  // Auto-Odds bet: $100 every 15m window based on Kalshi odds, NOT model.
  //   Phase 1 (>12:30 remaining): monitor only, do not fire.
  //   Phase 2 (12:30 → 2:00 remaining): fire on side whose American odds ∈ [-750, -450].
  //   Phase 3 (≤2:00 remaining): fire on side ≤ -300 (deeper favorite).
  //   Phase 4 (final ≤15s): fire on side closest to [-750, -450].
  // Fires once per 15m window. Mutually exclusive with Auto-Martingale.
  // ============================================================
  const AUTO_ODDS_STAKE = 10;
  const [autoOdds, setAutoOdds] = useState<boolean>(() => {
    if (typeof window === "undefined") return false;
    return window.localStorage.getItem("crypto.autoOdds") === "on";
  });
  const [autoOddsLosses, setAutoOddsLosses] = useState<number>(() => {
    if (typeof window === "undefined") return 0;
    return Number(window.localStorage.getItem("crypto.autoOdds.losses")) || 0;
  });
  useEffect(() => {
    if (typeof window === "undefined") return;
    window.localStorage.setItem("crypto.autoOdds", autoOdds ? "on" : "off");
  }, [autoOdds]);
  useEffect(() => {
    if (typeof window === "undefined") return;
    window.localStorage.setItem("crypto.autoOdds.losses", String(autoOddsLosses));
  }, [autoOddsLosses]);
  // Mirror Auto-Odds on/off + loss count to the DB (server-of-record).
  // Purely additive — client-side loop remains authoritative. Used by
  // upcoming server-side tick (turn 2+) to know whether to trade for you.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const { data: u } = await supabase.auth.getUser();
        const uid = u?.user?.id;
        if (!uid || cancelled) return;
        if (autoOdds) {
          // Turning Auto-Odds ON: claim the settings row for odds_bet.
          await supabase.from("auto_odds_settings").upsert({
            user_id: uid,
            enabled: true,
            consecutive_losses: autoOddsLosses,
            auto_button_type: "odds_bet",
            stopped_reason: null,
          }, { onConflict: "user_id" });
        } else {
          // Turning Auto-Odds OFF: only clear if this row is currently odds_bet;
          // never clobber a Model Bet row.
          await supabase.from("auto_odds_settings")
            .update({
              enabled: false,
              consecutive_losses: autoOddsLosses,
              stopped_reason: autoOddsLosses >= 3 ? "three_losses" : null,
            })
            .eq("user_id", uid)
            .eq("auto_button_type", "odds_bet");
        }
      } catch { /* non-fatal; client loop still runs */ }
    })();
    return () => { cancelled = true; };
  }, [autoOdds, autoOddsLosses]);


  // Sync FROM the server (auto_odds_settings) every 20s so a server-side
  // 2-loss stop turns the UI off, and other tabs see the same state.
  useEffect(() => {
    let cancelled = false;
    const sync = async () => {
      try {
        const { data: u } = await supabase.auth.getUser();
        const uid = u?.user?.id;
        if (!uid || cancelled) return;
        const { data: row } = await supabase
          .from("auto_odds_settings")
          .select("enabled, consecutive_losses, stopped_reason, auto_button_type")
          .eq("user_id", uid)
          .maybeSingle();
        if (cancelled || !row) return;
        // Ignore rows owned by Model Bet — don't flip Auto-Odds UI from a model_bet row.
        if (row.auto_button_type && row.auto_button_type !== "odds_bet") return;
        if (row.enabled !== autoOdds) {
          setAutoOdds(row.enabled);
          if (typeof window !== "undefined") {
            window.localStorage.setItem("crypto.autoOdds", row.enabled ? "on" : "off");
          }
          if (!row.enabled && row.stopped_reason === "three_losses") {
            toast.error("Auto-Odds stopped by server — 3 losing trades in a row", {
              duration: 30_000,
              action: {
                label: "Re-enable",
                onClick: () => {
                  setAutoOdds(true);
                  setAutoOddsLosses(0);
                  if (typeof window !== "undefined") {
                    window.localStorage.setItem("crypto.autoOdds", "on");
                  }
                },
              },
            });
          }
          if (!row.enabled && row.stopped_reason === "daily_5_losses") {
            toast.error("Auto-Odds stopped — 5 losing trades today. Locked until midnight ET.");
          }



        }
        if ((row.consecutive_losses ?? 0) !== autoOddsLosses) {
          setAutoOddsLosses(row.consecutive_losses ?? 0);
        }
      } catch { /* ignore */ }
    };
    sync();
    const h = setInterval(sync, 20_000);
    return () => { cancelled = true; clearInterval(h); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);


  // Mutual exclusion: turning on Auto-Odds disables Auto-Martingale + Model Bet.
  useEffect(() => {
    if (!autoOdds) return;
    if (autoMart) setAutoMart(false);
    if (typeof window !== "undefined") {
      window.localStorage.setItem("crypto.modelBet", "off");
      window.dispatchEvent(new CustomEvent("crypto.autoBet.mutex", { detail: "autoOdds" }));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [autoOdds]);

  // Mutual exclusion: turning on Auto-Martingale disables Auto-Odds + Model Bet.
  useEffect(() => {
    if (!autoMart) return;
    if (autoOdds) setAutoOdds(false);
    if (typeof window !== "undefined") {
      window.localStorage.setItem("crypto.modelBet", "off");
      window.dispatchEvent(new CustomEvent("crypto.autoBet.mutex", { detail: "autoMart" }));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [autoMart]);

  // Listen for Model Bet turning ON — sync self OFF.
  useEffect(() => {
    const onMutex = (e: Event) => {
      const which = (e as CustomEvent).detail;
      if (which === "modelBet") {
        if (autoOdds) setAutoOdds(false);
        if (autoMart) setAutoMart(false);
      }
    };
    window.addEventListener("crypto.autoBet.mutex", onMutex as EventListener);
    return () => window.removeEventListener("crypto.autoBet.mutex", onMutex as EventListener);
  }, [autoOdds, autoMart]);


  // Auto-Odds safety stop: two consecutive losing odds-bet trades turns Auto-Odds off.
  useEffect(() => {
    if (typeof window === "undefined") return;
    let taggedIds: string[] = [];
    try {
      const raw = window.localStorage.getItem("crypto.autoOdds.oids");
      taggedIds = raw ? JSON.parse(raw) : [];
    } catch { taggedIds = []; }
    if (!taggedIds.length) return;

    let processedIds: string[] = [];
    try {
      const raw = window.localStorage.getItem("crypto.autoOdds.processedSettles");
      processedIds = raw ? JSON.parse(raw) : [];
    } catch { processedIds = []; }
    const processed = new Set(processedIds);
    const tagged = new Set(taggedIds);
    const newlySettled = liveOrders
      .filter(o => tagged.has(o.id) && !processed.has(o.id) && (o.status === "settled_win" || o.status === "settled_loss"))
      .sort((a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime());
    if (!newlySettled.length) return;

    let nextLosses = autoOddsLosses;
    for (const o of newlySettled) {
      processed.add(o.id);
      nextLosses = o.status === "settled_loss" ? nextLosses + 1 : 0;
    }

    window.localStorage.setItem("crypto.autoOdds.processedSettles", JSON.stringify(Array.from(processed).slice(-100)));
    setAutoOddsLosses(nextLosses);
    // Consecutive-loss auto-stop DISABLED per user request (overnight run).
    // Losses are still tracked in state for display, but never disable Auto-Odds.
    // To re-enable, restore the `if (nextLosses >= 3) { setAutoOdds(false); ... }` block.
  }, [liveOrders, autoOddsLosses]);

  // Numeric American odds from Kalshi ¢ (favorites negative, dogs positive).
  const centsToAmericanNum = (cents: number): number => {
    const p = Math.max(0.01, Math.min(0.99, cents / 100));
    return p >= 0.5 ? -Math.round((p / (1 - p)) * 100) : Math.round(((1 - p) / p) * 100);
  };

  async function runOddsBet(ticker: string, side: "YES" | "NO", reason: string): Promise<string | null> {
    try {
      const res = await runFn({ data: { mode: "live", confirm: "I_UNDERSTAND_LIVE", stakeUsd: AUTO_ODDS_STAKE, maxOrders: 1, force: true, forceTicker: ticker, forceSide: side } });
      if (res.placed > 0 && res.orders?.[0]) {
        const o = res.orders[0];
        if (soundOn) { playOrderPlaced(); setTimeout(() => playOrderFilled(), 200); }
        toast.success(`Odds-bet $${AUTO_ODDS_STAKE}: ${side === "YES" ? "UP" : "DOWN"} ${ticker} @ ${o.limit_cents}¢ — ${reason}`);
        // Tag this order as an odds-bet trade so the whipsaw-exit watcher owns it.
        try {
          const raw = window.localStorage.getItem("crypto.autoOdds.oids");
          const oids: string[] = raw ? JSON.parse(raw) : [];
          if (o.id && !oids.includes(o.id)) oids.push(o.id);
          window.localStorage.setItem("crypto.autoOdds.oids", JSON.stringify(oids.slice(-50)));
        } catch { /* ignore */ }
        // Also mirror into DB so the server-side tick can run whipsaw/loss-stop
        // even when this browser tab closes. Non-fatal if it fails.
        try {
          const { data: u } = await supabase.auth.getUser();
          const uid = u?.user?.id;
          if (uid && o.id) {
            const entryCents = o.entry_price_cents ?? o.limit_cents;
            await supabase.from("auto_odds_tracked_orders").insert({
              user_id: uid,
              order_id: o.id,
              entry_side: o.side,
              entry_odds: centsToAmericanNum(entryCents),
            });
          }
        } catch { /* ignore — server can also insert on its own placements */ }
        qc.invalidateQueries({ queryKey: ["auto-trade-orders"] });
        return o.id ?? null;
      }
      // Hide the informational "equity: …" and "force: …" lines — those are
      // always pushed even on success. Surface the actual failure reason
      // (typically "IOC 0-fill @ Nc — no position taken").
      const realReasons = res.skipReasons.filter(r => !/^(equity:|force:)/i.test(r));
      toast.info(`Odds-bet skipped: ${(realReasons.length ? realReasons : res.skipReasons).slice(0, 2).join(" · ") || "no fill"}`);
      return null;
    } catch (e: any) {
      toast.error("Odds-bet failed", { description: e?.message ?? String(e) });
      return null;
    }
  }

  useEffect(() => {
    if (!autoOdds) return;
    if (typeof window === "undefined") return;
    let cancelled = false;
    let inFlight = false;
    const tick = async () => {
      if (cancelled || inFlight) return;
      if (isKalshiMaintenanceWindow()) return; // Kalshi Thu 02:30–05:30 ET
      const now = Date.now();
      const currentWindow = Math.floor(now / WINDOW_MS) * WINDOW_MS;
      const remainingMs = WINDOW_MS - (now - currentWindow);
      const lastWindow = Number(window.localStorage.getItem("crypto.autoOdds.lastWindowMs")) || 0;
      if (currentWindow === lastWindow) return;

      // Phase 1: monitor only until 12:30 remaining.
      if (remainingMs > 12 * 60_000 + 30_000) return;

      const markets = marketsQ.data?.markets ?? [];
      // (window derived from Date.now() above)
      // Only markets closing within this 15m window.
      const active = markets.filter(m => m.secondsToClose > 0 && m.secondsToClose <= 15 * 60 + 60);
      if (active.length === 0) return;
      const spotRef = active[0].spot ?? 0;
      // ATM = strike closest to spot.
      const atm = active.slice().sort((a, b) => Math.abs(a.strike - spotRef) - Math.abs(b.strike - spotRef))[0];
      const yesCents = Math.max(1, Math.min(99, Math.round((atm.yesAsk || atm.yesPrice) * 100)));
      const noCents = Math.max(1, Math.min(99, Math.round((atm.noAsk || (1 - atm.yesPrice)) * 100)));
      const yesAm = centsToAmericanNum(yesCents);
      const noAm = centsToAmericanNum(noCents);

      const inRange = (a: number) => a <= -450 && a >= -750;

      let pick: { side: "YES" | "NO"; reason: string } | null = null;

      if (remainingMs > 0) {
        // STRICT band [-750,-450] in all phases — no -300 fallback.
        const yesIn = inRange(yesAm), noIn = inRange(noAm);
        if (yesIn && !noIn) pick = { side: "YES", reason: `YES ${yesAm} in [-750,-450]` };
        else if (noIn && !yesIn) pick = { side: "NO", reason: `NO ${noAm} in [-750,-450]` };
        else if (yesIn && noIn) pick = yesAm < noAm ? { side: "YES", reason: `both in-range, YES deeper ${yesAm}` } : { side: "NO", reason: `both in-range, NO deeper ${noAm}` };
      }

      if (!pick) return; // keep watching

      // Hard cap: strict [-750,-450] and ≤89¢. Mirrors server tick.
      const pickCents = pick.side === "YES" ? yesCents : noCents;
      const pickAm = pick.side === "YES" ? yesAm : noAm;
      if (pickCents > 89 || pickAm < -750 || pickAm > -450) return;

      inFlight = true;
      // Claim window before async call to prevent double-fire.
      window.localStorage.setItem("crypto.autoOdds.lastWindowMs", String(currentWindow));
      const orderId = await runOddsBet(atm.ticker, pick.side, pick.reason);
      if (!orderId) {
        // Placement failed/skipped — allow retry next tick.
        window.localStorage.removeItem("crypto.autoOdds.lastWindowMs");
      }
      inFlight = false;
      
    };
    tick();
    const h = setInterval(tick, 5_000);
    return () => { cancelled = true; clearInterval(h); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [autoOdds, marketsQ.data]);

  // ── Whipsaw exit for Odds-Bet trades ──────────────────────────────────────
  // Rule: after entry, once current American odds move ≥200 away from entry
  // in EITHER direction AND then return to within ±50 of entry, market-sell
  // whatever contracts remain. Disabled in the final 60s of the window.
  // Only touches orders tagged via crypto.autoOdds.oids. Model + martingale
  // trades are untouched.
  useEffect(() => {
    if (typeof window === "undefined") return;
    let cancelled = false;
    let inFlight = false;

    const tick = async () => {
      if (cancelled || inFlight) return;
      if (isKalshiMaintenanceWindow()) return; // Kalshi Thu 02:30–05:30 ET
      let oids: string[] = [];
      try {
        const raw = window.localStorage.getItem("crypto.autoOdds.oids");
        oids = raw ? JSON.parse(raw) : [];
      } catch { oids = []; }
      if (oids.length === 0) return;

      // Match orders still open (not settled, still holding contracts).
      const openOdds = liveOrders.filter(o =>
        oids.includes(o.id)
        && o.status !== "settled_win" && o.status !== "settled_loss" && o.status !== "cancelled" && o.status !== "sold"
        && (o.contracts_remaining ?? o.contracts) > 0
        && o.entry_price_cents != null,
      );
      if (openOdds.length === 0) return;

      const markets = marketsQ.data?.markets ?? [];

      for (const o of openOdds) {
        const m = markets.find(mm => mm.ticker === o.ticker);
        if (!m) continue;
        if (m.secondsToClose <= 60) continue; // C: disable in final 60s

        const entryCents = o.entry_price_cents ?? o.limit_cents;
        const entryAm = centsToAmericanNum(entryCents);
        const curCentsSide = o.side === "YES" ? (m.yesAsk || m.yesPrice) : (m.noAsk || (1 - m.yesPrice));
        const curCents = Math.max(1, Math.min(99, Math.round(curCentsSide * 100)));
        const curAm = centsToAmericanNum(curCents);

        const stateKey = `crypto.autoOdds.wsState.${o.id}`;
        let extremeHit = window.localStorage.getItem(stateKey) === "1";
        if (!extremeHit && Math.abs(curAm - entryAm) >= 200) {
          extremeHit = true;
          window.localStorage.setItem(stateKey, "1");
        }
        const whipsawFire = extremeHit && Math.abs(curAm - entryAm) <= 50;

        // 40% implied-prob exit: fire when current implied prob on our side
        // drops to <= 40% of entry implied prob.
        const impliedProb = (am: number) => am < 0 ? (-am) / ((-am) + 100) : 100 / (am + 100);
        const entryProb = impliedProb(entryAm);
        const curProb = impliedProb(curAm);
        const probFire = entryProb > 0 && curProb <= 0.4 * entryProb;

        if (whipsawFire || probFire) {
          const reason = whipsawFire ? "whipsaw" : "prob40";
          inFlight = true;
          try {
            const res = await sellOddsFn({ data: { orderId: o.id, reason } });
            if (res.ok) {
              const label = whipsawFire ? "whipsaw" : "40% prob";
              toast.info(`Odds-bet ${label} exit: ${o.ticker} ${o.side === "YES" ? "UP" : "DOWN"} · ${res.message} (entry ${entryAm}, cur ${curAm})`);
              window.localStorage.removeItem(stateKey);
              qc.invalidateQueries({ queryKey: ["auto-trade-orders"] });
            } else {
              console.warn(`${reason} sell skipped:`, res.message);
            }
          } catch (e: any) {
            console.error("odds-bet exit failed", e);
          }
          inFlight = false;
        }
      }
    };

    tick();
    const h = setInterval(tick, 5_000);
    return () => { cancelled = true; clearInterval(h); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [liveOrders, marketsQ.data]);



  // Live status for the Auto-Odds panel — computed every render so the user
  // can see WHY it hasn't fired yet (phase, current YES/NO American odds).
  const [nowMs, setNowMs] = useState<number>(() => Date.now());
  useEffect(() => {
    if (!autoOdds) return;
    const h = setInterval(() => setNowMs(Date.now()), 1000);
    return () => clearInterval(h);
  }, [autoOdds]);
  const oddsStatus = (() => {
    if (!autoOdds) return null;
    const markets = marketsQ.data?.markets ?? [];
    const active = markets.filter(m => m.secondsToClose > 0 && m.secondsToClose <= 15 * 60 + 60);
    if (active.length === 0) return { phase: "waiting for market", yesAm: null as number | null, noAm: null as number | null, remaining: 0, ticker: "", strike: 0 };
    const spotRef = active[0].spot ?? 0;
    const atm = active.slice().sort((a, b) => Math.abs(a.strike - spotRef) - Math.abs(b.strike - spotRef))[0];
    const currentWindow = Math.floor(nowMs / WINDOW_MS) * WINDOW_MS;
    const remainingMs = WINDOW_MS - (nowMs - currentWindow);
    const yesCents = Math.max(1, Math.min(99, Math.round((atm.yesAsk || atm.yesPrice) * 100)));
    const noCents = Math.max(1, Math.min(99, Math.round((atm.noAsk || (1 - atm.yesPrice)) * 100)));
    const yesAm = centsToAmericanNum(yesCents);
    const noAm = centsToAmericanNum(noCents);
    const phase =
      remainingMs > 12 * 60_000 + 30_000 ? "monitoring (>12:30)" :
      remainingMs > 2 * 60_000 ? "scanning −450 to −750" :
      remainingMs > 15_000 ? "fallback ≤−300" :
      remainingMs > 0 ? "final 15s: closest side" : "window closed";
    return { phase, yesAm, noAm, remaining: Math.max(0, Math.floor(remainingMs / 1000)), ticker: atm.ticker, strike: atm.strike };
  })();





  return (
    <div className="space-y-2">
    <NextStakeBanner />
    <OpenPositions markets={markets} />
    <div className="border border-border rounded-lg bg-card">


      <div className="px-4 py-2 border-b border-border flex items-center justify-between flex-wrap gap-2">
        <div>
          <h2 className="text-sm uppercase tracking-wider text-muted-foreground flex items-center gap-2 flex-wrap">
            Live Kalshi auto-trade
            <span className="text-[10px] px-2 py-0.5 rounded bg-emerald-500/15 text-emerald-400 border border-emerald-500/30 flex items-center gap-1">
              <span className="h-1.5 w-1.5 rounded-full bg-emerald-400 animate-pulse" /> AUTO
            </span>
            <PolymarketChip />
          </h2>
          <p className="text-[11px] text-muted-foreground">
            $20×3/click · entry: EV≥3¢, edge≥5pts, σ≥1.25 · ladder: +6¢ →50%, +12¢ →100%, -15¢ →SL · fallbacks: TP+70%/SL-50%/flip/net-lock · halt 40 orders or -$80/24h
          </p>
          <p className="text-[10px] text-muted-foreground mt-0.5">
            Live 24h: {liveCount24h}/40 orders · realized <span className={liveRealized24h >= 0 ? "text-emerald-400" : "text-red-400"}>{liveRealized24h >= 0 ? "+" : ""}${liveRealized24h.toFixed(2)}</span>
          </p>
          <OddsFlipAlert />
          <BigFlipMonitor />

          {skipReport.data && skipReport.data.totalSettled > 0 && (
            <div className="mt-1.5 rounded border border-border/60 bg-muted/10 px-2 py-1.5 text-[10px]">
              <div className="font-mono text-muted-foreground">
                <span className="font-semibold text-foreground">Skip counterfactual (7d):</span>{" "}
                {skipReport.data.totalSettled} settled ·{" "}
                <span className="text-emerald-400">{skipReport.data.wouldHaveWon}W</span> /{" "}
                <span className="text-red-400">{skipReport.data.wouldHaveLost}L</span> ·{" "}
                would-have PnL{" "}
                <span className={skipReport.data.wouldHavePnlUsd >= 0 ? "text-red-400" : "text-emerald-400"} title={skipReport.data.wouldHavePnlUsd >= 0 ? "Gates too tight — missed profits" : "Gates saving money — skipped losers"}>
                  {skipReport.data.wouldHavePnlUsd >= 0 ? "+" : ""}${skipReport.data.wouldHavePnlUsd.toFixed(2)}
                </span>
              </div>
              {skipReport.data.byReason.length > 0 && (
                <div className="mt-1 flex flex-wrap gap-x-3 gap-y-0.5 font-mono text-muted-foreground">
                  {skipReport.data.byReason.slice(0, 6).map(b => (
                    <span key={b.reason} title={`${(b.winRate*100).toFixed(0)}% would-have-win · pnl ${b.pnl>=0?"+":""}$${b.pnl.toFixed(2)}`}>
                      <span className="text-foreground">{b.reason}</span>: {b.count}× ({(b.winRate*100).toFixed(0)}%)
                    </span>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>
        <div className="flex items-center gap-3 flex-wrap">
          <div className="text-xs font-mono text-muted-foreground">
            {liveTotals.placed} live placed · <span className="text-emerald-400">{liveTotals.wins}W</span> / <span className="text-red-400">{liveTotals.losses}L</span> · PnL <span className={liveTotals.pnlUsd >= 0 ? "text-emerald-400" : "text-red-400"}>{liveTotals.pnlUsd >= 0 ? "+" : ""}${liveTotals.pnlUsd.toFixed(2)}</span>
          </div>
          <button
            onClick={() => { setSoundOn(s => !s); if (!soundOn) playOrderPlaced(); }}
            className="text-xs font-semibold p-1.5 rounded border border-border bg-muted/30 hover:bg-muted/50 flex items-center"
            title={soundOn ? "Order sounds on — click to mute" : "Order sounds muted — click to enable"}
            aria-label={soundOn ? "Mute order sounds" : "Unmute order sounds"}
          >
            {soundOn ? <Volume2 className="h-3.5 w-3.5" /> : <VolumeX className="h-3.5 w-3.5 text-muted-foreground" />}
          </button>
          <button
            onClick={() => { setSoundOn(s => !s); if (!soundOn) playOrderPlaced(); }}
            className="text-xs font-semibold p-1.5 rounded border border-border bg-muted/30 hover:bg-muted/50 flex items-center"
            title={soundOn ? "Order sounds on — click to mute" : "Order sounds muted — click to enable"}
            aria-label={soundOn ? "Mute order sounds" : "Unmute order sounds"}
          >
            {soundOn ? <Volume2 className="h-3.5 w-3.5" /> : <VolumeX className="h-3.5 w-3.5 text-muted-foreground" />}
          </button>
          <button
            onClick={testKalshi}
            disabled={testBusy}
            className="text-xs font-semibold px-3 py-1.5 rounded border border-border bg-muted/30 hover:bg-muted/50 disabled:opacity-50 flex items-center gap-1.5"
            title="Read-only: signs a request to Kalshi /portfolio/balance to verify credentials"
          >
            {testBusy ? <Loader2 className="h-3 w-3 animate-spin" /> : <CheckCircle2 className="h-3 w-3" />}
            {testBusy ? "Testing…" : "Test Kalshi connection"}
          </button>
          <button
            onClick={runDiagnostics}
            disabled={diagBusy}
            className="text-xs font-semibold px-3 py-1.5 rounded border border-amber-500/40 bg-amber-500/10 text-amber-400 hover:bg-amber-500/20 disabled:opacity-50 flex items-center gap-1.5"
            title="Step-by-step auth diagnostics: env, PEM, RSA-PSS sign, signed GET /portfolio/balance, clock skew"
          >
            {diagBusy ? <Loader2 className="h-3 w-3 animate-spin" /> : <CheckCircle2 className="h-3 w-3" />}
            {diagBusy ? "Diagnosing…" : "Diagnose auth"}
          </button>
          <button
            onClick={runLive}
            disabled={liveBusy}
            className="text-xs font-semibold px-3 py-1.5 rounded border border-red-500/40 bg-red-500/10 text-red-400 hover:bg-red-500/20 disabled:opacity-50 flex items-center gap-1.5"
            title="Place real-money Kalshi orders with strict guardrails"
          >
            {liveBusy ? <Loader2 className="h-3 w-3 animate-spin" /> : <Zap className="h-3 w-3" />}
            {liveBusy ? "Placing…" : "Run LIVE auto-trade"}
          </button>
          <button
            onClick={() => setAutoLoop(v => !v)}
            className={`text-xs font-semibold px-3 py-1.5 rounded border flex items-center gap-1.5 ${autoLoop ? "border-emerald-500/50 bg-emerald-500/15 text-emerald-300" : "border-border bg-muted/30 hover:bg-muted/50"}`}
            title="Auto-loop: every 60s, force-buy top model picks (up to 2 × $20). The 40-order cap still applies."
          >
            <span className={`h-1.5 w-1.5 rounded-full ${autoLoop ? "bg-emerald-400 animate-pulse" : "bg-muted-foreground"}`} />
            {autoLoop ? "Auto-loop ON (60s)" : "Auto-loop OFF"}
          </button>
          {/* Auto-Martingale button removed — martingale doubling causes asymmetric losses. */}
          <button
            onClick={() => {
              if (!autoOdds) {
                const ok = window.confirm(
                  "ENABLE AUTO-ODDS BET (LIVE, REAL MONEY)?\n\n" +
                  "• $100 per 15m window · ignores model pick\n" +
                  "• Monitors first 2:30 of window\n" +
                  "• 12:30 → 2:00 remaining: fires on side with odds in -450 to -750\n" +
                  "• ≤ 2:00 remaining: fallback fires on side ≤ -300\n" +
                  "• Final seconds: fires on side closest to the range\n" +
                  "• Turning this ON disables Auto-Martingale.",
                );
                if (!ok) return;
              }
              setAutoOdds(v => !v);
            }}
            className={`text-xs font-semibold px-3 py-1.5 rounded border flex items-center gap-1.5 ${autoOdds ? "border-amber-500/50 bg-amber-500/15 text-amber-300" : "border-border bg-muted/30 hover:bg-muted/50"}`}
            title="Auto-Odds: $100/window on side with odds -450 to -750 (fallback -300 near close). Ignores model pick."
          >
            <span className={`h-1.5 w-1.5 rounded-full ${autoOdds ? "bg-amber-400 animate-pulse" : "bg-muted-foreground"}`} />
            {autoOdds ? `Odds-Bet ON · $${AUTO_ODDS_STAKE}` : "Odds-Bet OFF"}
          </button>
          {(autoMart || autoOdds) && <MartingaleCountdown windowMs={WINDOW_MS} />}
          {autoOdds && oddsStatus && (
            <div className="text-[10px] font-mono px-2 py-1 rounded border border-amber-500/40 bg-amber-500/10 text-amber-200 flex items-center gap-2 whitespace-nowrap">
              <span className="uppercase tracking-wider opacity-80">{oddsStatus.phase}</span>
              <span className="opacity-60">·</span>
              <span>UP <span className={oddsStatus.yesAm != null && oddsStatus.yesAm <= -450 && oddsStatus.yesAm >= -750 ? "text-emerald-300 font-bold" : ""}>{oddsStatus.yesAm ?? "—"}</span></span>
              <span>DOWN <span className={oddsStatus.noAm != null && oddsStatus.noAm <= -450 && oddsStatus.noAm >= -750 ? "text-emerald-300 font-bold" : ""}>{oddsStatus.noAm ?? "—"}</span></span>
              <span className="opacity-60">·</span>
              <span>{Math.floor(oddsStatus.remaining / 60)}:{String(oddsStatus.remaining % 60).padStart(2, "0")}</span>
            </div>
          )}


          <ChartVerdictBadge compact />
          <KalshiSentimentBadge s={kalshiSentiment} compact />
          {autoMart && (
            <button
              onClick={() => setChartGate(v => !v)}
              className={`text-[10px] font-semibold px-2 py-1.5 rounded border flex items-center gap-1 ${chartGate ? "border-cyan-500/50 bg-cyan-500/15 text-cyan-300" : "border-border bg-muted/30 hover:bg-muted/50"}`}
              title={chartGate
                ? `Chart gate ON: skip fire when |score-50| < ${CHART_GATE_MIN_SKEW} (chop). Current: ${chartVerdict.ready ? chartVerdict.score.toFixed(0) : "…"}`
                : "Chart gate OFF: fire every window regardless of chart bias"}
            >
              <span className={`h-1.5 w-1.5 rounded-full ${chartGate ? "bg-cyan-400 animate-pulse" : "bg-muted-foreground"}`} />
              {chartGate ? "Chart gate ON" : "Chart gate OFF"}
            </button>
          )}
          {autoMart && (
            <button
              onClick={() => setCalibrate(v => !v)}
              className={`text-[10px] font-semibold px-2 py-1.5 rounded border flex items-center gap-1 ${calibrate ? "border-emerald-500/50 bg-emerald-500/15 text-emerald-300" : "border-border bg-muted/30 hover:bg-muted/50"}`}
              title={calibrate
                ? `Calibrate ON: shift live verdict by ±8 pts based on your last 200 settled trades. Current shift: ${calShift.ready ? (calShift.shift >= 0 ? "+" : "") + calShift.shift.toFixed(1) + " pts" : "warming up"} · ${calShift.note}`
                : "Calibrate OFF: no adjustment to verdict score"}
            >
              <span className={`h-1.5 w-1.5 rounded-full ${calibrate ? "bg-emerald-400 animate-pulse" : "bg-muted-foreground"}`} />
              {calibrate ? `Cal ${calShift.ready ? (calShift.shift >= 0 ? "+" : "") + calShift.shift.toFixed(1) : "…"}` : "Calibrate OFF"}
            </button>
          )}
          {autoMart && (
            <button
              onClick={() => setRegimeOn(v => !v)}
              className={`text-[10px] font-semibold px-2 py-1.5 rounded border flex items-center gap-1 ${regimeOn ? "border-teal-500/50 bg-teal-500/15 text-teal-300" : "border-border bg-muted/30 hover:bg-muted/50"}`}
              title={regimeOn
                ? `Regime ON: dynamic verdict weights. Current: ${marketRegime.ready ? marketRegime.reason : "warming up"}`
                : "Regime OFF: static verdict weights (baseline)"}
            >
              <span className={`h-1.5 w-1.5 rounded-full ${regimeOn ? "bg-teal-400 animate-pulse" : "bg-muted-foreground"}`} />
              {regimeOn ? `Regime ${marketRegime.ready ? marketRegime.regime.toUpperCase() : "…"}` : "Regime OFF"}
            </button>
          )}
          {autoMart && (
            <button
              onClick={() => setCbFeed(v => !v)}
              className={`text-[10px] font-semibold px-2 py-1.5 rounded border flex items-center gap-1 ${cbFeed ? "border-blue-500/50 bg-blue-500/15 text-blue-300" : "border-border bg-muted/30 hover:bg-muted/50"}`}
              title={cbFeed
                ? `Coinbase feed ON: ±3 pt flow nudge on >2 bps Binance/Coinbase divergence. CB: ${coinbase.connected ? "$" + (coinbase.price?.toFixed(0) ?? "…") : "connecting…"}`
                : "Coinbase feed OFF: single-venue (Binance) only"}
            >
              <span className={`h-1.5 w-1.5 rounded-full ${cbFeed && coinbase.connected ? "bg-blue-400 animate-pulse" : "bg-muted-foreground"}`} />
              {cbFeed ? `CB ${coinbase.connected ? "ON" : "…"}` : "CB Feed OFF"}
            </button>
          )}
          {autoMart && (
            <button
              onClick={() => setMagnetGate(v => !v)}
              className={`text-[10px] font-semibold px-2 py-1.5 rounded border flex items-center gap-1 ${magnetGate ? "border-fuchsia-500/50 bg-fuchsia-500/15 text-fuchsia-300" : "border-border bg-muted/30 hover:bg-muted/50"}`}
              title={magnetGate
                ? `Magnet gate ON: skip fire when spot is within 5 bps of a $50/$100 level unless break confirmed by 3× 15s closes.`
                : "Magnet gate OFF: fire regardless of round-level proximity"}
            >
              <span className={`h-1.5 w-1.5 rounded-full ${magnetGate ? "bg-fuchsia-400 animate-pulse" : "bg-muted-foreground"}`} />
              {magnetGate ? "Magnet ON" : "Magnet OFF"}
            </button>
          )}
          {autoMart && (
            <button
              onClick={() => setTrendGate(v => !v)}
              className={`text-[10px] font-semibold px-2 py-1.5 rounded border flex items-center gap-1 ${trendGate ? "border-orange-500/50 bg-orange-500/15 text-orange-300" : "border-border bg-muted/30 hover:bg-muted/50"}`}
              title={trendGate
                ? `Trendline gate ON: skip fires that oppose the trendline+fib bias. Current: ${trendAnalysis.ready ? trendAnalysis.bias.toUpperCase() + " · " + trendAnalysis.reason : "warming up"}`
                : "Trendline gate OFF: fire regardless of trendline analysis"}
            >
              <span className={`h-1.5 w-1.5 rounded-full ${trendGate ? "bg-orange-400 animate-pulse" : "bg-muted-foreground"}`} />
              {trendGate ? `Trend ${trendAnalysis.ready ? trendAnalysis.bias.toUpperCase() : "…"}` : "Trend OFF"}
            </button>
          )}
          {autoMart && (
            <button
              onClick={() => setCandleGate(v => !v)}
              className={`text-[10px] font-semibold px-2 py-1.5 rounded border flex items-center gap-1 ${candleGate ? "border-lime-500/50 bg-lime-500/15 text-lime-300" : "border-border bg-muted/30 hover:bg-muted/50"}`}
              title={candleGate
                ? `Candle gate ON: skip window if big-red (sell) or big-green (hold) forming. Current: ${candleMomentum.ready ? candleMomentum.forecast.replace("_", " ").toUpperCase() + " · " + candleMomentum.forecastReason : "warming up"}`
                : "Candle gate OFF: fire regardless of forming candle strength"}
            >
              <span className={`h-1.5 w-1.5 rounded-full ${candleGate ? (candleMomentum.forecast === "big_red" ? "bg-rose-400 animate-pulse" : candleMomentum.forecast === "big_green" ? "bg-emerald-400 animate-pulse" : "bg-lime-400") : "bg-muted-foreground"}`} />
              {candleGate ? `Candle ${candleMomentum.ready ? candleMomentum.forecast.replace("_", " ").toUpperCase() : "…"}` : "Candle OFF"}
            </button>
          )}
          <Link
            to="/chart"
            className="text-[10px] font-semibold px-2 py-1.5 rounded border border-border bg-muted/30 hover:bg-muted/50 flex items-center gap-1"
            title="Open full trendline & Fibonacci chart"
          >
            <ExternalLink className="h-3 w-3" /> Chart
          </Link>
          {autoMart && (
            <button
              onClick={() => setSentimentGate(v => !v)}
              className={`text-[10px] font-semibold px-2 py-1.5 rounded border flex items-center gap-1 ${sentimentGate ? "border-violet-500/50 bg-violet-500/15 text-violet-300" : "border-border bg-muted/30 hover:bg-muted/50"}`}
              title={sentimentGate
                ? `Sentiment gate ON: skip fire when ATM YES ∈ 48–52¢ (market chop). Current: ${kalshiSentiment.ready && kalshiSentiment.atmYesPct != null ? kalshiSentiment.atmYesPct.toFixed(0) + "¢" : "…"}`
                : "Sentiment gate OFF: fire every window regardless of Kalshi consensus"}
            >
              <span className={`h-1.5 w-1.5 rounded-full ${sentimentGate ? "bg-violet-400 animate-pulse" : "bg-muted-foreground"}`} />
              {sentimentGate ? "Sentiment gate ON" : "Sentiment gate OFF"}
            </button>
          )}
          {autoMart && (
            <button
              onClick={() => setRoundGate(v => !v)}
              className={`text-[10px] font-semibold px-2 py-1.5 rounded border flex items-center gap-1 ${roundGate ? "border-amber-500/50 bg-amber-500/15 text-amber-300" : "border-border bg-muted/30 hover:bg-muted/50"}`}
              title={roundGate
                ? `Round-number gate ON: skip fire when ATM strike isn't a multiple of ${ROUND_STEP}. Current strike: ${kalshiSentiment.ready && kalshiSentiment.strike != null ? "$" + kalshiSentiment.strike.toFixed(0) : "…"}`
                : `Round-number gate OFF: fire on any strike, including non-multiples of ${ROUND_STEP}`}
            >
              <span className={`h-1.5 w-1.5 rounded-full ${roundGate ? "bg-amber-400 animate-pulse" : "bg-muted-foreground"}`} />
              {roundGate ? "Round gate ON" : "Round gate OFF"}
            </button>
          )}
          {autoMart && (
            <button
              onClick={() => setHtfGate(v => !v)}
              className={`text-[10px] font-semibold px-2 py-1.5 rounded border flex items-center gap-1 ${htfGate ? "border-sky-500/50 bg-sky-500/15 text-sky-300" : "border-border bg-muted/30 hover:bg-muted/50"}`}
              title={htfGate
                ? `HTF gate ON: fire only when 5m EMA20/50 trend agrees with chart side. Current: ${chartVerdict.htfReady ? chartVerdict.htfTrend.toUpperCase() : "…"}`
                : "HTF gate OFF: fire regardless of higher-timeframe trend"}
            >
              <span className={`h-1.5 w-1.5 rounded-full ${htfGate ? "bg-sky-400 animate-pulse" : "bg-muted-foreground"}`} />
              {htfGate ? "HTF gate ON" : "HTF gate OFF"}
            </button>
          )}
          {autoMart && (
            <button
              onClick={() => setEthGate(v => !v)}
              className={`text-[10px] font-semibold px-2 py-1.5 rounded border flex items-center gap-1 ${ethGate ? "border-fuchsia-500/50 bg-fuchsia-500/15 text-fuchsia-300" : "border-border bg-muted/30 hover:bg-muted/50"}`}
              title={ethGate
                ? `ETH gate ON: skip when BTC/ETH diverge (>0.1% opposite signs). Current: ${chartVerdict.ethReason}`
                : "ETH gate OFF: ignore ETH cross-check"}
            >
              <span className={`h-1.5 w-1.5 rounded-full ${ethGate ? "bg-fuchsia-400 animate-pulse" : "bg-muted-foreground"}`} />
              {ethGate ? "ETH gate ON" : "ETH gate OFF"}
            </button>
          )}
          <button
            onClick={toggleVpNoOnly}
            className={`text-[10px] font-semibold px-2 py-1.5 rounded border flex items-center gap-1 ${vpNoOnly ? "border-emerald-500/50 bg-emerald-500/15 text-emerald-300" : "border-border bg-muted/30 hover:bg-muted/50"}`}
            title={vpNoOnly
              ? "NO-only ON: auto-trade skips YES value-picks. Backtest: +3.8% ROI on 514/903 bets (vs +1.8% blind)."
              : "NO-only OFF: auto-trade fires both YES and NO value-picks (default)."}
          >
            <span className={`h-1.5 w-1.5 rounded-full ${vpNoOnly ? "bg-emerald-400 animate-pulse" : "bg-muted-foreground"}`} />
            {vpNoOnly ? "NO-only ON" : "NO-only OFF"}
          </button>








          <button
            onClick={() => runForce()}
            disabled={forceBusy || liveBusy}
            className="text-xs font-semibold px-3 py-1.5 rounded border border-amber-500/40 bg-amber-500/10 text-amber-400 hover:bg-amber-500/20 disabled:opacity-50 flex items-center gap-1.5"
            title="Force up to 2 live orders on the model's top picks — bypasses entry gates and the loss cap; 40-order cap still applies"
          >
            {forceBusy ? <Loader2 className="h-3 w-3 animate-spin" /> : <Zap className="h-3 w-3" />}
            {forceBusy ? "Forcing…" : "Force trade (top picks)"}
          </button>
        </div>
      </div>

      {diagOpen && (
        <div className="border-b border-border bg-muted/10 px-4 py-3">
          <div className="flex items-center justify-between mb-2">
            <div className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Kalshi auth diagnostics</div>
            <button onClick={() => setDiagOpen(false)} className="text-[11px] text-muted-foreground hover:text-foreground">close</button>
          </div>
          {diagBusy && !diag && <div className="text-xs text-muted-foreground flex items-center gap-2"><Loader2 className="h-3 w-3 animate-spin" /> Running 5 checks…</div>}
          {diag && (
            <div className="space-y-2">
              <ol className="space-y-1.5">
                {diag.steps.map((s, i) => (
                  <li key={i} className="text-xs">
                    <div className="flex items-start gap-2">
                      <span className={`mt-0.5 inline-block h-4 w-4 rounded-full text-[10px] leading-4 text-center font-bold ${s.ok ? "bg-emerald-500/20 text-emerald-400" : "bg-red-500/20 text-red-400"}`}>
                        {s.ok ? "✓" : "✗"}
                      </span>
                      <div className="flex-1 min-w-0">
                        <div className={s.ok ? "text-foreground" : "text-red-400 font-medium"}>{s.name}</div>
                        {s.detail && <div className="text-[11px] text-muted-foreground font-mono break-all whitespace-pre-wrap">{s.detail}</div>}
                        {s.data && (
                          <details className="mt-1">
                            <summary className="text-[10px] text-muted-foreground cursor-pointer hover:text-foreground">raw data</summary>
                            <pre className="text-[10px] text-muted-foreground bg-background/50 p-2 rounded mt-1 overflow-x-auto">{JSON.stringify(s.data, null, 2)}</pre>
                          </details>
                        )}
                      </div>
                    </div>
                  </li>
                ))}
              </ol>
              <div className={`text-[11px] p-2 rounded border ${diag.ok ? "border-emerald-500/30 bg-emerald-500/5 text-emerald-300" : "border-red-500/30 bg-red-500/5 text-red-300"}`}>
                <span className="font-semibold">Verdict:</span> {diag.summary}
              </div>
              <div className="text-[10px] text-muted-foreground">Server time at check: {diag.serverTimeIso}</div>
            </div>
          )}
        </div>
      )}

      {liveOrders.length === 0 ? (
        <div className="p-6 text-center text-sm text-muted-foreground">No live auto-trades placed yet. Test the Kalshi connection before running a real-money auto-trade.</div>
      ) : (
        <div className="max-h-[360px] overflow-y-auto">
          <table className="w-full text-xs">
            <thead className="sticky top-0 bg-card border-b border-border">
              <tr className="text-left text-[10px] uppercase tracking-wider text-muted-foreground">
                <th className="px-3 py-2">Placed</th>
                <th className="px-3 py-2">Source</th>
                <th className="px-3 py-2">Ticker</th>
                <th className="px-3 py-2">Side</th>
                <th className="px-3 py-2 text-right">Stake</th>
                <th className="px-3 py-2 text-right">Limit</th>
                <th className="px-3 py-2 text-right">Edge</th>
                <th className="px-3 py-2 text-right">Safety</th>
                <th className="px-3 py-2">Status</th>
                <th className="px-3 py-2 text-right">PnL</th>
              </tr>

            </thead>
            <tbody>
              {liveOrders.map((o: AutoTradeOrderRow) => {
                const statusColor = o.status === "settled_win" ? "text-emerald-400" : o.status === "settled_loss" ? "text-red-400" : o.status === "placed" ? "text-amber-400" : "text-muted-foreground";
                const snap = (o as unknown as { inputs_snapshot?: Record<string, unknown> | null }).inputs_snapshot ?? null;
                const originRaw = (snap && typeof snap === "object" && typeof (snap as { origin?: unknown }).origin === "string")
                  ? (snap as { origin: string }).origin
                  : null;
                const isMg = (o as unknown as { is_martingale?: boolean }).is_martingale === true;
                const source = originRaw === "model_bet" ? { label: "model-bet", cls: "border-sky-500/40 bg-sky-500/10 text-sky-300" }
                  : originRaw === "auto_odds" || originRaw === "odds_bet" ? { label: "auto-odds", cls: "border-violet-500/40 bg-violet-500/10 text-violet-300" }
                  : isMg ? { label: "martingale", cls: "border-amber-500/40 bg-amber-500/10 text-amber-300" }
                  : originRaw ? { label: originRaw, cls: "border-border bg-muted/20 text-muted-foreground" }
                  : { label: "auto", cls: "border-border bg-muted/20 text-muted-foreground" };
                return (
                  <tr key={o.id} className="border-b border-border/40 hover:bg-muted/20">
                    <td className="px-3 py-1.5 font-mono text-muted-foreground">{fmtTime(o.created_at)}</td>
                    <td className="px-3 py-1.5">
                      <span className={`inline-block text-[9px] uppercase tracking-wider px-1.5 py-0.5 rounded border ${source.cls}`}>{source.label}</span>
                    </td>
                    <td className="px-3 py-1.5 font-mono">{o.ticker}</td>
                    <td className={"px-3 py-1.5 font-semibold " + (o.side === "YES" ? "text-emerald-400" : "text-red-400")}>{dirLabel(o.side)}</td>
                    <td className="px-3 py-1.5 text-right font-mono">${Number(o.stake_usd).toFixed(2)}</td>
                    <td className="px-3 py-1.5 text-right font-mono" title={`Entry ${centsToAmerican(o.entry_price_cents ?? o.limit_cents)} American`}>
                      {o.entry_price_cents ?? o.limit_cents}¢ × {o.contracts}
                      {o.contracts_remaining != null && o.contracts_remaining !== o.contracts && (
                        <div className="text-[9px] text-amber-400">rem {o.contracts_remaining} · banked ${Number(o.partial_pnl_usd ?? 0).toFixed(2)}</div>
                      )}
                    </td>
                    <td className="px-3 py-1.5 text-right font-mono">{Number(o.edge_pts) >= 0 ? "+" : ""}{Number(o.edge_pts).toFixed(1)}pts</td>
                    <td className="px-3 py-1.5 text-right font-mono">{Number(o.sigma_distance).toFixed(2)}σ</td>
                    <td className={"px-3 py-1.5 " + statusColor}>{o.status.replace("settled_", "")}</td>
                    <td className={"px-3 py-1.5 text-right font-mono " + (o.pnl_usd === null ? "text-muted-foreground" : Number(o.pnl_usd) >= 0 ? "text-emerald-400" : "text-red-400")}>
                      {o.pnl_usd === null ? "—" : `${Number(o.pnl_usd) >= 0 ? "+" : ""}$${Number(o.pnl_usd).toFixed(2)}`}
                    </td>
                  </tr>
                );
              })}

            </tbody>
          </table>
        </div>
      )}
    </div>

    <div className="border border-border rounded-lg bg-card">
      <div className="px-4 py-2 border-b border-border">
        <h3 className="text-xs uppercase tracking-wider text-muted-foreground">Trade log · manual + model-bet <span className="ml-1 text-[10px] text-muted-foreground/70">(crypto_trades)</span></h3>
      </div>
      <TradeLog />
    </div>
    </div>
  );
}


function KalshiBalanceBadge() {
  const balFn = useServerFn(checkKalshiBalance);
  const q = useQuery({
    queryKey: ["kalshi-balance"],
    queryFn: () => balFn(),
    refetchInterval: 15_000,
    staleTime: 10_000,
  });
  const cents = q.data?.ok ? q.data.balanceCents ?? null : null;
  const needsConnect = q.data?.error === "Connect Kalshi in Settings";
  const label = cents != null
    ? `$${(cents / 100).toFixed(2)}`
    : q.isLoading
    ? "…"
    : needsConnect
    ? "Connect Kalshi →"
    : "—";
  const title = q.data?.ok
    ? `Kalshi balance (live, refreshes every 15s)`
    : q.data?.error ?? "Kalshi balance unavailable";
  return (
    <div
      title={title}
      className="flex items-center gap-1.5 px-3 py-1.5 border border-border rounded bg-card text-xs font-mono tabular-nums"
    >
      <span className="text-[10px] uppercase tracking-wider text-muted-foreground">Kalshi</span>
      {needsConnect ? (
        <Link
          to="/settings"
          className="text-[color:var(--color-primary)] hover:underline font-semibold"
        >
          {label}
        </Link>
      ) : (
        <span className={q.data?.ok ? "text-emerald-400 font-semibold" : "text-muted-foreground"}>{label}</span>
      )}
      {q.isFetching && <Loader2 className="h-3 w-3 animate-spin text-muted-foreground" />}
    </div>
  );
}

export function PaperBalanceBadge() {
  const balFn = useServerFn(getPaperBalance);
  const settleFn = useServerFn(settleMyPaperFills);
  const q = useQuery({
    queryKey: ["paperBalance"],
    queryFn: () => balFn(),
    refetchInterval: 15_000,
    staleTime: 10_000,
  });
  // Opportunistically settle due paper fills in the background.
  useEffect(() => {
    const h = setInterval(() => { settleFn().catch(() => {}); }, 60_000);
    settleFn().catch(() => {});
    return () => clearInterval(h);
  }, [settleFn]);
  const cents = q.data?.balance_cents ?? null;
  const bankrupt = !!q.data?.bankrupt_at;
  const label = cents != null ? `$${(cents / 100).toFixed(2)}` : q.isLoading ? "…" : "—";
  return (
    <Link
      to="/crypto-paper"
      title={bankrupt ? "Paper bankrupt — go reset" : "Paper balance (click to view fill log)"}
      className={`flex items-center gap-1.5 px-3 py-1.5 border rounded bg-card text-xs font-mono tabular-nums ${bankrupt ? "border-red-500/50 bg-red-500/10" : "border-border"}`}
    >
      <span className="text-[10px] uppercase tracking-wider text-muted-foreground">Paper</span>
      <span className={bankrupt ? "text-red-300 font-semibold" : "text-sky-300 font-semibold"}>{label}</span>
    </Link>
  );
}

function CryptoPage() {
  const qc = useQueryClient();
  const marketsFn = useServerFn(getBtcMarkets);
  const cfgFn = useServerFn(checkKalshiConfigured);
  const placeFn = useServerFn(placeKalshiOrder);

  const q = useQuery({ queryKey: ["btc-markets"], queryFn: () => marketsFn(), refetchInterval: 2_000, staleTime: 1_000, retry: 2, retryDelay: 500, placeholderData: (prev) => prev });
  const cfg = useQuery({ queryKey: ["kalshi-cfg"], queryFn: () => cfgFn(), staleTime: 60_000 });

  // 3-window Polymarket/Binance shadow tracker — display-only, feeds no model.
  const activeMarketsForTracker = useMemo(() => {
    return (q.data?.markets ?? [])
      .filter(m => m.closeTime && m.secondsToClose > 0 && m.secondsToClose <= 15 * 60 + 60)
      .map(m => {
        const closeMs = new Date(m.closeTime!).getTime();
        const openMs = m.openTime ? new Date(m.openTime).getTime() : closeMs - 15 * 60_000;
        return { ticker: m.ticker, openMs, closeMs };
      });
  }, [q.data]);
  useTripleWindowTracker(activeMarketsForTracker);


  // Record ATM odds snapshot every marketsQ refetch for post-hoc analysis.
  // Fires once per new q.dataUpdatedAt; skips if no active window.
  const recordTapeFn = useServerFn(recordOddsTape);
  const lastTapeAt = useRef<number>(0);
  useEffect(() => {
    const updatedAt = q.dataUpdatedAt;
    if (!updatedAt || updatedAt === lastTapeAt.current) return;
    const markets = q.data?.markets ?? [];
    const active = markets.filter(m => m.secondsToClose > 0 && m.secondsToClose <= 15 * 60 + 60);
    if (active.length === 0) return;
    const spotRef = active[0].spot ?? 0;
    if (!spotRef) return;
    const atm = active.slice().sort((a, b) => Math.abs(a.strike - spotRef) - Math.abs(b.strike - spotRef))[0];
    const yesCents = Math.max(0, Math.min(100, Math.round((atm.yesAsk || atm.yesPrice) * 100)));
    const noCents = Math.max(0, Math.min(100, Math.round((atm.noAsk || (1 - atm.yesPrice)) * 100)));
    lastTapeAt.current = updatedAt;
    recordTapeFn({ data: { snapshots: [{
      ticker: atm.ticker, strike: atm.strike, spot: atm.spot,
      yesCents, noCents, secondsToClose: atm.secondsToClose,
    }] } }).catch(() => { /* silent — analytics best-effort */ });
  }, [q.dataUpdatedAt, q.data, recordTapeFn]);

  const [bankroll, setBankroll] = useState(500);
  const [kellyMult, setKellyMult] = useState(0.25);
  const sizing: SizingState = { bankroll, kellyMult };
  const [pending, setPending] = useState<BtcMarket | null>(null);
  const live = useBinanceBtcSpot();
  const cvForPlace = useChartVerdict();
  const [calibrate, setCalibrate] = useState<boolean>(() => {
    if (typeof window === "undefined") return false;
    return window.localStorage.getItem("crypto.autoMart.calibrate") === "on";
  });
  useEffect(() => {
    window.localStorage.setItem("crypto.autoMart.calibrate", calibrate ? "on" : "off");
  }, [calibrate]);
  const calShiftForPlace = useCalibrationShift(cvForPlace.score, calibrate);

  // Auto-refetch the instant any strike window closes so the next 15-min strike appears immediately.
  useEffect(() => {
    const markets = q.data?.markets ?? [];
    if (!markets.length) return;
    const soonest = Math.min(...markets.map(m => m.secondsToClose).filter(s => s > 0));
    if (!Number.isFinite(soonest)) return;
    const t = setTimeout(() => qc.invalidateQueries({ queryKey: ["btc-markets"] }), (soonest + 2) * 1000);
    return () => clearTimeout(t);
  }, [q.data, qc]);

  const place = useMutation({
    mutationFn: async (m: BtcMarket) => {
      const sug = suggestedStake(m, sizing);
      return placeFn({ data: {
        ticker: m.ticker, eventTicker: m.eventTicker, side: m.side,
        contracts: sug.contracts, limitPriceCents: sug.limitCents,
        strike: m.strike, spot: m.spot, modelProb: m.modelYesProb,
        marketYesPrice: m.yesPrice, edgePts: m.edgePts,
        stakeUsd: sug.stakeUsd, bankrollUsd: bankroll, kellyMultiplier: kellyMult,
        closeTime: m.closeTime ?? undefined,
        chartVerdictScore: cvForPlace.ready ? cvForPlace.score : undefined,
        inputsSnapshot: {
          source: "manual_place",
          verdictReady: cvForPlace.ready,
          verdictScore: cvForPlace.ready ? cvForPlace.score : null,
          calibrateOn: calibrate,
          calShift: calShiftForPlace?.shift ?? 0,
          modelYesProb: m.modelYesProb,
          marketYesPrice: m.yesPrice,
          edgePts: m.edgePts,
          spot: m.spot,
          strike: m.strike,
          firedAt: new Date().toISOString(),
        },
      }});
    },
    onSuccess: (r) => { toast.success(`Order submitted · ${r.orderId ?? r.tradeId}`); setPending(null); qc.invalidateQueries({ queryKey: ["crypto-trades"] }); },
    onError: (e: any) => { toast.error(e?.message ?? "Order failed"); },
  });

  const data = q.data;

  return (
    <div className="max-w-7xl mx-auto px-4 py-6 space-y-6">
      <KalshiMaintenanceBanner />
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2">
            <Activity className="h-5 w-5 text-[color:var(--color-primary)]" />
            Crypto Predictions — BTC 15-min
          </h1>
          <p className="text-sm text-muted-foreground mt-1">
            Live Kalshi <code className="text-xs">KXBTC15M</code> markets · model uses intra-window realized price action conditioned on remaining time.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <KalshiBalanceBadge />
          <Link
            to="/crypto-sandbox"
            className="text-xs uppercase tracking-wider px-3 py-1.5 border border-emerald-500/40 text-emerald-400 rounded hover:bg-emerald-500/10"
          >
            Paper Sandbox →
          </Link>
          <button onClick={() => q.refetch()} className="flex items-center gap-1 text-xs uppercase tracking-wider px-3 py-1.5 border border-border rounded hover:bg-card">
            {q.isFetching ? <Loader2 className="h-3 w-3 animate-spin" /> : <RefreshCw className="h-3 w-3" />} Refresh
          </button>
        </div>
      </div>

      {/* Model / PRED / Green Hours bet panels moved to /crypto-paper (paper-only sandbox).
          Components remain exported from this file so the real-money path is preserved. */}
      {data && <TopPick markets={data.markets} />}

      {/* Multi-TF shadow (pure logging, no live impact) */}
      <MultiTfShadowPanel />

      {/* Trendline + spike detector (shadow only) — lazy-mounted to speed up initial page load */}
      <LazyOnVisible minHeight={520} rootMargin="200px" fallback={
        <div className="border border-border rounded-lg bg-card p-6" style={{ minHeight: 520 }}>
          <div className="flex items-center justify-between mb-4">
            <div className="h-4 w-48 bg-muted animate-pulse rounded" />
            <div className="h-4 w-24 bg-muted animate-pulse rounded" />
          </div>
          <div className="h-[420px] w-full bg-muted/40 animate-pulse rounded flex items-center justify-center text-xs text-muted-foreground">
            Loading BTC trendline chart…
          </div>
        </div>
      }>
        <TrendlineChartPanel />
      </LazyOnVisible>



      {data && (
        <div className="space-y-2">
          {data.markets.length === 0 && <div className="border border-border rounded-lg bg-card p-6 text-center text-sm text-muted-foreground">No open BTC 15-min markets right now.</div>}
          {data.markets.map(m => <MarketRow key={m.ticker} m={m} candles={data.candles} sizing={sizing} onPlace={setPending} live={live} />)}
        </div>
      )}

      <ModelAccuracyPanel />



      {data && <AutoTradePanel markets={data.markets} />}


      <div className="border border-yellow-500/30 bg-yellow-500/5 rounded-lg p-3 text-xs text-yellow-200/90 flex gap-2">
        <AlertTriangle className="h-4 w-4 flex-shrink-0 mt-0.5" />
        <div>
          <strong>Reality check:</strong> Honest short-horizon BTC models hit ~53–60% out-of-sample, not 99%. This tool's edge is small but compounds across many trades when you size with Kelly and ignore low-edge picks. Kalshi orders are real money.
          {cfg.data && !cfg.data.configured && <div className="mt-1 text-red-300">Kalshi credentials missing — orders will fail until KALSHI_API_KEY_ID and KALSHI_PRIVATE_KEY_PEM are set.</div>}
          {cfg.data?.externalModel && <div className="mt-1 text-emerald-300">External ML model URL is configured — predictions use your endpoint.</div>}
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-3 border border-border rounded-lg bg-card p-4">
        <label className="space-y-1">
          <div className="text-[10px] uppercase tracking-wider text-muted-foreground">Bankroll (USD)</div>
          <input type="number" min={0} step={50} value={bankroll}
            onChange={e => setBankroll(Math.max(0, Number(e.target.value) || 0))}
            className="w-full bg-background border border-border rounded px-2 py-1 text-sm" />
        </label>
        <label className="space-y-1">
          <div className="text-[10px] uppercase tracking-wider text-muted-foreground">Kelly multiplier: <span className="text-foreground font-mono">{kellyMult.toFixed(2)}x</span></div>
          <input type="range" min={0.1} max={1} step={0.05} value={kellyMult}
            onChange={e => setKellyMult(Number(e.target.value))}
            className="w-full" />
          <div className="text-[10px] text-muted-foreground">0.25x = quarter-Kelly (recommended). 1x = full-Kelly (high variance).</div>
        </label>
        <div className="space-y-1">
          <div className="text-[10px] uppercase tracking-wider text-muted-foreground">BTC spot · Markets · Updated</div>
          <div className="text-sm font-mono">
            {live.price != null ? fmt$(live.price) : data ? fmt$(data.spot) : "—"}
            {live.connected && <span className="ml-1 text-[9px] text-emerald-400 uppercase tracking-wider">live</span>}
            {" · "}{data?.markets.length ?? 0} · {data ? fmtTime(data.asOf) : "—"}
          </div>
        </div>
      </div>

      {data?.micro && (
        <div className="border border-border rounded-lg bg-card p-3 space-y-2">
          <div className="text-[10px] uppercase tracking-wider text-muted-foreground">Microstructure signals (Binance BTC perp)</div>
          <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-6 gap-3 text-xs">
            <div>
              <div className="text-[10px] uppercase tracking-wider text-muted-foreground">Funding (8h)</div>
              <div className={`font-mono text-sm ${data.micro.fundingRate >= 0 ? "text-emerald-400" : "text-red-400"}`}>
                {(data.micro.fundingRate * 100).toFixed(4)}%
              </div>
              <div className="text-[10px] text-muted-foreground">{data.micro.fundingAnnualBps >= 0 ? "+" : ""}{data.micro.fundingAnnualBps.toFixed(0)}bps APR</div>
            </div>
            <div>
              <div className="text-[10px] uppercase tracking-wider text-muted-foreground">OI Δ 5m</div>
              <div className={`font-mono text-sm ${data.micro.oiDelta5mPct >= 0 ? "text-emerald-400" : "text-red-400"}`}>
                {data.micro.oiDelta5mPct >= 0 ? "+" : ""}{data.micro.oiDelta5mPct.toFixed(2)}%
              </div>
              <div className="text-[10px] text-muted-foreground">${(data.micro.oiNotional / 1e9).toFixed(2)}B OI</div>
            </div>
            <div>
              <div className="text-[10px] uppercase tracking-wider text-muted-foreground">Basis</div>
              <div className={`font-mono text-sm ${data.micro.basisBps >= 0 ? "text-emerald-400" : "text-red-400"}`}>
                {data.micro.basisBps >= 0 ? "+" : ""}{data.micro.basisBps.toFixed(2)}bps
              </div>
              <div className="text-[10px] text-muted-foreground">perp vs spot</div>
            </div>
            <div>
              <div className="text-[10px] uppercase tracking-wider text-muted-foreground">Taker CVD 60s</div>
              <div className={`font-mono text-sm ${data.micro.cvdRatio >= 0 ? "text-emerald-400" : "text-red-400"}`}>
                {data.micro.cvdRatio >= 0 ? "+" : ""}{(data.micro.cvdRatio * 100).toFixed(1)}%
              </div>
              <div className="text-[10px] text-muted-foreground">
                buy ${(data.micro.cvdBuyUsd / 1e6).toFixed(1)}M / sell ${(data.micro.cvdSellUsd / 1e6).toFixed(1)}M
              </div>
            </div>
            <div>
              <div className="text-[10px] uppercase tracking-wider text-muted-foreground">Book imbalance</div>
              <div className={`font-mono text-sm ${data.micro.ofi >= 0 ? "text-emerald-400" : "text-red-400"}`}>
                {data.micro.ofi >= 0 ? "+" : ""}{(data.micro.ofi * 100).toFixed(1)}%
              </div>
              <div className="text-[10px] text-muted-foreground">top 10 levels</div>
            </div>
            <div>
              <div className="text-[10px] uppercase tracking-wider text-muted-foreground">Spread</div>
              <div className="font-mono text-sm">{data.micro.bookSpreadBps.toFixed(2)}bps</div>
              <div className="text-[10px] text-muted-foreground">best bid/ask</div>
            </div>
            <div>
              <div className="text-[10px] uppercase tracking-wider text-muted-foreground">Whales 1m (≥$250k)</div>
              <div className={`font-mono text-sm ${data.micro.whaleImbalance1m >= 0 ? "text-emerald-400" : "text-red-400"}`}>
                {data.micro.whaleImbalance1m >= 0 ? "+" : ""}{(data.micro.whaleImbalance1m * 100).toFixed(0)}%
              </div>
              <div className="text-[10px] text-muted-foreground">
                buy ${(data.micro.whaleBuyUsd1m / 1e6).toFixed(2)}M / sell ${(data.micro.whaleSellUsd1m / 1e6).toFixed(2)}M
              </div>
            </div>
            <div>
              <div className="text-[10px] uppercase tracking-wider text-muted-foreground">Whales 5m</div>
              <div className={`font-mono text-sm ${data.micro.whaleImbalance5m >= 0 ? "text-emerald-400" : "text-red-400"}`}>
                {data.micro.whaleImbalance5m >= 0 ? "+" : ""}{(data.micro.whaleImbalance5m * 100).toFixed(0)}%
              </div>
              <div className="text-[10px] text-muted-foreground">
                {data.micro.whaleCount5m} fills · ${((data.micro.whaleBuyUsd5m + data.micro.whaleSellUsd5m) / 1e6).toFixed(1)}M
              </div>
            </div>
          </div>
        </div>
      )}


      {data?.options && (
        <div className="border border-border rounded-lg bg-card p-3 space-y-2">
          <div className="text-[10px] uppercase tracking-wider text-muted-foreground">
            Options-implied (Deribit · nearest expiry {new Date(data.options.expiryMs).toUTCString().slice(5, 16)})
          </div>
          <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-5 gap-3 text-xs">
            <div>
              <div className="text-[10px] uppercase tracking-wider text-muted-foreground">ATM IV</div>
              <div className="font-mono text-sm">{(data.options.atmIv * 100).toFixed(1)}%</div>
              <div className="text-[10px] text-muted-foreground">annualized</div>
            </div>
            <div>
              <div className="text-[10px] uppercase tracking-wider text-muted-foreground">25Δ Call IV</div>
              <div className="font-mono text-sm">{(data.options.ivCall25 * 100).toFixed(1)}%</div>
              <div className="text-[10px] text-muted-foreground">upside wing</div>
            </div>
            <div>
              <div className="text-[10px] uppercase tracking-wider text-muted-foreground">25Δ Put IV</div>
              <div className="font-mono text-sm">{(data.options.ivPut25 * 100).toFixed(1)}%</div>
              <div className="text-[10px] text-muted-foreground">downside wing</div>
            </div>
            <div>
              <div className="text-[10px] uppercase tracking-wider text-muted-foreground">25Δ Skew</div>
              <div className={`font-mono text-sm ${data.options.skew25 > 0 ? "text-red-400" : "text-emerald-400"}`}>
                {data.options.skew25 >= 0 ? "+" : ""}{(data.options.skew25 * 100).toFixed(2)}%
              </div>
              <div className="text-[10px] text-muted-foreground">{data.options.skew25 > 0 ? "downside fear" : "upside bias"}</div>
            </div>
            <div>
              <div className="text-[10px] uppercase tracking-wider text-muted-foreground">Days to expiry</div>
              <div className="font-mono text-sm">{(data.options.yearsToExpiry * 365).toFixed(2)}d</div>
              <div className="text-[10px] text-muted-foreground">{data.options.sampleCount} strikes</div>
            </div>
          </div>
        </div>
      )}

      {data?.regime && (
        <div className="border border-border rounded-lg bg-card p-3 space-y-2">
          <div className="flex items-center justify-between">
            <div className="text-[10px] uppercase tracking-wider text-muted-foreground">
              AI regime classifier · {data.regime.source}
            </div>
            <div className="text-[10px] text-muted-foreground">
              confidence <span className="font-mono">{(data.regime.confidence * 100).toFixed(0)}%</span>
            </div>
          </div>
          <div className="flex items-center gap-3 flex-wrap">
            <div className={`px-2 py-1 rounded text-xs font-mono uppercase tracking-wider ${
              data.regime.regime === "breakout" ? "bg-amber-500/20 text-amber-300" :
              data.regime.regime === "trend-up" ? "bg-emerald-500/20 text-emerald-300" :
              data.regime.regime === "trend-down" ? "bg-red-500/20 text-red-300" :
              data.regime.regime === "squeeze" ? "bg-purple-500/20 text-purple-300" :
              data.regime.regime === "chop" ? "bg-slate-500/20 text-slate-300" :
              "bg-muted text-muted-foreground"
            }`}>
              {data.regime.regime}
            </div>
            <div className="text-xs font-mono text-muted-foreground">
              σ×<span className="text-foreground">{data.regime.sigmaMult.toFixed(2)}</span>
              {" · "}drift bias <span className="text-foreground">{(data.regime.driftBiasPerMin * 10000).toFixed(1)} bp/min</span>
            </div>
          </div>
          {data.regime.reason && (
            <div className="text-xs text-muted-foreground italic">{data.regime.reason}</div>
          )}
        </div>
      )}

      {data?.calibration && (
        <div className="border border-border rounded-lg bg-card p-3 space-y-2">
          <div className="flex items-center justify-between">
            <div className="text-[10px] uppercase tracking-wider text-muted-foreground">
              Self-learning calibration · {data.calibration.totalSettled} settled rows
            </div>
            <div className="text-[10px] text-muted-foreground">
              hit rate <span className="font-mono">{(data.calibration.globalHitRate * 100).toFixed(1)}%</span>
              {" · "}Brier <span className="font-mono">{data.calibration.globalBrier.toFixed(4)}</span>
            </div>
          </div>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3 text-xs">
            {data.calibration.buckets.map(b => (
              <div key={b.bucket} className={`border rounded p-2 ${b.active ? "border-emerald-500/40" : "border-border"}`}>
                <div className="flex items-center justify-between">
                  <div className="text-[10px] uppercase tracking-wider text-muted-foreground">{b.bucket.replace("_", "–")}s</div>
                  <div className={`text-[9px] uppercase tracking-wider ${b.active ? "text-emerald-400" : "text-muted-foreground"}`}>
                    {b.active ? "LIVE" : "warmup"}
                  </div>
                </div>
                <div className="font-mono text-sm">n={b.n} · hit {(b.hitRate * 100).toFixed(1)}%</div>
                <div className="text-[10px] text-muted-foreground">
                  pred {(b.meanProb * 100).toFixed(1)}% · Brier {b.brier.toFixed(3)}
                </div>
                <div className="text-[10px] text-muted-foreground font-mono">
                  Platt a={b.a.toFixed(2)} b={b.b.toFixed(2)}
                </div>
              </div>
            ))}
          </div>
          <div className={`border rounded p-2 text-xs ${data.calibration.global.active ? "border-emerald-500/40" : "border-border"}`}>
            <div className="flex items-center justify-between">
              <div className="text-[10px] uppercase tracking-wider text-muted-foreground">
                Global fallback fit
              </div>
              <div className={`text-[9px] uppercase tracking-wider ${data.calibration.global.active ? "text-emerald-400" : "text-muted-foreground"}`}>
                {data.calibration.global.active ? "LIVE" : `warmup (${data.calibration.global.n}/20)`}
              </div>
            </div>
            <div className="text-[10px] text-muted-foreground font-mono">
              n={data.calibration.global.n} · Platt a={data.calibration.global.a.toFixed(2)} b={data.calibration.global.b.toFixed(2)}
              {" · "}applied when bucket has &lt;30 samples
            </div>
          </div>
        </div>
      )}

      {q.isLoading && !data && <div className="border border-border rounded-lg bg-card p-6 text-center text-sm text-muted-foreground"><Loader2 className="h-4 w-4 animate-spin inline mr-2" /> Loading…</div>}
      {q.isError && !data && <div className="border border-red-500/40 rounded-lg bg-card p-4 text-sm text-red-400">Reconnecting to Kalshi/Coinbase feeds…</div>}
      {q.isError && data && <div className="text-[11px] text-amber-400/80 px-1 flex items-center gap-2"><Loader2 className="h-3 w-3 animate-spin" /> Reconnecting to feeds — showing last snapshot.</div>}

      {data && (
        <>


          <PricingStudyPanel markets={data.markets} />

          <LazyOnVisible><ModelScorecardPanel /></LazyOnVisible>

          <LazyOnVisible><MarketIntelHealthPanel /></LazyOnVisible>


          <LazyOnVisible><DailyPerformancePanel /></LazyOnVisible>

          <LazyOnVisible><ModelAblationPanel /></LazyOnVisible>

          <LazyOnVisible><EvReportPanel /></LazyOnVisible>

          <LazyOnVisible><JumpBacktestPanel /></LazyOnVisible>

          <LazyOnVisible><JumpRecommendationCard /></LazyOnVisible>

          <LazyOnVisible><SignedEdgeVetoPanel /></LazyOnVisible>

          <LazyOnVisible><ConvictionExitPanel /></LazyOnVisible>

          <CalibrationReportPanel />

          <ModelStudyPanel />

          <LazyOnVisible><EquityMomentumPanel /></LazyOnVisible>

          <LazyOnVisible><MartingaleRecoveryPanel /></LazyOnVisible>

          <LazyOnVisible><OddsStudyPanel /></LazyOnVisible>

          <LazyOnVisible><IocLadderPanel /></LazyOnVisible>

          <LazyOnVisible><FlipRecorderPanel /></LazyOnVisible>

          <LazyOnVisible><OddsShadowTraderPanel /></LazyOnVisible>

          <LazyOnVisible><ManualTradesPanel /></LazyOnVisible>

          <LazyOnVisible><SkipBucketPanel /></LazyOnVisible>

          <LazyOnVisible><LossCapPanel /></LazyOnVisible>

          <LazyOnVisible><FlipShadowPanel /></LazyOnVisible>

          <LazyOnVisible><ScalpShadowPanel /></LazyOnVisible>

          <LazyOnVisible><TaShadowPanel /></LazyOnVisible>

        </>
      )}

      {pending && <ConfirmModal market={pending} sizing={sizing} onClose={() => setPending(null)} onConfirm={() => place.mutate(pending)} submitting={place.isPending} />}

      <p className="text-[11px] text-muted-foreground">Educational tool. Not financial advice. Crypto markets settle on CF Benchmarks BRTI.</p>
    </div>
  );
}

function PricingStudyPanel({ markets }: { markets: BtcMarket[] }) {
  const rows = markets
    .filter(m => m.secondsToClose > 0 && m.yesPrice > 0 && m.yesPrice < 1)
    .slice(0, 8);
  if (rows.length === 0) return null;
  return (
    <div className="border border-border rounded-lg bg-card p-3 space-y-2">
      <div className="flex items-center justify-between">
        <div className="text-[10px] uppercase tracking-wider text-muted-foreground">
          Kalshi pricing study · theory vs market (per-side)
        </div>
        <div className="text-[10px] text-muted-foreground">
          theory = diffusion + options blend (pre-adjust). mispricing = market − theory.
        </div>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full text-xs font-mono">
          <thead className="text-[10px] uppercase tracking-wider text-muted-foreground">
            <tr className="text-left">
              <th className="py-1 pr-3">Market</th>
              <th className="pr-3">Side</th>
              <th className="pr-3 text-right">Δσ</th>
              <th className="pr-3 text-right">Time</th>
              <th className="pr-3 text-right">Theory</th>
              <th className="pr-3 text-right">Market</th>
              <th className="pr-3 text-right">Mispricing</th>
            </tr>
          </thead>
          <tbody>
            {rows.map(m => {
              const sideTheory = m.side === "YES" ? m.theoryYesProb : (1 - m.theoryYesProb);
              const sideMarket = m.side === "YES" ? m.yesPrice : (1 - m.yesPrice);
              const mispricePts = (sideMarket - sideTheory) * 100;
              const color = Math.abs(mispricePts) < 2 ? "text-muted-foreground"
                : mispricePts < 0 ? "text-emerald-400" : "text-amber-400";
              return (
                <tr key={m.ticker} className="border-t border-border/40">
                  <td className="py-1 pr-3 text-foreground">${m.strike.toLocaleString()}</td>
                  <td className="pr-3">{dirLabel(m.side)}</td>
                  <td className="pr-3 text-right">{m.sigmaDistance.toFixed(2)}σ</td>
                  <td className="pr-3 text-right">{fmtCountdown(m.secondsToClose)}</td>
                  <td className="pr-3 text-right">{(sideTheory * 100).toFixed(1)}¢</td>
                  <td className="pr-3 text-right">{(sideMarket * 100).toFixed(1)}¢</td>
                  <td className={`pr-3 text-right ${color}`}>
                    {mispricePts >= 0 ? "+" : ""}{mispricePts.toFixed(1)}pt
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <div className="text-[10px] text-muted-foreground italic">
        Negative mispricing = market underpricing our side (we can buy cheap). Positive = market overpricing.
      </div>
    </div>
  );
}

function CalibrationReportPanel() {
  const fn = useServerFn(getCalibrationReport);
  const q = useQuery({
    queryKey: ["btc-calibration-report"],
    queryFn: () => fn(),
    staleTime: 60_000,
    refetchInterval: 5 * 60_000,
  });
  const rows: CalibrationRow[] = q.data ?? [];
  if (rows.length === 0) {
    return (
      <div className="border border-border rounded-lg bg-card p-3">
        <div className="text-[10px] uppercase tracking-wider text-muted-foreground mb-1">
          Calibration report · time × distance
        </div>
        <div className="text-xs text-muted-foreground">
          No fitted buckets yet. Nightly cron (03:15 UTC) will populate this once settled predictions accumulate.
        </div>
      </div>
    );
  }
  const timeOrder = ["30s","1m","2m","5m","10m","13m+"];
  const sigmaOrder = ["0-0.5σ","0.5-1σ","1-2σ","2-3σ","3σ+","unknown"];
  const sorted = [...rows].sort((a,b) =>
    (timeOrder.indexOf(a.time_bucket) - timeOrder.indexOf(b.time_bucket)) ||
    (sigmaOrder.indexOf(a.sigma_bucket) - sigmaOrder.indexOf(b.sigma_bucket))
  );
  return (
    <div className="border border-border rounded-lg bg-card p-3 space-y-2">
      <div className="flex items-center justify-between">
        <div className="text-[10px] uppercase tracking-wider text-muted-foreground">
          Calibration report · actual vs model vs market · {rows.length} buckets
        </div>
        <div className="text-[10px] text-muted-foreground">
          correction = actual ÷ avg-model (clamped 0.5–2.0)
        </div>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full text-xs font-mono">
          <thead className="text-[10px] uppercase tracking-wider text-muted-foreground">
            <tr className="text-left">
              <th className="py-1 pr-3">Time</th>
              <th className="pr-3">Δσ bucket</th>
              <th className="pr-3 text-right">n</th>
              <th className="pr-3 text-right">Actual</th>
              <th className="pr-3 text-right">Model</th>
              <th className="pr-3 text-right">Market</th>
              <th className="pr-3 text-right">Theory</th>
              <th className="pr-3 text-right">Correction</th>
            </tr>
          </thead>
          <tbody>
            {sorted.map(r => {
              const c = r.correction_factor;
              const cColor = Math.abs(c - 1) < 0.1 ? "text-muted-foreground"
                : c > 1 ? "text-emerald-400" : "text-amber-400";
              return (
                <tr key={`${r.time_bucket}-${r.sigma_bucket}`} className="border-t border-border/40">
                  <td className="py-1 pr-3">{r.time_bucket}</td>
                  <td className="pr-3">{r.sigma_bucket}</td>
                  <td className="pr-3 text-right">{r.n_samples}</td>
                  <td className="pr-3 text-right">{r.actual_rate != null ? (r.actual_rate * 100).toFixed(1) + "%" : "—"}</td>
                  <td className="pr-3 text-right">{r.avg_model_prob != null ? (r.avg_model_prob * 100).toFixed(1) + "%" : "—"}</td>
                  <td className="pr-3 text-right">{r.avg_market_prob != null ? (r.avg_market_prob * 100).toFixed(1) + "%" : "—"}</td>
                  <td className="pr-3 text-right">{r.avg_theory_prob != null ? (r.avg_theory_prob * 100).toFixed(1) + "%" : "—"}</td>
                  <td className={`pr-3 text-right ${cColor}`}>{c.toFixed(2)}×</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function MartingaleCountdown({ windowMs }: { windowMs: number }) {
  const [msLeft, setMsLeft] = useState(() => {
    const now = Date.now();
    return windowMs - (now % windowMs);
  });
  useEffect(() => {
    const tick = () => {
      const now = Date.now();
      setMsLeft(windowMs - (now % windowMs));
    };
    tick();
    const h = setInterval(tick, 1000);
    return () => clearInterval(h);
  }, [windowMs]);
  const totalSec = Math.max(0, Math.floor(msLeft / 1000));
  const mm = Math.floor(totalSec / 60).toString().padStart(2, "0");
  const ss = (totalSec % 60).toString().padStart(2, "0");
  const soon = totalSec <= 30;
  return (
    <span
      className={`text-[10px] font-mono px-2 py-1.5 rounded border ${
        soon
          ? "border-fuchsia-500/50 bg-fuchsia-500/15 text-fuchsia-300 animate-pulse"
          : "border-border bg-muted/30 text-muted-foreground"
      }`}
      title="Time until the next 15-min martingale fires"
    >
      next fire in {mm}:{ss}
    </span>
  );
}

function ModelStudyPanel() {
  const qc = useQueryClient();
  const latestFn = useServerFn(getLatestStudy);
  const diagFn = useServerFn(diagnoseRecentMisses);
  const studyFn = useServerFn(studyMissesWithAI);
  const [running, setRunning] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const q = useQuery({
    queryKey: ["crypto-latest-study"],
    queryFn: () => latestFn(),
    staleTime: 30_000,
  });

  const run = async () => {
    setRunning(true);
    setErr(null);
    try {
      const d = await diagFn();
      toast.success(`Diagnosed ${d.diagnosed} new miss${d.diagnosed === 1 ? "" : "es"}`);
      const s = await studyFn();
      if (s.ran) toast.success("AI study complete");
      else toast.message(s.reason ?? "Study skipped");
      await qc.invalidateQueries({ queryKey: ["crypto-latest-study"] });
    } catch (e: any) {
      const msg = e?.message ?? String(e);
      setErr(msg);
      toast.error(msg);
    } finally {
      setRunning(false);
    }
  };

  const study = q.data?.study ?? null;
  const newSince = q.data?.newMissesSinceStudy ?? 0;

  return (
    <div className="border border-border rounded-lg bg-card p-3 space-y-3">
      <div className="flex items-center justify-between gap-2 flex-wrap">
        <div>
          <div className="text-[10px] uppercase tracking-wider text-muted-foreground">
            Model study · why we got picks wrong
          </div>
          {study && (
            <div className="text-[10px] text-muted-foreground mt-0.5">
              Last run {new Date(study.created_at).toLocaleString()} · {study.misses_analyzed} misses / {study.wins_analyzed} wins
              {newSince > 0 && <span className="ml-2 text-amber-400">· {newSince} new miss{newSince === 1 ? "" : "es"} since</span>}
            </div>
          )}
        </div>
        <button
          onClick={run}
          disabled={running}
          className="text-xs px-3 py-1.5 rounded border border-border bg-muted/40 hover:bg-muted disabled:opacity-50 flex items-center gap-1.5"
        >
          {running ? <Loader2 className="w-3 h-3 animate-spin" /> : <Zap className="w-3 h-3" />}
          {running ? "Studying…" : study ? "Re-run study" : "Diagnose & study losses"}
        </button>
      </div>

      {err && <div className="text-xs text-red-400">{err}</div>}

      {!study && !running && (
        <div className="text-xs text-muted-foreground">
          No AI study yet. Click above to diagnose recent losses and run a Gemini analysis of what went wrong.
        </div>
      )}

      {study && (
        <>
          <div className="text-xs text-foreground/90 leading-relaxed">{study.summary}</div>

          {study.dominant_failures.length > 0 && (
            <div className="flex flex-wrap gap-1.5">
              {study.dominant_failures.map((f, i) => (
                <span key={i} className="text-[10px] px-2 py-0.5 rounded border border-amber-500/40 bg-amber-500/10 text-amber-300">
                  {f}
                </span>
              ))}
            </div>
          )}

          {study.recommendations.length > 0 && (
            <div className="space-y-2">
              <div className="text-[10px] uppercase tracking-wider text-muted-foreground">Recommendations — vote to teach the next study</div>
              {study.recommendations.map((r: StudyRecommendation, i: number) => (
                <RecommendationCard
                  key={i}
                  rec={r}
                  index={i}
                  studyId={study.id}
                  vote={study.feedback?.[i] ?? null}
                  onVoted={() => qc.invalidateQueries({ queryKey: ["crypto-latest-study"] })}
                />
              ))}
            </div>
          )}
        </>
      )}

      <ShadowSimTable />
    </div>
  );
}

function RecommendationCard({
  rec, index, studyId, vote, onVoted,
}: {
  rec: StudyRecommendation;
  index: number;
  studyId: string;
  vote: "up" | "down" | null;
  onVoted: () => void;
}) {
  const feedbackFn = useServerFn(setRecommendationFeedback);
  const [busy, setBusy] = useState(false);
  const pColor = rec.priority === "high" ? "border-red-500/50 text-red-300 bg-red-500/10"
    : rec.priority === "medium" ? "border-amber-500/50 text-amber-300 bg-amber-500/10"
    : "border-border text-muted-foreground bg-muted/30";

  const send = async (next: "up" | "down") => {
    setBusy(true);
    try {
      await feedbackFn({
        data: {
          studyId,
          recIndex: index,
          vote: vote === next ? null : next, // click same vote to clear
          recGate: rec.gate,
          recSuggested: rec.suggested,
        },
      });
      onVoted();
    } catch (e: any) {
      toast.error(e?.message ?? "vote failed");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="border border-border/60 rounded p-2 space-y-1">
      <div className="flex items-center gap-2 flex-wrap">
        <span className={`text-[10px] px-1.5 py-0.5 rounded border ${pColor}`}>{rec.priority}</span>
        <span className="text-xs font-mono text-foreground/90">{rec.gate}</span>
        <span className="text-[10px] text-muted-foreground">now: {rec.currentSetting}</span>
        <div className="ml-auto flex items-center gap-1">
          <button
            disabled={busy}
            onClick={() => send("up")}
            className={`text-xs px-1.5 py-0.5 rounded border transition ${
              vote === "up" ? "border-emerald-500/70 bg-emerald-500/20 text-emerald-300" : "border-border bg-muted/30 text-muted-foreground hover:text-emerald-300"
            }`}
            title="Helpful — the next study will favor patterns like this"
          >
            👍
          </button>
          <button
            disabled={busy}
            onClick={() => send("down")}
            className={`text-xs px-1.5 py-0.5 rounded border transition ${
              vote === "down" ? "border-red-500/70 bg-red-500/20 text-red-300" : "border-border bg-muted/30 text-muted-foreground hover:text-red-300"
            }`}
            title="Not helpful — the next study will avoid patterns like this"
          >
            👎
          </button>
        </div>
      </div>
      <div className="text-xs text-emerald-300">→ {rec.suggested}</div>
      <div className="text-[11px] text-muted-foreground leading-snug">{rec.rationale}</div>
    </div>
  );
}

function ShadowSimTable() {
  const qc = useQueryClient();
  const recomputeFn = useServerFn(recomputeShadowSim);
  const reportFn = useServerFn(getShadowSimReport);
  const [running, setRunning] = useState(false);

  const q = useQuery({
    queryKey: ["crypto-shadow-sim"],
    queryFn: () => reportFn(),
    staleTime: 60_000,
  });

  const run = async () => {
    setRunning(true);
    try {
      const r = await recomputeFn();
      toast.success(`Simulated ${r.evaluated} settled orders across gate thresholds`);
      await qc.invalidateQueries({ queryKey: ["crypto-shadow-sim"] });
    } catch (e: any) {
      toast.error(e?.message ?? "shadow sim failed");
    } finally {
      setRunning(false);
    }
  };

  const stats: ShadowSimGateStat[] = q.data?.stats ?? [];
  const evaluated = q.data?.orders_evaluated ?? 0;

  return (
    <div className="border-t border-border pt-3 mt-1 space-y-2">
      <div className="flex items-center justify-between gap-2 flex-wrap">
        <div>
          <div className="text-[10px] uppercase tracking-wider text-muted-foreground">
            Shadow simulator · what if these gates had been on
          </div>
          <div className="text-[10px] text-muted-foreground mt-0.5">
            {evaluated > 0
              ? `Replayed against ${evaluated} settled auto-trade order${evaluated === 1 ? "" : "s"}. Live trading is not affected.`
              : "No shadow sim yet. Click to replay past settled auto-trade orders against gate thresholds."}
          </div>
        </div>
        <button
          onClick={run}
          disabled={running}
          className="text-xs px-3 py-1.5 rounded border border-border bg-muted/40 hover:bg-muted disabled:opacity-50 flex items-center gap-1.5"
        >
          {running ? <Loader2 className="w-3 h-3 animate-spin" /> : <Activity className="w-3 h-3" />}
          {running ? "Simulating…" : stats.length > 0 ? "Recompute" : "Run shadow sim"}
        </button>
      </div>

      {stats.length > 0 && (
        <div className="overflow-x-auto">
          <table className="w-full text-xs font-mono">
            <thead className="text-[10px] uppercase tracking-wider text-muted-foreground">
              <tr className="text-left">
                <th className="py-1 pr-3">Gate</th>
                <th className="pr-3">Threshold</th>
                <th className="pr-3 text-right">Would block</th>
                <th className="pr-3 text-right">Losses saved</th>
                <th className="pr-3 text-right">Wins killed</th>
                <th className="pr-3 text-right">Net $</th>
              </tr>
            </thead>
            <tbody>
              {stats.map((s, i) => {
                const netColor = s.net_usd > 5 ? "text-emerald-400"
                  : s.net_usd < -5 ? "text-red-400"
                  : "text-muted-foreground";
                return (
                  <tr key={i} className="border-t border-border/40">
                    <td className="py-1 pr-3 text-foreground/90">{s.gate_name}</td>
                    <td className="pr-3">{s.threshold_label}</td>
                    <td className="pr-3 text-right">{s.would_block} / {s.n_evaluated}</td>
                    <td className="pr-3 text-right text-emerald-300">{s.losses_saved_n} · ${s.losses_saved_usd.toFixed(2)}</td>
                    <td className="pr-3 text-right text-red-300">{s.wins_killed_n} · ${s.wins_killed_usd.toFixed(2)}</td>
                    <td className={`pr-3 text-right ${netColor}`}>{s.net_usd >= 0 ? "+" : ""}${s.net_usd.toFixed(2)}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          <div className="text-[10px] text-muted-foreground italic mt-1">
            Sorted by net $. Positive = the gate would have saved money if it had been on. Currently limited to sigma/edge/prob gates — richer gates (candle, trendline, verdict) start being simulatable once new trades log their full snapshot.
          </div>
        </div>
      )}
    </div>
  );
}
