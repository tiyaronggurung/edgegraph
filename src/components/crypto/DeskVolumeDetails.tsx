import type { SpotVolumeLeg } from "@/lib/btcSpotVolume.functions";
import type { CoinbaseFlow } from "@/lib/btcMultiVenueVolume.functions";
import type { CompositeDayTotals } from "@/lib/compositeDayTotals.functions";

const usd = (value: number | null) => value == null ? "—" : `$${value.toLocaleString(undefined, { maximumFractionDigits: 0 })}`;
const tone = (positive: boolean) => positive ? "text-success" : "text-destructive";

function FlowAmounts({ buy, sell }: { buy: number; sell: number }) {
  return <div className="flex flex-wrap items-center gap-x-2 gap-y-1 font-mono">
    <span className="text-success">in {buy.toFixed(1)} BTC↑</span>
    <span className="text-muted-foreground">/</span>
    <span className="text-destructive">out {sell.toFixed(1)} BTC↓</span>
    <span className="text-muted-foreground">net {buy >= sell ? "+" : "−"}{Math.abs(buy - sell).toFixed(1)} BTC</span>
  </div>;
}

function Averages({ buy, sell, price, composite = false }: { buy: number | null; sell: number | null; price?: number | null; composite?: boolean }) {
  return <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-muted-foreground">
    <span>{composite ? "composite avg in" : "avg in"} <span className="text-success">{usd(buy)}</span></span>
    <span>avg out <span className="text-destructive">{usd(sell)}</span></span>
    {price != null && buy != null && <span>now vs avg in <span className={tone(price >= buy)}>{price >= buy ? "+" : "−"}${Math.abs(price - buy).toFixed(0)}</span></span>}
    {buy != null && sell != null && <span className={tone(buy >= sell)}>{buy >= sell ? "in-flow paying up" : "out-flow dumping"}</span>}
  </div>;
}

function Imbalance({ value }: { value: number | null }) {
  return value == null ? null : <span className={tone(value >= 0)}>{(value * 100).toFixed(0)}% {value >= 0 ? "buy-side" : "sell-side"}</span>;
}

function weightedAverage(a: number, priceA: number | null, b: number, priceB: number | null) {
  const volumeA = priceA == null ? 0 : a;
  const volumeB = priceB == null ? 0 : b;
  const total = volumeA + volumeB;
  return total > 0 ? (volumeA * (priceA ?? 0) + volumeB * (priceB ?? 0)) / total : null;
}

/** Read-only volume presentation; all inputs come from Crypto's shared query keys. */
export function DeskVolumeDetails({ window, coinbase, day, price }: {
  window: SpotVolumeLeg | null;
  coinbase: CoinbaseFlow | null;
  day: CompositeDayTotals | null;
  price: number | null;
}) {
  const buy = window && coinbase ? window.buy + coinbase.inBtc : null;
  const sell = window && coinbase ? window.sell + coinbase.outBtc : null;
  const imbalance = buy != null && sell != null && buy + sell > 0 ? (buy - sell) / (buy + sell) : null;
  const avgIn = window && coinbase ? weightedAverage(window.buy, window.avgBuyPrice, coinbase.inBtc, coinbase.avgIn) : null;
  const avgOut = window && coinbase ? weightedAverage(window.sell, window.avgSellPrice, coinbase.outBtc, coinbase.avgOut) : null;

  return <section aria-label="Live BTC volume details" className="space-y-3 border-y border-border py-4 text-xs">
    <div className="flex flex-wrap items-center justify-between gap-2">
      <h2 className="text-sm font-semibold">BTC volume this 15m window</h2>
      <span className="text-lg font-bold">{window ? `${window.total.toLocaleString(undefined, { maximumFractionDigits: 1 })} BTC` : "—"}</span>
    </div>
    {window ? <FlowAmounts buy={window.buy} sell={window.sell} /> : <p className="text-muted-foreground">Waiting for current-window volume…</p>}
    <div className="grid gap-4 md:grid-cols-3">
      <div className="min-w-0 space-y-2">
        <h3 className="text-muted-foreground">Coinbase in/out</h3>
        {coinbase ? <>
          <FlowAmounts buy={coinbase.inBtc} sell={coinbase.outBtc} />
          <Averages buy={coinbase.avgIn} sell={coinbase.avgOut} />
          {coinbase.partial && <p className="text-warning">partial sample</p>}
        </> : <p className="text-muted-foreground">Waiting for Coinbase…</p>}
      </div>
      <div className="min-w-0 space-y-2">
        <div className="flex flex-wrap justify-between gap-2"><h3 className="text-muted-foreground">composite in/out (Binance + Coinbase)</h3><Imbalance value={imbalance} /></div>
        {buy != null && sell != null ? <>
          <FlowAmounts buy={buy} sell={sell} />
          {imbalance != null && Math.abs(imbalance) >= 0.05 && <p className={tone(imbalance >= 0)}>{imbalance >= 0 ? "buyers in control" : "sellers in control"}</p>}
          <Averages buy={avgIn} sell={avgOut} price={price} composite />
        </> : <p className="text-muted-foreground">Waiting for both venues…</p>}
      </div>
      <div className="min-w-0 space-y-2">
        <div className="flex flex-wrap justify-between gap-2"><h3 className="text-muted-foreground">today so far · {day ? `${day.windows} window${day.windows === 1 ? "" : "s"}` : "—"} (NY day)</h3><Imbalance value={day?.imbalance ?? null} /></div>
        {day ? <>
          <FlowAmounts buy={day.inBtc} sell={day.outBtc} />
          <div className="flex flex-wrap gap-x-3 gap-y-1 text-muted-foreground">
            <span>avg in <span className="text-success">{usd(day.avgIn)}</span></span>
            <span>avg out <span className="text-destructive">{usd(day.avgOut)}</span></span>
            {day.avgIn != null && day.avgOut != null && <span className={tone(day.avgIn >= day.avgOut)}>{day.avgIn >= day.avgOut ? "buyers paying up" : "sellers dumping"}</span>}
          </div>
        </> : <p className="text-muted-foreground">Waiting for day totals…</p>}
      </div>
    </div>
    {window && (window.avgBuyPrice != null || window.avgSellPrice != null) && <div className="space-y-1 border-t border-border pt-3">
      <Averages buy={window.avgBuyPrice} sell={window.avgSellPrice} price={price} />
      {price != null && window.avgBuyPrice != null && <p className={tone(price >= window.avgBuyPrice)}>{price >= window.avgBuyPrice ? "buyers in profit — in-flow pushed price" : "buyers underwater — in-flow not pushing"}</p>}
    </div>}
  </section>;
}