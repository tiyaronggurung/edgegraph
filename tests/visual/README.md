# Visual regression — TrendlineChartPanel pills

Manual guard against the pill-overlap regression that keeps coming back.

## Run

```bash
bun run test:visual
```

Prereqs:

- Dev server on `http://localhost:8080` (already the default in this sandbox).
- One-time: `bunx playwright install chromium` if the browser isn't cached.
- An authenticated Supabase session — set the `LOVABLE_BROWSER_SUPABASE_*`
  env vars (they're injected automatically in the Lovable sandbox when the
  user is signed in).

## What it checks

1. **Bounding-box overlap**: the three floating pills
   (`pill-delta`, `pill-up`, `pill-down`) must not intersect.
2. **Pixel snapshot**: a screenshot of the chart SVG is diffed against
   `__snapshots__/trendline-panel.png`. First run writes the baseline.

## When it fails

- `pill-*-actual.png` and `pill-*-diff.png` are written next to the baseline.
- If the drift is intentional (e.g. you restyled a pill on purpose), delete
  `__snapshots__/trendline-panel.png` and re-run to re-record the baseline.
- Tunables: `VISUAL_PIXEL_BUDGET` (default 2500 px), `VISUAL_TARGET_PATH`
  (default `/crypto`), `VISUAL_BASE_URL` (default `http://localhost:8080`).
