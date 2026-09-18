// Read-only log: BTC in vs out per 15m window + how the window actually closed.
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { Loader2, Waves } from "lucide-react";
import { getBtcFlowLeanHistory } from "@/lib/btcFlowLeanHistory.functions";

const hm = (iso: string) =>
  new Date(iso).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" });

const pct = (v: number | null) => (v == null ? "—" : `${v >= 0 ? "+" : ""}${(v * 100).toFixed(0)}%`);
const btc = (v: number | null) => (v == null ? "—" : v.toFixed(1));
const usd = (v: number | null) => {
  if (v == null) return "—";
  if (v >= 1e9) return `$${(v / 1e9).toFixed(2)}B`;
  if (v >= 1e6) return `$${(v / 1e6).toFixed(1)}M`;
  if (v >= 1e3) return `$${(v / 1e3).toFixed(0)}K`;
  return `$${v.toFixed(0)}`;
};
const price = (v: number | null) =>
  v == null ? "—" : `$${v.toLocaleString("en-US", { maximumFractionDigits: 0 })}`;

const rsiClass = (v: number | null) =>
  v == null
    ? "text-muted-foreground"
    : v >= 70
      ? "text-rose-400"
      : v <= 30
        ? "text-emerald-400"
        : "text-muted-foreground";

const signClass = (v: number | null | undefined) =>
  (v ?? 0) > 0 ? "text-emerald-400" : (v ?? 0) < 0 ? "text-rose-400" : "text-muted-foreground";

function IndBlock({ label, snap }: { label: string; snap: import("@/lib/btcFlowLeanHistory.functions").IndicatorSnap }) {
  return (
    <div className="flex items-center gap-2 text-[11px]">
      <span className="text-[10px] uppercase tracking-wider text-muted-foreground">{label}</span>
      <span className={signClass(snap.smaDistPct)}>
        SMA20 {snap.smaDistPct == null ? "—" : `${snap.smaDistPct >= 0 ? "+" : ""}${(snap.smaDistPct * 100).toFixed(2)}%`}
      </span>
      <span className={rsiClass(snap.rsi)}>RSI {snap.rsi == null ? "—" : snap.rsi.toFixed(0)}</span>
      <span className={signClass(snap.hist)}>
        MACD {snap.hist == null ? "—" : `${snap.hist >= 0 ? "+" : ""}${snap.hist.toFixed(1)}`}
      </span>
    </div>
  );
}

export function FlowLeanLog() {
  const fn = useServerFn(getBtcFlowLeanHistory);
  const q = useQuery({
    queryKey: ["btc-flow-lean-history"],
    queryFn: () => fn(),
    refetchInterval: 60_000,
    staleTime: 30_000,
  });

  const d = q.data;

  return (
    <div className="border border-border rounded-lg bg-card">
      <div className="px-4 py-2 border-b border-border flex items-center justify-between">
        <h2 className="text-sm uppercase tracking-wider text-muted-foreground flex items-center gap-2">
          <Waves className="h-3.5 w-3.5 text-sky-400" />
          Flow log — in vs out vs result
        </h2>
        {q.isFetching ? (
          <Loader2 className="h-3 w-3 animate-spin text-muted-foreground" />
        ) : d && d.scored > 0 ? (
          <span className="text-[10px] text-muted-foreground">
            {d.hits}/{d.scored} matched ({Math.round((d.hits / d.scored) * 100)}%)
          </span>
        ) : null}
      </div>

      {d?.live && (
        <div className="px-3 py-2 border-b border-border flex flex-wrap gap-x-6 gap-y-1">
          <IndBlock label="1m" snap={d.live.m1} />
          <IndBlock label="15m" snap={d.live.m15} />
        </div>
      )}

      {d && d.rollups.length > 0 && (
        <div className="px-3 py-2 border-b border-border overflow-x-auto">
          <table className="w-full text-[11px] min-w-[430px]">
            <thead>
              <tr className="text-[10px] uppercase tracking-wider text-muted-foreground">
                <th className="text-left font-normal py-0.5">Span</th>
                <th className="text-right font-normal px-2">In $</th>
                <th className="text-right font-normal px-2">Out $</th>
                <th className="text-right font-normal px-2">Net $</th>
                <th className="text-right font-normal px-2">Fees</th>
                <th className="text-right font-normal px-2">Avg buy*</th>
                <th className="text-right font-normal px-2">Avg sell*</th>
                <th className="text-right font-normal">Px</th>
              </tr>
            </thead>
            <tbody>
              {d.rollups.map(r => (
                <tr key={r.label} className="border-t border-border/40">
                  <td className="py-1 text-muted-foreground">{r.label}</td>
                  <td className="px-2 text-right text-emerald-400">{usd(r.buyUsd)}</td>
                  <td className="px-2 text-right text-rose-400">{usd(r.sellUsd)}</td>
                  <td
                    className={`px-2 text-right font-semibold ${
                      (r.netUsdPctAfterFees ?? 0) > 0
                        ? "text-emerald-400"
                        : (r.netUsdPctAfterFees ?? 0) < 0
                          ? "text-rose-400"
                          : ""
                    }`}
                  >
                    {r.netUsdPctAfterFees == null ? "—" : `${(r.netUsdPctAfterFees * 100).toFixed(1)}%`}
                  </td>
                  <td className="px-2 text-right text-amber-400/80">{usd(r.feeUsd)}</td>
                  <td className="px-2 text-right">{price(r.effAvgBuyPrice)}</td>
                  <td className="px-2 text-right">{price(r.effAvgSellPrice)}</td>
                  <td
                    className={`text-right ${
                      (r.priceChangePct ?? 0) > 0 ? "text-emerald-400" : (r.priceChangePct ?? 0) < 0 ? "text-rose-400" : ""
                    }`}
                  >
                    {r.priceChangePct == null ? "—" : `${(r.priceChangePct * 100).toFixed(2)}%`}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {!d ? (
        <div className="p-4 text-sm text-muted-foreground">{q.isLoading ? "Loading…" : "No data."}</div>
      ) : d.rows.length === 0 ? (
        <div className="p-4 text-sm text-muted-foreground">No flow rows logged yet.</div>
      ) : (
        <div className="max-h-64 overflow-y-auto">
          <table className="w-full text-[11px]">
            <thead className="sticky top-0 bg-card">
              <tr className="text-[10px] uppercase tracking-wider text-muted-foreground">
                <th className="text-left px-3 py-1.5 font-normal">Window</th>
                <th className="text-right px-2 py-1.5 font-normal">In ₿</th>
                <th className="text-right px-2 py-1.5 font-normal">Out ₿</th>
                <th className="text-right px-2 py-1.5 font-normal">In $</th>
                <th className="text-right px-2 py-1.5 font-normal">Out $</th>
                <th className="text-right px-2 py-1.5 font-normal">Avg buy</th>
                <th className="text-right px-2 py-1.5 font-normal">Avg sell</th>
                <th className="text-right px-2 py-1.5 font-normal">Net</th>
                <th className="text-right px-2 py-1.5 font-normal">SMA20</th>
                <th className="text-right px-2 py-1.5 font-normal">RSI</th>
                <th className="text-right px-2 py-1.5 font-normal">MACD</th>
                <th className="text-center px-2 py-1.5 font-normal">Lean</th>
                <th className="text-center px-3 py-1.5 font-normal">Result</th>
              </tr>
            </thead>
            <tbody>
              {d.rows.map(r => (
                <tr key={r.windowStart} className="border-t border-border/60">
                  <td className="px-3 py-1.5 text-muted-foreground">{hm(r.windowStart)}</td>
                  <td className="px-2 py-1.5 text-right text-emerald-400">{btc(r.buyBtc)}</td>
                  <td className="px-2 py-1.5 text-right text-rose-400">{btc(r.sellBtc)}</td>
                  <td className="px-2 py-1.5 text-right text-emerald-400">{usd(r.buyUsd)}</td>
                  <td className="px-2 py-1.5 text-right text-rose-400">{usd(r.sellUsd)}</td>
                  <td className="px-2 py-1.5 text-right text-muted-foreground">{price(r.avgBuyPrice)}</td>
                  <td className="px-2 py-1.5 text-right text-muted-foreground">{price(r.avgSellPrice)}</td>
                  <td
                    className={`px-2 py-1.5 text-right font-semibold ${
                      (r.imbWindow ?? 0) > 0 ? "text-emerald-400" : (r.imbWindow ?? 0) < 0 ? "text-rose-400" : ""
                    }`}
                  >
                    {pct(r.imbWindow)}
                  </td>
                  <td className={`px-2 py-1.5 text-right ${signClass(r.ind.smaDistPct)}`}>
                    {r.ind.smaDistPct == null
                      ? "—"
                      : `${r.ind.smaDistPct >= 0 ? "+" : ""}${(r.ind.smaDistPct * 100).toFixed(2)}%`}
                  </td>
                  <td className={`px-2 py-1.5 text-right ${rsiClass(r.ind.rsi)}`}>
                    {r.ind.rsi == null ? "—" : r.ind.rsi.toFixed(0)}
                  </td>
                  <td className={`px-2 py-1.5 text-right ${signClass(r.ind.hist)}`}>
                    {r.ind.hist == null ? "—" : `${r.ind.hist >= 0 ? "+" : ""}${r.ind.hist.toFixed(1)}`}
                  </td>
                  <td className="px-2 py-1.5 text-center">
                    <span
                      className={
                        r.lean === "UP"
                          ? "text-emerald-400"
                          : r.lean === "DOWN"
                            ? "text-rose-400"
                            : "text-muted-foreground"
                      }
                    >
                      {r.lean}
                    </span>
                  </td>
                  <td className="px-3 py-1.5 text-center">
                    {r.result ? (
                      <span
                        title={
                          r.resultSource === "settled"
                            ? "Actual settled market outcome (above/below strike)"
                            : "Estimated from the 15m candle open vs close — no settled outcome yet"
                        }
                        className={`px-1.5 py-0.5 rounded border ${
                          r.hit === true
                            ? "border-emerald-500/50 text-emerald-300"
                            : r.hit === false
                              ? "border-rose-500/50 text-rose-300"
                              : "border-border text-muted-foreground"
                        } ${r.resultSource === "candle" ? "border-dashed opacity-80" : ""}`}
                      >
                        {r.result}
                        {r.hit === true ? " ✓" : r.hit === false ? " ✗" : ""}
                      </span>
                    ) : (
                      <span className="text-muted-foreground">live</span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <div className="px-3 py-1.5 border-t border-border text-[10px] text-muted-foreground">
        read-only · result = actual settled outcome vs strike when available (dashed = estimated from the
        15m candle) · * avg prices include 0.10% taker fee (buy +fee,
        sell −fee) · net $ is after fees · SMA 20 / RSI 14 / MACD 12-26-9, row values on 15m candles ·
        not wired to any bet
      </div>
    </div>
  );
}
