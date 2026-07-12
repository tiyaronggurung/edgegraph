
# Model tightening — steps 1–4 (streak, edge, regime, isotonic)

Goal: raise Model-Bet hit rate toward 80% by **filtering out** low-quality signals. All 4 changes are gates that skip trades; nothing changes sizing, buy execution, ladder math, manual close, or public/guest flows.

## Single new file (isolate risk)

`src/lib/modelGates.server.ts` — one exported function `runModelGates({ supabase, userId, market })` returns `{ allow: boolean, skipReason?: string, adjustedProb: number }`.

Everything below lives inside that helper. If we ever want to roll it all back, deleting one call site restores current behavior.

## Where it's called

`src/lib/cryptoAutoTrade.functions.ts`, inside the existing `.filter(...)` chain at **line 384**, added as the **first** check per candidate. If `allow=false` → push skipReason, `logSkip`, return false. Existing gates below it (sigma, momentum, EV, coinflip, etc.) are untouched.

Also updates `m.modelYesProb` for downstream EV math to use the isotonic-adjusted probability (mutate a local copy, not the original object — so no side effects into the fresh recheck at line 448).

## Gate details

### 1. Isotonic recalibration (applied first, feeds gates 2–4)
- Read `btc_calibration` for the current time+sigma bucket.
- `adjustedProb = clamp(rawProb * correction_factor, 0.05, 0.95)`.
- If no calibration row for this bucket → no adjustment (correction_factor = 1).

### 2. Confidence + edge gate
- Compute `marketProb = ask_price` for the side we're betting.
- Require `adjustedProb ≥ 0.72` AND `adjustedProb − marketProb ≥ 0.08`.
- Fail → skip `"conf_edge: prob 0.68 / mkt 0.64 (need ≥0.72 & Δ≥0.08)"`.

### 3. Streak-aware tightening
- Query last 5 settled `auto_trade_orders` for this user, mode=live, ordered by settled_at desc.
- **2 consecutive losses** → raise bar: require `adjustedProb ≥ 0.75` AND entry price ≤ 70¢.
- **3 consecutive losses** → skip entirely for 30 min (checked via most-recent settled_at).
- **3+ consecutive wins** → no change (anti-tilt: don't press).
- Fail → skip `"streak: 2L → need ≥0.75 (have 0.73)"`.

### 4. Regime filter
Uses `btc_odds_tape` (already recorded per user) for last 30 min:
- Compute 1-min returns from tape prices.
- **News spike**: latest 1-min |return| > 3× stdev of prior 5 min → skip `"regime: spike"`.
- **Chop**: realized vol last 5 min < 20th percentile of last 24h (query aggregated) → skip `"regime: chop"`.
- **Round-level proximity**: strike within 15 ticks of nearest $500 multiple AND `adjustedProb < 0.78` → skip `"regime: round-level"`.

If insufficient tape data (<20 rows in window) → gate returns allow=true with note `"regime: warmup"`. Never blocks on missing data.

## What is NOT touched

- Buy execution / order submit (lines 500+)
- Ladder sizing (`stakingConfig.server.ts`, `profitBankLadder.ts`)
- Manual close, IOC ladder, sentiment, chart verdict
- Auto-odds path (`odds_bet` button type) — gate only applies when `autoButtonType === "model_bet"`, checked inside the helper
- Paper mode (`isLive === false`) — gate only runs on live
- Force mode (`data.force === true`) — skipped, as with all other gates
- Public/guest routes
- `martingale_recovery_state` schema and Recovery Bet path

## Rollback

One-line comment-out of the gate call in `cryptoAutoTrade.functions.ts` reverts everything.

## Test plan

1. Build passes.
2. Curl the cron endpoint `POST /api/public/hooks/auto-model-bet-tick` and confirm response is 200 with skipped>0 (expected — gates filter aggressively).
3. Skip log rows show new reasons prefixed with `conf_edge:`, `streak:`, `regime:`.
4. Live PnL flow unchanged (no schema changes).

## Shipping order (one commit each)

1. `modelGates.server.ts` — helper file, unused.
2. Wire into filter chain — behind `autoButtonType === "model_bet"` and `isLive`.
3. Verify a live tick, check skip log.

Ship 1–4 now. Step 5 (multi-timeframe agreement) deferred — needs new 5m model.

**Confirm and I'll start with commit 1.**
