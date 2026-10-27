export type StatsPosition = { settled: boolean; pnl: number | string | null; window_start: string };
const nyDay = (date: Date) => date.toLocaleDateString("en-US", { timeZone: "America/New_York" });

export function paperStats(positions: StatsPosition[], now = new Date()) {
  const settled = positions.filter((p) => p.settled && p.pnl != null);
  const today = settled.filter((p) => nyDay(new Date(p.window_start)) === nyDay(now));
  const summarize = (rows: StatsPosition[]) => ({
    pnl: rows.reduce((sum, p) => sum + Number(p.pnl), 0),
    count: rows.length,
    wins: rows.filter((p) => Number(p.pnl) > 0).length,
  });
  return { all: summarize(settled), today: summarize(today) };
}

export async function readAllStatsPositions(fetchPage: (from: number, to: number) => Promise<StatsPosition[]>) {
  const rows: StatsPosition[] = [];
  const pageSize = 1000;
  for (let from = 0; ; from += pageSize) {
    const page = await fetchPage(from, from + pageSize - 1);
    rows.push(...page);
    if (page.length < pageSize) return rows;
  }
}