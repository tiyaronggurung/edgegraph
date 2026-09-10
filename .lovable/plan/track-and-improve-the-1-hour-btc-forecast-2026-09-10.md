# Track and improve the 1-hour BTC forecast

## Goal
Turn the new hourly ladder into a read-only shadow tracker that proves which signal is most accurate and how volatility changes each UP/DOWN probability, while leaving every existing 15-minute prediction and trading path untouched.

## What will be built
- Record isolated hourly snapshots at fixed checkpoints: hour open, Study lock at T+15m, T−30m, T−15m, T−5m, and close.
- Store the frozen hourly Model pick, locked hourly Study pick, BUY/MID/SELL trendline levels, spot, hourly open, expected move, realized volatility, volume ratio, every ladder target probability, and data freshness.
- Settle each hourly target against the actual hour-close BTC price, then score:
  - Model pick accuracy
  - Study pick accuracy
  - Model + Study agreement accuracy
  - Study + trendline MID confirmation accuracy
  - Full Model + Study + MID agreement accuracy
- Break results into volatility regimes so the report shows whether probabilities are overconfident or underconfident in low, normal, and high volatility.
- Add an hourly scorecard beneath the existing ladder showing sample size, wins/losses, hit rate, calibration error, and the best-performing signal combination.
- Keep the feature shadow-only: no orders, no auto-trading, and no changes to the existing 15-minute model, Study lock, trendline chart, or execution code.

## Signal rules
- **Model:** frozen once at the hourly open from data available before the hour begins, matching the existing “frozen Model pick” discipline.
- **Study:** locked once at T+15m and never changed afterward.
- **Trendline confirmation:** use the existing trendline engine’s BUY/MID/SELL levels; the Study side is confirmed only when spot is on the same side of MID.
- **Probabilities:** use one monotonic distribution across all ladder prices, with expected move widened or narrowed by realized volatility. Track predicted probability versus actual frequency by probability and volatility bucket.

## Safety and validation
- Use new hourly-only storage and functions with authenticated read access and server-only writes.
- Do not import hourly tracking into any 15-minute trading or prediction module.
- Add tests for frozen locks, one-write-per-checkpoint behavior, settlement, monotonic ladder odds, volatility widening, and score aggregation.
- Verify the Crypto page still loads normally and that the 15-minute panels remain unchanged.
