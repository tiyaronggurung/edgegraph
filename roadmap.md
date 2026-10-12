# Roadmap

## Hedge page (done this turn)
- [x] Backtest two-sided combined-cost hedge rules on btc_agreement_log history (best: 45¢/45¢ → locked in 57 windows, +35.2¢/pair)
- [x] /hedge page: our odds, window volume, composite price, position, P&L chart, activity
- [x] Paper hedge bot (hd_* tables, hedge-bot-tick cron every 10s) — paper money only, our odds only
- [x] Nav link + admin-only Start/Pause/Reset
- [x] Build verified OK

## Deferred / open
- [ ] Publish so the hedge bot's 10s timer runs on the live site, then press Start on /hedge
- [ ] "Waiting for our odds" gaps (recorder writes sparse rows) — user said forget Paper Desk for now
- [ ] Publish pending paper-bot odds-only update
