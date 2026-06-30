// GET /api/health/kalshi — authenticated health probe for the Kalshi signing key.
// Verifies KALSHI_PRIVATE_KEY_PEM parses and RSA-PSS signing succeeds.
// Requires a Supabase bearer token in the Authorization header.
import { createFileRoute } from "@tanstack/react-router";
import { createClient } from "@supabase/supabase-js";

export const Route = createFileRoute("/api/health/kalshi")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const auth = request.headers.get("authorization") ?? "";
        const token = auth.toLowerCase().startsWith("bearer ")
          ? auth.slice(7).trim()
          : "";
        if (!token) {
          return Response.json({ ok: false, error: "Unauthorized" }, { status: 401 });
        }

        const supabase = createClient(
          process.env.SUPABASE_URL!,
          process.env.SUPABASE_PUBLISHABLE_KEY!,
          { auth: { persistSession: false, autoRefreshToken: false } },
        );
        const { data: userData, error: userErr } = await supabase.auth.getUser(token);
        if (userErr || !userData?.user) {
          return Response.json({ ok: false, error: "Unauthorized" }, { status: 401 });
        }

        const hasKeyId = !!process.env.KALSHI_API_KEY_ID;
        const rawPem = process.env.KALSHI_PRIVATE_KEY_PEM;
        if (!rawPem) {
          return Response.json(
            {
              ok: false,
              hasKeyId,
              hasPem: false,
              error: "KALSHI_PRIVATE_KEY_PEM is not configured",
            },
            { status: 503 },
          );
        }

        try {
          // Reuse the same validator the signing path uses.
          const { getValidatedKalshiKey } = await import("@/lib/cryptoTrades.functions");
          // getValidatedKalshiKey is module-private; fall back via dynamic shape:
          const key = await (getValidatedKalshiKey as any)();
          const details = key.key.asymmetricKeyDetails ?? {};
          return Response.json({
            ok: true,
            hasKeyId,
            hasPem: true,
            keyType: key.key.asymmetricKeyType ?? null,
            modulusBits: (details as { modulusLength?: number }).modulusLength ?? null,
            signAlgorithm: "RSA-PSS (SHA-256, salt=digest)",
          });
        } catch (e: any) {
          return Response.json(
            {
              ok: false,
              hasKeyId,
              hasPem: true,
              error: e?.message ?? String(e),
            },
            { status: 500 },
          );
        }
      },
    },
  },
});
