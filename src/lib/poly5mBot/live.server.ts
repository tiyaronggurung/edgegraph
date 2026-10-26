// 5m bot REAL-MONEY path on Polymarket US. Only runs when p5_settings.live_enabled is on.
// One entry per window (unique row claimed before sending), flat $10, $500 daily loss stop.
import { decideExit, type Book, type Side } from "./decide";
import { dailyLossHit, liveContracts, liveWindowPnl, orderSpec } from "./live";
import { hasPolymarketKeys, placeIocOrder } from "./polymarketUs.server";
import { nyDayStartUtc } from "@/lib/dailyLossGuard.server";

const r2 = (n: number) => Math.round(n * 100) / 100;

async function todayLossStop(sb: any) {
  const { data } = await sb.from("p5_live_orders").select("pnl").eq("kind", "entry").eq("settled", true)
    .gte("settled_at", nyDayStartUtc(new Date()).toISOString());
  return dailyLossHit(((data ?? []) as any[]).map((r) => Number(r.pnl ?? 0)));
}

export async function liveEntry(sb: any, p: { iso: string; slug: string; side: Side; ask: number }): Promise<string> {
  if (!hasPolymarketKeys()) return "live: keys missing";
  if (await todayLossStop(sb)) return "live: daily $500 loss stop hit";
  const qty = liveContracts(p.ask);
  if (qty < 1) return "live: price too high";
  const spec = orderSpec("buy", p.side, p.ask);
  const { data: claim, error } = await sb.from("p5_live_orders")
    .insert({ window_start: p.iso, kind: "entry", side: p.side, intent: spec.intent, limit_px: p.ask, quantity: qty })
    .select("id").maybeSingle();
  if (error || !claim) return "live: already traded this window";
  const res = await placeIocOrder({ marketSlug: p.slug, intent: spec.intent, longPx: spec.longPx, quantity: qty });
  if (!res.ok) {
    await sb.from("p5_live_orders").update({ state: "rejected", error: res.error, response: res.raw, settled: true, pnl: 0, settled_at: new Date().toISOString() }).eq("id", claim.id);
    return `live: order rejected (${res.error.slice(0, 60)})`;
  }
  const filled = res.filled;
  await sb.from("p5_live_orders").update({
    order_id: res.id, state: filled > 0 ? "filled" : "unfilled", filled_qty: filled, cost: r2(filled * p.ask), response: res.raw,
    ...(filled > 0 ? {} : { settled: true, pnl: 0, settled_at: new Date().toISOString() }),
  }).eq("id", claim.id);
  return filled > 0 ? `LIVE bought ${p.side} ${filled} @ ${Math.round(p.ask * 100)}¢` : "live: no fill at ask";
}

/** Take profit (88¢ bid) or rescue (sell held side) on a filled live entry. */
export async function liveManage(sb: any, p: { iso: string; slug: string; up: number; book: Book }): Promise<string | null> {
  const { data: e } = await sb.from("p5_live_orders").select("*").eq("window_start", p.iso).eq("kind", "entry").eq("state", "filled").eq("settled", false).maybeSingle();
  if (!e) return null;
  const { data: sold } = await sb.from("p5_live_orders").select("id").eq("window_start", p.iso).eq("kind", "exit").maybeSingle();
  if (sold) return null;
  const qty = Math.floor(Number(e.filled_qty));
  const act = decideExit({ side: e.side, contracts: qty, hedged: false }, p.up, p.book);
  if (!act) return null;
  const bid = act.kind === "tp" ? act.px : 1 - act.px;
  const spec = orderSpec("sell", e.side, bid);
  const { data: claim, error } = await sb.from("p5_live_orders")
    .insert({ window_start: p.iso, kind: "exit", side: e.side, intent: spec.intent, limit_px: bid, quantity: qty, state: act.kind })
    .select("id").maybeSingle();
  if (error || !claim) return null;
  const res = await placeIocOrder({ marketSlug: p.slug, intent: spec.intent, longPx: spec.longPx, quantity: qty });
  const filled = res.ok ? res.filled : 0;
  await sb.from("p5_live_orders").update({
    order_id: res.ok ? res.id : null, filled_qty: filled, proceeds: r2(filled * bid), response: res.raw,
    error: res.ok ? null : res.error, settled: true, settled_at: new Date().toISOString(),
  }).eq("id", claim.id);
  return filled > 0 ? `LIVE ${act.kind} sold ${filled} @ ${Math.round(bid * 100)}¢` : `live ${act.kind}: no fill`;
}

export async function liveSettle(sb: any, iso: string, result: Side) {
  const { data: e } = await sb.from("p5_live_orders").select("*").eq("window_start", iso).eq("kind", "entry").eq("settled", false).maybeSingle();
  if (!e) return;
  const { data: x } = await sb.from("p5_live_orders").select("filled_qty,proceeds").eq("window_start", iso).eq("kind", "exit").maybeSingle();
  const pnl = liveWindowPnl({ side: e.side, filled: Number(e.filled_qty), cost: Number(e.cost ?? 0), soldQty: Number(x?.filled_qty ?? 0), proceeds: Number(x?.proceeds ?? 0) }, result);
  await sb.from("p5_live_orders").update({ result, pnl, settled: true, settled_at: new Date().toISOString() }).eq("id", e.id).eq("settled", false);
}
