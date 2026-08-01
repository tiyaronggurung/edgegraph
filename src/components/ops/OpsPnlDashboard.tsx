import {
  ResponsiveContainer, LineChart, Line, AreaChart, Area, BarChart, Bar,
  XAxis, YAxis, Tooltip, CartesianGrid,
} from "recharts";
import type { OpsDashboard, OpsTradeRow } from "./types";
import { cn } from "@/lib/utils";

const usd = (n: number | null | undefined) =>
  n == null || !Number.isFinite(n) ? "—" : `${n < 0 ? "−" : ""}$${Math.abs(n).toFixed(2)}`;
const pct = (n: number | null | undefined) =>
  n == null || !Number.isFinite(n) ? "—" : `${(n * 100).toFixed(1)}%`;

function Card({ label, value, tone }: { label: string; value: string; tone?: string }) {
  return (
    <div className="border border-border rounded p-2">
      <div className="text-[10px] uppercase tracking-widest text-muted-foreground">{label}</div>
      <div className={cn("text-sm font-bold", tone)}>{value}</div>
    </div>
  );
}

function Chart({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="border border-border rounded p-3">
      <div className="terminal-label mb-2">// {title}</div>
      <div className="h-40">
        <ResponsiveContainer width="100%" height="100%">
          {children as React.ReactElement}
        </ResponsiveContainer>
      </div>
    </div>
  );
}

const AXIS = { stroke: "hsl(var(--muted-foreground))", fontSize: 10 } as const;

export function OpsPnlDashboard({ dash }: { dash: OpsDashboard }) {
  const s = dash.summary;
  const trades = dash.trades as OpsTradeRow[];

  const byHour = new Map<number, { n: number; w: number; pnl: number }>();
  const byCushion = new Map<string, { n: number; w: number; pnl: number }>();
  const bump = (m: Map<string | number, { n: number; w: number; pnl: number }>, k: string | number, t: OpsTradeRow) => {
    const cur = m.get(k) ?? { n: 0, w: 0, pnl: 0 };
    cur.n++; if (t.result === "win") cur.w++;
    cur.pnl = Math.round((cur.pnl + (t.realized_pnl ?? 0)) * 100) / 100;
    m.set(k, cur);
  };
  for (const t of trades) {
    if (t.result !== "win" && t.result !== "loss") continue;
    if (t.utc_hour != null) bump(byHour as never, t.utc_hour, t);
    const c = t.cushion_usd;
    const key = c == null ? "—" : c < 50 ? "$40–49" : c < 60 ? "$50–59" : c < 80 ? "$60–79" : c < 100 ? "$80–99" : "$100+";
    bump(byCushion as never, key, t);
  }
  const hourData = [...byHour.entries()].sort((a, b) => a[0] - b[0]).map(([h, v]) => ({
    hour: String(h).padStart(2, "0"), wr: Math.round((v.w / v.n) * 1000) / 10, pnl: v.pnl,
  }));
  const cushionData = [...byCushion.entries()].map(([k, v]) => ({
    bucket: k, wr: Math.round((v.w / v.n) * 1000) / 10, pnl: v.pnl, n: v.n,
  }));

  return (
    <div className="space-y-4">
      <div className="border border-border bg-card rounded p-4 space-y-3">
        <div className="terminal-label">// P/L and discipline</div>
        <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-6 gap-2">
          <Card label="Current bankroll" value={usd(s.currentBankroll)} />
          <Card label="Morning bankroll" value={usd(dash.morningBankroll)} />
          <Card label="All-time high" value={usd(s.allTimeHigh)} />
          <Card label="Drawdown" value={`${s.drawdownPct.toFixed(1)}%`} tone={s.drawdownPct > 30 ? "text-red-400" : undefined} />
          <Card label="Today P/L" value={usd(s.todayPnl)} tone={s.todayPnl >= 0 ? "text-emerald-400" : "text-red-400"} />
          <Card label="Week P/L" value={usd(s.weekPnl)} tone={s.weekPnl >= 0 ? "text-emerald-400" : "text-red-400"} />
          <Card label="Month P/L" value={usd(s.monthPnl)} tone={s.monthPnl >= 0 ? "text-emerald-400" : "text-red-400"} />
          <Card label="All-time P/L" value={usd(s.allTimePnl)} tone={s.allTimePnl >= 0 ? "text-emerald-400" : "text-red-400"} />
          <Card label="Withdrawn" value={usd(s.withdrawn)} />
          <Card label="Active bankroll" value={usd(s.activeBankroll)} />
          <Card label="Wins" value={String(s.totalWins)} />
          <Card label="Losses" value={String(s.totalLosses)} />
          <Card label="Overall WR" value={pct(s.overallWinRate)} />
          <Card label="Rolling 30 WR" value={pct(s.rolling30Wr)} />
          <Card label="Rolling 100 WR" value={pct(s.rolling100Wr)} />
          <Card label="Discipline score" value={s.avgDisciplineScore == null ? "—" : `${s.avgDisciplineScore.toFixed(0)}%`} tone={(s.avgDisciplineScore ?? 100) < 100 ? "text-orange-400" : "text-emerald-400"} />
        </div>
      </div>

      <div className="grid lg:grid-cols-2 gap-3">
        <Chart title="Bankroll curve">
          <LineChart data={s.bankrollCurve}>
            <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
            <XAxis dataKey="t" hide />
            <YAxis {...AXIS} />
            <Tooltip contentStyle={{ fontSize: 11 }} />
            <Line type="monotone" dataKey="bankroll" stroke="hsl(var(--primary))" dot={false} strokeWidth={2} />
          </LineChart>
        </Chart>
        <Chart title="Drawdown %">
          <AreaChart data={s.drawdownCurve}>
            <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
            <XAxis dataKey="t" hide />
            <YAxis {...AXIS} />
            <Tooltip contentStyle={{ fontSize: 11 }} />
            <Area type="monotone" dataKey="ddPct" stroke="#ef4444" fill="#ef444433" />
          </AreaChart>
        </Chart>
        <Chart title="Daily P/L">
          <BarChart data={s.dailyPnl}>
            <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
            <XAxis dataKey="d" {...AXIS} />
            <YAxis {...AXIS} />
            <Tooltip contentStyle={{ fontSize: 11 }} />
            <Bar dataKey="pnl" fill="hsl(var(--primary))" />
          </BarChart>
        </Chart>
        <Chart title="Weekly P/L">
          <BarChart data={s.weeklyPnl}>
            <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
            <XAxis dataKey="w" {...AXIS} />
            <YAxis {...AXIS} />
            <Tooltip contentStyle={{ fontSize: 11 }} />
            <Bar dataKey="pnl" fill="hsl(var(--primary))" />
          </BarChart>
        </Chart>
        <Chart title="Rolling 30-bet win rate %">
          <LineChart data={s.rolling30Curve}>
            <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
            <XAxis dataKey="i" {...AXIS} />
            <YAxis domain={[0, 100]} {...AXIS} />
            <Tooltip contentStyle={{ fontSize: 11 }} />
            <Line type="monotone" dataKey="wr" stroke="#22c55e" dot={false} />
          </LineChart>
        </Chart>
        <Chart title="Rolling 100-bet win rate %">
          <LineChart data={s.rolling100Curve}>
            <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
            <XAxis dataKey="i" {...AXIS} />
            <YAxis domain={[0, 100]} {...AXIS} />
            <Tooltip contentStyle={{ fontSize: 11 }} />
            <Line type="monotone" dataKey="wr" stroke="#3b82f6" dot={false} />
          </LineChart>
        </Chart>
        <Chart title="Win rate and P/L by UTC hour">
          <BarChart data={hourData}>
            <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
            <XAxis dataKey="hour" {...AXIS} />
            <YAxis {...AXIS} />
            <Tooltip contentStyle={{ fontSize: 11 }} />
            <Bar dataKey="wr" fill="#22c55e" />
            <Bar dataKey="pnl" fill="hsl(var(--primary))" />
          </BarChart>
        </Chart>
        <Chart title="Win rate and P/L by cushion bucket">
          <BarChart data={cushionData}>
            <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
            <XAxis dataKey="bucket" {...AXIS} />
            <YAxis {...AXIS} />
            <Tooltip contentStyle={{ fontSize: 11 }} />
            <Bar dataKey="wr" fill="#22c55e" />
            <Bar dataKey="pnl" fill="hsl(var(--primary))" />
          </BarChart>
        </Chart>
      </div>

      {/* Session table */}
      <div className="border border-border bg-card rounded p-4 space-y-2">
        <div className="terminal-label">// Session ledger — every logged bet</div>
        <div className="overflow-x-auto">
          <table className="w-full text-[11px] font-mono">
            <thead className="text-muted-foreground uppercase tracking-wider">
              <tr className="border-b border-border">
                {["Date", "UTC", "Local", "Window", "Strike", "Side", "Study", "S-conf", "Model", "M-conf", "Spot", "Cushion", "Ask", "Secs", "Stake", "Potential", "Result", "P/L", "Bankroll", "Rules", "Notes"].map((h) => (
                  <th key={h} className="text-left py-1 pr-3 whitespace-nowrap">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {trades.length === 0 && (
                <tr><td colSpan={21} className="py-3 text-muted-foreground">No trades logged yet.</td></tr>
              )}
              {trades.map((t) => {
                const d = new Date(t.decision_at);
                return (
                  <tr key={t.id} className="border-b border-border/40">
                    <td className="py-1 pr-3 whitespace-nowrap">{t.session_date}</td>
                    <td className="py-1 pr-3 whitespace-nowrap">{d.toISOString().slice(11, 16)}</td>
                    <td className="py-1 pr-3 whitespace-nowrap">{d.toLocaleTimeString()}</td>
                    <td className="py-1 pr-3 whitespace-nowrap">{t.ticker}</td>
                    <td className="py-1 pr-3">{t.strike ?? "—"}</td>
                    <td className="py-1 pr-3">{t.side ?? "—"}</td>
                    <td className="py-1 pr-3">{t.study_side ?? "—"}</td>
                    <td className="py-1 pr-3">{t.study_conf ?? "—"}</td>
                    <td className="py-1 pr-3">{t.model_side ?? "—"}</td>
                    <td className="py-1 pr-3">{t.model_conf ?? "—"}</td>
                    <td className="py-1 pr-3">{t.spot_at_lock ?? "—"}</td>
                    <td className="py-1 pr-3">{t.cushion_usd == null ? "—" : `$${Number(t.cushion_usd).toFixed(0)}`}</td>
                    <td className="py-1 pr-3">{t.ask_cents == null ? "—" : `${t.ask_cents}¢`}</td>
                    <td className="py-1 pr-3">{t.seconds_left ?? "—"}</td>
                    <td className="py-1 pr-3">{usd(t.stake)}</td>
                    <td className="py-1 pr-3">{usd(t.potential_profit)}</td>
                    <td className={cn("py-1 pr-3 uppercase", t.result === "win" ? "text-emerald-400" : t.result === "loss" ? "text-red-400" : "")}>{t.result ?? "open"}</td>
                    <td className={cn("py-1 pr-3", (t.realized_pnl ?? 0) >= 0 ? "text-emerald-400" : "text-red-400")}>{usd(t.realized_pnl)}</td>
                    <td className="py-1 pr-3">{usd(t.bankroll_after)}</td>
                    <td className={cn("py-1 pr-3", t.rule_status === "compliant" ? "text-emerald-400" : "text-red-400")}>
                      {t.rule_status === "compliant" ? "OK 100%" : `${t.discipline_score}% · ${t.violations.join(",")}`}
                    </td>
                    <td className="py-1 pr-3 max-w-[200px] truncate">{t.notes ?? ""}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        <p className="text-[11px] text-muted-foreground">
          A <b className="text-foreground">strategy loss</b> is a compliant trade that lost. A{" "}
          <b className="text-red-400">discipline loss</b> is any row whose rule column is not 100%.
        </p>
      </div>
    </div>
  );
}
