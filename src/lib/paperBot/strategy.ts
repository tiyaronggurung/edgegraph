// Pure strategy + helpers, a line-by-line port of the Python bot (kalshi_bot/strategy.py,
// client.py parse_orderbook, paper.py kalshi_taker_fee). No network or database access here.
//
// Rules modelled on the Polymarket wallet's full history (Apr–Oct 2026, 3.55M fills):
//   1. Open near 50c on the cheaper side, 2–10% into the window.
//   2. From ~10% in, keep the smaller leg at ~2/3 of the bigger one (hedge).
//   3. Otherwise add to the rising side (momentum), mostly at 50–95c.
//   4. Last 20% of the window: top up the leader at 85–99c.
//   5. Pace spending along his curve; never sell; no stop loss by default.

export interface Book {
  yes_bid: number | null;
  yes_ask: number | null;
  yes_ask_size: number;
  no_bid: number | null;
  no_ask: number | null;
  no_ask_size: number;
}

export interface Leg {
  contracts: number;
  cost: number; // dollars paid, excluding fees
}

export interface Position {
  yes: Leg;
  no: Leg;
  last_buy_ts: number; // unix seconds
}

export interface Decision {
  side: "yes" | "no";
  contracts: number;
  price: number;
  reason: string;
}

export interface StrategyConfig {
  clip_contracts: number;
  max_spend_per_market: number;
  max_contracts_per_side: number;
  min_seconds_between_buys: number;
  start_after_frac: number;
  no_new_buys_last_seconds: number;
  pace: number[];
  opening_min_price: number;
  opening_max_price: number;
  second_leg_after_frac: number;
  balance_target: number;
  hedge_max_price: number;
  momentum_min_price: number;
  momentum_max_price: number;
  late_window_frac: number;
  leader_min_price: number;
  leader_max_price: number;
  max_pair_cost: number;
  stop_adding_loss_frac: number;
}

// Share of a market's total spend he had made by the end of each tenth of the window.
export const WALLET_PACE = [0.124, 0.221, 0.312, 0.398, 0.489, 0.579, 0.674, 0.782, 0.904, 1.0];

export const DEFAULT_CONFIG: StrategyConfig = {
  clip_contracts: 20,
  max_spend_per_market: 300,
  max_contracts_per_side: 2000,
  min_seconds_between_buys: 4,
  start_after_frac: 0.02,
  no_new_buys_last_seconds: 5,
  pace: WALLET_PACE,
  opening_min_price: 0.35,
  opening_max_price: 0.65,
  second_leg_after_frac: 0.10,
  balance_target: 0.66,
  hedge_max_price: 0.90,
  momentum_min_price: 0.50,
  momentum_max_price: 0.95,
  late_window_frac: 0.80,
  leader_min_price: 0.85,
  leader_max_price: 0.99,
  max_pair_cost: 1.25,
  stop_adding_loss_frac: 0,
};

export const avg = (l: Leg): number | null => (l.contracts ? l.cost / l.contracts : null);
export const spend = (p: Position): number => p.yes.cost + p.no.cost;
export const withBuy = (l: Leg, n: number, price: number): Leg => ({
  contracts: l.contracts + n,
  cost: l.cost + n * price,
});

export function pairCost(p: Position): number | null {
  const y = avg(p.yes), n = avg(p.no);
  return y === null || n === null ? null : y + n;
}

export function markedValue(p: Position, b: Book): number | null {
  if (b.yes_bid === null || b.no_bid === null) return null;
  return p.yes.contracts * b.yes_bid + p.no.contracts * b.no_bid;
}

// Python's float floor division (a // b), reproduced exactly so sizing matches the Python bot.
export function pyFloorDiv(a: number, b: number): number {
  let mod = a % b; // same as C fmod
  let div = (a - mod) / b;
  if (mod) {
    if ((b < 0) !== (mod < 0)) {
      mod += b;
      div -= 1.0;
    }
  }
  if (div) {
    let floordiv = Math.floor(div);
    if (div - floordiv > 0.5) floordiv += 1.0;
    return floordiv;
  }
  return 0;
}

const trunc = (x: number) => Math.trunc(x); // Python int() on floats

export function paceLimit(cfg: StrategyConfig, frac: number): number {
  frac = Math.min(Math.max(frac, 0), 1);
  const i = Math.min(trunc(frac * 10), 9);
  const lo = i > 0 ? cfg.pace[i - 1] : 0;
  const hi = cfg.pace[i];
  const share = lo + (hi - lo) * (frac * 10 - i);
  return share * cfg.max_spend_per_market;
}

const f3 = (x: number) => x.toFixed(3);

export function decide(
  cfg: StrategyConfig,
  pos: Position,
  book: Book,
  now: number,
  openTs: number,
  closeTs: number,
): Decision | null {
  const window = closeTs - openTs;
  if (window <= 0 || now >= closeTs - cfg.no_new_buys_last_seconds) return null;
  const frac = (now - openTs) / window;
  if (frac < cfg.start_after_frac) return null;
  if (now - pos.last_buy_ts < cfg.min_seconds_between_buys) return null;

  const spent = spend(pos);
  if (cfg.stop_adding_loss_frac > 0 && spent > 0) {
    const mv = markedValue(pos, book);
    if (mv !== null && (spent - mv) / spent > cfg.stop_adding_loss_frac) return null;
  }

  const allowance = paceLimit(cfg, frac) - spent;
  const budgetLeft = cfg.max_spend_per_market - spent;
  const legs = {
    yes: { ask: book.yes_ask, size: book.yes_ask_size, mine: pos.yes, other: pos.no },
    no: { ask: book.no_ask, size: book.no_ask_size, mine: pos.no, other: pos.yes },
  };

  const make = (side: "yes" | "no", clip: number, reason: string): Decision | null => {
    const { ask, size, mine, other } = legs[side];
    if (ask === null || ask <= 0 || ask >= 1) return null;
    const n = Math.min(
      clip,
      trunc(size),
      cfg.max_contracts_per_side - trunc(mine.contracts),
      trunc(pyFloorDiv(budgetLeft, ask)),
    );
    if (n <= 0) return null;
    if (cfg.max_pair_cost > 0 && other.contracts > 0) {
      const nw = withBuy(mine, n, ask);
      if ((avg(nw) as number) + (avg(other) as number) > cfg.max_pair_cost) return null;
    }
    return { side, contracts: n, price: ask, reason };
  };

  if (allowance <= -cfg.clip_contracts * 0.5) return null; // well ahead of pace

  const ya = book.yes_ask, na = book.no_ask;
  if (ya === null || na === null) return null;
  const leader: "yes" | "no" = ya >= na ? "yes" : "no";
  const trailer: "yes" | "no" = leader === "yes" ? "no" : "yes";

  // 1. opening leg
  if (pos.yes.contracts === 0 && pos.no.contracts === 0) {
    const ask = legs[trailer].ask as number;
    if (cfg.opening_min_price <= ask && ask <= cfg.opening_max_price) {
      return make(trailer, cfg.clip_contracts, `open @ ${f3(ask)}`);
    }
    return null;
  }

  // 2. late window: top up the leader
  if (frac >= cfg.late_window_frac) {
    const ask = legs[leader].ask as number;
    if (cfg.leader_min_price <= ask && ask <= cfg.leader_max_price) {
      const d = make(leader, cfg.clip_contracts, `late leader @ ${f3(ask)}`);
      if (d) return d;
    }
  }

  // 3. hedge: keep the smaller leg at ~balance_target of the bigger one
  const [big, small]: ["yes" | "no", "yes" | "no"] =
    pos.yes.contracts >= pos.no.contracts ? ["yes", "no"] : ["no", "yes"];
  const bigCt = legs[big].mine.contracts, smallCt = legs[small].mine.contracts;
  if (frac >= cfg.second_leg_after_frac && smallCt < cfg.balance_target * bigCt) {
    const ask = legs[small].ask as number;
    if (ask <= cfg.hedge_max_price) {
      const d = make(small, cfg.clip_contracts,
        `hedge ${small} @ ${f3(ask)} (${smallCt.toFixed(0)}/${bigCt.toFixed(0)})`);
      if (d) return d;
    }
  }

  // 4. momentum: add to the rising side
  const ask = legs[leader].ask as number;
  if (cfg.momentum_min_price <= ask && ask <= cfg.momentum_max_price) {
    return make(leader, cfg.clip_contracts, `momentum ${leader} @ ${f3(ask)}`);
  }
  return null;
}

// Kalshi's published taker-fee shape: rate * C * P * (1-P), rounded up to the cent.
export function kalshiTakerFee(contracts: number, price: number, rate: number): number {
  const raw = rate * contracts * price * (1 - price);
  return Math.ceil(raw * 100 - 1e-9) / 100;
}

const round4 = (x: number) => Math.round(x * 1e4) / 1e4;

// Kalshi books list resting BIDS only; a YES ask is implied by the best NO bid.
export function parseOrderbook(payload: any): Book {
  const ob = payload?.orderbook_fp ?? payload?.orderbook ?? {};
  const levels = (raw: any): [number, number][] =>
    (raw ?? [])
      .map((l: any) => {
        let p = Number(l[0]);
        if (p > 1) p = p / 100; // legacy cents format
        return [p, Number(l[1])] as [number, number];
      })
      .sort((a: [number, number], b: [number, number]) => a[0] - b[0]);
  const yes = levels(ob.yes_dollars ?? ob.yes);
  const no = levels(ob.no_dollars ?? ob.no);
  const by = yes.length ? yes[yes.length - 1] : null;
  const bn = no.length ? no[no.length - 1] : null;
  return {
    yes_bid: by ? by[0] : null,
    yes_ask: bn ? round4(1 - bn[0]) : null,
    yes_ask_size: bn ? bn[1] : 0,
    no_bid: bn ? bn[0] : null,
    no_ask: by ? round4(1 - by[0]) : null,
    no_ask_size: by ? by[1] : 0,
  };
}

const SERIES_COIN: Record<string, string> = {
  KXBTC: "btc", KXETH: "eth", KXSOL: "sol", KXXRP: "xrp", KXDOGE: "doge", KXBNB: "bnb", KXHYPE: "hype",
};

export function coinFor(ticker: string): string {
  const t = ticker.toUpperCase();
  for (const [prefix, coin] of Object.entries(SERIES_COIN)) if (t.startsWith(prefix)) return coin;
  return "";
}
