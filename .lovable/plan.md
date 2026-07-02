
# Server-Side Auto-Odds Trading

Goal: Auto-Odds keeps trading even when your computer is off / browser closed / you're logged out. Driven by a pg_cron job every minute hitting a server route that runs one strategy tick.

## Scope (what moves, what stays)

**Moves to server:**
- Auto-Odds entry loop (place Odds-Bet order when conditions hit)
- Whipsaw exit watcher (5s → 60s cadence, market-sell tagged orders)
- 2-consecutive-loss auto-stop
- All state that lives in `localStorage` today (`crypto.autoOdds.oids`, `crypto.autoOdds.ids`, `crypto.autoOdds.processedSettles`, loss counter, on/off flag)

**Stays client-side (untouched):**
- Martingale auto (per your earlier "Auto-Odds only" scoping)
- Manual buy / sell / ladder / close
- Chart rendering, UI toggles, guest flows
- Sentiment gate + chart gate defaults (still OFF)

## New DB tables

```text
auto_odds_settings          -- one row per user
  user_id (PK, FK profiles)
  enabled boolean            -- server-side on/off (mirrors the UI button)
  consecutive_losses int
  stopped_reason text        -- "two_losses" | null
  updated_at

auto_odds_tracked_orders    -- replaces localStorage oids/ids
  id (PK)
  user_id
  order_id (FK auto_trade_orders)
  entry_side, entry_odds
  whipsaw_armed boolean      -- swung ≥200 away yet?
  processed_settle boolean   -- counted toward loss stop yet?
  created_at
```

Both tables: RLS on, `authenticated` can select/update own rows, `service_role` full. GRANTs included.

## New server route

`src/routes/api/public/hooks/auto-odds-tick.ts` — POST handler, called every minute by pg_cron.

Per tick, for each user with `enabled = true`:
1. **Entry check** — same conditions as current client `runOddsBet` (uses `auto_button` type, gates, safety caps). Places order via existing `cryptoTrades.functions` code paths, inserts a row into `auto_odds_tracked_orders`.
2. **Whipsaw exit** — for each tracked order still open: read current American odds; once it swings ≥200 from entry then returns within ±50, market-sell it (existing `sellOddsBetOrder` logic, extracted to a shared helper).
3. **Loss stop** — for each tracked order newly settled_loss and not yet processed: increment `consecutive_losses`, mark processed. If it reaches 2, set `enabled = false`, `stopped_reason = 'two_losses'`.
4. **Reset losses** on any settled_win.

Auth: pg_cron calls with `apikey` header (anon key). Route is under `/api/public/*` so it bypasses site auth. Handler is idempotent (safe if cron fires twice).

## Extract shared logic

Today's client effect and `runOddsBet` / `sellOddsBetOrder` share logic. Move the pure decision + Kalshi-order code into `src/lib/autoOdds.server.ts` (server-only helpers). Both the tick route and existing server fns call it — no duplication.

## Client changes (minimal)

`src/routes/_authenticated/crypto.tsx`:
- Auto-Odds button now writes `enabled` to `auto_odds_settings` (server-of-record) instead of just React state
- Existing client-side effects (entry, whipsaw, 2-loss stop) gated by a new flag `runOddsClientSide` — default **off** now that server owns it. Left in code as a fallback in case you want it back.
- Loss-stop toast still shows client-side by subscribing to `auto_odds_settings` row changes (realtime).

Martingale, ladder, manual paths: untouched.

## pg_cron job

```sql
select cron.schedule(
  'auto-odds-tick',
  '* * * * *',                                    -- every minute
  $$ select net.http_post(
       url:='https://project--921f21f3-4144-4400-a0a1-781603e22b1b.lovable.app/api/public/hooks/auto-odds-tick',
       headers:='{"Content-Type":"application/json","apikey":"<anon>"}'::jsonb,
       body:='{}'::jsonb
     ); $$
);
```

Whipsaw watcher runs inside the same tick (once/minute, not 5s). If you want sub-minute reaction, we'd need a separate `*/10 * * * * *` schedule — Postgres cron does minute granularity only, so true sub-minute needs an external scheduler. Recommend: start with 1-minute; upgrade later if whipsaw exits feel slow.

## Trade-offs / things to confirm

1. **Whipsaw cadence drops from 5s → 60s.** OK, or is faster required? (Faster = external scheduler, more work.)
2. **Kalshi credentials** — already in secrets (`KALSHI_API_KEY_ID`, `KALSHI_PRIVATE_KEY_PEM`). Server tick uses them directly; no user session needed.
3. **Kill switch** — the Auto-Odds UI button remains authoritative; toggling it off writes `enabled=false` and the next tick stops. No stale trades.
4. **First run** — after deploy, existing localStorage-tagged orders won't be tracked server-side. New tracked orders start clean. Acceptable?

## Files touched

- migration: new tables + GRANTs + RLS
- new: `src/lib/autoOdds.server.ts` (shared strategy)
- new: `src/routes/api/public/hooks/auto-odds-tick.ts`
- edit: `src/routes/_authenticated/crypto.tsx` (button writes DB, effects gated off)
- edit: `src/lib/cryptoAutoTrade.functions.ts` (small: expose helper the shared server module needs)
- pg_cron schedule via supabase insert tool

**Confirm to proceed, or tell me which trade-off to change (especially whipsaw cadence).**
