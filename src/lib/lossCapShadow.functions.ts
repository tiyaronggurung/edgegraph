// Shadow-study server functions for Fix #1 (price-bucket skip filter),
// Fix #2 (-$30 hard loss cap sim), and Fix #4 (TA-shadow backfill).
//
// SHADOW-ONLY. These functions READ auto_trade_orders / auto_trade_flip_shadow
// and WRITE only to auto_trade_ta_shadow (backfill). Nothing here influences
// the live buy path, ladder, SL/TP, partials, manual close, or live exits.
import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { getChartVerdict } from "./ta/chartVerdict";
import type { Candle } from "./ta/chartSignals";

// ── Fix #1: Price-bucket skip report ─────────────────────────────────────
export interface BucketStat {
  label: string;
  n: number;
  wins: number;
  losses: number;
  win_rate: number;
  total_pnl: number;
  avg_pnl: number;
}

export interface SkipBucketReport {
  total_settled: number;
  total_pnl: number;
  buckets: BucketStat[];
  proposed_filter: {
    label: string;
    would_skip_n: number;
    losses_saved_usd: number;
    wins_killed_usd: number;
    net_usd: number;
  };
}

function bucketOf(cents: number): string {
  if (cents < 30) return "<30¢ (longshot)";
  if (cents < 50) return "30–49¢";
  if (cents < 70) return "50–69¢ (coinflip)";
  if (cents < 85) return "70–84¢";
  return "85¢+";
}

const PROPOSED_SKIP = (c: number) => c < 30 || (c >= 50 && c < 70);

export const getSkipBucketReport = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<SkipBucketReport> => {
    const { supabase, userId } = context;
    const { data, error } = await supabase
      .from("auto_trade_orders")
      .select("entry_price_cents, limit_cents, pnl_usd, status")
      .eq("user_id", userId)
      .in("status", ["settled_win", "settled_loss"])
      .not("pnl_usd", "is", null);
    if (error) throw new Error(error.message);

    const rows = (data ?? []).map((r: any) => ({
      cents: Number(r.entry_price_cents ?? r.limit_cents ?? 0),
      pnl: Number(r.pnl_usd ?? 0),
    })).filter((r) => r.cents > 0);

    const map = new Map<string, BucketStat>();
    let total_pnl = 0;
    for (const r of rows) {
      const key = bucketOf(r.cents);
      const cur = map.get(key) ?? { label: key, n: 0, wins: 0, losses: 0, win_rate: 0, total_pnl: 0, avg_pnl: 0 };
      cur.n++;
      cur.total_pnl += r.pnl;
      if (r.pnl >= 0) cur.wins++;
      else cur.losses++;
      map.set(key, cur);
      total_pnl += r.pnl;
    }

    const order = ["<30¢ (longshot)", "30–49¢", "50–69¢ (coinflip)", "70–84¢", "85¢+"];
    const buckets = order
      .map((k) => map.get(k))
      .filter(Boolean)
      .map((b) => ({
        ...(b as BucketStat),
        win_rate: b!.n ? b!.wins / b!.n : 0,
        avg_pnl: b!.n ? b!.total_pnl / b!.n : 0,
      }));

    const wouldSkip = rows.filter((r) => PROPOSED_SKIP(r.cents));
    let losses_saved = 0;
    let wins_killed = 0;
    for (const r of wouldSkip) {
      if (r.pnl < 0) losses_saved += -r.pnl;
      else wins_killed += r.pnl;
    }

    return {
      total_settled: rows.length,
      total_pnl,
      buckets,
      proposed_filter: {
        label: "Skip <30¢ (longshots) AND 50–69¢ (coinflips)",
        would_skip_n: wouldSkip.length,
        losses_saved_usd: losses_saved,
        wins_killed_usd: wins_killed,
        net_usd: losses_saved - wins_killed,
      },
    };
  });

// ── Fix #2: -$30 hard loss cap simulation ────────────────────────────────
export interface LossCapReport {
  cap_usd: number;
  total_flip_rows: number;
  eligible: number;
  cap_would_fire: number;
  saved_losses_usd: number;   // sum of (actual_loss - cap) where actual loss deeper than cap
  killed_wins_usd: number;    // sum of positive PnL where cap would have exited early
  net_usd: number;
  actual_pnl_sample: number;
  simulated_pnl_sample: number;
}

// For each flip_shadow row we know: entry_cents (side we bought at), contracts,
// min_mark_seen (worst mark of the position). Convert min mark to worst P&L:
//   worst_pnl = (min_mark_seen - entry_cents) * contracts / 100
// If worst_pnl <= -CAP → cap fires, sim exit at -CAP flat.
export const getLossCapReport = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { cap_usd?: number } | undefined) => ({ cap_usd: input?.cap_usd ?? 30 }))
  .handler(async ({ data, context }): Promise<LossCapReport> => {
    const { supabase, userId } = context;
    const cap = Math.max(5, Math.min(200, Number(data.cap_usd) || 30));
    const { data: rows, error } = await supabase
      .from("auto_trade_flip_shadow")
      .select("entry_cents, contracts, min_mark_seen, actual_pnl, actual_outcome")
      .eq("user_id", userId)
      .not("actual_pnl", "is", null)
      .not("min_mark_seen", "is", null);
    if (error) throw new Error(error.message);

    let cap_would_fire = 0;
    let saved = 0;
    let killed = 0;
    let actual_sum = 0;
    let sim_sum = 0;
    let eligible = 0;

    for (const r of (rows ?? []) as any[]) {
      const entry = Number(r.entry_cents);
      const contracts = Number(r.contracts);
      const minMark = Number(r.min_mark_seen);
      const pnl = Number(r.actual_pnl);
      if (!entry || !contracts) continue;
      eligible++;
      actual_sum += pnl;

      const worstPnl = ((minMark - entry) * contracts) / 100;
      if (worstPnl <= -cap) {
        cap_would_fire++;
        // sim exit at -cap flat
        sim_sum += -cap;
        if (pnl < -cap) saved += (-cap) - pnl; // saved a deeper loss
        else if (pnl > 0) killed += pnl;       // killed a winner
      } else {
        sim_sum += pnl;
      }
    }

    return {
      cap_usd: cap,
      total_flip_rows: (rows ?? []).length,
      eligible,
      cap_would_fire,
      saved_losses_usd: saved,
      killed_wins_usd: killed,
      net_usd: saved - killed,
      actual_pnl_sample: actual_sum,
      simulated_pnl_sample: sim_sum,
    };
  });

// ── Fix #4: TA shadow backfill from historical Binance klines ────────────
async function fetchKlinesAt(interval: "1m" | "5m", endMs: number, limit: number): Promise<Candle[]> {
  const url = `https://api.binance.com/api/v3/klines?symbol=BTCUSDT&interval=${interval}&endTime=${endMs}&limit=${limit}`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`binance ${interval} ${res.status}`);
  const raw = (await res.json()) as unknown[];
  return raw.map((row) => {
    const r = row as [number, string, string, string, string, string];
    return {
      t: Number(r[0]),
      o: parseFloat(r[1]),
      h: parseFloat(r[2]),
      l: parseFloat(r[3]),
      c: parseFloat(r[4]),
      v: parseFloat(r[5]),
    } satisfies Candle;
  });
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export interface BackfillResult {
  scanned: number;
  inserted: number;
  skipped: number;
  errors: number;
}

export const backfillTaShadow = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { limit?: number } | undefined) => ({ limit: input?.limit ?? 250 }))
  .handler(async ({ data, context }): Promise<BackfillResult> => {
    const { supabase, userId } = context;
    const limit = Math.max(1, Math.min(500, Number(data.limit) || 250));

    // Find recent orders that don't yet have a TA shadow row.
    const { data: orders, error: oErr } = await supabase
      .from("auto_trade_orders")
      .select("id, ticker, side, entry_price_cents, limit_cents, model_prob, edge_pts, created_at, pnl_usd, status")
      .eq("user_id", userId)
      .in("status", ["settled_win", "settled_loss", "placed"])
      .order("created_at", { ascending: false })
      .limit(limit);
    if (oErr) throw new Error(oErr.message);

    const orderIds = (orders ?? []).map((o: any) => o.id);
    if (!orderIds.length) return { scanned: 0, inserted: 0, skipped: 0, errors: 0 };

    const { data: existing } = await supabase
      .from("auto_trade_ta_shadow")
      .select("order_id")
      .eq("user_id", userId)
      .in("order_id", orderIds);
    const have = new Set((existing ?? []).map((r: any) => r.order_id));

    let inserted = 0, skipped = 0, errors = 0;

    for (const o of orders ?? []) {
      if (have.has(o.id)) { skipped++; continue; }
      try {
        const endMs = new Date((o as any).created_at).getTime();
        // Fetch ~4h of 1m and 5m klines ending at order creation time.
        const [c1, c5] = await Promise.all([
          fetchKlinesAt("1m", endMs, 240),
          fetchKlinesAt("5m", endMs, 48),
        ]);
        if (!c1.length || !c5.length) { errors++; continue; }

        const verdict = getChartVerdict(c1, c5);
        const cents = Number((o as any).entry_price_cents ?? (o as any).limit_cents ?? 0);
        const modelProb = (o as any).model_prob == null ? null : Number((o as any).model_prob);
        const edge = (o as any).edge_pts == null ? null : Number((o as any).edge_pts);
        const kalshiDir: "YES" | "NO" | "neutral" =
          edge == null || edge === 0 ? "neutral" : edge > 0 ? "YES" : "NO";
        const modelDir: "YES" | "NO" | "neutral" =
          modelProb == null ? "neutral" : modelProb > 0.52 ? "YES" : modelProb < 0.48 ? "NO" : "neutral";

        const dirs = [kalshiDir, modelDir, verdict.combined.direction];
        const yes = dirs.filter((d) => d === "YES").length;
        const no = dirs.filter((d) => d === "NO").length;
        const all_three_agree = yes === 3 || no === 3;
        const two_of_three_agree = !all_three_agree && (yes >= 2 || no >= 2);
        const ta_disagrees_kalshi = verdict.combined.direction !== "neutral" && kalshiDir !== "neutral" && verdict.combined.direction !== kalshiDir;
        const ta_disagrees_model = verdict.combined.direction !== "neutral" && modelDir !== "neutral" && verdict.combined.direction !== modelDir;

        const pnl = (o as any).pnl_usd == null ? null : Number((o as any).pnl_usd);
        const outcome = pnl == null ? null : pnl >= 0 ? "win" : "loss";
        const full_loss = pnl == null ? null : pnl <= -50;

        const { error: iErr } = await supabase.from("auto_trade_ta_shadow").insert({
          user_id: userId,
          order_id: (o as any).id,
          ticker: (o as any).ticker ?? null,
          side_evaluated: (o as any).side ?? null,
          kalshi_price_cents: cents || null,
          model_prob: modelProb,
          edge_pts: edge,
          kalshi_direction: kalshiDir,
          model_direction: modelDir,
          ta_direction_1m: verdict.tf1m.direction,
          ta_direction_5m: verdict.tf5m.direction,
          ta_direction_combined: verdict.combined.direction,
          ta_confidence: verdict.combined.confidence,
          ta_reasons: verdict.combined.reasons,
          trend_1m: verdict.tf1m.trend,
          trend_5m: verdict.tf5m.trend,
          support_level: verdict.tf5m.support,
          resistance_level: verdict.tf5m.resistance,
          nearest_round_level: verdict.roundLevel,
          rejection_wick_flag: verdict.tf1m.rejectionFlag || verdict.tf5m.rejectionFlag,
          all_three_agree,
          two_of_three_agree,
          ta_disagrees_kalshi,
          ta_disagrees_model,
          actual_outcome: outcome,
          actual_pnl_usd: pnl,
          full_loss,
          settled_at: outcome ? (o as any).created_at : null,
        });
        if (iErr) { errors++; continue; }
        inserted++;

        // Gentle pacing against Binance rate limits.
        await sleep(120);
      } catch {
        errors++;
      }
    }

    return { scanned: (orders ?? []).length, inserted, skipped, errors };
  });
