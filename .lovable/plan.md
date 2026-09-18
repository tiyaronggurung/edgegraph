# Cheap Entry — real money instead of paper

Right now the Cheap Entry engine buys $10 in paper money. This switches it to placing real Kalshi orders through the same path the Study auto-bet already uses.

## How it will work

- The Cheap Entry card gets a **Live (real money)** switch, separate from the existing on/off switch.
- With Live on, every qualifying window places a real $10 Kalshi buy instead of a paper fill. With Live off, it stays paper exactly as today.
- Everything else is unchanged: study side once locked, model side inside the last 8 minutes, only when the price is between 20¢ and 65¢, never inside the last minute, strictly one buy per window, and only windows that start after you flipped it on.
- If your Kalshi keys are missing, it refuses to buy and logs the reason instead of silently falling back to paper.
- Real fills show in the card's table with a "LIVE" marker and real profit/loss; settlement comes from Kalshi itself.

## What you should know

- Real money moves without you clicking anything, roughly once every 15 minutes when the price qualifies. At $10 a window that can be up to ~$960/day of stake turning over.
- The backtest behind this rule (+$1,673 over 1,497 bets) assumed you could buy at the logged prices; real fills can be worse.
- Keep the stake box at $10 unless you deliberately raise it.

## Technical notes

- Migration: `profiles.cheap_entry_live_enabled boolean not null default false`.
- `cheapEntryAutoBet.server.ts`: per-user branch — live users go through `submitKalshiBuy` (from `cryptoTrades.functions`) with `inputs_snapshot.source = 'cheap_entry'`; idempotency checks both `crypto_trades` and `paper_fills` markers so a window can never be bought twice.
- `cheapEntryAutoBet.functions.ts`: `setCheapEntryLive`, and stats merge live `crypto_trades` rows with paper `paper_fills` rows.
- `CheapEntryAutoBetPanel.tsx`: the Live switch, a red "REAL MONEY" badge when on, and a LIVE/PAPER column in the table.
- Untouched: Study auto-bet, model, Study lock, trendlines, exits, ladder/manual paths.
