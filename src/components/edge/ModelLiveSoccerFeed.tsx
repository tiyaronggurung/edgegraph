import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { Loader2, Sparkles } from "lucide-react";
import { listStoredLiveFixtures } from "@/lib/storedPredictions.functions";
import { SoccerPropsPanel } from "@/components/edge/SoccerPropsPanel";

interface Props {
  /** Optional title override */
  title?: string;
  /** Maximum number of model-only matches to show */
  limit?: number;
}

/**
 * Lists EVERY live soccer fixture the prediction worker has computed,
 * regardless of whether Kalshi has an open 3-way market for it.
 * Mounts the full EdgeGraph panel (Top Pick + markets + trend) for each.
 */
export function ModelLiveSoccerFeed({ title = "// Model Live Soccer · all fixtures", limit = 12 }: Props) {
  const listFn = useServerFn(listStoredLiveFixtures);
  const q = useQuery({
    queryKey: ["model-live-soccer-feed"],
    queryFn: () => listFn(),
    refetchInterval: 60_000,
    staleTime: 30_000,
  });

  const matches = (q.data?.matches ?? []).slice(0, limit);

  return (
    <div className="border border-border bg-card rounded">
      <div className="p-4 border-b border-border flex justify-between items-center">
        <div>
          <h2 className="terminal-label flex items-center gap-2">
            <Sparkles className="h-3 w-3 text-[color:var(--color-primary)]" />
            {title}
          </h2>
          <p className="text-[10px] text-muted-foreground mt-0.5">
            Direct from EdgeGraph AI Engine · refreshes every 60s · no Kalshi market required
          </p>
        </div>
        <span className="text-[10px] uppercase tracking-widest text-muted-foreground">
          {matches.length} match{matches.length === 1 ? "" : "es"}
        </span>
      </div>

      {q.isLoading && (
        <div className="flex items-center justify-center py-10 text-muted-foreground text-xs">
          <Loader2 className="h-4 w-4 animate-spin mr-2" /> Loading model predictions…
        </div>
      )}

      {q.data?.error && (
        <div className="p-4 text-xs text-amber-400">Feed error: {q.data.error}</div>
      )}

      {!q.isLoading && matches.length === 0 && (
        <div className="p-6 text-center text-xs text-muted-foreground">
          No live soccer fixtures right now. Worker runs every minute during matches.
        </div>
      )}

      <div className="grid md:grid-cols-2 gap-3 p-3">
        {matches.map((m) => (
          <div
            key={m.fixtureId}
            className="border border-border bg-background/40 rounded p-3 space-y-2"
          >
            <div className="flex justify-between items-start gap-2">
              <div className="min-w-0">
                <div className="text-[10px] uppercase tracking-widest text-muted-foreground truncate">
                  ⚽ {m.league || "Soccer"}
                </div>
                <div className="font-bold text-sm truncate">
                  {m.homeTeam} <span className="text-muted-foreground">vs</span> {m.awayTeam}
                </div>
              </div>
              <span className="text-[10px] font-mono text-[color:var(--color-primary)] shrink-0">
                {m.status}{m.elapsed ? ` ${m.elapsed}'` : ""} · {m.goalsHome}-{m.goalsAway}
              </span>
            </div>

            <SoccerPropsPanel teamA={m.homeTeam} teamB={m.awayTeam} />
          </div>
        ))}
      </div>
    </div>
  );
}
