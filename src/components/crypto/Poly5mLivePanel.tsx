// 5m bot REAL-MONEY switch + Polymarket US account + live order log (admin only).
import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { getPolymarketAccount } from "@/lib/polymarketAccount.functions";
import { cn } from "@/lib/utils";

const db = supabase as any;
const usd = (v: number) => `${v < 0 ? "-" : "+"}$${Math.abs(v).toFixed(2)}`;
const tNY = (iso: string, sec = false) => new Date(iso).toLocaleTimeString("en-US", { timeZone: "America/New_York", hour: "numeric", minute: "2-digit", ...(sec ? { second: "2-digit" } : {}) });

export function Poly5mLivePanel({ isAdmin }: { isAdmin: boolean }) {
  const qc = useQueryClient();
  const accFn = useServerFn(getPolymarketAccount);
  const acc = useQuery({ queryKey: ["pm-account"], enabled: isAdmin, refetchInterval: 15_000, queryFn: () => accFn() });
  const live = useQuery({
    queryKey: ["p5-live"],
    enabled: isAdmin,
    refetchInterval: 5000,
    queryFn: async () => {
      const [s, o] = await Promise.all([
        db.from("p5_settings").select("live_enabled,live_stake").eq("id", 1).maybeSingle(),
        db.from("p5_live_orders").select("*").order("created_at", { ascending: false }).limit(40),
      ]);
      return { on: !!s.data?.live_enabled, stake: Number(s.data?.live_stake ?? 10), orders: (o.data ?? []) as any[] };
    },
  });
  const [stakeIn, setStakeIn] = useState("");
  if (!isAdmin) return null;
  const stake = live.data?.stake ?? 10;
  const saveStake = async () => {
    const v = Number(stakeIn);
    if (!(v >= 1 && v <= 1000)) return toast.error("Stake must be $1–$1000");
    const { error } = await db.rpc("p5_set_live_stake", { p_stake: v });
    if (error) return toast.error(error.message);
    toast.success(`Real stake set to $${v}`);
    setStakeIn("");
    qc.invalidateQueries({ queryKey: ["p5-live"] });
  };
  const on = live.data?.on ?? false;

  const toggle = async () => {
    if (!on && !window.confirm("Turn ON real-money 5m trading on Polymarket US?\n\n$${stake} per trade, one per 5-minute window, stops after $500 losses in a NY day.")) return;
    const { error } = await db.rpc("p5_set_live", { p_on: !on });
    if (error) return toast.error(error.message);
    toast.success(!on ? "Real-money 5m trading ON" : "Real-money 5m trading OFF");
    qc.invalidateQueries({ queryKey: ["p5-live"] });
  };

  const a = acc.data;
  return (
    <section className={cn("border rounded-lg p-3 space-y-3 text-xs", on ? "border-destructive" : "border-border")}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="font-semibold">Real money · Polymarket US · ${stake} per trade · $500 daily stop</div>
        <div className="flex items-center gap-1">
          <input className="w-16 bg-background border border-border rounded px-1 py-0.5" placeholder={`$${stake}`} value={stakeIn}
            onChange={(e) => setStakeIn(e.target.value.replace(/[^0-9.]/g, ""))} />
          <button onClick={saveStake} disabled={!stakeIn} className="px-2 py-1 rounded border border-border">Set</button>
        </div>
        <button onClick={toggle} className={cn("px-3 py-1 rounded border font-semibold", on ? "bg-destructive text-destructive-foreground border-destructive" : "border-border bg-muted/30")}>
          {on ? "LIVE ON — tap to stop" : "LIVE OFF"}
        </button>
      </div>
      <div className="grid grid-cols-3 gap-2">
        <Stat label="Connection" value={a ? (a.connected ? "connected" : a.error ?? "offline") : "checking…"} />
        <Stat label="Balance" value={a?.balance != null ? `$${a.balance.toFixed(2)}` : "—"} />
        <Stat label="Open orders" value={a ? String(a.openOrders) : "—"} />
      </div>
      {a?.buyingPower != null && a.buyingPower < stake && <div className="text-destructive">Buying power under your stake — live orders can't fill until you deposit.</div>}
      <div className="max-h-48 overflow-auto">
        <table className="w-full font-mono text-[11px]">
          <thead className="text-muted-foreground"><tr><th className="text-left">Window</th><th>Sent (NY)</th><th>Type</th><th>Side</th><th>Qty</th><th>Px</th><th>State</th><th className="text-right">P&L</th></tr></thead>
          <tbody>
            {(live.data?.orders ?? []).length === 0 && <tr><td colSpan={8} className="text-muted-foreground py-2">No real orders yet.</td></tr>}
            {(live.data?.orders ?? []).map((o) => (
              <tr key={o.id} className="border-t border-border/40" title={o.error ?? ""}>
                <td>{tNY(o.window_start)}</td>
                <td className="text-center">{tNY(o.created_at, true)}</td>
                <td className="text-center">{o.kind === "entry" ? "buy" : o.state}</td>
                <td className={cn("text-center", o.side === "UP" ? "text-primary" : "text-destructive")}>{o.side}</td>
                <td className="text-center">{Number(o.filled_qty)}/{o.quantity}</td>
                <td className="text-center">{Math.round(Number(o.limit_px) * 100)}¢</td>
                <td className="text-center">{o.kind === "entry" ? (o.result ?? o.state) : (Number(o.filled_qty) > 0 ? "sold" : "no fill")}</td>
                <td className={cn("text-right", Number(o.pnl) >= 0 ? "text-primary" : "text-destructive")}>{o.pnl != null && o.kind === "entry" ? usd(Number(o.pnl)) : "—"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="text-[10px] text-muted-foreground">Uses the same signal as the paper bot (first qualifying signal per window, learning blocks apply). Buys at Polymarket's ask, sells at 88¢ bid or on rescue. Paper trading keeps running separately.</div>
    </section>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="border border-border rounded p-2">
      <div className="text-[10px] uppercase tracking-widest text-muted-foreground">{label}</div>
      <div className="font-bold tabular-nums truncate">{value}</div>
    </div>
  );
}
