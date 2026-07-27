# Our-Odds Pill (UP / DOWN) — beat Kalshi on latency

A compact pill in the TrendlineChartPanel header that shows our own live UP/DOWN probability for the current 15m window, in the same visual style as the Kalshi Buy/Sell box in the reference screenshot. Purely presentational — no changes to Model Pick, Study Pick, Cheap Flip Hunter, or any auto-trade path.

## What the user sees

Small dark pill, right next to the existing `Kalshi $X vs ours $Y` and countdown badges:

```text
[  UP  -184   |   DOWN  +142  ]   Δ vs Kalshi: UP +3.1%
```

- Left half highlighted green when UP is our favorite; right half highlighted red when DOWN is.
- American-odds style number (matches the screenshot: `-191 / +158`) computed from our probability.
- Small "Δ vs Kalshi" chip: how much our UP prob differs from Kalshi's UP mid. Green when our edge is positive, muted when within ±1%.
- Updates on the same 1s cadence as the live composite price (no flicker — same rAF pattern already in use for the countdown).

## How our probability is computed (fast, no model changes)

A lightweight closed-form estimate that uses only signals we already fetch client-side, so it can update every second and stays faster than Kalshi:

1. Take live composite spot `S` (already streaming at 50ms via `useLiveCompositeSpot`).
2. Take strike `K` and `secondsToClose T` from the existing Kalshi query.
3. Take short-horizon realized vol `sigma` from the 1m candles we already load for the trendline chart (log-returns over the last ~30 minutes, annualized only for consistency).
4. Compute Black-Scholes-style up probability under a driftless GBM:
   `P_up = Phi( ln(S/K) / (sigma * sqrt(T/YEAR)) )`
   Clamp `T` to a small floor (e.g. 5s) to avoid blowups in the last seconds.
5. Convert to American odds for display:
   - favorite (`p >= 0.5`): `-round(100 * p / (1 - p))`
   - underdog: `+round(100 * (1 - p) / p)`

This is intentionally simple — the goal is a fast, always-on odds readout, not a new model. The heavy model logic (Study, Fight window, TA v2, trendlines) stays exactly where it is.

## Files touched (frontend only)

- `src/lib/ourOdds.ts` (new, pure functions):
  - `computeUpProbability({ spot, strike, secondsToClose, sigmaAnnualized })`
  - `toAmericanOdds(prob)`
  - `realizedVolFromCloses(closes: number[])`
- `src/components/crypto/OurOddsPill.tsx` (new):
  - Reads `useLiveCompositeSpot`, existing `kalshi` query result, and the 1m candle array already computed in `TrendlineChartPanel`.
  - Renders the pill + `Δ vs Kalshi` chip. Uses design tokens (no hardcoded colors).
- `src/components/crypto/TrendlineChartPanel.tsx`:
  - Mount `<OurOddsPill />` in the header row next to the Kalshi badge / countdown.
  - Pass the 1m closes down as a prop (they are already fetched here).

No DB changes. No server functions. No changes to `cryptoBtc.functions.ts`, `bigFlipDetector.functions.ts`, or any auto-trade code.

## Out of scope (explicitly not touched)

- Model Pick / Study Pick / Fight window logic
- Cheap Flip Hunter, PRED, Green Hours paper trading
- Auto-trade gates and settlement pipelines
- Any migration or shadow logging (can be added later if you want to backtest our-odds vs Kalshi)

## Follow-ups you may want after seeing it live

- Shadow-log `(t, our_p_up, kalshi_p_up, settled_side)` to measure whether our odds lead Kalshi's — I will not build this until you ask.
- Add a small sparkline of our UP prob over the last 60s.
