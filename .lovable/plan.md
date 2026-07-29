# Study Pick Auto-Bet (Real Money)

Fire **one** real Kalshi $10 buy per 15-min window when the Study Pick locks, if Kalshi's ask on the locked side is **< 90¢**. Two worlds: **A** = what makes a lock (already built). **B** = what makes us fire (new).

---

## World A — Study Pick Lock Rules (already live, unchanged)

Auto-bet only consumes locks; it never invents new ones.

- **A1 Primary** — `secondsToClose ∈ (420, 480]` AND chip confidence **≥ 75%** → lock instantly
- **A2 Late** — `secondsToClose ∈ [180, 420]` AND chip confidence **≥ 80%** held continuously **≥ 120s** → lock
- **A3 Hard gates (upstream)** — dominance ≥ 70%, trajectory agreement, flip-count < 5, distance ≥ 0.05% of strike
- No lock by T-180s → CHOPPY, no fire

---

## World B — Kalshi Auto-Fire Rules (new)

### B1 — User eligibility
- `profiles.study_auto_live_enabled = true` (new toggle, default OFF)
- `kalshi_api_key_id` + `kalshi_private_key_pem` present

### B2 — Price gate
- Fetch Kalshi ask on the locked side at fire time
- **Fire if `ask < 90¢`** · **Skip if `ask ≥ 90¢`** (log `ask_ge_90c`) · **Skip if ask = null** (log `no_kalshi_ask`)

### B3 — One bet per window (new — the rule you just added)
- **Hard cap: exactly 1 successful fire per (user, ticker)**. `ticker` = the 15-min window, so this = 1 bet per 15 min.
- **Retry loop until placed**: on transient failure (ask ≥ 90¢, Kalshi 5xx, order rejected, no fill), re-attempt every **10s**.
- **Retry window**: keeps trying from lock time up to **T-60s** remaining, then gives up (skip reason `retry_window_expired`).
- Each retry re-fetches the live ask and re-checks the < 90¢ gate — so if price falls from 91¢ → 88¢ we still catch it, and if it climbs above 90¢ we keep waiting.
- **After a successful fill: STOP.** Set `study_auto_live_fired_at` on the prediction row → no further attempts for that window even if lock updates or chip re-fires.

### B4 — Sizing / order
- **$10 flat** stake · Contracts = `floor(1000 / askCents)` · Side: YES if UP, NO if DOWN · **IOC** at current ask
- Uses the same Kalshi signer as Cheap-flip / Our-Odds Hunter
- Records into `auto_trade_orders` with `trigger='study_auto_live'`, `mode='live'` (settlement + P&L pipelines already handle it)

### B5 — Exit
- **Hold to settle.** No TP, no SL.

### B6 — Safety
- Never touches paper flow, PRED, Cheap-flip Hunter, Our-Odds Hunter, manual buttons, or ladder/exit logic.
- Independent of the existing `big_flip_killswitch`.

---

## Data changes
- `profiles.study_auto_live_enabled boolean not null default false`
- `btc_model_predictions.study_auto_live_fired_at timestamptz` (idempotency marker)
- Extra `auto_trade_skip_log` reasons: `ask_ge_90c`, `no_kalshi_ask`, `retry_window_expired`, `toggle_off`, `no_keys`, `already_fired`

## Server
- Extend `src/lib/chipStudyPick.functions.ts`: after existing paper block, spawn a retry loop per eligible user that polls the ask every 10s until fire or `secondsToClose ≤ 60`.
- Loop lives inside the request handler — simple `while` with `await sleep(10_000)` and a hard deadline computed from lock time + `secondsToClose`. Bails on first successful fill or expiry.

## UI
- New card on `/crypto` near the Cheap-flip banner:
  - Toggle (ON/OFF)
  - Line: *"$10 on Kalshi at lock. Skip if ask ≥ 90¢. Retry every 10s until T-60s. Hold to settle. 1 bet / 15 min."*
  - Today's fires / wins / P&L from `auto_trade_orders` where `trigger='study_auto_live'`
  - Disabled if Kalshi keys missing

Confirm and I'll build it.