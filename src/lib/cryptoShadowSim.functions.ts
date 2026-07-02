// Shadow-mode gate simulator. Replays what-if gate thresholds against past
// settled auto-trade orders. Read-only against live trading — this NEVER
// changes what auto-trade does; it only computes what would have happened.
//
// Gates simulated in this pass (data must be captured on the row):
//   sigmaMin  → skip trades where sigma_distance < N
//   edgeMin   → skip trades where |edge_pts| < N
//   probMin   → skip trades where model_prob (skewed to the side taken) < N
//
// Richer gates (candleGate, trendlineGate, verdictMin) will be added once
// inputs_snapshot starts populating on auto_trade_orders.

import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

export interface ShadowSimGateStat {
  gate_name: string;
  threshold_label: string;
  n_evaluated: number;
  would_block: number;
  losses_saved_n: number;
  wins_killed_n: number;
  losses_saved_usd: number;
  wins_killed_usd: number;
  net_usd: number;
}

interface AutoOrderRow {
  id: string;
  status: string;
  pnl_usd: number | null;
  side: string | null;
  model_prob: number | null;
  edge_pts: number | null;
  sigma_distance: number | null;
}

// Threshold sets — kept modest so the table stays readable.
const SIGMA_THRESHOLDS = [1.0, 1.5, 2.0, 2.5, 3.0];
const EDGE_THRESHOLDS = [2, 3, 5, 7];
const PROB_THRESHOLDS = [0.55, 0.6, 0.65, 0.7];

function sideProb(row: AutoOrderRow): number | null {
  if (row.model_prob == null || row.side == null) return null;
  return row.side === "YES" ? row.model_prob : 1 - row.model_prob;
}

// Returns [(gate_name, threshold_json, threshold_label, blocked)] for one row.
function simulateRow(row: AutoOrderRow): Array<{ gate: string; threshold: any; label: string; blocked: boolean }> {
  const out: Array<{ gate: string; threshold: any; label: string; blocked: boolean }> = [];

  const sigma = row.sigma_distance;
  for (const t of SIGMA_THRESHOLDS) {
    out.push({
      gate: "sigmaMin",
      threshold: { min: t },
      label: `≥ ${t.toFixed(1)}σ`,
      blocked: sigma == null ? false : sigma < t,
    });
  }

  const edge = row.edge_pts;
  for (const t of EDGE_THRESHOLDS) {
    out.push({
      gate: "edgeMin",
      threshold: { min: t },
      label: `|edge| ≥ ${t}pt`,
      blocked: edge == null ? false : Math.abs(Number(edge)) < t,
    });
  }

  const sp = sideProb(row);
  for (const t of PROB_THRESHOLDS) {
    out.push({
      gate: "probMin",
      threshold: { min: t },
      label: `p(side) ≥ ${(t * 100).toFixed(0)}%`,
      blocked: sp == null ? false : sp < t,
    });
  }

  return out;
}

export const recomputeShadowSim = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<{ evaluated: number; rows_written: number }> => {
    const { supabase, userId } = context;

    // Load settled auto-trade orders with a realized pnl.
    const { data: orders, error } = await supabase
      .from("auto_trade_orders")
      .select("id, status, pnl_usd, side, model_prob, edge_pts, sigma_distance")
      .eq("user_id", userId)
      .in("status", ["settled_win", "settled_loss"])
      .not("pnl_usd", "is", null)
      .order("created_at", { ascending: false })
      .limit(1000);
    if (error) throw new Error(error.message);
    if (!orders?.length) return { evaluated: 0, rows_written: 0 };

    // Clear prior rows for this user + source so we always show fresh math.
    await supabase
      .from("crypto_gate_shadow_sim")
      .delete()
      .eq("user_id", userId)
      .eq("order_source", "auto_trade");

    const inserts: any[] = [];
    for (const o of orders as AutoOrderRow[]) {
      const pnl = Number(o.pnl_usd ?? 0);
      const outcome = pnl >= 0 ? "win" : "loss";
      const sims = simulateRow(o);
      for (const s of sims) {
        // pnl_saved: if we would have blocked, we save the loss (positive) or
        // we would have killed a win (negative). If not blocked, no effect.
        const pnl_saved = s.blocked ? -pnl : 0;
        inserts.push({
          user_id: userId,
          order_id: o.id,
          order_source: "auto_trade",
          gate_name: s.gate,
          threshold: s.threshold,
          would_have_blocked: s.blocked,
          outcome,
          pnl_usd: pnl,
          pnl_saved,
        });
      }
    }

    // Insert in chunks to keep payload sizes reasonable.
    const CHUNK = 500;
    for (let i = 0; i < inserts.length; i += CHUNK) {
      const slice = inserts.slice(i, i + CHUNK);
      const { error: insErr } = await supabase.from("crypto_gate_shadow_sim").insert(slice);
      if (insErr) throw new Error(insErr.message);
    }

    return { evaluated: orders.length, rows_written: inserts.length };
  });

export const getShadowSimReport = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<{ orders_evaluated: number; stats: ShadowSimGateStat[] }> => {
    const { supabase, userId } = context;

    const { data: rows, error } = await supabase
      .from("crypto_gate_shadow_sim")
      .select("gate_name, threshold, would_have_blocked, outcome, pnl_saved")
      .eq("user_id", userId);
    if (error) throw new Error(error.message);
    if (!rows?.length) return { orders_evaluated: 0, stats: [] };

    // How many distinct orders were evaluated?
    const { data: distinctOrders } = await supabase
      .from("crypto_gate_shadow_sim")
      .select("order_id")
      .eq("user_id", userId);
    const orderIds = new Set((distinctOrders ?? []).map((r: any) => r.order_id));

    // Bucket by (gate, threshold-json).
    const bucket = new Map<string, ShadowSimGateStat>();
    const labelFor = (gate: string, t: any) => {
      const min = t?.min;
      if (gate === "sigmaMin") return `≥ ${Number(min).toFixed(1)}σ`;
      if (gate === "edgeMin") return `|edge| ≥ ${min}pt`;
      if (gate === "probMin") return `p(side) ≥ ${(Number(min) * 100).toFixed(0)}%`;
      return `${gate}:${JSON.stringify(t)}`;
    };

    for (const r of rows as any[]) {
      const key = `${r.gate_name}::${JSON.stringify(r.threshold)}`;
      let b = bucket.get(key);
      if (!b) {
        b = {
          gate_name: r.gate_name,
          threshold_label: labelFor(r.gate_name, r.threshold),
          n_evaluated: 0,
          would_block: 0,
          losses_saved_n: 0,
          wins_killed_n: 0,
          losses_saved_usd: 0,
          wins_killed_usd: 0,
          net_usd: 0,
        };
        bucket.set(key, b);
      }
      b.n_evaluated += 1;
      if (r.would_have_blocked) {
        b.would_block += 1;
        const saved = Number(r.pnl_saved ?? 0);
        if (r.outcome === "loss") {
          b.losses_saved_n += 1;
          b.losses_saved_usd += saved; // positive
        } else {
          b.wins_killed_n += 1;
          b.wins_killed_usd += -saved; // saved is negative for a killed win → make positive $ killed
        }
        b.net_usd += saved;
      }
    }

    const stats = Array.from(bucket.values()).sort((a, b) => b.net_usd - a.net_usd);
    return { orders_evaluated: orderIds.size, stats };
  });
