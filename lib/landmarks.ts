// ─────────────────────────────────────────────────────────────────────────────
// Landmark preprocessing
//
// MediaPipe Hands returns 21 landmarks per hand, each with x/y normalized to the
// image [0, 1] range and z a relative depth. Those raw coordinates are NOT a good
// feature for a classifier: they shift when the hand moves around the frame and
// scale with how close the hand is to the camera.
//
// We make the feature vector translation- and scale-invariant:
//   1. translate so the wrist (landmark 0) sits at the origin
//   2. scale so the largest wrist→landmark distance becomes 1
//
// The result is a flat 63-element vector (21 points × x,y,z) that depends only on
// the *shape* of the hand, not where it is or how big it appears.
// ─────────────────────────────────────────────────────────────────────────────

export interface RawLandmark {
  x: number;
  y: number;
  z: number;
}

export const LANDMARK_COUNT = 21;
export const VECTOR_LENGTH = LANDMARK_COUNT * 3; // 63

/**
 * Normalize a single hand's 21 landmarks into a translation/scale-invariant
 * 63-element feature vector. Returns null if the input is not a full hand.
 */
export function normalizeLandmarks(landmarks: RawLandmark[] | undefined | null): number[] | null {
  if (!landmarks || landmarks.length !== LANDMARK_COUNT) return null;

  const wrist = landmarks[0];

  // 1. translate so the wrist is the origin
  const centered = landmarks.map((p) => ({
    x: p.x - wrist.x,
    y: p.y - wrist.y,
    z: p.z - wrist.z,
  }));

  // 2. scale by the largest distance from the wrist (hand size)
  let scale = 0;
  for (const p of centered) {
    const d = Math.hypot(p.x, p.y, p.z);
    if (d > scale) scale = d;
  }
  if (scale < 1e-6) scale = 1e-6; // guard against degenerate / collapsed hands

  const out: number[] = new Array(VECTOR_LENGTH);
  for (let i = 0; i < centered.length; i++) {
    out[i * 3 + 0] = centered[i].x / scale;
    out[i * 3 + 1] = centered[i].y / scale;
    out[i * 3 + 2] = centered[i].z / scale;
  }
  return out;
}

/** Squared euclidean distance between two equal-length vectors. */
export function squaredDistance(a: number[], b: number[]): number {
  let sum = 0;
  const n = Math.min(a.length, b.length);
  for (let i = 0; i < n; i++) {
    const d = a[i] - b[i];
    sum += d * d;
  }
  return sum;
}
