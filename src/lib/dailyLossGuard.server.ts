// Daily give-back stop — shared by every live betting engine.
//
// Rule: once a user's settled real-money losses today (New York day) reach
// 50% of today's settled real-money gains, no live engine may place another
// buy for them until the next New York midnight. The rule only arms once
// there ARE gains today — with no gains on the board yet, there is nothing
// to give back, so trading stays open. Paper paths are untouched.

export const DAILY_GIVEBACK_RATIO = 0.5;

export interface DailyPnl {
  /** Sum of today's positive settled P&L (USD). */
  gains: number;
  /** Sum of today's negative settled P&L, as a positive number (USD). */
  losses: number;
}

/** UTC instant of the most recent New York midnight. */
export function nyDayStartUtc(now: Date): Date {
  const nyNow = new Date(now.toLocaleString("en-US", { timeZone: "America/New_York" }));
  const offsetMs = nyNow.getTime() - now.getTime();
  return new Date(
    Date.UTC(nyNow.getFullYear(), nyNow.getMonth(), nyNow.getDate()) - offsetMs,
  );
}

/**
 * Sum today's settled gains and losses per user in one query.
 * Anchored to the day by close_time (when the window closed).
 */
export async function getDailyLossCounts(
  db: {
    from: (t: string) => {
      select: (c: string) => {
        eq: (c: string, v: string) => {
          gte: (c: string, v: string) => Promise<{ data: Array<{ user_id: string; pnl_usd: number | null }> | null }>;
        };
      };
    };
  },
  now: Date = new Date(),
): Promise<Map<string, DailyPnl>> {
  const since = nyDayStartUtc(now).toISOString();
  const { data } = await db
    .from("crypto_trades")
    .select("user_id, pnl_usd")
    .eq("status", "settled")
    .gte("close_time", since);
  const totals = new Map<string, DailyPnl>();
  for (const r of (data ?? []) as Array<{ user_id: string; pnl_usd: number | null }>) {
    const id = String(r.user_id);
    const cur = totals.get(id) ?? { gains: 0, losses: 0 };
    const pnl = Number(r.pnl_usd ?? 0);
    if (pnl > 0) cur.gains += pnl;
    else if (pnl < 0) cur.losses += -pnl;
    totals.set(id, cur);
  }
  return totals;
}

/**
 * True when this user has given back half (or more) of today's gains.
 * No gains today → not stopped (nothing to protect yet).
 */
export function dailyLossStopHit(totals: Map<string, DailyPnl>, userId: string): boolean {
  const t = totals.get(userId);
  if (!t || t.gains <= 0) return false;
  return t.losses >= DAILY_GIVEBACK_RATIO * t.gains;
}
