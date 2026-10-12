import { useMemo, useState } from "react";
import { CartesianGrid, Line, LineChart, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { buildQuadPnlPoints, QUAD_STRATEGIES, type QuadPnlPoint, type QuadPnlPosition, type QuadStrategy } from "./quadPnlData";

const SERIES = {
  A: { color: "var(--chart-1)", text: "text-chart-1", dot: "bg-chart-1", name: "Quad entry" },
  B: { color: "var(--chart-2)", text: "text-chart-2", dot: "bg-chart-2", name: "Pair-lock" },
  C: { color: "var(--chart-3)", text: "text-chart-3", dot: "bg-chart-3", name: "Quad + late + hedge" },
};
const money = (value: number) => `${value < 0 ? "−" : "+"}$${Math.abs(value).toFixed(2)}`;
const clock = (time: number) => new Date(time).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", hour12: false });

function PnlTooltip({ active, payload, visible }: {
  active?: boolean;
  payload?: { payload: QuadPnlPoint }[];
  visible: Record<QuadStrategy, boolean>;
}) {
  const point = payload?.[0]?.payload;
  if (!active || !point) return null;
  return (
    <div className="rounded-md border border-border bg-popover p-3 text-xs shadow-sm">
      <div className="mb-2 text-muted-foreground">{new Date(point.time).toLocaleDateString()} · {clock(point.time)} UTC</div>
      <div className="grid grid-cols-[auto_auto_auto] gap-x-4 gap-y-1">
        <span /><span className="text-muted-foreground">Total P&L</span><span className="text-muted-foreground">15m P&L</span>
        {QUAD_STRATEGIES.filter((s) => visible[s]).map((s) => (
          <div key={s} className="contents">
            <span className={SERIES[s].text}>{s}</span>
            <span>{money(point[s])}</span><span>{money(point[`window${s}`])}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

export function QuadPaperPnlChart({ positions }: { positions: QuadPnlPosition[] }) {
  const points = useMemo(() => buildQuadPnlPoints(positions), [positions]);
  const [visible, setVisible] = useState<Record<QuadStrategy, boolean>>({ A: true, B: true, C: true });
  const latest = points.at(-1);
  const anyVisible = QUAD_STRATEGIES.some((s) => visible[s]);
  return (
    <div className="min-w-0 space-y-3 border-t border-border pt-4" aria-label="Quad paper P&L chart">
      <div>
        <h3 className="text-sm font-semibold">A/B/C paper profit & loss</h3>
        <p className="text-[11px] text-muted-foreground">Cumulative settled paper P&L · 15-minute window closes · UTC · most recent 1,000 positions</p>
      </div>
      <div className="flex flex-wrap gap-2" aria-label="Strategy legends">
        {QUAD_STRATEGIES.map((s) => (
          <Button key={s} variant="outline" size="sm" aria-label={`Show strategy ${s}`} aria-pressed={visible[s]}
            title={SERIES[s].name}
            onClick={() => setVisible((current) => ({ ...current, [s]: !current[s] }))}
            className={cn("gap-2 tabular-nums", !visible[s] && "opacity-40")}>
            <span className={cn("h-2 w-2 rounded-full", SERIES[s].dot)} />
            <span>{s}</span><span className={SERIES[s].text}>{latest ? money(latest[s]) : "—"}</span>
          </Button>
        ))}
      </div>
      <div className="h-64 w-full min-w-0 sm:h-72">
        {!points.length ? (
          <div className="flex h-full items-center justify-center text-xs text-muted-foreground">No settled paper windows yet.</div>
        ) : !anyVisible ? (
          <div className="flex h-full items-center justify-center text-xs text-muted-foreground">No strategies selected.</div>
        ) : (
          <ResponsiveContainer width="100%" height="100%">
            <LineChart data={points} margin={{ top: 12, right: 12, left: 0, bottom: 4 }}>
              <CartesianGrid stroke="var(--border)" strokeDasharray="2 4" vertical={false} />
              <XAxis dataKey="time" type="number" domain={["dataMin", "dataMax"]} tickFormatter={clock}
                stroke="var(--muted-foreground)" tick={{ fontSize: 10 }} minTickGap={35} />
              <YAxis tickFormatter={(v: number) => `$${v.toLocaleString()}`} width={65}
                stroke="var(--muted-foreground)" tick={{ fontSize: 10 }} domain={["auto", "auto"]} />
              <ReferenceLine y={0} stroke="var(--muted-foreground)" strokeDasharray="4 4" />
              <Tooltip content={<PnlTooltip visible={visible} />} />
              {QUAD_STRATEGIES.filter((s) => visible[s]).map((s) => (
                <Line key={s} dataKey={s} name={s} type="stepAfter" stroke={SERIES[s].color}
                  strokeWidth={2} dot={points.length < 3} activeDot={{ r: 4 }} isAnimationActive={false} />
              ))}
            </LineChart>
          </ResponsiveContainer>
        )}
      </div>
    </div>
  );
}