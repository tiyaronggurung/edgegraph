// Equal-dollar C hedges are not matched-contract arbitrage locks.
export function sizeCEqualDollarHedge(budget: number, price: number) {
  if (!Number.isFinite(budget) || !Number.isFinite(price) || budget <= 0 || price <= 0 || price >= 1) return 0;
  return Math.floor(budget / price);
}