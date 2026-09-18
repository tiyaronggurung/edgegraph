# Cheap-entry auto bets: study any-time + model fallback

## One thing you need to know first

The +$1,479 number from "study pick, any time it hits 65¢ or below" cannot be earned going forward as-is.

That backtest buys the first cheap moment anywhere in the 15-minute window — including minutes 1-7, **before the study pick is known**. Live, we don't know the side yet at that point. That's why the honest version of the same rule (buy after the lock) drops to +$37 over 65 bets.

So the buildable version is:

- **Study side, cheap, any time after the lock** — not just the one second at lock (that's what runs today, and it misses windows that only get cheap later).
- **Model side, 20-65¢** — only on windows with no study pick. +$194 over 1,206 bets in the backtest.

## What gets built

A **new, separate engine** running in **paper mode** — it does not touch the existing live Study auto-bet path at all.

Rules per open 15-minute BTC window, checked every 20 seconds:

1. Window has a study pick → target that side. From lock time until T-60s, buy $10 the first moment the ask is between 20¢ and 65¢.
2. Window has no study pick and is inside T-8min → target the model side. Buy $10 the first moment the ask is between 20¢ and 65¢.
3. One buy per window, ever. Never buys under 20¢ (those fills aren't real). Never buys inside the last 60 seconds.

Everything lands in paper fills tagged `cheap_entry`, settled by the existing paper settlement, so it builds a real forward sample side by side with the backtest claim.

## New panel on /crypto

"Cheap Entry Auto-Bet (paper)" showing: on/off switch, stake, today's fires, entry price, side, source (study or model), win/loss, running net. Plus the skip reasons so you can see why a window didn't qualify.

## Going live later

The engine writes through one function. When the forward sample agrees with the backtest, flipping it to real Kalshi orders is a one-line swap to the existing `submitKalshiBuy` path — and only after you say so.

## Technical notes

- `src/lib/cheapEntryAutoBet.server.ts` — core: window scan, price gate, idempotency via `paper_fills` marker `entry_snapshot->>source = 'cheap_entry'`, per-user stake.
- `src/lib/cheapEntryAutoBet.functions.ts` — auth'd server fns: settings get/set, stats.
- `src/routes/api/public/hooks/cheap-entry-tick.ts` — cron endpoint (cron secret), scheduled every 20s.
- `src/components/crypto/CheapEntryAutoBetPanel.tsx` — the panel, added to /crypto.
- Migration: `profiles.cheap_entry_enabled boolean default false`, `profiles.cheap_entry_stake_cents int default 1000`.
- Nothing in `studyAutoLive.server.ts`, `chipStudyPick.functions.ts`, the model, Study lock, trendlines or exit paths is modified.
