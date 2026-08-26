// Public read-only API: combined ALLOW / CAUTION / SKIP verdict for the live
// BTC 15m Kalshi window, merging model pick + T7 study lock + trendline levels.
//
//   GET /api/public/btc/consensus
//
// Same auth as /api/public/btc/levels: if BTC_LEVELS_API_KEY is set, callers
// must send it as `x-api-key` (or `?key=`). Read-only — never places orders.

import { createFileRoute } from "@tanstack/react-router";
import { getBtcConsensus } from "@/lib/btcConsensus.server";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, OPTIONS",
  "Access-Control-Allow-Headers": "content-type, x-api-key",
};

export const Route = createFileRoute("/api/public/btc/consensus")({
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
          const data = await getBtcConsensus();
          return Response.json(data, {
            status: data.ok ? 200 : 502,
            headers: { ...CORS, "Cache-Control": "public, max-age=3" },
          });
        } catch (e) {
          return Response.json(
            { ok: false, error: (e as Error).message },
            { status: 500, headers: CORS },
          );
        }
      },
    },
  },
});
