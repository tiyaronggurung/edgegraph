// Server-side recorder for the Kalshi-style live odds chart (live_odds_windows).
//
// Uses the SAME pure odds core as the browser chart (computeStrikeOdds from
// useStrikeOdds.ts) — no math, weight or rule is changed here. It only saves
// the result so every window gets its strike + odds line + result even when
// no page is open. Writes nothing but live_odds_windows; places no bet.
import { computeStrikeOdds, type Tick } from "@/hooks/useStrikeOdds";
import { loadBtcFlowLeanLive } from "@/lib/btcFlowLeanHistory.functions";
import { loadBtcSpotVolume } from "@/lib/btcSpotVolume.functions";
import { loadKalshiCurrentStrike } from "@/lib/kalshiCurrentStrike.functions";
import { fetchKalshiSettlement } from "@/lib/kalshiSettle";
import { tickerForWindowClose } from "@/lib/marketIntel/windowMapping";

const WIN_MS = 900_000;
const TAPE_MS = 10 * 60_000;
const LOCK_SECONDS = 15; // same final-15s freeze as the browser hook

async function loadTape(sb: any, sinceMs: number): Promise<Tick[]> {
  const { data } = await sb
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
    if (Number.isFinite(t) && Number.isFinite(p) && p > 0) tape.push({ t, p });
  }
  return tape.sort((a, b) => a.t - b.t);
}

/** Fill the official result on the window that just closed, if still missing. */
async function settlePrevious(sb: any, windowStart: number) {
  const prevStart = windowStart - WIN_MS;
  const iso = new Date(prevStart).toISOString();
  const { data } = await sb.from("live_odds_windows").select("result,strike").eq("window_start", iso).maybeSingle();
  if (!data || data.result) return;
  const ticker = tickerForWindowClose(windowStart);
  const ks = ticker ? await fetchKalshiSettlement(ticker) : null;
  if (ks?.finalized && ks.result) {
    await sb.from("live_odds_windows")
      .update({ result: ks.result === "yes" ? "UP" : "DOWN", close_spot: ks.expirationValue, updated_at: new Date().toISOString() })
      .eq("window_start", iso);
  }
}

export async function recordLiveOddsFromServer() {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const sb = supabaseAdmin as any;
  const nowMs = Date.now();
  const windowStart = Math.floor(nowMs / WIN_MS) * WIN_MS;
  const secondsToClose = Math.max(0, Math.round((windowStart + WIN_MS - nowMs) / 1000));
  const sec = Math.round((nowMs - windowStart) / 1000);
  const iso = new Date(windowStart).toISOString();

  await settlePrevious(sb, windowStart).catch(() => undefined);

  const [strikeRes, volRes, liveRes, tapeRes, existingRes] = await Promise.allSettled([
    loadKalshiCurrentStrike(),
    loadBtcSpotVolume(),
    loadBtcFlowLeanLive(),
    loadTape(sb, nowMs - TAPE_MS),
    sb.from("live_odds_windows").select("points,strike").eq("window_start", iso).maybeSingle(),
  ]);
  const ks = strikeRes.status === "fulfilled" ? strikeRes.value : null;
  // Only plot once THIS window's strike is in (never carry the previous one).
  const expectedTicker = tickerForWindowClose(windowStart + WIN_MS);
  if (!ks?.strike || (expectedTicker && ks.ticker !== expectedTicker)) {
    return { written: false, reason: "strike not ready", windowStart, sec };
  }
  const strike = ks.strike;
  const vol = volRes.status === "fulfilled" ? volRes.value : null;
  const live = liveRes.status === "fulfilled" ? liveRes.value : null;
  const tape = tapeRes.status === "fulfilled" ? tapeRes.value : [];
  const existing = existingRes.status === "fulfilled" ? (existingRes.value as any)?.data : null;
  const points = new Map<number, number>();
  for (const [s, u] of (existing?.points ?? []) as [number, number][]) points.set(s, u);

  let up: number | null = null;
  // Final-15s freeze: reuse the first value recorded inside the last 15s.
  if (secondsToClose <= LOCK_SECONDS) {
    const locked = [...points.entries()].filter(([s]) => s >= 900 - LOCK_SECONDS).sort((a, b) => a[0] - b[0])[0];
    if (locked) up = locked[1] / 1000;
  }
  if (up == null) {
    const fresh = vol?.windowStart === windowStart ? (vol?.window ?? null) : null;
    const odds = computeStrikeOdds(
      tape.length ? tape[tape.length - 1].p : null,
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
      tape,
    );
    up = odds.upAsk;
  }
  if (up == null || !Number.isFinite(up)) return { written: false, reason: "odds unavailable", windowStart, sec };

  // Never overwrite a point the open page already recorded for this second.
  if (!points.has(sec)) points.set(sec, Math.round(up * 1000));
  const { error } = await sb.from("live_odds_windows").upsert(
    {
      window_start: iso,
      strike: existing?.strike ?? strike,
      points: [...points.entries()].sort((a, b) => a[0] - b[0]),
      updated_at: new Date().toISOString(),
    },
    { onConflict: "window_start" },
  );
  return { written: !error, reason: error?.message ?? "ok", windowStart, sec, up, strike };
}
