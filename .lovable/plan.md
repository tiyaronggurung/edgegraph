# Unify Kalshi Auto-Trade logs

## Goal
Collapse the four separate trade tables on `/crypto` into one unified table under the **Live Kalshi Auto-Trade** section, with a new **Source** column that tags every row.

## Rows to combine

| Current section | Data feed | Source tag |
|---|---|---|
| Open positions · live exit signals (line ~483) | `auto_trade_orders` where status = open | `open` |
| Model accuracy fires (Model Bet panel, ~695) | `auto_trade_orders` where `inputs_snapshot.origin='model_bet'` | `model-bet` |
| Odds-shadow / Auto-odds trade log (~1883/2218) | `auto_trade_orders` where `is_martingale=false` and origin auto-odds | `auto-odds` |
| Trade log at bottom (~2685) | `getMyBets` / `bets.functions` | `manual` / other |

All four already read from the same `auto_trade_orders` table (except the bottom log, which reads bets). The merge is mostly a UI collapse, not a data refactor.

## What stays untouched (regression guard)
- **Open-position action buttons** (Close, confirm modal) — keep on the unified row when `status === "open"`.
- **Model Bet ON/OFF toggle + $10 stake banner** — keep as-is above the table.
- **Auto-odds ON/OFF + Kalshi auth diagnostics + settings panel** — keep, only the row table below them is removed.
- **Data-fetching hooks** (`getMyBets`, `runAutoTrade`, odds hooks) — untouched.
- No changes to any server functions, DB queries, or public routes.

## Unified table columns
Time · Source · Ticker · Side · Strike · Spot@Entry · Model% · Edge · Entry¢ · Now¢ · Contracts · Stake · Status · P&L · Actions

- Source cell is a chip: `open` (blue), `model-bet` (sky), `auto-odds` (violet), `manual` (gray).
- Now¢ + exit-signal reason + Close button only render when `status === "open"`.
- Filter chips above the table: All · Open · Model Bet · Auto-Odds · Manual (default All).

## Structural changes
1. Extract row-normalizer `toUnifiedRow(order|bet) → UnifiedTradeRow` (new util at top of `crypto.tsx`).
2. New component `<UnifiedTradeLog />` that merges the three `auto_trade_orders` queries via `useQueries` + the manual `bets` query, dedupes by id, sorts by created_at desc.
3. Replace the four table JSX blocks with one `<UnifiedTradeLog />` mount inside the existing Live Kalshi Auto-Trade card.
4. Section headings, action banners, and toggles above each table stay in place.

## Out of scope
- No schema changes.
- No changes to settlement, exit ladders, or auto-trade logic.
- No changes to guest/public routes.

## Confirm before I build
This touches ~500 lines of working UI. I'll only proceed once you say go — reply "build it" and I'll implement exactly the plan above.
