import type { computeOurQuote } from "@/lib/ourOdds";
import { toAmericanOdds } from "@/lib/ourOdds";

interface Props {
  /** Precomputed quote from useOurQuote — shared with the chart pulse pills. */
  quote: ReturnType<typeof computeOurQuote> | null;
  /** Kalshi implied UP probability (0..1), for the Δ chip. */
  kalshiUpProb?: number | null;
}

/**
 * Kalshi-style UP/DOWN odds pill. Presentational only — the quote is
 * computed upstream via useOurQuote so this pill and the chart pulse-dot
 * pills always show the same numbers.
 */
export function OurOddsPill({ quote, kalshiUpProb }: Props) {
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
