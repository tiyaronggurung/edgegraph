// Shadow-only recommendation card. Reads the same backtest query as
// JumpBacktestPanel (Query cache dedupes) and derives a recommended policy
// once readiness thresholds are met. Emits NOTHING to live gates.
import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { runJumpPolicyBacktest, type PolicyResult } from "@/lib/jumpBacktest.functions";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Target, ShieldCheck, ShieldAlert, ShieldOff } from "lucide-react";

// User preference order — try earlier policies first when multiple pass the criteria.
const PREF_ORDER: PolicyResult["policy"][] = [
  "D_sigma_inflate",
  "E_larger_edge",
  "B_skip_active",
  "C_compress",
];

interface CriterionResult { name: string; passed: boolean; detail: string; }

interface PolicyEvaluation {
  policy: PolicyResult["policy"];
  criteria: CriterionResult[];
  passCount: number;
  totalCount: number;
  summary: string;
  tradeRetentionPct: number;
}

function findRow(rows: PolicyResult[] | undefined, segment: string, policy: PolicyResult["policy"]): PolicyResult | null {
  return rows?.find(r => r.segment === segment && r.policy === policy) ?? null;
}

function fmtDollar(x: number) { return `${x >= 0 ? "" : "-"}$${Math.abs(x).toFixed(0)}`; }

export function JumpRecommendationCard({ days = 7 }: { days?: number }) {
  const runFn = useServerFn(runJumpPolicyBacktest);
  const { data } = useQuery({
    queryKey: ["jump-backtest", days],
    queryFn: () => runFn({ data: {
      fromIso: new Date(Date.now() - days * 86400_000).toISOString(),
      toIso: new Date().toISOString(),
    }}),
    staleTime: 5 * 60_000,
    refetchOnWindowFocus: false,
  });

  const analysis = useMemo(() => {
    if (!data) return null;

    // Readiness gate
    const baselineAll = findRow(data.results, "all", "A_baseline");
    const totalSnaps = data.eligibleRows;
    const totalWindows = data.windows;
    const le30sWindows = findRow(data.results, "≤30s", "A_baseline")?.n_windows_seen ?? 0;
    const contestedWindows = findRow(data.results, "contested", "A_baseline")?.n_windows_seen ?? 0;
    const le30sSnaps = findRow(data.results, "≤30s", "A_baseline")?.n_predictions ?? 0;
    const contestedSnaps = findRow(data.results, "contested", "A_baseline")?.n_predictions ?? 0;
    const calendarDays = new Set(data.perDay.map(r => r.day)).size;

    const earlyReady = totalSnaps >= 500 && totalWindows >= 50 && calendarDays >= 5;
    const seriousReady = totalSnaps >= 1500 && totalWindows >= 150
      && le30sSnaps >= 100 && le30sWindows >= 30
      && contestedSnaps >= 100 && contestedWindows >= 30
      && calendarDays >= 5;

    if (!earlyReady) {
      return {
        state: "not_ready" as const,
        message: "Collecting data. Recommendation blocked until at least 500 eligible snapshots + 50 windows + 5 calendar days.",
        counters: { totalSnaps, totalWindows, calendarDays, le30sSnaps, le30sWindows, contestedSnaps, contestedWindows },
      };
    }

    // Evaluate each candidate policy against the 6 criteria (window-level everywhere).
    const evaluations: PolicyEvaluation[] = [];
    for (const policy of PREF_ORDER) {
      const all = findRow(data.results, "all", policy);
      const base = baselineAll;
      const le30s = findRow(data.results, "≤30s", policy);
      const le30sBase = findRow(data.results, "≤30s", "A_baseline");
      const yes = findRow(data.results, "YES", policy);
      const no = findRow(data.results, "NO", policy);
      const yesBase = findRow(data.results, "YES", "A_baseline");
      const noBase = findRow(data.results, "NO", "A_baseline");
      const pocket = data.pocket88.find(r => r.policy === policy) ?? null;
      const pocketBase = data.pocket88.find(r => r.policy === "A_baseline") ?? null;
      const testSlice = data.walkForward.find(w => w.label === "test");
      const test = testSlice?.results.find(r => r.policy === policy) ?? null;
      const testBase = testSlice?.results.find(r => r.policy === "A_baseline") ?? null;

      if (!all || !base) continue;

      const isSkipping = policy === "B_skip_active" || policy === "E_larger_edge";
      const tradeRetention = base.n_trades > 0 ? all.n_trades / base.n_trades : 0;

      const criteria: CriterionResult[] = [
        {
          name: "Walk-forward test slice: P/L ≥ 0 AND beats baseline",
          passed: !!test && !!testBase && test.pnl_usd >= 0 && test.pnl_usd > testBase.pnl_usd,
          detail: test && testBase
            ? `test P/L ${fmtDollar(test.pnl_usd)} vs baseline ${fmtDollar(testBase.pnl_usd)}`
            : "insufficient test data",
        },
        {
          name: "Window-level all-segment: ΔP/L > 0",
          passed: all.pnl_usd > base.pnl_usd,
          detail: `Δ ${fmtDollar(all.pnl_usd - base.pnl_usd)}`,
        },
        {
          name: "≤30s bucket improves (ΔBrier<0 OR ΔP/L>0)",
          passed: !!le30s && !!le30sBase && (le30s.brier < le30sBase.brier || le30s.pnl_usd > le30sBase.pnl_usd),
          detail: le30s && le30sBase
            ? `ΔBrier ${(le30s.brier - le30sBase.brier).toFixed(4)} · ΔP/L ${fmtDollar(le30s.pnl_usd - le30sBase.pnl_usd)}`
            : "insufficient ≤30s data",
        },
        {
          name: "Max DD not materially worse (≤ baseline + $50)",
          passed: all.max_drawdown_usd <= base.max_drawdown_usd + 50,
          detail: `DD ${fmtDollar(all.max_drawdown_usd)} vs baseline ${fmtDollar(base.max_drawdown_usd)}`,
        },
        {
          name: isSkipping
            ? "Avoided-losses $ ≥ avoided-wins $ (skipping helps)"
            : "N/A (non-skipping policy)",
          passed: isSkipping
            ? Math.abs(all.avoided_losses_usd) >= Math.abs(all.avoided_wins_usd)
            : true,
          detail: isSkipping
            ? `avoided wins ${fmtDollar(all.avoided_wins_usd)} · avoided losses ${fmtDollar(all.avoided_losses_usd)}`
            : "not applicable",
        },
        {
          name: "88% pocket stable (Δ P/L ≥ 0)",
          passed: !pocket || !pocketBase || pocket.pnl_usd >= pocketBase.pnl_usd,
          detail: pocket && pocketBase
            ? `pocket Δ ${fmtDollar(pocket.pnl_usd - pocketBase.pnl_usd)}`
            : "no pocket rows",
        },
        {
          name: "YES/NO symmetry (same-sign Δ P/L)",
          passed: !!yes && !!no && !!yesBase && !!noBase
            && Math.sign(yes.pnl_usd - yesBase.pnl_usd) === Math.sign(no.pnl_usd - noBase.pnl_usd),
          detail: yes && no && yesBase && noBase
            ? `YES Δ ${fmtDollar(yes.pnl_usd - yesBase.pnl_usd)} · NO Δ ${fmtDollar(no.pnl_usd - noBase.pnl_usd)}`
            : "insufficient YES/NO split",
        },
      ];

      const passCount = criteria.filter(c => c.passed).length;
      evaluations.push({
        policy,
        criteria,
        passCount,
        totalCount: criteria.length,
        tradeRetentionPct: tradeRetention,
        summary: `${passCount}/${criteria.length} criteria · trade retention ${(tradeRetention * 100).toFixed(0)}%`,
      });
    }

    // Recommendation: first policy in preference order that passes ≥5/7 criteria
    // when serious-ready, or ≥6/7 when only early-ready.
    const minPass = seriousReady ? 5 : 6;
    const recommended = evaluations.find(e => e.passCount >= minPass) ?? null;

    return {
      state: recommended ? "recommend" as const : "no_edge" as const,
      seriousReady,
      earlyReady,
      recommended,
      evaluations,
      counters: { totalSnaps, totalWindows, calendarDays, le30sSnaps, le30sWindows, contestedSnaps, contestedWindows },
    };
  }, [data]);

  if (!analysis) {
    return (
      <Card className="border-slate-800 bg-slate-900/40">
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-slate-100 text-base">
            <Target className="h-4 w-4 text-slate-500" />
            Jump-Policy Recommendation (shadow-only)
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="text-slate-500 text-xs">Waiting for backtest data…</div>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card className="border-slate-800 bg-slate-900/40">
      <CardHeader className="flex flex-row items-center justify-between">
        <CardTitle className="flex items-center gap-2 text-slate-100 text-base">
          {analysis.state === "recommend"
            ? <ShieldCheck className="h-4 w-4 text-emerald-400" />
            : analysis.state === "no_edge"
              ? <ShieldAlert className="h-4 w-4 text-amber-400" />
              : <ShieldOff className="h-4 w-4 text-slate-500" />}
          Jump-Policy Recommendation (shadow-only)
        </CardTitle>
        {analysis.state !== "not_ready" && (
          <span className="text-[11px] text-slate-500">
            {analysis.seriousReady ? "serious-ready" : "early-ready"}
          </span>
        )}
      </CardHeader>
      <CardContent className="space-y-3 text-xs">
        {analysis.state === "not_ready" && (
          <div className="text-amber-300 border border-amber-500/30 bg-amber-500/10 rounded p-3">
            {analysis.message}
            <div className="mt-2 text-slate-400 text-[11px]">
              {analysis.counters.totalSnaps} snaps · {analysis.counters.totalWindows} windows · {analysis.counters.calendarDays} days
            </div>
          </div>
        )}

        {analysis.state === "no_edge" && (
          <div className="text-slate-300 border border-slate-700 bg-slate-800/40 rounded p-3">
            No policy meets the acceptance bar yet. Baseline stands. See per-policy scorecards below.
          </div>
        )}

        {analysis.state === "recommend" && analysis.recommended && (
          <div className="text-emerald-300 border border-emerald-500/30 bg-emerald-500/10 rounded p-3 space-y-2">
            <div className="font-semibold text-emerald-200">
              Recommended for shadow-mode test: {analysis.recommended.policy}
            </div>
            <div className="text-slate-300">{analysis.recommended.summary}</div>
            <div className="text-slate-400 text-[11px]">
              Expected trade-count vs baseline: {(analysis.recommended.tradeRetentionPct * 100).toFixed(0)}%.
              This is a shadow recommendation only — do not apply to live gates yet.
            </div>
          </div>
        )}

        {analysis.state !== "not_ready" && (
          <details className="text-slate-300">
            <summary className="cursor-pointer text-slate-400 hover:text-slate-200">Per-policy scorecards</summary>
            <div className="mt-2 space-y-3">
              {analysis.evaluations.map(ev => (
                <div key={ev.policy} className="border border-slate-800 rounded p-2 bg-slate-950/40">
                  <div className="flex items-center justify-between">
                    <span className="font-semibold text-slate-200">{ev.policy}</span>
                    <span className="text-[11px] text-slate-500">{ev.summary}</span>
                  </div>
                  <ul className="mt-1.5 space-y-0.5">
                    {ev.criteria.map((c, i) => (
                      <li key={i} className="flex items-start gap-2 text-[11px]">
                        <span className={c.passed ? "text-emerald-400" : "text-rose-400"}>{c.passed ? "✓" : "✗"}</span>
                        <span className="text-slate-300 flex-1">{c.name}</span>
                        <span className="text-slate-500">{c.detail}</span>
                      </li>
                    ))}
                  </ul>
                </div>
              ))}
            </div>
          </details>
        )}

        <div className="text-[10px] text-slate-500 leading-relaxed pt-1 border-t border-slate-800/60">
          Preference order: σ-inflate → larger-edge → skip → compress → (blend excluded). Requires 6/7 criteria at early-ready, 5/7 at serious-ready. Baseline is never auto-replaced — human review required before promoting to live.
        </div>
      </CardContent>
    </Card>
  );
}
