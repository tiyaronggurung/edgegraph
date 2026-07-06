
ALTER TABLE public.auto_odds_decision_log
  ADD COLUMN model_prob_1min_ago NUMERIC,
  ADD COLUMN model_prob_3min_ago NUMERIC,
  ADD COLUMN model_prob_5min_ago NUMERIC,
  ADD COLUMN model_prob_10min_ago NUMERIC,
  ADD COLUMN prediction_direction_1min_ago TEXT,
  ADD COLUMN prediction_direction_3min_ago TEXT,
  ADD COLUMN prediction_direction_5min_ago TEXT,
  ADD COLUMN prediction_direction_10min_ago TEXT,
  ADD COLUMN model_stability_score NUMERIC,
  ADD COLUMN prediction_flip_count INTEGER,
  ADD COLUMN prediction_duration_seconds INTEGER,
  ADD COLUMN max_probability_last_10min NUMERIC,
  ADD COLUMN min_probability_last_10min NUMERIC,
  ADD COLUMN history_samples_count INTEGER;
