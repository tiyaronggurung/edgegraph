ALTER TABLE public.btc_trendline_config DROP CONSTRAINT IF EXISTS btc_trendline_config_mode;
ALTER TABLE public.btc_trendline_config ADD CONSTRAINT btc_trendline_config_mode CHECK (booster_mode IN ('follow','fade','hybrid','off'));
UPDATE public.btc_trendline_config SET booster_mode = 'hybrid', updated_at = now() WHERE id = 1;