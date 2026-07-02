# AI Odds Study → live trade auto-apply

## What it does

1. **New AI study loop** dedicated to the odds panel. Every hour (piggyback on existing `crypto-study` cron), for each user with ≥30 new `auto_odds_study_log` rows, run Gemini on:
   - Aggregated stats (flip rate, alignment %, per-bucket)
   - Last 100 raw snapshots
   - Last 50 settled auto-odds trades (win/loss + entry odds + which exit fired)
   - Prior tunings applied and their post-apply win rate

2. **LLM returns structured JSON** with two blocks:
   - `findings` — 2-3 sentence summary + flip zones + price↔odds observations (shown in panel)
   - `tunings` — array of proposed parameter changes, each with `param`, `current`, `suggested`, `rationale`, `confidence` (0-1)

3. **Auto-apply gate** — a tuning is applied to live trades ONLY if:
   - `confidence >= 0.7`
   - Suggested value is inside a hard-coded safe range (see Safety Caps below)
   - Change from current is ≤ the per-param max delta
   - User has `auto_apply_studies = true` in `auto_odds_settings` (default OFF — user must opt in)
   
   Otherwise the tuning is stored as "proposed" and shown in the panel with an **Apply** button.

## Tunable parameters (whitelist)

Only these can be touched. Everything else in `auto-odds-tick.ts` is off-limits.

| Param | Current | Safe range | Max Δ/study |
|---|---|---|---|
| `model_gate_min` | 0.60 | 0.55–0.75 | ±0.03 |
| `hedge_band_lo` | 0.60 | 0.55–0.65 | ±0.02 |
| `hedge_band_hi` | 0.68 | 0.63–0.75 | ±0.02 |
| `tp_cents` | 98 | 95–99 | ±1 |
| `oscillation_max` | 3 | 2–5 | ±1 |
| `skip_bucket_lt15s` | false | bool | — |
| `skip_bucket_15_60s` | false | bool | — |

**Never tunable by LLM**: daily loss cap, 2-loss stop, entry size ($100), hedge size ($5), -450/-750 entry band, 2s persistence check.

## Data model

- Add columns to `auto_odds_settings`: `auto_apply_studies bool default false`, plus the 7 tunables above (nullable — null = use hardcoded default).
- New table `auto_odds_studies` (user_id, summary, findings jsonb, tunings jsonb, applied_tunings jsonb, model, raw jsonb, created_at). RLS user-scoped.
- `auto-odds-tick.ts` reads each tunable via `settings.<name> ?? DEFAULT` at the top of the loop.

## UI additions to OddsStudyPanel

- **Run AI Study Now** button (manual trigger, throttled 5min)
- **Latest study card**: summary, findings, tunings table with confidence bars
- **Auto-apply toggle** with warning: "AI can adjust gates within safe caps. Never disables loss stops or entry sizes."
- **Applied tunings log**: last 10 changes with revert button (single click restores prior value)

## Safety / reversibility

- Every applied tuning writes an audit row with `prev_value` and `new_value`. Revert = write prev_value back.
- If user's daily P&L is worse post-apply than a rolling 3-study baseline, the auto-apply toggle **auto-disables itself** and toasts the user.
- Hard block: LLM output that proposes a value outside the safe range is silently ignored (logged, not applied, not shown as pending).

## Files

- Migration: extend `auto_odds_settings`, create `auto_odds_studies` + `auto_odds_tuning_audit`
- New: `src/lib/oddsStudy.functions.ts` (`runOddsStudy` server fn, `applyTuning`, `revertTuning`, `getLatestOddsStudy`)
- Edit: `src/routes/api/public/hooks/crypto-study.ts` — add per-user odds-study branch
- Edit: `src/routes/api/public/hooks/auto-odds-tick.ts` — read tunables from settings with fallbacks
- Edit: `src/components/crypto/OddsStudyPanel.tsx` — add study card + toggle + tuning list
