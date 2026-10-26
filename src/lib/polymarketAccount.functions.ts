import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

/** Admin-only read of the Polymarket US balance and open orders. Never places orders. */
export const getPolymarketAccount = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { data: isAdmin } = await context.supabase.rpc("is_ops_admin", { _user_id: context.userId });
    if (!isAdmin) throw new Error("Forbidden");
    const { hasPolymarketKeys, pmRequest } = await import("@/lib/poly5mBot/polymarketUs.server");
    if (!hasPolymarketKeys()) return { connected: false, balance: null, buyingPower: null, openOrders: 0, error: "keys missing" };
    try {
      const [b, o] = await Promise.all([pmRequest("GET", "/v1/account/balances"), pmRequest("GET", "/v1/orders/open")]);
      const bal = b.data?.balances?.[0];
      const orders = Array.isArray(o.data?.orders) ? o.data.orders.length : 0;
      return {
        connected: b.ok,
        balance: bal ? Number(bal.currentBalance) : null,
        buyingPower: bal ? Number(bal.buyingPower) : null,
        openOrders: orders,
        error: b.ok ? null : `status ${b.status}`,
      };
    } catch (e) {
      console.error(e);
      return { connected: false, balance: null, buyingPower: null, openOrders: 0, error: "Polymarket unreachable" };
    }
  });
