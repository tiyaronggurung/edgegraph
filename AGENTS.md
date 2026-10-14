# Architecture rules

- Paper Desk's read-only volume display subscribes to Crypto's existing query keys and uses a dedicated presentation component; keep it separate from trading decisions to avoid changing live orders.
- The Quad-Confirmation paper engine (quadBot, qc_* tables) is paper-only and isolated from live trading code; it never places real orders, so experiments cannot change live orders.
- C's opposite leg uses the entry dollar budget through a pure sizing helper; its legacy locked flag means hedge completed, not guaranteed profit, because equal-dollar legs can have unequal contracts.
- C settlement and its displayed P&L share a pure helper: winning contracts minus both recorded leg costs (including any recorded fees); preserve historical fills rather than resizing old trades to current budgets.
- Quad paper P&L charts reuse the panel's positions query and aggregate settled results at 15-minute window closes in a pure presentation helper; this avoids extra polling and changes to trading logic.
- Quad paper settlement falls back from the window's logged outcome to strike/close from 1m candles when spot ticks or prediction rows are missing; spot ticks are pruned within ~25 minutes, so tick-only settlement stalls.

- Crypto lower-page cleanup is presentation-only: preserve shared hooks, market query fields, manual sizing defaults and order confirmation even when research panels are unmounted, because upper trading controls depend on them.
