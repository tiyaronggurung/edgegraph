// Real Kalshi account reader for the Ops Manual page.
// READ-ONLY: signs GET requests to /portfolio/balance, /portfolio/settlements,
// /portfolio/positions and /portfolio/fills using the per-user credentials
// stored on public.profiles. Places no orders, changes no existing trade logic.

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
    const m = pem.match(/-----BEGIN ([A-Z0-9 ]+)-----([\s\S]*?)-----END \1-----/);
    if (m && !m[2].includes("\n")) {
      const body = m[2].replace(/\s+/g, "");
      const wrapped = body.match(/.{1,64}/g)?.join("\n") ?? body;
      pem = `-----BEGIN ${m[1]}-----\n${wrapped}\n-----END ${m[1]}-----\n`;
    }
  }
  return pem;
}

async function signHeaders(
  method: string,
  path: string,
  keyId: string,
  rawPem: string,
): Promise<Record<string, string>> {
  const pem = normalizePem(rawPem);
  if (/-----BEGIN ENCRYPTED PRIVATE KEY-----/.test(pem)) {
    throw new Error("Encrypted PEM is not supported. Export an unencrypted PKCS#8 PEM.");
  }
  const { createSign, constants } = await import("node:crypto");
  const ts = Date.now().toString();
  const signer = createSign("RSA-SHA256");
  signer.update(`${ts}${method}/trade-api/v2${path}`);
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
    Accept: "application/json",
  };
}

async function kalshiGet<T>(pathWithQuery: string, keyId: string, pem: string): Promise<T> {
  // Kalshi signs only the path (no query string).
  const path = pathWithQuery.split("?")[0];
  const headers = await signHeaders("GET", path, keyId, pem);
  const res = await fetch(`${KALSHI_BASE}${pathWithQuery}`, { method: "GET", headers });
  const text = await res.text();
  if (!res.ok) throw new Error(`Kalshi ${res.status} on ${path}: ${text.slice(0, 200)}`);
  return JSON.parse(text) as T;
}

const c2d = (cents: number | null | undefined) =>
  typeof cents === "number" && Number.isFinite(cents) ? Math.round(cents) / 100 : 0;

export type KalshiSettlementRow = {
  ticker: string;
  settledAt: string | null;
  side: "yes" | "no" | null;
  contracts: number;
  cost: number;
  revenue: number;
  pnl: number;
  result: "win" | "loss";
  marketResult: string | null;
};

export type KalshiAccountSnapshot = {
  connected: boolean;
  error?: string;
  balance: number | null;
  /** Cash + value of resting orders/positions, when Kalshi reports it. */
  payout: number | null;
  openPositions: Array<{
    ticker: string;
    position: number;
    side: "yes" | "no";
    exposure: number;
    restingOrders: number;
  }>;
  openExposure: number;
  settlements: KalshiSettlementRow[];
  totals: {
    n: number;
    wins: number;
    losses: number;
    winRate: number | null;
    cost: number;
    revenue: number;
    pnl: number;
    roi: number | null;
  };
  allTime: {
    n: number;
    wins: number;
    losses: number;
    winRate: number | null;
    cost: number;
    revenue: number;
    pnl: number;
    roi: number | null;
    /** Sum of P/L on losing settlements only (negative number). */
    grossLoss: number;
    /** Sum of P/L on winning settlements only (positive number). */
    grossProfit: number;
    /** Total traded turnover: cost paid + payouts received. */
    volume: number;
  };
  today: {
    n: number;
    wins: number;
    losses: number;
    pnl: number;
    cost: number;
  };
  btcOnly: {
    n: number;
    wins: number;
    losses: number;
    winRate: number | null;
    pnl: number;
  };
  fetchedAt: string;
};

type RawSettlement = {
  ticker?: string;
  market_result?: string;
  // Current Kalshi shape: *_fp counts and *_dollars costs are strings,
  // revenue / value stay in cents.
  yes_count_fp?: string;
  no_count_fp?: string;
  yes_total_cost_dollars?: string;
  no_total_cost_dollars?: string;
  fee_cost?: string;
  // Legacy numeric shape (kept as fallback).
  yes_count?: number;
  no_count?: number;
  yes_total_cost?: number;
  no_total_cost?: number;
  revenue?: number;
  settled_time?: string;
};

const num = (v: unknown): number => {
  const n = typeof v === "string" ? Number(v) : typeof v === "number" ? v : 0;
  return Number.isFinite(n) ? n : 0;
};

type RawPosition = {
  ticker?: string;
  position?: number;
  market_exposure?: number;
  resting_orders_count?: number;
};

/** Pages through EVERY settlement (no truncation) so all-time totals are exact. */
async function fetchAllSettlements(
  keyId: string,
  pem: string,
): Promise<{ settlements: RawSettlement[] }> {
  const out: RawSettlement[] = [];
  let cursor = "";
  const seen = new Set<string>();
  for (let page = 0; page < 100; page++) {
    const q = `/portfolio/settlements?limit=200${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ""}`;
    const res = await kalshiGet<{ settlements?: RawSettlement[]; cursor?: string }>(q, keyId, pem);
    const rows = res.settlements ?? [];
    out.push(...rows);
    const next = res.cursor ?? "";
    if (!next || rows.length === 0 || seen.has(next)) break;
    seen.add(next);
    cursor = next;
  }
  return { settlements: out };
}


export async function loadKalshiAccount(
  supabase: {
    from: (t: string) => {
      select: (c: string) => {
        eq: (
          col: string,
          v: string,
        ) => { maybeSingle: () => Promise<{ data: unknown; error: { message: string } | null }> };
      };
    };
  },
  userId: string,
  opts?: { days?: number },
): Promise<KalshiAccountSnapshot> {
  const empty: KalshiAccountSnapshot = {
    connected: false,
    balance: null,
    payout: null,
    openPositions: [],
    openExposure: 0,
    settlements: [],
    totals: { n: 0, wins: 0, losses: 0, winRate: null, cost: 0, revenue: 0, pnl: 0, roi: null },
    allTime: { n: 0, wins: 0, losses: 0, winRate: null, cost: 0, revenue: 0, pnl: 0, roi: null, grossLoss: 0, grossProfit: 0, volume: 0 },
    today: { n: 0, wins: 0, losses: 0, pnl: 0, cost: 0 },
    btcOnly: { n: 0, wins: 0, losses: 0, winRate: null, pnl: 0 },
    fetchedAt: new Date().toISOString(),
  };

  const { data, error } = await supabase
    .from("profiles")
    .select("kalshi_api_key_id, kalshi_private_key_pem")
    .eq("id", userId)
    .maybeSingle();
  if (error) return { ...empty, error: error.message };

  const prof = (data ?? {}) as { kalshi_api_key_id?: string | null; kalshi_private_key_pem?: string | null };
  const keyId = (prof.kalshi_api_key_id ?? "").trim();
  const pem = prof.kalshi_private_key_pem ?? "";
  if (!keyId || !pem.trim()) {
    return { ...empty, error: "No Kalshi API credentials saved on this account." };
  }

  const days = Math.max(1, Math.min(90, opts?.days ?? 30));
  const minMs = Date.now() - days * 86_400_000;

  try {
    const [bal, pos, settle] = await Promise.all([
      kalshiGet<{ balance?: number; balance_dollars?: string; portfolio_value?: number }>(
        "/portfolio/balance",
        keyId,
        pem,
      ),
      // Positions is best-effort: some key scopes reject it, and it must never
      // hide the balance / settled P/L below.
      kalshiGet<{ market_positions?: RawPosition[] }>("/portfolio/positions", keyId, pem).catch(
        () => ({ market_positions: [] as RawPosition[] }),
      ),
      fetchAllSettlements(keyId, pem).catch(() => ({ settlements: [] as RawSettlement[] })),
    ]);

    const openPositions = (pos.market_positions ?? [])
      .filter((p) => (p.position ?? 0) !== 0 || (p.resting_orders_count ?? 0) > 0)
      .map((p) => ({
        ticker: p.ticker ?? "—",
        position: p.position ?? 0,
        side: ((p.position ?? 0) >= 0 ? "yes" : "no") as "yes" | "no",
        exposure: c2d(p.market_exposure),
        restingOrders: p.resting_orders_count ?? 0,
      }));

    const rows: KalshiSettlementRow[] = (settle.settlements ?? []).map((s) => {
      const yes = num(s.yes_count_fp) || num(s.yes_count);
      const no = num(s.no_count_fp) || num(s.no_count);
      const fee = num(s.fee_cost);
      const cost =
        Math.round(
          (num(s.yes_total_cost_dollars) +
            num(s.no_total_cost_dollars) +
            c2d(s.yes_total_cost) +
            c2d(s.no_total_cost) +
            fee) *
            100,
        ) / 100;
      // Offsetting YES+NO contracts (a round trip that closed flat) are paid
      // out at $1 per matched pair and are NOT included in `revenue`.
      const matched = Math.min(yes, no);
      const revenue = Math.round((c2d(s.revenue) + matched) * 100) / 100;
      const pnl = Math.round((revenue - cost) * 100) / 100;
      return {
        ticker: s.ticker ?? "—",
        settledAt: s.settled_time ?? null,
        side: yes > no ? ("yes" as const) : no > yes ? ("no" as const) : yes > 0 ? ("yes" as const) : null,
        contracts: Math.round(Math.max(yes, no) * 100) / 100,
        cost,
        revenue,
        pnl,
        result: (pnl >= 0 ? "win" : "loss") as "win" | "loss",
        marketResult: s.market_result ?? null,
      };
    });

    const windowed = rows.filter((r) => !r.settledAt || new Date(r.settledAt).getTime() >= minMs);
    windowed.sort((a, b) => (b.settledAt ?? "").localeCompare(a.settledAt ?? ""));

    const agg = (list: KalshiSettlementRow[]) => {
      const wins = list.filter((r) => r.result === "win").length;
      const losses = list.length - wins;
      const cost = Math.round(list.reduce((a, r) => a + r.cost, 0) * 100) / 100;
      const revenue = Math.round(list.reduce((a, r) => a + r.revenue, 0) * 100) / 100;
      const pnl = Math.round((revenue - cost) * 100) / 100;
      const grossLoss =
        Math.round(list.filter((r) => r.pnl < 0).reduce((a, r) => a + r.pnl, 0) * 100) / 100;
      const grossProfit =
        Math.round(list.filter((r) => r.pnl > 0).reduce((a, r) => a + r.pnl, 0) * 100) / 100;
      return {
        grossLoss,
        grossProfit,
        volume: Math.round((cost + revenue) * 100) / 100,
        n: list.length,
        wins,
        losses,
        winRate: list.length ? wins / list.length : null,
        cost,
        revenue,
        pnl,
        roi: cost > 0 ? pnl / cost : null,
      };
    };

    const rowsW = windowed;
    const todayKey = new Date().toISOString().slice(0, 10);
    const todayRows = rowsW.filter((r) => (r.settledAt ?? "").slice(0, 10) === todayKey);
    const btcRows = rowsW.filter((r) => r.ticker.startsWith("KXBTC"));
    const t = agg(rowsW);
    const ta = agg(rows); // all-time, across every fetched settlement
    const tb = agg(btcRows);
    const td = agg(todayRows);

    return {
      connected: true,
      balance:
        bal.balance_dollars != null && Number.isFinite(Number(bal.balance_dollars))
          ? Math.round(Number(bal.balance_dollars) * 100) / 100
          : c2d(bal.balance),
      payout: typeof bal.portfolio_value === "number" ? c2d(bal.portfolio_value) : null,
      openPositions,
      openExposure: Math.round(openPositions.reduce((a, p) => a + p.exposure, 0) * 100) / 100,
      settlements: rowsW.slice(0, 100),
      totals: t,
      allTime: {
        n: ta.n,
        wins: ta.wins,
        losses: ta.losses,
        winRate: ta.winRate,
        cost: ta.cost,
        revenue: ta.revenue,
        pnl: ta.pnl,
        roi: ta.roi,
        grossLoss: ta.grossLoss,
        grossProfit: ta.grossProfit,
        volume: ta.volume,
      },
      today: { n: td.n, wins: td.wins, losses: td.losses, pnl: td.pnl, cost: td.cost },
      btcOnly: { n: tb.n, wins: tb.wins, losses: tb.losses, winRate: tb.winRate, pnl: tb.pnl },
      fetchedAt: new Date().toISOString(),
    };
  } catch (e) {
    return { ...empty, error: e instanceof Error ? e.message : String(e) };
  }
}
