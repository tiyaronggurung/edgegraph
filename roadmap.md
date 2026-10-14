# Roadmap

## Strategy C settled profit
- [x] Verified all 45 recorded C settlements already match winning-contract payout minus both actual leg costs; shared the calculation between settlement and display, and exposed latest payout/cost breakdown without changing A/B or historical fills.
- [x] 13 settlement/sizing/chart tests passed; build OK. Signed-in Paper Desk and reload both showed latest C payout $226.00 minus $182.63 cost = +$43.37, total +$371.10; no browser errors. New unattended settlement code requires publishing; no new equal-dollar C fill was available to exercise.

## Strategy C equal-dollar sizing
- [x] Change only C's hedge to the same dollar budget as its entry; retain entry and pair-price gates, prevent repeat hedges, remove profit-lock claim.
- [x] Seven sizing/chart tests pass, build OK; A/B trading branches unchanged. Signed-in display verified, but no actual C fill was available to verify end-to-end; unattended cron needs publishing.

## Quad paper P&L graph
- [x] Add combined cumulative A/B/C lines at 15-minute closes with independently clickable legends.
- [x] Verify aggregation (3 passing tests) and signed-in graph with existing paper results, A-only view, all-hidden state and restored lines; no browser errors, trading logic unchanged.

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

## Crypto lower-page cleanup
- [x] Remove lower research/report displays and sizing inputs after the Trade Log; retain upper sections, shared sizing values, confirmation modal, feed status and disclaimer.
- [x] Verified signed-in Crypto with real data, preserved Trade Log and upper sections, absent lower displays, no browser errors, build OK and 33 prediction-gate tests passing.
