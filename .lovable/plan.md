# Phase 1B — Jump Features & Five-Policy Backtest

Read-only shadow-data collection. Zero impact on live gates, stakes, exits, calibration, or market blending.

## 1. Schema — new migration

**`btc_spot_ticks`** (rolling ~10–30 min window; logical ring buffer via retention job)

Columns:
- `id bigserial pk`
- `observed_at timestamptz not null` — when we recorded it
- `source_timestamp timestamptz` — exchange-provided ts (nullable if source lacks one)
- `received_at timestamptz not null default now()`
- `latency_ms int` — received_at − source_timestamp
- `spot numeric(14,4) not null`
- `source text not null` — `binance_spot`, `binance_perp`, `coinbase`, etc.
- `volume numeric` nullable
- `aggressor_side text` nullable (`buy`/`sell`, only when the source truly provides it — currently null)
- `bid numeric` nullable
- `ask numeric` nullable

Indexes:
- `(observed_at desc)`
- `(source, observed_at desc)`
- Unique: `(source, source_timestamp)` when source_timestamp is not null (dedupe); otherwise `(source, date_trunc('second', observed_at))`.

RLS: enable; grant `SELECT` to `authenticated`; grant `ALL` to `service_role`. No `anon` grant.

**Retention:** `pg_cron` job every 5 min → `DELETE FROM btc_spot_ticks WHERE observed_at < now() - interval '20 minutes'`. No delete in the scoring path.

## 2. Tick insertion — piggyback existing scoring path

In `src/lib/cryptoBtc.functions.ts`, wherever the current pipeline already fetches BTC spot (existing `spot` value inside the scoring flow), fire-and-forget one insert into `btc_spot_ticks` per fetch. **Zero new external HTTP requests.**

Dedup key: `(source, source_timestamp)` when present, else rounded second. On conflict do nothing.

Concurrency: use `void supabaseAdmin.from(...).insert(...)` — do not `await` inside the hot path.

## 3. Jump feature extractor — new `src/lib/cryptoJumpBuilder.server.ts`

Pure function `buildJumpFeatures({ snapshotTs, strike, sigma, side, ticks })` → structured JSON with an `available` flag and `unavailable_reason`.

Cutoff rule: ONLY use ticks where `observed_at <= snapshotTs`. Include `feature_cutoff_ts = snapshotTs` in the output.

Data-quality gates (set `available: false` and record reason when any fail):
- <20 obs in last 30s
- latest tick age > 3s
- max intra-window gap > 5s
- unordered / invalid source timestamps
- coverage < 80% of requested interval

Emit:
- `returns`: `{r1s, r3s, r5s, r10s, r15s, r30s}`
- `abs_move`: `{5s, 15s, 30s}`
- `expected_move`: `{5s, 15s, 30s}` from snapshot sigma × sqrt(dt)
- `jump_ratio`: `{5s, 15s, 30s}` = abs_move / expected_move
- `realized_vol`: `{5s, 15s, 30s}`
- `vol_expansion_ratio` = rv(last 30s) / rv(prev 30s)
- `acceleration` = velocity(0–15s) − velocity(15–30s)
- `max_1s_move_30s`, `max_5s_move_30s`
- `signed_velocity_toward_strike`
- `strike_crossings`: `{10s, 30s, 60s}`
- `secs_since_last_crossing`
- `pct_time_above_strike_30s`
- `contested` = crossings_30s ≥ 2
- `side_movement`: signed positive when moving in favor of selected YES/NO side
- `quality`: `{obs_count, latest_age_ms, max_gap_ms, coverage_ratio, source_mix, cutoff_ts}`
- `source_quality`: `"primary"` | `"odds_tape_fallback"`

Fallback: if primary <20 obs, read from `btc_odds_tape` (does not mix; tag `source_quality`).

## 4. Wire into prediction snapshots

In `src/lib/cryptoPredictions.server.ts` (or wherever `btc_model_predictions` rows are written today), before insert:
1. Query last 120s of ticks (`observed_at <= snapshotTs AND observed_at > snapshotTs - 120s ORDER BY observed_at ASC LIMIT 500`)
2. Call `buildJumpFeatures(...)`
3. Store result into existing `jump_features jsonb` column (already added in Phase 1A migration)

**No probability change. No gate impact. Featues collected only.**

## 5. Five-policy backtest — `src/lib/jumpBacktest.functions.ts`

Server function `runJumpPolicyBacktest({ from, to, thresholdsA..E })` that reads settled `btc_model_predictions` where `jump_features.available = true` and simulates:

- **A. Baseline** — unchanged prob
- **B. Skip active jumps** — skip when `jump_ratio_15s > τ` AND `contested`
- **C. Probability compression** — `p' = 0.5 + (p − 0.5) × exp(−k·jumpRatio)`
- **D. Sigma inflation (smooth)** — piecewise linear multiplier:
  - `<1.0` → 1.00×
  - `1.0–1.5` → 1.00 → 1.25×
  - `1.5–2.0` → 1.25 → 1.60×
  - `>2.0` → clamp to 2.00×
  - Recompute diffusion prob with inflated σ
- **E. Larger edge floor** — unchanged prob but require `+extraBps` signed edge when `jump_ratio_15s ≥ τ`

For each policy, report per-segment:
- All snapshots · secs-to-close buckets (≤30, 31–60, 61–120) · sigma-distance zones A/B/C · contested vs uncontested · toward/away from strike · YES/NO · trending/chop/news · confidence bands · entry-price bands

Metrics per cell: N predictions, N eligible trades, win rate, Brier, log loss, calibration error, ECE, signed edge, realized $ P/L at $100 flat, ROC%, max drawdown, worst losing streak, avoided wins, avoided losses, **Δ vs baseline**.

### Walk-forward split
- Group by **complete 15m market window identifier** (`ticker + strike + close_time`), NOT by ticker or by snapshot. Every snapshot from one contract stays in the same fold.
- Rolling: train on days ≤ D, evaluate on days D+1..D+k, roll forward.
- Report per-day results plus aggregate. Selection requires improvement on **multiple days**, not one aggregate win.

## 6. Isotonic ablation panel additions

Extend existing `ModelAblationPanel` to compare, side-by-side on the same walk-forward folds:
- Applied Platt (current live)
- Global isotonic
- Time-bucket isotonic (with fallback trigger when N<200)
- Fallback behavior labeled explicitly per cell

Also add a validation assertion that fold split key = `(ticker, strike, close_time)` window id, not just ticker.

## 7. Files touched

New:
- `supabase/migrations/<ts>_btc_spot_ticks.sql` — table, indexes, RLS, grants, pg_cron retention
- `src/lib/cryptoJumpBuilder.server.ts` — pure feature builder
- `src/lib/jumpBacktest.functions.ts` — five-policy walk-forward backtest server fn
- `src/components/crypto/JumpBacktestPanel.tsx` — read-only report UI on `/crypto`

Edited:
- `src/lib/cryptoBtc.functions.ts` — fire-and-forget spot tick insert at existing spot fetch site
- `src/lib/cryptoPredictions.server.ts` — populate `jump_features` on new snapshots
- `src/components/crypto/ModelAblationPanel.tsx` — isotonic comparison rows + fold-split assertion
- `src/routes/_authenticated/crypto.tsx` — mount `JumpBacktestPanel`
- `src/integrations/supabase/types.ts` — regenerated after migration approval

Untouched (explicitly protected):
- All gates, `modelGates.server.ts` thresholds
- Stake sizing, recovery sizing, exit logic
- Applied `applyCalibration` (Platt) path
- Public guest flows
- Auto-trade / auto-odds / manual-close code paths

## 8. Deliverable

After ~1–3 days of tick collection, `JumpBacktestPanel` renders the five-policy segmented table. I'll then recommend one policy for a **shadow-mode** test (still no live gate change) — you approve that separately before anything touches live decisions.

---

**Confirm and I'll ship it in this order:** (1) migration → (2) tick insertion + jump builder + snapshot wiring → (3) backtest fn + panel → (4) isotonic ablation additions.