// ─────────────────────────────────────────────────────────────────────────────
// SignClassifier — a small, classifier-agnostic interface.
//
// The trainer UI and the call pages talk ONLY to this interface. The current
// implementation is a single-frame KNN over normalized hand-landmark vectors
// (see ./knn.ts), but it can be swapped for an LSTM (or anything else) later
// WITHOUT touching the UI: just provide another class that satisfies this
// interface and a compatible export() / import() JSON shape.
// ─────────────────────────────────────────────────────────────────────────────

/** One captured training example: a normalized 63-element landmark vector. */
export interface Sample {
  label: string; // canonical sign id, e.g. "HELLO" or "A"
  vector: number[]; // normalized landmark feature (length 63)
  t: number; // capture timestamp (ms epoch)
}

/** A single-frame prediction result. */
export interface Prediction {
  label: string | null; // null == no confident match
  confidence: number; // 0..1
}

/** Serializable model payload — what gets written to localStorage / a file. */
export interface ClassifierExport {
  type: string; // classifier kind, e.g. "knn"
  version: number; // schema version for forward compat
  app: "phone-with-hand";
  k?: number; // KNN-specific hyperparameter (optional)
  samples: Sample[];
  createdAt: number;
  updatedAt: number;
}

export interface SignClassifier {
  /** Identifier for the classifier kind (e.g. "knn"). */
  readonly type: string;

  /** Replace all training data with the given samples. */
  train(samples: Sample[]): void;

  /** Append a single training sample (live capture). */
  addSample(sample: Sample): void;

  /** Classify one normalized landmark vector. */
  predict(vector: number[]): Prediction;

  /** Number of stored samples per label. */
  countByLabel(): Record<string, number>;

  /** Total stored samples. */
  size(): number;

  /** All stored samples (copy). */
  getSamples(): Sample[];

  /** Remove every sample for a label. */
  clearLabel(label: string): void;

  /** Remove every sample for every label. */
  clearAll(): void;

  /** Labels that currently have at least one sample. */
  trainedLabels(): string[];

  /** Serialize to a plain JSON-safe object. */
  export(): ClassifierExport;

  /** Load from a previously exported object. Throws on incompatible payloads. */
  import(data: ClassifierExport): void;
}
