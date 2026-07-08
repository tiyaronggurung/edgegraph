// Client-callable wrapper around getPolymarketBtcUpDown for UI display.
// No auth required — Polymarket odds are public info.
import { createServerFn } from "@tanstack/react-start";
import { getPolymarketBtcUpDown } from "./polymarketOdds";

export const fetchPolymarketBtcOdds = createServerFn({ method: "GET" }).handler(
  async () => {
    const o = await getPolymarketBtcUpDown();
    return o;
  },
);
