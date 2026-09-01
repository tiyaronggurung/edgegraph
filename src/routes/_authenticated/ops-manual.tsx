import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { Target } from "lucide-react";
import { opsGetDashboard } from "@/lib/opsManual/opsManual.functions";
import { OpsStatusBanner } from "@/components/ops/OpsStatusBanner";
import { OpsQualificationCard } from "@/components/ops/OpsQualificationCard";
import { OpsStakingPanel } from "@/components/ops/OpsStakingPanel";
import { OpsPnlDashboard } from "@/components/ops/OpsPnlDashboard";
import { OpsBacktestPanel } from "@/components/ops/OpsBacktestPanel";
import { OpsAlertsPanel } from "@/components/ops/OpsAlertsPanel";
import { OpsKalshiAccount } from "@/components/ops/OpsKalshiAccount";
import { OpsAutoTradePanel } from "@/components/ops/OpsAutoTradePanel";
import { usePlan } from "@/hooks/usePlan";
import { OpsHedgePanel } from "@/components/ops/OpsHedgePanel";
import { OpsCrossExitShadowPanel } from "@/components/ops/OpsCrossExitShadowPanel";
import { OpsPaperTradePanel } from "@/components/ops/OpsPaperTradePanel";

export const Route = createFileRoute("/_authenticated/ops-manual")({
  head: () => ({
    meta: [
      { title: "BTC 15m Operating Manual — EdgeGraph AI" },
      { name: "description", content: "Live control layer for the BTC 15-minute operating manual: qualification, staking, P/L and kill switches." },
      { property: "og:title", content: "BTC 15m Operating Manual — EdgeGraph AI" },
      { property: "og:description", content: "Live control layer for the BTC 15-minute operating manual." },
    ],
  }),
  component: OpsManualPage,
});

function OpsManualPage() {
  // Live auto-trade wiring stays admin-only; everything else is per-user.
  const { isAdmin } = usePlan();
  const getDash = useServerFn(opsGetDashboard);

  const q = useQuery({
    queryKey: ["ops-manual-dashboard"],
    queryFn: () => getDash({}),
    refetchInterval: 60_000,
  });

  return (
    <div className="space-y-6 font-mono">
      <div className="flex items-center gap-2">
        <Target className="h-5 w-5 text-[color:var(--color-primary)]" />
        <h1 className="text-2xl font-bold uppercase tracking-wider">
          // BTC 15m Operating Manual — $1k to $100k
        </h1>
      </div>
      <p className="text-xs text-muted-foreground max-w-3xl">
        Your own operating book. Nothing here places real orders automatically — it qualifies
        windows, fixes the stake, records every bet, and shuts the session down the moment a rule
        is hit. Paper trading below is fully simulated.
      </p>

      <OpsPaperTradePanel />

      {q.isLoading && <div className="text-xs text-muted-foreground">Loading operating data…</div>}
      {q.error && <div className="text-xs text-red-400">{(q.error as Error).message}</div>}

      {q.data && (
        <>
          <OpsStatusBanner dash={q.data} onRefresh={() => q.refetch()} />
          <OpsKalshiAccount />
          {isAdmin && <OpsAutoTradePanel />}
          <OpsQualificationCard dash={q.data} />
          <OpsStakingPanel dash={q.data} onRefresh={() => q.refetch()} />
          <OpsHedgePanel />
          <OpsCrossExitShadowPanel />

          <OpsPnlDashboard dash={q.data} />
          <OpsBacktestPanel dash={q.data} />
          <OpsAlertsPanel dash={q.data} onRefresh={() => q.refetch()} />
        </>
      )}
    </div>
  );
}
