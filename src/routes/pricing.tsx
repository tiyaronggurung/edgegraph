import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { z } from "zod";
import { toast } from "sonner";
import { Zap } from "lucide-react";
import { PLANS, ROI_COPY, type BillingInterval, type PlanDefinition } from "@/lib/plans/config";
import { PricingCard } from "@/components/pricing/PricingCard";
import { ComparisonTable } from "@/components/pricing/ComparisonTable";
import { BillingToggle } from "@/components/pricing/BillingToggle";
import { trackUpgradeEvent } from "@/lib/analytics.functions";
import { useAuth } from "@/components/auth/AuthProvider";
import { usePlan } from "@/hooks/usePlan";

const searchSchema = z.object({
  plan: z.enum(["free", "pro", "vip"]).optional(),
  billing: z.enum(["month", "year"]).optional(),
});

export const Route = createFileRoute("/pricing")({
  head: () => ({
    meta: [
      { title: "Pricing — EdgeGraph AI" },
      {
        name: "description",
        content:
          "Free, Pro, and VIP Sharp plans for live betting edge detection, AI verdicts, bankroll tools, and CLV tracking.",
      },
      { property: "og:title", content: "Pricing — EdgeGraph AI" },
      { property: "og:description", content: ROI_COPY },
    ],
  }),
  validateSearch: searchSchema,
  component: PricingPage,
});

function PricingPage() {
  const search = Route.useSearch();
  const navigate = useNavigate();
  const { user } = useAuth();
  const { tier: currentTier } = usePlan();

  const [billing, setBilling] = useState<BillingInterval>(search.billing ?? "month");

  useEffect(() => {
    trackUpgradeEvent({
      type: "pricing_page_viewed",
      context: "pricing",
      metadata: { from: search.plan ?? null },
    });
  }, [search.plan]);

  const onSelect = (plan: PlanDefinition) => {
    trackUpgradeEvent({
      type: "plan_selected",
      context: "pricing",
      targetPlan: plan.tier,
      metadata: { billing },
    });

    if (plan.tier === "free") {
      if (!user) {
        navigate({ to: "/signup" });
        return;
      }
      navigate({ to: "/dashboard" });
      return;
    }

    // Pro / VIP — Stripe-ready stub.
    if (!user) {
      navigate({ to: "/signup" });
      return;
    }
    toast.info("Stripe checkout coming soon", {
      description: `${plan.name} (${billing === "year" ? "annual" : "monthly"}) — billing isn't live yet. We'll email you when it opens.`,
    });
  };

  return (
    <div className="min-h-screen text-foreground font-mono">
      <header className="border-b border-border">
        <div className="max-w-7xl mx-auto px-4 py-4 flex justify-between items-center">
          <Link to="/" className="flex items-center gap-2 neon-text font-bold">
            <Zap className="h-4 w-4 fill-current" />
            <span className="tracking-widest text-sm">EDGEGRAPH AI</span>
          </Link>
          <div className="flex gap-2">
            {user ? (
              <Link
                to="/dashboard"
                className="text-xs uppercase tracking-wider px-3 py-1.5 border border-border rounded hover:border-[color:var(--color-primary)] hover:text-[color:var(--color-primary)]"
              >
                Dashboard
              </Link>
            ) : (
              <>
                <Link to="/login" className="text-xs uppercase tracking-wider px-3 py-1.5 hover:text-[color:var(--color-primary)]">
                  Sign in
                </Link>
                <Link
                  to="/signup"
                  className="text-xs uppercase tracking-wider px-3 py-1.5 border border-[color:var(--color-primary)] text-[color:var(--color-primary)] rounded hover:bg-[color:var(--color-primary)]/10"
                >
                  Get access
                </Link>
              </>
            )}
          </div>
        </div>
      </header>

      <section className="max-w-6xl mx-auto px-4 py-16 text-center">
        <div className="inline-block text-[10px] uppercase tracking-[0.3em] text-[color:var(--color-primary)] border border-[color:var(--color-primary)]/40 px-2 py-1 rounded mb-5">
          ⚡ Pricing
        </div>
        <h1 className="text-3xl md:text-5xl font-bold tracking-tight">
          Pick the plan that <span className="neon-text">matches your edge</span>
        </h1>
        <p className="mt-5 text-sm md:text-base text-muted-foreground max-w-2xl mx-auto">
          {ROI_COPY}
        </p>
        <div className="mt-8 flex justify-center">
          <BillingToggle value={billing} onChange={setBilling} />
        </div>
      </section>

      <section className="max-w-6xl mx-auto px-4 pb-16">
        <div className="grid gap-6 md:grid-cols-3">
          {(["free", "pro", "vip"] as const).map((t) => (
            <PricingCard
              key={t}
              plan={PLANS[t]}
              billing={billing}
              currentTier={currentTier}
              onSelect={onSelect}
            />
          ))}
        </div>
      </section>

      <section className="max-w-6xl mx-auto px-4 pb-20">
        <ComparisonTable />
      </section>

      <section className="max-w-4xl mx-auto px-4 pb-16">
        <div className="border border-border bg-card rounded-lg p-6 text-center space-y-3">
          <h3 className="text-lg font-bold uppercase tracking-wider">Questions?</h3>
          <p className="text-xs text-muted-foreground">
            All plans include the core analysis engine. Upgrade or downgrade anytime — your data stays with you.
          </p>
        </div>
      </section>

      <footer className="border-t border-border py-6 text-center text-xs text-muted-foreground">
        © EdgeGraph AI — Educational analytics only.
      </footer>
    </div>
  );
}
