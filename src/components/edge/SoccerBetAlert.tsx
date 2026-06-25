import { useEffect, useRef } from "react";
import { useServerFn } from "@tanstack/react-start";
import { supabase } from "@/integrations/supabase/client";
import { sendTransactionalEmail } from "@/lib/email/send";
import { incrementAlert, LIMIT_REACHED } from "@/lib/usage.functions";
import { evaluateAlert } from "@/lib/alert-prefs.functions";

const emailedKeys = new Set<string>();

interface Props {
  marketTicker: string;
  marketTitle: string;
  pickLabel: string;
  fairPct: number; // 0..100
  marketPct: number; // 0..100 (implied raw probability for pick)
  edgePts: number;
}

/**
 * Fires the ai-bet-alert email for a HIGH-confidence soccer 3-way pick.
 * Mirrors VerdictCard's email logic (alert prefs + per-day dedupe + quota).
 */
export function SoccerBetAlert({
  marketTicker,
  marketTitle,
  pickLabel,
  fairPct,
  marketPct,
  edgePts,
}: Props) {
  const bumpAlert = useServerFn(incrementAlert);
  const evalAlert = useServerFn(evaluateAlert);
  const firedRef = useRef(false);

  useEffect(() => {
    if (firedRef.current) return;
    let cancelled = false;

    (async () => {
      const { data: { user } } = await supabase.auth.getUser();
      const email = user?.email;
      const userId = user?.id;
      if (!email || !userId || cancelled) return;

      const day = new Date().toISOString().slice(0, 10);
      const key = `${userId}|${marketTicker}|${pickLabel}|${day}`;
      if (emailedKeys.has(key)) {
        firedRef.current = true;
        return;
      }
      emailedKeys.add(key);
      firedRef.current = true;

      try {
        let decision: { action: "send_instant" | "queue_digest" | "skip" };
        try {
          decision = (await evalAlert({
            data: {
              confidence: Number(fairPct.toFixed(2)),
              sport: "soccer",
              marketTicker,
              marketTitle,
              side: "YES",
              sideLabel: pickLabel,
              fairProb: Number(fairPct.toFixed(2)),
              marketProb: Number(marketPct.toFixed(2)),
              edgePts: Number(edgePts.toFixed(2)),
              pattern: "Soccer 3-way de-vig",
              kellyHalf: null,
            },
          })) as any;
        } catch {
          decision = { action: "send_instant" };
        }

        if (decision.action !== "send_instant") return;

        try {
          await bumpAlert({ data: { idempotencyKey: key } });
        } catch (e) {
          if ((e as Error).message === LIMIT_REACHED) return;
          emailedKeys.delete(key);
          firedRef.current = false;
          return;
        }

        await sendTransactionalEmail({
          templateName: "ai-bet-alert",
          recipientEmail: email,
          idempotencyKey: `bet-alert-${key}`,
          templateData: {
            marketTitle,
            sideLabel: pickLabel,
            fairProb: Number(fairPct.toFixed(2)),
            marketProb: Number(marketPct.toFixed(2)),
            edgePts: Number(edgePts.toFixed(2)),
            pattern: "Soccer 3-way de-vig",
            kellyHalf: null,
          },
        });
      } catch (err) {
        emailedKeys.delete(key);
        firedRef.current = false;
        console.warn("[soccer bet-alert] failed", err);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [marketTicker, marketTitle, pickLabel, fairPct, marketPct, edgePts, bumpAlert, evalAlert]);

  return null;
}
