// Daily loss stop — shared by every live betting engine.
//
// Rule: once a user has 3 settled real-money losses whose window closed today
// (New York day), no live engine may place another buy for them until the next
// New York midnight. Paper paths are untouched.

export const DAILY_LOSS_LIMIT = 3;

/** UTC instant of the most recent New York midnight. */
export function nyDayStartUtc(now: Date): Date {
  const nyNow = new Date(now.toLocaleString("en-US", { timeZone: "America/New_York" }));
  const offsetMs = nyNow.getTime() - now.getTime();
  return new Date(
    Date.UTC(nyNow.getFullYear(), nyNow.getMonth(), nyNow.getDate()) - offsetMs,
  );
}

/**
 * Count today's settled losses per user in one query.
 * A loss = crypto_trades row with status='settled' and pnl_usd < 0, anchored
 * to the day by close_time (when the window closed).
 */
export async function getDailyLossCounts(
  db: {
    from: (t: string) => {
      select: (c: string) => {
        eq: (c: string, v: string) => {
          lt: (c: string, v: number) => {
            gte: (c: string, v: string) => Promise<{ data: Array<{ user_id: string }> | null }>;
          };
        };
      };
    };
  },
  now: Date = new Date(),
): Promise<Map<string, number>> {
  const since = nyDayStartUtc(now).toISOString();
  const { data } = await db
    .from("crypto_trades")
    .select("user_id")
    .eq("status", "settled")
    .lt("pnl_usd", 0)
    .gte("close_time", since);
  const counts = new Map<string, number>();
  for (const r of (data ?? []) as Array<{ user_id: string }>) {
    const id = String(r.user_id);
    counts.set(id, (counts.get(id) ?? 0) + 1);
  }
  return counts;
}

/** True when this user has hit the daily loss stop. */
export function dailyLossStopHit(counts: Map<string, number>, userId: string): boolean {
  return (counts.get(userId) ?? 0) >= DAILY_LOSS_LIMIT;
}
