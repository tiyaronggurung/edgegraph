// Watch-only learning model panel. Display only — not wired to any bet.
import { useServerFn } from "@tanstack/react-start";
import { useQuery, keepPreviousData } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { getLogisticModel } from "@/lib/logisticModel.functions";

const pct = (v: number | null | undefined) => (v == null ? "—" : `${(v * 100).toFixed(1)}%`);

export function LogisticModelPanel() {
  const fn = useServerFn(getLogisticModel);
  const { data } = useQuery({
    queryKey: ["logistic-model"],
    queryFn: () => fn(),
    refetchInterval: 10_000,
    placeholderData: keepPreviousData,
  });
  const p = data?.current?.pUp ?? null;
  const side = p == null ? null : p >= 0.5 ? "UP" : "DOWN";
  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="flex items-center justify-between text-sm">
          <span>Learning model (watch only)</span>
          <Badge className={side === "UP" ? "bg-emerald-500/20 text-emerald-300" : side === "DOWN" ? "bg-rose-500/20 text-rose-300" : "bg-muted text-muted-foreground"}>
            {side ? `${side} · p(up) ${pct(p)}` : "no reading"}
          </Badge>
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-1 text-xs">
        <div className="font-mono text-[11px] text-muted-foreground">
          trained on {data?.trainedWindows ?? 0} windows · {data?.trainedSamples ?? 0} samples · retrains every 10 min
        </div>
        <div className="font-mono text-[11px]">
          unseen-window accuracy: {pct(data?.holdoutAccuracy)} · last 4 min: {pct(data?.holdoutLast4Min)}
        </div>
        <div className="grid grid-cols-2 gap-x-4 pt-1 font-mono text-[10px] text-muted-foreground">
          {data?.weights.slice(1).map((w) => (
            <div key={w.name} className="flex justify-between">
              <span>{w.name}</span>
              <span>{w.weight >= 0 ? "+" : ""}{w.weight.toFixed(2)}</span>
            </div>
          ))}
        </div>
        <p className="text-[10px] text-muted-foreground">
          {data?.enoughData ? "" : "still learning — under 200 finished windows, don't trust yet · "}
          display only, never places or blocks a bet
        </p>
      </CardContent>
    </Card>
  );
}
