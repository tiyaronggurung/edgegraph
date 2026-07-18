-- Phase 1: Market Context Engine — checkpoint-based shadow telemetry.
-- Purely additive. No changes to existing gates, staking, or trade execution.

CREATE TABLE IF NOT EXISTS public.btc_market_context (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,

  -- Identity
  ticker TEXT NOT NULL,
  window_start_ts TIMESTAMPTZ NOT NULL,
  window_end_ts   TIMESTAMPTZ NOT NULL,
  checkpoint_type TEXT NOT NULL, -- 'first_valid' | 't_minus_10' | 't_minus_5' | 't_minus_2' | 'fire' | 'final'
  captured_at TIMESTAMPTZ NOT NULL DEFAULT now(),

  -- Version stamps
  context_engine_version   TEXT NOT NULL DEFAULT 'v1',
  sr_algorithm_version     TEXT NOT NULL DEFAULT 'v1',
  volume_profile_version   TEXT NOT NULL DEFAULT 'v1',

  -- Spot + strike snapshot
  spot_price NUMERIC,
  strike_price NUMERIC,
  strike_distance_usd NUMERIC,
  strike_distance_pct NUMERIC,
  strike_distance_atr NUMERIC,
  strike_distance_em NUMERIC, -- in expected-moves

  -- RSI
  rsi_5m  NUMERIC,
  rsi_15m NUMERIC,
  rsi_1h  NUMERIC,

  -- MACD
  macd_5m_line NUMERIC,
  macd_5m_signal NUMERIC,
  macd_5m_hist NUMERIC,
  macd_5m_cross TEXT, -- 'bull' | 'bear' | 'none'
  macd_15m_line NUMERIC,
  macd_15m_signal NUMERIC,
  macd_15m_hist NUMERIC,
  macd_15m_cross TEXT,

  -- Bollinger Bands (5m, 20/2)
  bb_5m_upper NUMERIC,
  bb_5m_mid   NUMERIC,
  bb_5m_lower NUMERIC,
  bb_5m_pctb  NUMERIC,   -- %B position
  bb_5m_bandwidth NUMERIC,
  bb_5m_squeeze BOOLEAN,

  -- ADX 15m
  adx_15m NUMERIC,
  adx_15m_plus_di NUMERIC,
  adx_15m_minus_di NUMERIC,

  -- Session VWAP (UTC session)
  vwap_session NUMERIC,
  vwap_distance_usd NUMERIC,
  vwap_distance_pct NUMERIC,
  vwap_above BOOLEAN,

  -- Volume profile (24h, session on completed 15m candles)
  vp_poc NUMERIC,
  vp_vah NUMERIC,
  vp_val NUMERIC,
  vp_price_position TEXT, -- 'below_val' | 'in_value' | 'above_vah'

  -- Multi-timeframe trend
  trend_1m  TEXT,  -- 'up' | 'down' | 'flat'
  trend_5m  TEXT,
  trend_15m TEXT,
  trend_1h  TEXT,
  trend_4h  TEXT,
  trend_alignment_score NUMERIC, -- -1..1

  -- HTF Support/Resistance (nearest zones)
  nearest_support NUMERIC,
  nearest_support_touches INT,
  nearest_support_tf TEXT, -- '15m' | '1h' | '4h'
  nearest_support_distance_usd NUMERIC,
  nearest_support_distance_pct NUMERIC,
  nearest_resistance NUMERIC,
  nearest_resistance_touches INT,
  nearest_resistance_tf TEXT,
  nearest_resistance_distance_usd NUMERIC,
  nearest_resistance_distance_pct NUMERIC,
  sr_zones_json JSONB, -- full clustered zone list for later study

  -- Model state (echoed for join convenience)
  model_prob NUMERIC,
  model_side TEXT,
  side_conf NUMERIC,

  -- Fire-time only fields (nullable for non-fire checkpoints)
  fired BOOLEAN NOT NULL DEFAULT false,
  order_id UUID,

  -- Raw diagnostic blob (indicators for later replay)
  raw_json JSONB,

  UNIQUE (ticker, checkpoint_type)
);

GRANT SELECT ON public.btc_market_context TO authenticated;
GRANT ALL ON public.btc_market_context TO service_role;

ALTER TABLE public.btc_market_context ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Authenticated users can read market context"
  ON public.btc_market_context FOR SELECT TO authenticated USING (true);

CREATE INDEX IF NOT EXISTS idx_btc_market_context_ticker ON public.btc_market_context (ticker);
CREATE INDEX IF NOT EXISTS idx_btc_market_context_window ON public.btc_market_context (window_start_ts DESC);
CREATE INDEX IF NOT EXISTS idx_btc_market_context_checkpoint ON public.btc_market_context (checkpoint_type);
CREATE INDEX IF NOT EXISTS idx_btc_market_context_captured ON public.btc_market_context (captured_at DESC);

-- Echo fire-time context onto auto_trade_orders for easy join-free outcome analysis.
ALTER TABLE public.auto_trade_orders
  ADD COLUMN IF NOT EXISTS ctx_rsi_15m NUMERIC,
  ADD COLUMN IF NOT EXISTS ctx_rsi_1h NUMERIC,
  ADD COLUMN IF NOT EXISTS ctx_macd_15m_hist NUMERIC,
  ADD COLUMN IF NOT EXISTS ctx_bb_5m_pctb NUMERIC,
  ADD COLUMN IF NOT EXISTS ctx_adx_15m NUMERIC,
  ADD COLUMN IF NOT EXISTS ctx_vwap_distance_pct NUMERIC,
  ADD COLUMN IF NOT EXISTS ctx_vp_price_position TEXT,
  ADD COLUMN IF NOT EXISTS ctx_trend_alignment_score NUMERIC,
  ADD COLUMN IF NOT EXISTS ctx_nearest_support_distance_pct NUMERIC,
  ADD COLUMN IF NOT EXISTS ctx_nearest_resistance_distance_pct NUMERIC,
  ADD COLUMN IF NOT EXISTS ctx_engine_version TEXT;
