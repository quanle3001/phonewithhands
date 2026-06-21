// ─────────────────────────────────────────────────────────────────────────────
// KNNClassifier — k-nearest-neighbours over normalized landmark vectors.
//
// Single-frame classification: each captured frame is one (label, vector) sample.
// predict() finds the k closest stored samples by euclidean distance, takes a
// distance-weighted vote, and gates on distance so unfamiliar hand shapes return
// { label: null }. This keeps the playground's pretrained gestures from being
// hijacked by a half-trained custom model.
//
// Implements the classifier-agnostic SignClassifier interface — swap for an LSTM
// later without changing the trainer UI or call pages.
// ─────────────────────────────────────────────────────────────────────────────

import { squaredDistance, VECTOR_LENGTH } from "@/lib/landmarks";
import type {
  ClassifierExport,
  Prediction,
  Sample,
  SignClassifier,
} from "./types";

const EXPORT_VERSION = 1;

export interface KNNOptions {
  /** Number of neighbours to consider. */
  k?: number;
  /**
   * Max euclidean distance (in normalized-landmark space) a nearest neighbour
   * may be before we treat the frame as "no match". Tuned conservatively so
   * unrelated hand shapes don't get force-classified.
   */
  maxDistance?: number;
}

export class KNNClassifier implements SignClassifier {
  readonly type = "knn";

  private samples: Sample[] = [];
  private k: number;
  private maxDistance: number;
  private createdAt = 0;
  private updatedAt = 0;

  constructor(opts: KNNOptions = {}) {
    this.k = opts.k ?? 5;
    this.maxDistance = opts.maxDistance ?? 0.6;
  }

  train(samples: Sample[]): void {
    this.samples = samples.filter((s) => s.vector?.length === VECTOR_LENGTH);
    this.touch();
  }

  addSample(sample: Sample): void {
    if (sample.vector?.length !== VECTOR_LENGTH) return;
    this.samples.push(sample);
    this.touch();
  }

  predict(vector: number[]): Prediction {
    if (vector?.length !== VECTOR_LENGTH || this.samples.length === 0) {
      return { label: null, confidence: 0 };
    }

    // Distance to every stored sample.
    const scored = this.samples.map((s) => ({
      label: s.label,
      dist: Math.sqrt(squaredDistance(vector, s.vector)),
    }));
    scored.sort((a, b) => a.dist - b.dist);

    const k = Math.min(this.k, scored.length);
    const neighbours = scored.slice(0, k);

    // Reject if even the single closest neighbour is too far away.
    if (neighbours[0].dist > this.maxDistance) {
      return { label: null, confidence: 0 };
    }

    // Distance-weighted vote (closer neighbours count more).
    const weights = new Map<string, number>();
    let totalWeight = 0;
    for (const n of neighbours) {
      const w = 1 / (n.dist * n.dist + 1e-6);
      weights.set(n.label, (weights.get(n.label) ?? 0) + w);
      totalWeight += w;
    }

    let bestLabel: string | null = null;
    let bestWeight = 0;
    for (const [label, w] of weights) {
      if (w > bestWeight) {
        bestWeight = w;
        bestLabel = label;
      }
    }

    const confidence = totalWeight > 0 ? bestWeight / totalWeight : 0;
    return { label: bestLabel, confidence };
  }

  countByLabel(): Record<string, number> {
    const counts: Record<string, number> = {};
    for (const s of this.samples) {
      counts[s.label] = (counts[s.label] ?? 0) + 1;
    }
    return counts;
  }

  size(): number {
    return this.samples.length;
  }

  getSamples(): Sample[] {
    return this.samples.map((s) => ({ ...s, vector: s.vector.slice() }));
  }

  clearLabel(label: string): void {
    this.samples = this.samples.filter((s) => s.label !== label);
    this.touch();
  }

  clearAll(): void {
    this.samples = [];
    this.touch();
  }

  trainedLabels(): string[] {
    return Object.keys(this.countByLabel());
  }

  export(): ClassifierExport {
    return {
      type: this.type,
      version: EXPORT_VERSION,
      app: "phone-with-hand",
      k: this.k,
      samples: this.getSamples(),
      createdAt: this.createdAt || this.updatedAt,
      updatedAt: this.updatedAt,
    };
  }

  import(data: ClassifierExport): void {
    if (!data || data.app !== "phone-with-hand") {
      throw new Error("Not a Phone With Hand sign model file.");
    }
    if (data.type !== this.type) {
      throw new Error(`Model type "${data.type}" is not supported by the KNN classifier.`);
    }
    if (!Array.isArray(data.samples)) {
      throw new Error("Model file has no samples array.");
    }
    if (typeof data.k === "number" && data.k > 0) this.k = data.k;
    this.samples = data.samples.filter((s) => s?.vector?.length === VECTOR_LENGTH);
    this.createdAt = data.createdAt || 0;
    this.updatedAt = data.updatedAt || 0;
  }

  private touch(): void {
    const now = Date.now();
    if (!this.createdAt) this.createdAt = now;
    this.updatedAt = now;
  }
}
