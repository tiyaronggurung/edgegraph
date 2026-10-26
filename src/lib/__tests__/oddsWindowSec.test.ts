import { describe, it, expect } from "vitest";
import { computeStrikeOdds, type Tick } from "@/hooks/useStrikeOdds";

const tape: Tick[] = Array.from({ length: 60 }, (_, i) => ({ t: i * 1000, p: 80000 + i * 0.5 }));

describe("odds window length", () => {
  it("15m default is unchanged when windowSec is omitted or 900", () => {
    const a = computeStrikeOdds(80030, 80000, 300, {}, tape);
    const b = computeStrikeOdds(80030, 80000, 300, { windowSec: 900 }, tape);
    expect(a.pUp).toBe(b.pUp);
    expect(a.timeWeight).toBeCloseTo(Math.sqrt(300 / 900), 6);
  });
  it("5m at window open gets full momentum runway (timeWeight 1)", () => {
    const o = computeStrikeOdds(80030, 80000, 300, { windowSec: 300 }, tape);
    expect(o.timeWeight).toBe(1);
  });
});
