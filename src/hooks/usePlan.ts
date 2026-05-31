import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useAuth } from "@/components/auth/AuthProvider";
import { getPlanAndUsage } from "@/lib/usage.functions";
import { getPlan, type PlanTier } from "@/lib/plans/config";

export function usePlan() {
  const { user } = useAuth();
  const fetchPlan = useServerFn(getPlanAndUsage);

  const q = useQuery({
    queryKey: ["plan-and-usage", user?.id],
    queryFn: () => fetchPlan(),
    enabled: !!user,
    staleTime: 30_000,
  });

  const tier: PlanTier = (q.data?.tier ?? "free") as PlanTier;
  const plan = getPlan(tier);
  const usage = q.data?.usage ?? { betAlertsUsed: 0, aiVerdictsUsed: 0 };
  const isAdmin = !!q.data?.isAdmin;

  const remainingAlerts = Number.isFinite(plan.features.betAlertsPerMonth)
    ? Math.max(0, plan.features.betAlertsPerMonth - usage.betAlertsUsed)
    : Infinity;
  const remainingVerdicts = Number.isFinite(plan.features.aiVerdictsPerMonth)
    ? Math.max(0, plan.features.aiVerdictsPerMonth - usage.aiVerdictsUsed)
    : Infinity;

  return {
    tier,
    plan,
    isAdmin,
    usage,
    remaining: { alerts: remainingAlerts, verdicts: remainingVerdicts },
    loading: q.isLoading,
    refetch: q.refetch,
    can: {
      sendAlert: () => remainingAlerts > 0,
      useVerdict: () => remainingVerdicts > 0,
      seeLiveGame: (index: number) =>
        !Number.isFinite(plan.features.liveGamesVisible) ||
        index < plan.features.liveGamesVisible,
      saveStrategy: (currentCount: number) =>
        !Number.isFinite(plan.features.maxStrategies) ||
        currentCount < plan.features.maxStrategies,
      accessClv: () => plan.features.clvTracking,
      accessSport: (sport: string) =>
        plan.features.allSports || /nba/i.test(sport),
    },
  };
}
