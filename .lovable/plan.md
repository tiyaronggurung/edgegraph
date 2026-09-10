# One-hour BTC prediction

## Goal
Add a separate one-hour BTC forecast to the Crypto page, modeled after the provided hourly market reference, without changing the working 15-minute model, Study locks, trading, or API feeds.

## Build
- Create a pure one-hour forecast model using the existing 1m, 5m, 15m, 1h, and daily candles.
- Combine distance to the target, remaining time, realized volatility, short-term drift, volume, multi-timeframe trend, and BUY/MID/SELL trendline position.
- Add a Kalshi-style ladder of nearby BTC target prices. Each row shows the probability of finishing above and below that price at the selected hour.
- Show the live BTC price, selected settlement hour, countdown, required move, one-hour BUY/MID/SELL levels, volume, trend alignment, and data freshness.
- Add a strict, frozen **Model pick** for the hour. It locks once per hourly window and does not change with every live tick.
- Add a separate one-hour **Study pick** that observes the opening 10–15 minutes, then locks using trendlines, BUY/MID/SELL position, volume, volatility, and multi-timeframe candles.
- Show Model/Study agreement clearly. When they disagree or trendline confirmation is missing, display a skip/caution state rather than presenting false conviction.
- Add the one-hour panel beside the existing trendline section. Default the ladder around the active hourly level, including targets such as $77,700.
- Keep this prediction read-only and shadow-only. It will not place or change paper or live orders.

## Validation
- Backtest target-by-target probabilities and locked Model/Study results against stored hourly and one-minute candles without future-data leakage.
- Measure calibration by probability band, target distance, Model/Study agreement, and trendline position before considering any trading use.
- Add focused tests for UP, DOWN, near-target, probability ordering across ladder rows, frozen locks, stale data, and insufficient data.
- Verify the Crypto page renders and updates without slowing the existing live spot, Model, Study, trendline, or API paths.

## Technical details
- Reuse the existing candle cache and live composite BTC spot.
- Generate ladder probabilities from one shared distribution so higher targets can never show a higher “above” probability than lower targets.
- Keep Model and Study calculations independent: Model uses the quantitative one-hour probability calculation; Study uses the opening observation period and trendline evidence.
- Keep all new one-hour logic and display code isolated from the 15-minute prediction and execution files.
- Report calibration honestly; historical coverage is roughly two months of hourly candles and seven days of minute candles.
