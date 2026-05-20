import { createFileRoute, Link } from "@tanstack/react-router";
import { Disclaimer } from "@/components/edge/Disclaimer";
import { MiniProbChart } from "@/components/edge/MiniProbChart";
import { SPORTS } from "@/lib/sports";
import { generateSimulatedSeries, type Pattern } from "@/lib/analysisEngine";
import { Zap } from "lucide-react";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "EdgeGraph AI — AI Pattern Learning for Sports Betting Graphs" },
      { name: "description", content: "Upload live betting graphs, track market movement, detect hidden patterns, and estimate high-confidence outcomes." },
      { property: "og:title", content: "EdgeGraph AI — AI Pattern Learning for Sports Betting Graphs" },
      { property: "og:description", content: "Upload live betting graphs, track market movement, detect hidden patterns, and estimate high-confidence outcomes." },
    ],
  }),
  component: Landing,
});

const PREVIEW_PATTERNS: { name: Pattern; icon: string; risk: string; desc: string; finalProb: number }[] = [
  { name: "Dominant Lock", icon: "🔒", risk: "Low", desc: "Flat high probability — favorite locked in.", finalProb: 92 },
  { name: "Breakaway Trend", icon: "🚀", risk: "Medium", desc: "Sudden directional shift with volume.", finalProb: 78 },
  { name: "V-Reversal", icon: "↗", risk: "Medium", desc: "Sharp recovery after drop.", finalProb: 70 },
  { name: "Fake Spike", icon: "⚠", risk: "High", desc: "Emotional move that collapses.", finalProb: 55 },
  { name: "Chaotic Coin Flip", icon: "🎰", risk: "High", desc: "No stable edge — avoid.", finalProb: 50 },
  { name: "Sharp Money Recovery", icon: "💰", risk: "Medium", desc: "Quiet repositioning after panic.", finalProb: 76 },
];

function Landing() {
  return (
    <div className="min-h-screen text-foreground font-mono">
      {/* Hero */}
      <header className="border-b border-border">
        <div className="max-w-7xl mx-auto px-4 py-4 flex justify-between items-center">
          <div className="flex items-center gap-2 neon-text font-bold">
            <Zap className="h-4 w-4 fill-current" />
            <span className="tracking-widest text-sm">EDGEGRAPH AI</span>
          </div>
          <div className="flex gap-2">
            <Link to="/login" className="text-xs uppercase tracking-wider px-3 py-1.5 hover:text-[color:var(--color-primary)]">
              Sign in
            </Link>
            <Link
              to="/signup"
              className="text-xs uppercase tracking-wider px-3 py-1.5 border border-[color:var(--color-primary)] text-[color:var(--color-primary)] rounded hover:bg-[color:var(--color-primary)]/10"
            >
              Get access
            </Link>
          </div>
        </div>
      </header>

      <section className="relative grid-bg">
        <div className="max-w-5xl mx-auto px-4 py-24 text-center">
          <div className="inline-block text-[10px] uppercase tracking-[0.3em] text-[color:var(--color-primary)] border border-[color:var(--color-primary)]/40 px-2 py-1 rounded mb-6">
            ⚡ Pattern Intelligence v1.0
          </div>
          <h1 className="text-4xl md:text-6xl font-bold tracking-tight leading-tight">
            AI Pattern Learning for
            <br />
            <span className="neon-text">Sports Betting Graphs</span>
          </h1>
          <p className="mt-6 text-base md:text-lg text-muted-foreground max-w-2xl mx-auto">
            Upload live betting graphs, track market movement, detect hidden patterns, and estimate high-confidence
            outcomes — all in a terminal built for sports markets.
          </p>
          <div className="mt-10 flex flex-wrap justify-center gap-3">
            <Link
              to="/analyze"
              className="px-5 py-3 border border-[color:var(--color-primary)] text-[color:var(--color-primary)] rounded uppercase tracking-wider text-xs hover:bg-[color:var(--color-primary)]/10 neon-border"
            >
              ⚡ Analyze Graph
            </Link>
            <Link
              to="/patterns"
              className="px-5 py-3 border border-border rounded uppercase tracking-wider text-xs hover:border-[color:var(--color-info)] hover:text-[color:var(--color-info)]"
            >
              View Pattern Library
            </Link>
            <Link
              to="/backtest"
              className="px-5 py-3 border border-border rounded uppercase tracking-wider text-xs hover:border-[color:var(--color-warning)] hover:text-[color:var(--color-warning)]"
            >
              Track Picks
            </Link>
          </div>
        </div>
      </section>

      {/* How it works */}
      <section className="max-w-6xl mx-auto px-4 py-20">
        <h2 className="terminal-label mb-2">// How it works</h2>
        <div className="grid md:grid-cols-3 gap-4">
          {[
            { n: "01", t: "Upload", d: "Drop a live betting graph screenshot from any sportsbook or prediction market." },
            { n: "02", t: "Context", d: "Add sport, score, period, and any market notes — the engine reads the situation." },
            { n: "03", t: "Analysis", d: "Get pattern classification, Edge70 signal, confidence gauge, and recommended action." },
          ].map((s) => (
            <div key={s.n} className="border border-border bg-card rounded p-6">
              <div className="text-xs neon-text mb-2">{s.n}</div>
              <div className="text-lg font-bold uppercase tracking-wider">{s.t}</div>
              <p className="text-sm text-muted-foreground mt-2">{s.d}</p>
            </div>
          ))}
        </div>
      </section>

      {/* Sports */}
      <section className="max-w-6xl mx-auto px-4 py-10">
        <h2 className="terminal-label mb-3">// Supported markets</h2>
        <div className="flex flex-wrap gap-2">
          {SPORTS.map((s) => (
            <span
              key={s.key}
              className="px-3 py-2 border border-border rounded text-sm bg-card uppercase tracking-wider"
            >
              {s.icon} {s.label}
            </span>
          ))}
        </div>
      </section>

      {/* Pattern previews */}
      <section className="max-w-6xl mx-auto px-4 py-16">
        <h2 className="terminal-label mb-3">// Pattern detection preview</h2>
        <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-4">
          {PREVIEW_PATTERNS.map((p) => (
            <div key={p.name} className="border border-border bg-card rounded p-4">
              <div className="flex justify-between items-center mb-2">
                <div className="font-bold flex items-center gap-2">
                  <span>{p.icon}</span> {p.name}
                </div>
                <span className="text-[10px] uppercase tracking-widest text-muted-foreground">{p.risk}</span>
              </div>
              <MiniProbChart series={generateSimulatedSeries(p.name, p.finalProb)} />
              <p className="text-xs text-muted-foreground mt-2">{p.desc}</p>
            </div>
          ))}
        </div>
      </section>

      {/* Edge70 */}
      <section className="max-w-6xl mx-auto px-4 py-16">
        <div className="border border-[color:var(--color-primary)]/30 bg-card rounded p-6 md:p-8">
          <div className="text-xs neon-text uppercase tracking-widest mb-2">⚡ Edge70 Signal System</div>
          <h3 className="text-2xl font-bold mb-3">A multi-gate confidence filter, not just a probability check.</h3>
          <p className="text-sm text-muted-foreground max-w-3xl">
            Edge70 fires only when the market probability is above 70% AND the detected pattern is safe AND
            sport-specific risk gates (foul trouble, power play, tiebreak, late-inning bullpen status, red cards,
            timeouts, …) all pass. It's the difference between "probably winning" and "actionable edge."
          </p>
        </div>
      </section>

      <section className="max-w-6xl mx-auto px-4 pb-12">
        <Disclaimer />
      </section>

      <footer className="border-t border-border py-6 text-center text-xs text-muted-foreground">
        © EdgeGraph AI — Educational analytics only.
      </footer>
    </div>
  );
}
