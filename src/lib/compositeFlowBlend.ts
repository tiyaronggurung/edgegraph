// Blends the Binance window taker leg with the Coinbase taker flow into one
// composite in/out read (volumes + volume-weighted avg in/out prices).
// Read-only input to the odds card — never feeds model, Study, or trade paths.

export interface WindowLegLike {
  buy: number;
  sell: number;
  avgBuyPrice?: number | null;
  avgSellPrice?: number | null;
}

export interface CoinbaseFlowLike {
  inBtc: number;
  outBtc: number;
  avgIn: number | null;
  avgOut: number | null;
}

export interface CompositeFlowBlend {
  inBtc: number;
  outBtc: number;
  /** (in − out) / total, −1..+1 */
  imbalance: number;
  avgIn: number | null;
  avgOut: number | null;
}

export function compositeFlowBlend(
  winLeg: WindowLegLike | null | undefined,
  cb: CoinbaseFlowLike | null | undefined,
): CompositeFlowBlend | null {
  if (winLeg == null || cb == null) return null;
  const inBtc = winLeg.buy + cb.inBtc;
  const outBtc = winLeg.sell + cb.outBtc;
  const total = inBtc + outBtc;
  if (!(total > 0)) return null;

  const vwap = (legs: Array<[number, number | null | undefined]>): number | null => {
    let q = 0;
    let v = 0;
    for (const [vol, px] of legs) {
      if (vol > 0 && px != null && px > 0) {
        q += vol;
        v += vol * px;
      }
    }
    return q > 0 ? v / q : null;
  };

  return {
    inBtc,
    outBtc,
    imbalance: (inBtc - outBtc) / total,
    avgIn: vwap([
      [winLeg.buy, winLeg.avgBuyPrice],
      [cb.inBtc, cb.avgIn],
    ]),
    avgOut: vwap([
      [winLeg.sell, winLeg.avgSellPrice],
      [cb.outBtc, cb.avgOut],
    ]),
  };
}
