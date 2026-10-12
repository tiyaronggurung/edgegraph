// Quad-Confirmation paper engine (PAPER ONLY — never places real orders).
// Runs three strategies side by side on the same live signals:
//   A  Quad entry: whale (rn1 ≥70% one side) + Study + Model + our odds >52% agree → $leg1, ride to settle.
//   B  Pair-lock: buy whichever side our odds price ≤45¢, then the opposite side when pair ≤ pair_max.
//   C  Hybrid: A's entry (plus late tiebreaker) with a hedge reserve that locks at ≤ pair_max.
// NULL fallback: if Study OR Model is missing, the other plus odds ≥60% stands in.
// If both are missing, or odds are stale, no new entries (open legs may still hedge).
// Fills priced at our odds (YES = p_up, NO = 1 − p_up); settled on logged spot vs strike.

const WINDOW_MS = 900_000;
const STALE_SEC = 30;
const RN1 = "0xb55fa1296e6ec55d0ce53d93b9237389f11764d4";
const STRATS = ["A", "B", "C"] as const;
type Side = "UP" | "DOWN";

async function whaleSplit(windowStartMs: number) {
  try {
    const slug = `btc-updown-15m-${Math.floor(windowStartMs / 1000)}`;
    const res = await fetch(
      `https://data-api.polymarket.com/activity?user=${RN1}&limit=300&type=TRADE`,
      { headers: { accept: "application/json", "user-agent": "Mozilla/5.0" } },
    );
    if (!res.ok) return null;
    const rows = (await res.json()) as any[];
    let up = 0, down = 0;
    for (const r of rows) {
      if (r.slug !== slug || r.side !== "BUY") continue;
      const v = Number(r.usdcSize) || 0;
      if (r.outcome === "Up") up += v; else if (r.outcome === "Down") down += v;
    }
    const total = up + down;
    if (total < 20) return { up, down, side: null as Side | null, share: 0 };
    const side: Side = up >= down ? "UP" : "DOWN";
    return { up, down, side, share: Math.max(up, down) / total };
  } catch {
    return null;
  }
}

export async function runQuadBotTick() {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const sb = supabaseAdmin as any;
  const { data: s } = await sb.from("qc_settings").select("*").eq("id", 1).single();
  if (!s?.running) return { skipped: "paused" };

  const leg1 = Number(s.leg1_usd), leg2 = Number(s.leg2_usd);
  const entryMax = Number(s.entry_max), pairMax = Number(s.pair_max);
  const nowMs = Date.now();
  const wStartMs = Math.floor(nowMs / WINDOW_MS) * WINDOW_MS;
  const wIso = new Date(wStartMs).toISOString();
  const msIn = nowMs - wStartMs;
  const secsLeft = Math.round((wStartMs + WINDOW_MS - nowMs) / 1000);
  const fills: any[] = [];
  let err: string | null = null;
  let signals: any = null;

  try {
    // 1. Settle closed windows.
    const { data: open } = await sb.from("qc_positions").select("*").eq("settled", false).lt("window_start", wIso);
    for (const p of open ?? []) {
      const { data: last } = await sb.from("btc_agreement_log").select("spot, strike")
        .eq("window_start", p.window_start).not("spot", "is", null).not("strike", "is", null)
        .order("bucket_sec", { ascending: false }).limit(1).maybeSingle();
      if (!last || Number(last.spot) === Number(last.strike)) continue;
      const result: Side = Number(last.spot) > Number(last.strike) ? "UP" : "DOWN";
      const payout = result === "UP" ? Number(p.up_ct) : Number(p.down_ct);
      const pnl = Math.round((payout - Number(p.up_cost) - Number(p.down_cost)) * 100) / 100;
      await sb.from("qc_positions").update({ settled: true, result, payout, pnl, settled_at: new Date().toISOString() }).eq("id", p.id);
      fills.push({ strategy: p.strategy, window_start: p.window_start, side: result, kind: "settle", amount: payout,
        reason: `settled ${result} · spot ${last.spot} vs strike ${last.strike} · P&L ${pnl}` });
    }

    // 2. Signals.
    const [{ data: ag }, whale] = await Promise.all([
      sb.from("btc_agreement_log").select("bucket_sec, odds_p_up, model_side, study_side, spot, strike")
        .eq("window_start", wIso).order("bucket_sec", { ascending: false }).limit(1).maybeSingle(),
      whaleSplit(wStartMs),
    ]);
    // Latest non-null study/model in this window (they can blink to null).
    const { data: lastStudy } = await sb.from("btc_agreement_log").select("study_side")
      .eq("window_start", wIso).not("study_side", "is", null).order("bucket_sec", { ascending: false }).limit(1).maybeSingle();
    const pUp = ag?.odds_p_up != null ? Number(ag.odds_p_up) : null;
    const fresh = ag && pUp != null && pUp > 0 && pUp < 1 && Date.now() / 1000 - Number(ag.bucket_sec) <= STALE_SEC;
    const norm = (v: any): Side | null => (v ? (String(v).toUpperCase().startsWith("U") ? "UP" : "DOWN") : null);
    const study = norm(lastStudy?.study_side);
    const model = norm(ag?.model_side);
    const oddsSide: Side | null = pUp == null ? null : pUp > 0.52 ? "UP" : pUp < 0.48 ? "DOWN" : null;
    const oddsFor = (side: Side) => (pUp == null ? 0 : side === "UP" ? pUp : 1 - pUp);
    const price = (side: Side) => (side === "UP" ? pUp! : 1 - pUp!);
    signals = { pUp, fresh: !!fresh, study, model, oddsSide, whale, secsLeft };

    // Quad confirmation with NULL fallback.
    let quad: Side | null = null;
    let quadWhy = "";
    if (fresh && whale?.side && whale.share >= 0.7 && oddsSide === whale.side) {
      const side = whale.side;
      if (study === side && model === side) { quad = side; quadWhy = "whale+study+model+odds"; }
      else if (study == null && model === side && oddsFor(side) >= 0.6) { quad = side; quadWhy = "whale+model+odds≥60 (study null)"; }
      else if (model == null && study === side && oddsFor(side) >= 0.6) { quad = side; quadWhy = "whale+study+odds≥60 (model null)"; }
    }
    // Late tiebreaker (C only): last 3 min, Study≠Model, odds >55% for one of them.
    let late: Side | null = null;
    if (fresh && secsLeft <= 180 && study && model && study !== model) {
      const s2 = oddsFor(study) > 0.55 ? study : oddsFor(model) > 0.55 ? model : null;
      if (s2) late = s2;
    }
    signals.quad = quad; signals.late = late;

    const canEnter = fresh && msIn >= 90_000 && secsLeft > 60;
    if (fresh && secsLeft > 60) {
      for (const strat of STRATS) {
        const { data: pos } = await sb.from("qc_positions").select("*").eq("strategy", strat).eq("window_start", wIso).maybeSingle();
        const empty = !pos || (Number(pos.up_ct) === 0 && Number(pos.down_ct) === 0);
        const buy = async (side: Side, usd: number, kind: string, why: string, lock = false) => {
          const px = price(side);
          const ct = Math.floor(kind === "hedge" ? Number(side === "UP" ? pos.down_ct : pos.up_ct) : usd / px);
          if (ct < 1) return;
          const cost = Math.round(ct * px * 100) / 100;
          const row: any = { strategy: strat, window_start: wIso };
          if (side === "UP") { row.up_ct = Number(pos?.up_ct ?? 0) + ct; row.up_cost = Number(pos?.up_cost ?? 0) + cost; }
          else { row.down_ct = Number(pos?.down_ct ?? 0) + ct; row.down_cost = Number(pos?.down_cost ?? 0) + cost; }
          if (lock) row.locked = true;
          await sb.from("qc_positions").upsert(row, { onConflict: "strategy,window_start" });
          fills.push({ strategy: strat, window_start: wIso, side, kind, contracts: ct, price: px, amount: cost,
            reason: why, signals, ms_from_start: msIn });
        };
        if (empty) {
          if (!canEnter) continue;
          if (strat === "A" && quad && price(quad) <= entryMax) await buy(quad, leg1, "entry", `quad: ${quadWhy}`);
          if (strat === "B") {
            const cheap: Side | null = pUp! <= 0.45 ? "UP" : 1 - pUp! <= 0.45 ? "DOWN" : null;
            if (cheap) await buy(cheap, leg1, "entry", `cheap side ≤45¢`);
          }
          if (strat === "C") {
            const side = quad ?? late;
            if (side && price(side) <= entryMax) await buy(side, leg1, "entry", quad ? `quad: ${quadWhy}` : "late tiebreaker (Study≠Model, odds >55%)");
          }
        } else if ((strat === "B" || strat === "C") && !pos.locked) {
          const have: Side = Number(pos.up_ct) > 0 ? "UP" : "DOWN";
          const opp: Side = have === "UP" ? "DOWN" : "UP";
          const avg = have === "UP" ? Number(pos.up_cost) / Number(pos.up_ct) : Number(pos.down_cost) / Number(pos.down_ct);
          const pair = avg + price(opp);
          const oppCost = Number(have === "UP" ? pos.up_ct : pos.down_ct) * price(opp);
          if (pair <= pairMax && oppCost <= leg2) {
            await buy(opp, leg2, "hedge", `hedge ${opp} · pair ${(pair * 100).toFixed(0)}¢ locks profit`, true);
          }
        }
      }
    } else if (!fresh) err = "waiting for fresh odds";
  } catch (e) {
    err = String((e as Error)?.message ?? e);
  }

  if (fills.length) {
    const { error } = await sb.from("qc_fills").insert(fills);
    if (error) console.error("qc_fills:", error.message);
  }
  await sb.from("qc_settings").update({ last_tick_at: new Date().toISOString(), last_error: err, last_signals: signals }).eq("id", 1);
  return { ok: true, fills: fills.length, error: err };
}
