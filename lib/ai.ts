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
