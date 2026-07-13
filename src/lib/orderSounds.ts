// Tiny WebAudio beeps for order events. No assets, no network.
let ctx: AudioContext | null = null;

function getCtx(): AudioContext | null {
  if (typeof window === "undefined") return null;
  try {
    if (!ctx) {
      const AC = (window.AudioContext || (window as any).webkitAudioContext) as typeof AudioContext | undefined;
      if (!AC) return null;
      ctx = new AC();
    }
    if (ctx.state === "suspended") void ctx.resume();
    return ctx;
  } catch {
    return null;
  }
}

function tone(freq: number, durMs: number, startOffsetMs = 0, gain = 0.08) {
  const ac = getCtx();
  if (!ac) return;
  const t0 = ac.currentTime + startOffsetMs / 1000;
  const osc = ac.createOscillator();
  const g = ac.createGain();
  osc.type = "sine";
  osc.frequency.value = freq;
  g.gain.setValueAtTime(0, t0);
  g.gain.linearRampToValueAtTime(gain, t0 + 0.01);
  g.gain.exponentialRampToValueAtTime(0.0001, t0 + durMs / 1000);
  osc.connect(g).connect(ac.destination);
  osc.start(t0);
  osc.stop(t0 + durMs / 1000 + 0.02);
}

export function playOrderPlaced() {
  tone(660, 180, 0, 0.08);
}

export function playOrderFilled() {
  tone(880, 140, 0, 0.09);
  tone(1320, 200, 140, 0.09);
}

// Discord-style two-note ping for Model Bet placements.
export function playModelBetPing() {
  tone(587.33, 120, 0, 0.09);    // D5
  tone(880.0, 220, 110, 0.09);   // A5
}
