import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useMemo, useState, useEffect, useRef } from "react";
import { Activity, ExternalLink, RefreshCw, Loader2, Zap, AlertTriangle, CheckCircle2, XCircle, ArrowUp, ArrowDown, Volume2, VolumeX } from "lucide-react";
import { playOrderPlaced, playOrderFilled } from "@/lib/orderSounds";
import { getBtcMarkets, type BtcMarket, type BtcCandle } from "@/lib/cryptoBtc.functions";
import { placeKalshiOrder, listMyCryptoTrades, checkKalshiConfigured, sellKalshiOrder, settleExpiredTrades, checkKalshiBalance, diagnoseKalshiAuth, type KalshiDiagStep } from "@/lib/cryptoTrades.functions";
import { getPredictionStats, getCalibrationReport, type CalibrationRow } from "@/lib/cryptoPredictions.functions";
import { listAutoTradeOrders, settleAutoTradeOrders, runAutoTrade, autoExitLivePositions, settleAutoTradeSkipLog, getSkipReport, type AutoTradeOrderRow } from "@/lib/cryptoAutoTrade.functions";
import { useBinanceBtcSpot } from "@/hooks/useBinanceBtcSpot";
import { useBtcVelocity } from "@/hooks/useBtcVelocity";
import { EquityMomentumPanel } from "@/components/EquityMomentumPanel";
import { ChartVerdictBadge } from "@/components/crypto/ChartVerdictBadge";
import { KalshiSentimentBadge } from "@/components/crypto/KalshiSentimentBadge";
import { useChartVerdict } from "@/hooks/useChartVerdict";
import { useCalibrationShift } from "@/hooks/useCalibrationShift";
import { useMarketRegime } from "@/hooks/useMarketRegime";
import { useCoinbaseBtcSpot } from "@/hooks/useCoinbaseBtcSpot";
import { useBinanceBtcTicks } from "@/hooks/useBinanceBtcTicks";
import { shouldSkipForMagnet } from "@/lib/roundLevelGate";
import { useTrendlineAnalysis } from "@/hooks/useTrendlineAnalysis";
import { useCandleMomentum } from "@/hooks/useCandleMomentum";
import { computeKalshiSentiment } from "@/lib/kalshiSentiment";

import { toast } from "sonner";

export const Route = createFileRoute("/_authenticated/crypto")({
  head: () => ({
    meta: [
      { title: "Crypto Predictions — BTC 15min Up/Down — EdgeGraph AI" },
      { name: "description", content: "Live model predictions for Kalshi BTC 15-minute up/down markets with edge vs market price." },
    ],
  }),
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
        <div className="flex items-center gap-2">
          <div className={`px-2 py-0.5 text-[11px] uppercase tracking-wider border rounded ${sideColor}`}>Model: {dirLabel(m.side)}</div>
          <div className={`px-2 py-0.5 text-[11px] font-bold uppercase tracking-wider border rounded ${
            m.gateAction === "BET"
              ? "bg-[color:var(--color-primary)]/20 text-[color:var(--color-primary)] border-[color:var(--color-primary)]/60"
              : "bg-muted/30 text-muted-foreground border-border"
          }`}>
            {m.gateAction === "BET" ? "✓ BET" : "✕ PASS"}
          </div>
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
  return (
    <div className="border border-[color:var(--color-primary)]/60 rounded-lg bg-[color:var(--color-primary)]/5 p-4">
      <div className="flex items-center gap-2 mb-1">
        <Zap className="h-4 w-4 text-[color:var(--color-primary)]" />
        <span className="text-xs uppercase tracking-wider text-[color:var(--color-primary)]">Model Top Pick</span>
      </div>
      <div className="text-lg font-bold">
        Bet BTC goes <span className="text-[color:var(--color-primary)]">{dirLabel(pick.side)}</span> from strike {fmt$(pick.strike)} · closes {fmtTime(pick.closeTime)}
      </div>
      <div className="text-sm text-muted-foreground mt-1">
        Spot {fmt$(pick.spot)} · Model {(pick.modelYesProb*100).toFixed(1)}% vs market {(pick.yesPrice*100).toFixed(0)}¢ · edge {pick.edgePts>=0?"+":""}{pick.edgePts.toFixed(1)}pts
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

function ModelAccuracyPanel() {
  const fn = useServerFn(getPredictionStats);
  const q = useQuery({ queryKey: ["btc-pred-stats"], queryFn: () => fn(), refetchInterval: 60_000 });
  const s = q.data;

  const pct = (n: number) => (n * 100).toFixed(1) + "%";
  const Cell = ({ label, value, sub }: { label: string; value: string; sub?: string }) => (
    <div className="px-3 py-2">
      <div className="text-[10px] uppercase tracking-wider text-muted-foreground">{label}</div>
      <div className="text-lg font-bold font-mono">{value}</div>
      {sub && <div className="text-[10px] text-muted-foreground">{sub}</div>}
    </div>
  );

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
          <div className="grid grid-cols-2 md:grid-cols-5 divide-x divide-border">
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
              label="Awaiting settle"
              value={String(s.total - s.settled)}
              sub="close time passed but BTC price pending"
            />
          </div>
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
                      <th className="text-left p-2">Model pick</th>
                      <th className="text-right p-2">Strike</th>
                      <th className="text-right p-2">Model%</th>
                      <th className="text-right p-2">Market¢</th>
                      <th className="text-right p-2">Edge</th>
                      <th className="text-right p-2">Settle</th>
                      <th className="text-center p-2">Result</th>
                    </tr>
                  </thead>
                  <tbody>
                    {s.recent.map((r) => (
                      <tr key={r.ticker} className="border-t border-border">
                        <td className="p-2">{new Date(r.closeTime).toLocaleString([], { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" })}</td>
                        <td className="p-2 font-mono">{r.ticker}</td>
                        <td className="p-2"><span className={r.side === "YES" ? "text-emerald-400" : "text-red-400"}>{dirLabel(r.side)}</span></td>
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
                    ))}
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

function AutoTradePanel() {
  const qc = useQueryClient();
  const listFn = useServerFn(listAutoTradeOrders);
  const settleFn = useServerFn(settleAutoTradeOrders);
  const autoExitFn = useServerFn(autoExitLivePositions);
  const settleSkipFn = useServerFn(settleAutoTradeSkipLog);
  const skipReportFn = useServerFn(getSkipReport);
  const runFn = useServerFn(runAutoTrade);
  const balanceFn = useServerFn(checkKalshiBalance);
  const diagFn = useServerFn(diagnoseKalshiAuth);
  // Read the shared btc-markets cache populated by CryptoPage. React Query
  // dedupes by key — no extra fetch, we just subscribe to updates.
  const marketsFn = useServerFn(getBtcMarkets);
  const marketsQ = useQuery({ queryKey: ["btc-markets"], queryFn: () => marketsFn(), refetchInterval: 10_000, staleTime: 5_000 });

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
      "SIZE: $20/order · up to 3 orders this click · $60 max exposure\n" +
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
      const res = await runFn({ data: { mode: "live", confirm: "I_UNDERSTAND_LIVE", stakeUsd: 150, maxOrders: 3 } });
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
        "up to 2 × $20 orders at current Kalshi quotes.\n\n" +
        "BYPASSED: edge/σ/momentum/equity/24h-dedupe/loss-cap gates.\n" +
        "ENFORCED: kill switch, key health, 40 orders in 24h,\n" +
        "auto-exit (TP +70% / SL -50% / edge-decay 2¢).\n\n" +
        "Click OK to proceed.",
      );
      if (!ok) return;
    }
    setForceBusy(true);
    try {
      const res = await runFn({ data: { mode: "live", confirm: "I_UNDERSTAND_LIVE", stakeUsd: 20, maxOrders: 2, force: true } });
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

  // ============================================================
  // Auto-Martingale: fires ONCE per new 15m window (00/15/30/45).
  // Live mode, model's UP/DOWN pick, no entry gates (force=true, 1 order).
  // Stake ladder: $20 base, ×2 on loss (cap $320), reset to $20 on win.
  // ============================================================
  const MART_BASE = 20;
  const MART_CAP = 320;
  const WINDOW_MS = 15 * 60 * 1000;
  // Paroli (anti-martingale) upsize: press winners only when the settled order
  // cleared a strong model gate. Resets on loss or after MART_PAROLI_MAX wins.
  // Per-step multipliers: win#1 → 1.5x, win#2 → 1.0x (hold flat for safer 3rd bet).
  const MART_PAROLI_STEPS = [1.5, 1.0];
  const MART_PAROLI_MAX = 3;
  const MART_PAROLI_MIN_SIGMA = 1.5;
  const MART_PAROLI_MIN_EDGE = 5;

  const [autoMart, setAutoMart] = useState<boolean>(() => {
    if (typeof window === "undefined") return false;
    return window.localStorage.getItem("crypto.autoMart") === "on";
  });
  const [martStake, setMartStake] = useState<number>(() => {
    if (typeof window === "undefined") return MART_BASE;
    const v = Number(window.localStorage.getItem("crypto.autoMart.stake"));
    return Number.isFinite(v) && v >= MART_BASE ? v : MART_BASE;
  });
  const [martLosses, setMartLosses] = useState<number>(() => {
    if (typeof window === "undefined") return 0;
    return Number(window.localStorage.getItem("crypto.autoMart.losses")) || 0;
  });
  const [martWins, setMartWins] = useState<number>(() => {
    if (typeof window === "undefined") return 0;
    return Number(window.localStorage.getItem("crypto.autoMart.wins")) || 0;
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






  useEffect(() => {
    if (typeof window === "undefined") return;
    window.localStorage.setItem("crypto.autoMart", autoMart ? "on" : "off");
  }, [autoMart]);
  useEffect(() => {
    if (typeof window === "undefined") return;
    window.localStorage.setItem("crypto.autoMart.stake", String(martStake));
    window.localStorage.setItem("crypto.autoMart.losses", String(martLosses));
    window.localStorage.setItem("crypto.autoMart.wins", String(martWins));
  }, [martStake, martLosses, martWins]);

  // Watch the last martingale order and adjust stake when it settles.
  useEffect(() => {
    if (typeof window === "undefined") return;
    const lastId = window.localStorage.getItem("crypto.autoMart.lastOrderId");
    if (!lastId) return;
    const o = liveOrders.find(x => x.id === lastId);
    if (!o) return;
    if (o.status === "settled_win") {
      // Case A: recovering from a loss ladder → win locks in, reset everything.
      if (martLosses > 0) {
        setMartStake(MART_BASE);
        setMartLosses(0);
        setMartWins(0);
        toast.success(`Martingale WIN — loss ladder recovered, stake reset to $${MART_BASE}`);
      } else {
        // Case B: paroli upsize — press the winner ONLY if the settled order
        // cleared the model gate AND we haven't hit the streak cap yet.
        const sig = Number(o.sigma_distance ?? 0);
        const edge = Math.abs(Number(o.edge_pts ?? 0));
        const gatePassed = sig >= MART_PAROLI_MIN_SIGMA && edge >= MART_PAROLI_MIN_EDGE;
        const nextWins = martWins + 1;
        if (nextWins >= MART_PAROLI_MAX) {
          setMartStake(MART_BASE);
          setMartWins(0);
          toast.success(`Paroli WIN #${nextWins} — streak cap, locking in & reset to $${MART_BASE}`);
        } else if (gatePassed) {
          const mult = MART_PAROLI_STEPS[martWins] ?? 1.0;
          const nextStake = Math.min(Math.round(martStake * mult), MART_CAP);
          setMartStake(nextStake);
          setMartWins(nextWins);
          toast.success(`Paroli WIN #${nextWins} — pressing to $${nextStake} (σ ${sig.toFixed(2)} · edge ${edge.toFixed(1)}pt)`);
        } else {
          setMartStake(MART_BASE);
          setMartWins(0);
          toast.success(`Martingale WIN — weak signal (σ ${sig.toFixed(2)} · edge ${edge.toFixed(1)}pt), reset to $${MART_BASE}`);
        }
      }
      window.localStorage.removeItem("crypto.autoMart.lastOrderId");
    } else if (o.status === "settled_loss") {
      // Loss always breaks the paroli streak; loss-doubling ladder continues.
      const nextStake = Math.min(martStake * 2, MART_CAP);
      const nextLosses = martLosses + 1;
      if (nextStake !== martStake || martWins !== 0) {
        setMartStake(nextStake);
        setMartLosses(nextLosses);
        setMartWins(0);
        toast.error(`Martingale LOSS — next stake $${nextStake} (loss #${nextLosses})`);
      }
      window.localStorage.removeItem("crypto.autoMart.lastOrderId");
    }
  }, [liveOrders, martStake, martLosses, martWins]);

  async function runMartingale(stakeUsd: number): Promise<string | null> {
    try {
      const res = await runFn({ data: { mode: "live", confirm: "I_UNDERSTAND_LIVE", stakeUsd, maxOrders: 1, force: true, isMartingale: true } });
      if (res.placed > 0 && res.orders?.[0]) {
        const o = res.orders[0];
        toast.success(`Martingale $${stakeUsd}: ${o.side === "YES" ? "UP" : "DOWN"} ${o.ticker} @ ${o.limit_cents}¢`);
        qc.invalidateQueries({ queryKey: ["auto-trade-orders"] });
        return o.id ?? null;
      }
      toast.info(`Martingale skipped: ${res.skipReasons.slice(0, 2).join(" · ") || "no tradeable market"}`);
      return null;
    } catch (e: any) {
      toast.error("Martingale order failed", { description: e?.message ?? String(e) });
      return null;
    }
  }

  useEffect(() => {
    if (!autoMart) return;
    if (typeof window === "undefined") return;
    let cancelled = false;
    let inFlight = false;
    const tick = async () => {
      if (cancelled || inFlight) return;
      const now = Date.now();
      const currentWindow = Math.floor(now / WINDOW_MS) * WINDOW_MS;
      const lastWindow = Number(window.localStorage.getItem("crypto.autoMart.lastWindowMs")) || 0;
      if (currentWindow === lastWindow) return;
      // Wait until the previous martingale order has actually settled before
      // firing the next window. This matches "buy the next 15m market once
      // the one we have is closed."
      const pendingId = window.localStorage.getItem("crypto.autoMart.lastOrderId");
      if (pendingId) {
        const prev = liveOrders.find(x => x.id === pendingId);
        const settled = prev && (prev.status === "settled_win" || prev.status === "settled_loss");
        if (prev && !settled) return; // still open — hold fire
      }
      // Optional chart gate — only when user has toggled it ON. Skip window on chop.
      if (chartGate) {
        const cv = chartVerdict;
        if (!cv.ready) {
          // Not enough ticks yet — hold, retry next tick (don't burn the window).
          return;
        }
        const effectiveScore = calibrate ? calShift.adjustedScore : cv.score;
        const skew = Math.abs(effectiveScore - 50);
        if (skew < CHART_GATE_MIN_SKEW) {
          // Chop → skip this window entirely (burn it so we don't retry-fire mid-window).
          window.localStorage.setItem("crypto.autoMart.lastWindowMs", String(currentWindow));
          const calNote = calibrate && calShift.ready ? ` [cal ${calShift.shift >= 0 ? "+" : ""}${calShift.shift.toFixed(1)}]` : "";
          toast.info(`Chart gate: window skipped — chop (score ${effectiveScore.toFixed(0)}${calNote}, skew ${skew.toFixed(0)} < ${CHART_GATE_MIN_SKEW})`);
          return;
        }
      }
      // Optional Kalshi-sentiment gate — skip when market itself is chop (48–52¢).
      if (sentimentGate) {
        const s = kalshiSentiment;
        if (!s.ready) {
          // No market data yet — hold, don't burn the window.
          return;
        }
        if (s.isChop) {
          window.localStorage.setItem("crypto.autoMart.lastWindowMs", String(currentWindow));
          toast.info(`Sentiment gate: window skipped — ${s.reason}`);
          return;
        }
      }

      // Optional Round-number gate — skip windows where ATM strike isn't a
      // multiple of 50. Round levels act as magnets/support-resistance.
      if (roundGate) {
        const s = kalshiSentiment;
        if (!s.ready || s.strike == null) {
          // No market data yet — hold, don't burn the window.
          return;
        }
        if (Math.round(s.strike) % ROUND_STEP !== 0) {
          window.localStorage.setItem("crypto.autoMart.lastWindowMs", String(currentWindow));
          toast.info(`Round-number gate: window skipped — ATM strike $${s.strike.toFixed(0)} not a multiple of ${ROUND_STEP}`);
          return;
        }
      }

      // Optional HTF (5m EMA20/50) trend gate — skip when higher-timeframe
      // trend is flat or opposes the chart verdict's implied side.
      if (htfGate) {
        const cv = chartVerdict;
        if (!cv.htfReady || !cv.ready) return;
        if (cv.htfTrend === "flat") {
          window.localStorage.setItem("crypto.autoMart.lastWindowMs", String(currentWindow));
          toast.info(`HTF gate: window skipped — ${cv.htfReason}`);
          return;
        }
        // Direction the chart wants to bet (score>50 → up, <50 → down).
        const chartSide: "up" | "down" = cv.score >= 50 ? "up" : "down";
        if (chartSide !== cv.htfTrend) {
          window.localStorage.setItem("crypto.autoMart.lastWindowMs", String(currentWindow));
          toast.info(`HTF gate: window skipped — chart wants ${chartSide.toUpperCase()} but HTF is ${cv.htfTrend.toUpperCase()}`);
          return;
        }
      }

      // Optional ETH agreement gate — skip when BTC & ETH diverge.
      if (ethGate) {
        const cv = chartVerdict;
        if (cv.ethAgrees === false) {
          window.localStorage.setItem("crypto.autoMart.lastWindowMs", String(currentWindow));
          toast.info(`ETH gate: window skipped — ${cv.ethReason}`);
          return;
        }
      }

      // Optional round-number magnet gate (Phase 4) — skip when spot is glued
      // to a $50/$100 level and the break hasn't confirmed on our side.
      if (magnetGate) {
        const cv = chartVerdict;
        if (!cv.ready) return;
        const side: "up" | "down" = (calibrate ? calShift.adjustedScore : cv.score) >= 50 ? "up" : "down";
        const lastPrice = btcTicks.ticks.length ? btcTicks.ticks[btcTicks.ticks.length - 1].p : 0;
        const check = shouldSkipForMagnet(lastPrice, side, btcTicks.ticks);
        if (check.skip) {
          window.localStorage.setItem("crypto.autoMart.lastWindowMs", String(currentWindow));
          toast.info(`Magnet gate: window skipped — ${check.reason}`);
          return;
        }
      }

      // Optional Trendline+Fib gate — skip fires that oppose bias or fire
      // during a neutral wedge.
      if (trendGate) {
        const t = trendAnalysis;
        if (!t.ready) return;
        const cv = chartVerdict;
        const side: "up" | "down" = (calibrate ? calShift.adjustedScore : cv.score) >= 50 ? "up" : "down";
        if (t.bias === "neutral") {
          window.localStorage.setItem("crypto.autoMart.lastWindowMs", String(currentWindow));
          toast.info(`Trendline gate: window skipped — neutral (${t.reason})`);
          return;
        }
        const trendSide: "up" | "down" = t.bias === "bull" ? "up" : "down";
        if (trendSide !== side) {
          window.localStorage.setItem("crypto.autoMart.lastWindowMs", String(currentWindow));
          toast.info(`Trendline gate: window skipped — chart wants ${side.toUpperCase()} but trendlines say ${t.bias.toUpperCase()} (${t.reason})`);
          return;
        }
      }


      // Optional Candle Momentum gate — if a big red or big green is forecast
      // for the current forming 1m candle, don't take a fresh 15m position:
      //   big_red   => sell/protect (skip so we don't buy into a dump)
      //   big_green => hold (existing entry is fine; skip fresh window)
      if (candleGate && candleMomentum.ready) {
        if (candleMomentum.forecast === "big_red") {
          window.localStorage.setItem("crypto.autoMart.lastWindowMs", String(currentWindow));
          toast.info(`Candle gate: SELL signal — big red forming (${candleMomentum.forecastReason}, ${candleMomentum.forecastConfidence}%)`);
          return;
        }
        if (candleMomentum.forecast === "big_green") {
          window.localStorage.setItem("crypto.autoMart.lastWindowMs", String(currentWindow));
          toast.info(`Candle gate: HOLD — big green forming (${candleMomentum.forecastReason}, ${candleMomentum.forecastConfidence}%)`);
          return;
        }
      }

      inFlight = true;
      // Optimistically mark this window taken so we can't double-fire during the async call.
      window.localStorage.setItem("crypto.autoMart.lastWindowMs", String(currentWindow));
      const orderId = await runMartingale(martStake);
      if (orderId) {
        window.localStorage.setItem("crypto.autoMart.lastOrderId", orderId);
      } else {
        // Retry next tick if placement was skipped/failed.
        window.localStorage.removeItem("crypto.autoMart.lastWindowMs");
      }
      inFlight = false;
    };
    tick();
    const h = setInterval(tick, 5_000);
    return () => { cancelled = true; clearInterval(h); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [autoMart, martStake, liveOrders, chartGate, chartVerdict, sentimentGate, kalshiSentiment, roundGate, htfGate, ethGate, calibrate, calShift, magnetGate, btcTicks, trendGate, trendAnalysis, candleGate, candleMomentum]);



  return (
    <div className="border border-border rounded-lg bg-card">
      <div className="px-4 py-2 border-b border-border flex items-center justify-between flex-wrap gap-2">
        <div>
          <h2 className="text-sm uppercase tracking-wider text-muted-foreground flex items-center gap-2">
            Live Kalshi auto-trade
            <span className="text-[10px] px-2 py-0.5 rounded bg-emerald-500/15 text-emerald-400 border border-emerald-500/30 flex items-center gap-1">
              <span className="h-1.5 w-1.5 rounded-full bg-emerald-400 animate-pulse" /> AUTO
            </span>
          </h2>
          <p className="text-[11px] text-muted-foreground">
            $20×3/click · entry: EV≥3¢, edge≥5pts, σ≥1.25 · ladder: +6¢ →50%, +12¢ →100%, -15¢ →SL · fallbacks: TP+70%/SL-50%/flip/net-lock · halt 40 orders or -$80/24h
          </p>
          <p className="text-[10px] text-muted-foreground mt-0.5">
            Live 24h: {liveCount24h}/40 orders · realized <span className={liveRealized24h >= 0 ? "text-emerald-400" : "text-red-400"}>{liveRealized24h >= 0 ? "+" : ""}${liveRealized24h.toFixed(2)}</span>
          </p>
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
          <button
            onClick={() => {
              if (!autoMart) {
                const ok = window.confirm(
                  "ENABLE AUTO-MARTINGALE (LIVE)?\n\n" +
                  "• Fires ONCE per new 15m window (00/15/30/45)\n" +
                  "• Takes model's UP/DOWN pick — no entry gates\n" +
                  "• Ladder: $20 → $40 → $80 → $160 → $320 (cap)\n" +
                  "• Reset to $20 on any WIN\n\n" +
                  `Current stake: $${martStake} (loss streak: ${martLosses})\n\n` +
                  "40 orders / 24h cap and auto-exit ladder still enforced.",
                );
                if (!ok) return;
              }
              setAutoMart(v => !v);
            }}
            className={`text-xs font-semibold px-3 py-1.5 rounded border flex items-center gap-1.5 ${autoMart ? "border-fuchsia-500/50 bg-fuchsia-500/15 text-fuchsia-300" : "border-border bg-muted/30 hover:bg-muted/50"}`}
            title="Auto-Martingale: once per 15m window, live, model direction, stake doubles on loss ($20→$40→$80→$160→$320), resets on win."
          >
            <span className={`h-1.5 w-1.5 rounded-full ${autoMart ? "bg-fuchsia-400 animate-pulse" : "bg-muted-foreground"}`} />
            {autoMart ? `Martingale ON · $${martStake}` : "Martingale OFF"}
            {autoMart && martLosses > 0 && <span className="text-[10px] text-red-300">L{martLosses}</span>}
            {autoMart && martWins > 0 && <span className="text-[10px] text-emerald-300">W{martWins}</span>}
          </button>
          {autoMart && (
            <button
              onClick={() => {
                if (window.confirm("Reset Martingale stake back to $20?")) {
                  setMartStake(MART_BASE);
                  setMartLosses(0);
                  setMartWins(0);
                  window.localStorage.removeItem("crypto.autoMart.lastOrderId");
                  toast.success("Martingale ladder reset to $20");
                }
              }}
              className="text-[10px] font-semibold px-2 py-1.5 rounded border border-border bg-muted/30 hover:bg-muted/50"
              title="Manually reset the doubling ladder back to base $20"
            >
              reset
            </button>
          )}
          {autoMart && <MartingaleCountdown windowMs={WINDOW_MS} />}
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
                return (
                  <tr key={o.id} className="border-b border-border/40 hover:bg-muted/20">
                    <td className="px-3 py-1.5 font-mono text-muted-foreground">{fmtTime(o.created_at)}</td>
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
  );
}

function CryptoPage() {
  const qc = useQueryClient();
  const marketsFn = useServerFn(getBtcMarkets);
  const cfgFn = useServerFn(checkKalshiConfigured);
  const placeFn = useServerFn(placeKalshiOrder);

  const q = useQuery({ queryKey: ["btc-markets"], queryFn: () => marketsFn(), refetchInterval: 10_000, staleTime: 5_000 });
  const cfg = useQuery({ queryKey: ["kalshi-cfg"], queryFn: () => cfgFn(), staleTime: 60_000 });

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
        <button onClick={() => q.refetch()} className="flex items-center gap-1 text-xs uppercase tracking-wider px-3 py-1.5 border border-border rounded hover:bg-card">
          {q.isFetching ? <Loader2 className="h-3 w-3 animate-spin" /> : <RefreshCw className="h-3 w-3" />} Refresh
        </button>
      </div>

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

      {q.isLoading && <div className="border border-border rounded-lg bg-card p-6 text-center text-sm text-muted-foreground"><Loader2 className="h-4 w-4 animate-spin inline mr-2" /> Loading…</div>}
      {q.isError && <div className="border border-red-500/40 rounded-lg bg-card p-4 text-sm text-red-400">Failed to load Kalshi/Coinbase feeds.</div>}

      {data && (
        <>
          <TopPick markets={data.markets} />
          <OpenPositions markets={data.markets} />
          <div className="space-y-2">
            {data.markets.length === 0 && <div className="border border-border rounded-lg bg-card p-6 text-center text-sm text-muted-foreground">No open BTC 15-min markets right now.</div>}
            {data.markets.map(m => <MarketRow key={m.ticker} m={m} candles={data.candles} sizing={sizing} onPlace={setPending} live={live} />)}
          </div>

          <PricingStudyPanel markets={data.markets} />

          <CalibrationReportPanel />

          <ModelAccuracyPanel />

          <EquityMomentumPanel />

          <AutoTradePanel />

          <div>
            <h2 className="text-sm uppercase tracking-wider text-muted-foreground mb-2">Trade log</h2>
            <TradeLog />
          </div>
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
