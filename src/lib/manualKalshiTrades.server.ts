// Server-only helpers for syncing manual Kalshi trades.
// Duplicates the RSA-PSS signer from kalshiUserConnection because that file
// is a *.functions.ts and we want to keep this helper server-only.

import { createSign, createPrivateKey, constants } from "node:crypto";

const KALSHI_BASE = "https://api.elections.kalshi.com/trade-api/v2";

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

function signHeaders(method: string, path: string, keyId: string, rawPem: string): Record<string, string> {
  const pem = normalizePem(rawPem);
  if (/-----BEGIN ENCRYPTED PRIVATE KEY-----/.test(pem)) {
    throw new Error("Encrypted PEM not supported");
  }
  const key = createPrivateKey({ key: pem, format: "pem" });
  if (key.asymmetricKeyType !== "rsa") throw new Error("Kalshi requires RSA key");

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

export interface KalshiFill {
  trade_id: string;
  order_id: string;
  ticker: string;
  side: "yes" | "no";
  action: "buy" | "sell";
  count: number;
  yes_price?: number;
  no_price?: number;
  created_time: string;
  is_taker?: boolean;
}

/** Fetch fills from Kalshi for the given user credentials.
 *  Paginates until either `minTime` reached or no more pages. */
export async function fetchKalshiFills(
  keyId: string,
  pem: string,
  minTime: Date,
): Promise<KalshiFill[]> {
  const out: KalshiFill[] = [];
  let cursor: string | undefined;
  let safety = 20;
  while (safety-- > 0) {
    const params = new URLSearchParams({ limit: "200" });
    if (cursor) params.set("cursor", cursor);
    const path = `/portfolio/fills?${params.toString()}`;
    const headers = signHeaders("GET", `/portfolio/fills`, keyId, pem);
    const res = await fetch(`${KALSHI_BASE}${path}`, {
      method: "GET",
      headers: { ...headers, Accept: "application/json" },
    });
    if (!res.ok) {
      const txt = await res.text();
      throw new Error(`Kalshi /portfolio/fills ${res.status}: ${txt.slice(0, 240)}`);
    }
    const j = (await res.json()) as { fills?: KalshiFill[]; cursor?: string };
    const batch = j.fills ?? [];
    if (batch.length === 0) break;
    let hitFloor = false;
    for (const f of batch) {
      if (new Date(f.created_time) < minTime) {
        hitFloor = true;
        continue;
      }
      out.push(f);
    }
    if (hitFloor) break;
    cursor = j.cursor;
    if (!cursor) break;
  }
  return out;
}

/** Fetch settlement for a ticker to compute realized PnL. Returns null if not settled. */
export async function fetchMarketSettle(
  keyId: string,
  pem: string,
  ticker: string,
): Promise<{ settled: boolean; result?: "yes" | "no" } | null> {
  const path = `/markets/${encodeURIComponent(ticker)}`;
  const headers = signHeaders("GET", path, keyId, pem);
  const res = await fetch(`${KALSHI_BASE}${path}`, {
    method: "GET",
    headers: { ...headers, Accept: "application/json" },
  });
  if (!res.ok) return null;
  const j = (await res.json()) as { market?: { status?: string; result?: string } };
  const status = j.market?.status;
  const result = j.market?.result;
  if (status === "settled" || status === "finalized") {
    return { settled: true, result: result === "yes" ? "yes" : result === "no" ? "no" : undefined };
  }
  return { settled: false };
}
