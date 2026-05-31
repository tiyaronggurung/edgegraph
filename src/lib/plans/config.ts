// Plan / tier configuration. Single source of truth for feature limits and
// pricing copy. Designed so activating real Stripe later only requires wiring
// price IDs into PLAN_STRIPE_PRICES.

export type PlanTier = "free" | "pro" | "vip";
export type BillingInterval = "month" | "year";

export interface PlanFeatures {
  // Hard limits per calendar month. Infinity = unlimited.
  betAlertsPerMonth: number;
  aiVerdictsPerMonth: number;
  liveGamesVisible: number; // Infinity = all
  historyDays: number; // Infinity = unlimited
  maxStrategies: number; // Infinity = unlimited
  // Booleans
  patternLibraryWrite: boolean;
  clvTracking: boolean;
  patternAlerts: boolean;
  advancedKelly: boolean;
  earlyAccessMarkets: boolean;
  prioritySupport: boolean;
  // Sports access
  allSports: boolean; // false = NBA only
}

export interface PlanDefinition {
  tier: PlanTier;
  name: string;
  tagline: string;
  monthlyPriceUsd: number;
  annualPriceUsd: number; // total per year
  features: PlanFeatures;
  highlight?: "popular" | "premium";
  badge?: string;
}

export const PLANS: Record<PlanTier, PlanDefinition> = {
  free: {
    tier: "free",
    name: "Free",
    tagline: "Get started with the basics.",
    monthlyPriceUsd: 0,
    annualPriceUsd: 0,
    features: {
      betAlertsPerMonth: 5,
      aiVerdictsPerMonth: 5,
      liveGamesVisible: 3,
      historyDays: 7,
      maxStrategies: 0,
      patternLibraryWrite: false,
      clvTracking: false,
      patternAlerts: false,
      advancedKelly: false,
      earlyAccessMarkets: false,
      prioritySupport: false,
      allSports: false, // NBA only
    },
  },
  pro: {
    tier: "pro",
    name: "Pro",
    tagline: "Built for active bettors.",
    monthlyPriceUsd: 24.99,
    annualPriceUsd: 239.9,
    highlight: "popular",
    badge: "Most Popular",
    features: {
      betAlertsPerMonth: 100,
      aiVerdictsPerMonth: Infinity,
      liveGamesVisible: Infinity,
      historyDays: Infinity,
      maxStrategies: 10,
      patternLibraryWrite: true,
      clvTracking: true,
      patternAlerts: true,
      advancedKelly: true,
      earlyAccessMarkets: false,
      prioritySupport: false,
      allSports: true,
    },
  },
  vip: {
    tier: "vip",
    name: "VIP Sharp",
    tagline: "For serious bettors who want every edge.",
    monthlyPriceUsd: 59.99,
    annualPriceUsd: 575.9,
    highlight: "premium",
    badge: "For Serious Bettors",
    features: {
      betAlertsPerMonth: Infinity,
      aiVerdictsPerMonth: Infinity,
      liveGamesVisible: Infinity,
      historyDays: Infinity,
      maxStrategies: Infinity,
      patternLibraryWrite: true,
      clvTracking: true,
      patternAlerts: true,
      advancedKelly: true,
      earlyAccessMarkets: true,
      prioritySupport: true,
      allSports: true,
    },
  },
};

// Future Stripe price IDs — fill in when activating live billing.
export const PLAN_STRIPE_PRICES: Record<
  Exclude<PlanTier, "free">,
  Record<BillingInterval, string | null>
> = {
  pro: { month: null, year: null },
  vip: { month: null, year: null },
};

export const ROI_COPY =
  "Get AI-powered betting insights, live edge detection, bankroll tools, and performance tracking designed to help you make smarter betting decisions.";

export function getPlan(tier: PlanTier | string | null | undefined): PlanDefinition {
  if (tier === "pro") return PLANS.pro;
  if (tier === "vip") return PLANS.vip;
  return PLANS.free;
}

export function annualMonthlyEquivalent(plan: PlanDefinition): number {
  if (plan.annualPriceUsd === 0) return 0;
  return Math.round((plan.annualPriceUsd / 12) * 100) / 100;
}

export function annualSavingsPct(plan: PlanDefinition): number {
  if (plan.monthlyPriceUsd === 0) return 0;
  const yearAtMonthly = plan.monthlyPriceUsd * 12;
  return Math.round(((yearAtMonthly - plan.annualPriceUsd) / yearAtMonthly) * 100);
}

export function formatLimit(n: number): string {
  if (!Number.isFinite(n)) return "Unlimited";
  if (n === 0) return "—";
  return n.toLocaleString();
}

export function currentPeriodStart(d = new Date()): string {
  // YYYY-MM-01 in UTC — matches profiles/usage_counters period_start.
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, "0");
  return `${y}-${m}-01`;
}
