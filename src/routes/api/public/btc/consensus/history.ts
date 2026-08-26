// Public read-only API: replay of the consensus verdict for settled BTC 15m
// windows, so a consumer can backtest the real gates instead of waiting on a
// shadow log.
//
//   GET /api/public/btc/consensus/history?from=ISO&to=ISO&decisionSeconds=240
//
// Same auth as the live consensus route: if BTC_LEVELS_API_KEY is set, callers
// must send it as `x-api-key` (or `?key=`). Never places orders.

import { createFileRoute } from "@tanstack/react-router";
import { getBtcConsensusHistory } from "@/lib/btcConsensusHistory.server";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, OPTIONS",
  "Access-Control-Allow-Headers": "content-type, x-api-key",
};

export const Route = createFileRoute("/api/public/btc/consensus/history")({
  server: {
    handlers: {
      OPTIONS: async () => new Response(null, { status: 204, headers: CORS }),
      GET: async ({ request }) => {
        const url = new URL(request.url);
        const required = process.env["BTC_LEVELS_API_KEY"];
        if (required) {
          const provided = request.headers.get("x-api-key") ?? url.searchParams.get("key");
          if (provided !== required) {
            return Response.json({ ok: false, error: "unauthorized" }, { status: 401, headers: CORS });
          }
        }

        try {
          const dsRaw = url.searchParams.get("decisionSeconds");
          const data = await getBtcConsensusHistory({
            from: url.searchParams.get("from"),
            to: url.searchParams.get("to"),
            decisionSeconds: dsRaw == null ? null : Number(dsRaw),
          });
          return Response.json(data, {
            status: data.ok ? 200 : 400,
            headers: { ...CORS, "Cache-Control": "public, max-age=30" },
          });
        } catch (e) {
          return Response.json({ ok: false, error: (e as Error).message }, { status: 500, headers: CORS });
        }
      },
    },
  },
});
