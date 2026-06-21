// ─────────────────────────────────────────────────────────────────────────────
// signStore — the single source of truth for the trained sign model.
//
// Holds one app-wide SignClassifier instance, persists it to localStorage, and
// exposes a tiny pub/sub so the trainer (/train) and the call pages stay in sync
// within a session. Also provides file download / upload helpers so a model can
// survive a wipe or be shared between machines.
//
// The model is stored ENTIRELY in the browser (localStorage). Nothing is sent to
// any server — landmark vectors never leave the device.
// ─────────────────────────────────────────────────────────────────────────────

import { KNNClassifier } from "./classifier/knn";
import type { ClassifierExport, SignClassifier } from "./classifier/types";

const STORAGE_KEY = "pwh.signModel.v1";

let classifier: SignClassifier | null = null;
const listeners = new Set<() => void>();

function notify(): void {
  for (const fn of listeners) fn();
}

/** Get (lazily creating) the app-wide classifier, hydrated from localStorage. */
export function getClassifier(): SignClassifier {
  if (classifier) return classifier;
  classifier = new KNNClassifier();
  loadFromStorage(classifier);
  return classifier;
}

function loadFromStorage(c: SignClassifier): void {
  if (typeof window === "undefined") return;
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return;
    const data = JSON.parse(raw) as ClassifierExport;
    c.import(data);
  } catch (err) {
    // Corrupt / incompatible payload — start fresh rather than crash.
    console.warn("[signStore] failed to load model:", err);
  }
}

/** Persist the current model to localStorage and notify subscribers. */
export function persist(): void {
  const c = getClassifier();
  if (typeof window !== "undefined") {
    try {
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify(c.export()));
    } catch (err) {
      console.warn("[signStore] failed to persist model:", err);
    }
  }
  notify();
}

/** Re-read the model from localStorage (e.g. after another tab trained it). */
export function reloadFromStorage(): void {
  loadFromStorage(getClassifier());
  notify();
}

/** Subscribe to model changes. Returns an unsubscribe function. */
export function subscribe(fn: () => void): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

// ── Seed model (bundled file) ────────────────────────────────────────────────
// If localStorage has no model yet, load a bundled model file shipped with the
// app (public/sign-model.json). This makes a trained model PERMANENT: commit the
// JSON to the repo and it loads automatically on any browser/machine — no retrain.
const SEED_URL = "/sign-model.json";
let seedTried = false;

/** Load the bundled seed model IF the user has no localStorage model yet. */
export async function hydrateFromSeedIfEmpty(): Promise<boolean> {
  if (typeof window === "undefined") return false;
  if (window.localStorage.getItem(STORAGE_KEY)) return false; // user model wins
  if (seedTried) return false;
  seedTried = true;
  try {
    const res = await fetch(SEED_URL, { cache: "no-store" });
    if (!res.ok) return false;
    const data = (await res.json()) as ClassifierExport;
    getClassifier().import(data);
    persist(); // also copy into localStorage so it's instant next time
    return true;
  } catch (err) {
    console.warn("[signStore] no seed model available:", err);
    return false;
  }
}

// ── File import / export ─────────────────────────────────────────────────────

/** Trigger a browser download of the current model as a JSON file. */
export function downloadModel(filename = "phone-with-hand-signs.json"): void {
  if (typeof window === "undefined") return;
  const data = getClassifier().export();
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

/** Read a user-selected JSON file into the model. Throws on invalid files. */
export async function importModelFromFile(file: File): Promise<void> {
  const text = await file.text();
  const data = JSON.parse(text) as ClassifierExport;
  getClassifier().import(data);
  persist();
}