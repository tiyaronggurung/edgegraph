import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { Activity, ArrowDown, ArrowUp, Clock3, LockKeyhole } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { useLiveCompositeSpot } from "@/hooks/useLiveCompositeSpot";
import { getBtcCandles, type CandleTf } from "@/lib/btcCandles.functions";
import { buildHourlyForecast, HOURLY_STUDY_LOCK_MINUTE, type HourlySide } from "@/lib/hourlyBtcForecast";

const TIMEFRAMES: Array<{ tf: CandleTf; limit: number }> = [
  { tf: "1m", limit: 180 },
  { tf: "5m", limit: 180 },
  { tf: "15m", limit: 160 },
  { tf: "1h", limit: 180 },
];

const money = (value: number | null) => value == null
  ? "—"
  : value.toLocaleString("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 2 });

const percent = (value: number) => `${(value * 100).toFixed(value >= 0.995 || value <= 0.005 ? 1 : 0)}%`;

function sideClasses(side: HourlySide | null) {
  return side === "UP"
    ? "border-success/40 bg-success/10 text-success"
    : side === "DOWN"
      ? "border-destructive/40 bg-destructive/10 text-destructive"
      : "border-border bg-muted text-muted-foreground";
}

function PickBox({ label, side, confidence, locked }: {
  label: string;
  side: HourlySide | null;
  confidence: number | null;
  locked: boolean;
}) {
  return (
    <div className={`border p-3 ${sideClasses(side)}`}>
      <div className="flex items-center justify-between gap-2 text-[10px] uppercase">
        <span>{label}</span>
        {locked && <LockKeyhole className="h-3 w-3" aria-label="Locked" />}
      </div>
      <div className="mt-2 flex items-baseline gap-2">
        <span className="text-xl font-bold">{side ?? "STUDYING"}</span>
        {confidence != null && <span className="text-xs tabular-nums">{percent(confidence)}</span>}
      </div>
    </div>
  );
}

export function HourlyBtcForecastPanel() {
  const candlesFn = useServerFn(getBtcCandles);
  const live = useLiveCompositeSpot();
  const [nowMs, setNowMs] = useState(() => Date.now());

  useEffect(() => {
    const timer = window.setInterval(() => setNowMs(Date.now()), 1_000);
    return () => window.clearInterval(timer);
  }, []);

  const queries = TIMEFRAMES.map(({ tf, limit }) => useQuery({
    queryKey: ["btc-hourly-forecast-candles", tf],
    queryFn: () => candlesFn({ data: { tf, limit } }),
    staleTime: tf === "1m" ? 10_000 : 60_000,
    refetchInterval: tf === "1m" ? 10_000 : 60_000,
    placeholderData: keepPreviousData,
    refetchOnWindowFocus: false,
  }));

  const dataByTf = Object.fromEntries(TIMEFRAMES.map(({ tf }, index) => [tf, queries[index].data?.candles ?? []]));
  const fallbackSpot = dataByTf["1m"][dataByTf["1m"].length - 1]?.c ?? null;
  const spot = live.spot ?? fallbackSpot;
  const forecast = useMemo(() => {
    if (spot == null) return null;
    return buildHourlyForecast({
      nowMs,
      spot,
      candles1m: dataByTf["1m"],
      candles5m: dataByTf["5m"],
      candles15m: dataByTf["15m"],
      candles1h: dataByTf["1h"],
    });
  }, [nowMs, spot, dataByTf["1m"], dataByTf["5m"], dataByTf["15m"], dataByTf["1h"]]);

  if (!forecast || spot == null) {
    return <section className="border border-border bg-card p-5 text-sm text-muted-foreground">Loading one-hour BTC forecast…</section>;
  }

  const minutes = Math.floor(forecast.secondsLeft / 60);
  const seconds = forecast.secondsLeft % 60;
  const endLabel = new Date(forecast.windowEnd).toLocaleTimeString("en-US", {
    hour: "numeric", minute: "2-digit", timeZone: "America/New_York", timeZoneName: "short",
  });
  const volumeRatio = forecast.volumeAverage > 0 ? forecast.volumeNow / forecast.volumeAverage : null;
  const verdictClass = forecast.verdict === "AGREE"
    ? "text-success"
    : forecast.verdict === "DISAGREE" ? "text-destructive" : "text-warning";

  return (
    <section className="border border-border bg-card" aria-labelledby="hourly-btc-title">
      <header className="border-b border-border p-4 md:p-5">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <div className="terminal-label">Read-only hourly forecast</div>
            <h2 id="hourly-btc-title" className="mt-1 text-lg font-semibold">BTC price ladder · {endLabel}</h2>
            <p className="mt-1 text-xs text-muted-foreground">Strict hourly Model lock plus a {HOURLY_STUDY_LOCK_MINUTE}-minute trendline Study lock.</p>
          </div>
          <div className="text-right">
            <div className="text-2xl font-bold tabular-nums text-foreground">{money(spot)}</div>
            <div className="mt-1 flex items-center justify-end gap-1 text-xs text-muted-foreground">
              <Clock3 className="h-3.5 w-3.5" />
              <span className="tabular-nums">{minutes}:{String(seconds).padStart(2, "0")} left</span>
            </div>
          </div>
        </div>

        <div className="mt-4 grid gap-2 sm:grid-cols-3">
          <PickBox label="Model pick · frozen at open" side={forecast.model?.side ?? null} confidence={forecast.model?.confidence ?? null} locked={forecast.model != null} />
          <PickBox label="Study pick · opening lock" side={forecast.study?.side ?? null} confidence={forecast.study?.confidence ?? null} locked={forecast.study != null} />
          <div className="border border-border bg-muted/30 p-3">
            <div className="text-[10px] uppercase text-muted-foreground">Confirmation</div>
            <div className={`mt-2 text-xl font-bold ${verdictClass}`}>{forecast.verdict.replace("_", " ")}</div>
            <div className="mt-1 text-[10px] text-muted-foreground">No order execution</div>
          </div>
        </div>
      </header>

      <div className="grid lg:grid-cols-[minmax(0,1fr)_270px]">
        <div className="overflow-x-auto">
          <table className="w-full min-w-[560px] text-sm">
            <thead className="border-b border-border text-[10px] uppercase text-muted-foreground">
              <tr>
                <th className="px-4 py-3 text-left font-medium">BTC at {endLabel}</th>
                <th className="px-4 py-3 text-right font-medium">Move needed</th>
                <th className="px-4 py-3 text-right font-medium">Above / UP</th>
                <th className="px-4 py-3 text-right font-medium">Below / DOWN</th>
              </tr>
            </thead>
            <tbody>
              {forecast.ladder.map((row) => {
                const nearSpot = Math.abs(row.distanceUsd) < 60;
                return (
                  <tr key={row.target} className={`border-b border-border/70 last:border-0 ${nearSpot ? "bg-primary/5" : ""}`}>
                    <td className="px-4 py-3 font-semibold tabular-nums">{money(row.target)} or above</td>
                    <td className={`px-4 py-3 text-right tabular-nums ${row.distanceUsd <= 0 ? "text-success" : "text-muted-foreground"}`}>
                      {row.distanceUsd > 0 ? "+" : ""}{money(row.distanceUsd)}
                    </td>
                    <td className="px-4 py-3 text-right">
                      <span className="inline-flex min-w-16 items-center justify-center gap-1 border border-success/35 bg-success/10 px-2 py-1 font-semibold text-success tabular-nums">
                        <ArrowUp className="h-3.5 w-3.5" />{percent(row.aboveProbability)}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-right">
                      <span className="inline-flex min-w-16 items-center justify-center gap-1 border border-destructive/35 bg-destructive/10 px-2 py-1 font-semibold text-destructive tabular-nums">
                        <ArrowDown className="h-3.5 w-3.5" />{percent(row.belowProbability)}
                      </span>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>

        <aside className="border-t border-border p-4 lg:border-l lg:border-t-0">
          <div className="terminal-label">One-hour trendline</div>
          <dl className="mt-3 space-y-3 text-xs">
            <Metric label="SELL / resistance" value={money(forecast.sell)} tone="text-destructive" />
            <Metric label="MID / confirmation" value={money(forecast.mid)} tone="text-info" />
            <Metric label="BUY / support" value={money(forecast.buy)} tone="text-success" />
            <Metric label="Hourly open" value={money(forecast.hourlyOpen)} />
            <Metric label="Expected move" value={`±${money(forecast.expectedMoveUsd)}`} />
            <Metric label="Session VWAP" value={money(forecast.vwap)} />
            <Metric label="5m volume" value={volumeRatio == null ? "—" : `${volumeRatio.toFixed(2)}× avg`} />
          </dl>
          <div className="mt-5 flex items-start gap-2 border-t border-border pt-4 text-[10px] leading-relaxed text-muted-foreground">
            <Activity className="mt-0.5 h-3.5 w-3.5 shrink-0" />
            <span>Probabilities use one shared distribution and stay ordered across every target. Shadow display only.</span>
          </div>
        </aside>
      </div>
    </section>
  );
}

function Metric({ label, value, tone = "text-foreground" }: { label: string; value: string; tone?: string }) {
  return (
    <div className="flex items-center justify-between gap-3 border-b border-border/60 pb-2">
      <dt className="text-muted-foreground">{label}</dt>
      <dd className={`font-semibold tabular-nums ${tone}`}>{value}</dd>
    </div>
  );
}