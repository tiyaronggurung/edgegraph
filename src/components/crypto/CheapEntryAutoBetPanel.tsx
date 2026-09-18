// Cheap Entry Auto-Bet (paper) — server-driven, no browser loop.
// The cron tick does the buying; this panel is the switch, the stake and the
// forward record. Paper only, never touches the live Study auto-bet.
import { useEffect, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { useQuery, useQueryClient, keepPreviousData } from "@tanstack/react-query";
import { toast } from "sonner";
import {
  getCheapEntrySettings,
  setCheapEntryEnabled,
  setCheapEntryStake,
  setCheapEntryLive,
  getCheapEntryStats,
  getCheapEntrySkips,
} from "@/lib/cheapEntryAutoBet.functions";
import { Switch } from "@/components/ui/switch";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";

const money = (cents: number) => `${cents < 0 ? "-" : ""}$${(Math.abs(cents) / 100).toFixed(2)}`;

export function CheapEntryAutoBetPanel() {
  const settingsFn = useServerFn(getCheapEntrySettings);
  const statsFn = useServerFn(getCheapEntryStats);
  const skipsFn = useServerFn(getCheapEntrySkips);
  const setEnabledFn = useServerFn(setCheapEntryEnabled);
  const setStakeFn = useServerFn(setCheapEntryStake);
  const setLiveFn = useServerFn(setCheapEntryLive);
  const qc = useQueryClient();

  const settings = useQuery({
    queryKey: ["cheap-entry-settings"],
    queryFn: () => settingsFn(),
    refetchOnWindowFocus: true,
    placeholderData: keepPreviousData,
  });

  const stats = useQuery({
    queryKey: ["cheap-entry-stats"],
    queryFn: () => statsFn(),
    refetchInterval: 20_000,
    refetchIntervalInBackground: true,
    refetchOnWindowFocus: true,
    placeholderData: keepPreviousData,
  });

  const skips = useQuery({
    queryKey: ["cheap-entry-skips"],
    queryFn: () => skipsFn(),
    refetchInterval: 30_000,
    placeholderData: keepPreviousData,
  });

  const [stakeUsd, setStakeUsd] = useState("10");
  useEffect(() => {
    if (settings.data) setStakeUsd((settings.data.stakeCents / 100).toFixed(0));
  }, [settings.data?.stakeCents]);

  async function toggle(on: boolean) {
    const res = await setEnabledFn({ data: { enabled: on } });
    if (!res.ok) { toast.error(res.error); return; }
    toast.success(on ? "Cheap Entry auto-bet ON (paper)" : "Cheap Entry auto-bet off");
    qc.invalidateQueries({ queryKey: ["cheap-entry-settings"] });
  }

  async function toggleLive(on: boolean) {
    const res = await setLiveFn({ data: { live: on } });
    if (!res.ok) { toast.error(res.error); return; }
    toast.success(on ? "REAL MONEY mode ON — live Kalshi orders" : "Back to paper money");
    qc.invalidateQueries({ queryKey: ["cheap-entry-settings"] });
  }

  async function saveStake() {
    const cents = Math.round(Number(stakeUsd) * 100);
    if (!Number.isFinite(cents) || cents < 100 || cents > 10000) {
      toast.error("Stake must be between $1 and $100");
      return;
    }
    const res = await setStakeFn({ data: { stakeCents: cents } });
    if (!res.ok) { toast.error(res.error); return; }
    toast.success(`Stake set to $${(cents / 100).toFixed(2)}`);
    qc.invalidateQueries({ queryKey: ["cheap-entry-settings"] });
  }

  const t = stats.data?.total;
  const s = stats.data?.study;
  const m = stats.data?.model;

  const Bucket = ({ label, b }: { label: string; b: typeof t }) => (
    <div className="rounded border border-border/60 p-2">
      <div className="text-[10px] uppercase tracking-widest text-muted-foreground">{label}</div>
      <div className={`text-sm font-bold ${(b?.pnlCents ?? 0) >= 0 ? "text-emerald-400" : "text-red-400"}`}>
        {money(b?.pnlCents ?? 0)}
      </div>
      <div className="text-[10px] text-muted-foreground">
        {b?.fires ?? 0} bets · {b?.wins ?? 0}W/{b?.losses ?? 0}L
        {b?.open ? ` · ${b.open} open` : ""}
        {b?.avgEntryCents ? ` · avg ${b.avgEntryCents}¢` : ""}
      </div>
    </div>
  );

  return (
    <div className="rounded-lg border border-border bg-card p-3 space-y-3">
      <div className="flex items-center justify-between gap-2">
        <div>
          <div className="text-xs uppercase tracking-widest font-bold flex items-center gap-2">
            Cheap Entry Auto-Bet
            {settings.data?.live && (
              <span className="rounded bg-red-500/15 px-1.5 py-0.5 text-[9px] font-bold text-red-400">
                REAL MONEY
              </span>
            )}
          </div>
          <div className="text-[10px] text-muted-foreground">
            buys 20–65¢ · study side after lock, model side inside T-8m
          </div>
        </div>
        <Switch checked={!!settings.data?.enabled} onCheckedChange={toggle} />
      </div>

      <div className="flex items-center justify-between gap-2 rounded border border-red-500/30 bg-red-500/5 px-2 py-1.5">
        <div className="text-[10px]">
          <div className="font-bold uppercase tracking-widest text-red-400">Live (real money)</div>
          <div className="text-muted-foreground">
            {settings.data?.live
              ? "Real Kalshi orders are placed automatically."
              : settings.data?.hasKeys
                ? "Off — paper fills only."
                : "Add your Kalshi keys in Settings to enable."}
          </div>
        </div>
        <Switch
          checked={!!settings.data?.live}
          disabled={!settings.data?.hasKeys}
          onCheckedChange={toggleLive}
        />
      </div>


      <div className="flex items-end gap-2">
        <div className="space-y-1">
          <div className="text-[10px] uppercase tracking-widest text-muted-foreground">Stake ($)</div>
          <Input
            className="h-8 w-24"
            type="number"
            inputMode="decimal"
            value={stakeUsd}
            onChange={(e) => setStakeUsd(e.target.value)}
          />
        </div>
        <Button size="sm" variant="outline" onClick={saveStake}>Save</Button>
      </div>

      <div className="grid grid-cols-3 gap-2">
        <Bucket label="Total" b={t} />
        <Bucket label="Study side" b={s} />
        <Bucket label="Model side" b={m} />
      </div>

      <div className="max-h-56 overflow-auto">
        <table className="w-full text-[11px]">
          <thead className="text-muted-foreground">
            <tr className="text-left">
              <th className="py-1 font-medium">Window</th>
              <th className="font-medium">Mode</th>
              <th className="font-medium">Src</th>
              <th className="font-medium">Side</th>
              <th className="font-medium text-right">Entry</th>
              <th className="font-medium text-right">Result</th>
            </tr>
          </thead>
          <tbody>
            {(stats.data?.rows ?? []).map((r) => (
              <tr key={r.id} className="border-t border-border/40">
                <td className="py-1 tabular-nums">
                  {new Date(r.close_time).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
                </td>
                <td className={r.live ? "text-red-400 font-bold" : "text-muted-foreground"}>
                  {r.live ? "LIVE" : "paper"}
                </td>
                <td className="text-muted-foreground">{r.pick_source ?? "—"}</td>
                <td className={r.side === "YES" ? "text-emerald-400" : "text-red-400"}>
                  {r.side === "YES" ? "UP" : "DOWN"}
                </td>
                <td className="text-right tabular-nums">{r.fill_price_cents}¢</td>
                <td className={`text-right tabular-nums ${
                  r.status === "won" ? "text-emerald-400" : r.status === "lost" ? "text-red-400" : "text-muted-foreground"
                }`}>
                  {r.status === "open" ? "open" : money(r.pnl_cents ?? 0)}
                </td>
              </tr>
            ))}
            {!stats.data?.rows?.length && (
              <tr><td colSpan={6} className="py-3 text-center text-muted-foreground">
                No cheap entries yet — waiting for a window priced 20–65¢.
              </td></tr>
            )}
          </tbody>
        </table>
      </div>

      {!!skips.data?.skips?.length && (
        <div className="text-[10px] text-muted-foreground space-y-0.5">
          <div className="uppercase tracking-widest">Recent skips</div>
          {skips.data.skips.slice(0, 6).map((k: any) => (
            <div key={k.id} className="truncate">
              {new Date(k.created_at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })} ·{" "}
              {String(k.skip_reason).replace("cheap_entry:", "")}
              {k.ask_price != null ? ` · ${Math.round(k.ask_price * 100)}¢` : ""}
            </div>
          ))}
        </div>
      )}

      <div className="text-[9px] text-muted-foreground leading-relaxed">
        With Live off this is paper money. With Live on, real Kalshi orders are placed for you.
        One buy per window, never under 20¢, never inside the last 60 seconds, and only windows
        starting after you switch it on. Runs on the server, so it works with this tab closed.
      </div>
    </div>
  );
}
