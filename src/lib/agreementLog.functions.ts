// Records every agreement moment (odds · volume · model · study) with the
// time left in the window and how long the current agreement has held.
//
// Write-only with respect to every existing engine: it touches nothing but
// btc_agreement_log. Nothing here places a bet.
import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

export type Side = "UP" | "DOWN" | null;

export interface AgreementSnapshotInput {
  windowStart: number;
  bucketSec: number;
  secondsToClose: number | null;
  spot: number | null;
  strike: number | null;
  oddsSide: Side;
  oddsPUp: number | null;
  volSide: Side;
  volImbalance: number | null;
  modelSide: Side;
  modelConfidence: number | null;
  studySide: Side;
  studyConfidence: number | null;
  agreeCount: number;
  agreedSide: Side;
  allFour: boolean;
  heldSeconds: number | null;
}

/** Store one agreement sample. Deduped per (window, 10s bucket) by the table. */
export const recordAgreementSnapshot = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: AgreementSnapshotInput) => input)
  .handler(async ({ data }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { error } = await supabaseAdmin
      .from("btc_agreement_log")
      .upsert(
        {
          window_start: new Date(data.windowStart).toISOString(),
          bucket_sec: data.bucketSec,
          seconds_to_close: data.secondsToClose,
          spot: data.spot,
          strike: data.strike,
          odds_side: data.oddsSide,
          odds_p_up: data.oddsPUp,
          vol_side: data.volSide,
          vol_imbalance: data.volImbalance,
          model_side: data.modelSide,
          model_confidence: data.modelConfidence,
          study_side: data.studySide,
          study_confidence: data.studyConfidence,
          agree_count: data.agreeCount,
          agreed_side: data.agreedSide,
          all_four: data.allFour,
          held_seconds: data.heldSeconds,
        } as never,
        { onConflict: "window_start,bucket_sec" },
      );
    return { ok: !error };
  });

export interface AgreementFire {
  windowStart: string;
  secondsToClose: number | null;
  agreedSide: Side;
  heldSeconds: number | null;
  spot: number | null;
  strike: number | null;
  createdAt: string;
}

/** Most recent full 4/4 moments, newest first. Read-only. */
export const getRecentAgreementFires = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { data, error } = await context.supabase
      .from("btc_agreement_log")
      .select("window_start,seconds_to_close,agreed_side,held_seconds,spot,strike,created_at")
      .eq("all_four", true)
      .order("created_at", { ascending: false })
      .limit(40);
    if (error) return { ok: false, fires: [] as AgreementFire[] };
    const rows = (data ?? []) as Array<Record<string, unknown>>;
    const fires: AgreementFire[] = rows.map((r) => ({
      windowStart: String(r.window_start),
      secondsToClose: r.seconds_to_close == null ? null : Number(r.seconds_to_close),
      agreedSide: (r.agreed_side as Side) ?? null,
      heldSeconds: r.held_seconds == null ? null : Number(r.held_seconds),
      spot: r.spot == null ? null : Number(r.spot),
      strike: r.strike == null ? null : Number(r.strike),
      createdAt: String(r.created_at),
    }));
    return { ok: true, fires };
  });
