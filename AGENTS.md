# Architecture rules

- 5m paper summary statistics paginate narrow settled-position reads independently of the recent 50-row trade log; slower summary refresh keeps full-history totals from delaying odds or trading.

- Paper Desk's read-only volume display subscribes to Crypto's existing query keys and uses a dedicated presentation component; keep it separate from trading decisions to avoid changing live orders.
- Display strike and window volume use independent shared queries through useBtcEssentialFeeds; one upstream must not block the other, and strike data is confined to its own market window.
- The Quad-Confirmation paper engine (quadBot, qc_* tables) is paper-only and isolated from live trading code; it never places real orders, so experiments cannot change live orders.
- C's opposite leg uses the entry dollar budget through a pure sizing helper; its legacy locked flag means hedge completed, not guaranteed profit, because equal-dollar legs can have unequal contracts.
- C settlement and its displayed P&L share a pure helper: winning contracts minus both recorded leg costs (including any recorded fees); preserve historical fills rather than resizing old trades to current budgets.
- Quad paper P&L charts reuse the panel's positions query and aggregate settled results at 15-minute window closes in a pure presentation helper; this avoids extra polling and changes to trading logic.
- Quad paper settlement falls back from the window's logged outcome to strike/close from 1m candles when spot ticks or prediction rows are missing; spot ticks are pruned within ~25 minutes, so tick-only settlement stalls.

- Crypto lower-page cleanup is presentation-only: preserve shared hooks, market query fields, manual sizing defaults and order confirmation even when research panels are unmounted, because upper trading controls depend on them.
- Live odds chart ending-dot labels use the last plotted sample; hovered historical odds appear separately so historical numbers cannot mislabel live endpoints.
- The odds chart Area badge uses a pure expirationWeightedArea presentation helper with the displayed window's fixed expiry; never feed this display metric into odds or trading, to keep signal behavior unchanged.
- The live odds chart is also recorded server-side (liveOddsRecorder.server.ts, 10s cron) by calling the pure computeStrikeOdds core; never fork the odds math for the server, so the chart and the recorder can't drift apart.
- Quad B is an own-odds speed hedge (no whale): decisions live in the pure bReversal helper, the opposite leg is contract-matched, and a reversal lock fires only when both legs plus fees cost less than the payout, so a "lock" is truly guaranteed.
- The 5m Polymarket paper bot (poly5mBot, p5_* tables) is paper-only and isolated; rules/learning live in pure helpers and the server reuses computeStrikeOdds, so it can't drift from the 5m tab or touch live orders.
- The 5m odds chart saves its own past windows (live_odds_windows_5m) from the browser, separate from 15m's table, and takes results from the 5m bot's settled window first; display-only so 15m history and trading stay untouched.
- The 5m bot's real-money path lives only in poly5mBot/live.server.ts behind p5_settings.live_enabled (default off), claims a unique per-window row before sending any Polymarket US order, and sends DOWN prices as 1 − side price; this prevents duplicate or mispriced real orders.
- 5m-only odds tuning (12s velocity, 60s late fade, 5m volume in/out fake-move filter) is gated on windowSec < 900 or 5m-only context fields; 15m output must stay byte-identical.
