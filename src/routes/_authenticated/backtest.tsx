import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/components/auth/AuthProvider";
import { useState } from "react";
import { StatCard } from "@/components/edge/StatCard";
import { Disclaimer } from "@/components/edge/Disclaimer";
import { PatternBadge } from "@/components/edge/PatternBadge";
import { SPORTS } from "@/lib/sports";
import { BarChart, Bar, XAxis, YAxis, ResponsiveContainer, Tooltip, Cell } from "recharts";
import { toast } from "sonner";

export const Route = createFileRoute("/_authenticated/backtest")({
  head: () => ({ meta: [{ title: "Backtest Tracker — EdgeGraph AI" }] }),
  component: Backtest,
});

function Backtest() {
  const { user } = useAuth();
  const [open, setOpen] = useState(false);
  const [fSport, setFSport] = useState("All");
  const [fResult, setFResult] = useState("All");

  const q = useQuery({
    queryKey: ["bets-all", user?.id],
    queryFn: async () => {
      const { data, error } = await supabase.from("bets").select("*").order("date", { ascending: false });
      if (error) throw error;
      return data;
    },
  });
  const bets = (q.data ?? []).filter((b) =>
    (fSport === "All" || b.sport === fSport) && (fResult === "All" || b.result === fResult),
  );

  const settled = bets.filter((b) => b.result === "Win" || b.result === "Loss");
  const wins = settled.filter((b) => b.result === "Win").length;
  const winRate = settled.length ? (wins / settled.length) * 100 : 0;
  const pl = bets.reduce((s, b) => s + Number(b.profit_loss ?? 0), 0);
  const stake = settled.reduce((s, b) => s + Number(b.stake ?? 0), 0);
  const roi = stake ? (pl / stake) * 100 : 0;

  const byPattern: Record<string, { w: number; t: number }> = {};
  for (const b of settled) {
    const p = b.pattern_type ?? "Unknown";
    byPattern[p] ??= { w: 0, t: 0 };
    byPattern[p].t += 1;
    if (b.result === "Win") byPattern[p].w += 1;
  }
  const patternData = Object.entries(byPattern).map(([name, v]) => ({ name, rate: (v.w / v.t) * 100 }));

  const roiBySport = SPORTS.map((s) => {
    const sb = settled.filter((b) => b.sport === s.key);
    const stk = sb.reduce((sum, b) => sum + Number(b.stake ?? 0), 0);
    const p = bets.filter((b) => b.sport === s.key).reduce((sum, b) => sum + Number(b.profit_loss ?? 0), 0);
    return { sport: s.key, roi: stk ? (p / stk) * 100 : 0 };
  });

  return (
    <div className="space-y-5 font-mono">
      <div className="flex justify-between items-center flex-wrap gap-3">
        <h1 className="text-2xl font-bold uppercase tracking-wider">// Backtest Tracker</h1>
        <button
          onClick={() => setOpen(true)}
          className="text-xs uppercase tracking-wider px-3 py-2 border border-[color:var(--color-primary)] text-[color:var(--color-primary)] rounded"
        >
          + Add result
        </button>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <StatCard label="Total Bets" value={bets.length} />
        <StatCard label="Win Rate" value={`${winRate.toFixed(1)}%`} accent={winRate >= 50 ? "primary" : "danger"} />
        <StatCard label="Total P&L" value={`$${pl.toFixed(2)}`} accent={pl >= 0 ? "primary" : "danger"} />
        <StatCard label="ROI" value={`${roi.toFixed(1)}%`} accent={roi >= 0 ? "primary" : "danger"} />
      </div>

      <div className="grid lg:grid-cols-2 gap-4">
        <div className="border border-border bg-card rounded p-4">
          <h2 className="terminal-label mb-3">// Win rate by pattern</h2>
          <div className="h-56">
            <ResponsiveContainer>
              <BarChart data={patternData} layout="vertical" margin={{ left: 50 }}>
                <XAxis type="number" stroke="var(--color-muted-foreground)" fontSize={10} domain={[0, 100]} />
                <YAxis dataKey="name" type="category" stroke="var(--color-muted-foreground)" fontSize={10} width={120} />
                <Tooltip contentStyle={{ background: "var(--color-card)", border: "1px solid var(--color-border)", fontSize: 12 }} />
                <Bar dataKey="rate" fill="var(--color-primary)" />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>
        <div className="border border-border bg-card rounded p-4">
          <h2 className="terminal-label mb-3">// ROI by sport</h2>
          <div className="h-56">
            <ResponsiveContainer>
              <BarChart data={roiBySport}>
                <XAxis dataKey="sport" stroke="var(--color-muted-foreground)" fontSize={10} />
                <YAxis stroke="var(--color-muted-foreground)" fontSize={10} />
                <Tooltip contentStyle={{ background: "var(--color-card)", border: "1px solid var(--color-border)", fontSize: 12 }} />
                <Bar dataKey="roi">
                  {roiBySport.map((d, i) => <Cell key={i} fill={d.roi >= 0 ? "var(--color-primary)" : "var(--color-destructive)"} />)}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>
      </div>

      <div className="border border-border bg-card rounded">
        <div className="p-3 border-b border-border flex flex-wrap gap-2 items-center">
          <span className="terminal-label">// Filters:</span>
          <select className="bg-background border border-border rounded text-xs px-2 py-1" value={fSport} onChange={(e) => setFSport(e.target.value)}>
            <option>All</option>{SPORTS.map((s) => <option key={s.key}>{s.key}</option>)}
          </select>
          <select className="bg-background border border-border rounded text-xs px-2 py-1" value={fResult} onChange={(e) => setFResult(e.target.value)}>
            <option>All</option><option>Win</option><option>Loss</option><option>Push</option><option>Pending</option>
          </select>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead className="text-muted-foreground uppercase tracking-wider">
              <tr className="border-b border-border">
                <th className="text-left p-2">Date</th><th className="text-left p-2">Game</th><th className="text-left p-2">Sport</th>
                <th className="text-left p-2">Pick</th><th className="text-right p-2">Odds</th><th className="text-left p-2">Pattern</th>
                <th className="text-right p-2">Conf</th><th className="text-right p-2">Edge</th>
                <th className="text-left p-2">Result</th><th className="text-right p-2">P&L</th>
              </tr>
            </thead>
            <tbody>
              {bets.map((b) => (
                <tr key={b.id} className="border-b border-border/50">
                  <td className="p-2 text-muted-foreground">{b.date}</td>
                  <td className="p-2">{b.game}</td>
                  <td className="p-2">{b.sport}</td>
                  <td className="p-2">{b.pick}</td>
                  <td className="p-2 text-right">{Number(b.odds ?? 0).toFixed(2)}</td>
                  <td className="p-2"><PatternBadge pattern={b.pattern_type ?? "—"} /></td>
                  <td className="p-2 text-right">{b.confidence_score}%</td>
                  <td className="p-2 text-right">{Number(b.edge_score ?? 0).toFixed(1)}</td>
                  <td className={`p-2 ${b.result === "Win" ? "text-[color:var(--color-primary)]" : b.result === "Loss" ? "text-[color:var(--color-destructive)]" : ""}`}>{b.result}</td>
                  <td className={`p-2 text-right ${Number(b.profit_loss) >= 0 ? "text-[color:var(--color-primary)]" : "text-[color:var(--color-destructive)]"}`}>${Number(b.profit_loss ?? 0).toFixed(2)}</td>
                </tr>
              ))}
              {!bets.length && <tr><td colSpan={10} className="p-6 text-center text-muted-foreground">No bets recorded.</td></tr>}
            </tbody>
          </table>
        </div>
      </div>

      <Disclaimer />
      {open && <BetModal userId={user?.id ?? ""} onClose={() => { setOpen(false); q.refetch(); }} />}
    </div>
  );
}

function BetModal({ userId, onClose }: { userId: string; onClose: () => void }) {
  const [f, setF] = useState({ game: "", sport: "NBA", pick: "", odds: "1.9", stake: "100", pattern_type: "Controlled Stability", confidence_score: "75", edge_score: "5.5", result: "Pending", profit_loss: "0", notes: "" });
  const upd = (k: string, v: string) => setF((p) => ({ ...p, [k]: v }));
  const cls = "w-full bg-background border border-border rounded px-2.5 py-1.5 text-sm font-mono";
  const save = async () => {
    const { error } = await supabase.from("bets").insert({
      user_id: userId, game: f.game, sport: f.sport, pick: f.pick,
      odds: Number(f.odds), stake: Number(f.stake), pattern_type: f.pattern_type,
      confidence_score: Number(f.confidence_score), edge_score: Number(f.edge_score),
      result: f.result, profit_loss: Number(f.profit_loss), notes: f.notes,
    });
    if (error) return toast.error(error.message);
    toast.success("Saved");
    onClose();
  };
  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-black/70 p-4">
      <div className="w-full max-w-lg border border-border bg-card rounded p-5 space-y-3 font-mono">
        <h3 className="text-lg font-bold">Add bet</h3>
        <div className="grid grid-cols-2 gap-3">
          <label><span className="terminal-label">Game</span><input className={cls} value={f.game} onChange={(e) => upd("game", e.target.value)} /></label>
          <label><span className="terminal-label">Sport</span>
            <select className={cls} value={f.sport} onChange={(e) => upd("sport", e.target.value)}>{SPORTS.map((s) => <option key={s.key}>{s.key}</option>)}</select>
          </label>
          <label><span className="terminal-label">Pick</span><input className={cls} value={f.pick} onChange={(e) => upd("pick", e.target.value)} /></label>
          <label><span className="terminal-label">Pattern</span><input className={cls} value={f.pattern_type} onChange={(e) => upd("pattern_type", e.target.value)} /></label>
          <label><span className="terminal-label">Odds</span><input type="number" step="0.01" className={cls} value={f.odds} onChange={(e) => upd("odds", e.target.value)} /></label>
          <label><span className="terminal-label">Stake</span><input type="number" className={cls} value={f.stake} onChange={(e) => upd("stake", e.target.value)} /></label>
          <label><span className="terminal-label">Confidence</span><input type="number" className={cls} value={f.confidence_score} onChange={(e) => upd("confidence_score", e.target.value)} /></label>
          <label><span className="terminal-label">Edge</span><input type="number" step="0.1" className={cls} value={f.edge_score} onChange={(e) => upd("edge_score", e.target.value)} /></label>
          <label><span className="terminal-label">Result</span>
            <select className={cls} value={f.result} onChange={(e) => upd("result", e.target.value)}>
              <option>Pending</option><option>Win</option><option>Loss</option><option>Push</option>
            </select>
          </label>
          <label><span className="terminal-label">P&L</span><input type="number" step="0.01" className={cls} value={f.profit_loss} onChange={(e) => upd("profit_loss", e.target.value)} /></label>
        </div>
        <label className="block"><span className="terminal-label">Notes</span><textarea rows={2} className={cls} value={f.notes} onChange={(e) => upd("notes", e.target.value)} /></label>
        <div className="flex justify-end gap-2">
          <button onClick={onClose} className="px-3 py-1.5 text-xs uppercase tracking-wider border border-border rounded">Cancel</button>
          <button onClick={save} className="px-3 py-1.5 text-xs uppercase tracking-wider border border-[color:var(--color-primary)] text-[color:var(--color-primary)] rounded">Save</button>
        </div>
      </div>
    </div>
  );
}
