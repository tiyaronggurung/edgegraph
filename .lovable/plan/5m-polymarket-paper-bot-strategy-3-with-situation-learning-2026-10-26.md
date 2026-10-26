# 5m Polymarket Paper Bot ("Strategy 3") with situation learning

Paper only. No real orders. Polymarket trading APIs and real money come later, behind a separate switch you turn on yourself.

## What the bot does each 5-minute window
1. **Entry**: after the first 45s, and before 3:30 has passed, if our 5m UP or DOWN odds are at least 65% and Polymarket's price for that side is at least 5¢ cheaper than our odds, it paper-buys that side at Polymarket's real ask. $10 flat, or the amount you choose.
2. **Take profit**: sell if Polymarket's bid for our side reaches 88¢.
3. **Rescue hedge**: if our odds for the held side fall to 38% or lower and the other side's ask is 50¢ or less, buy the same number of contracts on the other side. This caps the loss.
4. **Settle**: at window close, use Polymarket's official outcome. If that's missing, compare the close price to the strike.
5. One entry per window. Odds freeze for the last 15s, same as the 15m rule.

## How it learns ("where are we better than Polymarket?")
Every window, entered or skipped, gets recorded as a **situation**, using these buckets:
- our conviction (65–70, 70–80, 80+)
- our edge vs Polymarket (5–10¢, 10–20¢, 20¢+)
- time into the window (early or mid)
- taker flow agrees or disagrees
- area leader agrees or disagrees
- volatility (calm or fast)

For each situation the bot keeps running wins, losses and P&L, including the skipped windows it would have traded. That gives it **shadow results** too.

**Learning rule**: once a situation has at least 20 results:
- If its smoothed win rate doesn't beat the price paid (after fees), the bot stops trading it ("blocked").
- If it clearly beats the price, the bot keeps trading it.
- Blocked situations keep collecting shadow results, so they can earn their way back.

No black-box AI. The rules stay readable and you can see them all on screen.

## On screen (the 5m Polymarket tab)
- Bot on/off switch (off by default), stake, today's paper P&L and win rate.
- Live status: waiting, holding UP @ 61¢, took profit, rescued, or settled.
- Trade log for the last 50 windows.
- **Situation table**: each bucket's trades, win %, average price paid, P&L, and whether it's allowed or blocked.

## Guarantees
- 15m odds, Option A/B/C, Model, Study and live engines are not touched.
- The 5m odds math is the same shared core, with no copy made for the server.
- Paper tables are separate. The daily loss stop doesn't apply to paper.

## Technical details
- New pure helpers in `src/lib/poly5mBot/`:
  - `decide.ts`: entry, take-profit and rescue rules
  - `situation.ts`: bucket key
  - `learn.ts`: Beta-smoothed win rate compared with break-even price after fees
  - plus unit tests for the 65%, 88¢, 38%/50¢ and 20-sample rules
- A server recorder runs on a 10s cron (`/api/public/hooks/poly5m-bot-tick`, verified with `verifyCronRequest`). It builds the 5m context from stored candles and spot ticks, calls `computeStrikeOdds` with T = seconds left, and reads the strike plus bid/ask from the existing `polymarket5m.functions` fetch logic, moved into a shared server module.
- Tables (RLS on; admin-only reads):
  - `p5_settings`: enabled, stake
  - `p5_windows`: odds snapshots, strike, outcome
  - `p5_positions`: legs, costs, result, P&L, situation key
  - `p5_situations`: aggregated stats, allowed flag
- UI: a `Poly5mBotPanel` under the existing `Odds5mPanel`, polling every 5s.
- AGENTS.md rule: the 5m paper bot is isolated and reuses `computeStrikeOdds`. Memory gets the 65/88/38 thresholds and the learning rule.

## Open question before building
Default stake: $10 flat, matching your auto-trade rule, unless you want $150 like Quad.
