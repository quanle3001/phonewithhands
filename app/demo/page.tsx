"use client";

import type { CSSProperties, ReactNode } from "react";
import { useEffect, useState } from "react";
import Link from "next/link";
import { motion, AnimatePresence, useReducedMotion } from "framer-motion";
import { Phone, PhoneOff, Mic, MicOff, Video } from "lucide-react";
import CameraSignDetector from "@/components/CameraSignDetector";
import GlossPanel from "@/components/GlossPanel";

// ─── macOS dark-mode design tokens ───────────────────────────────────────────

const SYS = {
  blue:           "#0A84FF",
  green:          "#30D158",
  red:            "#FF453A",
  orange:         "#FF9F0A",
  purple:         "#BF5AF2",
  label:          "rgba(255,255,255,0.85)",
  secondaryLabel: "rgba(255,255,255,0.55)",
  tertiaryLabel:  "rgba(255,255,255,0.25)",
  separator:      "rgba(255,255,255,0.10)",
} as const;

// "Vibrancy" material used for all panel cards
const MATERIAL: CSSProperties = {
  background:              "rgba(255,255,255,0.065)",
  backdropFilter:          "blur(30px) saturate(180%)",
  WebkitBackdropFilter:    "blur(30px) saturate(180%)",
  border:                  "1px solid rgba(255,255,255,0.10)",
  boxShadow:               "inset 0 1px 0 rgba(255,255,255,0.06), 0 1px 3px rgba(0,0,0,0.18)",
};

// macOS-authentic spring (stiffness 300, damping 30, mass 0.8)
const SPRING = { type: "spring" as const, stiffness: 300, damping: 30, mass: 0.8 };

// ─── Mock data ────────────────────────────────────────────────────────────────

const MOCK = {
  officeLine:   "Please bring your insurance card and photo ID to your appointment.",
  meaning:      "Bring your insurance card and a photo ID when you come.",
  tone:         "important instruction" as const,
  keyInfo:      ["insurance card", "photo ID", "Tuesday 2:00 PM"],
  quickPhrases: ["Got it!", "Please repeat", "One moment", "Thank you", "No insurance"],
};

type ToneKey = "important instruction" | "greeting" | "question" | "confirmation" | "urgent";

const TONE: Record<ToneKey, { color: string; icon: string; label: string }> = {
  "important instruction": { color: SYS.purple, icon: "⚠️", label: "Important Instruction" },
  greeting:                { color: SYS.blue,   icon: "👋", label: "Greeting" },
  question:                { color: SYS.orange, icon: "❓", label: "Question" },
  confirmation:            { color: SYS.blue,   icon: "✅", label: "Confirmation" },
  urgent:                  { color: SYS.red,    icon: "🚨", label: "Urgent" },
};

// ─── Small helpers ────────────────────────────────────────────────────────────

function fmt(s: number) {
  return (
    String(Math.floor(s / 60)).padStart(2, "0") +
    ":" +
    String(s % 60).padStart(2, "0")
  );
}

// Hairline separator
function Sep() {
  return <div style={{ height: 1, background: SYS.separator, flexShrink: 0 }} />;
}

// macOS section label — 10px, tertiary, tight tracking
function SectionLabel({ children }: { children: string }) {
  return (
    <p
      className="text-[10px] font-semibold uppercase tracking-widest select-none"
      style={{ color: SYS.tertiaryLabel }}
    >
      {children}
    </p>
  );
}

// ─── Traffic light button ─────────────────────────────────────────────────────

function TrafficLight({ hex, label }: { hex: string; label: string }) {
  return (
    <motion.button
      whileHover={{ filter: "brightness(1.18)" }}
      whileTap={{ scale: 0.84 }}
      aria-label={label}
      title={label}
      className="w-3 h-3 rounded-full focus:outline-none"
      style={{ background: hex }}
    />
  );
}

// ─── Control bar button ───────────────────────────────────────────────────────

interface CtrlBtnProps {
  children: ReactNode;
  onClick?: () => void;
  label: string;
  bg: string;
  size?: "sm" | "lg";
}
function CtrlBtn({ children, onClick, label, bg, size = "sm" }: CtrlBtnProps) {
  const dim = size === "lg" ? 44 : 36;
  return (
    <motion.button
      whileHover={{ filter: "brightness(1.12)" }}
      whileTap={{ scale: 0.94 }}
      onClick={onClick}
      aria-label={label}
      title={label}
      className="flex items-center justify-center rounded-full text-white focus:outline-none
        focus-visible:ring-2 focus-visible:ring-[#0A84FF] focus-visible:ring-offset-1
        focus-visible:ring-offset-black/50"
      style={{ width: dim, height: dim, background: bg }}
    >
      {children}
    </motion.button>
  );
}

// ─── Page ─────────────────────────────────────────────────────────────────────

export default function DemoPage() {
  const [seconds, setSeconds] = useState(42);
  const [muted,   setMuted]   = useState(false);
  const [ended,   setEnded]   = useState(false);
  const rm = useReducedMotion(); // respect prefers-reduced-motion

  useEffect(() => {
    const id = setInterval(() => setSeconds((n) => n + 1), 1000);
    return () => clearInterval(id);
  }, []);

  const toneConf = TONE[MOCK.tone];
  const dist = rm ? 0 : 8;

  return (
    /* ── Desktop wallpaper ─────────────────────────────────────────────────── */
    <div
      className="demo-root h-screen overflow-hidden flex items-stretch p-3"
      style={{
        background:
          "radial-gradient(ellipse at 16% 26%, rgba(108,44,220,0.60) 0%, transparent 40%), " +
          "radial-gradient(ellipse at 84% 70%, rgba(18,80,210,0.50) 0%, transparent 40%), " +
          "radial-gradient(ellipse at 50% 96%, rgba(6,40,160,0.35) 0%, transparent 44%), " +
          "linear-gradient(162deg, #09091a 0%, #0b0d22 38%, #060612 70%, #04040e 100%)",
      }}
    >
      {/* ── macOS app window ──────────────────────────────────────────────── */}
      <motion.div
        initial={{ opacity: 0, scale: rm ? 1 : 0.98 }}
        animate={{ opacity: 1, scale: 1 }}
        transition={{ ...SPRING, duration: 0.35 }}
        className="flex-1 flex flex-col overflow-hidden rounded-xl"
        style={{
          background:          "rgba(28,28,30,0.91)",
          backdropFilter:      "blur(60px) saturate(160%)",
          WebkitBackdropFilter:"blur(60px) saturate(160%)",
          border:              "1px solid rgba(255,255,255,0.12)",
          boxShadow:           "0 30px 80px rgba(0,0,0,0.58), 0 4px 16px rgba(0,0,0,0.40)",
        }}
      >

        {/* ── Title bar / unified toolbar ──────────────────────────────── */}
        <div
          className="flex-shrink-0 h-[52px] flex items-center relative px-4 select-none"
          style={{
            background:   "rgba(255,255,255,0.035)",
            borderBottom: `1px solid ${SYS.separator}`,
          }}
        >
          {/* Traffic lights */}
          <div className="flex items-center gap-2 z-10">
            <TrafficLight hex="#FF5F57" label="Close" />
            <TrafficLight hex="#FEBC2E" label="Minimize" />
            <TrafficLight hex="#28C840" label="Zoom" />
          </div>

          {/* Centered window title */}
          <div className="absolute inset-x-0 flex justify-center items-center pointer-events-none">
            <span
              className="text-[13px] font-semibold"
              style={{ color: SYS.label, letterSpacing: "-0.1px" }}
            >
              Phone With Hand
            </span>
          </div>

          {/* Right: status pill + home */}
          <div className="ml-auto flex items-center gap-3 z-10">
            {/* macOS toolbar status pill */}
            <div
              className="flex items-center gap-1.5 rounded-full px-2.5 py-1"
              style={{
                background: "rgba(255,255,255,0.07)",
                border:     `1px solid ${SYS.separator}`,
              }}
            >
              {/* Pulsing connected dot */}
              <span className="relative flex h-[7px] w-[7px] flex-shrink-0">
                <span
                  className="absolute inline-flex h-full w-full rounded-full animate-ping opacity-70"
                  style={{ background: SYS.green }}
                />
                <span
                  className="relative inline-flex h-[7px] w-[7px] rounded-full"
                  style={{ background: SYS.green }}
                />
              </span>
              <span className="text-[11px]" style={{ color: SYS.secondaryLabel }}>
                Dr. Smith&apos;s Office
              </span>
              <span className="text-[11px] mx-0.5" style={{ color: SYS.tertiaryLabel }}>·</span>
              <span className="text-[11px] font-semibold" style={{ color: SYS.green }}>
                Connected
              </span>
              <span className="text-[11px] mx-0.5" style={{ color: SYS.tertiaryLabel }}>·</span>
              <span
                className="text-[11px] font-semibold tabular-nums"
                style={{ color: SYS.label }}
              >
                {fmt(seconds)}
              </span>
            </div>

            <Link
              href="/"
              className="text-[11px] transition-opacity hover:opacity-70"
              style={{ color: SYS.secondaryLabel }}
            >
              ← Home
            </Link>
          </div>
        </div>

        {/* ── Three-column content ──────────────────────────────────────── */}
        <div className="flex flex-1 min-h-0 gap-2.5 p-3">

          {/* ── LEFT — You Sign ──────────────────────────────────────── */}
          <motion.div
            initial={{ opacity: 0, y: dist }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ ...SPRING, delay: 0.07 }}
            className="flex-1 min-w-0 flex flex-col gap-2.5"
          >
            {/* Camera panel */}
            <div
              className="flex-1 min-h-0 flex flex-col rounded-[10px] overflow-hidden"
              style={MATERIAL}
            >
              {/* Panel header */}
              <div
                className="flex-shrink-0 flex items-center justify-between px-4 pt-3 pb-2.5"
                style={{ borderBottom: "1px solid rgba(255,255,255,0.07)" }}
              >
                <div>
                  <SectionLabel>You Sign</SectionLabel>
                  <p
                    className="text-[17px] font-semibold mt-0.5 leading-tight"
                    style={{ color: SYS.label }}
                  >
                    Your signing
                  </p>
                </div>
                <span className="text-base" style={{ opacity: 0.35 }} aria-hidden>🖐</span>
              </div>

              {/* Detector fills remaining height */}
              <div className="flex-1 min-h-0 p-3 flex flex-col">
                <CameraSignDetector />
              </div>
            </div>

            {/* Quick-phrases card */}
            <motion.div
              initial={{ opacity: 0, y: dist }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ ...SPRING, delay: 0.13 }}
              className="flex-shrink-0 rounded-[10px] p-3"
              style={MATERIAL}
            >
              <SectionLabel>Quick Phrases</SectionLabel>
              <div className="flex flex-wrap gap-1.5 mt-2">
                {MOCK.quickPhrases.map((phrase) => (
                  <motion.button
                    key={phrase}
                    whileHover={{ filter: "brightness(1.14)" }}
                    whileTap={{ scale: 0.95 }}
                    className="px-3 py-[5px] rounded-[6px] text-[13px] font-semibold
                      focus:outline-none focus-visible:ring-2 focus-visible:ring-[#0A84FF]"
                    style={{
                      background: "rgba(255,255,255,0.09)",
                      border:     "1px solid rgba(255,255,255,0.11)",
                      boxShadow:  "inset 0 1px 0 rgba(255,255,255,0.06)",
                      color:      SYS.label,
                    }}
                  >
                    {phrase}
                  </motion.button>
                ))}
              </div>
            </motion.div>
          </motion.div>

          {/* ── CENTER — ASL Gloss ───────────────────────────────────── */}
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ ...SPRING, delay: 0.11 }}
            className="w-[152px] flex-shrink-0 flex flex-col justify-center items-center"
          >
            <GlossPanel />
          </motion.div>

          {/* ── RIGHT — They Speak ───────────────────────────────────── */}
          <motion.div
            initial={{ opacity: 0, y: dist }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ ...SPRING, delay: 0.07 }}
            className="flex-1 min-w-0"
          >
            <div
              className="h-full flex flex-col rounded-[10px] overflow-hidden"
              style={MATERIAL}
            >
              {/* Panel header */}
              <div
                className="flex-shrink-0 flex items-center justify-between px-4 pt-3 pb-2.5"
                style={{ borderBottom: "1px solid rgba(255,255,255,0.07)" }}
              >
                <div>
                  <SectionLabel>They Speak</SectionLabel>
                  <p
                    className="text-[17px] font-semibold mt-0.5 leading-tight"
                    style={{ color: SYS.label }}
                  >
                    Dr. Smith&apos;s Office
                  </p>
                </div>
                {/* LIVE badge — macOS red, subtle pulse */}
                <motion.div
                  animate={{ opacity: rm ? 1 : [1, 0.5, 1] }}
                  transition={{ duration: 2, repeat: Infinity, ease: "easeInOut" }}
                  className="flex items-center gap-1.5 rounded-full px-2.5 py-1
                    text-[11px] font-semibold"
                  style={{
                    background: "rgba(255,69,58,0.14)",
                    border:     "1px solid rgba(255,69,58,0.28)",
                    color:      SYS.red,
                  }}
                >
                  <span
                    className="w-1.5 h-1.5 rounded-full"
                    style={{ background: SYS.red }}
                  />
                  LIVE
                </motion.div>
              </div>

              {/* Scrollable body */}
              <div className="flex-1 overflow-y-auto flex flex-col gap-3.5 p-4">

                {/* Live caption — Title1 22/Semibold */}
                <motion.div
                  initial={{ opacity: 0, y: rm ? 0 : 5 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ ...SPRING, delay: 0.2 }}
                  className="space-y-1.5"
                >
                  <SectionLabel>Live Caption</SectionLabel>
                  <p
                    className="text-[22px] font-semibold leading-snug"
                    style={{ color: SYS.label, letterSpacing: "-0.3px" }}
                  >
                    &ldquo;{MOCK.officeLine}&rdquo;
                  </p>
                </motion.div>

                <Sep />

                {/* Meaning card — nested material */}
                <motion.div
                  initial={{ opacity: 0, y: rm ? 0 : 5 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ ...SPRING, delay: 0.28 }}
                  className="rounded-[10px] p-3.5 flex flex-col gap-3"
                  style={{
                    background: "rgba(255,255,255,0.04)",
                    border:     `1px solid ${SYS.separator}`,
                  }}
                >
                  <SectionLabel>Meaning</SectionLabel>
                  <p
                    className="text-[17px] font-semibold"
                    style={{ color: SYS.label, lineHeight: "1.38" }}
                  >
                    {MOCK.meaning}
                  </p>

                  {/* Tone capsule — macOS colored, pop in */}
                  <motion.span
                    initial={{ scale: rm ? 1 : 0.82, opacity: 0 }}
                    animate={{ scale: 1, opacity: 1 }}
                    transition={{ ...SPRING, delay: 0.44 }}
                    className="self-start inline-flex items-center gap-1.5 rounded-full
                      px-3 py-1 text-[12px] font-semibold"
                    style={{
                      background: `${toneConf.color}20`,
                      border:     `1px solid ${toneConf.color}40`,
                      color:      toneConf.color,
                    }}
                  >
                    {toneConf.icon}&nbsp;{toneConf.label}
                  </motion.span>
                </motion.div>

                {/* Key-info chips — small gray macOS capsules */}
                <motion.div
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  transition={{ ...SPRING, delay: 0.36 }}
                  className="space-y-2"
                >
                  <SectionLabel>Key Info</SectionLabel>
                  <div className="flex flex-wrap gap-1.5">
                    {MOCK.keyInfo.map((item, i) => (
                      <motion.span
                        key={item}
                        initial={{ opacity: 0, scale: rm ? 1 : 0.88 }}
                        animate={{ opacity: 1, scale: 1 }}
                        transition={{ ...SPRING, delay: 0.40 + i * 0.06 }}
                        className="inline-flex items-center gap-1 rounded-full
                          px-2.5 py-0.5 text-[11px]"
                        style={{
                          background: "rgba(255,255,255,0.08)",
                          border:     "1px solid rgba(255,255,255,0.12)",
                          color:      SYS.secondaryLabel,
                        }}
                      >
                        🔑 {item}
                      </motion.span>
                    ))}
                  </div>
                </motion.div>

                {/* Spacer */}
                <div className="flex-1" />
              </div>
            </div>
          </motion.div>
        </div>

        {/* ── Bottom toolbar ────────────────────────────────────────────── */}
        <div
          className="flex-shrink-0 h-[60px] flex items-center justify-center gap-3"
          style={{
            background:  "rgba(255,255,255,0.03)",
            borderTop:   `1px solid ${SYS.separator}`,
          }}
        >
          <CtrlBtn
            label={muted ? "Unmute" : "Mute"}
            bg="rgba(255,255,255,0.12)"
            onClick={() => setMuted((m) => !m)}
          >
            {muted ? <MicOff size={17} /> : <Mic size={17} />}
          </CtrlBtn>

          <CtrlBtn label="Call" bg={SYS.green} size="lg">
            <Phone size={20} />
          </CtrlBtn>

          <CtrlBtn label="End Call" bg={SYS.red} size="lg" onClick={() => setEnded(true)}>
            <PhoneOff size={20} />
          </CtrlBtn>

          <CtrlBtn label="Camera" bg="rgba(255,255,255,0.12)">
            <Video size={17} />
          </CtrlBtn>
        </div>
      </motion.div>

      {/* ── Call-ended sheet ──────────────────────────────────────────── */}
      <AnimatePresence>
        {ended && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.18 }}
            className="absolute inset-0 z-30 flex items-center justify-center"
            style={{ background: "rgba(0,0,0,0.58)", backdropFilter: "blur(10px)" }}
            onClick={() => setEnded(false)}
          >
            <motion.div
              initial={{ scale: rm ? 1 : 0.92, opacity: 0, y: rm ? 0 : 10 }}
              animate={{ scale: 1, opacity: 1, y: 0 }}
              exit={{ scale: rm ? 1 : 0.94, opacity: 0 }}
              transition={SPRING}
              onClick={(e) => e.stopPropagation()}
              className="flex flex-col items-center gap-3 rounded-[16px] px-10 py-8 text-center"
              style={{
                background:          "rgba(38,38,40,0.95)",
                backdropFilter:      "blur(40px) saturate(160%)",
                WebkitBackdropFilter:"blur(40px) saturate(160%)",
                border:              "1px solid rgba(255,255,255,0.14)",
                boxShadow:           "0 20px 60px rgba(0,0,0,0.55)",
                minWidth:            280,
              }}
            >
              <div className="text-[44px] leading-none">📵</div>
              <p
                className="text-[22px] font-semibold"
                style={{ color: SYS.label, letterSpacing: "-0.3px" }}
              >
                Call Ended
              </p>
              <p className="text-[13px]" style={{ color: SYS.secondaryLabel }}>
                Duration&nbsp;·&nbsp;{fmt(seconds)}
              </p>
              <Link
                href="/"
                className="mt-1 px-5 py-2 rounded-[8px] text-[13px] font-semibold
                  text-white transition-opacity hover:opacity-80 focus:outline-none
                  focus-visible:ring-2 focus-visible:ring-white/50"
                style={{ background: SYS.blue }}
              >
                Back to Home
              </Link>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
