import { useMemo } from "react";
import { Sparkles } from "lucide-react";
import { computeKellyPresets } from "@/lib/kelly";
import { PlaceBetButton } from "@/components/edge/PlaceBetButton";

// Minimum bar to surface a "best bet" — never recommend marginal noise.
const MIN_EDGE_PTS = 3;
const MIN_CONFIDENCE = 60;
const MIN_FAIR_PROB = 0.55;

type CoachCard = {
  event: { title: string; competition?: string; seriesTicker?: string };
  market: { ticker: string; yesPrice: number; yesSubTitle?: string };
  fv: { fairProb: number; edgePts: number; yesTeam?: "home" | "away" } | null;
  confidence: { score: number };
};

interface Props {
  cards: CoachCard[];
  bankroll: number;
  unit: number;
  userId?: string | null;
}

export function AiCoachBanner({ cards, bankroll, unit, userId }: Props) {
  const best = useMemo(() => {
    const candidates = cards
      .map((c) => {
        if (!c.fv) return null;
        const fairPct = c.fv.fairProb * 100;
        const yesPct = c.market.yesPrice * 100;
        const yesEdge = fairPct - yesPct;
        const noEdge = -yesEdge;
        const side: "YES" | "NO" = yesEdge >= noEdge ? "YES" : "NO";
        const edgePts = Math.max(yesEdge, noEdge);
        const sideFairProb = side === "YES" ? fairPct / 100 : 1 - fairPct / 100;
        const sidePrice = side === "YES" ? c.market.yesPrice : 1 - c.market.yesPrice;
        if (edgePts < MIN_EDGE_PTS) return null;
        if (c.confidence.score < MIN_CONFIDENCE) return null;
        if (sideFairProb < MIN_FAIR_PROB) return null;
        const presets = computeKellyPresets(sideFairProb, sidePrice, bankroll, unit);
        if (!presets.hasEdge || presets.half <= 0) return null;
        const sideLabel =
          side === "YES"
            ? c.market.yesSubTitle || "YES"
            : `NO (${c.market.yesSubTitle ? `not ${c.market.yesSubTitle}` : "field"})`;
        return {
          card: c,
          side,
          sideLabel,
          edgePts,
          sideFairProb,
          sidePrice,
          stake: presets.half,
          score: edgePts * c.confidence.score, // ranking signal
        };
      })
      .filter((x): x is NonNullable<typeof x> => x !== null)
      .sort((a, b) => b.score - a.score);
    return candidates[0] ?? null;
  }, [cards, bankroll, unit]);

  if (!best) {
    return (
      <div className="border border-border bg-card rounded p-4 flex items-center gap-3">
        <Sparkles className="h-5 w-5 text-muted-foreground shrink-0" />
        <div className="flex-1 min-w-0">
          <div className="text-xs uppercase tracking-widest text-muted-foreground">
            AI Coach
          </div>
          <div className="text-sm text-muted-foreground">
            No bet clears the safety threshold right now. Holding the line — your
            edge will come.
          </div>
        </div>
      </div>
    );
  }

  const pctOfBankroll = bankroll > 0 ? (best.stake / bankroll) * 100 : 0;

  return (
    <div className="border border-[color:var(--color-primary)]/60 bg-gradient-to-r from-[color:var(--color-primary)]/10 to-transparent rounded p-4">
      <div className="flex items-start gap-3">
        <Sparkles className="h-5 w-5 text-[color:var(--color-primary)] shrink-0 mt-0.5" />
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 mb-1">
            <span className="text-[10px] uppercase tracking-widest text-[color:var(--color-primary)] font-bold">
              AI Coach · Best Bet Now
            </span>
            <span className="text-[10px] uppercase tracking-widest text-muted-foreground">
              {best.card.event.competition || best.card.event.seriesTicker}
            </span>
          </div>
          <div className="text-base font-bold">
            Bet{" "}
            <span className="text-[color:var(--color-primary)]">
              ${best.stake.toLocaleString()}
            </span>{" "}
            on{" "}
            <span className="text-[color:var(--color-primary)]">
              {best.sideLabel}
            </span>{" "}
            @ {best.sidePrice.toFixed(2)}
          </div>
          <div className="text-xs text-muted-foreground mt-1 truncate">
            {best.card.event.title} · edge +{best.edgePts.toFixed(1)}pts · fair{" "}
            {(best.sideFairProb * 100).toFixed(0)}% · ½-Kelly ·{" "}
            {pctOfBankroll.toFixed(1)}% of bankroll · ★ {best.card.confidence.score}
          </div>
        </div>
        {userId && (
          <div className="shrink-0">
            <PlaceBetButton
              userId={userId}
              marketTicker={best.card.market.ticker}
              marketTitle={best.card.event.title ?? null}
              side={best.side}
              sideLabel={best.sideLabel}
              defaultStake={best.stake}
              defaultEntryPrice={Math.min(0.99, Math.max(0.01, best.sidePrice))}
            />
          </div>
        )}
      </div>
    </div>
  );
}
