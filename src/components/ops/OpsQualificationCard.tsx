import { Check, X } from "lucide-react";
import type { OpsDashboard } from "./types";
import { cn } from "@/lib/utils";

// Permanent, always-visible operating checklist. Static by design — it is the
// contract, not a computed suggestion.
export function OpsQualificationCard({ dash }: { dash: OpsDashboard }) {
  const R = dash.rules;
  const utcHour = new Date().getUTCHours();
  const hourAllowed = !(R.EXCLUDED_UTC_HOURS as readonly number[]).includes(utcHour);
  const preferred = (R.PREFERRED_UTC_HOURS as readonly number[]).includes(utcHour);

  const Row = ({ ok, children }: { ok: boolean | null; children: React.ReactNode }) => (
    <li className="flex items-start gap-2 text-xs">
      {ok == null ? (
        <span className="h-3.5 w-3.5 mt-0.5 shrink-0 rounded-full border border-border" />
      ) : ok ? (
        <Check className="h-3.5 w-3.5 mt-0.5 shrink-0 text-emerald-400" />
      ) : (
        <X className="h-3.5 w-3.5 mt-0.5 shrink-0 text-red-400" />
      )}
      <span>{children}</span>
    </li>
  );

  return (
    <div className="border border-border bg-card rounded p-4 space-y-4">
      <div className="terminal-label">// Trade qualification card</div>

      <div>
        <div className="text-xs font-bold uppercase tracking-widest mb-2">Bet only if</div>
        <ul className="space-y-1.5">
          <Row ok={null}>T7 Study lock exists</Row>
          <Row ok={null}>Study confidence ≥ {R.MIN_STUDY_CONF_PCT}%</Row>
          <Row ok={null}>Cushion ≥ ${R.MIN_CUSHION_USD}</Row>
          <Row ok={null}>Ask ≤ {R.MAX_ASK_CENTS}¢</Row>
          <Row ok={null}>Model agrees with Study</Row>
          <Row ok={null}>Fired within {R.MAX_LOCK_AGE_SECONDS}s of the T7 lock</Row>
          <Row ok={null}>Our odds ≥ {(R.OUR_ODDS_CONFIRM_PROB * 100).toFixed(1)}% on the study side</Row>
          <Row ok={null}>At least two minutes remain</Row>
          <Row ok={hourAllowed}>
            UTC hour is not 01, 04, 11 or 18 — now {String(utcHour).padStart(2, "0")}h
            {preferred && <span className="text-emerald-400"> (preferred hour)</span>}
          </Row>
        </ul>
      </div>

      <div className="grid sm:grid-cols-2 gap-4">
        <div>
          <div className="text-xs font-bold uppercase tracking-widest mb-2">Stake</div>
          <ul className="space-y-1 text-xs text-muted-foreground">
            <li>Compounding 5% of morning bankroll</li>
            <li>Steps down to 3% once bankroll reaches $10k</li>
            <li>60% of that unit while in Risk Reduced mode</li>
            <li>Flat for the entire day — never recalculated intraday</li>
          </ul>
        </div>
        <div>
          <div className="text-xs font-bold uppercase tracking-widest mb-2">Stop</div>
          <ul className="space-y-1 text-xs text-muted-foreground">
            <li>First loss of the day</li>
            <li>+20% daily return</li>
            <li>−20% daily return</li>
            <li>Four bets</li>
            <li>Any outage</li>
            <li>Any rule violation</li>
          </ul>
        </div>
      </div>

      <div className="grid sm:grid-cols-2 gap-4">
        <div>
          <div className="text-xs font-bold uppercase tracking-widest mb-2">Sunday</div>
          <p className={cn("text-xs", dash.isSunday ? "text-orange-400" : "text-muted-foreground")}>
            Review-only mode. No live trades.
            {dash.isSunday && " — TODAY IS SUNDAY."}
          </p>
        </div>
        <div>
          <div className="text-xs font-bold uppercase tracking-widest mb-2">Bank</div>
          <p className="text-xs text-muted-foreground">
            Withdraw 20% of milestone profit at every doubling from $10,000.
          </p>
        </div>
      </div>
    </div>
  );
}
