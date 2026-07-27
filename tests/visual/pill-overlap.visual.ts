import { test, expect, type Page } from "@playwright/test";
import fs from "node:fs";
import path from "node:path";
import { PNG } from "pngjs";
import pixelmatch from "pixelmatch";

/**
 * Visual regression: TrendlineChartPanel pills must never overlap.
 *
 * Checks TWO things:
 *   1) Pairwise bounding-box overlap for the floating pills
 *      (pill-delta, pill-up, pill-down) — the exact regression
 *      class the user has reported multiple times.
 *   2) A pixel-diff snapshot of the chart panel itself, so any
 *      unintended visual drift is surfaced. Baseline is written on
 *      the first run; failures write a *-actual.png and *-diff.png
 *      next to the baseline for inspection.
 *
 * Manual only — invoke with `bun run test:visual`. Requires an
 * authenticated Supabase session injected via
 * LOVABLE_BROWSER_SUPABASE_* env vars (see docs).
 */

const TARGET_PATH = process.env.VISUAL_TARGET_PATH ?? "/crypto";
const SNAPSHOT_DIR = path.join(__dirname, "__snapshots__");
const BASELINE = path.join(SNAPSHOT_DIR, "trendline-panel.png");
// Chart pill positions depend on live spot ticks — allow a small
// pixel budget so a benign 1-frame animation doesn't fail the run.
const PIXEL_DIFF_BUDGET = Number(process.env.VISUAL_PIXEL_BUDGET ?? 2500);

async function restoreSupabaseSession(page: Page) {
  const storageKey = process.env.LOVABLE_BROWSER_SUPABASE_STORAGE_KEY;
  const sessionJson = process.env.LOVABLE_BROWSER_SUPABASE_SESSION_JSON;
  const cookiesJson = process.env.LOVABLE_BROWSER_SUPABASE_COOKIES_JSON;

  if (cookiesJson) {
    const cookies = JSON.parse(cookiesJson).map((c: Record<string, unknown>) => ({
      ...c,
      url: "http://localhost:8080",
    }));
    await page.context().addCookies(cookies);
  }

  await page.goto("/");
  if (storageKey && sessionJson) {
    await page.evaluate(
      ([k, v]) => window.localStorage.setItem(k as string, v as string),
      [storageKey, sessionJson],
    );
  }
}

function rectsOverlap(
  a: { x: number; y: number; width: number; height: number },
  b: { x: number; y: number; width: number; height: number },
) {
  return !(
    a.x + a.width <= b.x ||
    b.x + b.width <= a.x ||
    a.y + a.height <= b.y ||
    b.y + b.height <= a.y
  );
}

test.describe("TrendlineChartPanel — pill layout", () => {
  test("floating pills never overlap and match snapshot", async ({ page }) => {
    await restoreSupabaseSession(page);
    await page.goto(TARGET_PATH, { waitUntil: "domcontentloaded" });

    // Wait for the chart panel with the delta pill to render.
    const deltaLocator = page.locator('[data-testid="pill-delta"]');
    await deltaLocator.first().waitFor({ state: "attached", timeout: 30_000 });
    // Let one paint frame settle so bbox measurements are stable.
    await page.waitForTimeout(500);

    // ---- (1) Bounding-box overlap check --------------------------------
    const ids = ["pill-delta", "pill-up", "pill-down"] as const;
    const boxes: Record<string, { x: number; y: number; width: number; height: number }> = {};
    for (const id of ids) {
      const loc = page.locator(`[data-testid="${id}"]`).first();
      const bb = await loc.boundingBox();
      expect(bb, `expected pill ${id} to be rendered`).not.toBeNull();
      boxes[id] = bb!;
    }
    for (let i = 0; i < ids.length; i++) {
      for (let j = i + 1; j < ids.length; j++) {
        const a = ids[i], b = ids[j];
        expect(
          rectsOverlap(boxes[a], boxes[b]),
          `pills ${a} and ${b} overlap: ${JSON.stringify(boxes[a])} vs ${JSON.stringify(boxes[b])}`,
        ).toBe(false);
      }
    }

    // ---- (2) Pixel snapshot of the chart panel -------------------------
    // Scope the shot to the SVG that contains the pills so unrelated UI
    // (countdowns, live ticks) doesn't blow up the diff.
    const svg = page.locator('[data-testid="pill-delta"]').locator("xpath=ancestor::svg[1]");
    const actualBuf = await svg.screenshot();

    if (!fs.existsSync(SNAPSHOT_DIR)) fs.mkdirSync(SNAPSHOT_DIR, { recursive: true });
    if (!fs.existsSync(BASELINE)) {
      fs.writeFileSync(BASELINE, actualBuf);
      console.log(`[visual] wrote baseline snapshot → ${BASELINE}`);
      return;
    }

    const baseline = PNG.sync.read(fs.readFileSync(BASELINE));
    const actual = PNG.sync.read(actualBuf);
    if (baseline.width !== actual.width || baseline.height !== actual.height) {
      const actualPath = BASELINE.replace(/\.png$/, "-actual.png");
      fs.writeFileSync(actualPath, actualBuf);
      throw new Error(
        `snapshot size changed (${baseline.width}x${baseline.height} → ${actual.width}x${actual.height}); ` +
        `wrote ${actualPath}. Delete the baseline to re-record if this is intentional.`,
      );
    }
    const diff = new PNG({ width: baseline.width, height: baseline.height });
    const diffPixels = pixelmatch(
      baseline.data, actual.data, diff.data,
      baseline.width, baseline.height, { threshold: 0.15 },
    );
    if (diffPixels > PIXEL_DIFF_BUDGET) {
      const actualPath = BASELINE.replace(/\.png$/, "-actual.png");
      const diffPath = BASELINE.replace(/\.png$/, "-diff.png");
      fs.writeFileSync(actualPath, actualBuf);
      fs.writeFileSync(diffPath, PNG.sync.write(diff));
      throw new Error(
        `visual drift: ${diffPixels} px differ (budget ${PIXEL_DIFF_BUDGET}). ` +
        `See ${actualPath} and ${diffPath}. If intentional, delete the baseline and re-run.`,
      );
    }
  });
});
