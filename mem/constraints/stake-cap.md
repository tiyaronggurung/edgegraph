---
name: Auto-odds stake cap
description: Hard $100 max stake per auto-odds trade, single bet only (no hedge)
type: constraint
---
Auto-odds bot MUST bet exactly $100 per trade. No compound scaling, no high-conviction multiplier, no coinflip hedge (no second opposite-side bet on the same tick). **Why:** user is losing real money and explicitly forbade larger stakes and paired bets.
