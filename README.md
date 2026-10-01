# Edge AI Bets

Build a complete web app called "EdgeGraph AI" — an AI-powered sports betting graph intelligence platform.

Tech stack: React, TypeScript, Tailwind CSS, Supabase (auth + database), Shadcn/ui components.

DESIGN SYSTEM Dark mode only. Black background (#080808), dark gray cards (#111111), borders (#1e1e1e). Accent colors: neon green (#00ff88) for positive signals, red (#ef4444) for danger/avoid, blue (#3b82f6) for neutral confidence, amber (#f59e0b) for caution. Font: JetBrains Mono or Fira Code — monospace terminal aesthetic throughout. The app must feel like a professional AI trading terminal for sports markets, not a consumer app.

SUPABASE SCHEMA — create these tables:

sql

users: id, email, created_at

analyses: id, user_id, sport, league, game_name, team_a, team_b, 
score, time_period, probability_a, probability_b, odds_a, odds_b, 
volume, uploaded_image_url, pattern_type, predicted_winner, 
confidence_score, edge_score, risk_level, recommended_action, 
ai_reasoning, edge70_detected, created_at

bets: id, user_id, analysis_id, game, date, sport, pick, odds, 
stake, pattern_type, confidence_score, edge_score, result, 
profit_loss, notes, created_at

patterns: id, name, description, risk_level, recommended_action, 
condition_logic, example_behavior

strategies: id, user_id, name, rules, pattern_type, 
minimum_confidence, recommended_action, active, created_at

graph_snapshots: id, analysis_id, timestamp, probability_a, 
probability_b, odds_a, odds_b, volume, score_state, event_trigger

AUTHENTICATION Supabase Auth with email/password. Protected routes for all pages except landing. Show user email in nav. Sign out button.

PAGE 1 — LANDING PAGE Headline: "AI Pattern Learning for Sports Betting Graphs" Subheadline: "Upload live betting graphs, track market movement, detect hidden patterns, and estimate high-confidence outcomes."

Three CTA buttons: Analyze Graph / View Pattern Library / Track Picks

Sections:

How it works (3 steps: Upload → Enter Context → Get Analysis)

Supported sports badges: NBA 🏀 NFL 🏈 NHL 🏒 MLB ⚾ Tennis 🎾 Soccer ⚽

Pattern detection preview (6 pattern cards)

Edge70 signal system explanation

Disclaimer banner: "For educational and analytical purposes only. Sports betting involves significant financial risk."

PAGE 2 — DASHBOARD Stat cards grid (8 cards):

Total Analyzed Games

Win Rate % (wins / total tracked bets)

Average Confidence Score

Edge70 Signals Found

Total P&L ($)

ROI %

Bankroll ($)

Best Performing Pattern

Below stats:

Recent Analyses table (sport, teams, pattern badge, confidence, action badge)

P&L by Sport bar chart (all 6 sports)

Win rate by pattern horizontal bar chart

PAGE 3 — ANALYZE GRAPH Left column:

Image upload card (dashed border, click to upload, Supabase Storage)

Sport selector (6 buttons: NBA / NFL / NHL / MLB / Tennis / Soccer)

Game info form: League, Game Name, Team A, Team B, Score, Time/Period, Home/Away

Right column:

Market data: Probability A (%), Probability B (%), Odds A, Odds B, Volume/Liquidity

Live probability bar (visual split bar showing A vs B)

Sport-specific fields (show different fields based on sport selected):

NBA: Quarter, Time Remaining, Foul Trouble, Game Pace, Possession

NFL: Quarter, Time Remaining, Field Position, Timeouts, Down & Distance

NHL: Period, Time Remaining, Power Play Active, Shots on Goal A, Shots on Goal B

MLB: Inning, Top/Bottom, Outs, Base Runners, Bullpen Status

Tennis: Sets Score, Current Games, Current Server, Break Points, Tiebreak

Soccer: Match Minute, Red Cards, Possession %, Shots/xG, Subs Used

Intelligence notes: Live Notes textarea, Injury/News textarea, Market Movement textarea

Submit button: "⚡ Run AI Analysis" — triggers rule-based analysis engine, saves to Supabase, navigates to result page.

PAGE 4 — AI ANALYSIS RESULT Top row:

Predicted winner (large text)

Edge70 badge (green "⚡ EDGE70 DETECTED" or red "✗ NO EDGE70")

Pattern badge, Risk badge, Action badge

Second row:

Confidence gauge (SVG arc gauge 0-100%)

Edge Score (X/10, color coded)

Momentum direction

Volatility rating

Chart section:

Simulated probability graph (SVG line chart generated from pattern type)

Edge70 detector card with sport-specific reasoning

Pattern breakdown:

Pattern icon + name + description

"Why this signal triggered" — bullet list of reasoning steps

Recommended action display:

BET (green) / WAIT (blue) / HEDGE (amber) / AVOID (red) / WATCH ONLY (gray)

Save to Backtest button → opens modal pre-filled with analysis data.

PAGE 5 — LIVE MARKETS API connector status bar at top showing: Kalshi Market API / Sports Data API / Odds API / Manual Mode (all with "Connect" buttons, placeholder for future API keys)

Sport tab bar (NBA / NFL / NHL / MLB / Tennis / Soccer)

Each market card shows:

Game name + time/score

Edge70 badge if detected

Pattern badge

Mini probability graph (SVG)

Edge score

Action badge

Sample demo data pre-loaded for each sport tab.

PAGE 6 — PATTERN LIBRARY 14 pattern cards in responsive grid.

Each card shows:

Pattern icon + name

Risk badge (Low / Medium / High)

Description

Best Use case

Condition logic

Simulated mini chart

Recommended action

Risk filter buttons: All / Low / Medium / High

Patterns to include:

Dominant Lock — prob ≥90%, stable → Hold favorite

Controlled Stability — prob ≥75%, climbing → Small position

Breakaway Trend — sudden shift + volume → Follow trend

Late Momentum Swing — late reversal → Wait for confirmation

V-Reversal — drop then sharp recovery → Fade or wait

Fake Spike — spike then collapse → Fade overreaction

Chaotic Coin Flip — rapid swings both ways → No bet

Momentum Exhaustion — extended run flattening → Reduce/hedge

Sharp Money Recovery — dip then quiet recovery → Follow sharps

Volatility Compression — tightening range → Wait for breakout

Public Overreaction — volume spike + unsustained → Wait or fade

Failed Rally — underdog spikes fail repeatedly → Hold favorite

Favorite Confirmation — repeated failed rallies → Increase position

Underdog Trap — suppressed underdog near inflection → Hedge

PAGE 7 — BACKTEST TRACKER Top analytics row: Total Bets / Win Rate / Total P&L / ROI

Two charts:

Win rate by pattern (horizontal bars)

ROI by sport (bar or list)

Bet history table columns: Date / Game / Sport / Pick / Odds / Pattern / Confidence / Edge Score / Result / P&L

"+ Add Result" button opens modal with all fields.

Filter by: Sport / Pattern / Result / Date range

PAGE 8 — SAVED STRATEGIES Strategy cards showing: Name / Rules (italic quote style) / Pattern badge / Min confidence / Action badge / Active/Paused status

"+ New Strategy" button opens modal:

Strategy Name

Rules / Conditions (textarea)

Pattern Type (dropdown of all 14)

Minimum Confidence (number input)

Recommended Action (dropdown)

Activate / Pause / Delete controls on each card.

PAGE 9 — SETTINGS Left column:

Profile: Email, Bankroll (),DefaultBetUnit(), Default Bet Unit ( ),DefaultBetUnit()

Risk Tolerance selector: Conservative / Medium / Aggressive

Right column:

Preferred Sports multi-select (6 sport buttons)

API Connectors section: Kalshi / Sports Data / Odds API with API key input fields

Supabase schema reference (collapsible, shows table names and key fields)

RULE-BASED AI ENGINE — implement this logic:

classifyPattern(probability, sport, sportFields, notes):
  if prob >= 90 and stable → "Dominant Lock"
  if notes contains "spike" and "collapse" → "Fake Spike"
  if notes contains "reversal" → "V-Reversal"
  if notes contains "chaotic" or "swinging" → "Chaotic Coin Flip"
  if notes contains "overreact" → "Public Overreaction"
  if notes contains "sharp money" → "Sharp Money Recovery"
  if notes contains "exhaustion" → "Momentum Exhaustion"
  if prob >= 75 and no volatility notes → "Controlled Stability"
  sport-specific overrides:
    NBA: Q4 + <5min + prob≥80 → "Late-Game Stability"
    NFL: red zone + prob≥65 → "Breakaway Trend"
    NHL: power play active → "Breakaway Trend"
    MLB: inning≥7 + prob≥75 → "Late Momentum Swing"
    Tennis: tiebreak → "Chaotic Coin Flip"
    Soccer: minute≥75 + prob≥70 → "Late Momentum Swing"
  default fallback by probability range

computeEdgeScore(probability, pattern):
  base = ((prob - 50) / 50) * 10
  add pattern bonuses: Dominant Lock +2, Controlled Stability +1.5
  subtract penalties: Chaotic Coin Flip -3, Fake Spike -2.5
  clamp to 0–10

computeEdge70(probability, pattern, sport, sportFields, notes):
  if prob <= 70 → NOT DETECTED
  if pattern is dangerous (Chaotic/Fake Spike/Overreaction/Trap) → NOT DETECTED
  sport-specific gates:
    NBA: block if Q4 <2min and prob <85, block if foul trouble noted
    NFL: block if turnover risk noted, block if no timeouts in Q4
    NHL: block if power play active, require prob >78
    MLB: block if inning <7, block if bullpen depleted
    Tennis: block if tiebreak, block if break points active and prob <80
    Soccer: block if minute <60, block if red card on opponent, block if draw risk noted
  if all gates pass → EDGE70 DETECTED with sport-specific reason text

recommendAction(edgeScore, edge70):
  edgeScore ≥7.5 AND edge70 → "Bet"
  edgeScore ≥5.5 AND edge70 → "Wait"
  edgeScore ≥4 → "Hedge"
  pattern is Chaotic/Fake Spike/Trap → "Avoid"
  default → "Watch Only"

UI COMPONENTS TO BUILD:

ConfidenceGauge — SVG arc gauge with color coding

MiniProbChart — SVG line chart with gradient fill

ProbabilityBar — Split horizontal bar A vs B

PatternBadge — Colored pill with icon and pattern name

RiskBadge — Color-coded risk level pill

ActionBadge — BET/WAIT/HEDGE/AVOID/WATCH pill

Edge70Badge — Green detected / Red not detected

StatCard — Metric card with label, value, sub-label

SportTab — Tab button with emoji and sport name

AnalysisTable — Sortable table of past analyses

BetModal — Full bet entry modal

StrategyModal — Strategy builder modal

NAVIGATION Sticky top nav bar with:

Logo: "⚡ EdgeGraph AI" in neon green

Nav links: Dashboard / Analyze / Live Markets / Patterns / Backtest / Strategies / Settings

Right side: user email + Sign Out

Mobile: collapsible hamburger menu.

SAMPLE DATA Pre-load realistic demo data for:

5 past analyses (mix of sports and patterns)

5 tracked bets (mix of wins/losses)

3 saved strategies

Live market cards for each sport tab

DISCLAIMER — show on every analysis page: "⚠ For educational and analytical purposes only. Sports betting involves significant financial risk. All confidence scores are pattern estimates, not guaranteed outcomes. Past pattern performance does not guarantee future results. Never bet more than you can afford to lose."

FUTURE-READY ARCHITECTURE Add placeholder service files for:

kalshiAPI.ts — connect to Kalshi market probability feeds

sportsDataAPI.ts — connect to live game state feeds

oddsAPI.ts — connect to live sportsbook odds

supabaseClient.ts — already wired to auth + all tables

analysisEngine.ts — rule-based engine, structured for AI model swap-in later

This project was built with [Lovable](https://lovable.dev).

**Live app**: https://edgegraph.lovable.app

## Build with Lovable

Continue developing this project in the [Lovable editor](https://lovable.dev/projects/921f21f3-4144-4400-a0a1-781603e22b1b).

- **Ship faster**: describe what you want to build and Lovable handles the code.
- **Stay in sync**: every change made in Lovable is committed straight to this repository.
- **Full ownership**: this code is yours. Push to `main` on GitHub and your changes sync back into Lovable, ready for your next prompt.

## Development

Prefer working locally? You need Node.js and npm — [install with nvm](https://github.com/nvm-sh/nvm#installing-and-updating).

```sh
git clone <this-repository-url>
cd <repository-name>
npm i
npm run dev
```
