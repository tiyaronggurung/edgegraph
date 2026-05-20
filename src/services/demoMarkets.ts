import type { Sport } from "@/lib/sports";
import type { Pattern } from "@/lib/analysisEngine";

export interface DemoMarket {
  game: string;
  scoreOrTime: string;
  probability: number;
  edgeScore: number;
  pattern: Pattern;
  edge70: boolean;
  action: "Bet" | "Wait" | "Hedge" | "Avoid" | "Watch Only";
}

export const DEMO_MARKETS: Record<Sport, DemoMarket[]> = {
  NBA: [
    { game: "Lakers vs Celtics", scoreOrTime: "Q4 4:12 · 102-99", probability: 87, edgeScore: 7.8, pattern: "Late-Game Stability", edge70: true, action: "Bet" },
    { game: "Warriors vs Nuggets", scoreOrTime: "Q3 2:45 · 78-72", probability: 64, edgeScore: 4.3, pattern: "Breakaway Trend", edge70: false, action: "Hedge" },
    { game: "Heat vs Bucks", scoreOrTime: "Q2 0:58 · 55-58", probability: 52, edgeScore: 1.2, pattern: "Chaotic Coin Flip", edge70: false, action: "Avoid" },
  ],
  NFL: [
    { game: "Chiefs vs Bills", scoreOrTime: "Q4 6:20 · 27-20", probability: 81, edgeScore: 7.1, pattern: "Controlled Stability", edge70: true, action: "Bet" },
    { game: "Cowboys vs Eagles", scoreOrTime: "Q3 12:01 · 14-14", probability: 56, edgeScore: 2.8, pattern: "Volatility Compression", edge70: false, action: "Watch Only" },
  ],
  NHL: [
    { game: "Bruins vs Rangers", scoreOrTime: "P3 8:45 · 3-2", probability: 79, edgeScore: 6.4, pattern: "Sharp Money Recovery", edge70: true, action: "Wait" },
    { game: "Oilers vs Avalanche", scoreOrTime: "P2 PP · 1-1", probability: 68, edgeScore: 3.9, pattern: "Breakaway Trend", edge70: false, action: "Hedge" },
  ],
  MLB: [
    { game: "Yankees vs Dodgers", scoreOrTime: "Top 8 · 5-2", probability: 84, edgeScore: 7.6, pattern: "Late Momentum Swing", edge70: true, action: "Bet" },
    { game: "Astros vs Braves", scoreOrTime: "Bot 5 · 3-3", probability: 58, edgeScore: 2.1, pattern: "Volatility Compression", edge70: false, action: "Watch Only" },
  ],
  Tennis: [
    { game: "Djokovic vs Alcaraz", scoreOrTime: "Set 3 · 5-4", probability: 74, edgeScore: 5.6, pattern: "Controlled Stability", edge70: true, action: "Wait" },
    { game: "Sabalenka vs Swiatek", scoreOrTime: "Set 2 TB", probability: 51, edgeScore: 0.8, pattern: "Chaotic Coin Flip", edge70: false, action: "Avoid" },
  ],
  Soccer: [
    { game: "Man City vs Arsenal", scoreOrTime: "82' · 2-1", probability: 76, edgeScore: 6.0, pattern: "Late Momentum Swing", edge70: true, action: "Wait" },
    { game: "Real Madrid vs Barça", scoreOrTime: "63' · 1-1", probability: 55, edgeScore: 1.6, pattern: "Volatility Compression", edge70: false, action: "Watch Only" },
  ],
};
