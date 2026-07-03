// Per-user Kalshi API credentials: save, status, and test.
// Stored on public.profiles (kalshi_api_key_id, kalshi_private_key_pem).
// RLS scopes profile access to the owning user, so a user can only read/write
// their own credentials.
//
// This is intentionally SEPARATE from the env-based KALSHI_API_KEY_ID /
// KALSHI_PRIVATE_KEY_PEM used by cryptoTrades.functions.ts — nothing in the
// existing auto-trade / order flow is affected by this file.

import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

const KALSHI_BASE = "https://api.elections.kalshi.com/trade-api/v2";

// ---------- PEM normalization (mirrors cryptoTrades.functions.ts) ----------
function normalizePem(raw: string): string {
  let pem = raw.trim();
  if ((pem.startsWith('"') && pem.endsWith('"')) || (pem.startsWith("'") && pem.endsWith("'"))) {
    pem = pem.slice(1, -1);
  }
  pem = pem.replace(/\\n/g, "\n").replace(/\r/g, "").trim();

  if (!/-----BEGIN /.test(pem)) {
    const body = pem.replace(/\s+/g, "");
    const wrapped = body.match(/.{1,64}/g)?.join("\n") ?? body;
    pem = `-----BEGIN PRIVATE KEY-----\n${wrapped}\n-----END PRIVATE KEY-----\n`;
  } else {
    const headerMatch = pem.match(/-----BEGIN ([A-Z0-9 ]+)-----([\s\S]*?)-----END \1-----/);
    if (headerMatch && !headerMatch[2].includes("\n")) {
      const label = headerMatch[1];
      const body = headerMatch[2].replace(/\s+/g, "");
      const wrapped = body.match(/.{1,64}/g)?.join("\n") ?? body;
      pem = `-----BEGIN ${label}-----\n${wrapped}\n-----END ${label}-----\n`;
    }
  }
  return pem;
}

async function signWithUserKey(
  method: string,
  path: string,
  keyId: string,
  rawPem: string,
): Promise<Record<string, string>> {
  const pem = normalizePem(rawPem);
  if (/-----BEGIN ENCRYPTED PRIVATE KEY-----/.test(pem)) {
    throw new Error("Encrypted/passphrase-protected PEM is not supported. Export an unencrypted PKCS#8 PEM.");
  }
  const { createSign, createPrivateKey, constants } = await import("node:crypto");
  let key: import("node:crypto").KeyObject;
  try {
    key = createPrivateKey({ key: pem, format: "pem" });
  } catch (e: any) {
    throw new Error("Private key could not be decoded: " + (e?.message ?? String(e)));
  }
  if (key.asymmetricKeyType !== "rsa") {
    throw new Error(`Kalshi requires an RSA key (got ${key.asymmetricKeyType ?? "unknown"}).`);
  }

  const ts = Date.now().toString();
  const msg = `${ts}${method}/trade-api/v2${path}`;
  const signer = createSign("RSA-SHA256");
  signer.update(msg);
  signer.end();
  const signature = signer
    .sign({
      key: pem,
      padding: constants.RSA_PKCS1_PSS_PADDING,
      saltLength: constants.RSA_PSS_SALTLEN_DIGEST,
    })
    .toString("base64");

  return {
    "KALSHI-ACCESS-KEY": keyId,
    "KALSHI-ACCESS-TIMESTAMP": ts,
    "KALSHI-ACCESS-SIGNATURE": signature,
  };
}

// ---------------------------- server functions ----------------------------

/** Save (or clear) the user's Kalshi credentials on their profile. */
export const saveKalshiCreds = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { apiKeyId: string; privateKeyPem: string }) =>
    z
      .object({
        apiKeyId: z.string().trim().max(200),
        privateKeyPem: z.string().max(20_000),
      })
      .parse(input),
  )
  .handler(async ({ data, context }) => {
    const apiKeyId = data.apiKeyId.trim();
    const rawPem = data.privateKeyPem;

    // Empty strings clear the credential.
    const updates: Record<string, string | null> = {
      kalshi_api_key_id: apiKeyId.length ? apiKeyId : null,
      kalshi_private_key_pem: rawPem.trim().length ? rawPem : null,
    };

    // If a PEM was provided, sanity-parse it before saving so the user gets
    // an immediate error rather than a save-then-fail-on-test surprise.
    if (updates.kalshi_private_key_pem) {
      const pem = normalizePem(rawPem);
      if (/-----BEGIN ENCRYPTED PRIVATE KEY-----/.test(pem)) {
        throw new Error("Encrypted/passphrase-protected PEM is not supported. Export an unencrypted PKCS#8 PEM.");
      }
      const { createPrivateKey } = await import("node:crypto");
      try {
        const key = createPrivateKey({ key: pem, format: "pem" });
        if (key.asymmetricKeyType !== "rsa") {
          throw new Error(`Kalshi requires an RSA key (got ${key.asymmetricKeyType ?? "unknown"}).`);
        }
      } catch (e: any) {
        throw new Error("Private key could not be decoded: " + (e?.message ?? String(e)));
      }
    }

    const { error } = await context.supabase
      .from("profiles")
      .update(updates as never)
      .eq("id", context.userId);

    if (error) throw new Error(error.message);
    return { ok: true };
  });

/** Return whether the user has each credential configured (never returns the PEM). */
export const getKalshiCredsStatus = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { data, error } = await context.supabase
      .from("profiles")
      .select("kalshi_api_key_id, kalshi_private_key_pem")
      .eq("id", context.userId)
      .maybeSingle();
    if (error) throw new Error(error.message);
    const keyId = (data?.kalshi_api_key_id ?? "").trim();
    const pem = (data?.kalshi_private_key_pem ?? "").trim();
    return {
      hasKeyId: keyId.length > 0,
      hasPem: pem.length > 0,
      // Show the key ID (public part) so the user can verify which one is stored.
      apiKeyId: keyId || null,
    };
  });

/** Sign & call Kalshi /portfolio/balance to prove the stored credentials work. */
export const testKalshiConnection = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { data, error } = await context.supabase
      .from("profiles")
      .select("kalshi_api_key_id, kalshi_private_key_pem")
      .eq("id", context.userId)
      .maybeSingle();
    if (error) throw new Error(error.message);
    const keyId = (data?.kalshi_api_key_id ?? "").trim();
    const pem = data?.kalshi_private_key_pem ?? "";
    if (!keyId) return { ok: false, error: "No API Key ID saved." };
    if (!pem.trim()) return { ok: false, error: "No Private Key saved." };

    let headers: Record<string, string>;
    try {
      headers = await signWithUserKey("GET", "/portfolio/balance", keyId, pem);
    } catch (e: any) {
      return { ok: false, error: e?.message ?? String(e) };
    }

    try {
      const res = await fetch(`${KALSHI_BASE}/portfolio/balance`, {
        method: "GET",
        headers: { ...headers, Accept: "application/json" },
      });
      const text = await res.text();
      if (!res.ok) {
        return {
          ok: false,
          status: res.status,
          error:
            res.status === 401
              ? "Kalshi returned 401 UNAUTHORIZED. Verify the API Key ID and Private Key pair on kalshi.com → Profile → API Keys, and that the key targets production (api.elections.kalshi.com)."
              : `Kalshi ${res.status}: ${text.slice(0, 240)}`,
        };
      }
      let balanceCents: number | null = null;
      try {
        const j = JSON.parse(text) as { balance?: number };
        if (typeof j.balance === "number") balanceCents = j.balance;
      } catch {
        /* ignore */
      }
      return { ok: true, status: 200, balanceCents };
    } catch (e: any) {
      return { ok: false, error: "Network error calling Kalshi: " + (e?.message ?? String(e)) };
    }
  });
