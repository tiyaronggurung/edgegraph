import { describe, it, expect } from "vitest";
import { computeStrikeOdds, type Tick } from "@/hooks/useStrikeOdds";

// Fast pump over the last 10s, price $20 above strike, 3 min left on a 5m clock.
const now = Date.now();
const tape: Tick[] = [];
for (let i = 0; i < 100; i++) tape.push({ t: now - (100 - i) * 1000, p: i < 90 ? 80000 : 80000 + (i - 89) * 2 });

describe("5m volume in/out filter", () => {
  const base = { windowSec: 300 };
  it("pump with sellers dominating gets lower UP odds than pump backed by buyers", () => {
    const fake = computeStrikeOdds(80020, 80000, 180, { ...base, win5VolIn: 10, win5VolOut: 30 }, tape);
    const real = computeStrikeOdds(80020, 80000, 180, { ...base, win5VolIn: 30, win5VolOut: 10 }, tape);
    expect(fake.pUp!).toBeLessThan(real.pUp!);
  });
  it("15m output is unchanged when no 5m volume is passed", () => {
    const a = computeStrikeOdds(80020, 80000, 500, {}, tape);
    const b = computeStrikeOdds(80020, 80000, 500, { windowSec: 900 }, tape);
    expect(a.pUp).toBe(b.pUp);
  });
});
