# Verdict banner + verdict betting + composite flow recording

Three pieces, all new code. Nothing existing (odds engine, Study lock, model, cheap-entry engine, exits, price card internals) is modified beyond adding the banner into the agreement card's render.

## 1. Verdict banner (read-only)

A single banner at the top of the Agreement card that flips between three states:

- **UP** — both average in/out prices above the strike, composite in > out, "now vs avg in" positive, and our odds side has read UP continuously for 10 seconds.
- **DOWN** — the mirror: both averages below the strike, out > in, now vs avg in negative, odds side DOWN for 10 seconds.
- **NO CALL** — anything else, including the mixed case (one average each side of the strike), which the backtest shows is never a buy.

The banner also shows which of the four legs currently pass, so a near-miss is visible before it flips.

Backtested results behind it (settled windows, logged data):
- all legs UP: 85.6% ended UP (215 reads)
- all legs DOWN: 90.7% ended DOWN (54 reads)
- any leg broken: 50–57%, a coin flip
- mixed averages: 19–45% UP — bearish in every slice

## 2. Real-money betting on the verdict

A new engine, completely separate from Cheap Entry, so the two can never fight over a window:

- Fires only when the verdict is UP or DOWN with the 10-second hold satisfied.
- Buys the verdict side at the Kalshi ask, $10 flat stake, one buy per window ever.
- Skips any window already bought by Cheap Entry (checked in the same query), and Cheap Entry likewise skips windows this engine bought.
- Real money only — no paper leg. Own on/off switch, own live switch, both off until you flip them on the card.
- Time guard: no buys inside the last 60 seconds of a window.
- Every skip is logged with its reason so you can see why a window was passed.

## 3. Recording in/out volume and prices per time

A new minute-by-minute recorder writes the composite flow to its own table (`btc_composite_flow_log`), independent of the existing Binance-only flow log:

- per venue: in BTC, out BTC, avg in price, avg out price (Binance + Coinbase; Kraken/Bitstamp totals only)
- composite: in, out, net, imbalance, volume-weighted avg in/out price
- context stamped on every row: window start, seconds to close, spot, strike, and the four verdict legs plus the verdict itself

That last part matters: storing the verdict at the time it was computed is what makes the ongoing backtest exact instead of reconstructed.

## 4. Backtest

- Immediate: re-run the rule against the existing logged windows and report win rate by time-left bucket (this is the source of the numbers above).
- Ongoing: once the new recorder has a day of rows, re-run against stored verdicts including the 10-second odds hold, which is not in today's data, and report the real hit rate plus profit at $10 a window.

## Technical notes

- New: `src/lib/btcVerdict.ts` (pure rule, shared by card and engine), `src/components/crypto/BtcVerdictBanner.tsx`, `src/lib/verdictAutoBet.server.ts` + `.functions.ts`, `src/routes/api/public/hooks/verdict-bet-tick.ts` (pg_cron, 20s), `src/routes/api/public/hooks/composite-flow-writer.ts` (pg_cron, 1m).
- New migration: `btc_composite_flow_log` with GRANTs + RLS, plus verdict-engine columns on `profiles`.
- The banner consumes the already-fetched multi-venue feed and `useStrikeOdds` output; no new client polling on the fast path.
- The 10-second hold is tracked client-side for display and server-side (last two ticks agreeing) for the bet gate.
