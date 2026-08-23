// Public read-only API: BTC trendline BUY / MID / SELL levels.
//
//   GET /api/public/btc/levels
//   GET /api/public/btc/levels?candles=1&limit=120
//
// Optional auth: if BTC_LEVELS_API_KEY is set as a secret, callers must send
// it as `x-api-key` (or `?key=`). If unset, the endpoint is fully public.
// CORS is open so browser apps can consume it directly.

import { createFileRoute } from "@tanstack/react-router";
import { getBtcLevels } from "@/lib/btcLevels.server";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, OPTIONS",
  "Access-Control-Allow-Headers": "content-type, x-api-key",
};

export const Route = createFileRoute("/api/public/btc/levels")({
  server: {
    handlers: {
      OPTIONS: async () => new Response(null, { status: 204, headers: CORS }),
      GET: async ({ request }) => {
        const url = new URL(request.url);
        const required = process.env["BTC_LEVELS_API_KEY"];
        if (required) {
          const provided = request.headers.get("x-api-key") ?? url.searchParams.get("key");
          if (provided !== required) {
            return Response.json(
              { ok: false, error: "unauthorized" },
              { status: 401, headers: CORS },
            );
          }
        }

        const includeCandles = ["1", "true", "yes"].includes(
          (url.searchParams.get("candles") ?? "").toLowerCase(),
        );
        const limitRaw = Number(url.searchParams.get("limit"));
        const limit = Number.isFinite(limitRaw) && limitRaw > 0 ? Math.round(limitRaw) : 300;

        try {
          const data = await getBtcLevels({ limit, includeCandles });
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
