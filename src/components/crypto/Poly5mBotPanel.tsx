// 5m Polymarket paper bot panel (PAPER ONLY): switch, stake, status, trade log, situation table.
import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { cn } from "@/lib/utils";
import { MIN_SAMPLES, breakEven, smoothedWinRate } from "@/lib/poly5mBot/learn";

const db = supabase as any;
const usd = (v: number) => `${v < 0 ? "-" : "+"}$${Math.abs(v).toFixed(2)}`;
const nyDay = (d: Date) => d.toLocaleDateString("en-US", { timeZone: "America/New_York" });

export function Poly5mBotPanel({ isAdmin }: { isAdmin: boolean }) {
  const qc = useQueryClient();
  const [stakeIn, setStakeIn] = useState<string>("");
  const { data } = useQuery({
    queryKey: ["poly5m-bot"],
    enabled: isAdmin,
    refetchInterval: 5000,
    queryFn: async () => {
      const [s, pos, sit] = await Promise.all([
        db.from("p5_settings").select("*").eq("id", 1).maybeSingle(),
        db.from("p5_positions").select("*").order("window_start", { ascending: false }).limit(50),
        db.from("p5_situations").select("*").order("n", { ascending: false }).limit(60),
      ]);
      return { s: s.data, pos: (pos.data ?? []) as any[], sit: (sit.data ?? []) as any[] };
    },
  });
  if (!isAdmin) return null;
  const s = data?.s;
  const pos = data?.pos ?? [];
  const today = nyDay(new Date());
  const todays = pos.filter((p) => p.settled && p.pnl != null && nyDay(new Date(p.window_start)) === today);
  const pnlToday = todays.reduce((a, p) => a + Number(p.pnl), 0);
  const winsToday = todays.filter((p) => Number(p.pnl) > 0).length;

  const save = async (running: boolean) => {
    const stake = stakeIn ? Number(stakeIn) : Number(s?.stake ?? 10);
    const { error } = await db.rpc("p5_update_settings", { p_running: running, p_stake: stake });
    if (error) return toast.error(error.message);
    toast.success(running ? "5m paper bot on" : "5m paper bot off");
    setStakeIn("");
    qc.invalidateQueries({ queryKey: ["poly5m-bot"] });
  };

  const st = s?.last_status;
  return (
    <section className="border border-border rounded-lg p-3 space-y-3 text-xs">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="font-semibold">5m paper bot · Strategy 3 (65% entry · 88¢ TP · 38% rescue) — learns by situation</div>
        <div className="flex items-center gap-2">
          <input
            className="w-16 bg-background border border-border rounded px-1 py-0.5"
            placeholder={`$${Number(s?.stake ?? 10)}`}
            value={stakeIn}
            onChange={(e) => setStakeIn(e.target.value.replace(/[^0-9.]/g, ""))}
          />
          <button onClick={() => save(!s?.running)} className={cn("px-3 py-1 rounded border border-border", s?.running ? "bg-primary text-primary-foreground" : "bg-muted/30")}>
            {s?.running ? "ON (paper)" : "OFF"}
          </button>
        </div>
      </div>
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
        <Stat label="Today P&L" value={usd(pnlToday)} tone={pnlToday >= 0 ? "up" : "down"} />
        <Stat label="Today win rate" value={todays.length ? `${Math.round((winsToday / todays.length) * 100)}% (${todays.length})` : "—"} />
        <Stat label="Our UP now" value={st?.up != null ? `${(st.up * 100).toFixed(1)}%` : "—"} />
        <Stat label="Status" value={st?.status ?? "waiting for first tick"} />
      </div>

      <div>
        <div className="font-semibold mb-1">Trade log</div>
        <div className="max-h-56 overflow-auto">
          <table className="w-full font-mono text-[11px]">
            <thead className="text-muted-foreground"><tr><th className="text-left">Window</th><th>Entered (NY)</th><th>Side</th><th>Ct</th><th>Entry</th><th>Exit</th><th>Result</th><th className="text-right">P&L</th></tr></thead>
            <tbody>
              {pos.length === 0 && <tr><td colSpan={8} className="text-muted-foreground py-2">No paper trades yet.</td></tr>}
              {pos.map((p) => (
                <tr key={p.id} className="border-t border-border/40">
                  <td>{new Date(p.window_start).toLocaleTimeString("en-US", { timeZone: "America/New_York", hour: "numeric", minute: "2-digit" })}</td>
                  <td className="text-center">{p.opened_at ? new Date(p.opened_at).toLocaleTimeString("en-US", { timeZone: "America/New_York", hour: "numeric", minute: "2-digit", second: "2-digit" }) : "—"}</td>
                  <td className={cn("text-center", p.side === "UP" ? "text-primary" : "text-destructive")}>{p.side}</td>
                  <td className="text-center">{p.contracts}</td>
                  <td className="text-center">{Math.round(Number(p.entry_px) * 100)}¢</td>
                  <td className="text-center">{p.exit_kind ?? (p.hedge_contracts ? "hedged" : "open")}</td>
                  <td className="text-center">{p.result ?? "—"}</td>
                  <td className={cn("text-right", Number(p.pnl) >= 0 ? "text-primary" : "text-destructive")}>{p.pnl != null ? usd(Number(p.pnl)) : "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      <div>
        <div className="font-semibold mb-1">Situations (traded + shadow, held to settle) — blocked after {MIN_SAMPLES} results if not beating price</div>
        <div className="max-h-64 overflow-auto">
          <table className="w-full font-mono text-[11px]">
            <thead className="text-muted-foreground"><tr><th className="text-left">Situation</th><th>N</th><th>Win%</th><th>Avg px</th><th>$/$1</th><th>State</th></tr></thead>
            <tbody>
              {(data?.sit ?? []).length === 0 && <tr><td colSpan={6} className="text-muted-foreground py-2">Collecting first results…</td></tr>}
              {(data?.sit ?? []).map((r) => {
                const stats = { n: r.n, wins: r.wins, px_sum: Number(r.px_sum), pnl_per_dollar_sum: Number(r.pnl_per_dollar_sum) };
                return (
                  <tr key={r.key} className="border-t border-border/40">
                    <td className="text-left">{r.key}</td>
                    <td className="text-center">{r.n}</td>
                    <td className="text-center">{r.n ? Math.round((r.wins / r.n) * 100) : 0}% <span className="text-muted-foreground">({Math.round(smoothedWinRate(stats) * 100)})</span></td>
                    <td className="text-center">{Math.round((breakEven(stats) - 0.01) * 100)}¢</td>
                    <td className="text-center">{r.n ? (Number(r.pnl_per_dollar_sum) / r.n).toFixed(2) : "—"}</td>
                    <td className={cn("text-center", r.allowed ? "text-primary" : "text-destructive")}>{r.n < MIN_SAMPLES ? "learning" : r.allowed ? "allowed" : "blocked"}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>
      <div className="text-[10px] text-muted-foreground">Paper only — fills at Polymarket US asks; no real orders. Doesn't affect 15m odds, A/B/C, Model, Study or live engines.</div>
    </section>
  );
}

function Stat({ label, value, tone }: { label: string; value: string; tone?: "up" | "down" }) {
  return (
    <div className="border border-border rounded p-2">
      <div className="text-[10px] uppercase tracking-widest text-muted-foreground">{label}</div>
      <div className={cn("font-bold tabular-nums truncate", tone === "up" && "text-primary", tone === "down" && "text-destructive")}>{value}</div>
    </div>
  );
}
