// Placeholder sports data feed. Wire real provider once API key is supplied.
import type { Sport } from "@/lib/sports";

export interface GameState {
  sport: Sport;
  game: string;
  period: string;
  score: string;
}

export async function fetchLiveGames(_sport: Sport): Promise<GameState[]> {
  return [];
}

export const sportsDataConnectionStatus = () => ({ connected: false, lastSync: null as string | null });
