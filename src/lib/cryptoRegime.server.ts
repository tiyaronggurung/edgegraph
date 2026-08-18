// AI regime classifier for BTC 15-min windows.
//
// Calls Gemini every 5 minutes with a compact factor summary (σ short/long,
// drift, funding, OI delta, basis, CVD, OFI, IV, 25Δ skew, whale flow) and
// returns a regime label + knobs:
//   - sigmaMult: multiply per-minute σ by this (0.7..1.8)
//   - driftBiasPerMin: add this to per-minute drift in log-return units
// These knobs apply to every market for the duration of the 5-min cache TTL.
//
// Cached aggressively because: (a) the inputs only meaningfully change every
// few minutes, (b) we don't want per-market AI cost, (c) Gemini latency would
// blow the page TTFB if called per market per request.
//
// Server-only — never import from a route file or client module.
import type { BtcMicro, BtcOptions } from "./cryptoBtc.functions";

export interface RegimeState {
  asOf: string;
  regime: "chop" | "trend-up" | "trend-down" | "breakout" | "squeeze" | "unknown";
  sigmaMult: number;        // 0.7 .. 1.8 — σ multiplier applied to every market
  driftBiasPerMin: number;  // log-return per minute, capped to ±0.003
  confidence: number;       // 0..1 (model's own self-rated)
  reason: string;           // one-liner human-readable explanation
  source: "ai" | "fallback" | "cache";
}

export interface RegimeInputs {
  spot: number;
  sigmaShort: number;       // per-minute, last 5 candles
  sigmaLong: number;        // per-minute, last 60 candles
  drift: number;            // per-minute, recent slope
  micro: BtcMicro | null;
  options: BtcOptions | null;
  recentCandles: Array<{ t: number; o: number; h: number; l: number; c: number; v: number }>;
}

const CACHE_TTL_MS = 5 * 60_000;
let _cache: { at: number; state: RegimeState } | null = null;

// On-demand only: the AI call fires exactly once after a user action arms it.
// Background ticks reuse the last known state (or a neutral fallback).
let _armed = false;
export function armRegimeRefresh() {
  _armed = true;
}


function neutralFallback(reason: string): RegimeState {
  return {
    asOf: new Date().toISOString(),
    regime: "unknown",
    sigmaMult: 1.0,
    driftBiasPerMin: 0,
    confidence: 0,
    reason,
    source: "fallback",
  };
}

// Compact a 30-min candle stream into a few summary numbers for the prompt —
// keeps the token count tiny and forces the model to reason on stats, not raw bars.
function summarizeCandles(c: RegimeInputs["recentCandles"]): {
  windowMoveBps: number;
  highLowRangeBps: number;
  upCandles: number;
  downCandles: number;
  maxSingleCandleBps: number;
} {
  const last30 = c.slice(-30);
  if (last30.length < 2) return { windowMoveBps: 0, highLowRangeBps: 0, upCandles: 0, downCandles: 0, maxSingleCandleBps: 0 };
  const first = last30[0].c;
  const last = last30[last30.length - 1].c;
  const high = Math.max(...last30.map(x => x.h));
  const low = Math.min(...last30.map(x => x.l));
  let up = 0, down = 0, maxBps = 0;
  for (const bar of last30) {
    if (bar.c > bar.o) up++; else if (bar.c < bar.o) down++;
    const bps = Math.abs(bar.c - bar.o) / bar.o * 10000;
    if (bps > maxBps) maxBps = bps;
  }
  return {
    windowMoveBps: (last - first) / first * 10000,
    highLowRangeBps: (high - low) / first * 10000,
    upCandles: up,
    downCandles: down,
    maxSingleCandleBps: maxBps,
  };
}

export async function getRegime(inputs: RegimeInputs): Promise<RegimeState> {
  // Serve from cache when fresh — the inputs barely move minute-to-minute.
  if (_cache && Date.now() - _cache.at < CACHE_TTL_MS) {
    return { ..._cache.state, source: "cache" };
  }

  // Not armed by a user action → never call the AI gateway. Reuse the last
  // known state if we have one, else stay neutral.
  if (!_armed) {
    if (_cache) return { ..._cache.state, source: "cache" };
    return neutralFallback("AI regime is on-demand only (not armed)");
  }
  _armed = false;



  const key = process.env.LOVABLE_API_KEY;
  if (!key) {
    const state = neutralFallback("LOVABLE_API_KEY missing");
    _cache = { at: Date.now(), state };
    return state;
  }

  const tape = summarizeCandles(inputs.recentCandles);
  const m = inputs.micro;
  const o = inputs.options;

  // Compact JSON payload — keep it under ~400 tokens so latency stays low.
  const payload = {
    spot: Math.round(inputs.spot),
    sigma: {
      short_per_min_bps: +(inputs.sigmaShort * 10000).toFixed(2),
      long_per_min_bps: +(inputs.sigmaLong * 10000).toFixed(2),
      expansion_ratio: +(inputs.sigmaShort / Math.max(1e-9, inputs.sigmaLong)).toFixed(2),
    },
    drift_per_min_bps: +(inputs.drift * 10000).toFixed(2),
    tape_30m: {
      move_bps: +tape.windowMoveBps.toFixed(1),
      range_bps: +tape.highLowRangeBps.toFixed(1),
      up_bars: tape.upCandles,
      down_bars: tape.downCandles,
      max_single_bar_bps: +tape.maxSingleCandleBps.toFixed(1),
    },
    micro: m ? {
      funding_ann_bps: +m.fundingAnnualBps.toFixed(0),
      oi_delta_5m_pct: +m.oiDelta5mPct.toFixed(2),
      basis_bps: +m.basisBps.toFixed(1),
      cvd_ratio: +m.cvdRatio.toFixed(2),
      ofi: +m.ofi.toFixed(2),
      whale_imb_5m: +m.whaleImbalance5m.toFixed(2),
      spread_bps: +m.bookSpreadBps.toFixed(1),
    } : null,
    options: o ? {
      atm_iv_ann: +o.atmIv.toFixed(3),
      skew_25d: +o.skew25.toFixed(3),
    } : null,
  };

  const system = [
    "You are a quant regime classifier for BTC 15-minute Kalshi binary options.",
    "Given current vol, drift, microstructure, options skew, and 30-min tape stats,",
    "pick ONE regime and recommend two knobs the diffusion model should apply:",
    "  sigmaMult ∈ [0.7, 1.8]   (σ multiplier — >1 = expect bigger moves)",
    "  driftBiasPerMin ∈ [-0.003, 0.003]  (log-return drift bias)",
    "Regimes:",
    "  chop        — range-bound, low realized vol, mean-reverting → sigmaMult≈0.85, drift≈0",
    "  trend-up    — sustained upward drift, OI rising with price → sigmaMult≈1.1, drift>0",
    "  trend-down  — sustained downward drift → sigmaMult≈1.1, drift<0",
    "  breakout    — short σ >> long σ, expanding range, momentum aligned → sigmaMult≈1.4, drift signed",
    "  squeeze     — compressing range, low vol before expansion → sigmaMult≈1.2, drift≈0",
    "Be conservative — defaulting to chop with sigmaMult=1.0 is fine when signals conflict.",
    "Reply with ONE tool call to emit_regime.",
  ].join("\n");

  const tool = {
    type: "function" as const,
    function: {
      name: "emit_regime",
      description: "Emit the classified BTC regime and recommended diffusion knobs.",
      parameters: {
        type: "object",
        properties: {
          regime: { type: "string", enum: ["chop", "trend-up", "trend-down", "breakout", "squeeze"] },
          sigmaMult: { type: "number", minimum: 0.7, maximum: 1.8 },
          driftBiasPerMin: { type: "number", minimum: -0.003, maximum: 0.003 },
          confidence: { type: "number", minimum: 0, maximum: 1 },
          reason: { type: "string", maxLength: 240 },
        },
        required: ["regime", "sigmaMult", "driftBiasPerMin", "confidence", "reason"],
        additionalProperties: false,
      },
    },
  };

  try {
    const ctrl = new AbortController();
    const timeout = setTimeout(() => ctrl.abort(), 8000);
    const res = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
      method: "POST",
      headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
      signal: ctrl.signal,
      body: JSON.stringify({
        model: "google/gemini-3-flash-preview",
        messages: [
          { role: "system", content: system },
          { role: "user", content: JSON.stringify(payload) },
        ],
        tools: [tool],
        tool_choice: { type: "function", function: { name: "emit_regime" } },
      }),
    });
    clearTimeout(timeout);
    if (!res.ok) {
      const state = neutralFallback(`AI gateway ${res.status}`);
      _cache = { at: Date.now(), state };
      return state;
    }
    const j: any = await res.json();
    const rawArgs = j?.choices?.[0]?.message?.tool_calls?.[0]?.function?.arguments;
    if (!rawArgs) {
      const state = neutralFallback("AI returned no tool call");
      _cache = { at: Date.now(), state };
      return state;
    }
    const parsed = typeof rawArgs === "string" ? JSON.parse(rawArgs) : rawArgs;
    const state: RegimeState = {
      asOf: new Date().toISOString(),
      regime: parsed.regime,
      // Clip server-side too — never trust the LLM to honor its own ranges.
      sigmaMult: Math.max(0.7, Math.min(1.8, Number(parsed.sigmaMult) || 1)),
      driftBiasPerMin: Math.max(-0.003, Math.min(0.003, Number(parsed.driftBiasPerMin) || 0)),
      confidence: Math.max(0, Math.min(1, Number(parsed.confidence) || 0)),
      reason: String(parsed.reason ?? "").slice(0, 240),
      source: "ai",
    };
    _cache = { at: Date.now(), state };
    return state;
  } catch (e: any) {
    const state = neutralFallback(`AI call failed: ${e?.message ?? "unknown"}`);
    _cache = { at: Date.now(), state };
    return state;
  }
}
