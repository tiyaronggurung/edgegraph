ALTER TABLE public.btc_window_snapshots
  ADD COLUMN kalshi_snapshot_at timestamptz,
  ADD COLUMN kalshi_snapshot_source text;

COMMENT ON COLUMN public.btc_window_snapshots.kalshi_snapshot_at IS 'Timestamp of the stored Kalshi odds snapshot reused by the read-only capture path.';
COMMENT ON COLUMN public.btc_window_snapshots.kalshi_snapshot_source IS 'Source table or feed identifier for the reused Kalshi odds snapshot.';