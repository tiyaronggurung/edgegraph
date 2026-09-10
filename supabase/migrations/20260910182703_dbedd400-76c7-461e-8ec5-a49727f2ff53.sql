CREATE TABLE public.btc_hourly_forecast_snapshots (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  window_start timestamptz NOT NULL,
  window_end timestamptz NOT NULL,
  checkpoint text NOT NULL CHECK (checkpoint IN ('OPEN','STUDY_LOCK','T30','T15','T5','CLOSE')),
  captured_at timestamptz NOT NULL DEFAULT now(),
  spot numeric NOT NULL,
  hourly_open numeric NOT NULL,
  expected_move_usd numeric NOT NULL,
  realized_vol_1m numeric NOT NULL,
  volatility_regime text NOT NULL CHECK (volatility_regime IN ('LOW','NORMAL','HIGH')),
  volume_ratio numeric,
  buy_level numeric,
  mid_level numeric,
  sell_level numeric,
  model_side text CHECK (model_side IN ('UP','DOWN')),
  model_confidence numeric,
  model_locked_at timestamptz,
  study_side text CHECK (study_side IN ('UP','DOWN')),
  study_confidence numeric,
  study_locked_at timestamptz,
  trendline_mid_side text CHECK (trendline_mid_side IN ('UP','DOWN')),
  verdict text NOT NULL CHECK (verdict IN ('AGREE','DISAGREE','STUDYING','INSUFFICIENT_DATA')),
  ladder jsonb NOT NULL DEFAULT '[]'::jsonb,
  data_as_of timestamptz,
  model_version text NOT NULL,
  close_spot numeric,
  settled_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (window_start, checkpoint)
);

GRANT SELECT ON public.btc_hourly_forecast_snapshots TO authenticated;
GRANT ALL ON public.btc_hourly_forecast_snapshots TO service_role;

ALTER TABLE public.btc_hourly_forecast_snapshots ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Authenticated users can view hourly forecast snapshots"
ON public.btc_hourly_forecast_snapshots
FOR SELECT
TO authenticated
USING (true);

CREATE INDEX btc_hourly_forecast_snapshots_window_idx
ON public.btc_hourly_forecast_snapshots (window_start DESC, checkpoint);

CREATE INDEX btc_hourly_forecast_snapshots_settled_idx
ON public.btc_hourly_forecast_snapshots (settled_at DESC)
WHERE settled_at IS NOT NULL;

CREATE TRIGGER update_btc_hourly_forecast_snapshots_updated_at
BEFORE UPDATE ON public.btc_hourly_forecast_snapshots
FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();