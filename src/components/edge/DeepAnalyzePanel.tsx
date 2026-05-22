import { useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { Sparkles, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { deepAnalyze, type DeepAnalyzeInput, type DeepAnalyzeResult } from "@/lib/deepAnalyze.functions";

export function DeepAnalyzePanel({ input }: { input: DeepAnalyzeInput }) {
  const run = useServerFn(deepAnalyze);
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<DeepAnalyzeResult | null>(null);

  const onClick = async () => {
    setLoading(true);
    try {
      const { result: r, error } = await run({ data: input });
      if (error) {
        toast.error(error);
        return;
      }
      setResult(r);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Deep analyze failed");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="border border-border bg-card rounded p-4 font-mono space-y-3">
      <div className="flex items-center justify-between gap-2 flex-wrap">
        <div className="terminal-label">// Deep analyze (AI)</div>
        <button
          onClick={onClick}
          disabled={loading}
          className="inline-flex items-center gap-1.5 text-xs uppercase tracking-wider px-3 py-1.5 border border-[color:var(--color-primary)] text-[color:var(--color-primary)] rounded hover:bg-[color:var(--color-primary)]/10 disabled:opacity-50"
        >
          {loading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Sparkles className="h-3.5 w-3.5" />}
          {loading ? "Analyzing…" : result ? "Re-analyze" : "Run deep analyze"}
        </button>
      </div>

      {!result && !loading && (
        <p className="text-xs text-muted-foreground">
          Sends the probability series + game state to an AI model for a narrative read,
          next-move probability distribution, and an action call. ~1 credit per click.
        </p>
      )}

      {result && (
        <div className="space-y-4 pt-1">
          <div className="flex flex-wrap gap-2 text-[10px] uppercase tracking-widest">
            <span className="px-2 py-1 border border-border rounded">Pattern: <b className="text-foreground">{result.pattern}</b></span>
            <span className="px-2 py-1 border border-border rounded">Momentum: <b className="text-foreground">{result.momentum}</b></span>
            <span className="px-2 py-1 border border-border rounded">Volatility: <b className="text-foreground">{result.volatility}</b></span>
            <span className="px-2 py-1 border border-[color:var(--color-primary)] text-[color:var(--color-primary)] rounded">
              Action: <b>{result.action}</b> · {result.confidence}%
            </span>
          </div>

          <p className="text-sm leading-relaxed">{result.narrative}</p>

          <div>
            <div className="terminal-label mb-2">// Next-move distribution</div>
            <ul className="space-y-2">
              {result.next_moves.map((m, i) => (
                <li key={i} className="text-xs">
                  <div className="flex items-center gap-2">
                    <div className="w-12 text-right tabular-nums font-bold text-[color:var(--color-primary)]">
                      {Math.round(m.prob)}%
                    </div>
                    <div className="flex-1 h-1.5 bg-muted rounded overflow-hidden">
                      <div
                        className="h-full bg-[color:var(--color-primary)]"
                        style={{ width: `${Math.min(100, m.prob)}%` }}
                      />
                    </div>
                  </div>
                  <div className="pl-14 mt-1 text-foreground">→ {m.target}</div>
                  <div className="pl-14 text-muted-foreground">{m.why}</div>
                </li>
              ))}
            </ul>
          </div>

          <div>
            <div className="terminal-label mb-2">// Risks</div>
            <ul className="text-xs text-muted-foreground space-y-1">
              {result.risks.map((r, i) => <li key={i}>⚠ {r}</li>)}
            </ul>
          </div>
        </div>
      )}
    </div>
  );
}
