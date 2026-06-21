// ─────────────────────────────────────────────────────────────────────────────
// lib/signClips.ts — Phase 3 Stage C: load + clean the recorded sign motion clips.
//
// Fetches /phw-sign-clips.json once (cached), then per channel (poseWorld, left,
// right hand): GAP-FILLS brief nulls by linear interpolation, CLAMPS implausible
// per-frame spikes, and SMOOTHS with a centered moving average. A hand that is
// missing for the WHOLE clip stays null (the retargeter leaves it at rest).
// ─────────────────────────────────────────────────────────────────────────────

export interface RawFrame {
  t: number;
  pose: number[][];
  poseWorld: number[][] | null;
  left: number[][] | null;
  right: number[][] | null;
}
export interface RawClip { fps: number; durationMs: number; frames: RawFrame[]; }
export type RawClipMap = Record<string, RawClip>;

export interface CleanFrame {
  t: number;
  poseWorld: number[][] | null; // [33][3]
  left: number[][] | null;      // [21][3]
  right: number[][] | null;     // [21][3]
}
export interface CleanClip {
  fps: number;
  durationMs: number;
  frames: CleanFrame[];
  hasLeft: boolean;
  hasRight: boolean;
}
export type CleanClipMap = Record<string, CleanClip>;

// Tunable cleanup strength.
export const SMOOTHING_HALF_WINDOW = 2; // moving-average ±2 frames (window 5)
const CLAMP_MAX_STEP = 0.18;            // drop per-frame jumps larger than this

function lerp(a: number, b: number, t: number) { return a + (b - a) * t; }

// Gap-fill + clamp + smooth a sequence of landmark matrices (frames × N × 3).
// Returns null if NO frame has data.
function cleanSeries(raw: (number[][] | null)[]): number[][][] | null {
  const F = raw.length;
  let firstPresent = -1, lastPresent = -1, N = 0;
  for (let i = 0; i < F; i++) {
    if (raw[i]) {
      if (firstPresent < 0) firstPresent = i;
      lastPresent = i;
      N = Math.max(N, raw[i]!.length);
    }
  }
  if (firstPresent < 0 || N === 0) return null;

  const filled: number[][][] = new Array(F);
  for (let i = 0; i < F; i++) {
    filled[i] = raw[i] ? raw[i]!.map((p) => [p[0] ?? 0, p[1] ?? 0, p[2] ?? 0]) : [];
  }

  // Linear-interpolate gaps between present frames.
  let prev = firstPresent;
  for (let i = firstPresent + 1; i <= lastPresent; i++) {
    if (filled[i].length) {
      if (i - prev > 1) {
        for (let g = prev + 1; g < i; g++) {
          const t = (g - prev) / (i - prev);
          const row: number[][] = [];
          for (let n = 0; n < N; n++) {
            const a = filled[prev][n] ?? [0, 0, 0];
            const b = filled[i][n] ?? [0, 0, 0];
            row.push([lerp(a[0], b[0], t), lerp(a[1], b[1], t), lerp(a[2], b[2], t)]);
          }
          filled[g] = row;
        }
      }
      prev = i;
    }
  }
  // Hold the nearest present frame for leading / trailing nulls.
  for (let i = 0; i < firstPresent; i++) filled[i] = filled[firstPresent].map((p) => p.slice());
  for (let i = lastPresent + 1; i < F; i++) filled[i] = filled[lastPresent].map((p) => p.slice());

  // Clamp spikes (per channel) — replace an implausible jump with the prior value.
  for (let n = 0; n < N; n++) {
    for (let c = 0; c < 3; c++) {
      for (let i = 1; i < F; i++) {
        const pv = filled[i - 1][n]?.[c] ?? 0;
        const cv = filled[i][n]?.[c] ?? 0;
        if (Math.abs(cv - pv) > CLAMP_MAX_STEP && filled[i][n]) filled[i][n][c] = pv;
      }
    }
  }

  // Centered moving-average smoothing.
  const w = SMOOTHING_HALF_WINDOW;
  if (w > 0) {
    const src = filled.map((fr) => fr.map((p) => p.slice()));
    for (let i = 0; i < F; i++) {
      for (let n = 0; n < N; n++) {
        for (let c = 0; c < 3; c++) {
          let sum = 0, cnt = 0;
          for (let k = -w; k <= w; k++) {
            const j = i + k;
            if (j >= 0 && j < F) { sum += src[j][n]?.[c] ?? 0; cnt++; }
          }
          if (filled[i][n]) filled[i][n][c] = cnt ? sum / cnt : (src[i][n]?.[c] ?? 0);
        }
      }
    }
  }
  return filled;
}

function processClip(raw: RawClip): CleanClip {
  const poseW = cleanSeries(raw.frames.map((f) => f.poseWorld));
  const right = cleanSeries(raw.frames.map((f) => f.right));
  const left = cleanSeries(raw.frames.map((f) => f.left));
  const frames: CleanFrame[] = raw.frames.map((f, i) => ({
    t: f.t,
    poseWorld: poseW ? poseW[i] : null,
    left: left ? left[i] : null,
    right: right ? right[i] : null,
  }));
  return { fps: raw.fps, durationMs: raw.durationMs, frames, hasLeft: !!left, hasRight: !!right };
}

let cache: Promise<CleanClipMap> | null = null;

/** Load + clean all sign clips once (cached). Never throws. */
export function getSignClips(): Promise<CleanClipMap> {
  if (cache) return cache;
  cache = (async () => {
    try {
      const res = await fetch("/phw-sign-clips.json", { cache: "force-cache" });
      if (!res.ok) return {};
      const raw = (await res.json()) as RawClipMap;
      const out: CleanClipMap = {};
      for (const k of Object.keys(raw)) {
        try { out[k] = processClip(raw[k]); }
        catch (e) { console.warn("[signClips] failed to process", k, e); }
      }
      return out;
    } catch (e) {
      console.warn("[signClips] load failed:", e);
      return {};
    }
  })();
  return cache;
}

/** Normalize a gloss token to a clip key: UPPERCASE, spaces/hyphens → underscore. */
export function normalizeToken(tok: string): string {
  return tok.trim().toUpperCase().replace(/[\s-]+/g, "_");
}