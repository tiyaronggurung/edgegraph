import { useEffect, useMemo, useRef } from "react";
import {
  computeOurQuote,
  ewmaVolFromTape,
  momentumTilt,
  realizedVolFromCloses,
  toAmericanOdds,
  type TapeSample,
} from "@/lib/ourOdds";

interface Props {
  /** Live composite spot (BTC USD), smoothed. */
  spot: number | null | undefined;
  /** Strike for the current Kalshi 15m window. */
  strike: number | null | undefined;
  /** Seconds remaining until close (Kalshi-anchored, ticks locally). */
  secondsToClose: number | null | undefined;
  /** 1m closes we already fetched for the chart. Fallback for σ when tape is cold. */
  closes1m: number[];
  /** Kalshi implied UP probability (0..1), for the Δ chip. */
  kalshiUpProb?: number | null;
}

const TAPE_MAX = 240;         // ~4min at 1/s
const TAPE_MIN_DT_MS = 250;   // don't record more than 4 samples/sec

/**
 * Kalshi-style UP/DOWN odds pill computed from our own faster feed.
 *
 * - σ from EWMA of our live tape (λ=0.94), fallback to 1m closes.
 * - mid = Φ(ln(S/K) / (σ√T))  + tiny momentum tilt from last 60s drift.
 * - Adds synthetic bid/ask half-spread → UP¢ + DOWN¢ > 100, never equal.
 *
 * Presentational only.
 */
export function OurOddsPill({ spot, strike, secondsToClose, closes1m, kalshiUpProb }: Props) {
  // Rolling tape of {t,p} for EWMA σ + momentum.
  const tapeRef = useRef<TapeSample[]>([]);
  useEffect(() => {
    if (spot == null || !Number.isFinite(spot) || !(spot > 0)) return;
    const now = Date.now();
    const tape = tapeRef.current;
    const last = tape[tape.length - 1];
    if (last && now - last.t < TAPE_MIN_DT_MS) return;
    tape.push({ t: now, p: spot });
    if (tape.length > TAPE_MAX) tape.splice(0, tape.length - TAPE_MAX);
  }, [spot]);

  const quote = useMemo(() => {
    if (spot == null || strike == null || secondsToClose == null) return null;
    const tape = tapeRef.current;
    const sigma =
      ewmaVolFromTape(tape) ??
      realizedVolFromCloses(closes1m.slice(-30));
    if (sigma == null) return null;
    const tilt = momentumTilt(tape);
    return computeOurQuote({
      spot,
      strike,
      secondsToClose,
      sigmaAnnualized: sigma,
      momentumTiltPct: tilt,
    });
    // Recompute on every spot tick — that's the whole point (faster than Kalshi).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [spot, strike, secondsToClose, closes1m]);

  if (!quote) {
    return (
      <span
        className="text-[10px] px-1.5 py-0.5 rounded border border-white/10 bg-black/40 text-white/40 font-mono"
        title="Our odds unavailable — waiting for spot / candles"
      >
        OUR ODDS —
      </span>
    );
  }

  const upFav = quote.mid >= 0.5;
  const upOdds = toAmericanOdds(quote.pUpAsk);
  const downOdds = toAmericanOdds(quote.pDownAsk);

  const delta = kalshiUpProb != null ? quote.mid - kalshiUpProb : null;
  const deltaCls =
    delta == null ? "text-white/40" :
    Math.abs(delta) < 0.01 ? "text-white/50" :
    delta > 0 ? "text-emerald-300" : "text-rose-300";

  const upSide = upFav
    ? "bg-emerald-500/25 text-emerald-100 border-emerald-400/50"
    : "bg-white/5 text-white/60 border-white/10";
  const downSide = !upFav
    ? "bg-rose-500/25 text-rose-100 border-rose-400/50"
    : "bg-white/5 text-white/60 border-white/10";

  const overround = (quote.upCents + quote.downCents) - 100;
  const title =
    `Our ask-side odds (Kalshi-style GBM + spread):\n` +
    `  MID P(UP) = ${(quote.mid * 100).toFixed(1)}%\n` +
    `  UP  ask   = ${quote.upCents.toFixed(1)}¢  →  ${upOdds}\n` +
    `  DOWN ask  = ${quote.downCents.toFixed(1)}¢  →  ${downOdds}\n` +
    `  Half-spread = ${(quote.halfSpread * 100).toFixed(2)}¢  ·  Overround = ${overround.toFixed(1)}¢\n` +
    (kalshiUpProb != null ? `Kalshi P(UP) = ${(kalshiUpProb * 100).toFixed(1)}%  ·  Δ = ${((delta ?? 0) * 100).toFixed(2)}%\n` : "") +
    `σ from live tape (EWMA λ=0.94); tilt from last-60s drift.\nRecomputed every tick.`;

  return (
    <span
      className="text-[10px] font-mono flex items-center gap-1 rounded border border-white/10 bg-black/50 pl-1.5 pr-1.5 py-0.5"
      title={title}
    >
      <span className="text-white/50">OURS</span>
      <span className={`inline-flex items-center gap-1 px-1.5 py-[1px] rounded-l border ${upSide}`}>
        <span className="font-semibold">UP</span>
        <span className="tabular-nums">{upOdds}</span>
      </span>
      <span className={`inline-flex items-center gap-1 px-1.5 py-[1px] rounded-r border ${downSide}`}>
        <span className="font-semibold">DOWN</span>
        <span className="tabular-nums">{downOdds}</span>
      </span>
      {delta != null && (
        <span className={`tabular-nums ml-0.5 ${deltaCls}`} title="Our MID P(UP) − Kalshi P(UP)">
          Δ {delta >= 0 ? "+" : ""}{(delta * 100).toFixed(1)}%
        </span>
      )}
    </span>
  );
}
