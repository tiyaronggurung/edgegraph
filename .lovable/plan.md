## Paper Trading System — $100 bankroll, $10 flat, separate section

### Scope
- Give every user a $100 paper balance
- All 3 buttons (Model Bet, PRED Bet, Green Hours Bet) already forced to paper mode → deduct $10 per fire
- Settlement credits back: win = $10 × (100/fill_price_cents), loss = $0
- Stop firing when balance ≤ $0 ("paper_bankrupt" skip); admin/manual reset only
- New route `/crypto/paper` with balance, stats, and full fill log
- Do NOT touch: real-money paths, live Kalshi code, existing auto_trade_orders schema, PRED gates, Model/Green Hours gates

### Database (1 migration)
1. `paper_balances` table
   - `user_id uuid PK` → auth.users
   - `balance_cents int NOT NULL DEFAULT 10000` (=$100)
   - `starting_cents int NOT NULL DEFAULT 10000`
   - `bankrupt_at timestamptz NULL`
   - `updated_at timestamptz`
   - RLS: user reads own; service_role writes
   - GRANTs per convention

2. `paper_fills` table (dedicated log — decoupled from auto_trade_orders so live-money history stays clean)
   - `id uuid PK`
   - `user_id uuid` → auth.users
   - `ticker text`, `close_time timestamptz`
   - `button text` ('model' | 'pred' | 'green_hours')
   - `side text` ('YES'|'NO'), `contracts int`, `fill_price_cents int`
   - `stake_cents int NOT NULL DEFAULT 1000` ($10)
   - `entry_snapshot jsonb` (edge, prob, sideConf, sigmaDist, etc.)
   - `status text` ('open'|'won'|'lost')
   - `payout_cents int NULL`, `pnl_cents int NULL`
   - `settled_at timestamptz NULL`
   - RLS: user reads own; service_role writes

3. `handle_new_user()` trigger update → seed `paper_balances` on signup (existing users seeded via one-time insert)

### Server functions (new file `src/lib/paperTrading.functions.ts`)
- `getPaperBalance()` — returns balance + bankruptcy state
- `getPaperFills({ limit })` — user's fill log
- `getPaperStats()` — WR, P/L, streaks per button
- `recordPaperFire({ ticker, closeTime, button, side, fillPriceCents, snapshot })` — deducts $10, inserts open fill, throws if bankrupt
- `resetPaperBalance()` — admin/self reset to $100
- Settlement worker: extend existing settlement cron (or add new) to resolve open `paper_fills` and credit `paper_balances`

### UI
1. `/crypto/paper` route
   - Balance card ("$X / $100 · +$Y net") with Reset button
   - Bankruptcy banner if balance ≤ 0
   - Stats per button (WR, fires, P/L)
   - Full fill log table: time · ticker · button · side · contracts · fill · payout · P/L · status

2. On `/crypto` page:
   - Small "Paper: $X.XX" pill next to Kalshi cash section (link to /crypto/paper)
   - Fire hooks in ModelBet / PredBet / GreenHours panels call `recordPaperFire` before the paper `auto_trade_orders` insert; on bankrupt → toast + skip

### Stake enforcement
- All 3 paper buttons: hardcode `stake_dollars = 10` regardless of current logic
- Contracts = floor(1000 / fill_price_cents), min 1

### Out of scope (untouched)
- Real Kalshi order path (KALSHI_LIVE_ENABLED)
- Auto-trade background crons that still fire live (auto-model-bet-tick, auto-odds-tick)
- Existing `auto_trade_orders` rows / analytics cards
- PRED gates, sweet-spot gate, kill-switch, green-hour whitelist
- pred_locks

### Deliverable order
1. Migration (paper_balances + paper_fills + trigger) — awaits your approval
2. Server functions + settlement hook
3. `/crypto/paper` route
4. Header pill + wire the 3 paper buttons to `recordPaperFire`

Approve and I'll ship the migration first.