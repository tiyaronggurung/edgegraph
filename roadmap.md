# Roadmap

## Quad paper P&L graph
- [ ] Add combined cumulative A/B/C lines at 15-minute closes with independently clickable legends.
- [ ] Verify aggregation and the signed-in graph with existing paper results; trading logic unchanged.

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

## Verified live (deployed 05:11 UTC)
- [x] bettinggraph.app serves 200; live Paper Desk page carries the −$50 daily stop and the old "3 settled losses" rule is gone; live crypto page carries the composite Binance+Coinbase feeds.
- [x] Real-money Paper Desk bot: running, live on, $10 open cap, ticking every ~11s, no error. 8 settled real trades +$3.30, 43 unfilled orders, nothing open now.

## Deferred / open
- [ ] Paper hedge bot (hd_settings) runs but sits idle on "waiting for our odds" — it still reads odds from the sparse agreement log; point it at the same self-computed tape odds the Paper Desk bot uses (paper money only, awaiting go-ahead)
- [ ] Review 26 unresolved critical security findings in the Security view (RLS read-open on pb_*/hd_*/btc_* log tables)
- [ ] "Waiting for our odds" gaps (recorder writes sparse rows) — user said forget Paper Desk for now
