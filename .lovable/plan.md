
# 15-min BTC model — accuracy upgrade plan

Goal: boost hit rate on 15-min predictions **without touching** buy/ladder/manual-close/martingale/hard-cap paths. Everything below is additive and defaults **OFF** (opt-in via toolbar toggles + `localStorage`), same pattern as the existing chart/HTF/ETH gates.

Ship in 4 phases. You approve each phase before I move to the next.

---

## Phase 1 — Rolling calibration (safest, highest ROI)

**What:** compute score→win% mapping from the last N=200 settled trades, apply as a threshold shift.

**Where:**
- New: `src/lib/rollingCalibration.functions.ts` — server fn that reads recent trades, buckets by chart-verdict score (0–100 in 10-wide bins), returns `{ binWinRate, shift, sampleSize }`.
- Consumed on `/crypto` via `useQuery` (5-min stale). A `Calibration` badge shows current shift (e.g. `+3 pts, N=187`).
- Chart verdict's final score gets `+ shift` before comparison to the fire threshold. Shift is clamped to ±8 pts so it can't do anything dramatic.

**Toggle:** `Calibrate` (default OFF). When OFF, behavior is identical to today.

**Risk:** near zero — pure post-processing.

---

## Phase 2 — Regime detector + dynamic verdict weights

**What:** classify last 30 min as `trend` / `chop` / `mixed` from ATR + range vs. straight-line move, then reweight `useChartVerdict`.

**Rules:**
- `trend`: VWAP 25%, RSI 5%, Flow 15%, Trend 20%, Wick 5%, Futures 20%, Liq 10%
- `chop`: VWAP 15%, RSI 20%, Flow 10%, Trend 5%, Wick 20%, Futures 10%, Liq 20%
- `mixed`: current static weights (baseline)

**Where:**
- New: `src/hooks/useMarketRegime.ts` — derives regime from existing tick buffer, exposes `{ regime, atrPct, straightness }`.
- Edit: `useChartVerdict.ts` — accept optional `regime` arg; switch weight table.
- Verdict badge tooltip shows the active regime.

**Toggle:** `Regime` (default OFF). OFF = static weights (today).

**Risk:** moderate — changes score composition. Off by default; you can A/B by flipping toggle.

---

## Phase 3 — Coinbase second BTC feed (Binance/Coinbase lead-lag)

**What:** subscribe to `wss://ws-feed.exchange.coinbase.com` (BTC-USD ticker/matches). Free, no auth, no CORS issue for WS.

**Adds two signals:**
- `leadLagBps` — Coinbase-Binance mid diff. |diff| > 2 bps and expanding = active flow imbalance.
- `whichLeads` — which venue ticked first on the last 3 significant moves. Used as a small tie-breaker.

**Where:**
- New: `src/hooks/useCoinbaseBtcSpot.ts` — WS + reconnect logic mirroring `useBinanceBtcSpot.ts`.
- Feeds into `useChartVerdict` as a **±3 pt bump** to the Flow component only. Not a hard gate.

**Toggle:** `CB Feed` (default OFF).

**Risk:** low — WS-only, small score contribution, no auth needed.

---

## Phase 4 — Round-number magnet gate (already in memory)

**What:** when spot is within `X bps` (default 5 bps ≈ $5 at $100k) of a $50 or $100 level, require a **confirmed break** (3 consecutive 15s closes on the far side) before firing against the level.

**Where:**
- New: `src/lib/roundLevelGate.ts` — pure fn: `shouldSkipForMagnet(price, side, tickBuffer)`.
- Called in `/crypto` gate chain right after `htfGate`.

**Toggle:** `Magnet` (default OFF).

**Risk:** low — skip-only gate, never forces a trade.

---

## What I will NOT touch
- Order placement, ladders, martingale sizing
- Manual close, 35% hard cap, 70%-down rule
- Kalshi ATM sentiment gate (already there, unchanged)
- Existing default-OFF gates (chart/HTF/ETH)

## Rollout
Each phase ships behind its own toggle, verified in preview against live BTC before moving to the next. If any phase feels wrong you flip it off — zero regression risk vs. current behavior.

**Confirm and I'll start Phase 1.** Or tell me to reorder / drop a phase.
