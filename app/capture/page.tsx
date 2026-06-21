"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { Circle, Download, Upload, Check } from "lucide-react";

// ─────────────────────────────────────────────────────────────────────────────
// /capture — Phase 3 Stage B: in-browser sign motion capture.
//
// Records the user's body (PoseLandmarker) + both hands (HandLandmarker) for each
// sign and saves a JSON motion clip per sign to localStorage. The clips later
// drive the 3D avatar (Stage C). Reuses the same @mediapipe/tasks-vision wasm
// fileset as components/CameraSignDetector.tsx (local /mediapipe/wasm, CDN
// fallback); the pose/hand .task models come from the MediaPipe CDN.
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
  orange: "#FF9500",
} as const;

// Same wasm fileset as CameraSignDetector (local first, CDN fallback).
const WASM_LOCAL = "/mediapipe/wasm";
const WASM_CDN = "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.14/wasm";
// Standard MediaPipe models from the CDN.
const POSE_MODEL_CDN =
  "https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_lite/float16/1/pose_landmarker_lite.task";
const HAND_MODEL_CDN =
  "https://storage.googleapis.com/mediapipe-models/hand_landmarker/hand_landmarker/float16/1/hand_landmarker.task";

const STORAGE_KEY = "phw-sign-clips";
const TARGET_FPS = 30;
const DURATION_MS = 2500;

const SIGNS = [
  "HELLO", "BYE", "NAME", "NICE_TO_MEET_YOU", "WANT", "APPOINTMENT",
  "YES", "MONDAY", "NO", "THANK_YOU", "R", "I", "C", "O",
] as const;

type Status = "idle" | "loading-camera" | "loading-model" | "ready" | "denied" | "error";

interface CaptureFrame {
  t: number;                  // ms since clip start
  pose: number[][];           // [x,y,z,visibility] per pose landmark
  poseWorld: number[][] | null; // [x,y,z] per pose world landmark
  left: number[][] | null;    // 21 [x,y,z] for the left hand
  right: number[][] | null;   // 21 [x,y,z] for the right hand
}
interface SignClip {
  fps: number;
  durationMs: number;
  frames: CaptureFrame[];
}
type ClipMap = Record<string, SignClip>;

// ── localStorage helpers ─────────────────────────────────────────────────────
function loadClips(): ClipMap {
  if (typeof window === "undefined") return {};
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    return raw ? (JSON.parse(raw) as ClipMap) : {};
  } catch {
    return {};
  }
}
function saveClips(clips: ClipMap) {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(clips));
  } catch (err) {
    console.warn("[capture] failed to persist clips:", err);
  }
}

// ── Landmark → array converters (match the Stage C data format exactly) ───────
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function poseToArr(lms: any[]): number[][] {
  return lms.map((p) => [p.x, p.y, p.z, p.visibility ?? 0]);
}
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function xyzToArr(lms: any[]): number[][] {
  return lms.map((p) => [p.x, p.y, p.z]);
}

export default function CapturePage() {
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [status, setStatus] = useState<Status>("idle");
  const [error, setError] = useState("");
  const [selectedSign, setSelectedSign] = useState<string>(SIGNS[0]);
  const [clips, setClips] = useState<ClipMap>({});
  const [recording, setRecording] = useState(false);
  const [countdown, setCountdown] = useState<number | null>(null);
  const [poseOn, setPoseOn] = useState(false);
  const [handCount, setHandCount] = useState(0);
  const [fps, setFps] = useState(0);
  const [toast, setToast] = useState<string | null>(null);

  // Refs read inside the rAF loop / timers (avoid stale closures).
  const recordingRef = useRef(false);
  const selectedRef = useRef(selectedSign);
  const framesRef = useRef<CaptureFrame[]>([]);
  const recordStartRef = useRef(0);
  const lastCaptureRef = useRef(0);
  const countdownTimers = useRef<ReturnType<typeof setTimeout>[]>([]);
  const toastTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Latest per-frame detection (so the stop/finish path & capture share results).
  const latestRef = useRef<{
    pose: number[][]; poseWorld: number[][] | null; left: number[][] | null; right: number[][] | null;
  }>({ pose: [], poseWorld: null, left: null, right: null });

  recordingRef.current = recording;
  selectedRef.current = selectedSign;

  // Hydrate saved clips on mount.
  useEffect(() => {
    setClips(loadClips());
    return () => {
      if (toastTimer.current) clearTimeout(toastTimer.current);
      countdownTimers.current.forEach(clearTimeout);
    };
  }, []);

  function flash(text: string) {
    setToast(text);
    if (toastTimer.current) clearTimeout(toastTimer.current);
    toastTimer.current = setTimeout(() => setToast(null), 2600);
  }

  // ── Camera + MediaPipe init + detection loop ────────────────────────────────
  useEffect(() => {
    let rafId: number | null = null;
    let stream: MediaStream | null = null;
    let cancelled = false;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let pose: any = null;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let hand: any = null;

    async function init() {
      try {
        setStatus("loading-camera");
        stream = await navigator.mediaDevices.getUserMedia({
          video: { width: { ideal: 1280 }, height: { ideal: 720 }, facingMode: "user" },
          audio: false,
        });
        if (cancelled) return;
        const video = videoRef.current!;
        video.srcObject = stream;
        video.muted = true;
        video.setAttribute("playsinline", "true");
        try { await video.play(); } catch (e) { console.warn("[capture] play() rejected:", e); }
        await new Promise<void>((res) => {
          if (video.readyState >= 3) return res();
          video.addEventListener("loadeddata", () => res(), { once: true });
        });
        if (cancelled) return;

        setStatus("loading-model");
        const { FilesetResolver, PoseLandmarker, HandLandmarker, DrawingUtils } =
          await import("@mediapipe/tasks-vision");
        if (cancelled) return;

        // Shared wasm fileset — local first, CDN fallback (same as the detector).
        const vision = await FilesetResolver.forVisionTasks(WASM_LOCAL).catch(() =>
          FilesetResolver.forVisionTasks(WASM_CDN)
        );

        // GPU delegate first, CPU fallback (Safari / some GPUs reject WebGL).
        async function makePose(delegate: "GPU" | "CPU") {
          return PoseLandmarker.createFromOptions(vision, {
            baseOptions: { modelAssetPath: POSE_MODEL_CDN, delegate },
            runningMode: "VIDEO",
            numPoses: 1,
          });
        }
        async function makeHand(delegate: "GPU" | "CPU") {
          return HandLandmarker.createFromOptions(vision, {
            baseOptions: { modelAssetPath: HAND_MODEL_CDN, delegate },
            runningMode: "VIDEO",
            numHands: 2,
          });
        }
        try { pose = await makePose("GPU"); } catch { pose = await makePose("CPU"); }
        if (cancelled) return;
        try { hand = await makeHand("GPU"); } catch { hand = await makeHand("CPU"); }
        if (cancelled) return;

        setStatus("ready");

        let lastVideoTime = -1;
        let lastTs = 0;
        let fpsCount = 0;
        let fpsSince = performance.now();

        function loop() {
          if (cancelled) return;
          const v = videoRef.current;
          const canvas = canvasRef.current;
          if (!v || !canvas) return;
          const ctx = canvas.getContext("2d");
          if (!ctx) return;

          try {
            if (canvas.width !== v.videoWidth) canvas.width = v.videoWidth;
            if (canvas.height !== v.videoHeight) canvas.height = v.videoHeight;
            ctx.clearRect(0, 0, canvas.width, canvas.height);

            if (v.currentTime !== lastVideoTime && v.videoWidth > 0) {
              lastVideoTime = v.currentTime;

              // Strictly increasing timestamp (Safari-safe).
              let ts = performance.now();
              if (ts <= lastTs) ts = lastTs + 1;
              lastTs = ts;

              const poseRes = pose.detectForVideo(v, ts);
              const handRes = hand.detectForVideo(v, ts);
              const drawing = new DrawingUtils(ctx);

              // ── Pose ──
              const poseLm = poseRes.landmarks?.[0] ?? null;
              const poseWorldLm = poseRes.worldLandmarks?.[0] ?? null;
              if (poseLm) {
                drawing.drawConnectors(poseLm, PoseLandmarker.POSE_CONNECTIONS, { color: "#38bdf8", lineWidth: 3 });
                drawing.drawLandmarks(poseLm, { color: "#0ea5e9", fillColor: "#0284c7", radius: 3, lineWidth: 1 });
              }

              // ── Hands (assign by handedness) ──
              const handLms = handRes.landmarks ?? [];
              const handed = handRes.handednesses ?? [];
              let leftArr: number[][] | null = null;
              let rightArr: number[][] | null = null;
              for (let i = 0; i < handLms.length; i++) {
                drawing.drawConnectors(handLms[i], HandLandmarker.HAND_CONNECTIONS, { color: "#4ade80", lineWidth: 2 });
                drawing.drawLandmarks(handLms[i], { color: "#f87171", fillColor: "#ef4444", radius: 4, lineWidth: 1 });
                const label = handed?.[i]?.[0]?.categoryName;
                const arr = xyzToArr(handLms[i]);
                if (label === "Left") leftArr = arr;
                else if (label === "Right") rightArr = arr;
                else if (!rightArr) rightArr = arr;
                else leftArr = arr;
              }

              latestRef.current = {
                pose: poseLm ? poseToArr(poseLm) : [],
                poseWorld: poseWorldLm ? xyzToArr(poseWorldLm) : null,
                left: leftArr,
                right: rightArr,
              };

              setPoseOn(!!poseLm);
              setHandCount(handLms.length);

              // FPS readout (~2x/sec).
              fpsCount++;
              const sinceF = performance.now() - fpsSince;
              if (sinceF >= 500) {
                setFps(Math.round((fpsCount * 1000) / sinceF));
                fpsCount = 0;
                fpsSince = performance.now();
              }

              // Capture frames while recording (throttled to ~TARGET_FPS).
              if (recordingRef.current) {
                const now = performance.now();
                const elapsed = now - recordStartRef.current;
                if (elapsed <= DURATION_MS && now - lastCaptureRef.current >= 1000 / TARGET_FPS - 3) {
                  lastCaptureRef.current = now;
                  const l = latestRef.current;
                  framesRef.current.push({
                    t: Math.round(elapsed),
                    pose: l.pose,
                    poseWorld: l.poseWorld,
                    left: l.left,
                    right: l.right,
                  });
                }
              }
            }
          } catch (frameErr) {
            console.warn("[capture] frame error (skipped):", frameErr);
          }

          rafId = requestAnimationFrame(loop);
        }
        loop();
      } catch (err) {
        if (cancelled) return;
        const e = err as DOMException & Error;
        if (e?.name === "NotAllowedError" || e?.name === "PermissionDeniedError") {
          setStatus("denied");
        } else {
          console.error("[capture]", e);
          setError(e?.message ?? String(e));
          setStatus("error");
        }
      }
    }

    init();
    return () => {
      cancelled = true;
      if (rafId !== null) cancelAnimationFrame(rafId);
      pose?.close?.();
      hand?.close?.();
      stream?.getTracks().forEach((t) => t.stop());
    };
  }, []);

  // ── Recording flow: countdown → record DURATION_MS → save ───────────────────
  function startCountdownRecord() {
    if (status !== "ready" || recordingRef.current || countdown !== null) return;
    let n = 3;
    setCountdown(n);
    const tick = () => {
      n -= 1;
      if (n > 0) {
        setCountdown(n);
        countdownTimers.current.push(setTimeout(tick, 800));
      } else {
        setCountdown(null);
        beginRecording();
      }
    };
    countdownTimers.current.push(setTimeout(tick, 800));
  }

  function beginRecording() {
    framesRef.current = [];
    recordStartRef.current = performance.now();
    lastCaptureRef.current = 0;
    recordingRef.current = true;
    setRecording(true);
    countdownTimers.current.push(setTimeout(finishRecording, DURATION_MS));
  }

  function finishRecording() {
    if (!recordingRef.current) return;
    recordingRef.current = false;
    setRecording(false);
    const sign = selectedRef.current;
    const frames = framesRef.current.slice();
    framesRef.current = [];
    const clip: SignClip = { fps: TARGET_FPS, durationMs: DURATION_MS, frames };
    setClips((prev) => {
      const next = { ...prev, [sign]: clip };
      saveClips(next);
      return next;
    });
    flash(`Recorded ${sign} — ${frames.length} frames`);
  }

  // ── Export / Import ─────────────────────────────────────────────────────────
  function downloadAll() {
    if (Object.keys(clips).length === 0) { flash("Nothing recorded yet."); return; }
    const blob = new Blob([JSON.stringify(clips, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "phw-sign-clips.json";
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
    flash("Downloaded phw-sign-clips.json");
  }
  async function onImportFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    try {
      const data = JSON.parse(await file.text()) as ClipMap;
      if (typeof data !== "object" || data === null) throw new Error("not an object");
      setClips(data);
      saveClips(data);
      flash(`Imported ${Object.keys(data).length} clips`);
    } catch (err) {
      flash("Import failed: " + (err instanceof Error ? err.message : String(err)));
    }
  }

  // ── Spacebar / Enter = record ───────────────────────────────────────────────
  useEffect(() => {
    function onKeyDown(ev: KeyboardEvent) {
      const el = document.activeElement;
      if (el && (el.tagName === "INPUT" || el.tagName === "TEXTAREA")) return;
      if ((ev.code === "Enter" || ev.code === "Space") && !ev.repeat) {
        if (el && el.tagName === "BUTTON") return;
        ev.preventDefault();
        startCountdownRecord();
      }
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [status, countdown]);

  const recordedCount = SIGNS.filter((s) => clips[s]?.frames?.length).length;

  const statusLabel: Record<Status, string> = {
    idle: "Initializing…",
    "loading-camera": "Requesting camera…",
    "loading-model": "Loading MediaPipe models…",
    ready: "",
    denied: "Camera access denied",
    error: "Initialization error",
  };

  return (
    <div className="min-h-screen" style={{ background: T.bg }}>
      <input ref={fileInputRef} type="file" accept="application/json,.json" className="hidden" onChange={onImportFile} />

      <div className="max-w-[1100px] mx-auto px-5 pb-16">
        {/* Header */}
        <div className="flex items-end justify-between pt-8 pb-4">
          <div>
            <Link
              href="/"
              className="text-[14px] font-medium focus:outline-none focus-visible:ring-2 focus-visible:ring-[#007AFF] rounded-[6px]"
              style={{ color: T.blue }}
            >
              ← Home
            </Link>
            <h1 className="mt-2" style={{ fontSize: 32, fontWeight: 700, letterSpacing: "-0.02em", color: T.label }}>
              Sign Capture
            </h1>
            <p className="text-[14px] mt-1" style={{ color: T.secondLabel }}>
              Record body + hand motion per sign → JSON clips for the 3D avatar. Stays in your browser.
            </p>
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={downloadAll}
              className="flex items-center gap-1.5 rounded-[10px] px-3 py-2 text-[13px] font-medium focus:outline-none focus-visible:ring-2 focus-visible:ring-[#007AFF]"
              style={{ background: "rgba(0,0,0,0.05)", color: T.label }}
            >
              <Download size={15} /> Download all
            </button>
            <button
              onClick={() => fileInputRef.current?.click()}
              className="flex items-center gap-1.5 rounded-[10px] px-3 py-2 text-[13px] font-medium focus:outline-none focus-visible:ring-2 focus-visible:ring-[#007AFF]"
              style={{ background: "rgba(0,0,0,0.05)", color: T.label }}
            >
              <Upload size={15} /> Import
            </button>
          </div>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-[1fr_360px] gap-4">
          {/* LEFT — camera + controls */}
          <div className="flex flex-col gap-4">
            <div className="rounded-[18px] overflow-hidden" style={{ background: T.surface, boxShadow: "0 4px 24px rgba(0,0,0,0.06)" }}>
              <div className="relative bg-black/70 aspect-video">
                <video ref={videoRef} className="absolute inset-0 w-full h-full object-cover [transform:scaleX(-1)]" autoPlay muted playsInline />
                <canvas ref={canvasRef} className="absolute inset-0 w-full h-full [transform:scaleX(-1)]" />

                {/* Status overlay */}
                {status !== "ready" && (
                  <div className="absolute inset-0 flex items-center justify-center p-4" style={{ background: "rgba(0,0,0,0.64)", backdropFilter: "blur(6px)" }}>
                    {(status === "idle" || status === "loading-camera" || status === "loading-model") && (
                      <div className="flex flex-col items-center gap-2.5 text-center">
                        <div className="w-7 h-7 border-[2.5px] border-t-transparent rounded-full animate-spin" style={{ borderColor: `${T.blue} ${T.blue} ${T.blue} transparent` }} />
                        <p className="text-[13px]" style={{ color: "rgba(255,255,255,0.7)" }}>{statusLabel[status]}</p>
                      </div>
                    )}
                    {status === "denied" && (
                      <p className="text-[13px] font-semibold text-center max-w-xs" style={{ color: T.red }}>
                        🚫 Camera access denied. Allow it in the browser, then refresh.
                      </p>
                    )}
                    {status === "error" && (
                      <div className="text-center max-w-xs">
                        <p className="text-[13px] font-semibold" style={{ color: T.red }}>⚠️ Failed to start</p>
                        {error && <p className="text-[11px] font-mono mt-1" style={{ color: "rgba(255,255,255,0.7)" }}>{error}</p>}
                      </div>
                    )}
                  </div>
                )}

                {/* REC / countdown badge */}
                {countdown !== null && (
                  <div className="absolute inset-0 flex items-center justify-center">
                    <span className="text-white font-bold" style={{ fontSize: 96, textShadow: "0 2px 12px rgba(0,0,0,0.5)" }}>{countdown}</span>
                  </div>
                )}
                {recording && (
                  <div className="absolute top-2 left-2 flex items-center gap-1.5 rounded-full px-2.5 py-[3px] text-[11px] font-semibold text-white" style={{ background: "rgba(0,0,0,0.55)" }}>
                    <span className="w-[6px] h-[6px] rounded-full animate-pulse" style={{ background: T.red }} />
                    REC · {selectedSign}
                  </div>
                )}
              </div>

              {/* Live readout */}
              <div className="p-4 flex items-center gap-6">
                <Readout label="Pose" value={poseOn ? "Detected" : "—"} color={poseOn ? T.green : T.tertLabel} />
                <Readout label="Hands" value={String(handCount)} color={handCount > 0 ? T.green : T.tertLabel} />
                <Readout label="FPS" value={String(fps)} color={T.label} />
                <div className="ml-auto text-right">
                  <p className="text-[11px]" style={{ color: T.tertLabel }}>Recording into</p>
                  <p className="text-[16px] font-bold" style={{ color: T.label }}>{selectedSign}</p>
                </div>
              </div>
            </div>

            {/* Record control */}
            <div className="p-4 rounded-[18px]" style={{ background: T.surface, boxShadow: "0 4px 24px rgba(0,0,0,0.06)" }}>
              <button
                onClick={startCountdownRecord}
                disabled={status !== "ready" || recording || countdown !== null}
                className="w-full flex items-center justify-center gap-2 rounded-[12px] py-3.5 font-semibold text-white select-none focus:outline-none focus-visible:ring-2 focus-visible:ring-[#007AFF] disabled:opacity-40"
                style={{ background: recording ? T.red : T.blue, fontSize: 15 }}
              >
                <Circle size={14} fill="currentColor" />
                {recording ? "Recording…" : countdown !== null ? `Starting in ${countdown}…` : `Record “${selectedSign}” (Enter)`}
              </button>
              <p className="text-[12px] mt-2.5 text-center" style={{ color: T.secondLabel }}>
                3-2-1 countdown, then ~{(DURATION_MS / 1000).toFixed(1)}s captured at ~{TARGET_FPS}fps. Re-recording overwrites.
              </p>
            </div>
          </div>

          {/* RIGHT — sign list */}
          <div className="rounded-[18px] overflow-hidden flex flex-col" style={{ background: T.surface, boxShadow: "0 4px 24px rgba(0,0,0,0.06)" }}>
            <div className="px-4 pt-4 pb-2" style={{ borderBottom: `1px solid ${T.separator}` }}>
              <p className="text-[15px] font-semibold" style={{ color: T.label }}>Signs to record</p>
              <p className="text-[12px]" style={{ color: T.secondLabel }}>{recordedCount}/{SIGNS.length} recorded · tap to select</p>
            </div>
            <div className="overflow-y-auto" style={{ maxHeight: "70vh" }}>
              {SIGNS.map((s) => {
                const clip = clips[s];
                const done = !!clip?.frames?.length;
                const selected = s === selectedSign;
                return (
                  <div
                    key={s}
                    role="button"
                    tabIndex={0}
                    onClick={() => setSelectedSign(s)}
                    onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); setSelectedSign(s); } }}
                    className="flex items-center gap-3 px-4 py-2.5 cursor-pointer focus:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-[#007AFF]"
                    style={{
                      background: selected ? "rgba(0,122,255,0.08)" : "transparent",
                      borderLeft: selected ? `3px solid ${T.blue}` : "3px solid transparent",
                    }}
                  >
                    <span
                      className="w-5 h-5 rounded-full flex items-center justify-center flex-shrink-0"
                      style={{ background: done ? T.green : "rgba(60,60,67,0.12)" }}
                    >
                      {done && <Check size={13} color="#fff" />}
                    </span>
                    <span className="flex-1 text-[14px] font-medium" style={{ color: T.label }}>{s}</span>
                    <span className="text-[12px] tabular-nums" style={{ color: done ? T.green : T.tertLabel }}>
                      {done ? `${clip.frames.length} frames` : "pending"}
                    </span>
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      </div>

      {/* Toast */}
      {toast && (
        <div
          className="fixed top-4 left-1/2 -translate-x-1/2 z-50 rounded-full px-5 py-2.5 text-[14px] font-medium"
          style={{ background: "rgba(28,28,30,0.90)", color: "#fff", boxShadow: "0 4px 24px rgba(0,0,0,0.25)" }}
        >
          {toast}
        </div>
      )}
    </div>
  );
}

function Readout({ label, value, color }: { label: string; value: string; color: string }) {
  return (
    <div>
      <p className="text-[11px]" style={{ color: T.tertLabel }}>{label}</p>
      <p className="text-[16px] font-semibold tabular-nums" style={{ color }}>{value}</p>
    </div>
  );
}
