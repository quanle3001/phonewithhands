"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import dynamic from "next/dynamic";

import CameraSignDetector from "@/components/CameraSignDetector";
import { speak } from "@/lib/tts";
import { signsToSpeech, comprehendSpeech, type Comprehension } from "@/lib/ai";
import { SIGN_BY_ID } from "@/data/signs";
import { getHandset } from "@/lib/handset";

// ─────────────────────────────────────────────────────────────────────────────
// /call/live-phone — the MAC translator. Bridges to the iPhone handset:
//   • Sign→Speech (left): webcam → sign buffer → auto-speak. The finalized
//     sentence is spoken LOCALLY (lib/tts) AND sent to the iPhone speaker
//     (handset.speak) so the caller hears it.
//   • Speech→Sign (right): the bridge's transcript → comprehendSpeech →
//     meaning/tone/keyInfo/gloss → SigningAvatar signs the gloss.
// Reuses the existing components/libs; additive, no telephony.
// ─────────────────────────────────────────────────────────────────────────────

const SigningAvatar = dynamic(() => import("@/components/SigningAvatar"), {
  ssr: false,
  loading: () => (
    <div className="w-full rounded-[10px]" style={{ aspectRatio: "4 / 3", background: "linear-gradient(180deg,#F2F4F7,#E8ECF1)", border: "1px solid rgba(60,60,67,0.10)" }} />
  ),
});

const T = {
  bg: "#F5F5F7", surface: "#FFFFFF", label: "#1D1D1F",
  secondLabel: "rgba(60,60,67,0.60)", tertLabel: "rgba(60,60,67,0.30)",
  separator: "rgba(60,60,67,0.12)", blue: "#007AFF", green: "#34C759", red: "#FF3B30",
  orange: "#FF9500", purple: "#AF52DE",
} as const;

const AUTO_SPEAK_MS = 1400;

function toneChip(tone?: string): { color: string; icon: string; label: string } {
  const t = (tone ?? "").trim().toLowerCase();
  const map: Record<string, { color: string; icon: string }> = {
    friendly: { color: T.blue, icon: "👋" }, happy: { color: T.green, icon: "😊" },
    reassuring: { color: T.green, icon: "🤝" }, urgent: { color: T.red, icon: "🚨" },
    serious: { color: T.purple, icon: "⚠️" }, formal: { color: T.purple, icon: "📋" },
    apologetic: { color: T.orange, icon: "🙏" }, neutral: { color: "#8E8E93", icon: "💬" },
  };
  const hit = map[t] ?? { color: "#8E8E93", icon: "💬" };
  return { color: hit.color, icon: hit.icon, label: t ? t.charAt(0).toUpperCase() + t.slice(1) : "Neutral" };
}

function SectionLabel({ children }: { children: string }) {
  return <p className="text-[11px] font-semibold uppercase tracking-widest select-none" style={{ color: T.tertLabel }}>{children}</p>;
}

export default function LivePhonePage() {
  const [peer, setPeer] = useState(false);
  const [spoken, setSpoken] = useState<string | null>(null);
  const [recent, setRecent] = useState<string[]>([]);
  const [transcript, setTranscript] = useState("");
  const [comp, setComp] = useState<Comprehension | null>(null);
  const [compLoading, setCompLoading] = useState(false);

  // Sign buffer + auto-speak (mirrors app/call/[id]/page.tsx).
  const [gloss, setGloss] = useState<{ id: string; display: string }[]>([]);
  const glossRef = useRef<{ id: string; display: string }[]>([]);
  glossRef.current = gloss;
  const holdRef = useRef<{ name: string; timer: ReturnType<typeof setTimeout> } | null>(null);
  const spokenLockRef = useRef<string | null>(null);
  const autoTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const speakingRef = useRef(false);

  // ── Bridge wiring ────────────────────────────────────────────────────────────
  useEffect(() => {
    const h = getHandset();
    h.onPeer((role, connected) => { if (role === "phone") setPeer(connected); });
    h.onTranscript((text) => { runComprehension(text); });
    h.connect("mac");
    return () => {
      if (autoTimer.current) clearTimeout(autoTimer.current);
      if (holdRef.current) clearTimeout(holdRef.current.timer);
      try { h.close(); } catch { /* noop */ }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function runComprehension(text: string) {
    const t = text.trim();
    if (!t) return;
    setTranscript(t);
    setComp(null);
    setCompLoading(true);
    try {
      const c = await comprehendSpeech(t);
      setComp(c);
    } catch (e) {
      console.warn("[live-phone] comprehension failed:", e);
    } finally {
      setCompLoading(false);
    }
  }

  // ── Sign → Speech ─────────────────────────────────────────────────────────────
  async function speakSentence() {
    if (autoTimer.current) { clearTimeout(autoTimer.current); autoTimer.current = null; }
    if (speakingRef.current) return;
    const buffer = glossRef.current;
    if (buffer.length === 0) return;
    speakingRef.current = true;
    setGloss([]);
    try {
      const r = await signsToSpeech(buffer.map((x) => x.id));
      setSpoken(r.phrase);
      setRecent((prev) => [r.phrase, ...prev].slice(0, 4));
      speak(r.phrase, { tone: r.tone });        // local Mac speaker
      try { getHandset().speak(r.phrase); } catch (e) { console.warn("[live-phone] handset.speak failed:", e); } // iPhone speaker
    } finally {
      speakingRef.current = false;
    }
  }
  function scheduleAutoSpeak() {
    if (autoTimer.current) clearTimeout(autoTimer.current);
    autoTimer.current = setTimeout(() => {
      autoTimer.current = null;
      if (!speakingRef.current && glossRef.current.length > 0) speakSentence();
    }, AUTO_SPEAK_MS);
  }
  function handleGesture(g: { name: string; score: number } | null) {
    if (!g || g.score < 0.6) {
      if (holdRef.current) { clearTimeout(holdRef.current.timer); holdRef.current = null; }
      spokenLockRef.current = null;
      return;
    }
    if (holdRef.current?.name === g.name) return;
    if (holdRef.current) { clearTimeout(holdRef.current.timer); holdRef.current = null; }
    if (spokenLockRef.current === g.name) return;
    const entry = SIGN_BY_ID.get(g.name);
    if (!entry) return;
    holdRef.current = {
      name: g.name,
      timer: setTimeout(() => {
        holdRef.current = null;
        spokenLockRef.current = g.name;
        setGloss((b) => [...b, { id: entry.id, display: entry.display }]);
        setSpoken(`+ ${entry.display}`);
        scheduleAutoSpeak();
      }, 1000),
    };
  }

  const tone = toneChip(comp?.tone);
  const displayGloss = comp?.gloss ?? [];

  const CARD = { background: T.surface, borderRadius: 18, boxShadow: "0 4px 24px rgba(0,0,0,0.06)" } as const;

  return (
    <div className="h-screen overflow-hidden flex flex-col" style={{ background: T.bg }}>
      {/* Top bar */}
      <div className="flex-shrink-0 px-5 pt-5 pb-2 flex items-center justify-between">
        <Link href="/" className="text-[15px] font-medium" style={{ color: T.blue }}>← Home</Link>
        <div className="flex items-center gap-1.5 px-3.5 py-1.5 rounded-full" style={{ background: T.surface, boxShadow: "0 2px 10px rgba(0,0,0,0.06)" }}>
          <span className="w-[7px] h-[7px] rounded-full" style={{ background: peer ? T.green : T.orange }} />
          <span className="text-[13px] font-semibold" style={{ color: peer ? T.green : T.orange }}>
            Handset: {peer ? "connected" : "waiting"}
          </span>
        </div>
      </div>

      {/* Two panels */}
      <div className="flex flex-1 min-h-0 gap-3 px-4 pb-4">
        {/* LEFT — You Sign */}
        <div className="flex-1 min-w-0 flex flex-col gap-3">
          <div className="flex-1 min-h-0 flex flex-col" style={CARD}>
            <div className="flex-shrink-0 px-4 pt-3 pb-2.5" style={{ borderBottom: `1px solid ${T.separator}` }}>
              <SectionLabel>You Sign → Caller hears</SectionLabel>
              <p className="text-[17px] font-semibold mt-0.5" style={{ color: T.label }}>Your signing</p>
            </div>
            <div className="flex-1 min-h-0 p-3 flex flex-col gap-2">
              <div className="flex-1 min-h-0">
                <CameraSignDetector onGesture={handleGesture} />
              </div>
              {spoken && (
                <div className="flex-shrink-0 flex items-center gap-2 px-3 py-2 rounded-[10px]" style={{ background: "rgba(52,199,89,0.10)", border: "1px solid rgba(52,199,89,0.22)" }}>
                  <span className="text-[13px]">🔊</span>
                  <span className="text-[13px] font-medium" style={{ color: T.label }}>{spoken}</span>
                </div>
              )}
              {gloss.length > 0 && (
                <div className="flex-shrink-0 flex flex-wrap gap-1">
                  {gloss.map((x, i) => (
                    <span key={x.id + i} className="text-[11px] px-2 py-[3px] rounded-full" style={{ background: "rgba(0,122,255,0.08)", color: T.blue }}>{x.display}</span>
                  ))}
                </div>
              )}
              {recent.length > 1 && (
                <div className="flex-shrink-0 flex flex-wrap gap-1">
                  {recent.slice(1).map((r, i) => (
                    <span key={i} className="text-[11px] px-2 py-[3px] rounded-full" style={{ background: "rgba(0,0,0,0.05)", color: T.secondLabel }}>{r}</span>
                  ))}
                </div>
              )}
            </div>
          </div>
        </div>

        {/* RIGHT — They Speak */}
        <div className="flex-1 min-w-0">
          <div className="h-full flex flex-col" style={CARD}>
            <div className="flex-shrink-0 px-4 pt-3 pb-2.5 flex items-center justify-between" style={{ borderBottom: `1px solid ${T.separator}` }}>
              <div>
                <SectionLabel>Caller speaks → You see</SectionLabel>
                <p className="text-[17px] font-semibold mt-0.5" style={{ color: T.label }}>Caller (iPhone)</p>
              </div>
              <span className="flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[11px] font-semibold" style={{ background: "rgba(255,59,48,0.10)", border: "1px solid rgba(255,59,48,0.25)", color: T.red }}>
                <span className="w-1.5 h-1.5 rounded-full" style={{ background: T.red }} /> LIVE
              </span>
            </div>

            <div className="flex-1 overflow-y-auto flex flex-col gap-3.5 p-4">
              {/* Avatar */}
              <div className="flex-shrink-0">
                <SigningAvatar gloss={displayGloss} />
              </div>

              {/* Live caption (transcript) */}
              <div className="space-y-2">
                <SectionLabel>Live Caption</SectionLabel>
                <p className="font-semibold leading-snug" style={{ fontSize: 22, color: transcript ? T.label : T.tertLabel, letterSpacing: "-0.02em" }}>
                  {transcript ? `“${transcript}”` : "Waiting for the caller to speak…"}
                </p>
              </div>

              <div style={{ height: 1, background: T.separator }} />

              {/* Meaning + tone */}
              <div className="rounded-[14px] p-3 flex flex-col gap-2" style={{ background: "rgba(0,0,0,0.03)", border: `1px solid ${T.separator}` }}>
                <SectionLabel>Meaning</SectionLabel>
                {compLoading ? (
                  <p className="font-semibold" style={{ fontSize: 16, color: T.secondLabel }}>Understanding the caller…</p>
                ) : comp?.meaning ? (
                  <>
                    <p className="font-semibold" style={{ fontSize: 16, color: T.label, lineHeight: 1.4 }}>{comp.meaning}</p>
                    <span className="self-start inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-[12px] font-semibold" style={{ background: `${tone.color}18`, border: `1px solid ${tone.color}35`, color: tone.color }}>
                      {tone.icon}&nbsp;{tone.label}
                    </span>
                  </>
                ) : (
                  <p style={{ fontSize: 15, color: T.tertLabel }}>The meaning will appear here once the caller speaks.</p>
                )}
              </div>

              {/* Key info */}
              {(comp?.keyInfo?.length ?? 0) > 0 && (
                <div className="space-y-2">
                  <SectionLabel>Key Info</SectionLabel>
                  <div className="flex flex-wrap gap-1.5">
                    {comp!.keyInfo.map((item, i) => (
                      <span key={item + i} className="inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-[11px]" style={{ background: "rgba(0,0,0,0.05)", border: "1px solid rgba(0,0,0,0.08)", color: T.secondLabel }}>🔑 {item}</span>
                    ))}
                  </div>
                </div>
              )}

              {/* ASL gloss */}
              {displayGloss.length > 0 && (
                <div className="space-y-2">
                  <SectionLabel>ASL Gloss</SectionLabel>
                  <div className="flex flex-wrap gap-1.5">
                    {displayGloss.map((g, i) => (
                      <span key={g + i} className="inline-flex items-center rounded-[8px] px-2.5 py-[3px] text-[11px] font-semibold" style={{ background: "rgba(0,122,255,0.08)", border: "1px solid rgba(0,122,255,0.16)", color: T.blue, letterSpacing: "0.04em" }}>{g}</span>
                    ))}
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
