# Scalp Shadow Log

Goal: measure real hit rate of the two scalp setups we spotted in `btc_odds_tape`, **without** touching auto-trade, buy/ladder, exits, or any live path.

## Guarantees (what will NOT change)

- No changes to `auto_trade_orders`, exit logic, buy path, ladder path, manual close.
- No new gates, no new blocking checks anywhere in the live flow.
- No changes to existing settings tables or their defaults.
- Auto-odds stake stays $100 flat. Auto-trade gates stay OFF as configured.
- Purely a read-side observer on data we already collect in `btc_odds_tape`.

## What gets built

### 1. New table `auto_odds_scalp_shadow` (isolated)

Records hypothetical entries + outcomes. Nothing reads it except the review UI.

```
id, user_id, ticker, strike, setup_kind ('compression' | 'cliff'),
entry_side ('YES' | 'NO'), entry_cents, entry_spot, entry_dist_to_strike,
seconds_to_close_at_entry, entered_at,
exit_cents, exit_reason ('mean_revert' | 'strike_cross' | 'time_stop' | 'settled'),
exit_spot, exited_at, pnl_cents, settled_yes (bool),
created_at
```

RLS: user reads/inserts their own rows only. GRANT to `authenticated` + `service_role`.

### 2. New server function `evaluateScalpShadow` (`src/lib/scalpShadow.functions.ts`)

- Runs on the same cadence as the odds tape snapshot (piggy-backs — no new cron).
- Reads the last ~60s of `btc_odds_tape` for the active ticker.
- Detects entries:
  - **Cliff**: YES ≤ 12¢ or ≥ 88¢, |spot−strike| ≤ $250, seconds_to_close > 240.
  - **Compression**: |spot−strike| ≤ $100, seconds_to_close between 60 and 300, |Δyes_cents over last 60s| ≥ 15.
- Opens one open shadow row per (ticker, setup_kind) at most.
- Manages exits on later ticks:
  - Mean revert to fair (spot-implied prob within 5¢) → close.
  - Strike cross in our favor → close at current mid.
  - Time stop at seconds_to_close ≤ 60 → close at current mid.
  - Market settled → close at 100/0.

### 3. Wire it in (one call, additive)

The existing odds-tape snapshot server function gets a single extra line at the end:

```ts
await evaluateScalpShadow({ data: { ticker } }).catch(() => {}); // shadow only, never blocks
```

Failures are swallowed so nothing upstream is affected.

### 4. Small review UI on `/crypto`

New collapsed panel "Scalp shadow" showing:
- Open shadow positions (setup, side, entry¢, current mid¢, unrealized).
- Last 20 closed shadow trades with pnl_cents and exit_reason.
- Hit rate + avg pnl by setup_kind.

Does not touch any existing panel or component.

## Technical notes

- Migration: `CREATE TABLE` + GRANTs + `ENABLE RLS` + policies in one file.
- Server function uses `requireSupabaseAuth`.
- No new secrets, no new connectors, no edge functions.
- No changes to `auto_odds_settings`, `auto_odds_staking_config`, `auto_trade_*`.

## Rollout

1. Migration + server function + hook-in line.
2. Verify shadow rows accumulate on `/crypto` for the current 15m window.
3. Let it run 20-40 windows; review hit rate before we even discuss going live.

Nothing in step 3's output changes code by itself — going live would be a separate approved change.