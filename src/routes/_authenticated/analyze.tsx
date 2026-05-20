import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { useAuth } from "@/components/auth/AuthProvider";
import { supabase } from "@/integrations/supabase/client";
import { runAnalysis } from "@/lib/analysisEngine";
import { SPORTS, type Sport } from "@/lib/sports";
import { Disclaimer } from "@/components/edge/Disclaimer";
import { ProbabilityBar } from "@/components/edge/ProbabilityBar";
import { detectKalshiGraph } from "@/lib/kalshiDetect.functions";
import { toast } from "sonner";
import { Upload, Sparkles, Loader2 } from "lucide-react";

export const Route = createFileRoute("/_authenticated/analyze")({
  head: () => ({ meta: [{ title: "Analyze Graph — EdgeGraph AI" }] }),
  component: Analyze,
});

const fileToDataUrl = (f: File) =>
  new Promise<string>((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(r.result as string);
    r.onerror = () => reject(r.error);
    r.readAsDataURL(f);
  });

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="terminal-label">{label}</span>
      <div className="mt-1">{children}</div>
    </label>
  );
}

const inputCls =
  "w-full bg-background border border-border rounded px-2.5 py-1.5 text-sm focus:border-[color:var(--color-primary)] outline-none font-mono";

function Analyze() {
  const nav = useNavigate();
  const { user } = useAuth();
  const [sport, setSport] = useState<Sport>("NBA");
  const [form, setForm] = useState<Record<string, string>>({
    league: "", gameName: "", teamA: "", teamB: "", score: "", timePeriod: "", homeAway: "Home",
    probabilityA: "65", probabilityB: "35", oddsA: "1.5", oddsB: "2.7", volume: "10000",
    liveNotes: "", injuryNotes: "", marketNotes: "",
  });
  const [sf, setSf] = useState<Record<string, string | boolean>>({});
  const [file, setFile] = useState<File | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [detecting, setDetecting] = useState(false);
  const detect = useServerFn(detectKalshiGraph);

  const upd = (k: string, v: string) => setForm((f) => ({ ...f, [k]: v }));
  const updSf = (k: string, v: string | boolean) => setSf((s) => ({ ...s, [k]: v }));

  const probA = Number(form.probabilityA || 0);
  const probB = Number(form.probabilityB || 0);

  const runDetect = async () => {
    if (!file) {
      toast.error("Upload a Kalshi screenshot first.");
      return;
    }
    setDetecting(true);
    try {
      const imageDataUrl = await fileToDataUrl(file);
      const d = await detect({ data: { imageDataUrl } });
      const sportKey = (["NBA", "NFL", "NHL", "MLB", "Tennis", "Soccer"] as Sport[]).includes(d.sport as Sport)
        ? (d.sport as Sport)
        : sport;
      setSport(sportKey);
      setForm((f) => ({
        ...f,
        league: d.league || f.league,
        gameName: d.gameName || f.gameName,
        teamA: d.teamA || f.teamA,
        teamB: d.teamB || f.teamB,
        score: d.score || f.score,
        timePeriod: d.timePeriod || f.timePeriod,
        probabilityA: String(Math.round(d.probabilityA ?? 0)),
        probabilityB: String(Math.round(d.probabilityB ?? 0)),
        oddsA: d.oddsA ? String(d.oddsA) : f.oddsA,
        oddsB: d.oddsB ? String(d.oddsB) : f.oddsB,
        volume: d.volume ? String(d.volume) : f.volume,
        marketNotes: [d.marketNote, `Shape: ${d.shape}`, `Momentum: ${d.momentum}`, `Volatility: ${d.volatility}`]
          .filter(Boolean)
          .join(" · "),
      }));
      toast.success(`Detected: ${d.shape} (${Math.round(d.confidence * 100)}% confidence)`);
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setDetecting(false);
    }
  };

  const submit = async () => {
    if (!user) return;
    setSubmitting(true);
    try {
      let imageUrl: string | null = null;
      if (file) {
        const path = `${user.id}/${Date.now()}-${file.name}`;
        const { error: upErr } = await supabase.storage.from("graph-uploads").upload(path, file);
        if (upErr) throw upErr;
        imageUrl = path;
      }
      const result = runAnalysis({
        sport,
        league: form.league, gameName: form.gameName, teamA: form.teamA, teamB: form.teamB,
        score: form.score, timePeriod: form.timePeriod,
        probabilityA: probA, probabilityB: probB,
        oddsA: Number(form.oddsA), oddsB: Number(form.oddsB), volume: Number(form.volume),
        sportFields: sf,
        notes: { live: form.liveNotes, injury: form.injuryNotes, market: form.marketNotes },
      });
      const { data, error } = await supabase
        .from("analyses")
        .insert({
          user_id: user.id,
          sport, league: form.league, game_name: form.gameName, team_a: form.teamA, team_b: form.teamB,
          score: form.score, time_period: form.timePeriod,
          probability_a: probA, probability_b: probB,
          odds_a: Number(form.oddsA), odds_b: Number(form.oddsB), volume: Number(form.volume),
          uploaded_image_url: imageUrl,
          pattern_type: result.pattern, predicted_winner: result.predictedWinner,
          confidence_score: result.confidenceScore, edge_score: result.edgeScore,
          risk_level: result.riskLevel, recommended_action: result.recommendedAction,
          ai_reasoning: result.reasoning.join("\n"), edge70_detected: result.edge70Detected,
          sport_fields: sf, notes: { live: form.liveNotes, injury: form.injuryNotes, market: form.marketNotes },
        })
        .select()
        .single();
      if (error) throw error;
      await supabase.from("graph_snapshots").insert({
        analysis_id: data.id, user_id: user.id,
        probability_a: probA, probability_b: probB,
        odds_a: Number(form.oddsA), odds_b: Number(form.oddsB),
        volume: Number(form.volume), score_state: form.score, event_trigger: "initial",
      });
      toast.success("Analysis saved");
      nav({ to: "/analysis/$id", params: { id: data.id } });
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="space-y-6 font-mono">
      <div>
        <h1 className="text-2xl font-bold uppercase tracking-wider">// Analyze Graph</h1>
        <p className="text-xs text-muted-foreground">Upload a betting graph + game context to generate an AI pattern signal.</p>
      </div>

      <div className="grid lg:grid-cols-2 gap-4">
        {/* Left column */}
        <div className="space-y-4">
          <div className="border border-dashed border-border bg-card rounded p-6 text-center hover:border-[color:var(--color-primary)] transition">
            <input
              id="graph-file"
              type="file"
              accept="image/*"
              className="hidden"
              onChange={(e) => setFile(e.target.files?.[0] ?? null)}
            />
            <label htmlFor="graph-file" className="cursor-pointer flex flex-col items-center gap-2">
              <Upload className="h-6 w-6 text-[color:var(--color-primary)]" />
              <span className="text-sm uppercase tracking-wider">
                {file ? file.name : "Click to upload graph image"}
              </span>
              <span className="text-xs text-muted-foreground">PNG / JPG · stored privately</span>
            </label>
          </div>

          <div className="border border-border bg-card rounded p-4">
            <h2 className="terminal-label mb-3">// Sport</h2>
            <div className="grid grid-cols-3 gap-2">
              {SPORTS.map((s) => (
                <button
                  key={s.key}
                  onClick={() => { setSport(s.key); setSf({}); }}
                  className={`px-2 py-2 text-xs rounded border uppercase tracking-wider ${
                    sport === s.key
                      ? "border-[color:var(--color-primary)] text-[color:var(--color-primary)] bg-[color:var(--color-primary)]/10"
                      : "border-border text-muted-foreground hover:text-foreground"
                  }`}
                >
                  {s.icon} {s.label}
                </button>
              ))}
            </div>
          </div>

          <div className="border border-border bg-card rounded p-4 grid grid-cols-2 gap-3">
            <Field label="League"><input className={inputCls} value={form.league} onChange={(e) => upd("league", e.target.value)} /></Field>
            <Field label="Game Name"><input className={inputCls} value={form.gameName} onChange={(e) => upd("gameName", e.target.value)} /></Field>
            <Field label="Team A"><input className={inputCls} value={form.teamA} onChange={(e) => upd("teamA", e.target.value)} /></Field>
            <Field label="Team B"><input className={inputCls} value={form.teamB} onChange={(e) => upd("teamB", e.target.value)} /></Field>
            <Field label="Score"><input className={inputCls} value={form.score} onChange={(e) => upd("score", e.target.value)} /></Field>
            <Field label="Time / Period"><input className={inputCls} value={form.timePeriod} onChange={(e) => upd("timePeriod", e.target.value)} /></Field>
            <Field label="Home / Away">
              <select className={inputCls} value={form.homeAway} onChange={(e) => upd("homeAway", e.target.value)}>
                <option>Home</option><option>Away</option><option>Neutral</option>
              </select>
            </Field>
          </div>
        </div>

        {/* Right column */}
        <div className="space-y-4">
          <div className="border border-border bg-card rounded p-4 space-y-3">
            <h2 className="terminal-label">// Market data</h2>
            <div className="grid grid-cols-2 gap-3">
              <Field label={`Probability A (%) ${form.teamA}`}><input type="number" min={0} max={100} className={inputCls} value={form.probabilityA} onChange={(e) => upd("probabilityA", e.target.value)} /></Field>
              <Field label={`Probability B (%) ${form.teamB}`}><input type="number" min={0} max={100} className={inputCls} value={form.probabilityB} onChange={(e) => upd("probabilityB", e.target.value)} /></Field>
              <Field label="Odds A"><input type="number" step="0.01" className={inputCls} value={form.oddsA} onChange={(e) => upd("oddsA", e.target.value)} /></Field>
              <Field label="Odds B"><input type="number" step="0.01" className={inputCls} value={form.oddsB} onChange={(e) => upd("oddsB", e.target.value)} /></Field>
              <Field label="Volume / Liquidity"><input type="number" className={inputCls} value={form.volume} onChange={(e) => upd("volume", e.target.value)} /></Field>
            </div>
            <ProbabilityBar a={probA} b={probB} labelA={form.teamA || "A"} labelB={form.teamB || "B"} />
          </div>

          <div className="border border-border bg-card rounded p-4 space-y-3">
            <h2 className="terminal-label">// {sport} game state</h2>
            <SportFields sport={sport} sf={sf} updSf={updSf} />
          </div>

          <div className="border border-border bg-card rounded p-4 space-y-3">
            <h2 className="terminal-label">// Intelligence notes</h2>
            <Field label="Live notes"><textarea rows={2} className={inputCls} value={form.liveNotes} onChange={(e) => upd("liveNotes", e.target.value)} placeholder="momentum shift, spike & collapse, sharp money…" /></Field>
            <Field label="Injury / News"><textarea rows={2} className={inputCls} value={form.injuryNotes} onChange={(e) => upd("injuryNotes", e.target.value)} placeholder="foul trouble, red card, bullpen depleted…" /></Field>
            <Field label="Market movement"><textarea rows={2} className={inputCls} value={form.marketNotes} onChange={(e) => upd("marketNotes", e.target.value)} /></Field>
          </div>

          <button
            onClick={submit}
            disabled={submitting}
            className="w-full py-3 border border-[color:var(--color-primary)] text-[color:var(--color-primary)] uppercase tracking-widest text-sm rounded hover:bg-[color:var(--color-primary)]/10 neon-border disabled:opacity-50"
          >
            {submitting ? "Running…" : "⚡ Run AI Analysis"}
          </button>
        </div>
      </div>

      <Disclaimer />
    </div>
  );
}

function SportFields({
  sport, sf, updSf,
}: {
  sport: Sport;
  sf: Record<string, string | boolean>;
  updSf: (k: string, v: string | boolean) => void;
}) {
  const T = ({ k, label, type = "text" }: { k: string; label: string; type?: string }) => (
    <Field label={label}>
      <input type={type} className={inputCls} value={String(sf[k] ?? "")} onChange={(e) => updSf(k, e.target.value)} />
    </Field>
  );
  const C = ({ k, label }: { k: string; label: string }) => (
    <label className="flex items-center gap-2 text-xs uppercase tracking-wider">
      <input type="checkbox" checked={!!sf[k]} onChange={(e) => updSf(k, e.target.checked)} /> {label}
    </label>
  );
  if (sport === "NBA") return (
    <div className="grid grid-cols-2 gap-3">
      <T k="quarter" label="Quarter" />
      <T k="timeRemainingMin" label="Time remaining (min)" type="number" />
      <C k="foulTrouble" label="Foul trouble" />
      <T k="pace" label="Game pace" />
      <T k="possession" label="Possession" />
    </div>
  );
  if (sport === "NFL") return (
    <div className="grid grid-cols-2 gap-3">
      <T k="quarter" label="Quarter" />
      <T k="timeRemainingMin" label="Time remaining (min)" type="number" />
      <T k="fieldPosition" label="Field position" />
      <T k="timeouts" label="Timeouts" type="number" />
      <T k="downDistance" label="Down & distance" />
    </div>
  );
  if (sport === "NHL") return (
    <div className="grid grid-cols-2 gap-3">
      <T k="period" label="Period" />
      <T k="timeRemainingMin" label="Time remaining (min)" type="number" />
      <C k="powerPlay" label="Power play active" />
      <T k="shotsA" label="Shots A" type="number" />
      <T k="shotsB" label="Shots B" type="number" />
    </div>
  );
  if (sport === "MLB") return (
    <div className="grid grid-cols-2 gap-3">
      <T k="inning" label="Inning" type="number" />
      <T k="topBottom" label="Top / Bottom" />
      <T k="outs" label="Outs" type="number" />
      <T k="baseRunners" label="Base runners" />
      <T k="bullpen" label="Bullpen status" />
    </div>
  );
  if (sport === "Tennis") return (
    <div className="grid grid-cols-2 gap-3">
      <T k="setsScore" label="Sets score" />
      <T k="currentGames" label="Current games" />
      <T k="server" label="Current server" />
      <C k="breakPoints" label="Active break points" />
      <C k="tiebreak" label="Tiebreak" />
    </div>
  );
  return (
    <div className="grid grid-cols-2 gap-3">
      <T k="minute" label="Match minute" type="number" />
      <T k="redCards" label="Red cards" />
      <T k="possession" label="Possession %" />
      <T k="shotsXg" label="Shots / xG" />
      <T k="subs" label="Subs used" />
    </div>
  );
}
