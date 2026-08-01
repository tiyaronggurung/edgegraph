// BTC 15m Operating Manual — admin-only server functions.
// Thin wrappers only: every runtime helper lives in ./opsManual.server or
// ./rules so the tss-serverfn-split transform cannot strip it.
import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { z } from "zod";

const TradeInput = z.object({
  ticker: z.string().min(1).max(120),
  strike: z.number().nullable().optional(),
  side: z.string().max(8).nullable().optional(),
  studySide: z.string().max(8).nullable().optional(),
  studyConf: z.number().nullable().optional(),
  modelSide: z.string().max(8).nullable().optional(),
  modelConf: z.number().nullable().optional(),
  spotAtLock: z.number().nullable().optional(),
  cushionUsd: z.number().nullable().optional(),
  askCents: z.number().int().nullable().optional(),
  secondsLeft: z.number().int().nullable().optional(),
  stake: z.number().min(0),
  notes: z.string().max(2000).nullable().optional(),
  overrideViolations: z.array(z.string().max(40)).max(20).optional(),
});

export const opsGetDashboard = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { loadOpsDashboard } = await import("./opsManual.ops");
    return await loadOpsDashboard(context.supabase, context.userId);
  });

export const opsRunBacktest = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { runAndStoreBacktest } = await import("./opsManual.ops");
    return await runAndStoreBacktest(context.supabase, context.userId);
  });

export const opsOpenDay = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) =>
    z.object({ morningBankroll: z.number().min(0).max(100_000_000) }).parse(d),
  )
  .handler(async ({ data, context }) => {
    const { openTradingDay } = await import("./opsManual.ops");
    return await openTradingDay(context.supabase, context.userId, data.morningBankroll);
  });

export const opsLogTrade = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => TradeInput.parse(d))
  .handler(async ({ data, context }) => {
    const { logOpsTrade } = await import("./opsManual.ops");
    return await logOpsTrade(context.supabase, context.userId, data);
  });

export const opsSettleTrade = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) =>
    z
      .object({
        id: z.string().uuid(),
        result: z.enum(["win", "loss", "void"]),
        realizedPnl: z.number(),
      })
      .parse(d),
  )
  .handler(async ({ data, context }) => {
    const { settleOpsTrade } = await import("./opsManual.ops");
    return await settleOpsTrade(context.supabase, context.userId, data);
  });

export const opsAcknowledgeAlert = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({ id: z.string().uuid() }).parse(d))
  .handler(async ({ data, context }) => {
    const { acknowledgeAlert } = await import("./opsManual.ops");
    return await acknowledgeAlert(context.supabase, context.userId, data.id);
  });

export const opsRecordWithdrawal = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) =>
    z
      .object({
        milestoneTo: z.number().min(0),
        amount: z.number().min(0),
      })
      .parse(d),
  )
  .handler(async ({ data, context }) => {
    const { recordWithdrawal } = await import("./opsManual.ops");
    return await recordWithdrawal(context.supabase, context.userId, data.milestoneTo, data.amount);
  });

export const opsRecordThresholdChange = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) =>
    z
      .object({
        key: z.string().min(1).max(80),
        previousValue: z.string().max(200).nullable(),
        newValue: z.string().min(1).max(200),
        reason: z.string().min(3).max(500),
      })
      .parse(d),
  )
  .handler(async ({ data, context }) => {
    const { recordThresholdChange } = await import("./opsManual.ops");
    return await recordThresholdChange(context.supabase, context.userId, data);
  });
