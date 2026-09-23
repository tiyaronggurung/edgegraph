// Server-side 4/4 agreement recorder.
//
// Does exactly what the /crypto agreement panel does — our odds on the strike,
// window volume in vs out, model pick, study lock — but with no browser, so the
// signal keeps being recorded (and therefore keeps being bettable) when the
// page is closed.
//
// Write-only with respect to every engine: it touches nothing but
// btc_agreement_log, and places no bet. The bet engine reads that log exactly
// as before.
import { computeStrikeOdds, type Tick } from "@/hooks/useStrikeOdds";
import { loadBtcFlowLeanLive } from "@/lib/btcFlowLeanHistory.functions";
import { loadBtcSpotVolume } from "@/lib/btcSpotVolume.functions";
import { loadKalshiCurrentStrike } from "@/lib/kalshiCurrentStrike.functions";

type Side = "UP" | "DOWN" | null;

const WINDOW_MS = 900_000;
const BUCKET_SEC = 10;
const TAPE_MIN = 10 * 60_000; // 10 minutes of price history (break-range window)
const VOL_DEAD_ZONE = 0.05;   // same dead zone the panel uses

export interface AgreementWriteResult {
  written: boolean;
  reason: string;
  windowStart: number;
  bucketSec: number;
  secondsToClose: number;
  agreeCount: number;
  agreedSide: Side;
  allFour: boolean;
  heldSeconds: number;
  spot: number | null;
  strike: number | null;
}

/** Rolling price tape from the server-written spot ticks (20s job, 4 samples). */
async function loadTape(
  supabaseAdmin: { from: (t: string) => any },
  sinceMs: number,
): Promise<{ tape: Tick[]; spot: number | null }> {
  const { data } = await supabaseAdmin
    .from("btc_spot_ticks")
    .select("observed_at, spot, source")
    .gte("observed_at", new Date(sinceMs).toISOString())
    .in("source", ["coinbase", "consolidated"])
    .order("observed_at", { ascending: true })
    .limit(2000);

  const rows = (data ?? []) as Array<{ observed_at: string; spot: number | string; source: string }>;
  const preferred = rows.filter((r) => r.source === "coinbase");
  const pool = preferred.length >= 10 ? preferred : rows;

  const tape: Tick[] = [];
  for (const r of pool) {
    const t = Date.parse(r.observed_at);
    const p = Number(r.spot);
    if (!Number.isFinite(t) || !Number.isFinite(p) || p <= 0) continue;
    tape.push({ t, p });
  }
  tape.sort((a, b) => a.t - b.t);
  const last = tape[tape.length - 1];
  return { tape, spot: last ? last.p : null };
}

/**
 * How long the current all-four agreement has held, confirmed from the log by
 * walking back contiguous 10s buckets (survives restarts; same method the bet
 * engine uses).
 */
function heldFromLog(
  rows: Array<{ bucket_sec: number; all_four: boolean | null; agreed_side: string | null }>,
  bucketSec: number,
  side: Side,
  allFour: boolean,
): number {
  if (!allFour || side == null) return 0;
  const by = new Map<number, { all_four: boolean | null; agreed_side: string | null }>();
  for (const r of rows) by.set(Number(r.bucket_sec), r);
  let held = 0;
  let b = bucketSec - BUCKET_SEC;
  while (true) {
    const prev = by.get(b);
    if (!prev || prev.all_four !== true || prev.agreed_side !== side) break;
    held += BUCKET_SEC;
    b -= BUCKET_SEC;
  }
  return held + BUCKET_SEC; // include the sample being written now
}

export async function recordAgreementFromServer(): Promise<AgreementWriteResult> {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

  const nowMs = Date.now();
  const windowStart = Math.floor(nowMs / WINDOW_MS) * WINDOW_MS;
  const secondsToClose = Math.max(0, Math.round((windowStart + WINDOW_MS - nowMs) / 1000));
  const bucketSec = Math.floor(nowMs / 1000 / BUCKET_SEC) * BUCKET_SEC;

  const base: AgreementWriteResult = {
    written: false,
    reason: "",
    windowStart,
    bucketSec,
    secondsToClose,
    agreeCount: 0,
    agreedSide: null,
    allFour: false,
    heldSeconds: 0,
    spot: null,
    strike: null,
  };

  const { getBtcConsensus } = await import("@/lib/btcConsensus.server");

  const [strikeRes, volRes, liveRes, consRes, tapeRes] = await Promise.allSettled([
    loadKalshiCurrentStrike(),
    loadBtcSpotVolume(),
    loadBtcFlowLeanLive(),
    getBtcConsensus(),
    loadTape(supabaseAdmin as never, nowMs - TAPE_MIN),
  ]);

  const strikeSnap = strikeRes.status === "fulfilled" ? strikeRes.value : null;
  const vol = volRes.status === "fulfilled" ? volRes.value : null;
  const live = liveRes.status === "fulfilled" ? liveRes.value : null;
  const cons = consRes.status === "fulfilled" ? consRes.value : null;
  const tapeOut = tapeRes.status === "fulfilled" ? tapeRes.value : { tape: [] as Tick[], spot: null };

  const strike = strikeSnap?.strike ?? cons?.strike ?? null;
  const spot = tapeOut.spot ?? cons?.spot ?? null;

  // 1. Our odds on the strike — identical math to the page.
  const fresh = vol?.windowStart === windowStart ? (vol?.window ?? null) : null;
  const odds = computeStrikeOdds(
    spot,
    strike,
    secondsToClose,
    {
      m1: live?.m1 ?? null,
      m15: live?.m15 ?? null,
      avgBuyPrice: fresh?.avgBuyPrice ?? null,
      avgSellPrice: fresh?.avgSellPrice ?? null,
      flowImbalance: vol?.m3?.imbalance ?? null,
      stack: live?.stack ?? null,
    },
    tapeOut.tape,
  );
  const oddsSide: Side = odds.pUp == null ? null : odds.pUp >= 0.5 ? "UP" : "DOWN";

  // 2. Volume in vs out for this window (dead zone ±5%).
  const buy = fresh?.buy ?? null;
  const sell = fresh?.sell ?? null;
  const imbWin = buy != null && sell != null && buy + sell > 0 ? (buy - sell) / (buy + sell) : null;
  const volSide: Side =
    imbWin == null ? null : imbWin > VOL_DEAD_ZONE ? "UP" : imbWin < -VOL_DEAD_ZONE ? "DOWN" : null;

  // 3 & 4. Model pick + study lock.
  const sideOf = (s: "YES" | "NO" | null | undefined): Side =>
    s === "YES" ? "UP" : s === "NO" ? "DOWN" : null;
  const modelSide = sideOf(cons?.model?.side ?? null);
  const studySide = sideOf(cons?.study?.side ?? cons?.study?.fallbackSide ?? null);
  const modelConfidence = cons?.model?.confidence ?? null;
  const studyConfidence = cons?.study?.confidence ?? cons?.study?.fallbackConfidence ?? null;

  const dirs: Side[] = [oddsSide, volSide, modelSide, studySide];
  const known = dirs.filter((d): d is "UP" | "DOWN" => d != null);
  const ups = known.filter((d) => d === "UP").length;
  const downs = known.length - ups;
  const allFour = known.length === 4 && (ups === 4 || downs === 4);
  const agreedSide: Side = ups > downs ? "UP" : downs > ups ? "DOWN" : null;

  base.agreeCount = known.length;
  base.agreedSide = agreedSide;
  base.allFour = allFour;
  base.spot = spot;
  base.strike = strike;

  if (known.length < 2) {
    base.reason = "not enough legs";
    return base;
  }

  const { data: logRows } = await supabaseAdmin
    .from("btc_agreement_log")
    .select("bucket_sec, all_four, agreed_side")
    .eq("window_start", new Date(windowStart).toISOString())
    .order("bucket_sec", { ascending: false })
    .limit(120);

  const heldSeconds = heldFromLog(
    (logRows ?? []) as Array<{ bucket_sec: number; all_four: boolean | null; agreed_side: string | null }>,
    bucketSec,
    agreedSide,
    allFour,
  );
  base.heldSeconds = heldSeconds;

  const { error } = await supabaseAdmin.from("btc_agreement_log").upsert(
    {
      window_start: new Date(windowStart).toISOString(),
      bucket_sec: bucketSec,
      seconds_to_close: secondsToClose,
      spot,
      strike,
      odds_side: oddsSide,
      odds_p_up: odds.pUp,
      vol_side: volSide,
      vol_imbalance: imbWin,
      model_side: modelSide,
      model_confidence: modelConfidence,
      study_side: studySide,
      study_confidence: studyConfidence,
      agree_count: known.length,
      agreed_side: agreedSide,
      all_four: allFour,
      held_seconds: heldSeconds,
    } as never,
    { onConflict: "window_start,bucket_sec" },
  );

  base.written = !error;
  base.reason = error ? error.message : "ok";
  return base;
}
