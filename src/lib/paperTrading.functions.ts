import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

const STAKE_CENTS = 1000; // $10 flat
const STARTING_CENTS = 50000; // $500

export interface PaperBalance {
  balance_cents: number;
  starting_cents: number;
  bankrupt_at: string | null;
  net_pnl_cents: number;
}

type JsonValue = string | number | boolean | null | JsonValue[] | { [k: string]: JsonValue };

export interface PaperFillRow {
  id: string;
  ticker: string;
  close_time: string;
  button: "model" | "pred" | "green_hours" | "manual" | "t5m" | "cheap_flip";
  side: "YES" | "NO";
  contracts: number;
  fill_price_cents: number;
  stake_cents: number;
  status: "open" | "won" | "lost" | "void";
  payout_cents: number | null;
  pnl_cents: number | null;
  settled_at: string | null;
  created_at: string;
  entry_snapshot: JsonValue;
}

export interface PaperStats {
  total: { fires: number; wins: number; losses: number; open: number; pnlCents: number };
  byButton: Record<"model" | "pred" | "green_hours" | "manual" | "t5m" | "cheap_flip", { fires: number; wins: number; losses: number; pnlCents: number }>;
}

async function ensureBalance(supabase: any, userId: string): Promise<PaperBalance> {
  const { data } = await supabase
    .from("paper_balances")
    .select("balance_cents, starting_cents, bankrupt_at")
    .eq("user_id", userId)
    .maybeSingle();
  if (!data) {
    // Seed via admin (RLS blocks user insert)
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    await supabaseAdmin.from("paper_balances").insert({ user_id: userId }).select().maybeSingle();
    return { balance_cents: STARTING_CENTS, starting_cents: STARTING_CENTS, bankrupt_at: null, net_pnl_cents: 0 };
  }
  return {
    balance_cents: data.balance_cents,
    starting_cents: data.starting_cents,
    bankrupt_at: data.bankrupt_at,
    net_pnl_cents: data.balance_cents - data.starting_cents,
  };
}

export const getPaperBalance = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<PaperBalance> => {
    return ensureBalance(context.supabase, context.userId);
  });

export const getPaperFills = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { limit?: number } | undefined) => d ?? {})
  .handler(async ({ context, data }): Promise<PaperFillRow[]> => {
    const limit = Math.min(Math.max(data.limit ?? 100, 1), 500);
    const { data: rows } = await context.supabase
      .from("paper_fills")
      .select("id,ticker,close_time,button,side,contracts,fill_price_cents,stake_cents,status,payout_cents,pnl_cents,settled_at,created_at,entry_snapshot")
      .eq("user_id", context.userId)
      .order("created_at", { ascending: false })
      .limit(limit);
    return (rows ?? []) as PaperFillRow[];
  });

export const getPaperStats = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<PaperStats> => {
    const { data } = await context.supabase
      .from("paper_fills")
      .select("button,status,pnl_cents")
      .eq("user_id", context.userId);
    const rows = (data ?? []) as Array<{ button: "model"|"pred"|"green_hours"|"manual"|"t5m"|"cheap_flip"; status: string; pnl_cents: number | null }>;
    const empty = () => ({ fires: 0, wins: 0, losses: 0, pnlCents: 0 });
    const stats: PaperStats = {
      total: { fires: 0, wins: 0, losses: 0, open: 0, pnlCents: 0 },
      byButton: { model: empty(), pred: empty(), green_hours: empty(), manual: empty(), t5m: empty(), cheap_flip: empty() },
    };
    for (const r of rows) {
      stats.total.fires += 1;
      if (r.status === "open") stats.total.open += 1;
      if (r.status === "won") stats.total.wins += 1;
      if (r.status === "lost") stats.total.losses += 1;
      stats.total.pnlCents += r.pnl_cents ?? 0;
      const b = stats.byButton[r.button];
      if (b) {
        b.fires += 1;
        if (r.status === "won") b.wins += 1;
        if (r.status === "lost") b.losses += 1;
        b.pnlCents += r.pnl_cents ?? 0;
      }
    }
    return stats;
  });

export const recordPaperFire = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: {
    ticker: string;
    closeTime: string;
    button: "model" | "pred" | "green_hours" | "manual" | "t5m";
    side: "YES" | "NO";
    contracts: number;
    fillPriceCents: number;
    snapshot?: JsonValue;
  }) => d)
  .handler(async ({ context, data }): Promise<{ ok: true; fillId: string; balanceCents: number } | { ok: false; reason: string; balanceCents: number }> => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const bal = await ensureBalance(context.supabase, context.userId);
    if (bal.bankrupt_at || bal.balance_cents < STAKE_CENTS) {
      return { ok: false, reason: "paper_bankrupt", balanceCents: bal.balance_cents };
    }

    const newBalance = bal.balance_cents - STAKE_CENTS;
    const bankruptAt = newBalance <= 0 ? new Date().toISOString() : null;

    const { error: balErr } = await supabaseAdmin
      .from("paper_balances")
      .update({ balance_cents: newBalance, bankrupt_at: bankruptAt })
      .eq("user_id", context.userId);
    if (balErr) return { ok: false, reason: `balance_update:${balErr.message}`, balanceCents: bal.balance_cents };

    const { data: fill, error: fillErr } = await supabaseAdmin
      .from("paper_fills")
      .insert({
        user_id: context.userId,
        ticker: data.ticker,
        close_time: data.closeTime,
        button: data.button,
        side: data.side,
        contracts: data.contracts,
        fill_price_cents: data.fillPriceCents,
        stake_cents: STAKE_CENTS,
        entry_snapshot: data.snapshot ?? {},
        status: "open",
      })
      .select("id")
      .single();
    if (fillErr || !fill) {
      // roll balance back
      await supabaseAdmin.from("paper_balances").update({ balance_cents: bal.balance_cents, bankrupt_at: bal.bankrupt_at }).eq("user_id", context.userId);
      return { ok: false, reason: `fill_insert:${fillErr?.message ?? "unknown"}`, balanceCents: bal.balance_cents };
    }

    return { ok: true, fillId: fill.id, balanceCents: newBalance };
  });

export const resetPaperBalance = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<PaperBalance> => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    await supabaseAdmin
      .from("paper_balances")
      .upsert({
        user_id: context.userId,
        balance_cents: STARTING_CENTS,
        starting_cents: STARTING_CENTS,
        bankrupt_at: null,
      });
    // Void any still-open fills so stats reset cleanly
    await supabaseAdmin
      .from("paper_fills")
      .update({ status: "void", settled_at: new Date().toISOString() })
      .eq("user_id", context.userId)
      .eq("status", "open");
    return { balance_cents: STARTING_CENTS, starting_cents: STARTING_CENTS, bankrupt_at: null, net_pnl_cents: 0 };
  });

// Settle any due open paper_fills for the current user. Called by the crypto
// page after fires and periodically. Server-side settlement using kalshi
// finalization or the internal btc_model_predictions.settle_price fallback.
export const settleMyPaperFills = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<{ settled: number }> => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: due } = await supabaseAdmin
      .from("paper_fills")
      .select("id,user_id,ticker,side,contracts,fill_price_cents,stake_cents,close_time,entry_snapshot")
      .eq("user_id", context.userId)
      .eq("status", "open")
      .lt("close_time", new Date().toISOString())
      .limit(50);
    const pending = (due ?? []) as Array<any>;
    if (!pending.length) return { settled: 0 };

    const tickers = [...new Set(pending.map(o => o.ticker))];
    const { data: closes } = await supabaseAdmin
      .from("btc_model_predictions")
      .select("ticker, settle_price, strike")
      .in("ticker", tickers)
      .not("settle_price", "is", null);
    const settleByTicker = new Map<string, { price: number; strike: number | null }>(
      ((closes ?? []) as any[])
        .filter(c => c.settle_price !== null)
        .map(c => [c.ticker, { price: Number(c.settle_price), strike: c.strike != null ? Number(c.strike) : null }]),
    );

    const { fetchKalshiSettlement } = await import("@/lib/kalshiSettle");

    let settled = 0;
    for (const o of pending) {
      let won: boolean | null = null;
      const k = await fetchKalshiSettlement(o.ticker).catch(() => null);
      if (k && k.finalized && k.result) {
        won = o.side === "YES" ? k.result === "yes" : k.result === "no";
      } else {
        const entry = settleByTicker.get(o.ticker);
        if (!entry || entry.strike == null) continue;
        won = o.side === "YES" ? entry.price >= entry.strike : entry.price < entry.strike;
      }

      // Payout: winners receive contracts * $1.00, losers get $0.
      // stake was already debited. So:
      //   won  -> credit contracts*100¢ back to balance; pnl = payout - stake
      //   lost -> no credit; pnl = -stake
      const payoutCents = won ? o.contracts * 100 : 0;
      const pnlCents = payoutCents - o.stake_cents;

      const { error: upErr } = await supabaseAdmin
        .from("paper_fills")
        .update({
          status: won ? "won" : "lost",
          payout_cents: payoutCents,
          pnl_cents: pnlCents,
          settled_at: new Date().toISOString(),
        })
        .eq("id", o.id);
      if (upErr) continue;

      if (payoutCents > 0) {
        const { data: cur } = await supabaseAdmin
          .from("paper_balances")
          .select("balance_cents,bankrupt_at")
          .eq("user_id", o.user_id)
          .maybeSingle();
        if (cur) {
          const newBal = cur.balance_cents + payoutCents;
          await supabaseAdmin
            .from("paper_balances")
            .update({
              balance_cents: newBal,
              // Un-bankrupt if credit lifts them back above zero
              bankrupt_at: newBal > 0 ? null : cur.bankrupt_at,
            })
            .eq("user_id", o.user_id);
        }
      }
      settled++;
    }

    return { settled };
  });
