// Programmatic two-note ringtone using the Web Audio API — no audio files needed.

let _ctx: AudioContext | null = null;
let _timer: ReturnType<typeof setInterval> | null = null;

function chime(ctx: AudioContext, f1: number, f2: number): void {
  const t = ctx.currentTime;
  [
    { freq: f1, delay: 0,    dur: 0.5 },
    { freq: f2, delay: 0.38, dur: 0.5 },
  ].forEach(({ freq, delay, dur }) => {
    const osc = ctx.createOscillator();
    const env = ctx.createGain();
    osc.connect(env);
    env.connect(ctx.destination);
    osc.type = "sine";
    osc.frequency.value = freq;
    env.gain.setValueAtTime(0, t + delay);
    env.gain.linearRampToValueAtTime(0.15, t + delay + 0.03);
    env.gain.exponentialRampToValueAtTime(0.001, t + delay + dur);
    osc.start(t + delay);
    osc.stop(t + delay + dur);
  });
}

export function startRingtone(): void {
  if (typeof window === "undefined" || _ctx) return;
  try {
    _ctx = new AudioContext();
    const ring = () => { if (_ctx) chime(_ctx, 880, 1100); };
    ring();
    _timer = setInterval(ring, 2500);
  } catch {
    // AudioContext unavailable (e.g. blocked by browser policy)
  }
}

export function stopRingtone(): void {
  if (_timer !== null) { clearInterval(_timer); _timer = null; }
  if (_ctx) { _ctx.close().catch(() => {}); _ctx = null; }
}
