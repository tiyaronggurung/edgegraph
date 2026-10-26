// 5m Polymarket paper bot — pure rules (PAPER ONLY). No network or database here.
export const P5_WIN_SEC = 300;
export const P5_ENTRY_MIN_SEC = 45; // skip first 45s
export const P5_ENTRY_MAX_SEC = 210; // no entries after 3:30
export const P5_ENTRY_ODDS = 0.65; // our odds on a side
export const P5_MIN_EDGE = 0.05; // our odds minus Polymarket ask
export const P5_TP_BID = 0.88; // take profit when side bid reaches this
export const P5_RESCUE_ODDS = 0.38; // our odds for the held side fall to this
export const P5_RESCUE_MAX_ASK = 0.5; // only if opposite side still this cheap
export const P5_LOCK_SEC = 15; // final-15s odds freeze

export type Side = "UP" | "DOWN";
export type Book = { upAsk: number | null; downAsk: number | null };

const ok = (p: number | null): p is number => p != null && Number.isFinite(p) && p > 0 && p < 1;
export const bidOf = (b: Book, side: Side) => {
  const opp = side === "UP" ? b.downAsk : b.upAsk;
  return ok(opp) ? Math.round((1 - opp) * 10000) / 10000 : null;
};
export const askOf = (b: Book, side: Side) => (side === "UP" ? b.upAsk : b.downAsk);

export type EntrySignal = { side: Side; odds: number; ask: number; edge: number };

/** Strongest qualifying side, or null. `up` = our UP probability. */
export function decideEntry(up: number | null, book: Book, elapsedSec: number): EntrySignal | null {
  if (up == null || !Number.isFinite(up)) return null;
  if (elapsedSec < P5_ENTRY_MIN_SEC || elapsedSec > P5_ENTRY_MAX_SEC) return null;
  const side: Side = up >= 0.5 ? "UP" : "DOWN";
  const odds = side === "UP" ? up : 1 - up;
  const ask = askOf(book, side);
  if (odds < P5_ENTRY_ODDS || !ok(ask)) return null;
  const edge = odds - ask;
  if (edge < P5_MIN_EDGE) return null;
  return { side, odds, ask, edge };
}

export const contractsFor = (stake: number, ask: number) =>
  !(stake > 0) || !ok(ask) ? 0 : Math.floor(stake / ask);

export type HeldPos = { side: Side; contracts: number; hedged: boolean };
export type ExitAction =
  | { kind: "tp"; px: number }
  | { kind: "rescue"; px: number; contracts: number }
  | null;

export function decideExit(pos: HeldPos, up: number | null, book: Book): ExitAction {
  if (pos.contracts < 1) return null;
  const bid = bidOf(book, pos.side);
  if (!pos.hedged && bid != null && bid >= P5_TP_BID) return { kind: "tp", px: bid };
  if (pos.hedged || up == null) return null;
  const held = pos.side === "UP" ? up : 1 - up;
  const opp: Side = pos.side === "UP" ? "DOWN" : "UP";
  const oppAsk = askOf(book, opp);
  if (held <= P5_RESCUE_ODDS && ok(oppAsk) && oppAsk <= P5_RESCUE_MAX_ASK)
    return { kind: "rescue", px: oppAsk, contracts: pos.contracts };
  return null;
}

/** Final P&L at settlement: winning contracts minus every recorded cost. */
export function settlePnl(p: { side: Side; contracts: number; cost: number; hedgeContracts?: number | null; hedgeCost?: number | null }, result: Side) {
  const opp = p.side === "UP" ? "DOWN" : "UP";
  const payout = (result === p.side ? p.contracts : 0) + (result === opp ? p.hedgeContracts ?? 0 : 0);
  return Math.round((payout - p.cost - (p.hedgeCost ?? 0)) * 100) / 100;
}
