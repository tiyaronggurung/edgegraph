# Roadmap

## Paper Desk volume mirror
- [x] Replace abbreviated volume with Crypto's live window, Coinbase, combined volume, weighted averages, flow labels and NY day totals.
- [x] Verify the signed-in display, current data, removed old volume label and absence of browser errors; trading paths unchanged.

## Hedge page (done this turn)
- [x] Backtest two-sided combined-cost hedge rules on btc_agreement_log history (best: 45¢/45¢ → locked in 57 windows, +35.2¢/pair)
- [x] /hedge page: our odds, window volume, composite price, position, P&L chart, activity
- [x] Paper hedge bot (hd_* tables, hedge-bot-tick cron every 10s) — paper money only, our odds only
- [x] Nav link + admin-only Start/Pause/Reset
- [x] Build verified OK

## Published 2026-10-12 05:11 UTC
- [x] Published to https://bettinggraph.app (site responds 200): paper-bot 1s odds + live two-sided hedge + take-profit, $50 daily stop, odds sync, composite Binance+Coinbase odds, Paper Desk volume mirror, real-money-only P&L graph.

## Deferred / open
- [ ] Press Start on /hedge (paper-only hedge bot still paused; needs an admin click on the live site)
- [ ] Review 26 unresolved critical security findings in the Security view (RLS read-open on pb_*/hd_*/btc_* log tables)
- [ ] "Waiting for our odds" gaps (recorder writes sparse rows) — user said forget Paper Desk for now
