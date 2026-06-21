"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { motion } from "framer-motion";
import { Trash2, Download, Upload, RotateCcw, Circle } from "lucide-react";

import HandTracker, { type HandFrame } from "@/components/HandTracker";
import { normalizeLandmarks } from "@/lib/landmarks";
import {
  downloadModel,
  getClassifier,
  importModelFromFile,
  persist,
  reloadFromStorage,
} from "@/lib/signStore";
import {
  GROUP_TITLES,
  KNN_LABELS,
  SIGN_LABELS,
  type SignGroup,
  type SignLabel,
} from "@/data/signs";

// ─────────────────────────────────────────────────────────────────────────────
// /train — browser-only KNN sign-language trainer.
//
//   • Pick a KNN label, hold the Record button (or Space) to capture ~frames.
//   • Each captured frame is a normalized 21-landmark vector (translation/scale
//     invariant) added to the classifier.
//   • A live prediction shows what the current model thinks the current frame is.
//   • The model is persisted to localStorage and can be exported / imported as
//     JSON so it survives wipes and can be shared.
//
// The 7 pretrained MediaPipe gestures need NO training and are shown read-only.
// All recognition goes through the classifier-agnostic SignClassifier interface,
// so KNN can be swapped for an LSTM later without touching this page.
// ─────────────────────────────────────────────────────────────────────────────

const T = {
  bg: "#F5F5F7",
  surface: "#FFFFFF",
  label: "#1D1D1F",
  secondLabel: "rgba(60,60,67,0.60)",
  tertLabel: "rgba(60,60,67,0.30)",
  separator: "rgba(60,60,67,0.12)",
  blue: "#007AFF",
  green: "#34C759",
  red: "#FF3B30",
  purple: "#AF52DE",
  orange: "#FF9500",
} as const;

const GROUP_ORDER: SignGroup[] = ["pretrained", "demo", "tier2", "alphabet"];

// Throttle captures so a 1-second hold yields a sensible (~20) sample count
// rather than one-per-render.
const CAPTURE_INTERVAL_MS = 50;

export default function TrainPage() {
  const classifier = getClassifier();

  const firstKnn = KNN_LABELS[0]?.id ?? "HELLO";
  const [selectedId, setSelectedId] = useState<string>(firstKnn);
  const [counts, setCounts] = useState<Record<string, number>>({});
  const [recording, setRecording] = useState(false);
  const [countdown, setCountdown] = useState<number | null>(null);
  const [handCount, setHandCount] = useState(0);
  const [prediction, setPrediction] = useState<{ label: string | null; confidence: number }>({
    label: null,
    confidence: 0,
  });
  const [toast, setToast] = useState<{ text: string; kind: "ok" | "err" } | null>(null);

  // Refs read inside the per-frame callback (avoid stale closures / re-subscribe).
  const recordingRef = useRef(false);
  const selectedRef = useRef(selectedId);
  const lastCaptureRef = useRef(0);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const toastTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const countdownTimers = useRef<ReturnType<typeof setTimeout>[]>([]);

  recordingRef.current = recording;
  selectedRef.current = selectedId;

  const selectedLabel = SIGN_LABELS.find((s) => s.id === selectedId);
  const selectable = selectedLabel?.kind === "knn";

  function refreshCounts() {
    setCounts(getClassifier().countByLabel());
  }

  useEffect(() => {
    reloadFromStorage();
    refreshCounts();
    return () => {
      if (toastTimer.current) clearTimeout(toastTimer.current);
      countdownTimers.current.forEach(clearTimeout);
    };
  }, []);

  function flash(text: string, kind: "ok" | "err" = "ok") {
    setToast({ text, kind });
    if (toastTimer.current) clearTimeout(toastTimer.current);
    toastTimer.current = setTimeout(() => setToast(null), 2600);
  }

  // ── Per-frame: live prediction + sample capture ─────────────────────────────
  function handleFrame(frame: HandFrame) {
    setHandCount(frame.handCount);
    const vector = normalizeLandmarks(frame.landmarks);

    if (!vector) {
      setPrediction({ label: null, confidence: 0 });
      return;
    }

    // Live prediction against the current model.
    setPrediction(getClassifier().predict(vector));

    // Capture into the selected (KNN) label while recording.
    if (recordingRef.current) {
      const sel = SIGN_LABELS.find((s) => s.id === selectedRef.current);
      if (sel?.kind !== "knn") return;
      const now = performance.now();
      if (now - lastCaptureRef.current < CAPTURE_INTERVAL_MS) return;
      lastCaptureRef.current = now;
      getClassifier().addSample({ label: sel.id, vector, t: Date.now() });
      refreshCounts();
    }
  }

  // ── Recording controls ──────────────────────────────────────────────────────
  function startRecording() {
    if (!selectable) return;
    setRecording(true);
  }
  function stopRecording() {
    if (!recordingRef.current) return;
    setRecording(false);
    persist(); // write the burst to localStorage once
  }

  // Hands-free capture: single trigger -> 3-2-1 countdown -> auto-record ~2s.
  // Lets you record TWO-HAND signs without holding a key.
  function startCountdownCapture() {
    if (!selectable) return;
    if (recordingRef.current || countdown !== null) return;
    let n = 3;
    setCountdown(n);
    const tick = () => {
      n -= 1;
      if (n > 0) {
        setCountdown(n);
        countdownTimers.current.push(setTimeout(tick, 800));
      } else {
        setCountdown(null);
        startRecording();
        countdownTimers.current.push(setTimeout(() => stopRecording(), 2000));
      }
    };
    countdownTimers.current.push(setTimeout(tick, 800));
  }

  // Spacebar = hold to record.
  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      const el = document.activeElement;
      const inField = el && (el.tagName === "INPUT" || el.tagName === "TEXTAREA");
      if (inField) return;
      // Enter = hands-free countdown capture (great for two-hand signs).
      if (e.code === "Enter" && !e.repeat) {
        if (el && el.tagName === "BUTTON") return;
        e.preventDefault();
        startCountdownCapture();
        return;
      }
      if (e.code !== "Space" || e.repeat) return;
      e.preventDefault();
      startRecording();
    }
    function onKeyUp(e: KeyboardEvent) {
      if (e.code !== "Space") return;
      e.preventDefault();
      stopRecording();
    }
    window.addEventListener("keydown", onKeyDown);
    window.addEventListener("keyup", onKeyUp);
    return () => {
      window.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("keyup", onKeyUp);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectable]);

  // ── Model mutations ─────────────────────────────────────────────────────────
  function clearLabel(id: string) {
    getClassifier().clearLabel(id);
    persist();
    refreshCounts();
    flash(`Cleared samples for ${SIGN_LABELS.find((s) => s.id === id)?.display ?? id}`);
  }
  function clearAll() {
    if (!window.confirm("Delete ALL trained samples? This cannot be undone.")) return;
    getClassifier().clearAll();
    persist();
    refreshCounts();
    flash("Cleared the entire model");
  }
  function onExport() {
    if (getClassifier().size() === 0) {
      flash("Nothing to export yet — train a sign first.", "err");
      return;
    }
    downloadModel();
    flash("Exported model JSON");
  }
  async function onImportFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = ""; // allow re-importing the same file
    if (!file) return;
    try {
      await importModelFromFile(file);
      refreshCounts();
      flash("Imported model JSON");
    } catch (err) {
      flash(err instanceof Error ? err.message : "Import failed", "err");
    }
  }

  // ── Derived model stats ─────────────────────────────────────────────────────
  const totalSamples = useMemo(
    () => Object.values(counts).reduce((a, b) => a + b, 0),
    [counts]
  );
  const trainedCount = useMemo(
    () => KNN_LABELS.filter((l) => (counts[l.id] ?? 0) > 0).length,
    [counts]
  );

  const predLabel = prediction.label
    ? SIGN_LABELS.find((s) => s.id === prediction.label)?.display ?? prediction.label
    : null;
  const predMatchesSelected = prediction.label === selectedId;

  const selectedCount = counts[selectedId] ?? 0;

  // ── Grouped label rows ──────────────────────────────────────────────────────
  const grouped = GROUP_ORDER.map((group) => ({
    group,
    items: SIGN_LABELS.filter((s) => s.group === group),
  }));

  return (
    <div className="min-h-screen" style={{ background: T.bg }}>
      {/* Hidden file input for import */}
      <input
        ref={fileInputRef}
        type="file"
        accept="application/json,.json"
        className="hidden"
        onChange={onImportFile}
      />

      <div className="max-w-[1100px] mx-auto px-5 pb-16">
        {/* ── Header ──────────────────────────────────────────────────────── */}
        <div className="flex items-center justify-between pt-8 pb-4">
          <div>
            <Link
              href="/"
              className="text-[14px] font-medium focus:outline-none focus-visible:ring-2 focus-visible:ring-[#007AFF] rounded-[6px]"
              style={{ color: T.blue }}
            >
              ← Home
            </Link>
            <h1
              className="mt-2"
              style={{ fontSize: 32, fontWeight: 700, letterSpacing: "-0.02em", color: T.label }}
            >
              Sign Trainer
            </h1>
            <p className="text-[14px] mt-1" style={{ color: T.secondLabel }}>
              Teach the app your ASL handshapes — everything stays in your browser.
            </p>
          </div>

          {/* Model toolbar */}
          <div className="flex items-center gap-2">
            <ToolbarButton onClick={onExport} icon={<Download size={15} />} label="Export" />
            <ToolbarButton
              onClick={() => fileInputRef.current?.click()}
              icon={<Upload size={15} />}
              label="Import"
            />
            <ToolbarButton
              onClick={clearAll}
              icon={<RotateCcw size={15} />}
              label="Clear all"
              danger
            />
          </div>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-[1fr_400px] gap-4">
          {/* ── LEFT: camera + capture ──────────────────────────────────── */}
          <div className="flex flex-col gap-4">
            <div className="rounded-[18px] overflow-hidden" style={{ ...card }}>
              <div className="aspect-video">
                <HandTracker onFrame={handleFrame} badge={countdown !== null ? `GET READY ${countdown}` : recording ? "● REC" : "LIVE"} />
              </div>

              {/* Live prediction strip */}
              <div className="p-4 flex items-center justify-between gap-4">
                <div className="min-w-0">
                  <p className="text-[11px] font-semibold uppercase tracking-widest" style={{ color: T.tertLabel }}>
                    Live prediction
                  </p>
                  <p
                    className="text-[22px] font-bold truncate"
                    style={{
                      color: predLabel ? (predMatchesSelected ? T.green : T.label) : T.tertLabel,
                      letterSpacing: "-0.01em",
                    }}
                  >
                    {predLabel ?? (handCount === 0 ? "Show your hand 👋" : "No match")}
                  </p>
                </div>
                <div className="flex-shrink-0 text-right" style={{ width: 120 }}>
                  <p className="text-[11px]" style={{ color: T.tertLabel }}>Confidence</p>
                  <p className="text-[17px] font-semibold tabular-nums" style={{ color: T.label }}>
                    {prediction.label ? `${(prediction.confidence * 100).toFixed(0)}%` : "—"}
                  </p>
                  <div className="mt-1 h-[4px] rounded-full overflow-hidden" style={{ background: "rgba(60,60,67,0.10)" }}>
                    <div
                      className="h-full rounded-full transition-all duration-150"
                      style={{ width: `${(prediction.confidence || 0) * 100}%`, background: T.blue }}
                    />
                  </div>
                </div>
              </div>
            </div>

            {/* Capture controls */}
            <div className="p-4" style={card}>
              <div className="flex items-center justify-between mb-3">
                <div>
                  <p className="text-[11px] font-semibold uppercase tracking-widest" style={{ color: T.tertLabel }}>
                    Recording into
                  </p>
                  <p className="text-[20px] font-bold" style={{ color: T.label }}>
                    {selectedLabel?.display ?? "—"}
                    {selectedLabel?.motion && (
                      <span className="ml-2 text-[11px] font-medium align-middle" style={{ color: T.orange }}>
                        motion sign · static key-frame
                      </span>
                    )}
                  </p>
                </div>
                <div className="text-right">
                  <p className="text-[11px]" style={{ color: T.tertLabel }}>Samples</p>
                  <p className="text-[24px] font-bold tabular-nums" style={{ color: T.label }}>
                    {selectedCount}
                  </p>
                </div>
              </div>

              {selectable ? (
                <>
                  <motion.button
                    whileTap={{ scale: 0.98 }}
                    onPointerDown={(e) => {
                      e.preventDefault();
                      startRecording();
                    }}
                    onPointerUp={stopRecording}
                    onPointerLeave={stopRecording}
                    onPointerCancel={stopRecording}
                    className="w-full flex items-center justify-center gap-2 rounded-[12px] py-3.5 font-semibold text-white select-none touch-none focus:outline-none focus-visible:ring-2 focus-visible:ring-[#007AFF]"
                    style={{ background: recording ? T.red : T.blue, fontSize: 15 }}
                  >
                    <Circle size={14} fill="currentColor" />
                    {recording ? "Recording… release to stop" : "Hold to Record (or press Space)"}
                  </motion.button>
                  <motion.button
                    whileTap={{ scale: 0.98 }}
                    onClick={startCountdownCapture}
                    disabled={recording || countdown !== null}
                    className="w-full mt-2 flex items-center justify-center gap-2 rounded-[12px] py-3 font-semibold select-none disabled:opacity-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-[#007AFF]"
                    style={{ background: "rgba(0,122,255,0.10)", color: T.blue, fontSize: 14 }}
                  >
                    {countdown !== null ? `Get ready… ${countdown}` : "🙌 Auto-capture (hands-free · press Enter)"}
                  </motion.button>
                  <div className="flex items-center justify-between mt-3">
                    <p className="text-[12px]" style={{ color: T.secondLabel }}>
                      Tip: for one hand, hold Record. For TWO-hand signs, use Auto-capture (Enter) — pose both hands during 3-2-1.
                    </p>
                    <button
                      onClick={() => clearLabel(selectedId)}
                      disabled={selectedCount === 0}
                      className="text-[12px] font-medium disabled:opacity-30 focus:outline-none focus-visible:ring-2 focus-visible:ring-[#007AFF] rounded-[6px] px-1"
                      style={{ color: T.red }}
                    >
                      Clear “{selectedLabel?.display}”
                    </button>
                  </div>
                </>
              ) : (
                <div
                  className="rounded-[12px] p-3 text-[13px]"
                  style={{ background: "rgba(0,122,255,0.06)", border: "1px solid rgba(0,122,255,0.16)", color: T.secondLabel }}
                >
                  <span className="font-semibold" style={{ color: T.blue }}>Pretrained gesture.</span>{" "}
                  MediaPipe recognises this automatically — no training needed. It works in the
                  Testing Call playground right away.
                </div>
              )}
            </div>

            {/* Model stats */}
            <div className="p-4 flex items-center gap-6" style={card}>
              <Stat label="Trained signs" value={`${trainedCount}/${KNN_LABELS.length}`} />
              <Stat label="Total samples" value={String(totalSamples)} />
              <Stat label="Classifier" value="KNN" />
              <p className="ml-auto text-[11px] max-w-[180px] text-right" style={{ color: T.tertLabel }}>
                Stored in this browser&apos;s localStorage. Export to back up or share.
              </p>
            </div>
          </div>

          {/* ── RIGHT: label list ───────────────────────────────────────── */}
          <div className="rounded-[18px] overflow-hidden flex flex-col" style={card}>
            <div className="px-4 pt-4 pb-2" style={{ borderBottom: `1px solid ${T.separator}` }}>
              <p className="text-[15px] font-semibold" style={{ color: T.label }}>Vocabulary</p>
              <p className="text-[12px]" style={{ color: T.secondLabel }}>
                {SIGN_LABELS.length} signs · tap a trainable sign to select it
              </p>
            </div>

            <div className="overflow-y-auto" style={{ maxHeight: "70vh" }}>
              {grouped.map(({ group, items }) => (
                <div key={group}>
                  <div
                    className="px-4 py-2 text-[11px] font-semibold uppercase tracking-widest sticky top-0 z-10"
                    style={{ color: T.tertLabel, background: "rgba(248,248,250,0.92)", backdropFilter: "blur(8px)" }}
                  >
                    {GROUP_TITLES[group]}
                  </div>
                  {items.map((s) => (
                    <LabelRow
                      key={s.id}
                      sign={s}
                      count={counts[s.id] ?? 0}
                      selected={s.id === selectedId}
                      onSelect={() => s.kind === "knn" && setSelectedId(s.id)}
                      onClear={() => clearLabel(s.id)}
                    />
                  ))}
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>

      {/* Toast */}
      {toast && (
        <motion.div
          initial={{ opacity: 0, y: -16 }}
          animate={{ opacity: 1, y: 0 }}
          className="fixed top-4 left-1/2 -translate-x-1/2 z-50 rounded-full px-5 py-2.5 text-[14px] font-medium"
          style={{
            background: toast.kind === "err" ? "rgba(255,59,48,0.95)" : "rgba(28,28,30,0.90)",
            color: "#fff",
            boxShadow: "0 4px 24px rgba(0,0,0,0.25)",
          }}
        >
          {toast.text}
        </motion.div>
      )}
    </div>
  );
}

// ── Pieces ─────────────────────────────────────────────────────────────────────

const card = {
  background: T.surface,
  borderRadius: 18,
  boxShadow: "0 4px 24px rgba(0,0,0,0.06)",
} as const;

function ToolbarButton({
  onClick,
  icon,
  label,
  danger,
}: {
  onClick: () => void;
  icon: React.ReactNode;
  label: string;
  danger?: boolean;
}) {
  return (
    <button
      onClick={onClick}
      className="flex items-center gap-1.5 rounded-[10px] px-3 py-2 text-[13px] font-medium focus:outline-none focus-visible:ring-2 focus-visible:ring-[#007AFF]"
      style={{
        background: danger ? "rgba(255,59,48,0.08)" : "rgba(0,0,0,0.05)",
        color: danger ? T.red : T.label,
      }}
    >
      {icon}
      {label}
    </button>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <p className="text-[11px]" style={{ color: T.tertLabel }}>{label}</p>
      <p className="text-[18px] font-bold tabular-nums" style={{ color: T.label }}>{value}</p>
    </div>
  );
}

function LabelRow({
  sign,
  count,
  selected,
  onSelect,
  onClear,
}: {
  sign: SignLabel;
  count: number;
  selected: boolean;
  onSelect: () => void;
  onClear: () => void;
}) {
  const isPretrained = sign.kind === "pretrained";
  const trained = count > 0;

  return (
    <div
      role={isPretrained ? undefined : "button"}
      tabIndex={isPretrained ? undefined : 0}
      onClick={onSelect}
      onKeyDown={(e) => {
        if (!isPretrained && (e.key === "Enter" || e.key === " ")) {
          e.preventDefault();
          onSelect();
        }
      }}
      className={`flex items-center gap-3 px-4 py-2.5 ${isPretrained ? "" : "cursor-pointer"} focus:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-[#007AFF]`}
      style={{
        background: selected ? "rgba(0,122,255,0.08)" : "transparent",
        borderLeft: selected ? `3px solid ${T.blue}` : "3px solid transparent",
        opacity: isPretrained ? 0.85 : 1,
      }}
    >
      {/* Trained indicator */}
      <span
        className="w-2 h-2 rounded-full flex-shrink-0"
        style={{ background: isPretrained ? T.blue : trained ? T.green : "rgba(60,60,67,0.18)" }}
      />

      <div className="flex-1 min-w-0">
        <p className="text-[14px] font-medium truncate" style={{ color: T.label }}>
          {sign.display}
          {sign.motion && <span className="ml-1.5 text-[10px]" style={{ color: T.orange }}>motion</span>}
        </p>
        <p className="text-[11px] truncate" style={{ color: T.tertLabel }}>{sign.id}</p>
      </div>

      {isPretrained ? (
        <span
          className="text-[10px] font-semibold uppercase tracking-wide rounded-full px-2 py-[2px] flex-shrink-0"
          style={{ color: T.blue, background: "rgba(0,122,255,0.10)" }}
        >
          pretrained
        </span>
      ) : (
        <div className="flex items-center gap-2 flex-shrink-0">
          <span className="text-[13px] font-semibold tabular-nums" style={{ color: trained ? T.green : T.tertLabel }}>
            {count}
          </span>
          {trained && (
            <button
              onClick={(e) => {
                e.stopPropagation();
                onClear();
              }}
              aria-label={`Clear samples for ${sign.display}`}
              className="rounded-[6px] p-1 focus:outline-none focus-visible:ring-2 focus-visible:ring-[#007AFF]"
              style={{ color: T.red }}
            >
              <Trash2 size={14} />
            </button>
          )}
        </div>
      )}
    </div>
  );
}