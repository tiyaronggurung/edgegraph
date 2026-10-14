export type CSettlementPosition = {
  up_ct: number | string;
  down_ct: number | string;
  up_cost: number | string;
  down_cost: number | string;
  result: string | null;
};

// Costs are the actual recorded amounts, including any fees already charged.
// Never substitute today's $150 budget for an older fill's actual cost.
export function calculateCSettlement(position: CSettlementPosition) {
  if (position.result !== "UP" && position.result !== "DOWN") return null;
  const values = [position.up_ct, position.down_ct, position.up_cost, position.down_cost].map(Number);
  if (values.some((value) => !Number.isFinite(value) || value < 0)) return null;
  const [upContracts, downContracts, upCost, downCost] = values;
  const payout = position.result === "UP" ? upContracts : downContracts;
  const cost = Math.round((upCost + downCost) * 100) / 100;
  return { payout, cost, pnl: Math.round((payout - cost) * 100) / 100 };
}