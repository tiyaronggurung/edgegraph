// 5m Polymarket paper bot (PAPER ONLY — never places real orders).
// Uses the same pure odds core as the 5m tab (computeStrikeOdds, T = seconds left)
// and Polymarket US's real asks. Writes only p5_* tables.
import { computeStrikeOdds, type Tick } from "@/hooks/useStrikeOdds";
import { loadBtcFlowLeanLive } from "@/lib/btcFlowLeanHistory.functions";
import { loadBtcSpotVolume } from "@/lib/btcSpotVolume.functions";
import {
  P5_LOCK_SEC, P5_WIN_SEC, contractsFor, decideEntry, decideExit, settlePnl, type Book, type Side,
} from "./decide";
import { areaUpFromPoints, situationKey } from "./situation";
import { addResult, isAllowed } from "./learn";

const WIN_MS = P5_WIN_SEC * 1000;

async function j(url: string): Promise<any> {
  try {
    const ac = new AbortController();
    const t = setTimeout(() => ac.abort(), 2500);
    try {
      const r = await fetch(url, { signal: ac.signal, headers: { accept: "application/json" } });
      return r.ok ? await r.json() : null;
    } finally { clearTimeout(t); }
  } catch { return null; }
}

const slugFor = (startMs: number) => {
  const d = new Date(startMs);
  const p2 = (n: number) => String(n).padStart(2, "0");
  return `btc-updown-5m-${d.getUTCFullYear()}-${p2(d.getUTCMonth() + 1)}-${p2(d.getUTCDate())}-${p2(d.getUTCHours())}${p2(d.getUTCMinutes())}z`;
};

type PolyEvent = { strike: number | null; book: Book; result: Side | null };

async function fetchPolyUs(startMs: number): Promise<PolyEvent | null> {
  const ev = await j(`https://gateway.polymarket.us/v1/events/slug/${slugFor(startMs)}`);
  const m = ev?.event?.markets?.[0];
  if (!m) return null;
  const ptb = Number(m?.assetPriceTerms?.priceToBeat?.value);
  const sides: any[] = Array.isArray(m?.marketSides) ? m.marketSides : [];
  const yes = sides.find((s) => s?.long === true);
  const no = sides.find((s) => s?.long === false);
  const num = (v: any) => { const n = Number(v); return Number.isFinite(n) && n > 0 && n < 1 ? n : null; };
  let result: Side | null = null;
  if (m.closed) {
    try {
      const op = JSON.parse(m.outcomePrices ?? "[]").map(Number);
      if (op[0] === 1) result = "UP"; else if (op[1] === 1) result = "DOWN";
    } catch { /* ignore */ }
  }
  return {
    strike: Number.isFinite(ptb) && ptb > 0 ? ptb : null,
    book: { upAsk: m.closed ? null : num(yes?.quote?.value), downAsk: m.closed ? null : num(no?.quote?.value) },
    result,
  };
}

async function loadTape(sb: any, sinceMs: number): Promise<Tick[]> {
  const { data } = await sb.from("btc_spot_ticks").select("observed_at, spot, source")
    .gte("observed_at", new Date(sinceMs).toISOString())
    .in("source", ["coinbase", "consolidated"]).order("observed_at", { ascending: true }).limit(2000);
  const rows = (data ?? []) as any[];
  const pref = rows.filter((r) => r.source === "coinbase");
  const pool = pref.length >= 10 ? pref : rows;
  return pool.map((r) => ({ t: Date.parse(r.observed_at), p: Number(r.spot) }))
    .filter((x) => Number.isFinite(x.t) && x.p > 0).sort((a, b) => a.t - b.t);
}

async function spotNear(sb: any, ms: number): Promise<number | null> {
  const { data } = await sb.from("btc_spot_ticks").select("spot")
    .lte("observed_at", new Date(ms).toISOString()).gte("observed_at", new Date(ms - 30_000).toISOString())
    .order("observed_at", { ascending: false }).limit(1);
  const p = Number(data?.[0]?.spot);
  return p > 0 ? p : null;
}

/** Settle closed windows: official result first, strike vs spot fallback after 2 min. */
async function settleClosed(sb: any, currentStart: number) {
  const { data: wins } = await sb.from("p5_windows").select("*").is("result", null)
    .lt("window_start", new Date(currentStart).toISOString()).order("window_start", { ascending: false }).limit(6);
  for (const w of (wins ?? []) as any[]) {
    const start = Date.parse(w.window_start);
    const ev = await fetchPolyUs(start);
    let result: Side | null = ev?.result ?? null;
    let close: number | null = null;
    if (!result && Date.now() > start + WIN_MS + 120_000 && w.strike) {
      close = await spotNear(sb, start + WIN_MS);
      if (close != null) result = close >= Number(w.strike) ? "UP" : "DOWN";
    }
    if (!result) {
      if (Date.now() > start + WIN_MS + 3_600_000) await sb.from("p5_windows").update({ result: "VOID" }).eq("window_start", w.window_start);
      continue;
    }
    await sb.from("p5_windows").update({ result, close_spot: close, updated_at: new Date().toISOString() }).eq("window_start", w.window_start);
    // Learn from the window's first qualifying signal (traded or shadow), held to settle.
    if (w.situation && w.signal_side && w.signal_ask && !w.learned) {
      const { data: cur } = await sb.from("p5_situations").select("*").eq("key", w.situation).maybeSingle();
      const base = cur ?? { n: 0, wins: 0, px_sum: 0, pnl_per_dollar_sum: 0 };
      const next = addResult(
        { n: Number(base.n), wins: Number(base.wins), px_sum: Number(base.px_sum), pnl_per_dollar_sum: Number(base.pnl_per_dollar_sum) },
        w.signal_side === result, Number(w.signal_ask),
      );
      await sb.from("p5_situations").upsert({ key: w.situation, ...next, allowed: isAllowed(next), updated_at: new Date().toISOString() });
      await sb.from("p5_windows").update({ learned: true }).eq("window_start", w.window_start);
    }
    const { data: pos } = await sb.from("p5_positions").select("*").eq("window_start", w.window_start).eq("settled", false).maybeSingle();
    if (pos) {
      const pnl = settlePnl({ side: pos.side, contracts: pos.contracts, cost: Number(pos.cost), hedgeContracts: pos.hedge_contracts, hedgeCost: pos.hedge_cost == null ? null : Number(pos.hedge_cost) }, result);
      await sb.from("p5_positions").update({ result, pnl, exit_kind: pos.exit_kind ?? (pos.hedge_contracts ? "rescue_settle" : "settle"), settled: true, closed_at: new Date().toISOString() }).eq("id", pos.id).eq("settled", false);
    }
  }
}

export async function runPoly5mBotTick() {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const sb = supabaseAdmin as any;
  const nowMs = Date.now();
  const start = Math.floor(nowMs / WIN_MS) * WIN_MS;
  const iso = new Date(start).toISOString();
  const elapsed = Math.round((nowMs - start) / 1000);
  const left = Math.max(0, P5_WIN_SEC - elapsed);

  await settleClosed(sb, start).catch(() => undefined);

  const [evR, volR, liveR, tapeR, winR, setR] = await Promise.allSettled([
    fetchPolyUs(start), loadBtcSpotVolume(), loadBtcFlowLeanLive(), loadTape(sb, nowMs - 10 * 60_000),
    sb.from("p5_windows").select("*").eq("window_start", iso).maybeSingle(),
    sb.from("p5_settings").select("*").eq("id", 1).maybeSingle(),
  ]);
  const ev = evR.status === "fulfilled" ? evR.value : null;
  if (!ev?.strike) return { ok: false, reason: "strike not ready", elapsed };
  const vol = volR.status === "fulfilled" ? volR.value : null;
  const live = liveR.status === "fulfilled" ? liveR.value : null;
  const tape = tapeR.status === "fulfilled" ? tapeR.value : [];
  const win = winR.status === "fulfilled" ? (winR.value as any)?.data : null;
  const settings = setR.status === "fulfilled" ? (setR.value as any)?.data : null;
  const points: [number, number][] = (win?.points ?? []) as [number, number][];

  let up: number | null = null;
  if (left <= P5_LOCK_SEC) {
    const locked = points.filter(([s]) => s >= P5_WIN_SEC - P5_LOCK_SEC)[0];
    if (locked) up = locked[1] / 1000;
  }
  if (up == null) {
    const odds = computeStrikeOdds(
      tape.length ? tape[tape.length - 1].p : null, ev.strike, left,
      { m1: live?.m1 ?? null, m15: live?.m15 ?? null, avgBuyPrice: null, avgSellPrice: null, flowImbalance: vol?.m3?.imbalance ?? null, stack: live?.stack ?? null },
      tape,
    );
    up = odds.upAsk;
  }
  if (up == null || !Number.isFinite(up)) return { ok: false, reason: "odds unavailable", elapsed };

  if (!points.some(([s]) => s === elapsed)) points.push([elapsed, Math.round(up * 1000)]);
  points.sort((a, b) => a[0] - b[0]);

  const row: Record<string, unknown> = { window_start: iso, strike: win?.strike ?? ev.strike, points, updated_at: new Date().toISOString() };
  let status = "watching";

  // Record the first qualifying signal (shadow), then trade it if allowed and running.
  const sig = win?.signal_side ? null : decideEntry(up, ev.book, elapsed);
  if (sig) {
    const recent = tape.filter((t) => t.t >= nowMs - 120_000);
    const ps = recent.map((t) => t.p);
    const rangePct = ps.length > 5 ? ((Math.max(...ps) - Math.min(...ps)) / ps[ps.length - 1]) * 100 : null;
    const key = situationKey({ side: sig.side, odds: sig.odds, edge: sig.edge, elapsedSec: elapsed, flowImbalance: vol?.m3?.imbalance ?? null, areaUp: areaUpFromPoints(points), rangePct });
    Object.assign(row, { signal_side: sig.side, signal_odds: sig.odds, signal_ask: sig.ask, signal_sec: elapsed, situation: key });
    const { data: st } = await sb.from("p5_situations").select("*").eq("key", key).maybeSingle();
    const allowed = isAllowed(st ? { n: st.n, wins: st.wins, px_sum: Number(st.px_sum), pnl_per_dollar_sum: Number(st.pnl_per_dollar_sum) } : null);
    if (settings?.running && allowed) {
      const ct = contractsFor(Number(settings.stake ?? 10), sig.ask);
      if (ct >= 1) {
        const { error } = await sb.from("p5_positions").insert({ window_start: iso, side: sig.side, contracts: ct, entry_px: sig.ask, cost: Math.round(ct * sig.ask * 100) / 100, situation: key });
        if (!error) { row.traded = true; status = `bought ${sig.side} ${ct} @ ${Math.round(sig.ask * 100)}¢`; }
      }
    } else status = allowed ? `signal ${sig.side} (bot off — shadow only)` : `signal ${sig.side} blocked by learning (${key})`;
  }
  await sb.from("p5_windows").upsert(row, { onConflict: "window_start" });

  // Manage the open position.
  const { data: pos } = await sb.from("p5_positions").select("*").eq("window_start", iso).eq("settled", false).is("exit_kind", null).maybeSingle();
  if (pos) {
    const act = decideExit({ side: pos.side, contracts: pos.contracts, hedged: pos.hedge_contracts != null }, up, ev.book);
    if (act?.kind === "tp") {
      const proceeds = Math.round(pos.contracts * act.px * 100) / 100;
      await sb.from("p5_positions").update({ exit_kind: "tp", exit_px: act.px, proceeds, pnl: Math.round((proceeds - Number(pos.cost)) * 100) / 100, settled: true, closed_at: new Date().toISOString() }).eq("id", pos.id).eq("settled", false);
      status = `took profit @ ${Math.round(act.px * 100)}¢`;
    } else if (act?.kind === "rescue") {
      await sb.from("p5_positions").update({ hedge_contracts: act.contracts, hedge_px: act.px, hedge_cost: Math.round(act.contracts * act.px * 100) / 100 }).eq("id", pos.id).is("hedge_contracts", null);
      status = `rescue hedge ${act.contracts} @ ${Math.round(act.px * 100)}¢`;
    } else status = `holding ${pos.side} @ ${Math.round(Number(pos.entry_px) * 100)}¢${pos.hedge_contracts ? " (hedged)" : ""}`;
  }

  await sb.from("p5_settings").update({ last_status: { at: new Date().toISOString(), up, elapsed, status, book: ev.book, strike: ev.strike } }).eq("id", 1);
  return { ok: true, elapsed, up, status };
}
