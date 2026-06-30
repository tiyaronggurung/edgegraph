import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useMemo } from "react";
import { Activity, TrendingUp, TrendingDown, ExternalLink, RefreshCw, Loader2, Zap } from "lucide-react";
import { getBtcMarkets, type BtcMarket, type BtcCandle } from "@/lib/cryptoBtc.functions";

export const Route = createFileRoute("/_authenticated/crypto")({
  head: () => ({
    meta: [
      { title: "Crypto Predictions — BTC 15min Up/Down — EdgeGraph AI" },
      { name: "description", content: "Live model predictions for Kalshi BTC 15-minute up/down markets with edge vs market price." },
    ],
  }),
  component: CryptoPage,
});

function fmt$(n: number): string {
  return n.toLocaleString(undefined, { style: "currency", currency: "USD", maximumFractionDigits: 0 });
}
function fmtTime(iso: string | null): string {
  if (!iso) return "—";
  return new Date(iso).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" });
}
function fmtCountdown(seconds: number): string {
  if (seconds <= 0) return "closed";
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return `${m}m ${s.toString().padStart(2, "0")}s`;
}

function Sparkline({ candles, strike }: { candles: BtcCandle[]; strike?: number }) {
  if (!candles.length) return <div className="h-12 text-xs text-muted-foreground">no data</div>;
  const closes = candles.map((c) => c.c);
  const min = Math.min(...closes, strike ?? Infinity);
  const max = Math.max(...closes, strike ?? -Infinity);
  const span = max - min || 1;
  const w = 160, h = 44, pad = 2;
  const pts = closes
    .map((v, i) => {
      const x = pad + (i / (closes.length - 1 || 1)) * (w - 2 * pad);
      const y = h - pad - ((v - min) / span) * (h - 2 * pad);
      return `${x},${y}`;
    })
    .join(" ");
  const last = closes[closes.length - 1];
  const first = closes[0];
  const up = last >= first;
  const stroke = up ? "var(--color-success, #10b981)" : "var(--color-destructive, #ef4444)";
  const strikeY = strike
    ? h - pad - ((strike - min) / span) * (h - 2 * pad)
    : null;
  return (
    <svg width={w} height={h} className="block">
      {strikeY !== null && (
        <line x1={0} x2={w} y1={strikeY} y2={strikeY} stroke="var(--color-primary)" strokeDasharray="3 3" strokeOpacity="0.6" />
      )}
      <polyline points={pts} fill="none" stroke={stroke} strokeWidth="1.5" />
    </svg>
  );
}

function MarketRow({ m, candles }: { m: BtcMarket; candles: BtcCandle[] }) {
  const above = m.spot >= m.strike;
  const conf = m.edgeAbs >= 10 ? "HIGH" : m.edgeAbs >= 5 ? "MED" : "LOW";
  const confColor = conf === "HIGH" ? "text-[color:var(--color-success,#10b981)]"
    : conf === "MED" ? "text-yellow-400" : "text-muted-foreground";
  const sideColor = m.side === "YES"
    ? "bg-[color:var(--color-success,#10b981)]/15 text-[color:var(--color-success,#10b981)] border-[color:var(--color-success,#10b981)]/40"
    : "bg-[color:var(--color-destructive,#ef4444)]/15 text-[color:var(--color-destructive,#ef4444)] border-[color:var(--color-destructive,#ef4444)]/40";

  return (
    <div className="border border-border rounded-lg bg-card p-4 grid grid-cols-1 lg:grid-cols-[1fr_auto_auto] gap-4 items-center">
      <div className="space-y-1">
        <div className="flex items-center gap-2">
          <span className="text-xs uppercase tracking-wider text-muted-foreground">{m.subTitle || m.title}</span>
          <a
            href={`https://kalshi.com/markets/kxbtc15m/bitcoin-price-up-down/${m.eventTicker.toLowerCase()}`}
            target="_blank" rel="noreferrer"
            className="text-muted-foreground hover:text-foreground"
          >
            <ExternalLink className="h-3 w-3" />
          </a>
        </div>
        <div className="text-base font-semibold">
          Strike <span className="text-[color:var(--color-primary)]">{fmt$(m.strike)}</span>
          <span className="mx-2 text-muted-foreground">·</span>
          Spot <span className={above ? "text-[color:var(--color-success,#10b981)]" : "text-[color:var(--color-destructive,#ef4444)]"}>{fmt$(m.spot)}</span>
          <span className="mx-2 text-muted-foreground">·</span>
          <span className="text-xs text-muted-foreground">closes {fmtTime(m.closeTime)} ({fmtCountdown(m.secondsToClose)})</span>
        </div>
        <div className="flex items-center gap-4 text-xs text-muted-foreground">
          <span>YES last {(m.yesPrice * 100).toFixed(0)}¢</span>
          <span>bid {(m.yesBid * 100).toFixed(0)} / ask {(m.yesAsk * 100).toFixed(0)}</span>
          <span>OI ${m.openInterest.toFixed(0)}</span>
          <span>vol24h ${m.volume24h.toFixed(0)}</span>
        </div>
      </div>

      <div className="flex flex-col items-end gap-1">
        <Sparkline candles={candles} strike={m.strike} />
        <span className="text-[10px] text-muted-foreground">BTC 60m · dashed = strike</span>
      </div>

      <div className="flex flex-col items-end gap-1 min-w-[180px]">
        <div className={`px-2 py-0.5 text-[11px] uppercase tracking-wider border rounded ${sideColor}`}>
          Model: bet {m.side}
        </div>
        <div className="text-sm">
          Model YES prob <span className="font-bold">{(m.modelYesProb * 100).toFixed(1)}%</span>
        </div>
        <div className="text-xs">
          Edge <span className={confColor + " font-semibold"}>{m.edgePts >= 0 ? "+" : ""}{m.edgePts.toFixed(1)} pts</span>
          <span className={"ml-1 " + confColor}>[{conf}]</span>
        </div>
        <div className="text-xs text-muted-foreground">
          ¼-Kelly stake: <span className="text-foreground">{(m.kellyFraction * 100).toFixed(2)}%</span> of bankroll
        </div>
      </div>
    </div>
  );
}

function TopPick({ markets, candles }: { markets: BtcMarket[]; candles: BtcCandle[] }) {
  const pick = useMemo(() => {
    // Best edge among markets with > 60s to close, edge >= 3pts.
    const eligible = markets.filter((m) => m.secondsToClose > 60 && m.edgeAbs >= 3);
    if (!eligible.length) return null;
    return [...eligible].sort((a, b) => b.edgeAbs - a.edgeAbs)[0];
  }, [markets]);

  if (!pick) {
    return (
      <div className="border border-border rounded-lg bg-card p-4 text-sm text-muted-foreground">
        No high-edge BTC 15m market right now. Model needs ≥ 3pt edge to issue a top pick.
      </div>
    );
  }

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
        Spot {fmt$(pick.spot)} · Model YES prob {(pick.modelYesProb * 100).toFixed(1)}% vs market {(pick.yesPrice * 100).toFixed(0)}¢ · edge {pick.edgePts >= 0 ? "+" : ""}{pick.edgePts.toFixed(1)}pts · ¼-Kelly {(pick.kellyFraction * 100).toFixed(2)}%
      </div>
      <div className="mt-2">
        <a
          href={`https://kalshi.com/markets/kxbtc15m/bitcoin-price-up-down/${pick.eventTicker.toLowerCase()}`}
          target="_blank" rel="noreferrer"
          className="inline-flex items-center gap-1 text-xs uppercase tracking-wider text-[color:var(--color-primary)] hover:underline"
        >
          Open on Kalshi <ExternalLink className="h-3 w-3" />
        </a>
      </div>
    </div>
  );
}

function CryptoPage() {
  const fn = useServerFn(getBtcMarkets);
  const q = useQuery({
    queryKey: ["btc-markets"],
    queryFn: () => fn(),
    refetchInterval: 30_000,
    staleTime: 15_000,
  });

  const data = q.data;
  const candles = data?.candles ?? [];

  return (
    <div className="max-w-7xl mx-auto px-4 py-6 space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2">
            <Activity className="h-5 w-5 text-[color:var(--color-primary)]" />
            Crypto Predictions — BTC 15-min
          </h1>
          <p className="text-sm text-muted-foreground mt-1">
            Live Kalshi <code className="text-xs">KXBTC15M</code> markets · model = lognormal diffusion from current spot using last 60min of 1-min bars.
          </p>
        </div>
        <button
          onClick={() => q.refetch()}
          className="flex items-center gap-1 text-xs uppercase tracking-wider px-3 py-1.5 border border-border rounded hover:bg-card"
        >
          {q.isFetching ? <Loader2 className="h-3 w-3 animate-spin" /> : <RefreshCw className="h-3 w-3" />}
          Refresh
        </button>
      </div>

      {q.isLoading && (
        <div className="border border-border rounded-lg bg-card p-6 text-center text-sm text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin inline mr-2" /> Loading BTC markets…
        </div>
      )}
      {q.isError && (
        <div className="border border-[color:var(--color-destructive,#ef4444)]/40 rounded-lg bg-card p-4 text-sm text-[color:var(--color-destructive,#ef4444)]">
          Failed to load Kalshi/Coinbase feeds. Retry shortly.
        </div>
      )}

      {data && (
        <>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
            <div className="border border-border rounded-lg bg-card p-3">
              <div className="text-[10px] uppercase tracking-wider text-muted-foreground">BTC spot</div>
              <div className="text-xl font-bold">{fmt$(data.spot)}</div>
            </div>
            <div className="border border-border rounded-lg bg-card p-3">
              <div className="text-[10px] uppercase tracking-wider text-muted-foreground">Open markets</div>
              <div className="text-xl font-bold">{data.markets.length}</div>
            </div>
            <div className="border border-border rounded-lg bg-card p-3">
              <div className="text-[10px] uppercase tracking-wider text-muted-foreground">Last update</div>
              <div className="text-xl font-bold">{fmtTime(data.asOf)}</div>
            </div>
          </div>

          <TopPick markets={data.markets} candles={candles} />

          <div className="space-y-2">
            {data.markets.length === 0 && (
              <div className="border border-border rounded-lg bg-card p-6 text-center text-sm text-muted-foreground">
                No open BTC 15-min markets right now.
              </div>
            )}
            {data.markets.map((m) => (
              <MarketRow key={m.ticker} m={m} candles={candles} />
            ))}
          </div>

          <p className="text-[11px] text-muted-foreground">
            Model is for analytical/educational purposes only. Crypto markets settle on CF Benchmarks BRTI;
            short-horizon diffusion assumes no jumps. Not financial advice.
          </p>
        </>
      )}
    </div>
  );
}
