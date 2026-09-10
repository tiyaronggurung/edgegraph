# One-hour BTC prediction

## Goal
Add a separate one-hour BTC forecast to the Crypto page without changing the working 15-minute model, Study locks, trading, or API feeds.

## Build
- Create a pure one-hour forecast model using the existing 1m, 5m, 15m, 1h, and daily candles.
- Combine distance to the target, remaining time, realized volatility, short-term drift, volume, multi-timeframe trend, and BUY/MID/SELL trendline position.
- Show whether BTC is projected above or below the selected target at the selected hour, with probability, required move, trend alignment, and data freshness.
- Add a 1-hour forecast panel beside the existing trendline section. Default the target to the active hourly level, while allowing a target such as $77,700.
- Keep this prediction read-only and shadow-only. It will not place or change paper or live orders.

## Validation
- Backtest the pure calculation against stored hourly and one-minute candles without future-data leakage.
- Add focused tests for UP, DOWN, near-target, stale-data, and insufficient-data cases.
- Verify the Crypto page renders and updates without slowing the existing live spot, Model, Study, trendline, or API paths.

## Technical details
- Reuse the existing candle cache and live composite BTC spot.
- Keep all new one-hour logic and display code isolated from the 15-minute prediction and execution files.
- Report calibration honestly; historical coverage is roughly two months of hourly candles and seven days of minute candles.
