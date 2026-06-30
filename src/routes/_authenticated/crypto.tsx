import { createFileRoute } from "@tanstack/react-router";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useMemo, useState } from "react";
import { Activity, ExternalLink, RefreshCw, Loader2, Zap, AlertTriangle, CheckCircle2, XCircle, ArrowUp, ArrowDown } from "lucide-react";
import { getBtcMarkets, type BtcMarket, type BtcCandle } from "@/lib/cryptoBtc.functions";
import { placeKalshiOrder, listMyCryptoTrades, checkKalshiConfigured } from "@/lib/cryptoTrades.functions";
import { getPredictionStats } from "@/lib/cryptoPredictions.functions";
import { useBinanceBtcSpot } from "@/hooks/useBinanceBtcSpot";
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
  const tradable = sug.contracts > 0 && m.edgeAbs >= 1 && m.secondsToClose > 30;

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
        </div>
      </div>


      <div className="flex flex-col items-end gap-1">
        <Sparkline candles={candles} strike={m.strike} />
        <span className="text-[10px] text-muted-foreground">BTC 60m · dashed = strike</span>
      </div>

      <div className="flex flex-col items-end gap-1 min-w-[180px]">
        <div className={`px-2 py-0.5 text-[11px] uppercase tracking-wider border rounded ${sideColor}`}>Model: bet {m.side}</div>
        <div className="text-sm">Model YES prob <span className="font-bold">{(m.modelYesProb*100).toFixed(1)}%</span></div>
        <div className="text-xs">Edge <span className={confColor+" font-semibold"}>{m.edgePts>=0?"+":""}{m.edgePts.toFixed(1)} pts</span> <span className={"ml-1 "+confColor}>[{conf}]</span></div>
        <div className="text-[10px] text-muted-foreground uppercase tracking-wider">{m.modelSource === "external" ? "your ML model" : "intra-window diffusion"}</div>
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
    const eligible = markets.filter(m => m.secondsToClose > 60 && m.edgeAbs >= 3);
    if (!eligible.length) return null;
    return [...eligible].sort((a,b) => b.edgeAbs - a.edgeAbs)[0];
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
        Bet <span className="text-[color:var(--color-primary)]">{pick.side}</span> · strike {fmt$(pick.strike)} · closes {fmtTime(pick.closeTime)}
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
          <div><span className="text-muted-foreground">Side:</span> <span className="font-bold">{market.side}</span> @ <span className="font-bold">{sug.limitCents}¢</span> limit</div>
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
              <td className="p-2"><span className={t.side === "YES" ? "text-emerald-400" : "text-red-400"}>{t.side}</span></td>
              <td className="p-2 text-right">{t.strike ? fmt$(Number(t.strike)) : "—"}</td>
              <td className="p-2 text-right">{t.spot_at_entry ? fmt$(Number(t.spot_at_entry)) : "—"}</td>
              <td className="p-2 text-right">{t.model_prob != null ? (Number(t.model_prob)*100).toFixed(1) + "%" : "—"}</td>
              <td className="p-2 text-right">{t.edge_pts != null ? (Number(t.edge_pts) >= 0 ? "+" : "") + Number(t.edge_pts).toFixed(1) : "—"}</td>
              <td className="p-2 text-right">{t.contracts}</td>
              <td className="p-2 text-right">{fmt$(Number(t.stake_usd || 0))}</td>
              <td className="p-2">
                {t.status === "submitted" && <span className="inline-flex items-center gap-1 text-emerald-400"><CheckCircle2 className="h-3 w-3" />submitted</span>}
                {t.status === "error" && <span className="inline-flex items-center gap-1 text-red-400" title={t.error}><XCircle className="h-3 w-3" />error</span>}
                {t.status === "pending" && <span className="text-yellow-400">pending</span>}
                {t.status !== "submitted" && t.status !== "error" && t.status !== "pending" && <span>{t.status}</span>}
              </td>
              <td className="p-2 text-right">{t.pnl_usd != null ? fmt$(Number(t.pnl_usd)) : "—"}</td>
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
            <div className="border-t border-border overflow-x-auto">
              <table className="w-full text-xs">
                <thead className="bg-muted/30 text-muted-foreground uppercase tracking-wider">
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
                      <td className="p-2"><span className={r.side === "YES" ? "text-emerald-400" : "text-red-400"}>{r.side}</span></td>
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
          )}
        </>
      )}
    </div>
  );
}

function CryptoPage() {
  const qc = useQueryClient();
  const marketsFn = useServerFn(getBtcMarkets);
  const cfgFn = useServerFn(checkKalshiConfigured);
  const placeFn = useServerFn(placeKalshiOrder);

  const q = useQuery({ queryKey: ["btc-markets"], queryFn: () => marketsFn(), refetchInterval: 30_000, staleTime: 15_000 });
  const cfg = useQuery({ queryKey: ["kalshi-cfg"], queryFn: () => cfgFn(), staleTime: 60_000 });

  const [bankroll, setBankroll] = useState(1000);
  const [kellyMult, setKellyMult] = useState(0.25);
  const sizing: SizingState = { bankroll, kellyMult };
  const [pending, setPending] = useState<BtcMarket | null>(null);
  const live = useBinanceBtcSpot();

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

      {q.isLoading && <div className="border border-border rounded-lg bg-card p-6 text-center text-sm text-muted-foreground"><Loader2 className="h-4 w-4 animate-spin inline mr-2" /> Loading…</div>}
      {q.isError && <div className="border border-red-500/40 rounded-lg bg-card p-4 text-sm text-red-400">Failed to load Kalshi/Coinbase feeds.</div>}

      {data && (
        <>
          <TopPick markets={data.markets} />
          <div className="space-y-2">
            {data.markets.length === 0 && <div className="border border-border rounded-lg bg-card p-6 text-center text-sm text-muted-foreground">No open BTC 15-min markets right now.</div>}
            {data.markets.map(m => <MarketRow key={m.ticker} m={m} candles={data.candles} sizing={sizing} onPlace={setPending} live={live} />)}
          </div>

          <ModelAccuracyPanel />

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
