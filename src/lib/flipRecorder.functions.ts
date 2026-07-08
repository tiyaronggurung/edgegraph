import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

// Flip Recorder — SHADOW-ONLY study of Kalshi ATM YES odds through each 15-min window.
// Reads btc_odds_tape (populated by the existing snapshotter), computes per-window
// leader/flip statistics and a global leader-wins-by-time-bucket table. No live path.

const WINDOW_SECONDS = 900; // Kalshi BTC hourly window
const CHECKPOINTS = [600, 300, 120, 60, 30, 10]; // seconds-to-close

export interface FlipWindowSnap { t: number; yes: number; no: number }
export interface FlipCheckpoint { label: string; secondsToClose: number; yes: number | null; no: number | null; leader: "YES" | "NO" | "TIE" | null }
export interface FlipWindow {
  ticker: string;
  strike: number;
  spot: number | null;
  openedAt: string;
  lastSnapAt: string;
  secondsToClose: number;    // <=0 means closed
  isOpen: boolean;
  snaps: FlipWindowSnap[];
  currentLeader: "YES" | "NO" | "TIE";
  firstLeader: "YES" | "NO" | "TIE";
  finalLeader: "YES" | "NO" | "TIE" | null; // only set once closed
  flipCount: number;
  lastFlipAgoSec: number | null; // null if never flipped
  yesLeadSec: number;
  noLeadSec: number;
  loserEverLed: boolean | null;
  maxFalseLeadSec: number | null;
  checkpoints: FlipCheckpoint[];
  stability: "stable" | "choppy" | "unknown";
}

export interface LeaderBucket { bucket: string; n: number; leaderWinsPct: number }
export interface FlipRecorderPayload {
  windows: FlipWindow[];
  historicalLeaderWins: LeaderBucket[];
  totalWindowsStudied: number;
  generatedAt: string;
}

function leaderOf(yes: number): "YES" | "NO" | "TIE" {
  if (yes > 50) return "YES";
  if (yes < 50) return "NO";
  return "TIE";
}

export const getFlipRecorderData = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { supabase } = context;

    // Last 6h of tape rows for this user.
    const cutoff = new Date(Date.now() - 6 * 3600_000).toISOString();
    const { data: rows, error } = await supabase
      .from("btc_odds_tape")
      .select("ticker, strike, spot, yes_cents, no_cents, seconds_to_close, snapped_at")
      .gte("snapped_at", cutoff)
      .order("snapped_at", { ascending: true });
    if (error) return { ok: false as const, error: error.message };

    // Bucket by ticker; within each snap timestamp, pick the ATM row (strike closest to spot).
    type Row = { ticker: string; strike: number; spot: number; yes_cents: number; no_cents: number; seconds_to_close: number; snapped_at: string };
    const byTicker = new Map<string, Row[]>();
    for (const r of (rows as Row[] | null) ?? []) {
      const arr = byTicker.get(r.ticker) ?? [];
      arr.push(r);
      byTicker.set(r.ticker, arr);
    }

    const windows: FlipWindow[] = [];
    for (const [ticker, all] of byTicker) {
      // Group by snapped_at, keep ATM.
      const bySnap = new Map<string, Row>();
      for (const r of all) {
        const prev = bySnap.get(r.snapped_at);
        if (!prev || Math.abs(r.strike - r.spot) < Math.abs(prev.strike - prev.spot)) {
          bySnap.set(r.snapped_at, r);
        }
      }
      const atm = Array.from(bySnap.values()).sort((a, b) => a.snapped_at.localeCompare(b.snapped_at));
      if (atm.length < 2) continue;

      const snaps: FlipWindowSnap[] = atm.map(r => ({
        t: WINDOW_SECONDS - r.seconds_to_close,
        yes: r.yes_cents,
        no: r.no_cents,
      }));

      // Walk snaps: flips, lead durations, false-lead max.
      let flipCount = 0;
      let lastFlipT: number | null = null;
      let yesLeadSec = 0, noLeadSec = 0;
      let prevLeader: "YES" | "NO" | "TIE" = leaderOf(snaps[0].yes);
      const firstLeader = prevLeader;
      let prevT = snaps[0].t;
      for (let i = 1; i < snaps.length; i++) {
        const cur = leaderOf(snaps[i].yes);
        const dt = Math.max(0, snaps[i].t - prevT);
        if (prevLeader === "YES") yesLeadSec += dt;
        else if (prevLeader === "NO") noLeadSec += dt;
        if (cur !== "TIE" && prevLeader !== "TIE" && cur !== prevLeader) {
          flipCount++;
          lastFlipT = snaps[i].t;
        }
        prevLeader = cur;
        prevT = snaps[i].t;
      }
      const currentLeader = prevLeader;
      const last = atm[atm.length - 1];
      const isOpen = last.seconds_to_close > 0;
      const finalLeader: FlipWindow["finalLeader"] = isOpen ? null : currentLeader;

      // Max false-lead: only definable once we know the winner (closed windows).
      let maxFalseLeadSec: number | null = null;
      let loserEverLed: boolean | null = null;
      if (!isOpen) {
        const winner = currentLeader;
        loserEverLed = false;
        let runStart: number | null = null;
        let bestRun = 0;
        let p: "YES" | "NO" | "TIE" = firstLeader;
        let pt = snaps[0].t;
        for (let i = 0; i < snaps.length; i++) {
          const cur = leaderOf(snaps[i].yes);
          const t = snaps[i].t;
          const wrong = cur !== "TIE" && cur !== winner;
          if (wrong) {
            if (runStart == null) runStart = t;
            loserEverLed = true;
          } else if (runStart != null) {
            bestRun = Math.max(bestRun, t - runStart);
            runStart = null;
          }
          p = cur; pt = t;
        }
        if (runStart != null) bestRun = Math.max(bestRun, snaps[snaps.length - 1].t - runStart);
        maxFalseLeadSec = bestRun;
        void p; void pt;
      }

      // Checkpoints — nearest snap at-or-past target seconds-to-close.
      const checkpoints: FlipCheckpoint[] = CHECKPOINTS.map(sec => {
        const targetT = WINDOW_SECONDS - sec;
        // Find latest snap with t <= targetT.
        let best: FlipWindowSnap | null = null;
        for (const s of snaps) { if (s.t <= targetT) best = s; else break; }
        return {
          label: sec >= 60 ? `T-${sec / 60}m` : `T-${sec}s`,
          secondsToClose: sec,
          yes: best?.yes ?? null,
          no: best?.no ?? null,
          leader: best ? leaderOf(best.yes) : null,
        };
      });

      const stability: FlipWindow["stability"] =
        snaps.length < 3 ? "unknown" :
        flipCount === 0 ? "stable" :
        flipCount >= 3 ? "choppy" : "stable";

      windows.push({
        ticker,
        strike: Number(last.strike),
        spot: Number(last.spot),
        openedAt: atm[0].snapped_at,
        lastSnapAt: last.snapped_at,
        secondsToClose: last.seconds_to_close,
        isOpen,
        snaps,
        currentLeader,
        firstLeader,
        finalLeader,
        flipCount,
        lastFlipAgoSec: lastFlipT == null ? null : Math.max(0, snaps[snaps.length - 1].t - lastFlipT),
        yesLeadSec,
        noLeadSec,
        loserEverLed,
        maxFalseLeadSec,
        checkpoints,
        stability,
      });
    }

    // Sort: open windows first (soonest to close), then most-recent closed.
    windows.sort((a, b) => {
      if (a.isOpen !== b.isOpen) return a.isOpen ? -1 : 1;
      if (a.isOpen) return a.secondsToClose - b.secondsToClose;
      return b.lastSnapAt.localeCompare(a.lastSnapAt);
    });

    // Historical leader-wins-by-time-bucket: pull ALL tape (6-day cap) for the user
    // and reuse the pattern we already validated in the study.
    const bigCutoff = new Date(Date.now() - 6 * 24 * 3600_000).toISOString();
    const { data: histRows, error: histErr } = await supabase
      .from("btc_odds_tape")
      .select("ticker, strike, spot, yes_cents, seconds_to_close, snapped_at")
      .gte("snapped_at", bigCutoff)
      .order("snapped_at", { ascending: true });

    const historicalLeaderWins: LeaderBucket[] = [];
    let totalWindowsStudied = 0;
    if (!histErr && histRows) {
      type HR = { ticker: string; strike: number; spot: number; yes_cents: number; seconds_to_close: number; snapped_at: string };
      const byT = new Map<string, HR[]>();
      for (const r of histRows as HR[]) {
        const a = byT.get(r.ticker) ?? []; a.push(r); byT.set(r.ticker, a);
      }
      const buckets = [
        { label: "T-15..-10m", min: 600, max: 900 },
        { label: "T-10..-5m",  min: 300, max: 600 },
        { label: "T-5..-2m",   min: 120, max: 300 },
        { label: "T-2..-1m",   min: 60,  max: 120 },
        { label: "T-1..-0m",   min: 0,   max: 60  },
      ];
      const counts = buckets.map(() => ({ n: 0, hits: 0 }));
      for (const [, arr] of byT) {
        // ATM per snap.
        const bySnap = new Map<string, HR>();
        for (const r of arr) {
          const p = bySnap.get(r.snapped_at);
          if (!p || Math.abs(r.strike - r.spot) < Math.abs(p.strike - p.spot)) bySnap.set(r.snapped_at, r);
        }
        const atm = Array.from(bySnap.values()).sort((a, b) => a.snapped_at.localeCompare(b.snapped_at));
        if (atm.length < 2) continue;
        const finalYesWin = atm[atm.length - 1].yes_cents >= 50;
        // Only count fully-closed windows.
        if (atm[atm.length - 1].seconds_to_close > 0) continue;
        totalWindowsStudied++;
        for (const r of atm) {
          if (r.yes_cents === 50) continue;
          const stc = r.seconds_to_close;
          const bIdx = buckets.findIndex(b => stc >= b.min && stc < b.max);
          if (bIdx < 0) continue;
          counts[bIdx].n++;
          if ((r.yes_cents > 50) === finalYesWin) counts[bIdx].hits++;
        }
      }
      for (let i = 0; i < buckets.length; i++) {
        historicalLeaderWins.push({
          bucket: buckets[i].label,
          n: counts[i].n,
          leaderWinsPct: counts[i].n === 0 ? 0 : Math.round((counts[i].hits / counts[i].n) * 1000) / 10,
        });
      }
    }

    return {
      ok: true as const,
      payload: {
        windows,
        historicalLeaderWins,
        totalWindowsStudied,
        generatedAt: new Date().toISOString(),
      } as FlipRecorderPayload,
    };
  });
