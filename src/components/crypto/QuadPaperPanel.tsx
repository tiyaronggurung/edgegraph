// Quad-Confirmation paper engine panel: signals, per-strategy scorecard,
// month-by-month results (real paper results only), and recent fills.
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { cn } from "@/lib/utils";

const db = supabase as any;
const usd = (v: number) => `${v < 0 ? "-" : "+"}$${Math.abs(v).toFixed(2)}`;
const NAMES: Record<string, string> = {
  A: "A · Quad entry (ride)",
  B: "B · Pair-lock ≤85¢",
  C: "C · Quad + late tiebreaker + hedge",
};

function Pill({ label, v }: { label: string; v: string | null | undefined }) {
  const tone = v === "UP" ? "text-primary" : v === "DOWN" ? "text-destructive" : "text-muted-foreground";
  return (
    <div className="border border-border rounded-md px-2 py-1">
      <div className="text-[9px] uppercase tracking-widest text-muted-foreground">{label}</div>
      <div className={cn("text-sm font-bold", tone)}>{v ?? "null"}</div>
    </div>
  );
}

export function QuadPaperPanel({ isAdmin }: { isAdmin: boolean }) {
  const qc = useQueryClient();
  const { data } = useQuery({
    queryKey: ["quad-paper"],
    refetchInterval: 2000,
    queryFn: async () => {
      const [s, pos, fills] = await Promise.all([
        db.from("qc_settings").select("*").eq("id", 1).maybeSingle(),
        db.from("qc_positions").select("*").order("window_start", { ascending: false }).limit(1000),
        db.from("qc_fills").select("*").order("id", { ascending: false }).limit(40),
      ]);
      return { s: s.data, pos: (pos.data ?? []) as any[], fills: (fills.data ?? []) as any[] };
    },
  });
  const s = data?.s;
  const sig = s?.last_signals ?? {};
  const pos = data?.pos ?? [];

  const toggle = async () => {
    const { error } = await db.rpc("qc_set_running", { p_running: !s?.running });
    if (error) return toast.error(error.message);
    toast.success(!s?.running ? "Quad paper engine started" : "Quad paper engine paused");
    qc.invalidateQueries({ queryKey: ["quad-paper"] });
  };

  const score = (["A", "B", "C"] as const).map((k) => {
    const rows = pos.filter((p) => p.strategy === k);
    const settled = rows.filter((p) => p.settled);
    const wins = settled.filter((p) => Number(p.pnl) > 0).length;
    const openCost = rows.filter((p) => !p.settled).reduce((a, p) => a + Number(p.up_cost) + Number(p.down_cost), 0);
    return {
      k, n: settled.length, wins, locks: rows.filter((p) => p.locked).length, openCost,
      pnl: settled.reduce((a, p) => a + Number(p.pnl ?? 0), 0),
    };
  });

  const months = new Map<string, Record<string, number>>();
  for (const p of pos) {
    if (!p.settled) continue;
    const m = String(p.window_start).slice(0, 7);
    const r = months.get(m) ?? { A: 0, B: 0, C: 0 };
    r[p.strategy] += Number(p.pnl ?? 0);
    months.set(m, r);
  }

  const w = sig.whale;
  return (
    <section className="border border-border rounded-lg p-4 space-y-4">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div>
          <div className="font-bold">Quad-Confirmation paper test</div>
          <div className="text-[11px] text-muted-foreground">
            Paper money only · $150 first leg + $150 hedge · checks every ~2s ·{" "}
            {s?.running ? "running" : "paused"}
            {s?.last_error ? ` · ${s.last_error}` : ""}
          </div>
        </div>
        {isAdmin && s && (
          <button onClick={toggle} className="px-3 py-1.5 rounded-md border border-border text-sm font-semibold hover:bg-muted">
            {s.running ? "Pause" : "Start"}
          </button>
        )}
      </div>

      <div className="grid grid-cols-3 md:grid-cols-6 gap-2">
        <Pill label={`Whale ${w ? `${Math.round((w.share ?? 0) * 100)}%` : ""}`} v={w?.side} />
        <Pill label="Study" v={sig.study} />
        <Pill label="Model" v={sig.model} />
        <Pill label={`Odds ${sig.pUp != null ? `${Math.round(sig.pUp * 100)}% up` : ""}`} v={sig.oddsSide} />
        <Pill label="Quad" v={sig.quad} />
        <Pill label="Late tiebreak" v={sig.late} />
      </div>

      <div className="grid md:grid-cols-3 gap-3">
        {score.map((r) => (
          <div key={r.k} className="border border-border rounded-lg p-3">
            <div className="text-xs font-semibold">{NAMES[r.k]}</div>
            <div className={cn("text-2xl font-bold mt-1", r.pnl >= 0 ? "text-primary" : "text-destructive")}>{usd(r.pnl)}</div>
            <div className="text-[11px] text-muted-foreground">
              {r.wins}/{r.n} won · {r.locks} locked pairs · open ${r.openCost.toFixed(2)}
            </div>
          </div>
        ))}
      </div>

      <div>
        <div className="text-[10px] uppercase tracking-widest text-muted-foreground mb-1">Month by month (real paper results from this engine)</div>
        {months.size === 0 ? (
          <div className="text-xs text-muted-foreground">No settled windows yet — results fill in as the engine runs.</div>
        ) : (
          <table className="w-full text-xs">
            <thead><tr className="text-muted-foreground text-left"><th>Month</th><th>A</th><th>B</th><th>C</th></tr></thead>
            <tbody>
              {[...months.entries()].map(([m, r]) => (
                <tr key={m}><td>{m}</td><td>{usd(r.A)}</td><td>{usd(r.B)}</td><td>{usd(r.C)}</td></tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      <div>
        <div className="text-[10px] uppercase tracking-widest text-muted-foreground mb-1">Recent paper fills</div>
        <div className="max-h-64 overflow-auto text-xs space-y-1">
          {(data?.fills ?? []).map((f) => (
            <div key={f.id} className="flex gap-2 border-b border-border/50 py-1">
              <span className="font-bold w-4">{f.strategy}</span>
              <span className="w-14">{f.kind}</span>
              <span className="w-12">{f.side}</span>
              <span className="w-24">{f.contracts ? `${f.contracts} @ ${Math.round(Number(f.price) * 100)}¢` : ""}</span>
              <span className="flex-1 text-muted-foreground truncate">{f.reason}</span>
              <span className="text-muted-foreground">{new Date(f.created_at).toLocaleTimeString()}</span>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}
