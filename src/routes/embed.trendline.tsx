import { createFileRoute } from "@tanstack/react-router";
import { lazy, Suspense } from "react";

const TrendlineChartPanel = lazy(() =>
  import("@/components/crypto/TrendlineChartPanel").then((m) => ({ default: m.TrendlineChartPanel })),
);

export const Route = createFileRoute("/embed/trendline")({
  head: () => ({
    meta: [
      { title: "BTC 15m Trendline Chart — Live Embed" },
      {
        name: "description",
        content:
          "Live BTC 1m trendline chart with EMA, VWAP, Bollinger bands, Kalshi strike, buy/mid/sell levels and 15m close countdown.",
      },
      { name: "robots", content: "noindex" },
      { property: "og:title", content: "BTC 15m Trendline Chart — Live Embed" },
      {
        property: "og:description",
        content: "Embeddable live BTC trendline chart with buy/mid/sell levels and Kalshi 15m odds.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: EmbedTrendline,
});

function EmbedTrendline() {
  return (
    <main className="min-h-screen w-full bg-background p-2">
      <h1 className="sr-only">BTC 15m live trendline chart</h1>
      <Suspense
        fallback={<div className="p-6 text-sm text-muted-foreground font-mono">Loading live chart…</div>}
      >
        <TrendlineChartPanel embed />
      </Suspense>
    </main>
  );
}
