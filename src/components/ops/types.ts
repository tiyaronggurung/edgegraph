import type { opsGetDashboard } from "@/lib/opsManual/opsManual.functions";

export type OpsDashboard = Awaited<ReturnType<typeof opsGetDashboard>>;

export interface OpsAlertRow {
  id: string;
  level: string;
  code: string;
  metric: string | null;
  current_value: number | null;
  threshold_value: number | null;
  action_taken: string | null;
  resume_conditions: string | null;
  manual_review_required: boolean;
  triggered_at: string;
  acknowledged_at: string | null;
  resolved_at: string | null;
}

export interface OpsTradeRow {
  id: string;
  session_date: string;
  ticker: string;
  decision_at: string;
  utc_hour: number | null;
  strike: number | null;
  side: string | null;
  study_side: string | null;
  study_conf: number | null;
  model_side: string | null;
  model_conf: number | null;
  spot_at_lock: number | null;
  cushion_usd: number | null;
  ask_cents: number | null;
  seconds_left: number | null;
  stake: number;
  potential_profit: number | null;
  result: string | null;
  realized_pnl: number | null;
  bankroll_after: number | null;
  rule_status: string;
  violations: string[];
  discipline_score: number;
  notes: string | null;
}
