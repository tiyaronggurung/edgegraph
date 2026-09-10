# Hourly BTC Forecast v2

## Goal
Improve the read-only 1-hour BTC ABOVE and BELOW probabilities using signals already available in this project, without changing any 15-minute prediction, Ops, order, hedge, or trading logic.

## Build
- Upgrade the hourly probability engine from `h1-diffusion-v1` to a new version while keeping the frozen hourly Model pick and 15-minute Study lock.
- Add trendline channel position, channel width, upper/lower slope, wedge direction, and confirmed spike/breakout strength to the probability calculation.
- Add the existing chart score inputs: EMA alignment, VWAP position/rejection, MACD direction and acceleration, RSI, Bollinger position/squeeze, candle strength, and 1m/5m structure.
- Replace the single volatility estimate with a short/medium blend from 1m, 5m, 15m, and 1h candles, including separate upside and downside realized movement.
- Adjust every ladder target independently for nearby BUY/SELL barriers so targets beyond resistance or support receive lower probability.
- Use volume participation as confirmation rather than displaying it only.
- Keep probabilities monotonic across targets and complementary: ABOVE + BELOW = 100%.

## Screen
- Show the v2 signal strength, channel position, trend alignment, breakout state, and directional expected moves.
- Show separate confirmed recommendations for the strongest credible ABOVE and BELOW targets.
- Require frozen Model, locked Study, MID/VWAP direction, and minimum probability for a confirmed recommendation; otherwise show WAIT.

## Tracking and validation
- Record the added v2 inputs inside each hourly snapshot without changing existing 15-minute tables.
- Extend the hourly scorecard to compare v1-style direction, v2 confirmation, volatility regime, ABOVE reliability, and BELOW reliability.
- Keep historical calibration informational until enough settled hourly samples exist; do not falsely label an unproven percentage as reliable.
- Add focused tests for monotonic probabilities, ABOVE/BELOW complementarity, directional volatility, resistance/support penalties, frozen picks, and no regression to existing hourly behavior.

## Safety boundaries
- No changes to the 15-minute model, Study lock, trendline page, Ops page, public trading APIs, paper trading, or live trading.
- No AI calls or blocking work in real-time paths.
- Hourly forecast remains read-only.
