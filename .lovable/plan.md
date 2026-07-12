# BTC 15m Model Accuracy Roadmap

Do not change trading gates, recovery sizing, or entry/exit paths during this work. Everything below is either read-only analysis or additive computation that the gates ignore until we explicitly wire it in.

## Guiding principles

- Every proposed change is validated on **out-of-sample settled windows** before it touches decision logic.
- Raw `modelYesProb` and its unblended intermediates are preserved so we can always answer "does the model have independent skill vs. is it copying Kalshi?"
- No fragmenting 1,001 rows into empty buckets. Monotonic calibration on a single confidence axis, with time-bucket refinements only where N ≥ threshold.
- Nothing below adjusts gates, staking, martingale, or exits. Phase 1 lands read-only shadows.

## Probability decomposition (foundational — Phase 1)

Store and expose three probabilities per snapshot in `btc_model_predictions`:

| Column | Definition |
|---|---|
| `physics_prob` | Diffusion with σ and drift only — no options, no micro, no market blend, no calibration |
| `independent_prob` | physics + Deribit options + microstructure adjustment. **No Kalshi market price input.** |
| `model_prob` (existing) | The calibrated, potentially market-blended final probability the gates already use |

Purpose: an ablation report can measure whether the model's signal is genuinely independent or leaking from the market. `theory_yes_prob` (already stored) approximates `physics_prob` but includes the options blend — we split them.

## Phase 1 — Jump detection + out-of-sample isotonic calibration

### Phase 1A: Jump detection (shadow only)

**New helper: `src/lib/cryptoJump.ts`**

Pure function taking a rolling buffer of 1s spots for the last 30s. Returns:

```
JumpFeatures {
  ret5s, ret10s, ret15s, ret30s        // signed returns
  move30sAbs                            // |Δspot in 30s| in bps
  expectedMove30sBps                    // σ_perMin * sqrt(0.5) * 1e4
  jumpRatio                             // move30sAbs / expectedMove30sBps
  velocityTowardStrike                  // +bps/s toward strike, − away
  acceleration                          // ret15s_now − ret15s_prev (signed)
  max1sMove, max5sMove                  // largest single-tick and 5s window
  strikeCrossings                       // # times spot crossed strike in 30s
  volExpanding                          // recentSd(15s) > priorSd(15s) * 1.25
  signedMoveTowardSide                  // + = move helps selected side
}
```

**Data source:** we already stream `useBinanceBtcTicks` (~1s cadence) on the client. Server side, we need the same tick buffer accessible where model prob is computed. Cheapest path: keep a rolling 30s ring buffer on the client and pass a compact feature vector alongside `spot` when the market is being scored. Backend option is to persist 1s ticks in Supabase; too much data — skip.

**Where features flow:**

- `src/lib/cryptoBtc.functions.ts` scoring loop (line ~850): after `spot` and before `probAboveCond`, receive `jumpFeatures` optionally attached to the request. When absent → all features null; behavior unchanged.
- Attach `jump_features` JSONB column to `btc_model_predictions` snapshot. (Schema migration below.)

**No decision impact yet.** Phase 1A only writes features to the prediction row.

### Phase 1B: Jump response backtest

Read-only. New server fn `getJumpResponseBacktest` reads all settled predictions with `jump_features IS NOT NULL` and simulates five policies against actual outcomes:

- **A. Skip** — treat as filtered
- **B. Compress toward 0.5** — `p' = 0.5 + (p − 0.5) * (1 − compressFactor(jumpRatio))`
- **C. Inflated σ** — recompute diffusion with `σ_eff = σ * (1 + k*jumpRatio)`, re-blend
- **D. Blend toward market** — `p' = 0.5*p + 0.5*yesAsk`
- **E. Larger edge floor** — keep p, require edge ≥ 8 + f(jumpRatio) pp

Report per policy: Brier, log loss, hit rate, realized $10-flat P/L, eligible-N. Segment by `jumpRatio` band (`<1.0`, `1.0–1.5`, `1.5–2.0`, `>2.0`) and by `sideSigDist` (ahead / behind).

User's preferred starting rule (implementable behind a config flag but disabled until backtest confirms):

```
jumpRatio < 1.0                            → no adjustment
1.0 – 1.5                                  → σ_eff *= 1.15
1.5 – 2.0                                  → σ_eff *= 1.35, EDGE_MIN += 3pp
> 2.0                                      → skip unless
                                              (sideSigDist ≥ +1σ AND
                                               p − ask ≥ EDGE_MIN + 5pp
                                               after recalculation)
```

**Signed movement matters.** A jump *toward* the strike on a YES pick raises risk; a jump *away* toward safety lowers it. Use `signedMoveTowardSide`, never absolute.

### Phase 1C: Out-of-sample isotonic calibration

**Replace:** `correction_factor = actual/predicted` clamped to [0.5, 2.0] per `(time_bucket × sigma_bucket)` in `btc_calibration`.

**With:** an isotonic regression fit that consumes side-locked `model_prob` and outputs a monotonically increasing calibrated probability.

**Training discipline:**

- Split settled rows temporally into folds by **15m market window**. All snapshots of the same ticker stay in the same fold — never train and test on snapshots from the same market.
- Rolling walk-forward: fit on windows closing before time T, evaluate on windows closing after T.
- Global isotonic fit on `(model_prob → won)` first. Per-time-bucket fits only for buckets with N ≥ 200. Below that → fall back to global.
- No confidence-bucket fragmentation. Confidence is the input axis of the single monotonic curve.
- New table `btc_isotonic_fit` stores the pin points of each fit (small: ≤50 rows) with `time_bucket`, `n_train`, `n_test`, `brier_test`, `logloss_test`, `fitted_at`.
- Refit runs in the existing nightly cron (`btc-calibrate.ts`).

**Comparison report:** for each nightly refit, produce a small metrics block:

| Method | Brier (unseen) | Log loss (unseen) | N eligible |
|---|---|---|---|
| Raw model | | | |
| Current bucket correction | | | |
| Global isotonic | | | |
| Time-bucketed isotonic | | | |

Whichever wins on unseen-window Brier + log loss becomes the applied calibrator. Loser stays computed for regression tracking; nothing is deleted.

**Application:** `finalModelProb = isotonic(independent_prob)` on the paths where model prob feeds the gates. The current `applyCalibration` path is preserved and reported side-by-side until we flip the switch.

## Phase 2 — Deribit blend validation (plan only for now)

Do not implement until Phase 1 lands. Design:

- Sweep static weights `[0, 10, 20, 30, 40, 50, 60, 70]%` on the settled log.
- For each weight, compute Brier / log loss / realized EV on unseen windows.
- Then test dynamic weights driven by: options_liquidity, options_bid_ask_spread, options_open_interest, strike_proximity_to_ATM, seconds_to_close, disagreement between diffusion and Deribit, whether Deribit interpolated across distant strikes, and Deribit-feed freshness.
- Deliverable: a report + a single recommended weight function, gated behind a config flag that keeps the current 50/50 blend until reviewed.

## Phase 3 — Cross-exchange features (plan only for now)

Add read-only features derived from Binance + Coinbase feeds:

- `binance_coinbase_mid_diff_bps`
- `mid_diff_z_score_30s`
- `which_exchange_led` (based on which side moved first in the last 30s)
- `divergence_duration_s`
- `binance_ret_30s`, `coinbase_ret_30s`
- `stale_feed_flag_binance`, `stale_feed_flag_coinbase`
- `median_spot` (used only for reporting; not swapped in for spot yet)

Divergence is not automatically treated as directional signal. Only after a historical test shows one exchange consistently leads at 15m horizon do we upgrade any feature to a prob input.

## Phase 4 — Funding rate (deferred)

Do not add until Phase 2 or 3 report shows funding is *independent* of features we already have and adds measurable Brier reduction at 15m. Cheap to add later; expensive to explain away if it just correlates with drift.

## Ablation report (delivered alongside Phase 1)

New read-only panel `ModelAblationPanel` on `/crypto`, feeding from a new server fn. For each variant below, report on unseen settled windows: Brier, log loss, accuracy, calibration by prob band (0–20/20–40/40–60/60–80/80–100), 30s bucket perf, 60s bucket perf, YES vs NO, sigma-distance zones (A/B/C), signed edge vs market, realized $10-flat P/L on actual entry ask, max drawdown, eligible-N.

Variants:

1. Diffusion only
2. Diffusion + drift
3. Diffusion + Deribit
4. Diffusion + microstructure
5. Diffusion + jump features (Phase 1B live)
6. Full model without near-expiry market blend
7. Full model with near-expiry market blend (current)
8. Full model after new isotonic calibration (Phase 1C)

Variants 1–4 and 6–8 are computable from stored intermediates (`physics_prob`, `independent_prob`, `model_prob`) plus rerunning the specific blend/calibrator on the fly. Variant 5 requires jump features to have been captured — starts empty and fills over time.

## Target-leakage audit

The near-expiry blend (`blendNearExpiry` in `cryptoBtc.functions.ts`) pulls `p` toward `yesPrice` in the final 2 min when the model trails on the locked side. This may be improving Brier via **market copying** rather than independent skill. The ablation directly measures this: variant 6 vs variant 7 tells us how much of our accuracy is the blend, and comparing `independent_prob` calibration to `model_prob` calibration on the same rows quantifies leakage.

If independent_prob calibrates as well as model_prob without the blend, the blend is cosmetic and should be removed. Do not touch the blend during Phase 1 — just measure it.

## Backtest design (applies to all phases)

- **Unit of split:** the market window (`ticker`), not the snapshot. A ticker has many snapshots (~15–30 during its life); training and testing on different snapshots of the same ticker leaks near-perfectly.
- **Split strategy:** rolling walk-forward by `close_time`. Train on windows with `close_time < T`, evaluate on windows with `close_time ≥ T`, advance T weekly.
- **Metrics:** Brier score (primary), log loss, hit rate (secondary — deceptive with class imbalance), realized $10-flat P/L on actual entry ask (business-facing), calibration reliability plot.
- **Sample requirement:** any bucketed metric requires N ≥ 30 in the test fold to be reported; otherwise labelled "N too small".
- **Reproducibility:** each backtest run stamps `code_version` (git sha) and `data_cutoff` into its report row so we can regression-track over time.

## Estimated file changes

Phase 1A/1C (implementation on approval):

- `src/lib/cryptoJump.ts` — **new** — pure feature computation, no I/O
- `src/lib/cryptoBtc.functions.ts` — attach optional `jumpFeatures` to market payload, thread into snapshot; expose `physics_prob` and `independent_prob` intermediates
- `src/lib/cryptoPredictions.server.ts` — add three prob columns + `jump_features` JSONB to insert path
- `src/lib/cryptoCalibrator.server.ts` — **rewrite** — isotonic fit, global + per-bucket, walk-forward guard
- `src/routes/api/public/hooks/btc-calibrate.ts` — call new fitter, upsert into `btc_isotonic_fit`, keep old `btc_calibration` populated for comparison
- `src/lib/modelAblation.functions.ts` — **new** — read-only ablation report server fn
- `src/components/crypto/ModelAblationPanel.tsx` — **new** — panel on `/crypto`
- Migration: add `physics_prob`, `independent_prob`, `jump_features` (JSONB) to `btc_model_predictions`; create `btc_isotonic_fit` table with grants + RLS

Phase 1B (jump response backtest, read-only fn):

- `src/lib/jumpBacktest.functions.ts` — **new**
- Attach a tab or subsection to `ModelAblationPanel` for the five-policy comparison

**No changes to:** `modelGates.server.ts`, staking, martingale, exits, or auto-trade flow. Zero decision impact until a follow-up turn wires an approved policy in.

## Success criteria for Phase 1

Before we consider wiring any Phase 1 output into gates:

1. Ablation report renders and has ≥ 200 unseen-window rows per compared variant.
2. Isotonic calibrator beats current bucket correction on Brier by ≥ 0.005 AND on log loss, on the unseen fold, for two consecutive nightly refits.
3. Jump backtest shows one of the five policies has a strictly better Brier + P/L than "no adjustment" on the `jumpRatio ≥ 1.5` slice, with N ≥ 100 in that slice.

Only then do we open a separate change to flip the switch.

## What I'll deliver on approval

Phase 1A + 1C in a single implementation turn, plus the ablation panel scaffold with variants 1–4 and 6–8 wired (variant 5 populates over time as jump features accumulate). Phase 1B backtest fn lands in the same turn as read-only, so we can watch the five policies against the growing settled log without touching gates.

Phases 2 / 3 / 4 stay as spec-only until Phase 1 metrics arrive.

Confirm and I'll start Phase 1.
