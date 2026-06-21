export type Tone = "friendly" | "polite" | "happy" | "calm" | "grateful" | "urgent";

export interface SignEntry {
  gesture: string;
  gloss:   string;
  phrase:  string;
  tone:    Tone;
}

export const SIGNS: SignEntry[] = [
  { gesture: "Open_Palm",   gloss: "HELLO",       phrase: "Hello!",                                   tone: "friendly" },
  { gesture: "Victory",     gloss: "APPOINTMENT", phrase: "I'd like to make an appointment, please.", tone: "polite"   },
  { gesture: "Thumb_Up",    gloss: "YES",         phrase: "Yes, that works for me.",                  tone: "happy"    },
  { gesture: "Thumb_Down",  gloss: "NO",          phrase: "No, that doesn't work for me.",            tone: "calm"     },
  { gesture: "Closed_Fist", gloss: "WAIT",        phrase: "Could you please wait a moment?",          tone: "polite"   },
  { gesture: "Pointing_Up", gloss: "QUESTION",    phrase: "I have a question.",                       tone: "calm"     },
  { gesture: "ILoveYou",    gloss: "THANK YOU",   phrase: "Thank you so much!",                       tone: "grateful" },
];

export const SIGN_BY_GESTURE = new Map(SIGNS.map((s) => [s.gesture, s]));
export const SIGN_BY_GLOSS   = new Map(SIGNS.map((s) => [s.gloss,   s]));
