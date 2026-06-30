// Kalshi order execution + trade logging.
// RSA-PSS signed Kalshi requests run server-side only.
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

const KALSHI_BASE = "https://api.elections.kalshi.com/trade-api/v2";

const PlaceOrderSchema = z.object({
  ticker: z.string().min(1),
  eventTicker: z.string().optional(),
  side: z.enum(["YES", "NO"]),
  contracts: z.number().int().min(1).max(10_000),
  limitPriceCents: z.number().int().min(1).max(99),
  strike: z.number().optional(),
  spot: z.number().optional(),
  modelProb: z.number().min(0).max(1).optional(),
  marketYesPrice: z.number().min(0).max(1).optional(),
  edgePts: z.number().optional(),
  stakeUsd: z.number().min(0).optional(),
  bankrollUsd: z.number().min(0).optional(),
  kellyMultiplier: z.number().min(0).max(1).optional(),
  closeTime: z.string().optional(),
});

async function signKalshi(method: string, path: string): Promise<Record<string, string>> {
  const keyId = process.env.KALSHI_API_KEY_ID;
  const rawPem = process.env.KALSHI_PRIVATE_KEY_PEM;
  if (!keyId || !rawPem) throw new Error("Kalshi credentials not configured");
  // Normalize PEM: convert literal "\n" to real newlines, and if the body has
  // no line breaks at all, reflow it into a proper PEM block.
  let pem = rawPem.replace(/\\n/g, "\n").replace(/\r/g, "").trim();
  const headerMatch = pem.match(/-----BEGIN ([A-Z0-9 ]+)-----([\s\S]*?)-----END \1-----/);
  if (headerMatch && !headerMatch[2].includes("\n")) {
    const label = headerMatch[1];
    const body = headerMatch[2].replace(/\s+/g, "");
    const wrapped = body.match(/.{1,64}/g)?.join("\n") ?? body;
    pem = `-----BEGIN ${label}-----\n${wrapped}\n-----END ${label}-----\n`;
  }
  const { createSign, createPrivateKey, constants } = await import("node:crypto");
  const ts = Date.now().toString();
  const msg = `${ts}${method}${path}`;
  const key = createPrivateKey({ key: pem, format: "pem" });
  const signer = createSign("RSA-SHA256");
  signer.update(msg);
  signer.end();
  const signature = signer.sign({
    key,
    padding: constants.RSA_PKCS1_PSS_PADDING,
    saltLength: constants.RSA_PSS_SALTLEN_DIGEST,
  }).toString("base64");
  return {
    "KALSHI-ACCESS-KEY": keyId,
    "KALSHI-ACCESS-TIMESTAMP": ts,
    "KALSHI-ACCESS-SIGNATURE": signature,
  };
}

export const placeKalshiOrder = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) => PlaceOrderSchema.parse(input))
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    const path = "/portfolio/orders";

    // Pre-insert pending row so failures are recorded too.
    const { data: trade, error: insErr } = await supabase
      .from("crypto_trades")
      .insert({
        user_id: userId,
        ticker: data.ticker,
        event_ticker: data.eventTicker ?? null,
        side: data.side,
        strike: data.strike ?? null,
        spot_at_entry: data.spot ?? null,
        model_prob: data.modelProb ?? null,
        market_yes_price: data.marketYesPrice ?? null,
        edge_pts: data.edgePts ?? null,
        contracts: data.contracts,
        stake_usd: data.stakeUsd ?? (data.contracts * data.limitPriceCents) / 100,
        bankroll_usd: data.bankrollUsd ?? null,
        kelly_multiplier: data.kellyMultiplier ?? null,
        close_time: data.closeTime ?? null,
        status: "pending",
      })
      .select("id")
      .single();
    if (insErr) throw new Error(insErr.message);

    let headers: Record<string, string>;
    try {
      headers = await signKalshi("POST", path);
    } catch (e: any) {
      await supabase.from("crypto_trades").update({
        status: "error", error: e?.message ?? "sign failed",
      }).eq("id", trade.id);
      throw e;
    }

    const body = {
      ticker: data.ticker,
      action: "buy",
      side: data.side === "YES" ? "yes" : "no",
      type: "limit",
      count: data.contracts,
      yes_price: data.side === "YES" ? data.limitPriceCents : undefined,
      no_price: data.side === "NO" ? data.limitPriceCents : undefined,
      client_order_id: trade.id,
    };

    const res = await fetch(`${KALSHI_BASE}${path}`, {
      method: "POST",
      headers: { ...headers, "Content-Type": "application/json", Accept: "application/json" },
      body: JSON.stringify(body),
    });
    const json: any = await res.json().catch(() => ({}));
    if (!res.ok) {
      const msg = json?.error?.message ?? json?.message ?? `Kalshi ${res.status}`;
      await supabase.from("crypto_trades").update({
        status: "error", error: msg, raw: json,
      }).eq("id", trade.id);
      throw new Error(msg);
    }

    const orderId = json?.order?.order_id ?? json?.order_id ?? null;
    await supabase.from("crypto_trades").update({
      status: "submitted", kalshi_order_id: orderId, raw: json,
    }).eq("id", trade.id);

    return { ok: true, tradeId: trade.id, orderId, response: json };
  });

export const listMyCryptoTrades = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { supabase, userId } = context;
    const { data, error } = await supabase
      .from("crypto_trades")
      .select("*")
      .eq("user_id", userId)
      .order("created_at", { ascending: false })
      .limit(100);
    if (error) throw new Error(error.message);
    return { trades: data ?? [] };
  });

export const checkKalshiConfigured = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async () => ({
    configured: !!(process.env.KALSHI_API_KEY_ID && process.env.KALSHI_PRIVATE_KEY_PEM),
    externalModel: !!process.env.CRYPTO_MODEL_URL,
  }));
