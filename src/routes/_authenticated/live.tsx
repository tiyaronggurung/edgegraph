import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { SPORTS, type Sport } from "@/lib/sports";
import { MiniProbChart } from "@/components/edge/MiniProbChart";
import { PatternBadge } from "@/components/edge/PatternBadge";
import { ActionBadge } from "@/components/edge/ActionBadge";
import { Edge70Badge } from "@/components/edge/Edge70Badge";
import { Disclaimer } from "@/components/edge/Disclaimer";
import { DEMO_MARKETS } from "@/services/demoMarkets";
import { generateSimulatedSeries } from "@/lib/analysisEngine";

export const Route = createFileRoute("/_authenticated/live")({
  head: () => ({ meta: [{ title: "Live Markets — EdgeGraph AI" }] }),
  component: LiveMarkets,
});

const CONNECTORS = [
  { name: "Kalshi Market API", status: "Manual mode" },
  { name: "Sports Data API", status: "Manual mode" },
  { name: "Odds API", status: "Manual mode" },
];

function LiveMarkets() {
  const [sport, setSport] = useState<Sport>("NBA");
  const markets = DEMO_MARKETS[sport];
  return (
    <div className="space-y-5 font-mono">
      <h1 className="text-2xl font-bold uppercase tracking-wider">// Live Markets</h1>
      <div className="border border-border bg-card rounded p-3 flex flex-wrap gap-2 items-center">
        {CONNECTORS.map((c) => (
          <div key={c.name} className="flex items-center gap-2 px-3 py-1.5 border border-border rounded text-xs">
            <span className="h-2 w-2 rounded-full bg-[color:var(--color-warning)]" />
            <span className="text-muted-foreground">{c.name}</span>
            <button className="text-[color:var(--color-primary)] uppercase tracking-widest text-[10px]">Connect</button>
          </div>
        ))}
        <span className="text-xs text-muted-foreground ml-auto">Currently in MANUAL MODE</span>
      </div>

      <div className="flex flex-wrap gap-2">
        {SPORTS.map((s) => (
          <button
            key={s.key}
            onClick={() => setSport(s.key)}
            className={`px-3 py-1.5 text-xs uppercase tracking-wider rounded border ${
              sport === s.key
                ? "border-[color:var(--color-primary)] text-[color:var(--color-primary)] bg-[color:var(--color-primary)]/10"
                : "border-border text-muted-foreground"
            }`}
          >
            {s.icon} {s.label}
          </button>
        ))}
      </div>

      <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-3">
        {markets.map((m) => (
          <div key={m.game} className="border border-border bg-card rounded p-4 space-y-2">
            <div className="flex justify-between items-start gap-2">
              <div>
                <div className="font-bold text-sm">{m.game}</div>
                <div className="text-xs text-muted-foreground">{m.scoreOrTime}</div>
              </div>
              {m.edge70 && <Edge70Badge detected />}
            </div>
            <MiniProbChart series={generateSimulatedSeries(m.pattern, m.probability)} width={280} height={70} />
            <div className="flex justify-between items-center pt-1">
              <PatternBadge pattern={m.pattern} />
              <span className="text-xs text-muted-foreground">Edge {m.edgeScore.toFixed(1)}</span>
            </div>
            <ActionBadge action={m.action} />
          </div>
        ))}
      </div>
      <Disclaimer />
    </div>
  );
}
