import { Check } from "lucide-react";
import { cn } from "@/lib/utils";
import {
  type PlanDefinition,
  type BillingInterval,
  annualMonthlyEquivalent,
  annualSavingsPct,
} from "@/lib/plans/config";

interface Props {
  plan: PlanDefinition;
  billing: BillingInterval;
  currentTier?: string;
  onSelect: (plan: PlanDefinition) => void;
  ctaLabel?: string;
}

function PriceBlock({ plan, billing }: { plan: PlanDefinition; billing: BillingInterval }) {
  if (plan.monthlyPriceUsd === 0) {
    return (
      <div className="space-y-1">
        <div className="flex items-baseline gap-1">
          <span className="text-4xl font-bold tabular-nums">$0</span>
          <span className="text-xs text-muted-foreground uppercase tracking-wider">forever</span>
        </div>
        <p className="text-[11px] text-muted-foreground">No card required</p>
      </div>
    );
  }

  if (billing === "year") {
    const monthlyEq = annualMonthlyEquivalent(plan);
    const savings = annualSavingsPct(plan);
    return (
      <div className="space-y-1">
        <div className="flex items-baseline gap-1">
          <span className="text-4xl font-bold tabular-nums">${monthlyEq.toFixed(2)}</span>
          <span className="text-xs text-muted-foreground uppercase tracking-wider">/mo</span>
        </div>
        <p className="text-[11px] text-muted-foreground">
          ${plan.annualPriceUsd.toFixed(2)}/year · Save {savings}%
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-1">
      <div className="flex items-baseline gap-1">
        <span className="text-4xl font-bold tabular-nums">${plan.monthlyPriceUsd}</span>
        <span className="text-xs text-muted-foreground uppercase tracking-wider">/mo</span>
      </div>
      <p className="text-[11px] text-muted-foreground">
        or ${plan.annualPriceUsd.toFixed(2)}/year (Save {annualSavingsPct(plan)}%)
      </p>
    </div>
  );
}

function FeatureRow({ children }: { children: React.ReactNode }) {
  return (
    <li className="flex items-start gap-2 text-xs">
      <Check className="h-3.5 w-3.5 text-[color:var(--color-primary)] shrink-0 mt-0.5" />
      <span>{children}</span>
    </li>
  );
}

const PLAN_HIGHLIGHTS: Record<string, string[]> = {
  free: [
    "5 BET alerts / month",
    "5 AI verdict requests / month",
    "Top 3 live games only",
    "Last 7 days bet history",
    "Basic Kelly calculator",
    "NBA only",
    "View-only pattern library",
  ],
  pro: [
    "100 BET alerts / month",
    "Unlimited AI verdicts",
    "All live games — every sport",
    "Full bet history",
    "Advanced Kelly + bankroll tools",
    "Save up to 10 strategies",
    "CLV tracking",
    "Pattern alerts",
  ],
  vip: [
    "Unlimited BET alerts",
    "Unlimited AI verdicts",
    "All live games + early access",
    "Unlimited strategies",
    "Full CLV + advanced analytics",
    "Pattern alerts + priority signals",
    "Priority support",
    "Everything in Pro",
  ],
};

export function PricingCard({ plan, billing, currentTier, onSelect, ctaLabel }: Props) {
  const isCurrent = currentTier === plan.tier;
  const popular = plan.highlight === "popular";
  const premium = plan.highlight === "premium";

  const cta =
    ctaLabel ??
    (isCurrent
      ? "Current plan"
      : plan.tier === "free"
        ? "Get started"
        : `Upgrade to ${plan.name}`);

  return (
    <div
      className={cn(
        "relative border rounded-lg p-6 flex flex-col gap-5 bg-card font-mono transition",
        popular &&
          "border-[color:var(--color-primary)] shadow-[0_0_32px_color-mix(in_oklab,var(--primary)_15%,transparent)]",
        premium && "border-[color:var(--color-info)]/60",
        !popular && !premium && "border-border",
      )}
    >
      {plan.badge && (
        <div
          className={cn(
            "absolute -top-3 left-1/2 -translate-x-1/2 text-[10px] uppercase tracking-widest px-3 py-1 rounded-full border",
            popular &&
              "bg-[color:var(--color-primary)] text-[color:var(--color-primary-foreground)] border-[color:var(--color-primary)]",
            premium &&
              "bg-[color:var(--color-info)]/15 text-[color:var(--color-info)] border-[color:var(--color-info)]/60",
          )}
        >
          {plan.badge}
        </div>
      )}

      <div>
        <h3
          className={cn(
            "text-lg font-bold uppercase tracking-wider",
            popular && "neon-text",
            premium && "text-[color:var(--color-info)]",
          )}
        >
          {plan.name}
        </h3>
        <p className="text-xs text-muted-foreground mt-1">{plan.tagline}</p>
      </div>

      <PriceBlock plan={plan} billing={billing} />

      <button
        disabled={isCurrent}
        onClick={() => onSelect(plan)}
        className={cn(
          "w-full text-xs uppercase tracking-wider px-3 py-3 rounded border transition",
          isCurrent && "border-border bg-muted text-muted-foreground cursor-not-allowed",
          !isCurrent && popular &&
            "border-[color:var(--color-primary)] bg-[color:var(--color-primary)] text-[color:var(--color-primary-foreground)] hover:opacity-90",
          !isCurrent && premium &&
            "border-[color:var(--color-info)] text-[color:var(--color-info)] hover:bg-[color:var(--color-info)]/10",
          !isCurrent && !popular && !premium &&
            "border-border hover:border-[color:var(--color-primary)] hover:text-[color:var(--color-primary)]",
        )}
      >
        {cta}
      </button>

      <ul className="space-y-2 mt-2">
        {PLAN_HIGHLIGHTS[plan.tier].map((line) => (
          <FeatureRow key={line}>{line}</FeatureRow>
        ))}
      </ul>
    </div>
  );
}
