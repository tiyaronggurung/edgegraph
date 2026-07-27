import { useMemo } from "react";
import { computeUpProbability, realizedVolFromCloses, toAmericanOdds } from "@/lib/ourOdds";

interface Props {
  /** Live composite spot (BTC USD). */
  spot: number | null | undefined;
  /** Strike for the current Kalshi 15m window. */
  strike: number | null | undefined;
  /** Seconds remaining until close (Kalshi-anchored, ticks locally). */
  secondsToClose: number | null | undefined;
  /** 1m closes we already fetched for the chart. Recent last. */
  closes1m: number[];
  /** Kalshi implied UP probability (0..1), for the Δ chip. */
  kalshiUpProb?: number | null;
}

/**
 * Kalshi-style UP/DOWN odds pill computed from our own faster feed.
 * Presentational only — no model / trade side effects.
 */
export function OurOddsPill({ spot, strike, secondsToClose, closes1m, kalshiUpProb }: Props) {
  const sigma = useMemo(() => {
    // Use last ~30 min for a responsive, short-horizon vol estimate.
    const tail = closes1m.slice(-30);
    return realizedVolFromCloses(tail);
  }, [closes1m]);

  const pUp = useMemo(() => {
    if (spot == null || strike == null || secondsToClose == null || sigma == null) return null;
    return computeUpProbability({
      spot,
      strike,
      secondsToClose,
      sigmaAnnualized: sigma,
    });
  }, [spot, strike, secondsToClose, sigma]);

  if (pUp == null) {
    return (
      <span
        className="text-[10px] px-1.5 py-0.5 rounded border border-white/10 bg-black/40 text-white/40 font-mono"
        title="Our odds unavailable — waiting for spot / candles"
      >
        OUR ODDS —
      </span>
    );
  }

  const pDown = 1 - pUp;
  const upFav = pUp >= 0.5;
  const upOdds = toAmericanOdds(pUp);
  const downOdds = toAmericanOdds(pDown);

  const delta = kalshiUpProb != null ? pUp - kalshiUpProb : null;
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

  const title =
    `Our implied odds (driftless GBM):\n` +
    `  P(UP)   = ${(pUp * 100).toFixed(1)}%  →  ${upOdds}\n` +
    `  P(DOWN) = ${(pDown * 100).toFixed(1)}%  →  ${downOdds}\n` +
    (kalshiUpProb != null ? `Kalshi P(UP) = ${(kalshiUpProb * 100).toFixed(1)}%  ·  Δ = ${((delta ?? 0) * 100).toFixed(2)}%\n` : "") +
    `Recomputed every second from our live composite spot.`;

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
        <span className={`tabular-nums ml-0.5 ${deltaCls}`} title="Our UP prob − Kalshi UP prob">
          Δ {delta >= 0 ? "+" : ""}{(delta * 100).toFixed(1)}%
        </span>
      )}
    </span>
  );
}
