import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { Shield } from "lucide-react";
import { adminSetTier } from "@/lib/usage.functions";
import { usePlan } from "@/hooks/usePlan";
import { PLANS, type PlanTier } from "@/lib/plans/config";
import { StakingConfigPanel } from "@/components/crypto/StakingConfigPanel";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/_authenticated/admin")({
  head: () => ({ meta: [{ title: "Admin — EdgeGraph AI" }] }),
  component: AdminPanel,
});

function AdminPanel() {
  const { tier, isAdmin, usage, plan, loading, refetch } = usePlan();
  const setTier = useServerFn(adminSetTier);
  const nav = useNavigate();
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!loading && !isAdmin) {
      // Hidden panel — bounce non-admins.
      nav({ to: "/dashboard" });
    }
  }, [loading, isAdmin, nav]);

  if (loading) {
    return (
      <div className="text-xs text-muted-foreground uppercase tracking-widest">Loading…</div>
    );
  }

  if (!isAdmin) return null;

  const switchTo = async (next: PlanTier) => {
    setBusy(true);
    try {
      await setTier({ data: { tier: next } });
      toast.success(`Switched to ${PLANS[next].name}`);
      await refetch();
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-6 font-mono max-w-3xl">
      <div className="flex items-center gap-2">
        <Shield className="h-5 w-5 text-[color:var(--color-primary)]" />
        <h1 className="text-2xl font-bold uppercase tracking-wider">// Admin Testing</h1>
      </div>

      <div className="border border-border bg-card rounded p-4 space-y-2">
        <div className="terminal-label">// Current plan</div>
        <div className="text-sm">
          <span className="neon-text font-bold uppercase">{plan.name}</span>
          <span className="text-muted-foreground"> · BET alerts {usage.betAlertsUsed} · AI verdicts {usage.aiVerdictsUsed}</span>
        </div>
      </div>

      <div className="border border-border bg-card rounded p-4 space-y-3">
        <div className="terminal-label">// Override tier (testing only)</div>
        <p className="text-xs text-muted-foreground">
          Switch your account between Free, Pro, and VIP to test gated features.
        </p>
        <div className="flex flex-wrap gap-2">
          {(["free", "pro", "vip"] as const).map((t) => (
            <button
              key={t}
              disabled={busy || tier === t}
              onClick={() => switchTo(t)}
              className={cn(
                "text-xs uppercase tracking-wider px-3 py-2 rounded border transition",
                tier === t
                  ? "border-[color:var(--color-primary)] text-[color:var(--color-primary)] bg-[color:var(--color-primary)]/10"
                  : "border-border hover:border-[color:var(--color-primary)] hover:text-[color:var(--color-primary)]",
              )}
            >
              {PLANS[t].name}
            </button>
          ))}
        </div>
      </div>

      <StakingConfigPanel />
    </div>
  );
}
