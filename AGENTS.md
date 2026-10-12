# Architecture rules

- Paper Desk's read-only volume display subscribes to Crypto's existing query keys and uses a dedicated presentation component; keep it separate from trading decisions to avoid changing live orders.
- The Quad-Confirmation paper engine (quadBot, qc_* tables) is paper-only and isolated from live trading code; it never places real orders, so experiments cannot change live orders.
