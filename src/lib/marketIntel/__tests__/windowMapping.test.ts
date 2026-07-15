import { describe, it, expect } from "vitest";
import { parseKalshiBtcTicker, bucketTimeToClose, deriveWindowFields } from "../windowMapping";

describe("parseKalshiBtcTicker", () => {
  it("parses a real production ticker (EDT window)", () => {
    // Confirmed sample: close_time = 2026-07-15 05:30:00 UTC == 01:30 ET (EDT)
    const r = parseKalshiBtcTicker("KXBTC15M-26JUL150130-30");
    expect(r.valid).toBe(true);
    expect(r.windowCloseUtc?.toISOString()).toBe("2026-07-15T05:30:00.000Z");
    expect(r.windowOpenUtc?.toISOString()).toBe("2026-07-15T05:15:00.000Z");
    expect(r.marketWindowId).toBe("KXBTC15M-26JUL150130-30");
  });

  it("parses an EST (winter) ticker with the correct offset", () => {
    // 2026-01-15 09:15 ET (EST, UTC-5) = 14:15 UTC
    const r = parseKalshiBtcTicker("KXBTC15M-26JAN150915-15");
    expect(r.valid).toBe(true);
    expect(r.windowCloseUtc?.toISOString()).toBe("2026-01-15T14:15:00.000Z");
  });

  it("rejects the Turn-3 placeholder format", () => {
    const r = parseKalshiBtcTicker("KX-BTC-24DEC0100");
    expect(r.valid).toBe(false);
    expect(r.reason).toBe("format_mismatch");
  });

  it("rejects tail mismatch", () => {
    const r = parseKalshiBtcTicker("KXBTC15M-26JUL150130-45");
    expect(r.valid).toBe(false);
    expect(r.reason).toBe("tail_mismatch");
  });

  it("rejects empty / null", () => {
    expect(parseKalshiBtcTicker("").valid).toBe(false);
    expect(parseKalshiBtcTicker(null).valid).toBe(false);
    expect(parseKalshiBtcTicker(undefined).valid).toBe(false);
  });

  it("rejects invalid month", () => {
    expect(parseKalshiBtcTicker("KXBTC15M-26ZZZ150130-30").valid).toBe(false);
  });

  it("is deterministic", () => {
    const a = parseKalshiBtcTicker("KXBTC15M-26JUL150130-30");
    const b = parseKalshiBtcTicker("KXBTC15M-26JUL150130-30");
    expect(a).toEqual(b);
  });
});

describe("bucketTimeToClose", () => {
  it("maps seconds to the correct labeled bucket", () => {
    expect(bucketTimeToClose(900)).toBe("T-15m");
    expect(bucketTimeToClose(800)).toBe("T-15m");
    expect(bucketTimeToClose(600)).toBe("T-10m");
    expect(bucketTimeToClose(450)).toBe("T-7m30s");
    expect(bucketTimeToClose(300)).toBe("T-5m");
    expect(bucketTimeToClose(180)).toBe("T-3m");
    expect(bucketTimeToClose(120)).toBe("T-2m");
    expect(bucketTimeToClose(60)).toBe("T-1m");
    expect(bucketTimeToClose(30)).toBe("T-30s");
    expect(bucketTimeToClose(5)).toBe("T-30s");
  });

  it("returns null for invalid inputs", () => {
    expect(bucketTimeToClose(null)).toBe(null);
    expect(bucketTimeToClose(undefined)).toBe(null);
    expect(bucketTimeToClose(-1)).toBe(null);
    expect(bucketTimeToClose(Number.NaN)).toBe(null);
  });
});

describe("deriveWindowFields", () => {
  it("returns pending + populated fields for a valid live snapshot", () => {
    const close = "2026-07-15T05:30:00.000Z";
    const decision = new Date("2026-07-15T05:20:00.000Z"); // 10m before close
    const r = deriveWindowFields({ ticker: "KXBTC15M-26JUL150130-30", decisionTs: decision, closeTime: close });
    expect(r.settlementLinkStatus).toBe("pending");
    expect(r.marketWindowId).toBe("KXBTC15M-26JUL150130-30");
    expect(r.windowOpenTs).toBe("2026-07-15T05:15:00.000Z");
    expect(r.windowCloseTs).toBe("2026-07-15T05:30:00.000Z");
    expect(r.secondsToClose).toBe(600);
    expect(r.timeBucket).toBe("T-10m");
  });

  it("flags invalid_ticker for placeholder format", () => {
    const r = deriveWindowFields({
      ticker: "KX-BTC-24DEC0100",
      decisionTs: new Date("2026-07-15T05:20:00Z"),
      closeTime: "2026-07-15T05:30:00Z",
    });
    expect(r.settlementLinkStatus).toBe("invalid_ticker");
    expect(r.tickerValid).toBe(false);
  });

  it("flags invalid_time when closeTime disagrees with the ticker", () => {
    const r = deriveWindowFields({
      ticker: "KXBTC15M-26JUL150130-30",
      decisionTs: new Date("2026-07-15T05:20:00Z"),
      closeTime: "2026-07-15T06:00:00Z",
    });
    expect(r.settlementLinkStatus).toBe("invalid_time");
    expect(r.tickerReason).toBe("close_time_mismatch");
  });

  it("flags invalid_time when decision is after close", () => {
    const r = deriveWindowFields({
      ticker: "KXBTC15M-26JUL150130-30",
      decisionTs: new Date("2026-07-15T05:35:00Z"),
      closeTime: "2026-07-15T05:30:00Z",
    });
    expect(r.settlementLinkStatus).toBe("invalid_time");
    expect(r.tickerReason).toBe("decision_after_close");
  });
});
