import { useMemo, useState } from "react";
import { Scale } from "lucide-react";
import {
  HEDGE_RULES,
  evaluateSecondLeg,
  evaluateHedgeExit,
} from "@/lib/opsManual/hedgeEngine";
import { cn } from "@/lib/utils";

const Field = ({
  label,
  value,
  onChange,
  placeholder,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
}) => (
  <label className="flex flex-col gap-1">
    <span className="text-[10px] uppercase tracking-widest text-muted-foreground">{label}</span>
    <input
      value={value}
      onChange={(e) => onChange(e.target.value)}
      inputMode="decimal"
      placeholder={placeholder}
      className="bg-background border border-border rounded px-2 py-1 text-xs"
    />
  </label>
);

const n = (s: string, d = 0) => (s.trim() === "" || !Number.isFinite(Number(s)) ? d : Number(s));

/**
 * Two-sided hedge evaluator. Read-only calculator over the pure hedge engine —
 * it never places, cancels or sizes a live order.
 */
export function OpsHedgePanel() {
  const [f, setF] = useState({
    sideA: "YES",
    sharesA: "100",
    avgCostA: "40",
    sharesB: "0",
    dominant: "45",
    oppAsk: "50",
    secondsLeft: "600",
    sideSpend: "0",
    windowSpend: "0",
    pairBid: "",
    potential: "",
    unrealised: "",
  });
  const set = (k: keyof typeof f) => (v: string) => setF((p) => ({ ...p, [k]: v }));

  const entry = useMemo(
    () =>
      evaluateSecondLeg(
        {
          sideA: f.sideA,
          sharesA: n(f.sharesA),
          avgCostA: n(f.avgCostA),
          sharesB: n(f.sharesB),
          dominantSidePrice: n(f.dominant),
          sideSpendUsd: n(f.sideSpend),
          windowSpendUsd: n(f.windowSpend),
        },
        { oppAskCents: n(f.oppAsk), secondsLeft: n(f.secondsLeft) },
      ),
    [f],
  );

  const exit = useMemo(
    () =>
      evaluateHedgeExit({
        sharesA: n(f.sharesA),
        sharesB: n(f.sharesB),
        pairBidCents: f.pairBid.trim() === "" ? null : n(f.pairBid),
        nakedPotentialProfitUsd: f.potential.trim() === "" ? null : n(f.potential),
        nakedUnrealisedProfitUsd: f.unrealised.trim() === "" ? null : n(f.unrealised),
      }),
    [f],
  );

  const tone =
    entry.decision === "BUY"
      ? "text-emerald-400 border-emerald-500/60"
      : entry.decision === "BLOCK"
        ? "text-red-400 border-red-500/60"
        : "text-orange-400 border-orange-500/60";

  return (
    <div className="border border-border bg-card rounded p-4 space-y-4">
      <div className="terminal-label flex items-center gap-2">
        <Scale className="h-4 w-4" />
        // Two-sided hedge — matched pairs only, never a rescue
      </div>

      <p className="text-xs text-muted-foreground">
        A matched pair settles for exactly $1.00. Open a second leg only when the pair costs
        ≤ {HEDGE_RULES.MAX_PAIR_COST_CENTS}¢ fee- and slippage-inclusive. Any side at
        ≥ {HEDGE_RULES.DOMINANCE_BLOCK_CENTS}¢ blocks the opposite leg outright, and nothing new opens
        inside T−5m.
      </p>

      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
        <label className="flex flex-col gap-1">
          <span className="text-[10px] uppercase tracking-widest text-muted-foreground">Leg A side</span>
          <select
            value={f.sideA}
            onChange={(e) => set("sideA")(e.target.value)}
            className="bg-background border border-border rounded px-2 py-1 text-xs"
          >
            <option value="YES">YES</option>
            <option value="NO">NO</option>
          </select>
        </label>
        <Field label="Leg A shares" value={f.sharesA} onChange={set("sharesA")} />
        <Field label="Leg A avg cost ¢" value={f.avgCostA} onChange={set("avgCostA")} />
        <Field label="Leg B shares held" value={f.sharesB} onChange={set("sharesB")} />
        <Field label="Winning side ¢" value={f.dominant} onChange={set("dominant")} />
        <Field label="Opposite ask ¢" value={f.oppAsk} onChange={set("oppAsk")} />
        <Field label="Seconds left" value={f.secondsLeft} onChange={set("secondsLeft")} />
        <Field label="Spent this side $" value={f.sideSpend} onChange={set("sideSpend")} />
        <Field label="Spent this window $" value={f.windowSpend} onChange={set("windowSpend")} />
      </div>

      <div className={cn("border rounded p-3 space-y-1", tone)}>
        <div className="text-xs font-bold uppercase tracking-widest">{entry.decision}</div>
        <div className="text-xs text-foreground">{entry.message}</div>
        <div className="text-[11px] text-muted-foreground">
          Pair cost {entry.pairCostCents.toFixed(1)}¢ · locked{" "}
          {entry.lockedProfitPerPairCents.toFixed(1)}¢/pair · imbalance {entry.imbalance}
        </div>
      </div>

      <div className="border border-border rounded p-3 space-y-2">
        <div className="terminal-label">// Exit tiers</div>
        <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
          <Field label="Pair combined bid ¢" value={f.pairBid} onChange={set("pairBid")} placeholder="e.g. 99" />
          <Field label="Naked potential profit $" value={f.potential} onChange={set("potential")} placeholder="40" />
          <Field label="Naked unrealised $" value={f.unrealised} onChange={set("unrealised")} placeholder="36.8" />
        </div>
        <div className="text-xs">
          <span className="text-muted-foreground">
            {exit.matchedPairs} matched pair(s) · {exit.nakedShares} naked share(s) —{" "}
          </span>
          <span className={exit.unwindPairs || exit.exitNaked ? "text-emerald-400" : ""}>{exit.message}</span>
        </div>
      </div>
    </div>
  );
}
