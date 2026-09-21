// One priority request for the two values the BTC card cannot render without.
// Keeping these together prevents unrelated dashboard requests from making the
// strike and current-window volume appear at different times after a reload.
import { createServerFn } from "@tanstack/react-start";
import {
  loadBtcSpotVolume,
  type BtcSpotVolume,
} from "@/lib/btcSpotVolume.functions";
import {
  loadKalshiCurrentStrike,
  type KalshiCurrentStrike,
} from "@/lib/kalshiCurrentStrike.functions";

export interface BtcEssentialSnapshot {
  strike: KalshiCurrentStrike;
  volume: BtcSpotVolume;
}

export const getBtcEssentialSnapshot = createServerFn({ method: "GET" }).handler(
  async (): Promise<BtcEssentialSnapshot> => {
    const [strike, volume] = await Promise.all([
      loadKalshiCurrentStrike(),
      loadBtcSpotVolume(),
    ]);
    return { strike, volume };
  },
);