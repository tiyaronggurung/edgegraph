
# Model Study — closing the learning loop

Three layers, staged so nothing risks live trading until you've seen it work in shadow first.

## Part A — Vote on recommendations (small)

The `crypto_study_feedback` table and `setRecommendationFeedback` server fn already exist. What's missing is the UI.

- Add 👍 / 👎 buttons next to each recommendation in `ModelStudyPanel`.
- Vote is persisted per (study, recIndex). Existing vote highlights.
- `studyMissesWithAI` already reads prior votes and passes them to Gemini as "favor up-voted, avoid down-voted" — so voting immediately makes the next study smarter. No backend work needed for A.

## Part B — Shadow-mode gate simulator (medium)

For every settled trade (win or loss), replay each gate against the captured `inputs_snapshot` and record whether it *would have* blocked the trade. This gives hard numbers, not LLM opinions.

New table `crypto_gate_shadow_sim`:
- `trade_id`, `gate_name`, `threshold` (jsonb), `would_have_blocked` (bool), `pnl_saved` (numeric, positive if blocking would've avoided loss, negative if it would've killed a win).

Gates simulated (each already logged in `inputs_snapshot`):
- `candleGate` at strict / lenient
- `trendlineGate` at strict / lenient
- `sigmaMin` at 1.0 / 1.5 / 2.0 / 2.5
- `verdictMin` at 55 / 60 / 65 / 70
- `edgeMin` at 2 / 3 / 5
- `roundLevelGate` (already exists as helper)

Simulation runs:
- On demand from the panel ("Recompute shadow sim").
- Automatically inside `diagnoseRecentMisses` when a new miss is added.

Panel shows a table:

```text
Gate                Would've blocked   Losses saved   Wins killed   Net $
candleGate=strict          14 / 32         $612           $180        +432
verdictMin>=65             11 / 32         $488            $95        +393
sigmaMin>=2.0               7 / 32         $301            $60        +241
...
```

Sorted by net dollars. Green = would help, red = would hurt.

## Part C — Auto-apply learned rules (careful, opt-in)

**This is the part that changes live trading behavior. Everything here is off by default and requires an explicit user toggle.**

New table `crypto_learned_gates`:
- `gate_name`, `threshold` (jsonb), `enabled` (bool), `source` ("shadow_sim" | "study" | "manual"), `min_samples`, `evidence` (jsonb with sim stats), `applied_at`, `disabled_at`.

Auto-apply rule (only when the user has flipped "Enable auto-learning" on):

A gate becomes eligible for auto-apply when ALL of these are true:
1. Shadow sim has ≥ 30 samples for that gate at that threshold.
2. Net dollars saved > 0 across the sample.
3. Losses saved / (wins killed + 1) ≥ 2 (double-benefit floor).
4. If the gate was also up-voted in a study, weight raised. If down-voted, blocked.

When eligible, it's written to `crypto_learned_gates` and the live auto-trade path reads it and applies the threshold as an *additional* filter on top of your manual gate settings. Never *loosens* an existing gate — only tightens.

Auto-learning has a **kill switch** in the panel: one click reverts all learned gates to disabled without touching your manual settings.

Live path change — one place only:
- `runAutoTrade` in `cryptoAutoTrade.functions.ts` already evaluates each candidate market through gates. Add a single call after the existing gate stack: `applyLearnedGates(candidate)` which reads active `crypto_learned_gates` rows and skips the trade if any tighten-only learned gate rejects.
- Every skip is logged to `auto_trade_skip_log` with `reason = "learned_<gate>"` so you can see it working.

## Rollout order

1. Ship **A** immediately (UI only, zero live-trade risk). Vote on the misses we already have.
2. Ship **B** next migration. Recompute for existing 23 misses + 9 wins. Read the table for a few days. **Nothing changes in live trading.**
3. Ship **C** last, with the user toggle **off** by default. When you turn it on, learned gates start applying only after they cross the eligibility bar (min 30 samples, net positive, double-benefit floor).

## Files

- Migration: `crypto_gate_shadow_sim`, `crypto_learned_gates` (both with GRANTs + RLS).
- New: `src/lib/cryptoShadowSim.functions.ts` — `recomputeShadowSim`, `getShadowSimReport`, and a pure `simulateGates(trade)` helper.
- New: `src/lib/cryptoLearnedGates.functions.ts` — `refreshLearnedGates` (evaluates eligibility), `getLearnedGates`, `toggleAutoLearning`, `revertLearnedGates`.
- Edit: `src/lib/cryptoMisses.functions.ts` — call `simulateGates` inside `diagnoseRecentMisses` for new misses.
- Edit: `src/lib/cryptoAutoTrade.functions.ts` — one hook after existing gates, reading learned rules.
- Edit: `src/routes/_authenticated/crypto.tsx` — expand `ModelStudyPanel` with vote buttons, shadow-sim table, learned-gates panel, and the auto-learning toggle + kill switch.

## Non-goals / guardrails

- Never loosens a gate — learned rules only skip trades, never allow ones you'd have skipped.
- Never touches auto-trade sizing, cash-out logic, buy/ladder/manual-close paths, or your $500/$150 caps.
- Never modifies the auto-trade gate defaults you set (chart gate OFF, sentiment gate OFF stay OFF).
- Kill switch reverts learned gates without touching your manual settings.

## Approval to proceed

Two things to confirm:

1. Ship A + B in one pass, then C in a second pass after you've eyeballed the shadow-sim numbers? (Recommended.) Or all three at once?
2. The auto-apply eligibility bar — min 30 samples, net-positive dollars, 2:1 losses-saved-to-wins-killed. OK to start with those, or want stricter?
