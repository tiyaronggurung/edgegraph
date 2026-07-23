ALTER TABLE public.ev_decision_log
ADD COLUMN IF NOT EXISTS calibration_bucket text,
ADD COLUMN IF NOT EXISTS target_offset_seconds integer,
ADD COLUMN IF NOT EXISTS price_ceiling numeric,
ADD COLUMN IF NOT EXISTS min_edge_threshold numeric,
ADD COLUMN IF NOT EXISTS min_ev_threshold numeric,
ADD COLUMN IF NOT EXISTS min_conf_threshold numeric,
ADD COLUMN IF NOT EXISTS side_confidence numeric,
ADD COLUMN IF NOT EXISTS passes_price_ceiling boolean,
ADD COLUMN IF NOT EXISTS passes_edge boolean,
ADD COLUMN IF NOT EXISTS passes_ev boolean,
ADD COLUMN IF NOT EXISTS passes_conf boolean,
ADD COLUMN IF NOT EXISTS would_fire_gated boolean;

CREATE INDEX IF NOT EXISTS ev_decision_log_calibration_bucket_idx ON public.ev_decision_log(calibration_bucket);
CREATE INDEX IF NOT EXISTS ev_decision_log_target_offset_idx ON public.ev_decision_log(target_offset_seconds);
CREATE INDEX IF NOT EXISTS ev_decision_log_regime_tag_idx ON public.ev_decision_log(regime_tag);
CREATE INDEX IF NOT EXISTS ev_decision_log_would_fire_gated_idx ON public.ev_decision_log(would_fire_gated) WHERE (would_fire_gated = true);
