// Polymarket-style paper account: $10,000 start, equity curve, auto-buy control.
// Purely simulated today — the same chart will render real money later.
import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { Area, AreaChart, CartesianGrid, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { Bot, RotateCcw, Wallet } from "lucide-react";
import { toast } from "sonner";
import {
  getPaperKalshiEquityCurve,
  updatePaperKalshiAccount,
  type PaperAccount,
} from "@/lib/paperKalshi.functions";
import { cn } from "@/lib/utils";

const usd = (cents: number) =>
  `${cents < 0 ? "-" : ""}$${Math.abs(cents / 100).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

const hhmm = (t: string) =>
  new Date(t).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });

export function OpsPaperPnlChart({ autoBuyStatus }: { autoBuyStatus?: string | null }) {
  const qc = useQueryClient();
  const curveFn = useServerFn(getPaperKalshiEquityCurve);
  const updateFn = useServerFn(updatePaperKalshiAccount);
  const [busy, setBusy] = useState(false);

  const q = useQuery({
    queryKey: ["paper-kalshi-equity"],
    queryFn: () => curveFn({ data: { limit: 500 } }),
    refetchInterval: 20_000,
  });

  const acct: PaperAccount | undefined = q.data?.account;
  const points = (q.data?.points ?? []).map((p) => ({
    ...p,
    equity: p.equityCents / 100,
    time: hhmm(p.t),
  }));

  const pnl = acct ? acct.equityCents - acct.startingCents : 0;
  const up = pnl >= 0;

  const patch = async (data: Parameters<typeof updateFn>[0]["data"], label: string) => {
    setBusy(true);
    try {
      await updateFn({ data });
      toast.success(label);
      qc.invalidateQueries({ queryKey: ["paper-kalshi-equity"] });
      qc.invalidateQueries({ queryKey: ["paper-kalshi-positions"] });
      qc.invalidateQueries({ queryKey: ["paper-kalshi-events"] });
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="border border-border rounded-lg p-4 space-y-4 font-mono">
      <header className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <Wallet className="h-4 w-4 text-[color:var(--color-primary)]" />
          <h2 className="text-sm font-bold uppercase tracking-widest">// Paper account P/L</h2>
        </div>
        <div className="flex items-center gap-3 text-xs">
          <label className="flex items-center gap-2">
            <Bot className="h-3.5 w-3.5 text-muted-foreground" />
            <span className="text-[10px] uppercase tracking-widest text-muted-foreground">Auto-buy</span>
            <input
              type="checkbox"
              disabled={busy || !acct}
              checked={!!acct?.autoBuy}
              onChange={(e) => patch({ autoBuy: e.target.checked }, e.target.checked ? "Auto-buy on" : "Auto-buy off")}
            />
          </label>
          <button
            disabled={busy}
            onClick={() => {
              if (!confirm("Reset the paper book and start again from $10,000?")) return;
              void patch({ reset: true }, "Paper account reset to $10,000");
            }}
            className="flex items-center gap-1 text-[10px] uppercase tracking-widest text-muted-foreground hover:text-foreground"
          >
            <RotateCcw className="h-3 w-3" /> Reset $10k
          </button>
        </div>
      </header>

      <div className="grid grid-cols-2 md:grid-cols-5 gap-3 text-xs">
        <Cell label="Equity" value={acct ? usd(acct.equityCents) : "—"} strong />
        <Cell
          label="Net P/L"
          value={acct ? `${up ? "+" : "-"}${usd(Math.abs(pnl)).replace("-", "")}` : "—"}
          tone={acct ? (up ? "good" : "bad") : undefined}
          strong
        />
        <Cell label="Cash free" value={acct ? usd(acct.cashCents) : "—"} />
        <Cell label="In market" value={acct ? usd(acct.exposureCents) : "—"} />
        <Cell label="Open legs" value={acct ? String(acct.openPositions) : "—"} />
      </div>

      <div className="h-56 w-full">
        <ResponsiveContainer width="100%" height="100%">
          <AreaChart data={points} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
            <defs>
              <linearGradient id="paperEquityFill" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor={up ? "#22c55e" : "#ef4444"} stopOpacity={0.35} />
                <stop offset="100%" stopColor={up ? "#22c55e" : "#ef4444"} stopOpacity={0} />
              </linearGradient>
            </defs>
            <CartesianGrid strokeDasharray="2 4" stroke="currentColor" className="text-border" vertical={false} />
            <XAxis dataKey="time" tick={{ fontSize: 10 }} stroke="currentColor" className="text-muted-foreground" minTickGap={24} />
            <YAxis
              tick={{ fontSize: 10 }}
              stroke="currentColor"
              className="text-muted-foreground"
              domain={["auto", "auto"]}
              width={64}
              tickFormatter={(v: number) => `$${v.toLocaleString()}`}
            />
            <Tooltip
              contentStyle={{ fontSize: 11, fontFamily: "monospace", background: "hsl(var(--background))", border: "1px solid hsl(var(--border))" }}
              formatter={(v: number) => [`$${v.toLocaleString(undefined, { minimumFractionDigits: 2 })}`, "Equity"]}
              labelFormatter={(l: string, p: any) => `${l} · ${p?.[0]?.payload?.label ?? ""}`}
            />
            {acct && (
              <ReferenceLine
                y={acct.startingCents / 100}
                stroke="currentColor"
                className="text-muted-foreground"
                strokeDasharray="3 3"
              />
            )}
            <Area
              type="monotone"
              dataKey="equity"
              stroke={up ? "#22c55e" : "#ef4444"}
              strokeWidth={2}
              fill="url(#paperEquityFill)"
              isAnimationActive={false}
            />
          </AreaChart>
        </ResponsiveContainer>
      </div>

      <p className="text-[10px] text-muted-foreground leading-relaxed">
        Auto-buy fires one entry per 15m window when every requirement lines up: T−8m to T−2m,
        model and study agree, study confidence ≥ {acct ? (acct.minConf * 100).toFixed(0) : 75}%,
        cushion ≥ ${acct?.minCushionUsd ?? 40} on the picked side, ask ≤ {acct?.maxAskCents ?? 70}¢,
        {" "}{acct?.autoBuyContracts ?? 10} contracts, and enough paper cash.
        {autoBuyStatus ? ` · Last check: ${autoBuyStatus}` : ""}
      </p>
    </section>
  );
}

function Cell({ label, value, tone, strong }: { label: string; value: string; tone?: "good" | "bad"; strong?: boolean }) {
  return (
    <div className="border border-border rounded p-2">
      <div className="text-[10px] uppercase tracking-widest text-muted-foreground">{label}</div>
      <div
        className={cn(
          "mt-0.5",
          strong ? "text-base font-bold" : "text-sm",
          tone === "good" && "text-green-400",
          tone === "bad" && "text-red-400",
        )}
      >
        {value}
      </div>
    </div>
  );
}
