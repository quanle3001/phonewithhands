export type Tone = "friendly" | "polite" | "happy" | "calm" | "grateful" | "urgent";

/** Where a sign comes from. */
export type SignKind =
  | "pretrained" // recognised directly by MediaPipe's gesture model — no training
  | "knn"; // recognised by the user-trained KNN classifier

/** Which vocabulary bucket a sign belongs to (used to group the trainer UI). */
export type SignGroup = "pretrained" | "demo" | "tier2" | "alphabet";

export interface SignLabel {
  /** Canonical id — also the gloss fed to the AI / TTS pipeline. */
  id: string;
  /** Human-friendly name shown in the UI. */
  display: string;
  kind: SignKind;
  group: SignGroup;
  /** Spoken English phrase + emotional tone. */
  phrase: string;
  tone: Tone;
  /** For pretrained signs: the MediaPipe gesture categoryName. */
  gesture?: string;
  /** Motion signs (e.g. J, Z) — captured as a static key-frame for now. */
  motion?: boolean;
}

// ── Pretrained (MediaPipe GestureRecognizer — no KNN training needed) ──────────
// Only I-Love-You is kept as a pretrained crowd-pleaser (zero-training, never fails).
// All other phrases — in BOTH the demo call and the testing playground — use
// real trained ASL hand signs (KNN), so YES (fist), HELLO (open palm), BYE, etc.
// are authored by the user's own training, not MediaPipe's generic gestures.
const PRETRAINED: SignLabel[] = [
  { id: "ILOVEYOU",    display: "I Love You",  kind: "pretrained", group: "pretrained", gesture: "ILoveYou",    phrase: "I love you.",           tone: "grateful" },
];

// ── KNN-trained, Group A (the demo flow) ──────────────────────────────────────
const DEMO: SignLabel[] = [
  { id: "HELLO",       display: "Hello",       kind: "knn", group: "demo", phrase: "Hello!",                                  tone: "friendly" },
  { id: "APPOINTMENT", display: "Appointment", kind: "knn", group: "demo", phrase: "I'd like to make an appointment, please.", tone: "polite"   },
  { id: "WANT",        display: "Want",        kind: "knn", group: "demo", phrase: "I would like that.",                       tone: "calm"     },
  { id: "MONDAY",      display: "Monday",      kind: "knn", group: "demo", phrase: "Monday works for me.",                     tone: "calm"     },
  { id: "YES",         display: "Yes",         kind: "knn", group: "demo", phrase: "Yes, that works for me.",                  tone: "happy"    },
  { id: "THANK_YOU",   display: "Thank You",   kind: "knn", group: "demo", phrase: "Thank you so much!",                       tone: "grateful" },
  { id: "BYE",         display: "Bye",         kind: "knn", group: "demo", phrase: "Goodbye!",                                 tone: "friendly" },
];

// ── KNN-trained, Tier 2 phrases ───────────────────────────────────────────────
const TIER2: SignLabel[] = [
  { id: "PLEASE",            display: "Please",            kind: "knn", group: "tier2", phrase: "Please.",                       tone: "polite"   },
  { id: "SORRY",             display: "Sorry",             kind: "knn", group: "tier2", phrase: "I'm sorry.",                    tone: "calm"     },
  { id: "NO",                display: "No",                kind: "knn", group: "tier2", phrase: "No, that doesn't work for me.",  tone: "calm"     },
  { id: "HELP",              display: "Help",              kind: "knn", group: "tier2", phrase: "Can you help me, please?",      tone: "polite"   },
  { id: "NAME",              display: "Name",              kind: "knn", group: "tier2", phrase: "My name is...",                 tone: "calm"     },
  { id: "NICE_TO_MEET_YOU",  display: "Nice to Meet You",  kind: "knn", group: "tier2", phrase: "Nice to meet you!",            tone: "friendly" },
  { id: "QUESTION",          display: "Question",          kind: "knn", group: "tier2", phrase: "I have a question.",            tone: "calm"     },
  { id: "GOOD",              display: "Good",              kind: "knn", group: "tier2", phrase: "That's good.",                  tone: "happy"    },
  { id: "WAIT",              display: "Wait",              kind: "knn", group: "tier2", phrase: "Could you please wait a moment?", tone: "polite" },
  { id: "REPEAT",            display: "Repeat",            kind: "knn", group: "tier2", phrase: "Could you repeat that, please?", tone: "polite" },
];

// ── KNN-trained alphabet (A–Z). J and Z are motion signs — static key-frame. ──
const ALPHABET: SignLabel[] = Array.from({ length: 26 }, (_, i) => {
  const letter = String.fromCharCode(65 + i); // A..Z
  const motion = letter === "J" || letter === "Z";
  return {
    id: letter,
    display: letter,
    kind: "knn" as const,
    group: "alphabet" as const,
    phrase: letter,
    tone: "calm" as const,
    motion,
  };
});

/** Every supported sign, in display order. */
export const SIGN_LABELS: SignLabel[] = [
  ...PRETRAINED,
  ...DEMO,
  ...TIER2,
  ...ALPHABET,
];

/** Signs the user trains with the webcam (KNN). */
export const KNN_LABELS: SignLabel[] = SIGN_LABELS.filter((s) => s.kind === "knn");

/** Signs MediaPipe recognises out of the box (no training). */
export const PRETRAINED_LABELS: SignLabel[] = PRETRAINED;

export const GROUP_TITLES: Record<SignGroup, string> = {
  pretrained: "Pretrained — no training needed",
  demo: "Demo phrases (Group A)",
  tier2: "Tier 2 phrases",
  alphabet: "Alphabet (fingerspelling)",
};

// ── Lookup maps ───────────────────────────────────────────────────────────────

/** Canonical id → SignLabel. */
export const SIGN_BY_ID = new Map(SIGN_LABELS.map((s) => [s.id, s]));

/** MediaPipe gesture categoryName → SignLabel (pretrained only). */
export const SIGN_BY_GESTURE = new Map(
  PRETRAINED.filter((s) => s.gesture).map((s) => [s.gesture as string, s])
);

/**
 * Gloss → SignLabel. Glosses are the canonical ids, so this is an alias of
 * SIGN_BY_ID — kept as a named export for the AI / TTS pipeline (lib/ai.ts).
 */
export const SIGN_BY_GLOSS = SIGN_BY_ID;
