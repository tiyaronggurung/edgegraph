# Architecture rules

- Paper Desk's read-only volume display subscribes to Crypto's existing query keys and uses a dedicated presentation component; keep it separate from trading decisions to avoid changing live orders.
- The Quad-Confirmation paper engine (quadBot, qc_* tables) is paper-only and isolated from live trading code; it never places real orders, so experiments cannot change live orders.
- Quad paper P&L charts reuse the panel's positions query and aggregate settled results at 15-minute window closes in a pure presentation helper; this avoids extra polling and changes to trading logic.
