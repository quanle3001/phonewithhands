import { SIGN_BY_GLOSS, type Tone } from "@/data/signs";

export interface SpeechResult {
  phrase: string;
  tone:   Tone;
  source: "rule" | "ai";
}

// Deterministic, offline fallback — never throws, demo never breaks.
function ruleBased(glosses: string[]): SpeechResult {
  if (glosses.length === 1) {
    const entry = SIGN_BY_GLOSS.get(glosses[0]);
    if (entry) return { phrase: entry.phrase, tone: entry.tone, source: "rule" };
  }
  if (glosses.length > 1) {
    const entries = glosses.map((g) => SIGN_BY_GLOSS.get(g)).filter(Boolean);
    if (entries.length > 0) {
      return { phrase: entries.map((e) => e!.phrase).join(" "), tone: "polite", source: "rule" };
    }
  }
  return { phrase: glosses.join(" "), tone: "calm", source: "rule" };
}

// Gloss → natural spoken sentence + emotional tone.
// Tries ASI:1 (via /api/ai) first; falls back to rule-based on any failure.
export async function signsToSpeech(glosses: string[], context?: string): Promise<SpeechResult> {
  if (!glosses || glosses.length === 0) {
    return { phrase: "", tone: "calm", source: "rule" };
  }

  try {
    const resp = await fetch("/api/ai", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ glosses, context }),
    });
    if (resp.ok) {
      const data = await resp.json();
      if (!data.fallback && typeof data.phrase === "string" && data.phrase.trim()) {
        return { phrase: data.phrase.trim(), tone: data.tone as Tone, source: "ai" };
      }
    }
  } catch {
    // network/route error → fall through to rule-based
  }

  return ruleBased(glosses);
}

// ─────────────────────────────────────────────────────────────────────────────
// Phase 2 — caller speech → comprehension (the opposite direction).
// ─────────────────────────────────────────────────────────────────────────────

export interface Comprehension {
  meaning: string;   // plain restatement of what the caller said
  tone:    string;   // e.g. "Friendly", "Urgent", "Neutral", "Reassuring"
  keyInfo: string[]; // facts / instructions / times / items to remember
  gloss:   string[]; // UPPERCASE ASL-style gloss tokens
  source:  "rule" | "ai";
}

// Stopwords stripped when building a naive gloss in the offline fallback.
const STOPWORDS = new Set([
  "a", "an", "the", "is", "are", "am", "was", "were", "be", "been", "being",
  "to", "of", "in", "on", "at", "for", "and", "or", "but", "so", "if", "then",
  "i", "you", "we", "they", "he", "she", "it", "me", "us", "them", "him", "her",
  "my", "your", "our", "their", "his", "its", "this", "that", "these", "those",
  "do", "does", "did", "will", "would", "can", "could", "should", "may", "might",
  "have", "has", "had", "with", "as", "by", "from", "up", "out", "about", "just",
  "please", "okay", "ok", "um", "uh", "well", "like", "yeah",
]);

// Deterministic, offline comprehension — never throws so the demo survives.
function ruleComprehend(transcript: string): Comprehension {
  const text = transcript.trim();
  const words = text.split(/\s+/);

  // keyInfo: times, days/dates, numbers, and a few important nouns.
  const found = new Set<string>();
  const timeRe = /\b\d{1,2}(:\d{2})?\s?(a\.?m\.?|p\.?m\.?)\b/gi;
  const dayRe = /\b(monday|tuesday|wednesday|thursday|friday|saturday|sunday|today|tomorrow|tonight|noon|midnight|morning|afternoon|evening)\b/gi;
  const numRe = /\$?\b\d+([.,]\d+)?\b/g;
  const KEYWORDS = [
    "insurance", "card", "id", "appointment", "prescription", "address", "phone",
    "email", "name", "payment", "copay", "refill", "doctor", "office", "reschedule",
    "cancel", "confirm", "fee", "deposit", "reservation", "table", "room",
  ];
  for (const m of text.match(timeRe) ?? []) found.add(m.trim());
  for (const m of text.match(dayRe) ?? []) found.add(m.charAt(0).toUpperCase() + m.slice(1).toLowerCase());
  for (const m of text.match(numRe) ?? []) found.add(m.trim());
  for (const w of words) {
    const lw = w.toLowerCase().replace(/[^a-z]/g, "");
    if (KEYWORDS.includes(lw)) found.add(lw.charAt(0).toUpperCase() + lw.slice(1));
  }
  const keyInfo = Array.from(found).slice(0, 8);

  // gloss: content words, uppercased, stopwords removed.
  const gloss = words
    .map((w) => w.toLowerCase().replace(/[^a-z0-9'-]/g, ""))
    .filter((w) => w.length > 0 && !STOPWORDS.has(w))
    .map((w) => w.toUpperCase())
    .slice(0, 16);

  return { meaning: text, tone: "Neutral", keyInfo, gloss, source: "rule" };
}

// Caller transcript → structured comprehension.
// Tries ASI:1 (via /api/comprehend) first; falls back to rule-based on any failure.
export async function comprehendSpeech(transcript: string): Promise<Comprehension> {
  const text = (transcript ?? "").trim();
  if (!text) {
    return { meaning: "", tone: "Neutral", keyInfo: [], gloss: [], source: "rule" };
  }

  try {
    const resp = await fetch("/api/comprehend", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ transcript: text }),
    });
    if (resp.ok) {
      const data = await resp.json();
      if (!data.fallback && typeof data.meaning === "string" && data.meaning.trim()) {
        return {
          meaning: data.meaning.trim(),
          tone: typeof data.tone === "string" && data.tone.trim() ? data.tone.trim() : "Neutral",
          keyInfo: Array.isArray(data.keyInfo) ? data.keyInfo.filter((x: unknown): x is string => typeof x === "string") : [],
          gloss: Array.isArray(data.gloss) ? data.gloss.filter((x: unknown): x is string => typeof x === "string") : [],
          source: "ai",
        };
      }
    }
  } catch {
    // network / route error → fall through to rule-based
  }

  return ruleComprehend(text);
}
