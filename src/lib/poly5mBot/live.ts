// 5m bot REAL-MONEY helpers (pure). Polymarket US quotes every order price as the
// UP (long/YES) price, so a DOWN order at side price p is sent as 1 - p.
import type { Side } from "./decide";

export const LIVE_STAKE_USD = 10; // flat $10 per real trade
export const LIVE_DAILY_LOSS_LIMIT_USD = 500; // matches the shared daily loss stop

export type LiveAction = "buy" | "sell";
export type OrderSpec = { intent: string; longPx: number };

export function orderSpec(action: LiveAction, side: Side, sidePx: number): OrderSpec {
  const intent =
    action === "buy"
      ? side === "UP" ? "ORDER_INTENT_BUY_LONG" : "ORDER_INTENT_BUY_SHORT"
      : side === "UP" ? "ORDER_INTENT_SELL_LONG" : "ORDER_INTENT_SELL_SHORT";
  const longPx = side === "UP" ? sidePx : 1 - sidePx;
  return { intent, longPx: Math.round(longPx * 1000) / 1000 };
}

/** Whole contracts for the flat live stake at the side's ask. */
export const liveContracts = (ask: number) =>
  ask > 0 && ask < 1 ? Math.floor(LIVE_STAKE_USD / ask) : 0;

/** Real P&L for one window: payout on contracts still held at settle + sale proceeds − cost. */
export function liveWindowPnl(p: { side: Side; filled: number; cost: number; soldQty: number; proceeds: number }, result: Side | null) {
  const held = Math.max(0, p.filled - p.soldQty);
  const payout = result === p.side ? held : 0;
  return Math.round((payout + p.proceeds - p.cost) * 100) / 100;
}

export const dailyLossHit = (todayPnls: number[]) =>
  todayPnls.filter((x) => x < 0).reduce((a, x) => a - x, 0) >= LIVE_DAILY_LOSS_LIMIT_USD;
