// Client-safe type re-exports for the backtest UI. The runtime module they
// come from is server-only, so only `import type` is used here.
export type {
  BacktestOutput,
  BacktestPeriod,
  ReconstructedWindow,
} from "@/lib/opsManual/opsManual.server";
export type { PeriodMetrics, BucketStat } from "@/lib/opsManual/rules";
