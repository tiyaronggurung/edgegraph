// Read-only verdict banner: UP / DOWN / NO CALL from the 3-signal rule plus a
// 10-second hold on our odds side. Display only — the bet engine computes its
// own verdict server-side from the recorded composite flow.
import { useEffect, useRef, useState } from "react";
import { computeVerdict, type VerdictSide } from "@/lib/btcVerdict";

interface Props {
  spot: number | null;
  strike: number | null;
  avgIn: number | null;
  avgOut: number | null;
  inBtc: number | null;
  outBtc: number | null;
  /** Side our odds engine currently reads, used for the 10s hold leg. */
  oddsSide: VerdictSide;
}

const HOLD_MS = 10_000;

function Leg({ label, ok, side }: { label: string; ok: boolean; side: VerdictSide }) {
  return (
    <span
      className={`rounded px-1.5 py-0.5 font-mono text-[10px] ${
        ok
          ? side === "UP"
            ? "bg-emerald-500/15 text-emerald-300"
            : "bg-rose-500/15 text-rose-300"
          : "bg-muted text-muted-foreground"
      }`}
    >
      {label}
      {side ? ` ${side}` : " —"}
    </span>
  );
}

export function BtcVerdictBanner(props: Props) {
  const { spot, strike, avgIn, avgOut, inBtc, outBtc, oddsSide } = props;
  const v = computeVerdict({ spot, strike, avgIn, avgOut, inBtc, outBtc });

  // 10-second hold on the odds side — the direction has to stick, not blink.
  const sinceRef = useRef<{ side: VerdictSide; at: number }>({ side: oddsSide, at: Date.now() });
  const [, tick] = useState(0);
  useEffect(() => {
    const id = setInterval(() => tick((n) => n + 1), 500);
    return () => clearInterval(id);
  }, []);
  if (sinceRef.current.side !== oddsSide) {
    sinceRef.current = { side: oddsSide, at: Date.now() };
  }
  const heldMs = Date.now() - sinceRef.current.at;
  const oddsHeld = oddsSide != null && heldMs >= HOLD_MS;

  const call: VerdictSide = v.verdict != null && oddsHeld && oddsSide === v.verdict ? v.verdict : null;

  const tone =
    call === "UP"
      ? "border-emerald-500/50 bg-emerald-500/10 text-emerald-300"
      : call === "DOWN"
        ? "border-rose-500/50 bg-rose-500/10 text-rose-300"
        : "border-border/60 bg-muted/40 text-muted-foreground";

  return (
    <div className={`rounded-md border px-2 py-1.5 ${tone}`}>
      <div className="flex items-center justify-between">
        <span className="text-xs font-semibold">
          {call ? `VERDICT · ${call}` : "NO CALL"}
        </span>
        <span className="font-mono text-[10px]">
          {v.nowVsAvgInGap != null
            ? `now vs avg in ${v.nowVsAvgInGap >= 0 ? "+" : "−"}$${Math.abs(v.nowVsAvgInGap).toFixed(0)}`
            : "—"}
        </span>
      </div>
      <div className="mt-1 flex flex-wrap items-center gap-1">
        <Leg label="avgs vs strike" ok={v.legs.avgs != null} side={v.legs.avgs} />
        <Leg label="in vs out" ok={v.legs.flow != null} side={v.legs.flow} />
        <Leg label="now vs avg in" ok={v.legs.nowVsAvgIn != null} side={v.legs.nowVsAvgIn} />
        <Leg
          label={oddsHeld ? "odds held 10s" : `odds ${Math.min(10, Math.floor(heldMs / 1000))}/10s`}
          ok={oddsHeld}
          side={oddsSide}
        />
      </div>
      <p className="mt-1 text-[10px] text-muted-foreground">
        all four on the same side is the call · mixed average prices are never a buy
      </p>
    </div>
  );
}
