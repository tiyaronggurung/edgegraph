# BTC 15m Operating Manual — admin-only $1k → $100k page

A new admin-only page at `/ops-manual`, linked from the crypto dashboard. Pure control and analytics layer: **no automated execution is wired in**. Everything is decision support, logging, and risk gating.

## Page layout (top to bottom)

1. **Status banner** — Green / Yellow / Orange / Red with trigger time, metric, current value, threshold, action taken, resume conditions, manual-review flag. Red alerts persist until acknowledged; acknowledging never restores trading.
2. **Trade Qualification Card** — permanent BET ONLY IF / STAKE / STOP / SUNDAY / BANK checklist, with each condition live-evaluated against the current 15m window (green tick / red cross).
3. **Staking panel** — morning bankroll, active unit %, dollar stake, bets remaining, consecutive losses, daily P/L, distance to +20% and −20% stops, current mode and the reason for it. Depth-protection warning above ~$40k bankroll (order > 15% of visible book ⇒ flagged "split entry required", never auto-placed).
4. **P/L dashboard** — summary cards (current / morning / all-time-high bankroll, drawdown, today / week / month / all-time P/L, withdrawn, active bankroll, wins, losses, overall + rolling-30 + rolling-100 win rate), session table with every listed column, discipline score, and the full chart set (bankroll curve, drawdown, daily and weekly P/L, rolling win rates, and by-hour / cushion / ask / confidence breakdowns).
5. **Routine backtest panel** — the five windows (last 30 bets, last 100 bets, 7d, 30d, all history), every listed metric, all bucket tables, and the daily backtest status.
6. **Withdrawal tracker** — milestone ladder from $10k, required withdrawal, pending/complete, protected profit, trading bankroll after withdrawal.
7. **Alerts + audit log** — kill-switch events, rule violations, staking-mode changes, threshold-change history.

## Qualification logic (single shared module)

Six conditions, all required: T7 study lock exists · study confidence ≥ 90% · |spot − strike| ≥ $40 · ask ≤ 80¢ · model agrees with study · ≥ 120s left. Excluded UTC hours 01, 04, 11, 18; preferred hours 22, 00, 05, 06, 08, 13, 14 tracked separately. The same module drives the live qualification card and the historical backtest, so they can never drift.

Backtest integrity: reconstruction reads only decision-time fields already stored on each window (`study_t7_*`, `study_lock_*`, model side/prob at snapshot, ask cents at lock, cushion at lock). Settlement fields are used only to grade the outcome, never to decide qualification. Every window stores its pass/fail reason.

## Status and mode rules (as specified, no loosening)

- Healthy ≥ 88% rolling-30 · Watch 82–88% · Risk Reduced < 82% · Kill Switch when rolling-100 < 78% or drawdown > 30%.
- Standard 10% unit (allowed ≥ 82% rolling-30), Risk Reduced 6% (auto below 82%, needs 30 fresh settled bets to exit), Trading Disabled on any kill-switch condition, feed outage/stale tick, Kalshi structure/fee/settlement change, or two rule violations in one week.
- Daily stops: 4 bets, 2 consecutive losses, +20%, −20%, any rule violation, any outage.
- Stake fixed at day open, never recalculated intraday, never increased after a loss.

## Technical section

- **Migration** adds admin-only tables (RLS + GRANTs, admin-scoped via the existing `profiles.is_admin` check): `ops_daily_snapshots`, `ops_trades`, `ops_window_evaluations`, `ops_alerts`, `ops_rule_violations`, `ops_mode_changes`, `ops_withdrawals`, `ops_backtest_runs`, `ops_threshold_changes`. Decision snapshots stored as jsonb and never overwritten after settlement.
- **`src/lib/opsManual/rules.ts`** — pure, unit-tested qualification, bucketing, status, staking-mode and discipline-score functions. No I/O.
- **`src/lib/opsManual/opsManual.functions.ts`** — auth'd server fns: run backtest, read dashboards, open the trading day, log a trade, acknowledge an alert, record a withdrawal, change a threshold (versioned with old value, new value, timestamp, actor, reason).
- **`src/routes/api/public/hooks/ops-daily-backtest.ts`** + a pg_cron job — one run per day after prior-day windows settle; writes a row into `ops_backtest_runs`.
- **`src/routes/_authenticated/ops-manual.tsx`** + panels under `src/components/ops/`. Admin gate mirrors the existing `/admin` page.
- Nav entry and a link from the crypto page.
- Nothing in `cryptoAutoTrade`, `studyAutoLive`, the study-lock path, or any existing execution code is modified.

## Explicitly out of scope

No auto-execution, no stake changes to existing auto-trade paths, no edits to current gates or thresholds.
