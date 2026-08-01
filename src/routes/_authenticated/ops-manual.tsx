import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useEffect } from "react";
import { Target } from "lucide-react";
import { usePlan } from "@/hooks/usePlan";
import { opsGetDashboard } from "@/lib/opsManual/opsManual.functions";
import { OpsStatusBanner } from "@/components/ops/OpsStatusBanner";
import { OpsQualificationCard } from "@/components/ops/OpsQualificationCard";
import { OpsStakingPanel } from "@/components/ops/OpsStakingPanel";
import { OpsPnlDashboard } from "@/components/ops/OpsPnlDashboard";
import { OpsBacktestPanel } from "@/components/ops/OpsBacktestPanel";
import { OpsAlertsPanel } from "@/components/ops/OpsAlertsPanel";

export const Route = createFileRoute("/_authenticated/ops-manual")({
  head: () => ({
    meta: [
      { title: "BTC 15m Operating Manual — EdgeGraph AI" },
      { name: "description", content: "Admin control layer for the BTC 15-minute operating manual: qualification, staking, P/L and kill switches." },
      { property: "og:title", content: "BTC 15m Operating Manual — EdgeGraph AI" },
      { property: "og:description", content: "Admin control layer for the BTC 15-minute operating manual." },
    ],
  }),
  component: OpsManualPage,
});

function OpsManualPage() {
  const { isAdmin, loading } = usePlan();
  const nav = useNavigate();
  const getDash = useServerFn(opsGetDashboard);

  useEffect(() => {
    if (!loading && !isAdmin) nav({ to: "/dashboard" });
  }, [loading, isAdmin, nav]);

  const q = useQuery({
    queryKey: ["ops-manual-dashboard"],
    queryFn: () => getDash({}),
    enabled: !loading && isAdmin,
    refetchInterval: 60_000,
  });

  if (loading || !isAdmin) {
    return <div className="text-xs text-muted-foreground uppercase tracking-widest">Loading…</div>;
  }

  return (
    <div className="space-y-6 font-mono">
      <div className="flex items-center gap-2">
        <Target className="h-5 w-5 text-[color:var(--color-primary)]" />
        <h1 className="text-2xl font-bold uppercase tracking-wider">
          // BTC 15m Operating Manual — $1k to $100k
        </h1>
      </div>
      <p className="text-xs text-muted-foreground max-w-3xl">
        Admin-only control layer. Nothing here places orders automatically — it qualifies windows,
        fixes the stake, records every bet, and shuts the session down the moment a rule is hit.
      </p>

      {q.isLoading && <div className="text-xs text-muted-foreground">Loading operating data…</div>}
      {q.error && <div className="text-xs text-red-400">{(q.error as Error).message}</div>}

      {q.data && (
        <>
          <OpsStatusBanner dash={q.data} onRefresh={() => q.refetch()} />
          <OpsQualificationCard dash={q.data} />
          <OpsStakingPanel dash={q.data} onRefresh={() => q.refetch()} />
          <OpsPnlDashboard dash={q.data} />
          <OpsBacktestPanel dash={q.data} />
          <OpsAlertsPanel dash={q.data} onRefresh={() => q.refetch()} />
        </>
      )}
    </div>
  );
}
