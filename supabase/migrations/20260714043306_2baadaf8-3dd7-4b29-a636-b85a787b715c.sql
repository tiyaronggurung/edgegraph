-- Replace the two partial UNIQUE indexes on btc_spot_ticks with a single
-- full UNIQUE constraint on (source, observed_at_sec). The partial indexes
-- cannot be targeted by PostgREST's on_conflict, so every upsert from
-- recordSpotTick() was silently failing and no ticks were being persisted.
DROP INDEX IF EXISTS public.btc_spot_ticks_dedup_source_ts;
DROP INDEX IF EXISTS public.btc_spot_ticks_dedup_rounded;

-- Deduplicate any existing rows before adding the constraint (defensive;
-- table is currently empty but this keeps the migration safe to re-run
-- in environments where data exists).
DELETE FROM public.btc_spot_ticks a
USING public.btc_spot_ticks b
WHERE a.id < b.id
  AND a.source = b.source
  AND a.observed_at_sec = b.observed_at_sec;

ALTER TABLE public.btc_spot_ticks
  ADD CONSTRAINT btc_spot_ticks_dedup UNIQUE (source, observed_at_sec);