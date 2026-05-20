// Placeholder odds aggregator connector.
export interface OddsLine {
  book: string;
  teamA: number;
  teamB: number;
}

export async function fetchOdds(_gameKey: string): Promise<OddsLine[]> {
  return [];
}

export const oddsConnectionStatus = () => ({ connected: false, lastSync: null as string | null });
