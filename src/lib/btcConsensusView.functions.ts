// Read-only view of the combined BTC consensus (model pick + study lock +
// trendline) for the live 15m window. Used by the agreement table on /crypto.
// Display only — never wired to any bet path.
import { createServerFn } from "@tanstack/react-start";

export interface ConsensusView {
  ok: boolean;
  ticker: string | null;
  strike: number | null;
  spot: number | null;
  secondsToClose: number | null;
  modelSide: "YES" | "NO" | null;
  modelConfidence: number | null;
  studySide: "YES" | "NO" | null;
  studyConfidence: number | null;
  trendlineSide: "YES" | "NO" | null;
  error: string | null;
}

export const getBtcConsensusView = createServerFn({ method: "GET" }).handler(
  async (): Promise<ConsensusView> => {
    try {
      const { getBtcConsensus } = await import("@/lib/btcConsensus.server");
      const c = await getBtcConsensus();
      return {
        ok: c.ok,
        ticker: c.ticker,
        strike: c.strike,
        spot: c.spot,
        secondsToClose: c.secondsToClose,
        modelSide: c.model.side,
        modelConfidence: c.model.confidence,
        studySide: c.study.side ?? c.study.fallbackSide ?? null,
        studyConfidence: c.study.confidence ?? c.study.fallbackConfidence ?? null,
        trendlineSide: c.trendline.side,
        error: c.error,
      };
    } catch (e) {
      return {
        ok: false, ticker: null, strike: null, spot: null, secondsToClose: null,
        modelSide: null, modelConfidence: null, studySide: null, studyConfidence: null,
        trendlineSide: null, error: (e as Error).message,
      };
    }
  },
);
