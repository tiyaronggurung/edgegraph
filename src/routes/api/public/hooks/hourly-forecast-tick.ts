import { createFileRoute } from "@tanstack/react-router";
import { verifyCronRequest } from "@/lib/cronAuth";
import { buildHourlyForecast } from "@/lib/hourlyBtcForecast";
import { checkpointFor } from "@/lib/hourlyForecastTracking.functions";
import type { TCandle } from "@/lib/ta/trendlines";
import type { Json } from "@/integrations/supabase/types";

const TF_LIMITS = { "1m": 180, "5m": 180, "15m": 160, "1h": 180 } as const;

async function runHourlyTick() {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const candleEntries = await Promise.all(Object.entries(TF_LIMITS).map(async ([tf, limit]) => {
    const { data, error } = await supabaseAdmin
      .from("btc_candles")
      .select("bucket_start,o,h,l,c,v")
      .eq("tf", tf)
      .order("bucket_start", { ascending: false })
      .limit(limit);
    if (error) throw new Error(error.message);
    const candles: TCandle[] = (data ?? []).map((row) => ({
      t: new Date(row.bucket_start).getTime(),
      o: Number(row.o), h: Number(row.h), l: Number(row.l), c: Number(row.c),
      v: row.v == null ? undefined : Number(row.v),
    })).sort((a, b) => a.t - b.t);
    return [tf, candles] as const;
  }));
  const byTf = Object.fromEntries(candleEntries) as Record<keyof typeof TF_LIMITS, TCandle[]>;
  const nowMs = Date.now();
  const spot = byTf["1m"].at(-1)?.c;
  if (!spot) return { recorded: false, reason: "NO_SPOT" };
  const forecast = buildHourlyForecast({
    nowMs, spot,
    candles1m: byTf["1m"], candles5m: byTf["5m"],
    candles15m: byTf["15m"], candles1h: byTf["1h"],
  });
  const elapsedSeconds = Math.floor((nowMs - forecast.windowStart) / 1000);
  const checkpoint = checkpointFor(forecast.secondsLeft, elapsedSeconds);

  const priorClose = byTf["1m"].filter((candle) => candle.t < forecast.windowStart).at(-1)?.c;
  if (priorClose) {
    const { error } = await supabaseAdmin
      .from("btc_hourly_forecast_snapshots")
      .update({ close_spot: priorClose, settled_at: new Date().toISOString() })
      .eq("window_end", new Date(forecast.windowStart).toISOString())
      .is("settled_at", null);
    if (error) throw new Error(error.message);
  }
  if (!checkpoint) return { recorded: false, reason: "BETWEEN_CHECKPOINTS" };

  const volumeRatio = forecast.volumeAverage > 0 ? forecast.volumeNow / forecast.volumeAverage : null;
  const { error } = await supabaseAdmin.from("btc_hourly_forecast_snapshots").upsert({
    window_start: new Date(forecast.windowStart).toISOString(),
    window_end: new Date(forecast.windowEnd).toISOString(),
    checkpoint,
    spot,
    hourly_open: forecast.hourlyOpen,
    expected_move_usd: forecast.expectedMoveUsd,
    realized_vol_1m: forecast.realizedVolatility,
    volatility_regime: forecast.volatilityRegime,
    volume_ratio: volumeRatio,
    buy_level: forecast.buy,
    mid_level: forecast.mid,
    sell_level: forecast.sell,
    model_side: forecast.model?.side ?? null,
    model_confidence: forecast.model?.confidence ?? null,
    model_locked_at: forecast.model ? new Date(forecast.model.lockedAt).toISOString() : null,
    study_side: forecast.study?.side ?? null,
    study_confidence: forecast.study?.confidence ?? null,
    study_locked_at: forecast.study ? new Date(forecast.study.lockedAt).toISOString() : null,
    trendline_mid_side: forecast.mid == null ? null : spot >= forecast.mid ? "UP" : "DOWN",
    verdict: forecast.verdict,
    ladder: forecast.ladder.map((row) => ({ ...row })) as Json,
    data_as_of: forecast.dataAsOf ? new Date(forecast.dataAsOf).toISOString() : null,
    model_version: forecast.modelVersion,
  }, { onConflict: "window_start,checkpoint", ignoreDuplicates: true });
  if (error) throw new Error(error.message);
  return { recorded: true, checkpoint, windowStart: forecast.windowStart };
}

async function handler(request: Request) {
  const auth = await verifyCronRequest(request);
  if (auth) return auth;
  try {
    return Response.json({ ok: true, ...(await runHourlyTick()) });
  } catch (error) {
    return Response.json({ ok: false, error: error instanceof Error ? error.message : String(error) }, { status: 500 });
  }
}

export const Route = createFileRoute("/api/public/hooks/hourly-forecast-tick")({
  server: { handlers: { GET: ({ request }) => handler(request), POST: ({ request }) => handler(request) } },
});