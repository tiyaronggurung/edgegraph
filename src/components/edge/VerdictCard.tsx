import { CheckCircle2, Eye, XCircle } from "lucide-react";

interface Props {
  fairProb: number | null | undefined; // 0..1
  marketYesPct: number; // 0..100
  yesLabel?: string; // e.g. "OKC"
  pattern?: string | null;
  kellyHalfStake?: number | null; // dollars, ½ Kelly suggestion
}

/**
 * Top-of-card verdict pill. Pure read-only consumer of values already
 * computed elsewhere — no math changes, no side effects.
 *
 * Rules:
 *   BET   → fairProb ≥ 55% AND edgePts ≥ 5
 *   WATCH → edge 2–5pts OR fairProb 50–55%
 *   PASS  → edge < 2pts OR fairProb < 50%
 *
 * If fairProb is missing, renders nothing (no fallback guess).
 */
export function VerdictCard({ fairProb, marketYesPct, yesLabel, pattern, kellyHalfStake }: Props) {
  if (fairProb == null || !Number.isFinite(fairProb)) return null;

  const fairPct = fairProb * 100;
  const yesEdge = fairPct - marketYesPct; // + = YES underpriced
  const noEdge = -yesEdge; // + = NO underpriced (market overpricing YES)

  // Pick the side with the larger positive edge
  const side: "YES" | "NO" = yesEdge >= noEdge ? "YES" : "NO";
  const edgePts = Math.max(yesEdge, noEdge);
  const sideFairProb = side === "YES" ? fairPct : 100 - fairPct;
  const sideMarketPct = side === "YES" ? marketYesPct : 100 - marketYesPct;
  const sideLabel = side === "YES" ? yesLabel || "YES" : `NO (${yesLabel ? `not ${yesLabel}` : "field"})`;

  let verdict: "BET" | "WATCH" | "PASS";
  if (sideFairProb >= 55 && edgePts >= 5) verdict = "BET";
  else if (edgePts >= 2 || sideFairProb >= 50) verdict = "WATCH";
  else verdict = "PASS";

  const tone =
    verdict === "BET"
      ? "border-emerald-500/60 bg-emerald-500/10 text-emerald-400"
      : verdict === "WATCH"
        ? "border-amber-500/60 bg-amber-500/10 text-amber-400"
        : "border-red-500/40 bg-red-500/5 text-red-400/80";

  const Icon = verdict === "BET" ? CheckCircle2 : verdict === "WATCH" ? Eye : XCircle;

  const headline =
    verdict === "BET"
      ? `BET ${sideLabel}`
      : verdict === "WATCH"
        ? `WATCH ${sideLabel}`
        : "PASS — no edge";

  const reason =
    verdict === "PASS"
      ? `Fair ${sideFairProb.toFixed(0)}% vs market ${sideMarketPct.toFixed(0)}% — edge only ${edgePts.toFixed(1)}pt`
      : `Fair ${sideFairProb.toFixed(0)}% vs market ${sideMarketPct.toFixed(0)}% → +${edgePts.toFixed(1)}pt edge${
          pattern ? ` · ${pattern}` : ""
        }`;

  return (
    <div className={`border rounded p-2 ${tone}`}>
      <div className="flex items-center gap-2">
        <Icon className="h-4 w-4 shrink-0" />
        <span className="font-bold uppercase tracking-widest text-xs">{headline}</span>
        {verdict === "BET" && kellyHalfStake && kellyHalfStake > 0 && (
          <span className="ml-auto text-[10px] font-mono opacity-80">½K ${kellyHalfStake}</span>
        )}
      </div>
      <div className="text-[10px] mt-1 opacity-80 leading-snug">{reason}</div>
    </div>
  );
}
