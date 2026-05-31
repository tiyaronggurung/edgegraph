import { useEffect, useRef } from "react";
import { CheckCircle2, Eye, XCircle } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { PlaceBetButton } from "@/components/edge/PlaceBetButton";
import { LiveBetPL } from "@/components/edge/LiveBetPL";


interface Props {
  fairProb: number | null | undefined; // 0..1
  marketYesPct: number; // 0..100
  yesLabel?: string;
  pattern?: string | null;
  kellyHalfStake?: number | null;
  // Auto-log context (optional). If userId + marketTicker present and
  // verdict === BET, insert one row into verdict_log per session.
  userId?: string | null;
  marketTicker?: string | null;
  marketTitle?: string | null;
}

// Session-scoped dedupe — never insert the same (user, ticker, side) twice
// while the tab is open. Resets on full reload, which is fine: a fresh
// reload means a fresh snapshot of "what the analytics said".
const loggedKeys = new Set<string>();

export function VerdictCard({
  fairProb,
  marketYesPct,
  yesLabel,
  pattern,
  kellyHalfStake,
  userId,
  marketTicker,
  marketTitle,
}: Props) {
  // Hooks must run unconditionally — compute everything, then early-return.
  const hasFair = fairProb != null && Number.isFinite(fairProb);
  const fairPct = hasFair ? (fairProb as number) * 100 : 0;
  const yesEdge = fairPct - marketYesPct;
  const noEdge = -yesEdge;
  const side: "YES" | "NO" = yesEdge >= noEdge ? "YES" : "NO";
  const edgePts = Math.max(yesEdge, noEdge);
  const sideFairProb = side === "YES" ? fairPct : 100 - fairPct;
  const sideMarketPct = side === "YES" ? marketYesPct : 100 - marketYesPct;
  const sideLabel =
    side === "YES" ? yesLabel || "YES" : `NO (${yesLabel ? `not ${yesLabel}` : "field"})`;

  let verdict: "BET" | "WATCH" | "PASS" = "PASS";
  if (hasFair) {
    if (sideFairProb >= 55 && edgePts >= 5) verdict = "BET";
    else if (edgePts >= 2 || sideFairProb >= 50) verdict = "WATCH";
  }

  // Auto-log BET verdicts (idempotent per session).
  const firedRef = useRef(false);
  useEffect(() => {
    if (firedRef.current) return;
    if (!hasFair || verdict !== "BET") return;
    if (!userId || !marketTicker) return;
    const key = `${userId}|${marketTicker}|${side}`;
    if (loggedKeys.has(key)) {
      firedRef.current = true;
      return;
    }
    loggedKeys.add(key);
    firedRef.current = true;
    // Fire-and-forget. Swallow errors so the live page never breaks.
    void supabase
      .from("verdict_log")
      .insert({
        user_id: userId,
        market_ticker: marketTicker,
        market_title: marketTitle ?? null,
        side,
        side_label: sideLabel,
        fair_prob: Number(sideFairProb.toFixed(2)),
        market_prob: Number(sideMarketPct.toFixed(2)),
        edge_pts: Number(edgePts.toFixed(2)),
        pattern: pattern ?? null,
        kelly_half: kellyHalfStake ?? null,
        verdict: "BET",
      })
      .then(({ error }) => {
        if (error) {
          // Allow retry next render if the insert actually failed.
          loggedKeys.delete(key);
          firedRef.current = false;
        }
      });
  }, [
    hasFair,
    verdict,
    userId,
    marketTicker,
    marketTitle,
    side,
    sideLabel,
    sideFairProb,
    sideMarketPct,
    edgePts,
    pattern,
    kellyHalfStake,
  ]);

  if (!hasFair) return null;

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
      {verdict === "BET" && userId && marketTicker && (
        <PlaceBetButton
          userId={userId}
          marketTicker={marketTicker}
          marketTitle={marketTitle ?? null}
          side={side}
          sideLabel={sideLabel}
          defaultStake={kellyHalfStake && kellyHalfStake > 0 ? kellyHalfStake : 25}
          defaultEntryPrice={Math.min(0.99, Math.max(0.01, sideMarketPct / 100))}
        />
      )}
    </div>
  );
}

