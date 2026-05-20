# EdgeGraph AI — Build Plan

A dark, monospace "AI trading terminal" for sports betting graph analysis. 9 pages, Lovable Cloud (Supabase) auth + DB + storage, rule-based pattern engine ready for AI swap-in.

## 1. Backend (Lovable Cloud)

Enable Lovable Cloud, then create schema via migration:

- `profiles` (id → auth.users, email, bankroll, default_unit, risk_tolerance, preferred_sports[], created_at) + trigger on signup
- `analyses` (full fields per spec, user_id FK, uploaded_image_url)
- `bets` (user_id, analysis_id FK nullable, result, profit_loss, …)
- `patterns` (seeded with all 14 patterns)
- `strategies` (user_id, rules, pattern_type, min_confidence, action, active)
- `graph_snapshots` (analysis_id FK, timeseries point)

RLS: owner-only on `analyses`, `bets`, `strategies`, `profiles`; public read on `patterns`. Storage bucket `graph-uploads` (private, owner read/write via RLS).

Auth: email/password via Supabase. `_authenticated` layout route guards all pages except `/`. Session listener at root invalidates router + query cache.

## 2. Design System (`src/styles.css`)

Dark only. Tokens in oklch approximating: bg `#080808`, card `#111111`, border `#1e1e1e`, primary/success `#00ff88` (neon green), destructive `#ef4444`, info `#3b82f6`, warning `#f59e0b`, muted-foreground `#8a8a8a`. JetBrains Mono via Google Fonts as global font. Tight radius (`0.25rem`), terminal feel: uppercase tracked labels, hairline borders, subtle glow on accents.

## 3. Routes (TanStack Start, file-based)

- `/` landing (public)
- `/_authenticated/dashboard`
- `/_authenticated/analyze`
- `/_authenticated/analysis/$id` (result)
- `/_authenticated/live`
- `/_authenticated/patterns`
- `/_authenticated/backtest`
- `/_authenticated/strategies`
- `/_authenticated/settings`
- `/login`, `/signup`

Each route has its own `head()` metadata.

## 4. Shared Components (`src/components/`)

`Nav` (sticky, logo + links + email + sign out, mobile hamburger), `Disclaimer`, `ConfidenceGauge` (SVG arc), `MiniProbChart` (SVG line + gradient), `ProbabilityBar`, `PatternBadge`, `RiskBadge`, `ActionBadge`, `Edge70Badge`, `StatCard`, `SportTab`, `AnalysisTable`, `BetModal`, `StrategyModal`, `SportFields` (switch by sport).

## 5. AI Engine (`src/lib/analysisEngine.ts`)

Pure TS, no deps. Exports `classifyPattern`, `computeEdgeScore`, `computeEdge70`, `recommendAction`, `runAnalysis(input)` returning the full result object. Implements all rules + sport-specific gates exactly as specified. Structured so a future model call can replace the body without changing callers.

Also `generateSimulatedSeries(pattern)` → array of points for the result-page chart, deterministic per pattern.

## 6. Service Stubs (`src/services/`)

`kalshiAPI.ts`, `sportsDataAPI.ts`, `oddsAPI.ts` — typed interfaces + mock implementations returning sample data; clearly marked TODO for real API keys (via Lovable secrets later).

## 7. Pages

Each page implemented to spec:

- **Landing** — hero, 3 CTAs, how-it-works, sport badges, 6 pattern preview cards, Edge70 explainer, disclaimer.
- **Dashboard** — 8 stat cards (computed from `analyses` + `bets`), recent analyses table, P&L by sport bar chart, win-rate-by-pattern horizontal bars (Recharts).
- **Analyze** — two-column form, image upload to Storage, dynamic sport-specific fields, live probability bar, submit → runs engine → inserts `analyses` row + initial `graph_snapshots` → navigate to result.
- **Result** — gauges, badges, simulated chart, Edge70 reasoning card, pattern breakdown, action display, Save-to-Backtest modal prefilled.
- **Live Markets** — connector status bar (placeholder Connect buttons), sport tabs, demo market cards per sport.
- **Pattern Library** — 14 cards with mini charts, risk filter buttons. Data from `patterns` table (seeded).
- **Backtest** — analytics row, two charts, filterable bet table, Add Result modal.
- **Strategies** — cards + New/Edit/Pause/Delete modal.
- **Settings** — profile form (persists to `profiles`), risk tolerance, preferred sports, API key inputs (stored as Lovable secrets via flow), collapsible schema reference.

## 8. Sample / Seed Data

- Migration seeds `patterns` table with all 14 entries.
- On first sign-in (or via "Load demo data" button on dashboard if empty), insert 5 demo analyses, 5 bets, 3 strategies for that user.
- Live Markets cards use static demo arrays per sport.

## 9. Technical Notes

- Use `createServerFn` + `requireSupabaseAuth` for all DB writes/reads of user data; browser client only for auth + storage upload + realtime if needed.
- Recharts for bar charts; hand-rolled SVG for gauges / mini line charts (small, themed).
- Form state with `react-hook-form` + `zod`; toasts via existing sonner.
- Disclaimer component rendered on Analyze, Result, Live Markets, Backtest pages.

## Out of scope (this build)

- Real Kalshi / odds / sports-data integrations (stubs only).
- Replacing rule engine with LLM (interface ready).
- Payments / subscription tiers.

Ready to implement on approval.