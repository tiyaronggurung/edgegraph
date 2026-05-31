import { Check, Minus } from "lucide-react";
import { PLANS, formatLimit, type PlanTier } from "@/lib/plans/config";

interface Row {
  label: string;
  values: Record<PlanTier, string | boolean | number>;
}

const ROWS: Row[] = [
  {
    label: "BET alerts / month",
    values: {
      free: PLANS.free.features.betAlertsPerMonth,
      pro: PLANS.pro.features.betAlertsPerMonth,
      vip: PLANS.vip.features.betAlertsPerMonth,
    },
  },
  {
    label: "AI verdict requests / month",
    values: {
      free: PLANS.free.features.aiVerdictsPerMonth,
      pro: PLANS.pro.features.aiVerdictsPerMonth,
      vip: PLANS.vip.features.aiVerdictsPerMonth,
    },
  },
  {
    label: "Live games visible",
    values: {
      free: `Top ${PLANS.free.features.liveGamesVisible}`,
      pro: "All",
      vip: "All + early access",
    },
  },
  {
    label: "Sports access",
    values: { free: "NBA only", pro: "All sports", vip: "All sports" },
  },
  {
    label: "Bet history",
    values: { free: "Last 7 days", pro: "Unlimited", vip: "Unlimited" },
  },
  {
    label: "Saved strategies",
    values: {
      free: PLANS.free.features.maxStrategies,
      pro: PLANS.pro.features.maxStrategies,
      vip: PLANS.vip.features.maxStrategies,
    },
  },
  {
    label: "Kelly calculator",
    values: { free: "Basic", pro: "Advanced", vip: "Advanced" },
  },
  {
    label: "Pattern library",
    values: {
      free: "View only",
      pro: "Full access",
      vip: "Full access",
    },
  },
  {
    label: "CLV tracking",
    values: {
      free: PLANS.free.features.clvTracking,
      pro: PLANS.pro.features.clvTracking,
      vip: PLANS.vip.features.clvTracking,
    },
  },
  {
    label: "Pattern alerts",
    values: {
      free: PLANS.free.features.patternAlerts,
      pro: PLANS.pro.features.patternAlerts,
      vip: PLANS.vip.features.patternAlerts,
    },
  },
  {
    label: "Early access to new markets",
    values: {
      free: PLANS.free.features.earlyAccessMarkets,
      pro: PLANS.pro.features.earlyAccessMarkets,
      vip: PLANS.vip.features.earlyAccessMarkets,
    },
  },
  {
    label: "Priority support",
    values: {
      free: PLANS.free.features.prioritySupport,
      pro: PLANS.pro.features.prioritySupport,
      vip: PLANS.vip.features.prioritySupport,
    },
  },
];

function Cell({ value }: { value: string | boolean | number }) {
  if (typeof value === "boolean") {
    return value ? (
      <Check className="h-4 w-4 text-[color:var(--color-primary)] mx-auto" />
    ) : (
      <Minus className="h-4 w-4 text-muted-foreground mx-auto" />
    );
  }
  if (typeof value === "number") {
    return <span className="tabular-nums">{formatLimit(value)}</span>;
  }
  return <span>{value}</span>;
}

export function ComparisonTable() {
  return (
    <div className="border border-border bg-card rounded-lg overflow-hidden font-mono">
      <div className="px-4 py-3 border-b border-border">
        <h3 className="terminal-label">// Full comparison</h3>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full text-xs">
          <thead className="text-muted-foreground uppercase tracking-wider">
            <tr className="border-b border-border">
              <th className="text-left p-3 font-normal">Feature</th>
              <th className="text-center p-3 font-normal">Free</th>
              <th className="text-center p-3 font-normal neon-text">Pro</th>
              <th className="text-center p-3 font-normal text-[color:var(--color-info)]">VIP Sharp</th>
            </tr>
          </thead>
          <tbody>
            {ROWS.map((row) => (
              <tr key={row.label} className="border-b border-border/40">
                <td className="p-3 text-foreground">{row.label}</td>
                <td className="p-3 text-center text-muted-foreground"><Cell value={row.values.free} /></td>
                <td className="p-3 text-center"><Cell value={row.values.pro} /></td>
                <td className="p-3 text-center"><Cell value={row.values.vip} /></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
