import { describe, it, expect, beforeEach } from "vitest";
import {
  computeAndLogMarketIntel,
  _resetThrottleForTests,
  type Inserter,
} from "../computeAndLogMarketIntel.server";
import type { Candle } from "../types";

function C(t: number, o: number, h: number, l: number, c: number): Candle {
  return { t, o, h, l, c, v: 1, closed: true };
}
function ramp(n: number, start: number, step: number, bodyPct = 0.7): Candle[] {
  const out: Candle[] = [];
  let px = start;
  for (let i = 0; i < n; i++) {
    const o = px;
    const s = i > 0 && i % 3 === 2 ? -step * 0.45 : step;
    const c = px + s;
    const b = Math.abs(c - o) || 1;
    const w = ((b / bodyPct) - b) / 2;
    out.push(C(i * 60_000, o, Math.max(o, c) + w, Math.min(o, c) - w, c));
    px = c;
  }
  return out;
}

function makeCollector() {
  const rows: unknown[] = [];
  const inserter: Inserter = async (row) => {
    rows.push(row);
    return { inserted: true };
  };
  return { rows, inserter };
}

const baseEnv = { shadowEnabled: true, sampleRate: 1, minLogIntervalMs: 0 };

function baseInput(overrides: Partial<Parameters<typeof computeAndLogMarketIntel>[0]> = {}) {
  const decisionTs = new Date("2026-01-01T00:20:00.000Z");
  const c1 = ramp(30, 100_000, 40).map((c, i) => ({ ...c, t: decisionTs.getTime() - (30 - i) * 60_000 }));
  const c5 = ramp(12, 100_000, 200).map((c, i) => ({ ...c, t: decisionTs.getTime() - (12 - i) * 5 * 60_000 }));
  return {
    userId: "user-1",
    ticker: "KX-BTC-24DEC0100",
    strike: 101_500,
    spot: 101_400,
    closeTime: new Date(decisionTs.getTime() + 15 * 60_000).toISOString(),
    decisionTs,
    secondsToClose: 900,
    candles1m: c1,
    candles5m: c5,
    candles15m: [],
    predictionId: null,
    env: baseEnv,
    ...overrides,
  };
}

beforeEach(() => _resetThrottleForTests());

// ---- Basic insertion ----

describe("computeAndLogMarketIntel: happy path", () => {
  it("inserts exactly one row per valid event", async () => {
    const { rows, inserter } = makeCollector();
    const r = await computeAndLogMarketIntel({ ...baseInput(), inserter });
    expect(r.inserted).toBe(true);
    expect(rows).toHaveLength(1);
    expect(r.intel).toBeTruthy();
    expect(r.intel!.version).toBe("phase1.v1");
  });

  it("stores calculation duration and input lag", async () => {
    const { inserter, rows } = makeCollector();
    const r = await computeAndLogMarketIntel({ ...baseInput(), inserter });
    const row = rows[0] as Record<string, unknown>;
    expect(typeof row.calculation_duration_ms).toBe("number");
    expect(typeof row.input_lag_ms).toBe("number");
    expect(r.calculationDurationMs).toBeGreaterThanOrEqual(0);
  });

  it("stores version and component versions in signals", async () => {
    const { inserter, rows } = makeCollector();
    await computeAndLogMarketIntel({ ...baseInput(), inserter });
    const row = rows[0] as { market_intel_version: string; signals_jsonb: { versions: Record<string, string> } };
    expect(row.market_intel_version).toBe("phase1.v1");
    expect(row.signals_jsonb.versions.psychological_levels).toBe("v1");
    expect(row.signals_jsonb.versions.structure).toBe("v1");
  });

  it("stored cutoff timestamp equals the decision event ts", async () => {
    const { inserter, rows } = makeCollector();
    const input = baseInput();
    await computeAndLogMarketIntel({ ...input, inserter });
    const row = rows[0] as { decision_ts: string; signals_jsonb: { input_cutoff_time: string } };
    expect(row.decision_ts).toBe(input.decisionTs.toISOString());
    expect(row.signals_jsonb.input_cutoff_time).toBe(input.decisionTs.toISOString());
  });

  it("component outputs match combined output", async () => {
    const { inserter, rows } = makeCollector();
    const r = await computeAndLogMarketIntel({ ...baseInput(), inserter });
    const row = rows[0] as {
      direction: string; confidence: number;
      signals_jsonb: { combiner: { direction: string; confidence: number } };
    };
    expect(row.direction).toBe(r.intel!.direction);
    expect(row.confidence).toBe(r.intel!.confidence);
    expect(row.signals_jsonb.combiner.direction).toBe(r.intel!.direction);
  });
});

// ---- Idempotency / dedupe ----

describe("computeAndLogMarketIntel: idempotency", () => {
  it("simulated duplicate insert (unique-violation code) reports not-inserted without throwing", async () => {
    let calls = 0;
    const inserter: Inserter = async () => {
      calls++;
      return calls === 1 ? { inserted: true } : { inserted: false, error: "duplicate" };
    };
    const input = baseInput();
    const first = await computeAndLogMarketIntel({ ...input, inserter });
    _resetThrottleForTests();
    const second = await computeAndLogMarketIntel({ ...input, inserter });
    expect(first.inserted).toBe(true);
    expect(second.inserted).toBe(false);
    expect(second.reason).toBe("duplicate");
  });
});

// ---- Failure isolation ----

describe("computeAndLogMarketIntel: never blocks caller", () => {
  it("inserter throw is swallowed", async () => {
    const inserter: Inserter = async () => { throw new Error("db down"); };
    const r = await computeAndLogMarketIntel({ ...baseInput(), inserter });
    expect(r.inserted).toBe(false);
    expect(r.intel).toBeTruthy(); // still computed
  });

  it("inserter returning error string doesn't throw", async () => {
    const inserter: Inserter = async () => ({ inserted: false, error: "some pg error" });
    const r = await computeAndLogMarketIntel({ ...baseInput(), inserter });
    expect(r.inserted).toBe(false);
    expect(r.reason).toBe("some pg error");
  });
});

// ---- Candle sanitization ----

describe("computeAndLogMarketIntel: candle hygiene", () => {
  it("excludes future candles (t >= decisionTs)", async () => {
    const input = baseInput();
    const futureCandle = C(input.decisionTs.getTime() + 60_000, 200_000, 200_050, 199_950, 200_010);
    const contaminated = [...input.candles1m, futureCandle];
    const { inserter, rows } = makeCollector();
    await computeAndLogMarketIntel({ ...input, candles1m: contaminated, inserter });
    const row = rows[0] as { signals_jsonb: { candle_counts: { "1m": number } } };
    expect(row.signals_jsonb.candle_counts["1m"]).toBe(input.candles1m.length);
  });

  it("excludes forming (closed=false) candles", async () => {
    const input = baseInput();
    const forming: Candle = { ...input.candles1m[input.candles1m.length - 1], t: input.decisionTs.getTime() - 30_000, closed: false, c: 999_999 };
    const { inserter, rows } = makeCollector();
    await computeAndLogMarketIntel({ ...input, candles1m: [...input.candles1m, forming], inserter });
    const row = rows[0] as { signals_jsonb: { candle_counts: { "1m": number } } };
    expect(row.signals_jsonb.candle_counts["1m"]).toBe(input.candles1m.length);
  });

  it("deduplicates candles with identical open time", async () => {
    const input = baseInput();
    const dup = { ...input.candles1m[5] };
    const { inserter, rows } = makeCollector();
    await computeAndLogMarketIntel({ ...input, candles1m: [...input.candles1m, dup], inserter });
    const row = rows[0] as { signals_jsonb: { candle_counts: { "1m": number } } };
    expect(row.signals_jsonb.candle_counts["1m"]).toBe(input.candles1m.length);
  });

  it("does not mutate caller's candle arrays", async () => {
    const input = baseInput();
    const c1Snap = [...input.candles1m];
    const c5Snap = [...input.candles5m];
    const { inserter } = makeCollector();
    await computeAndLogMarketIntel({ ...input, inserter });
    expect(input.candles1m).toEqual(c1Snap);
    expect(input.candles5m).toEqual(c5Snap);
  });
});

// ---- Data quality / status ----

describe("computeAndLogMarketIntel: status tracking", () => {
  it("missing 15m data → status=partial", async () => {
    const { inserter, rows } = makeCollector();
    const r = await computeAndLogMarketIntel({ ...baseInput(), inserter });
    expect(r.status).toBe("partial");
    const row = rows[0] as { status: string };
    expect(row.status).toBe("partial");
  });

  it("insufficient history → status=insufficient_data, NEUTRAL, low confidence", async () => {
    const shortC1 = ramp(3, 100_000, 40);
    const { inserter, rows } = makeCollector();
    const r = await computeAndLogMarketIntel({ ...baseInput(), candles1m: shortC1, candles5m: [], inserter });
    expect(r.status).toBe("insufficient_data");
    const row = rows[0] as { status: string; direction: string; confidence: number };
    expect(row.status).toBe("insufficient_data");
    expect(row.direction).toBe("NEUTRAL");
    expect(row.confidence).toBe(0);
  });
});

// ---- Runtime guardrails ----

describe("computeAndLogMarketIntel: runtime guardrails", () => {
  it("shadow disabled → no insert", async () => {
    const { inserter, rows } = makeCollector();
    const r = await computeAndLogMarketIntel({
      ...baseInput(),
      inserter,
      env: { ...baseEnv, shadowEnabled: false },
    });
    expect(r.status).toBe("skipped_disabled");
    expect(r.inserted).toBe(false);
    expect(rows).toHaveLength(0);
  });

  it("min-log-interval throttles duplicate rapid calls", async () => {
    const { inserter, rows } = makeCollector();
    const env = { ...baseEnv, minLogIntervalMs: 60_000 };
    const input = baseInput();
    const r1 = await computeAndLogMarketIntel({ ...input, inserter, env });
    const r2 = await computeAndLogMarketIntel({ ...input, inserter, env });
    expect(r1.inserted).toBe(true);
    expect(r2.status).toBe("skipped_min_interval");
    expect(rows).toHaveLength(1);
  });
});

// ---- Determinism ----

describe("computeAndLogMarketIntel: determinism", () => {
  it("same input produces same persisted row (excluding timings)", async () => {
    const inputs = baseInput();
    const collector1 = makeCollector();
    const collector2 = makeCollector();
    await computeAndLogMarketIntel({ ...inputs, inserter: collector1.inserter });
    _resetThrottleForTests();
    await computeAndLogMarketIntel({ ...inputs, inserter: collector2.inserter });
    const stripTiming = (r: unknown) => {
      const row = { ...(r as Record<string, unknown>) };
      delete row.calculation_duration_ms;
      const signals = { ...(row.signals_jsonb as Record<string, unknown>) };
      const dq = { ...(signals.data_quality as Record<string, unknown>) };
      delete dq.calculation_duration_ms;
      signals.data_quality = dq;
      row.signals_jsonb = signals;
      return row;
    };
    expect(stripTiming(collector1.rows[0])).toEqual(stripTiming(collector2.rows[0]));
  });
});

// ---- Psych level persistence ----

describe("computeAndLogMarketIntel: psychological level persistence", () => {
  it("persists psych fields in top-level columns and signals_jsonb", async () => {
    const { inserter, rows } = makeCollector();
    await computeAndLogMarketIntel({ ...baseInput(), inserter });
    const row = rows[0] as {
      psych_state: string;
      psych_level_role: string;
      round_confluence_score: number;
      signals_jsonb: { psychological_levels: { state: string } };
    };
    expect(row.psych_state).toBeTruthy();
    expect(row.psych_level_role).toBeTruthy();
    expect(row.signals_jsonb.psychological_levels).toBeTruthy();
    expect(row.signals_jsonb.psychological_levels.state).toBe(row.psych_state);
  });
});
