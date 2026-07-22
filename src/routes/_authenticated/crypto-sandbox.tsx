import { createFileRoute, Link } from "@tanstack/react-router";
import { FlaskConical } from "lucide-react";
import {
  ModelBetPanel,
  PredBetPanel,
  GreenHoursBetPanel,
  PaperBalanceBadge,
} from "./crypto";

export const Route = createFileRoute("/_authenticated/crypto-sandbox")({
  head: () => ({
    meta: [
      { title: "Paper Sandbox — BTC 15-min" },
      { name: "description", content: "Paper-money sandbox for Model, PRED, and Green Hours auto-bet strategies. No real money is placed." },
      { property: "og:title", content: "Paper Sandbox — BTC 15-min" },
      { property: "og:description", content: "Paper-money sandbox for Model, PRED, and Green Hours auto-bet strategies. No real money is placed." },
    ],
  }),
  component: CryptoPaperPage,
});

function CryptoPaperPage() {
  return (
    <div className="max-w-7xl mx-auto px-4 py-6 space-y-6">
      <div className="rounded-lg border border-emerald-500/30 bg-emerald-500/5 px-4 py-3 text-sm text-emerald-300 flex items-center gap-2">
        <FlaskConical className="h-4 w-4" />
        <span className="font-semibold">Paper Sandbox</span>
        <span className="text-emerald-300/70">— all fires on this page are paper only. No real money is placed, ever.</span>
      </div>

      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2">
            <FlaskConical className="h-5 w-5 text-emerald-400" />
            Paper Sandbox — BTC 15-min
          </h1>
          <p className="text-sm text-muted-foreground mt-1">
            Isolated paper-money testbed for Model Bet, PRED Bet, and Green Hours Bet. Uses the same gates as live, records to <code className="text-xs">paper_fills</code>.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <PaperBalanceBadge />
          <Link
            to="/crypto-paper"
            className="text-xs uppercase tracking-wider px-3 py-1.5 border border-border rounded hover:bg-card"
          >
            Logs & P&L →
          </Link>
          <Link
            to="/crypto"
            className="text-xs uppercase tracking-wider px-3 py-1.5 border border-border rounded hover:bg-card"
          >
            ← Back to Crypto
          </Link>
        </div>
      </div>

      <ModelBetPanel />
      <GreenHoursBetPanel />
      <PredBetPanel />
    </div>
  );
}
