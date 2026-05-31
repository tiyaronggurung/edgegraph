import { useEffect, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { useQuery } from "@tanstack/react-query";
import { toast } from "sonner";
import {
  getAlertPrefs,
  updateAlertPrefs,
  ALERT_SPORT_OPTIONS,
  type AlertFrequency,
} from "@/lib/alert-prefs.functions";
import { Link } from "@tanstack/react-router";

const FREQS: { value: AlertFrequency; label: string; hint: string }[] = [
  { value: "instant", label: "Instant", hint: "Email on every qualifying BET" },
  { value: "daily_digest", label: "Daily digest", hint: "One rollup email at 13:00 UTC" },
  { value: "off", label: "Off", hint: "In-app badges only — no emails" },
];

const cls = "w-full bg-background border border-border rounded px-2.5 py-1.5 text-sm font-mono";

export function AlertPreferencesCard() {
  const fetchPrefs = useServerFn(getAlertPrefs);
  const savePrefs = useServerFn(updateAlertPrefs);
  const q = useQuery({ queryKey: ["alert-prefs"], queryFn: () => fetchPrefs() });

  const [freq, setFreq] = useState<AlertFrequency>("instant");
  const [sports, setSports] = useState<string[]>([]);
  const [minConf, setMinConf] = useState<number>(0);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (q.data) {
      setFreq(q.data.alertFrequency);
      setSports(q.data.alertSportFilters ?? []);
      setMinConf(q.data.alertMinConfidence ?? 0);
    }
  }, [q.data]);

  const locked = !q.data?.canCustomize;

  const save = async () => {
    setSaving(true);
    try {
      await savePrefs({
        data: {
          alertFrequency: freq,
          alertSportFilters: sports,
          alertMinConfidence: minConf,
        },
      });
      toast.success("Alert preferences saved");
      q.refetch();
    } catch (e: any) {
      toast.error(e?.message ?? "Failed to save");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="border border-border bg-card rounded p-4 space-y-4 font-mono lg:col-span-2 relative">
      <div className="flex items-center justify-between">
        <h2 className="terminal-label">// Alert preferences</h2>
        {q.data && (
          <span className="text-[10px] uppercase tracking-widest text-muted-foreground">
            tier: {q.data.tier}
          </span>
        )}
      </div>

      {locked && (
        <div className="border border-amber-500/40 bg-amber-500/5 text-amber-400 rounded p-3 text-xs space-y-2">
          <div className="font-bold uppercase tracking-wider">Pro / VIP feature</div>
          <p className="text-amber-400/80">
            Customize alert frequency, sport filters, and confidence thresholds by upgrading.
            Free stays at 5 instant alerts / month with no customization.
          </p>
          <Link
            to="/pricing"
            className="inline-block px-3 py-1.5 text-[11px] uppercase tracking-wider border border-amber-500/60 rounded"
          >
            See plans
          </Link>
        </div>
      )}

      <fieldset disabled={locked} className={locked ? "opacity-50 pointer-events-none" : ""}>
        <div className="space-y-4">
          <div>
            <div className="terminal-label mb-2">Frequency</div>
            <div className="flex flex-wrap gap-2">
              {FREQS.map((f) => (
                <button
                  key={f.value}
                  type="button"
                  onClick={() => setFreq(f.value)}
                  className={`px-3 py-1.5 text-xs uppercase tracking-wider rounded border ${
                    freq === f.value
                      ? "border-[color:var(--color-primary)] text-[color:var(--color-primary)]"
                      : "border-border text-muted-foreground"
                  }`}
                  title={f.hint}
                >
                  {f.label}
                </button>
              ))}
            </div>
            <p className="text-[10px] text-muted-foreground mt-2 uppercase tracking-widest">
              {FREQS.find((f) => f.value === freq)?.hint}
            </p>
          </div>

          <div>
            <div className="terminal-label mb-2">
              Sport filters{" "}
              <span className="text-muted-foreground normal-case tracking-normal">
                (empty = all sports)
              </span>
            </div>
            <div className="flex flex-wrap gap-2">
              {ALERT_SPORT_OPTIONS.map((s) => {
                const on = sports.includes(s);
                return (
                  <button
                    key={s}
                    type="button"
                    onClick={() =>
                      setSports((arr) => (on ? arr.filter((x) => x !== s) : [...arr, s]))
                    }
                    className={`px-3 py-1.5 text-xs uppercase tracking-wider rounded border ${
                      on
                        ? "border-[color:var(--color-primary)] text-[color:var(--color-primary)]"
                        : "border-border text-muted-foreground"
                    }`}
                  >
                    {s}
                  </button>
                );
              })}
            </div>
          </div>

          <div>
            <div className="terminal-label mb-2">
              Minimum AI confidence: <span className="text-[color:var(--color-primary)]">{minConf}%</span>
            </div>
            <input
              type="range"
              min={0}
              max={100}
              step={1}
              value={minConf}
              onChange={(e) => setMinConf(Number(e.target.value))}
              className="w-full"
            />
            <p className="text-[10px] text-muted-foreground mt-1 uppercase tracking-widest">
              Only email when fair-prob on the BET side is at least this high. 0 = no threshold.
            </p>
          </div>

          <button
            type="button"
            onClick={save}
            disabled={saving}
            className="w-full py-2 mt-2 text-xs uppercase tracking-wider border border-[color:var(--color-primary)] text-[color:var(--color-primary)] rounded disabled:opacity-50"
          >
            {saving ? "Saving…" : "Save alert preferences"}
          </button>

          <p className="text-[10px] text-muted-foreground uppercase tracking-widest">
            In-app BET badges always appear. These settings only control email delivery.
            Per-market/side/day dedupe is always enforced.
          </p>
        </div>
      </fieldset>
    </div>
  );
}
