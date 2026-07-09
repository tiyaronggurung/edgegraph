// Manual Kalshi trades — trades placed in the Kalshi app (outside the bot).
// Pulls fills from Kalshi's /portfolio/fills, filters out any that correspond
// to bot orders (kalshi_order_id in auto_trade_orders), and stores the rest.

import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

/** Sync last N days of manual trades for the calling user. */
export const syncManualKalshiTrades = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { daysBack?: number }) =>
    z.object({ daysBack: z.number().min(1).max(365).optional() }).parse(input ?? {}),
  )
  .handler(async ({ data, context }) => {
    const daysBack = data.daysBack ?? 30;
    const { supabase, userId } = context;

    // Load user's Kalshi creds.
    const { data: prof, error: profErr } = await supabase
      .from("profiles")
      .select("kalshi_api_key_id, kalshi_private_key_pem")
      .eq("id", userId)
      .maybeSingle();
    if (profErr) throw new Error(profErr.message);
    const keyId = (prof?.kalshi_api_key_id ?? "").trim();
    const pem = (prof?.kalshi_private_key_pem ?? "").trim();
    if (!keyId || !pem) {
      return { ok: false as const, error: "Kalshi credentials not configured. Add them in Settings." };
    }

    const { fetchKalshiFills, fetchMarketSettle } = await import("@/lib/manualKalshiTrades.server");
    const minTime = new Date(Date.now() - daysBack * 24 * 60 * 60 * 1000);

    let fills;
    try {
      fills = await fetchKalshiFills(keyId, pem, minTime);
    } catch (e: any) {
      return { ok: false as const, error: e?.message ?? String(e) };
    }

    if (fills.length === 0) {
      return { ok: true as const, fetched: 0, inserted: 0, skippedBotFills: 0 };
    }

    // Get all bot order IDs so we can exclude them.
    const orderIds = Array.from(new Set(fills.map((f) => f.order_id).filter(Boolean)));
    const { data: botOrders } = await supabase
      .from("auto_trade_orders")
      .select("kalshi_order_id")
      .eq("user_id", userId)
      .in("kalshi_order_id", orderIds);
    const botOrderIds = new Set((botOrders ?? []).map((r: any) => r.kalshi_order_id).filter(Boolean));

    // Existing manual trades (by kalshi_trade_id) to skip duplicates.
    const tradeIds = fills.map((f) => f.trade_id);
    const { data: existing } = await supabase
      .from("manual_kalshi_trades")
      .select("kalshi_trade_id")
      .eq("user_id", userId)
      .in("kalshi_trade_id", tradeIds);
    const existingSet = new Set((existing ?? []).map((r: any) => r.kalshi_trade_id));

    const rows = [];
    let skippedBot = 0;
    for (const f of fills) {
      if (botOrderIds.has(f.order_id)) { skippedBot++; continue; }
      if (existingSet.has(f.trade_id)) continue;
      const priceCents =
        f.side === "yes" ? (f.yes_price ?? 0) : (f.no_price ?? 0);
      const contracts = f.count;
      const costUsd = (priceCents * contracts) / 100;
      rows.push({
        user_id: userId,
        kalshi_order_id: f.order_id,
        kalshi_trade_id: f.trade_id,
        ticker: f.ticker,
        event_ticker: f.ticker.split("-").slice(0, 2).join("-"),
        side: f.side,
        action: f.action,
        price_cents: priceCents,
        contracts,
        cost_usd: costUsd,
        filled_at: f.created_time,
        settled: false,
        raw: f as any,
      });
    }

    let inserted = 0;
    if (rows.length) {
      const { error: insErr, count } = await supabase
        .from("manual_kalshi_trades")
        .insert(rows, { count: "exact" });
      if (insErr) throw new Error(insErr.message);
      inserted = count ?? rows.length;
    }

    // Settle any unsettled trades whose market has resolved.
    const { data: unsettled } = await supabase
      .from("manual_kalshi_trades")
      .select("id, ticker, side, action, price_cents, contracts")
      .eq("user_id", userId)
      .eq("settled", false)
      .lt("filled_at", new Date(Date.now() - 5 * 60 * 1000).toISOString())
      .limit(50);

    let settled = 0;
    for (const t of unsettled ?? []) {
      try {
        const s = await fetchMarketSettle(keyId, pem, t.ticker);
        if (s?.settled && s.result) {
          // PnL: buy yes wins if result=yes (payout $1/contract), buy no wins if result=no.
          // sell is closing — for MVP treat sell PnL as (100 - price)/100 * contracts if opposite (approximation).
          const wonYes = s.result === "yes";
          let pnl = 0;
          if (t.action === "buy") {
            const won = (t.side === "yes" && wonYes) || (t.side === "no" && !wonYes);
            pnl = won
              ? ((100 - t.price_cents) * t.contracts) / 100
              : -((t.price_cents) * t.contracts) / 100;
          } else {
            // sell = closing; approximate as opposite of a buy at that price
            const won = (t.side === "yes" && !wonYes) || (t.side === "no" && wonYes);
            pnl = won
              ? ((t.price_cents) * t.contracts) / 100
              : -((100 - t.price_cents) * t.contracts) / 100;
          }
          await supabase
            .from("manual_kalshi_trades")
            .update({
              settled: true,
              settle_price: wonYes ? 100 : 0,
              pnl_usd: pnl,
            })
            .eq("id", t.id);
          settled++;
        }
      } catch { /* ignore per-trade errors */ }
    }

    return {
      ok: true as const,
      fetched: fills.length,
      inserted,
      skippedBotFills: skippedBot,
      settled,
    };
  });

/** List the caller's manual trades, most recent first. */
export const listManualKalshiTrades = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { data, error } = await context.supabase
      .from("manual_kalshi_trades")
      .select("*")
      .eq("user_id", context.userId)
      .order("filled_at", { ascending: false })
      .limit(200);
    if (error) throw new Error(error.message);

    const rows = data ?? [];
    let totalPnl = 0;
    let wins = 0;
    let losses = 0;
    for (const r of rows) {
      if (r.settled && r.pnl_usd != null) {
        totalPnl += Number(r.pnl_usd);
        if (Number(r.pnl_usd) > 0) wins++;
        else if (Number(r.pnl_usd) < 0) losses++;
      }
    }
    const winRate = wins + losses > 0 ? wins / (wins + losses) : null;

    // Bot win-rate comparison (last 100 settled).
    const { data: botRows } = await context.supabase
      .from("auto_trade_orders")
      .select("status, pnl_usd")
      .eq("user_id", context.userId)
      .eq("mode", "live")
      .in("status", ["settled_win", "settled_loss"])
      .order("created_at", { ascending: false })
      .limit(100);
    let botWins = 0, botLoss = 0, botPnl = 0;
    for (const r of botRows ?? []) {
      if (r.status === "settled_win") botWins++;
      else if (r.status === "settled_loss") botLoss++;
      if (r.pnl_usd != null) botPnl += Number(r.pnl_usd);
    }
    const botWinRate = botWins + botLoss > 0 ? botWins / (botWins + botLoss) : null;

    return {
      trades: rows,
      summary: {
        total: rows.length,
        wins,
        losses,
        winRate,
        totalPnl,
        botWinRate,
        botPnl,
        botSampleSize: (botRows ?? []).length,
      },
    };
  });
