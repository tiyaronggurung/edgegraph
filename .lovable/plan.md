# Keep the 4/4 signal alive with the page closed

Right now the four legs (our odds, volume, model pick, study pick) are only put together inside the open /crypto page. Close the laptop and nothing records the agreement, so the $100 engine goes blind and windows get missed. This makes the whole thing run on the server, around the clock.

## What changes

A new server job runs every 20 seconds, on its own, and does exactly what the page does:

1. Reads the current Kalshi strike and the live BTC price.
2. Reads this 15-minute window's in/out volume.
3. Reads the model pick and the study lock.
4. Computes our own odds on the strike — same formula as on screen.
5. Writes the result into the same agreement log the bet engine already reads.

The bet engine is untouched. It keeps reading the log, keeps the 90-second hold, the 70c/90c caps, the one-buy-per-window sharing and the 3-loss daily stop.

## Technical notes

- `src/hooks/useStrikeOdds.ts`: the calculation body is lifted, unchanged, into an exported pure function `computeStrikeOdds(spot, strike, secondsToClose, ctx, tape)`. The hook keeps its tape ref and effect and simply calls it. No math, constants or outputs change — the panel keeps behaving identically.
- New `src/lib/agreementRecorder.server.ts`:
  - tape built from `btc_spot_ticks` (written every 20s by `spot-tick-writer`, 4 samples per run), last ~10 minutes, composite-weighted the same way as the live hook (Coinbase/Bitstamp preferred);
  - strike + window volume from the existing `getBtcEssentialSnapshot` internals;
  - flow context (m1/m15 indicators, avg buy/sell, imbalance, SMA stack) from the existing flow-lean history server code;
  - model/study from `getBtcConsensus`;
  - same leg rules as the panel: odds UP if pUp >= 0.5, volume dead zone +/-5%, `all_four` when all four known and equal;
  - upserts into `btc_agreement_log` on `(window_start, bucket_sec)` with a 10s bucket, exactly the shape the browser recorder writes. Server rows and browser rows collapse onto the same bucket, so both sources can run without double-counting.
  - `held_seconds` derived by walking back contiguous 10s buckets in the log (same method the bet engine uses), so the hold survives restarts.
- New route `src/routes/api/public/hooks/agreement-writer.ts`, cron-secret protected.
- New pg_cron job `btc-agreement-writer-20s` at 20 seconds (4,320 runs/day — it must be at least as fast as the 10s bucket to keep the hold chain unbroken; this keeps the database awake continuously, which is the cost of round-the-clock signal).
- The browser recorder stays as-is — a harmless second writer into the same buckets.

## Not touched

Study lock, model, exit logic, buy/ladder paths, verdict engine, cheap entry, the odds hook's outputs, the daily loss guard.
