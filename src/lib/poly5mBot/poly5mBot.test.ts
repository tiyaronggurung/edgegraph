import { describe, expect, it } from "vitest";
import { decideEntry, decideExit, contractsFor, settlePnl } from "./decide";
import { isAllowed, addResult } from "./learn";
import { situationKey } from "./situation";

const book = (upAsk: number | null, downAsk: number | null) => ({ upAsk, downAsk });

describe("5m entry", () => {
  it("enters when our odds ≥65% and ask is ≥5¢ cheaper", () => {
    expect(decideEntry(0.66, book(0.6, 0.42), 60)?.side).toBe("UP");
  });
  it("skips below 65% odds", () => {
    expect(decideEntry(0.64, book(0.5, 0.52), 60)).toBeNull();
  });
  it("skips when edge under 5¢", () => {
    expect(decideEntry(0.7, book(0.66, 0.36), 60)).toBeNull();
  });
  it("skips before 45s and after 3:30", () => {
    expect(decideEntry(0.8, book(0.6, 0.42), 44)).toBeNull();
    expect(decideEntry(0.8, book(0.6, 0.42), 211)).toBeNull();
  });
  it("enters DOWN when our UP is low", () => {
    expect(decideEntry(0.25, book(0.4, 0.62), 90)?.side).toBe("DOWN");
  });
  it("sizes by stake / ask", () => {
    expect(contractsFor(10, 0.6)).toBe(16);
  });
});

describe("5m exits", () => {
  it("takes profit at bid ≥88¢", () => {
    // UP bid = 1 - downAsk = 0.88
    expect(decideExit({ side: "UP", contracts: 10, hedged: false }, 0.9, book(0.9, 0.12))?.kind).toBe("tp");
  });
  it("rescues at our odds ≤38% when opposite ask ≤50¢", () => {
    const a = decideExit({ side: "UP", contracts: 10, hedged: false }, 0.38, book(0.55, 0.5));
    expect(a).toEqual({ kind: "rescue", px: 0.5, contracts: 10 });
  });
  it("no rescue if opposite ask above 50¢", () => {
    expect(decideExit({ side: "UP", contracts: 10, hedged: false }, 0.3, book(0.4, 0.51))).toBeNull();
  });
  it("settles hedged pair as payout minus both costs", () => {
    expect(settlePnl({ side: "UP", contracts: 10, cost: 6, hedgeContracts: 10, hedgeCost: 5 }, "DOWN")).toBe(-1);
  });
});

describe("learning", () => {
  it("allows any situation under 20 samples", () => {
    let s = { n: 0, wins: 0, px_sum: 0, pnl_per_dollar_sum: 0 };
    for (let i = 0; i < 19; i++) s = addResult(s, false, 0.6);
    expect(isAllowed(s)).toBe(true);
  });
  it("blocks at 20 samples when win rate does not beat price", () => {
    let s = { n: 0, wins: 0, px_sum: 0, pnl_per_dollar_sum: 0 };
    for (let i = 0; i < 20; i++) s = addResult(s, i < 10, 0.6);
    expect(isAllowed(s)).toBe(false);
  });
  it("keeps a situation that clearly beats price", () => {
    let s = { n: 0, wins: 0, px_sum: 0, pnl_per_dollar_sum: 0 };
    for (let i = 0; i < 20; i++) s = addResult(s, i < 17, 0.6);
    expect(isAllowed(s)).toBe(true);
  });
  it("builds a readable situation key", () => {
    expect(situationKey({ side: "UP", odds: 0.72, edge: 0.12, elapsedSec: 60, flowImbalance: 0.2, areaUp: 0.7, rangePct: 0.02 }))
      .toBe("c70-80|e10-20|early|flow+|area+|calm");
  });
});
