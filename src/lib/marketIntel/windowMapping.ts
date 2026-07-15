// Pure, deterministic helpers for mapping a Kalshi BTC 15-minute ticker to
// its market window and evaluation bucket. No I/O, no Date.now().
//
// Real production ticker format (confirmed from btc_model_predictions):
//   KXBTC15M-YYMMMDDHHMM-MM
//   e.g. "KXBTC15M-26JUL150130-30"  → 2026-07-15  01:30 America/New_York
//   window close (ET). The trailing "-MM" mirrors the HHMM minute segment.
//
// We intentionally reject placeholders like "KX-BTC-24DEC0100" (Turn 3 draft
// format) so evaluation cannot silently link the wrong contracts.

export type SettlementLinkStatus =
  | "pending"
  | "matched"
  | "missing"
  | "ambiguous"
  | "invalid_time"
  | "invalid_ticker"
  | "invalid_input";

export type TimeBucket =
  | "T-15m"
  | "T-10m"
  | "T-7m30s"
  | "T-5m"
  | "T-3m"
  | "T-2m"
  | "T-1m"
  | "T-30s";

export interface ParsedTicker {
  valid: boolean;
  reason?: string;
  marketWindowId: string | null;
  /** UTC close-time derived from the ET timestamp in the ticker. */
  windowCloseUtc: Date | null;
  /** UTC open-time = close - 15 min. */
  windowOpenUtc: Date | null;
}

const MONTHS: Record<string, number> = {
  JAN: 0, FEB: 1, MAR: 2, APR: 3, MAY: 4, JUN: 5,
  JUL: 6, AUG: 7, SEP: 8, OCT: 9, NOV: 10, DEC: 11,
};

const TICKER_RE = /^KXBTC15M-(\d{2})([A-Z]{3})(\d{2})(\d{2})(\d{2})-(\d{2})$/;

/**
 * Compute the UTC offset (in minutes, positive = ahead of UTC) that
 * America/New_York had at the given UTC timestamp. Uses Intl to
 * respect EST/EDT transitions without pulling in a tz lib.
 */
function nyOffsetMinutesAt(utcMs: number): number {
  const dtf = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/New_York",
    hour12: false,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
  const parts = dtf.formatToParts(new Date(utcMs));
  const map: Record<string, string> = {};
  for (const p of parts) if (p.type !== "literal") map[p.type] = p.value;
  const nyAsUtc = Date.UTC(
    Number(map.year),
    Number(map.month) - 1,
    Number(map.day),
    Number(map.hour === "24" ? "00" : map.hour),
    Number(map.minute),
    Number(map.second),
  );
  // nyAsUtc - utcMs = offset (ms). NY is behind UTC, so this is negative.
  return Math.round((nyAsUtc - utcMs) / 60000);
}

/**
 * Convert a wall-clock America/New_York timestamp to UTC. Handles DST by
 * iterating once (offset resolves in ≤ 2 passes at every historical
 * transition boundary).
 */
function nyWallToUtc(year: number, month0: number, day: number, hour: number, minute: number): Date {
  // First guess: assume EST (UTC-5).
  let utcGuess = Date.UTC(year, month0, day, hour + 5, minute);
  for (let i = 0; i < 3; i++) {
    const off = nyOffsetMinutesAt(utcGuess); // negative
    const corrected = Date.UTC(year, month0, day, hour, minute) - off * 60000;
    if (corrected === utcGuess) return new Date(utcGuess);
    utcGuess = corrected;
  }
  return new Date(utcGuess);
}

export function parseKalshiBtcTicker(ticker: string | null | undefined): ParsedTicker {
  const empty: ParsedTicker = { valid: false, marketWindowId: null, windowCloseUtc: null, windowOpenUtc: null };
  if (!ticker || typeof ticker !== "string") return { ...empty, reason: "empty" };
  const m = ticker.match(TICKER_RE);
  if (!m) return { ...empty, reason: "format_mismatch" };
  const [, yy, mon, dd, hh, mm, tail] = m;
  const month = MONTHS[mon];
  if (month === undefined) return { ...empty, reason: "bad_month" };
  const year = 2000 + Number(yy);
  const day = Number(dd);
  const hour = Number(hh);
  const minute = Number(mm);
  if (day < 1 || day > 31 || hour > 23 || minute > 59) return { ...empty, reason: "bad_time" };
  if (tail !== mm) return { ...empty, reason: "tail_mismatch" };
  const closeUtc = nyWallToUtc(year, month, day, hour, minute);
  const openUtc = new Date(closeUtc.getTime() - 15 * 60 * 1000);
  return {
    valid: true,
    marketWindowId: ticker,
    windowCloseUtc: closeUtc,
    windowOpenUtc: openUtc,
  };
}

/** Bucket a seconds-to-close value into one of the fixed evaluation buckets. */
export function bucketTimeToClose(secondsToClose: number | null | undefined): TimeBucket | null {
  if (secondsToClose == null || !Number.isFinite(secondsToClose) || secondsToClose < 0) return null;
  const s = Math.round(secondsToClose);
  // Half-open windows chosen so bucket centers are the labeled times.
  if (s > 780) return "T-15m";   // > 13m         → center 15m
  if (s > 525) return "T-10m";   // 8m45 – 13m    → center 10m
  if (s > 375) return "T-7m30s"; // 6m15 – 8m45   → center 7m30
  if (s > 240) return "T-5m";    // 4m   – 6m15   → center 5m
  if (s > 150) return "T-3m";    // 2m30 – 4m     → center 3m
  if (s > 90)  return "T-2m";    // 1m30 – 2m30   → center 2m
  if (s > 45)  return "T-1m";    // 45s  – 1m30   → center 1m
  return "T-30s";                // ≤ 45s
}

export interface DerivedWindowFields {
  marketWindowId: string | null;
  windowOpenTs: string | null;   // ISO
  windowCloseTs: string | null;  // ISO
  secondsToClose: number | null;
  timeBucket: TimeBucket | null;
  settlementLinkStatus: SettlementLinkStatus;
  tickerValid: boolean;
  tickerReason?: string;
}

export interface DeriveInput {
  ticker: string;
  decisionTs: Date;
  closeTime: string | Date;
}

export function deriveWindowFields(input: DeriveInput): DerivedWindowFields {
  const parsed = parseKalshiBtcTicker(input.ticker);
  const closeDate = input.closeTime instanceof Date ? input.closeTime : new Date(input.closeTime);
  const closeMs = closeDate.getTime();
  const decisionMs = input.decisionTs.getTime();

  if (!parsed.valid) {
    return {
      marketWindowId: null,
      windowOpenTs: null,
      windowCloseTs: null,
      secondsToClose: null,
      timeBucket: null,
      settlementLinkStatus: "invalid_ticker",
      tickerValid: false,
      tickerReason: parsed.reason,
    };
  }

  // Cross-check: ticker-derived close must match the supplied closeTime
  // (allow ±5 s slop for storage rounding).
  const tickerCloseMs = parsed.windowCloseUtc!.getTime();
  if (!Number.isFinite(closeMs) || Math.abs(tickerCloseMs - closeMs) > 5000) {
    return {
      marketWindowId: parsed.marketWindowId,
      windowOpenTs: parsed.windowOpenUtc!.toISOString(),
      windowCloseTs: parsed.windowCloseUtc!.toISOString(),
      secondsToClose: null,
      timeBucket: null,
      settlementLinkStatus: "invalid_time",
      tickerValid: true,
      tickerReason: "close_time_mismatch",
    };
  }

  if (!(decisionMs < closeMs)) {
    return {
      marketWindowId: parsed.marketWindowId,
      windowOpenTs: parsed.windowOpenUtc!.toISOString(),
      windowCloseTs: parsed.windowCloseUtc!.toISOString(),
      secondsToClose: null,
      timeBucket: null,
      settlementLinkStatus: "invalid_time",
      tickerValid: true,
      tickerReason: "decision_after_close",
    };
  }

  const secondsToClose = Math.max(0, Math.round((closeMs - decisionMs) / 1000));
  return {
    marketWindowId: parsed.marketWindowId,
    windowOpenTs: parsed.windowOpenUtc!.toISOString(),
    windowCloseTs: parsed.windowCloseUtc!.toISOString(),
    secondsToClose,
    timeBucket: bucketTimeToClose(secondsToClose),
    settlementLinkStatus: "pending",
    tickerValid: true,
  };
}
