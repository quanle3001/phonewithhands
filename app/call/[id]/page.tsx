"use client";

import type { CSSProperties, ReactNode } from "react";
import { use, useEffect, useRef, useState } from "react";

import { useRouter } from "next/navigation";
import { speak } from "@/lib/tts";
import { signsToSpeech, comprehendSpeech, type Comprehension } from "@/lib/ai";
import { SIGN_BY_ID } from "@/data/signs";

import Link from "next/link";
import dynamic from "next/dynamic";
import { motion, AnimatePresence, useReducedMotion } from "framer-motion";
import { Phone, PhoneOff, Mic, MicOff, Video } from "lucide-react";
import CameraSignDetector from "@/components/CameraSignDetector";
import CallErrorBoundary from "@/components/CallErrorBoundary";
import GlossPanel from "@/components/GlossPanel";
import { getContactById, type Contact } from "@/data/contacts";
import { logCall } from "@/lib/recents";

import { startRingtone, stopRingtone } from "@/lib/ringtone";

// Phase 3 Stage A — lazy-load the 3D upper-body avatar (ssr:false) so the heavy
// three.js bundle never blocks the initial call screen. Renders an idle avatar
// (or a placeholder if /avatar.glb is absent) above the comprehension text.
const SigningAvatar = dynamic(() => import("@/components/SigningAvatar"), {
  ssr: false,
  loading: () => (
    <div
      className="w-full rounded-[10px]"
      style={{ aspectRatio: "4 / 3", background: "linear-gradient(180deg,#F2F4F7,#E8ECF1)", border: "1px solid rgba(60,60,67,0.10)" }}
    />
  ),
});

type Phase = "ringing" | "connected" | "ended";

// ── Apple light-mode tokens ────────────────────────────────────────────────────

const T = {
  bg:          "#F5F5F7",
  surface:     "#FFFFFF",
  label:       "#1D1D1F",
  secondLabel: "rgba(60,60,67,0.60)",
  tertLabel:   "rgba(60,60,67,0.30)",
  separator:   "rgba(60,60,67,0.12)",
  blue:        "#007AFF",
  green:       "#34C759",
  red:         "#FF3B30",
  orange:      "#FF9500",
  purple:      "#AF52DE",
} as const;

const SPRING = { type: "spring" as const, stiffness: 260, damping: 30, mass: 0.9 };

// Phase 1.7 — auto-speak the buffered sentence after the user pauses this long.
const AUTO_SPEAK_MS = 5000;

// Shared vibrancy card for floating bars
const VIBRANCY: CSSProperties = {
  background:           "rgba(255,255,255,0.82)",
  backdropFilter:       "blur(24px) saturate(180%)",
  WebkitBackdropFilter: "blur(24px) saturate(180%)",
  border:               "1px solid rgba(0,0,0,0.08)",
  boxShadow:            "0 4px 24px rgba(0,0,0,0.10)",
};

// White surface card
const CARD: CSSProperties = {
  background:   T.surface,
  borderRadius: 18,
  overflow:     "hidden",
  boxShadow:    "0 4px 24px rgba(0,0,0,0.06)",
};

// ── Phase 0 placeholder content ────────────────────────────────────────────────

const MOCK = {
  officeLine:   "Please bring your insurance card and photo ID to your appointment.",
  meaning:      "Bring your insurance card and a photo ID when you come.",
  tone:         "important instruction" as const,
  keyInfo:      ["insurance card", "photo ID", "Tuesday 2:00 PM"],
  quickPhrases: ["Got it!", "Please repeat", "One moment", "Thank you", "No insurance"],
};

// ── Dr. Smith scripted conversation ─────────────────────────────────────────────
// A 6-turn interactive script. In SCRIPTED mode the conversation advances when the
// user actually performs `advanceSigns` (EXACT trained labels); the THEY SPEAK
// panel renders each turn's comprehension (meaning/tone/keyInfo/gloss). The same
// array also drives the operator teleprompter cue card in BOTH modes.
interface ScenarioTurn {
  caller:       string;   // line the operator reads into the phone
  advanceSigns: string[]; // EXACT trained labels the user must perform to advance
  userSigns:    string[]; // display strings for the cue chips
  meaning:      string;   // THEY SPEAK: plain restatement
  tone:         string;   // THEY SPEAK: tone word (→ toneChip)
  keyInfo:      string[]; // THEY SPEAK: key-info chips
  gloss:        string[]; // THEY SPEAK: ASL gloss chips
}
const SCENARIO: ScenarioTurn[] = [
  {
    caller: "Hello! Thanks for calling Dr. Smith's office.",
    advanceSigns: ["HELLO"],
    userSigns:    ["HELLO"],
    meaning: "Hello! Thanks for calling Dr. Smith's office.",
    tone: "Friendly",
    keyInfo: ["Dr. Smith's office"],
    gloss: ["HELLO", "THANK-YOU", "CALL", "OFFICE"],
  },
  {
    caller: "How can I help you today?",
    advanceSigns: ["WANT", "APPOINTMENT"],
    userSigns:    ["WANT", "APPOINTMENT"],
    meaning: "How can I help you today?",
    tone: "Friendly",
    keyInfo: [],
    gloss: ["HOW", "HELP", "YOU", "TODAY"],
  },
  {
    caller: "Sure — would Monday work for you?",
    advanceSigns: ["YES", "MONDAY"],
    userSigns:    ["YES", "MONDAY"],
    meaning: "Sure — would Monday work for you?",
    tone: "Reassuring",
    keyInfo: ["Monday"],
    gloss: ["MONDAY", "WORK", "YOU", "QUESTION"],
  },
  {
    caller: "Great. Can I have your name?",
    advanceSigns: ["NAME", "R", "I", "C", "O"],
    userSigns:    ["NAME", "R", "I", "C", "O"],
    meaning: "Great — can I have your name? (fingerspell it)",
    tone: "Neutral",
    keyInfo: ["Name needed"],
    gloss: ["YOUR", "NAME", "WHAT"],
  },
  {
    caller: "Perfect, you're all booked. Anything else?",
    advanceSigns: ["NO", "THANK_YOU"],
    userSigns:    ["NO", "THANK_YOU"],
    meaning: "Perfect — you're all booked. Anything else?",
    tone: "Friendly",
    keyInfo: ["Appointment booked", "Monday"],
    gloss: ["FINISH", "BOOK", "ELSE", "QUESTION"],
  },
  {
    caller: "You're welcome. Take care — goodbye!",
    advanceSigns: ["BYE"],
    userSigns:    ["BYE"],
    meaning: "You're welcome. Take care — goodbye!",
    tone: "Friendly",
    keyInfo: [],
    gloss: ["WELCOME", "TAKE-CARE", "BYE"],
  },
];

// Fuzzy keyword-overlap match between a caller transcript and the expected script
// line (Dr. Smith LIVE "talk" gate). Normalize → drop stopwords → ratio of expected
// content words found in the transcript. Robust to ASR noise / paraphrase.
const FUZZY_STOPWORDS = new Set([
  "a", "an", "the", "is", "are", "am", "was", "were", "be", "to", "of", "in",
  "on", "at", "for", "and", "or", "but", "so", "if", "i", "you", "we", "they",
  "he", "she", "it", "me", "us", "them", "my", "your", "our", "their", "do",
  "does", "did", "will", "would", "can", "could", "should", "may", "have", "has",
  "had", "with", "as", "by", "from", "this", "that", "how", "what", "ok", "okay",
]);
function fuzzyContentWords(s: string): string[] {
  return s
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .split(/\s+/)
    .filter((w) => w.length > 0 && !FUZZY_STOPWORDS.has(w));
}
function fuzzyLineMatch(transcript: string, expected: string): number {
  const exp = fuzzyContentWords(expected);
  if (exp.length === 0) return 1; // nothing meaningful to match → treat as satisfied
  const got = new Set(fuzzyContentWords(transcript));
  let hit = 0;
  for (const w of exp) if (got.has(w)) hit++;
  return hit / exp.length;
}
const TALK_MATCH_THRESHOLD = 0.5;

type ToneKey = "important instruction" | "greeting" | "question" | "confirmation" | "urgent";

const TONE: Record<ToneKey, { color: string; icon: string; label: string }> = {
  "important instruction": { color: T.purple, icon: "⚠️",  label: "Important Instruction" },
  greeting:                { color: T.blue,   icon: "👋",  label: "Greeting" },
  question:                { color: T.orange, icon: "❓",  label: "Question" },
  confirmation:            { color: T.blue,   icon: "✅",  label: "Confirmation" },
  urgent:                  { color: T.red,    icon: "🚨",  label: "Urgent" },
};

// Phase 2 — map a free-form ASI:1 tone word to a chip (color + icon + label).
// Reuses the same chip styling as the scripted TONE map above.
function toneChip(tone?: string): { color: string; icon: string; label: string } {
  const t = (tone ?? "").trim().toLowerCase();
  const map: Record<string, { color: string; icon: string }> = {
    friendly:   { color: T.blue,   icon: "👋" },
    happy:      { color: T.green,  icon: "😊" },
    reassuring: { color: T.green,  icon: "🤝" },
    urgent:     { color: T.red,    icon: "🚨" },
    serious:    { color: T.purple, icon: "⚠️" },
    formal:     { color: T.purple, icon: "📋" },
    apologetic: { color: T.orange, icon: "🙏" },
    neutral:    { color: "#8E8E93", icon: "💬" },
  };
  const hit = map[t] ?? { color: "#8E8E93", icon: "💬" };
  const label = t ? t.charAt(0).toUpperCase() + t.slice(1) : "Neutral";
  return { color: hit.color, icon: hit.icon, label };
}

// ── Helpers ────────────────────────────────────────────────────────────────────

function fmt(s: number) {
  return (
    String(Math.floor(s / 60)).padStart(2, "0") + ":" +
    String(s % 60).padStart(2, "0")
  );
}

function Sep() {
  return <div style={{ height: 1, background: T.separator, flexShrink: 0 }} />;
}

function SectionLabel({ children }: { children: string }) {
  return (
    <p
      className="text-[11px] font-semibold uppercase tracking-widest select-none"
      style={{ color: T.tertLabel }}
    >
      {children}
    </p>
  );
}

// ── Control button ─────────────────────────────────────────────────────────────

interface CtrlBtnProps {
  children: ReactNode;
  onClick?: () => void;
  label: string;
  bg: string;
  fg?: string;
  size?: "sm" | "lg";
}

function CtrlBtn({ children, onClick, label, bg, fg = "#FFFFFF", size = "sm" }: CtrlBtnProps) {
  const dim = size === "lg" ? 52 : 42;
  return (
    <motion.button
      whileHover={{ filter: "brightness(0.92)" }}
      whileTap={{ scale: 0.94 }}
      onClick={onClick}
      aria-label={label}
      title={label}
      className="flex items-center justify-center rounded-full focus:outline-none
        focus-visible:ring-2 focus-visible:ring-[#007AFF] focus-visible:ring-offset-2
        focus-visible:ring-offset-white"
      style={{ width: dim, height: dim, background: bg, color: fg }}
    >
      {children}
    </motion.button>
  );
}

// ── Avatar circle ──────────────────────────────────────────────────────────────

function ContactAvatar({ contact, size }: { contact: Contact; size: number }) {
  const isEmoji = (contact.avatar.codePointAt(0) ?? 0) > 127;
  return (
    <div
      className="rounded-full flex items-center justify-center select-none"
      style={{
        width:      size,
        height:     size,
        background: isEmoji ? "rgba(0,0,0,0.06)" : contact.color + "22",
        border:     `2px solid ${contact.color}44`,
      }}
    >
      {isEmoji ? (
        <span style={{ fontSize: size * 0.44, lineHeight: 1 }}>{contact.avatar}</span>
      ) : (
        <span style={{ fontSize: size * 0.32, fontWeight: 700, color: contact.color }}>
          {contact.avatar}
        </span>
      )}
    </div>
  );
}

// ── Page ───────────────────────────────────────────────────────────────────────

function CallPageInner({ params }: { params: Promise<{ id: string }> }) {
  const { id }    = use(params);
  const router    = useRouter();
  const rm        = useReducedMotion();
  const contact   = getContactById(id);

  const [phase, setPhase]     = useState<Phase>("ringing");
  const [seconds, setSeconds] = useState(0);
  const [muted, setMuted]     = useState(false);
  const [dots, setDots]       = useState(1);

  // ── Phase 1: sign → emotional speech ──────────────────────────────────────
  const [spoken, setSpoken]   = useState<string | null>(null);
  const [recent, setRecent]   = useState<string[]>([]);
  const holdRef       = useRef<{ name: string; timer: ReturnType<typeof setTimeout> } | null>(null);
  const spokenLockRef = useRef<string | null>(null);

  // ── Phase 1.7: accumulate confirmed signs, auto-speak them as one sentence ──
  const [gloss, setGloss]         = useState<{ id: string; display: string }[]>([]);
  const [autoPending, setAutoPending] = useState(false);
  const glossRef          = useRef<{ id: string; display: string }[]>([]);
  const autoSpeakTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const isSpeakingRef     = useRef(false);
  glossRef.current = gloss; // keep ref in sync for timer / async reads

  function cancelAutoSpeak() {
    if (autoSpeakTimerRef.current) { clearTimeout(autoSpeakTimerRef.current); autoSpeakTimerRef.current = null; }
    setAutoPending(false);
  }

  // Speak the whole buffer as one natural sentence, then clear it.
  async function speakSentence() {
    cancelAutoSpeak();
    if (isSpeakingRef.current) return;       // guard against overlap
    const buffer = glossRef.current;
    if (buffer.length === 0) return;
    isSpeakingRef.current = true;
    setGloss([]);                            // clear immediately so new signs start fresh
    try {
      const r = await signsToSpeech(buffer.map((x) => x.id));
      setSpoken(r.phrase);
      setRecent((prev) => [r.phrase, ...prev].slice(0, 4));
      speak(r.phrase, { tone: r.tone });
    } finally {
      isSpeakingRef.current = false;
    }
  }

  // Debounced auto-speak: (re)start a timer each time a sign is appended; fire
  // when the user pauses (and we're not already speaking).
  function scheduleAutoSpeak() {
    if (autoSpeakTimerRef.current) clearTimeout(autoSpeakTimerRef.current);
    setAutoPending(true);
    autoSpeakTimerRef.current = setTimeout(() => {
      autoSpeakTimerRef.current = null;
      setAutoPending(false);
      if (!isSpeakingRef.current && glossRef.current.length > 0) speakSentence();
    }, AUTO_SPEAK_MS);
  }

  // Clean up the pending auto-speak timer on unmount.
  useEffect(() => () => { if (autoSpeakTimerRef.current) clearTimeout(autoSpeakTimerRef.current); }, []);

  // ── Phase 2: caller speech → comprehension (live mic, freeplay contacts) ────
  // Scripted contacts (mode "scenario", e.g. Dr. Smith) keep the demo dialogue;
  // freeplay contacts (e.g. "Testing Call") use the live mic + ASI:1 pipeline.
  // Dr. Smith ("scenario") can be toggled between SCRIPTED (default) and LIVE.
  // forceLive flips it to the same live-mic comprehension flow as the freeplay
  // Testing Call, so every existing liveMode-gated path lights up.
  const scenarioMode = contact?.mode === "scenario";
  const [forceLive, setForceLive] = useState(false);
  const liveMode = contact?.mode === "freeplay" || forceLive;
  const [cueIndex, setCueIndex]       = useState(0);
  const [matched, setMatched]         = useState<string[]>([]); // signs satisfied this turn
  const [talkGate, setTalkGate]       = useState(false);        // caller line matched (Live)
  const [scriptComplete, setScriptComplete] = useState(false);
  const [listening, setListening]     = useState(false);
  const [transcript, setTranscript]   = useState("");
  const [comp, setComp]               = useState<Comprehension | null>(null);
  const [compLoading, setCompLoading] = useState(false);
  const [sttSupported, setSttSupported] = useState(true);
  const [micNotice, setMicNotice]     = useState<string | null>(null);

  // Refs mirror advance state so the sign-confirm callback + async comprehension
  // read fresh values without stale closures / render batching.
  const cueIndexRef = useRef(0);          cueIndexRef.current = cueIndex;
  const matchedRef  = useRef<string[]>([]); matchedRef.current = matched;
  const talkGateRef = useRef(false);      talkGateRef.current = talkGate;
  const scriptedActiveRef = useRef(false);
  scriptedActiveRef.current = scenarioMode && !forceLive;
  const liveActiveRef = useRef(false);
  liveActiveRef.current = scenarioMode && forceLive;

  // Advance to the next turn (sign-driven, dual-gate, OR manual "next ▸").
  // Resets BOTH gates for the new turn.
  function advanceTurn() {
    const next = Math.min(cueIndexRef.current + 1, SCENARIO.length - 1);
    cueIndexRef.current = next;
    matchedRef.current = [];
    talkGateRef.current = false;
    setCueIndex(next);
    setMatched([]);
    setTalkGate(false);
  }

  // Advance, or mark complete if this is the last turn (keep chips matched).
  function advanceOrComplete() {
    if (cueIndexRef.current >= SCENARIO.length - 1) {
      const turn = SCENARIO[cueIndexRef.current];
      if (turn) { matchedRef.current = turn.advanceSigns.slice(); setMatched(turn.advanceSigns.slice()); }
      setScriptComplete(true);
    } else {
      advanceTurn();
    }
  }

  // LIVE dual-gate: advance only when BOTH the sign gate AND the talk gate are
  // satisfied for the current turn.
  function maybeAdvanceLive() {
    if (!liveActiveRef.current) return;
    const turn = SCENARIO[cueIndexRef.current];
    if (!turn) return;
    const signDone = turn.advanceSigns.every((s) => matchedRef.current.includes(s));
    if (signDone && talkGateRef.current) advanceOrComplete();
  }

  // Called for every confirmed recognized sign. Active for Dr. Smith in BOTH modes:
  // it marks expected signs satisfied (order-tolerant, per-sign green chips). In
  // SCRIPTED it advances immediately when the turn's signs are done (one gate); in
  // LIVE it only marks the SIGN gate and defers to the dual-gate check.
  function onRecognizedSign(label: string) {
    if (!scenarioMode) return;
    const turn = SCENARIO[cueIndexRef.current];
    if (!turn || !turn.advanceSigns.includes(label)) return;
    if (matchedRef.current.includes(label)) return;
    const nextMatched = [...matchedRef.current, label];
    matchedRef.current = nextMatched;
    setMatched(nextMatched);
    const signDone = turn.advanceSigns.every((s) => nextMatched.includes(s));
    if (!signDone) return;
    if (scriptedActiveRef.current) advanceOrComplete(); // scripted = sign-only gate
    else maybeAdvanceLive();                            // live = needs talk gate too
  }

  // LIVE talk gate: fuzzy-match a caller transcript to the current turn's script
  // line. Marks the talk gate and attempts a dual-gate advance.
  function onCallerLine(text: string) {
    if (!liveActiveRef.current) return;
    const turn = SCENARIO[cueIndexRef.current];
    if (!turn) return;
    if (fuzzyLineMatch(text, turn.caller) >= TALK_MATCH_THRESHOLD) {
      talkGateRef.current = true;
      setTalkGate(true);
      maybeAdvanceLive();
    }
  }

  // Switch the Dr. Smith demo between scripted/live, resetting for a clean run.
  function setDemoMode(live: boolean) {
    setForceLive(live);
    setCueIndex(0);     cueIndexRef.current = 0;
    setMatched([]);     matchedRef.current = [];
    setTalkGate(false); talkGateRef.current = false;
    setScriptComplete(false);
    setTranscript("");
    setComp(null);
    setCompLoading(false);
    setMicNotice(null);
    if (!live) stopListening(); // leaving live → make sure the mic is off
  }
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const recognitionRef = useRef<any>(null);
  const listeningRef   = useRef(false);
  listeningRef.current = listening;

  // Detect Web Speech API support once on mount.
  useEffect(() => {
    if (typeof window === "undefined") return;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const SR = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
    if (!SR) setSttSupported(false);
  }, []);

  // Run a transcript through the comprehension pipeline (shared by mic + test box).
  async function runComprehension(text: string) {
    const t = text.trim();
    if (!t) return;
    setTranscript(t);
    setComp(null);
    setCompLoading(true);
    try {
      const c = await comprehendSpeech(t);
      setComp(c);
      // Dr. Smith LIVE: the caller's spoken line is GATE 2 (talk). Fuzzy-match it
      // to the current turn; advance only when BOTH gates are satisfied. (The panel
      // above already filled from the real speech — that's unchanged.)
      onCallerLine(t);
    } finally {
      setCompLoading(false);
    }
  }

  function startListening() {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const SR = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
    if (!SR) { setSttSupported(false); return; }
    try {
      const rec = new SR();
      rec.lang = "en-US";
      rec.continuous = true;
      rec.interimResults = true;
      let finalBuf = "";
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      rec.onresult = (e: any) => {
        let interim = "";
        let final = "";
        for (let i = e.resultIndex; i < e.results.length; i++) {
          const r = e.results[i];
          if (r.isFinal) final += r[0].transcript;
          else interim += r[0].transcript;
        }
        if (interim) setTranscript((finalBuf + " " + interim).trim());
        if (final) {
          finalBuf = (finalBuf + " " + final).trim();
          setTranscript(finalBuf);
          runComprehension(final.trim());
        }
      };
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      rec.onerror = (e: any) => {
        const err = e?.error;
        if (err === "not-allowed" || err === "service-not-allowed") {
          setMicNotice("Microphone access denied. Allow it in the browser, or type below to simulate the caller.");
          setListening(false);
        } else if (err === "no-speech" || err === "aborted") {
          // benign — ignore
        } else {
          setMicNotice("Speech recognition error: " + (err ?? "unknown"));
        }
      };
      rec.onend = () => {
        // continuous recognition can still stop itself — restart if still on.
        if (listeningRef.current) { try { rec.start(); } catch { /* already started */ } }
      };
      recognitionRef.current = rec;
      setMicNotice(null);
      setListening(true);
      rec.start();
    } catch (err) {
      setMicNotice("Could not start microphone: " + String(err));
      setListening(false);
    }
  }

  function stopListening() {
    setListening(false);
    const rec = recognitionRef.current;
    if (rec) {
      try { rec.onend = null; rec.stop(); } catch { /* noop */ }
      recognitionRef.current = null;
    }
  }

  function toggleListening() {
    if (listeningRef.current) stopListening();
    else startListening();
  }

  // Stop recognition on unmount.
  useEffect(() => () => {
    const rec = recognitionRef.current;
    if (rec) { try { rec.onend = null; rec.stop(); } catch { /* noop */ } }
  }, []);

  function handleGesture(g: { name: string; score: number } | null) {
    // hand lowered / low confidence → cancel any pending hold and re-arm
    if (!g || g.score < 0.6) {
      if (holdRef.current) { clearTimeout(holdRef.current.timer); holdRef.current = null; }
      spokenLockRef.current = null;
      return;
    }
    if (holdRef.current?.name === g.name) return;            // already holding this gesture
    if (holdRef.current) { clearTimeout(holdRef.current.timer); holdRef.current = null; }
    if (spokenLockRef.current === g.name) return;            // don't refire until hand drops
    // g.name is a canonical sign id (KNN id or a mapped pretrained gesture).
    const entry = SIGN_BY_ID.get(g.name);
    if (!entry) return;
    holdRef.current = {
      name: g.name,
      timer: setTimeout(() => {
        holdRef.current = null;
        spokenLockRef.current = g.name;
        // Phase 1.7 — append the confirmed sign to the sentence buffer instead of
        // speaking it immediately, then (re)start the debounce so the whole buffer
        // auto-speaks once the user pauses. spokenLockRef ensures one hold = one
        // add (re-armed when the hand drops). Light feedback only — no speak() here.
        setGloss((b) => [...b, { id: entry.id, display: entry.display }]);
        setSpoken(`+ ${entry.display}`);
        scheduleAutoSpeak();
        // Dr. Smith: watch recognized labels to drive cue advancement (SIGN gate in
        // both modes). No-op for freeplay; never interferes with auto-speak above.
        onRecognizedSign(entry.id);
      }, 1000),
    };
  }

  // Redirect if contact not found or not callable
  useEffect(() => {
    if (!contact || !contact.callable) router.replace("/");
  }, [contact, router]);

  // Ringtone + auto-connect after 3 s
  useEffect(() => {
    if (phase !== "ringing") return;
    startRingtone();
    const tid = setTimeout(() => { stopRingtone(); setPhase("connected"); }, 3000);
    return () => { clearTimeout(tid); stopRingtone(); };
  }, [phase]);

  // Animated ellipsis
  useEffect(() => {
    if (phase !== "ringing") return;
    const id = setInterval(() => setDots((d) => (d % 3) + 1), 500);
    return () => clearInterval(id);
  }, [phase]);

  // In-call timer
  useEffect(() => {
    if (phase !== "connected") return;
    const id = setInterval(() => setSeconds((n) => n + 1), 1000);
    return () => clearInterval(id);
  }, [phase]);

  function handleEndCall() {
    if (contact) {
      logCall({ contactId: contact.id, contactName: contact.name, timestamp: Date.now(), duration: seconds, outcome: "completed" });
    }
    setPhase("ended");
  }

  function handleCancelCall() {
    stopRingtone();
    if (contact) {
      logCall({ contactId: contact.id, contactName: contact.name, timestamp: Date.now(), duration: 0, outcome: "cancelled" });
    }
    router.push("/");
  }

  if (!contact) return null;

  const callingStr = "Calling" + ".".repeat(dots);
  const toneConf   = TONE[MOCK.tone];
  const dist       = rm ? 0 : 10;

  // THEY SPEAK panel data — live comprehension (freeplay/live) or the current
  // scripted turn (interactive Dr. Smith). The scripted turn advances as the user
  // performs the expected signs.
  const scriptedTurn   = (scenarioMode && !forceLive) ? SCENARIO[cueIndex] : null;
  const displayCaption = liveMode ? transcript          : (scriptedTurn?.caller  ?? "");
  const displayMeaning = liveMode ? (comp?.meaning ?? "") : (scriptedTurn?.meaning ?? "");
  const displayKeyInfo = liveMode ? (comp?.keyInfo ?? []) : (scriptedTurn?.keyInfo ?? []);
  const displayGloss   = liveMode ? (comp?.gloss ?? [])   : (scriptedTurn?.gloss   ?? []);
  const displayTone    = liveMode ? toneChip(comp?.tone)  : toneChip(scriptedTurn?.tone);

  // ── Floating control bar (shared) ────────────────────────────────────────────
  const RingingControls = (
    <div className="flex-shrink-0 flex justify-center pb-10 pt-4">
      <div
        className="flex items-end gap-10 px-10 py-5"
        style={{ ...VIBRANCY, borderRadius: 28 }}
      >
        {[
          { label: muted ? "Unmute" : "Mute", icon: muted ? <MicOff size={20} /> : <Mic size={20} />, bg: "rgba(0,0,0,0.10)", fg: T.label, onClick: () => setMuted((m) => !m) },
          { label: "End Call", icon: <PhoneOff size={24} />, bg: T.red, fg: "#FFF", size: "lg" as const, onClick: handleCancelCall },
          { label: "Camera", icon: <Video size={20} />, bg: "rgba(0,0,0,0.10)", fg: T.label },
        ].map(({ label, icon, bg, fg, size, onClick }) => (
          <div key={label} className="flex flex-col items-center gap-2">
            <CtrlBtn label={label} bg={bg} fg={fg} size={size} onClick={onClick}>
              {icon}
            </CtrlBtn>
            <span className="text-[11px] font-medium" style={{ color: T.secondLabel }}>
              {label}
            </span>
          </div>
        ))}
      </div>
    </div>
  );

  const ConnectedControls = (
    <div className="flex-shrink-0 flex justify-center pb-5 pt-3">
      <div
        className="flex items-center gap-4 px-7 py-3.5"
        style={{ ...VIBRANCY, borderRadius: 28 }}
      >
        {liveMode ? (
          <CtrlBtn
            label={listening ? "Stop listening" : "Listen to caller"}
            bg={listening ? T.green : "rgba(0,0,0,0.08)"}
            fg={listening ? "#FFF" : T.label}
            onClick={toggleListening}
          >
            {listening ? <Mic size={18} /> : <MicOff size={18} />}
          </CtrlBtn>
        ) : (
          <CtrlBtn
            label={muted ? "Unmute" : "Mute"}
            bg="rgba(0,0,0,0.08)"
            fg={T.label}
            onClick={() => setMuted((m) => !m)}
          >
            {muted ? <MicOff size={18} /> : <Mic size={18} />}
          </CtrlBtn>
        )}
        <CtrlBtn label="Active Call" bg={T.green} fg="#FFF" size="lg">
          <Phone size={22} />
        </CtrlBtn>
        <CtrlBtn label="End Call" bg={T.red} fg="#FFF" size="lg" onClick={handleEndCall}>
          <PhoneOff size={22} />
        </CtrlBtn>
        <CtrlBtn label="Camera" bg="rgba(0,0,0,0.08)" fg={T.label}>
          <Video size={18} />
        </CtrlBtn>
      </div>
    </div>
  );

  return (
    <div
      className="h-screen overflow-hidden flex flex-col relative"
      style={{ background: T.bg }}
    >
      {/* ── Phase content ─────────────────────────────────────────────────── */}
      <AnimatePresence mode="wait">

        {/* ── RINGING ───────────────────────────────────────────────────── */}
        {phase === "ringing" && (
          <motion.div
            key="ringing"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0, scale: rm ? 1 : 0.98 }}
            transition={{ duration: 0.22 }}
            className="absolute inset-0 flex flex-col"
            style={{ background: T.surface }}
          >
            {/* Back link */}
            <div className="flex-shrink-0 pt-5 px-5">
              <button
                onClick={handleCancelCall}
                className="text-[15px] font-medium focus:outline-none
                  focus-visible:ring-2 focus-visible:ring-[#007AFF] rounded-[6px]"
                style={{ color: T.blue }}
                aria-label="Cancel call and go back to contacts"
              >
                ← Contacts
              </button>
            </div>

            {/* Centered avatar + calling text */}
            <div className="flex-1 flex flex-col items-center justify-center gap-6">
              {/* Pulsing concentric rings */}
              <div
                className="relative flex items-center justify-center"
                style={{ width: 220, height: 220 }}
              >
                {!rm && [0, 1, 2].map((i) => (
                  <motion.div
                    key={i}
                    className="absolute rounded-full"
                    style={{
                      width:  96 + (i + 1) * 40,
                      height: 96 + (i + 1) * 40,
                      border: `1.5px solid ${contact.color}`,
                    }}
                    animate={{ opacity: [0.45, 0], scale: [0.80, 1.14] }}
                    transition={{ duration: 2.2, repeat: Infinity, delay: i * 0.72, ease: "easeOut" }}
                  />
                ))}
                <div className="relative z-10">
                  <ContactAvatar contact={contact} size={96} />
                </div>
              </div>

              <div className="text-center space-y-1.5">
                <p
                  className="font-bold"
                  style={{ fontSize: 28, letterSpacing: "-0.02em", color: T.label }}
                >
                  {contact.name}
                </p>
                <p style={{ fontSize: 17, color: T.secondLabel }}>{contact.subtitle}</p>
                <p style={{ fontSize: 15, color: T.tertLabel }}>{callingStr}</p>
              </div>
            </div>

            {RingingControls}
          </motion.div>
        )}

        {/* ── CONNECTED ─────────────────────────────────────────────────── */}
        {phase !== "ringing" && (
          <motion.div
            key="connected"
            initial={{ opacity: 0, scale: rm ? 1 : 0.99 }}
            animate={{ opacity: 1, scale: 1 }}
            transition={{ duration: 0.28 }}
            className="absolute inset-0 flex flex-col"
            style={{ background: T.bg }}
          >
            {/* ── Floating top bar ──────────────────────────────────────── */}
            <div className="flex-shrink-0 px-5 pt-5 pb-2 flex items-center justify-between">
              <Link
                href="/"
                className="text-[15px] font-medium focus:outline-none
                  focus-visible:ring-2 focus-visible:ring-[#007AFF] rounded-[6px] px-1"
                style={{ color: T.blue }}
              >
                ← Contacts
              </Link>

              {/* Status pill */}
              <div
                className="flex items-center gap-1.5 px-3.5 py-1.5 rounded-full"
                style={VIBRANCY}
              >
                {/* Pulsing connected dot */}
                <span className="relative flex h-[7px] w-[7px] flex-shrink-0">
                  <span
                    className="absolute inline-flex h-full w-full rounded-full animate-ping opacity-60"
                    style={{ background: T.green }}
                  />
                  <span
                    className="relative inline-flex h-[7px] w-[7px] rounded-full"
                    style={{ background: T.green }}
                  />
                </span>
                <span className="text-[13px]" style={{ color: T.secondLabel }}>
                  {contact.name}
                </span>
                <span className="text-[13px]" style={{ color: T.tertLabel }}>·</span>
                <span className="text-[13px] font-semibold" style={{ color: T.green }}>
                  Connected
                </span>
                <span className="text-[13px]" style={{ color: T.tertLabel }}>·</span>
                <span
                  className="text-[13px] font-semibold tabular-nums"
                  style={{ color: T.label }}
                >
                  {fmt(seconds)}
                </span>
              </div>
            </div>

            {/* ── Three-column in-call layout ───────────────────────────── */}
            <div className="flex flex-1 min-h-0 gap-3 px-4 pb-1">

              {/* LEFT — You Sign (equal width; camera fills leftover height, no scroll) */}
              <motion.div
                initial={{ opacity: 0, y: dist }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ ...SPRING, delay: 0.06 }}
                className="flex-1 min-w-0 min-h-0 flex flex-col gap-3"
              >
                {/* Camera card — grows to fill the leftover vertical space */}
                <div className="flex-1 min-h-0 flex flex-col" style={CARD}>
                  <div
                    className="flex-shrink-0 flex items-center justify-between px-4 pt-3 pb-2.5"
                    style={{ borderBottom: `1px solid ${T.separator}` }}
                  >
                    <div>
                      <SectionLabel>You Sign</SectionLabel>
                      <p
                        className="text-[17px] font-semibold mt-0.5"
                        style={{ color: T.label }}
                      >
                        Your signing
                      </p>
                    </div>
                    <span className="text-lg opacity-40" aria-hidden>🖐</span>
                  </div>
                  <div className="flex-1 min-h-0 p-3 flex flex-col gap-2">
                    <div className="flex-1 min-h-0">
                      <CameraSignDetector onGesture={handleGesture} />
                    </div>
                    {/* Spoken caption — fixed-height reserved box so the camera never jumps */}
                    <div
                      className="flex-shrink-0 h-[46px] flex items-center gap-2 px-3 rounded-[10px]"
                      style={
                        spoken
                          ? { background: "rgba(52,199,89,0.10)", border: "1px solid rgba(52,199,89,0.22)" }
                          : { background: "rgba(0,0,0,0.03)", border: "1px solid rgba(0,0,0,0.06)" }
                      }
                    >
                      {spoken ? (
                        <>
                          <span className="text-[13px] flex-shrink-0" aria-hidden>🔊</span>
                          <span className="text-[13px] font-medium truncate min-w-0" style={{ color: T.label }}>
                            {spoken}
                          </span>
                        </>
                      ) : (
                        <span className="text-[12px]" style={{ color: T.tertLabel }}>
                          Your spoken words will appear here…
                        </span>
                      )}
                    </div>
                    {recent.length > 1 && (
                      <div className="flex-shrink-0 flex flex-wrap gap-1 max-h-[24px] overflow-hidden">
                        {recent.slice(1).map((r, i) => (
                          <span key={i} className="text-[11px] px-2 py-[3px] rounded-full"
                            style={{ background: "rgba(0,0,0,0.05)", color: T.secondLabel }}>
                            {r}
                          </span>
                        ))}
                      </div>
                    )}
                  </div>
                </div>

                {/* Sentence controls (Phase 1.7) — combine buffered signs into one utterance */}
                <motion.div
                  initial={{ opacity: 0, y: dist }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ ...SPRING, delay: 0.10 }}
                  className="flex-shrink-0 p-3"
                  style={CARD}
                >
                  <div className="flex items-center justify-between mb-2">
                    <SectionLabel>Sentence · auto-speaks on pause</SectionLabel>
                    {gloss.length > 0 && (
                      <span className="text-[11px] tabular-nums" style={{ color: T.tertLabel }}>
                        {gloss.length} sign{gloss.length === 1 ? "" : "s"}
                      </span>
                    )}
                  </div>
                  <div className="flex items-center gap-1.5">
                    <motion.button
                      whileHover={gloss.length ? { filter: "brightness(0.94)" } : undefined}
                      whileTap={gloss.length ? { scale: 0.96 } : undefined}
                      onClick={speakSentence}
                      disabled={gloss.length === 0}
                      aria-label="Speak the combined sentence"
                      className="flex-1 px-3 py-[7px] rounded-[8px] text-[13px] font-semibold text-white
                        focus:outline-none focus-visible:ring-2 focus-visible:ring-[#007AFF]"
                      style={{ background: T.blue, opacity: gloss.length ? 1 : 0.4 }}
                    >
                      🔊 Speak sentence
                    </motion.button>
                    <motion.button
                      whileTap={gloss.length ? { scale: 0.96 } : undefined}
                      onClick={() => setGloss((b) => b.slice(0, -1))}
                      disabled={gloss.length === 0}
                      aria-label="Undo last sign"
                      className="px-3 py-[7px] rounded-[8px] text-[13px] font-medium
                        focus:outline-none focus-visible:ring-2 focus-visible:ring-[#007AFF]"
                      style={{ background: "rgba(0,0,0,0.05)", color: T.label, opacity: gloss.length ? 1 : 0.4 }}
                    >
                      ⌫ Undo
                    </motion.button>
                    <motion.button
                      whileTap={gloss.length ? { scale: 0.96 } : undefined}
                      onClick={() => { setGloss([]); cancelAutoSpeak(); }}
                      disabled={gloss.length === 0}
                      aria-label="Clear the sentence buffer"
                      className="px-3 py-[7px] rounded-[8px] text-[13px] font-medium
                        focus:outline-none focus-visible:ring-2 focus-visible:ring-[#007AFF]"
                      style={{ background: "rgba(0,0,0,0.05)", color: T.label, opacity: gloss.length ? 1 : 0.4 }}
                    >
                      Clear
                    </motion.button>
                  </div>

                  {/* Auto-speak countdown cue — restarts each time a sign is added */}
                  {autoPending && gloss.length > 0 && (
                    <div className="mt-2.5">
                      <div className="flex items-center gap-1.5 mb-1">
                        <span
                          className="w-[6px] h-[6px] rounded-full animate-pulse"
                          style={{ background: T.blue }}
                        />
                        <span className="text-[11px]" style={{ color: T.secondLabel }}>
                          Speaking in a moment…
                        </span>
                      </div>
                      <div
                        className="h-[3px] rounded-full overflow-hidden"
                        style={{ background: "rgba(0,0,0,0.06)" }}
                      >
                        <motion.div
                          key={gloss.length}
                          initial={{ width: "0%" }}
                          animate={{ width: "100%" }}
                          transition={{ duration: AUTO_SPEAK_MS / 1000, ease: "linear" }}
                          className="h-full"
                          style={{ background: T.blue }}
                        />
                      </div>
                    </div>
                  )}
                </motion.div>

                {/* Quick phrases */}
                <motion.div
                  initial={{ opacity: 0, y: dist }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ ...SPRING, delay: 0.12 }}
                  className="flex-shrink-0 p-3"
                  style={CARD}
                >
                  <SectionLabel>Quick Phrases</SectionLabel>
                  <div className="flex flex-wrap gap-1.5 mt-2">
                    {MOCK.quickPhrases.map((phrase) => (
                      <motion.button
                        key={phrase}
                        whileHover={{ filter: "brightness(0.94)" }}
                        whileTap={{ scale: 0.96 }}
                        onClick={() => { setSpoken(phrase); setRecent((r) => [phrase, ...r].slice(0, 4)); speak(phrase, { tone: "friendly" }); }}
                        aria-label={`Say: ${phrase}`}
                        className="px-3 py-[5px] rounded-[8px] text-[13px] font-medium
                          focus:outline-none focus-visible:ring-2 focus-visible:ring-[#007AFF]"
                        style={{
                          background: "rgba(0,122,255,0.08)",
                          border:     "1px solid rgba(0,122,255,0.16)",
                          color:      T.blue,
                        }}
                      >
                        {phrase}
                      </motion.button>
                    ))}
                  </div>
                </motion.div>
              </motion.div>

              {/* CENTER — ASL Gloss */}
              <motion.div
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                transition={{ ...SPRING, delay: 0.10 }}
                className="w-[148px] flex-shrink-0 flex flex-col justify-center items-center"
              >
                <GlossPanel signs={gloss.map((x) => x.display)} />
              </motion.div>

              {/* RIGHT — They Speak */}
              <motion.div
                initial={{ opacity: 0, y: dist }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ ...SPRING, delay: 0.06 }}
                className="flex-1 min-w-0"
              >
                <div className="h-full flex flex-col" style={CARD}>
                  {/* Panel header */}
                  <div
                    className="flex-shrink-0 flex items-center justify-between px-4 pt-3 pb-2.5"
                    style={{ borderBottom: `1px solid ${T.separator}` }}
                  >
                    <div>
                      <SectionLabel>They Speak</SectionLabel>
                      <p className="text-[17px] font-semibold mt-0.5" style={{ color: T.label }}>
                        {contact.name}
                      </p>
                    </div>
                  <div className="flex items-center gap-2">
                    {/* Scripted ◐ Live demo toggle — Dr. Smith (scenario) only */}
                    {scenarioMode && (
                      <div
                        className="flex rounded-[8px] p-[2px] gap-[2px]"
                        style={{ background: "rgba(116,116,128,0.12)" }}
                        role="group"
                        aria-label="Demo mode"
                      >
                        {([["Scripted", false], ["Live", true]] as const).map(([label, val]) => (
                          <button
                            key={label}
                            onClick={() => setDemoMode(val)}
                            aria-pressed={forceLive === val}
                            className="px-2.5 py-[3px] rounded-[6px] text-[11px] font-semibold
                              transition-all focus:outline-none focus-visible:ring-2 focus-visible:ring-[#007AFF]"
                            style={{
                              background: forceLive === val ? "#FFFFFF" : "transparent",
                              color:      forceLive === val ? T.label : T.secondLabel,
                              boxShadow:  forceLive === val ? "0 1px 4px rgba(0,0,0,0.12)" : "none",
                            }}
                          >
                            {label}
                          </button>
                        ))}
                      </div>
                    )}
                    {/* LIVE badge */}
                    <motion.div
                      animate={{ opacity: rm ? 1 : [1, 0.45, 1] }}
                      transition={{ duration: 2, repeat: Infinity, ease: "easeInOut" }}
                      className="flex items-center gap-1.5 rounded-full px-2.5 py-1
                        text-[11px] font-semibold"
                      style={{
                        background: "rgba(255,59,48,0.10)",
                        border:     "1px solid rgba(255,59,48,0.25)",
                        color:      T.red,
                      }}
                    >
                      <span className="w-1.5 h-1.5 rounded-full" style={{ background: T.red }} />
                      {liveMode && listening ? "LISTENING" : "LIVE"}
                    </motion.div>
                  </div>
                  </div>

                  {/* Scrollable body */}
                  <div className="flex-1 overflow-y-auto flex flex-col gap-3.5 p-4">

                    {/* Teleprompter / conversation cue — Dr. Smith in BOTH modes.
                        Operator reads the caller line; in Scripted mode the chips
                        turn green as the user performs each expected sign, and the
                        conversation auto-advances when the turn is complete. */}
                    {scenarioMode && SCENARIO[cueIndex] && (
                      <div
                        className="flex-shrink-0 rounded-[12px] p-3 space-y-2"
                        style={{ background: "rgba(0,122,255,0.05)", border: "1px dashed rgba(0,122,255,0.30)" }}
                      >
                        <div className="flex items-center justify-between">
                          <span className="text-[10px] font-semibold uppercase tracking-widest" style={{ color: T.blue }}>
                            {forceLive ? "Live" : "Conversation"} · {cueIndex + 1}/{SCENARIO.length}
                            {scriptComplete && (
                              <span style={{ color: T.green }}>&nbsp;· ✓ complete</span>
                            )}
                          </span>
                          <button
                            onClick={advanceTurn}
                            disabled={cueIndex >= SCENARIO.length - 1}
                            className="text-[11px] font-semibold focus:outline-none
                              focus-visible:ring-2 focus-visible:ring-[#007AFF] rounded-[6px] px-1
                              disabled:opacity-30"
                            style={{ color: T.blue }}
                            aria-label="Advance to the next turn"
                          >
                            next ▸
                          </button>
                        </div>
                        <div>
                          <p className="text-[10px] font-semibold uppercase tracking-wide" style={{ color: T.tertLabel }}>
                            Caller reads aloud
                          </p>
                          <p className="text-[13px] font-medium" style={{ color: T.label }}>
                            &ldquo;{SCENARIO[cueIndex].caller}&rdquo;
                          </p>
                        </div>
                        <div>
                          <p className="text-[10px] font-semibold uppercase tracking-wide" style={{ color: T.tertLabel }}>
                            You sign — green = done
                          </p>
                          <div className="flex flex-wrap gap-1 mt-0.5">
                            {SCENARIO[cueIndex].advanceSigns.map((s, i) => {
                              const isMatched = matched.includes(s);
                              return (
                                <span
                                  key={s + i}
                                  className="inline-flex items-center gap-1 rounded-[6px] px-2 py-[2px] text-[11px] font-semibold"
                                  style={isMatched
                                    ? { background: "rgba(52,199,89,0.14)", border: "1px solid rgba(52,199,89,0.35)", color: T.green, letterSpacing: "0.04em" }
                                    : { background: "rgba(0,122,255,0.10)", border: "1px solid rgba(0,122,255,0.18)", color: T.blue, letterSpacing: "0.04em" }}
                                >
                                  {isMatched && <span aria-hidden>✓</span>}{s}
                                </span>
                              );
                            })}
                          </div>
                        </div>

                        {/* LIVE dual-gate checklist — both must be ✓ to advance */}
                        {forceLive && (() => {
                          const signDone = SCENARIO[cueIndex].advanceSigns.every((s) => matched.includes(s));
                          const Row = (ok: boolean, icon: string, label: string) => (
                            <div
                              className="flex items-center gap-1.5 text-[11px] font-semibold"
                              style={{ color: ok ? T.green : T.tertLabel }}
                            >
                              <span aria-hidden>{ok ? "✓" : "○"}</span>
                              <span>{icon} {label}</span>
                            </div>
                          );
                          return (
                            <div
                              className="flex flex-col gap-1 pt-1 mt-0.5"
                              style={{ borderTop: `1px solid ${T.separator}` }}
                            >
                              {Row(talkGate, "📞", "Caller line spoken")}
                              {Row(signDone, "🤟", "Signs performed")}
                            </div>
                          );
                        })()}

                        {scriptComplete && (
                          <p className="text-[11px] font-semibold" style={{ color: T.green }}>
                            ✓ Conversation complete
                          </p>
                        )}
                      </div>
                    )}

                    {/* Live-mode mic notices */}
                    {liveMode && !sttSupported && (
                      <div
                        className="flex-shrink-0 rounded-[10px] px-3 py-2 text-[12px] leading-relaxed"
                        style={{ background: "rgba(255,149,0,0.10)", border: "1px solid rgba(255,149,0,0.25)", color: T.label }}
                      >
                        🎤 Live speech recognition isn&apos;t supported in this browser (try Chrome). Type below to simulate the caller.
                      </div>
                    )}
                    {liveMode && sttSupported && micNotice && (
                      <div
                        className="flex-shrink-0 rounded-[10px] px-3 py-2 text-[12px] leading-relaxed"
                        style={{ background: "rgba(255,59,48,0.08)", border: "1px solid rgba(255,59,48,0.22)", color: T.label }}
                      >
                        {micNotice}
                      </div>
                    )}

                    {/* Live Caption = transcript */}
                    <motion.div
                      initial={{ opacity: 0, y: rm ? 0 : 6 }}
                      animate={{ opacity: 1, y: 0 }}
                      transition={{ ...SPRING, delay: 0.18 }}
                      className="space-y-2"
                    >
                      <div className="flex items-center justify-between">
                        <SectionLabel>Live Caption</SectionLabel>
                        {liveMode && (
                          <span
                            className="inline-flex items-center gap-1 text-[11px] font-semibold"
                            style={{ color: listening ? T.green : T.tertLabel }}
                          >
                            <span className="w-1.5 h-1.5 rounded-full" style={{ background: listening ? T.green : T.tertLabel }} />
                            {listening ? "Listening" : "Mic off"}
                          </span>
                        )}
                      </div>
                      <p
                        className="font-semibold leading-snug"
                        style={{ fontSize: 22, color: displayCaption ? T.label : T.tertLabel, letterSpacing: "-0.02em" }}
                      >
                        {displayCaption
                          ? `“${displayCaption}”`
                          : (liveMode ? "Waiting for the caller to speak…" : "")}
                      </p>
                    </motion.div>

                    <Sep />

                    {/* Phase 3 Stage A — avatar (left) + comprehension text (right),
                        side-by-side; wraps to stacked when the panel is narrow. The
                        text always renders as the fallback / source of truth. */}
                    <div className="flex flex-wrap items-start gap-3">
                      {/* LEFT — bounded idle 3D avatar (prominent; never overflows) */}
                      <div className="flex-shrink-0" style={{ flex: "0 0 340px", maxWidth: "100%" }}>
                        <SigningAvatar />
                      </div>

                      {/* RIGHT — meaning / tone / key info / gloss (compact, no-scroll) */}
                      <div className="flex-1 min-w-[180px] flex flex-col gap-2.5">

                    {/* Meaning + tone chip */}
                    <motion.div
                      initial={{ opacity: 0, y: rm ? 0 : 6 }}
                      animate={{ opacity: 1, y: 0 }}
                      transition={{ ...SPRING, delay: 0.26 }}
                      className="rounded-[14px] p-3 flex flex-col gap-2"
                      style={{
                        background: "rgba(0,0,0,0.03)",
                        border:     `1px solid ${T.separator}`,
                      }}
                    >
                      <SectionLabel>Meaning</SectionLabel>
                      {liveMode && compLoading ? (
                        <p className="font-semibold" style={{ fontSize: 17, color: T.secondLabel, lineHeight: "1.4" }}>
                          Understanding the caller&hellip;
                        </p>
                      ) : displayMeaning ? (
                        <>
                          <p
                            className="font-semibold"
                            style={{ fontSize: 17, color: T.label, lineHeight: "1.4" }}
                          >
                            {displayMeaning}
                          </p>
                          <motion.span
                            key={displayTone.label}
                            initial={{ scale: rm ? 1 : 0.84, opacity: 0 }}
                            animate={{ scale: 1, opacity: 1 }}
                            transition={{ ...SPRING, delay: rm ? 0 : 0.1 }}
                            className="self-start inline-flex items-center gap-1.5 rounded-full
                              px-3 py-1 text-[12px] font-semibold"
                            style={{
                              background: `${displayTone.color}18`,
                              border:     `1px solid ${displayTone.color}35`,
                              color:      displayTone.color,
                            }}
                          >
                            {displayTone.icon}&nbsp;{displayTone.label}
                          </motion.span>
                        </>
                      ) : (
                        <p style={{ fontSize: 15, color: T.tertLabel }}>
                          {liveMode ? "The meaning will appear here once the caller speaks." : ""}
                        </p>
                      )}
                    </motion.div>

                    {/* Key Info chips */}
                    {displayKeyInfo.length > 0 && (
                      <motion.div
                        initial={{ opacity: 0 }}
                        animate={{ opacity: 1 }}
                        transition={{ ...SPRING, delay: 0.32 }}
                        className="space-y-2"
                      >
                        <SectionLabel>Key Info</SectionLabel>
                        <div className="flex flex-wrap gap-1.5">
                          {displayKeyInfo.map((item, i) => (
                            <motion.span
                              key={item + i}
                              initial={{ opacity: 0, scale: rm ? 1 : 0.88 }}
                              animate={{ opacity: 1, scale: 1 }}
                              transition={{ ...SPRING, delay: rm ? 0 : 0.06 * i }}
                              className="inline-flex items-center gap-1 rounded-full
                                px-2.5 py-0.5 text-[11px]"
                              style={{
                                background: "rgba(0,0,0,0.05)",
                                border:     "1px solid rgba(0,0,0,0.08)",
                                color:      T.secondLabel,
                              }}
                            >
                              🔑 {item}
                            </motion.span>
                          ))}
                        </div>
                      </motion.div>
                    )}

                    {/* ASL Gloss text tokens (comprehension only — Phase 2) */}
                    {displayGloss.length > 0 && (
                      <motion.div
                        initial={{ opacity: 0 }}
                        animate={{ opacity: 1 }}
                        transition={{ ...SPRING, delay: 0.36 }}
                        className="space-y-2"
                      >
                        <SectionLabel>ASL Gloss</SectionLabel>
                        <div className="flex flex-wrap gap-1.5">
                          {displayGloss.map((g, i) => (
                            <motion.span
                              key={g + i}
                              initial={{ opacity: 0, scale: rm ? 1 : 0.88 }}
                              animate={{ opacity: 1, scale: 1 }}
                              transition={{ ...SPRING, delay: rm ? 0 : 0.04 * i }}
                              className="inline-flex items-center rounded-[8px] px-2.5 py-[3px]
                                text-[11px] font-semibold"
                              style={{
                                background:    "rgba(0,122,255,0.08)",
                                border:        "1px solid rgba(0,122,255,0.16)",
                                color:         T.blue,
                                letterSpacing: "0.04em",
                              }}
                            >
                              {g}
                            </motion.span>
                          ))}
                        </div>
                      </motion.div>
                    )}

                      </div>{/* end RIGHT text column */}
                    </div>{/* end avatar + text row */}

                    <div className="flex-1" />

                    {/* Simulate caller speech — dev/test aid (live mode only) */}
                    {liveMode && (
                      <input
                        type="text"
                        placeholder="Simulate caller speech…  (press Enter)"
                        onKeyDown={(e) => {
                          if (e.key === "Enter") {
                            const el = e.target as HTMLInputElement;
                            const v = el.value;
                            if (v.trim()) { runComprehension(v); el.value = ""; }
                          }
                        }}
                        aria-label="Simulate caller speech"
                        className="flex-shrink-0 w-full text-[13px] rounded-[10px] px-3 py-2 outline-none
                          focus:ring-2 focus:ring-[#007AFF]"
                        style={{ background: "rgba(0,0,0,0.04)", border: `1px solid ${T.separator}`, color: T.label }}
                      />
                    )}
                  </div>
                </div>
              </motion.div>
            </div>

            {ConnectedControls}
          </motion.div>
        )}
      </AnimatePresence>

      {/* ── Call-ended overlay ─────────────────────────────────────────────── */}
      <AnimatePresence>
        {phase === "ended" && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.20 }}
            className="absolute inset-0 z-30 flex items-center justify-center"
            style={{
              background:           "rgba(0,0,0,0.45)",
              backdropFilter:       "blur(16px) saturate(150%)",
              WebkitBackdropFilter: "blur(16px) saturate(150%)",
            }}
          >
            <motion.div
              initial={{ scale: rm ? 1 : 0.92, opacity: 0, y: rm ? 0 : 12 }}
              animate={{ scale: 1, opacity: 1, y: 0 }}
              exit={{ scale: rm ? 1 : 0.95, opacity: 0 }}
              transition={SPRING}
              className="flex flex-col items-center gap-4 px-12 py-10 text-center"
              style={{
                background:   T.surface,
                borderRadius: 24,
                boxShadow:    "0 20px 60px rgba(0,0,0,0.20)",
                border:       "1px solid rgba(0,0,0,0.06)",
                minWidth:     280,
              }}
            >
              <div style={{ fontSize: 48, lineHeight: 1 }}>📵</div>
              <p
                className="font-bold"
                style={{ fontSize: 24, letterSpacing: "-0.02em", color: T.label }}
              >
                Call Ended
              </p>
              <p style={{ fontSize: 15, color: T.secondLabel }}>
                {contact.name}&nbsp;·&nbsp;{fmt(seconds)}
              </p>
              <button
                onClick={() => router.push("/")}
                aria-label="Return to contacts"
                className="mt-1 font-semibold text-white transition-opacity
                  hover:opacity-88 focus:outline-none
                  focus-visible:ring-2 focus-visible:ring-[#007AFF]"
                style={{
                  background:   T.blue,
                  borderRadius: 12,
                  padding:      "10px 28px",
                  fontSize:     15,
                  fontWeight:   600,
                }}
              >
                Back to Contacts
              </button>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

// Wrap the call screen in an error boundary so a render-time throw shows a
// readable panel instead of a blank/white page (Safari is strict about this).
export default function CallPage(props: { params: Promise<{ id: string }> }) {
  return (
    <CallErrorBoundary>
      <CallPageInner {...props} />
    </CallErrorBoundary>
  );
}