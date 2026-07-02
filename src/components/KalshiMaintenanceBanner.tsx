import { useEffect, useState } from "react";
import { AlertTriangle } from "lucide-react";

export const isKalshiMaintenanceWindow = (d: Date = new Date()): boolean => {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/New_York",
    weekday: "short",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).formatToParts(d);
  const wd = parts.find(p => p.type === "weekday")?.value;
  const hh = parseInt(parts.find(p => p.type === "hour")?.value ?? "0", 10);
  const mm = parseInt(parts.find(p => p.type === "minute")?.value ?? "0", 10);
  if (wd !== "Thu") return false;
  const mins = hh * 60 + mm;
  return mins >= 150 && mins < 330; // Thu 02:30 – 05:30 ET
};

export function KalshiMaintenanceBanner() {
  const [active, setActive] = useState(() => isKalshiMaintenanceWindow());

  useEffect(() => {
    const id = setInterval(() => setActive(isKalshiMaintenanceWindow()), 30_000);
    return () => clearInterval(id);
  }, []);

  if (!active) return null;

  const msg = "Kalshi weekly maintenance in progress (Thu 02:30–05:30 ET) — auto entries & exits paused. Trading resumes at 05:30 AM ET.";

  return (
    <div className="w-full overflow-hidden border-y border-amber-500/40 bg-amber-500/10 text-amber-200">
      <div className="flex items-center gap-3 py-2">
        <AlertTriangle className="h-4 w-4 shrink-0 ml-3 text-amber-400" />
        <div className="relative flex-1 overflow-hidden whitespace-nowrap">
          <div className="inline-block animate-[kalshi-marquee_28s_linear_infinite] pl-[100%]">
            <span className="mx-8 text-sm font-medium">{msg}</span>
            <span className="mx-8 text-sm font-medium">{msg}</span>
            <span className="mx-8 text-sm font-medium">{msg}</span>
          </div>
        </div>
      </div>
      <style>{`@keyframes kalshi-marquee { from { transform: translateX(0); } to { transform: translateX(-100%); } }`}</style>
    </div>
  );
}
