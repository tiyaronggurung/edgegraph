// Client-callable wrapper for Polymarket BTC volume/flow. Public data, no auth.
import { createServerFn } from "@tanstack/react-start";
import { getPolymarketBtcVolume } from "./polymarketVolume";

export const fetchPolymarketBtcVolume = createServerFn({ method: "GET" }).handler(
  async () => {
    return await getPolymarketBtcVolume();
  },
);
