"use client";

import { useEffect, useRef, useState } from "react";

// Phase 1.5 — custom-sign (KNN) recognition wired ON TOP of the restored
// MediaPipe pipeline. These are purely additive; the camera/draw code is unchanged.
import { normalizeLandmarks } from "@/lib/landmarks";
import {
  getClassifier,
  reloadFromStorage,
  subscribe,
  hydrateFromSeedIfEmpty,
} from "@/lib/signStore";
import { SIGN_BY_GESTURE, SIGN_BY_ID } from "@/data/signs";

// ---------------------------------------------------------------------------
// Types (mirrors the @mediapipe/tasks-vision API surface we use)
// ---------------------------------------------------------------------------
type Status = "idle" | "loading-camera" | "loading-model" | "ready" | "denied" | "error";

export interface GestureReadout {
  name: string;
  score: number;
}

interface CameraSignDetectorProps {
  onGesture?: (g: GestureReadout | null) => void;
}

// MediaPipe WASM + gesture model — served LOCALLY from /public so opening a call
// has no CDN round-trip. If the local assets are missing we fall back to the CDN.
const WASM_LOCAL = "/mediapipe/wasm";
const WASM_CDN = "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.14/wasm";
const GESTURE_MODEL_LOCAL = "/mediapipe/gesture_recognizer.task";
const GESTURE_MODEL_CDN =
  "https://storage.googleapis.com/mediapipe-models/gesture_recognizer/gesture_recognizer/float16/1/gesture_recognizer.task";

// KNN must clear this confidence before a trained sign is surfaced / overrides a
// pretrained gesture. Matches the call screen's hold-to-confirm threshold (0.6).
const KNN_THRESHOLD = 0.6;

export default function CameraSignDetector({ onGesture }: CameraSignDetectorProps) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  // Tracks the last DISPLAYED readout so we can suppress per-frame flicker.
  const lastSetRef = useRef<{ name: string | null; score: number; t: number }>({
    name: null,
    score: 0,
    t: 0,
  });

  const [status, setStatus] = useState<Status>("idle");
  const [handsDetected, setHandsDetected] = useState(0);
  const [gesture, setGesture] = useState<GestureReadout | null>(null);
  const [error, setError] = useState<string>("");

  useEffect(() => {
    let rafId: number | null = null;
    let stream: MediaStream | null = null;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let recognizer: any = null;
    let cancelled = false;

    async function init() {
      try {
        // ── Step 1: Camera ────────────────────────────────────────────────
        setStatus("loading-camera");
        stream = await navigator.mediaDevices.getUserMedia({
          video: { width: { ideal: 1280 }, height: { ideal: 720 }, facingMode: "user" },
          audio: false,
        });

        if (cancelled) return;
        const video = videoRef.current!;
        video.srcObject = stream;
        // Safari is strict about autoplay: muted + playsInline are required, and
        // play() can still reject. A rejection is non-fatal — the stream is
        // already attached — so log and continue rather than abort init.
        video.muted = true;
        video.setAttribute("playsinline", "true");
        try {
          await video.play();
        } catch (playErr) {
          console.warn("[CameraSignDetector] video.play() rejected (continuing):", playErr);
        }
        await new Promise<void>((res) => {
          if (video.readyState >= 3) return res();
          video.addEventListener("loadeddata", () => res(), { once: true });
        });
        if (cancelled) return;

        // ── Step 2: MediaPipe GestureRecognizer ───────────────────────────
        setStatus("loading-model");
        const { GestureRecognizer, FilesetResolver, DrawingUtils } =
          await import("@mediapipe/tasks-vision");

        if (cancelled) return;

        // Build a recognizer from a given wasm fileset + model, trying the GPU
        // delegate first and falling back to CPU (Safari / some GPUs reject WebGL).
        async function buildRecognizer(wasmPath: string, modelPath: string) {
          const vision = await FilesetResolver.forVisionTasks(wasmPath);
          const make = (delegate: "GPU" | "CPU") =>
            GestureRecognizer.createFromOptions(vision, {
              baseOptions: { modelAssetPath: modelPath, delegate },
              runningMode: "VIDEO",
              numHands: 2,
            });
          try {
            return await make("GPU");
          } catch (gpuErr) {
            console.warn("[CameraSignDetector] GPU delegate failed, using CPU:", gpuErr);
            return await make("CPU");
          }
        }

        // Prefer the self-hosted assets; fall back to the CDN if they're missing.
        try {
          recognizer = await buildRecognizer(WASM_LOCAL, GESTURE_MODEL_LOCAL);
        } catch (localErr) {
          console.warn(
            "[CameraSignDetector] local MediaPipe assets failed, falling back to CDN:",
            localErr
          );
          recognizer = await buildRecognizer(WASM_CDN, GESTURE_MODEL_CDN);
        }

        if (cancelled) return;
        setStatus("ready");

        // ── Step 3: rAF detection loop ────────────────────────────────────
        let lastVideoTime = -1;
        let lastTimestamp = 0;        // strictly-increasing ts for Safari
        let frameErrorLogged = false; // log a bad-frame throw only once

        function detectFrame() {
          if (cancelled) return;
          try {
          const video = videoRef.current;
          const canvas = canvasRef.current;
          if (!video || !canvas) return;

          const ctx = canvas.getContext("2d");
          if (!ctx) return;

          // Size the canvas BACKING STORE to its displayed CSS size × devicePixelRatio
          // so MediaPipe's overlay stays crisp on Retina (no CSS-upscaling blur).
          // DrawingUtils draws normalized [0..1] coords × canvas.width/height, so
          // mapping to the full backing store is all that's needed. Recomputed each
          // frame, so panel resizes are handled automatically.
          const dpr = window.devicePixelRatio || 1;
          const cw = canvas.clientWidth;
          const ch = canvas.clientHeight;
          if (cw === 0 || ch === 0) return;
          const bw = Math.round(cw * dpr);
          const bh = Math.round(ch * dpr);
          if (canvas.width !== bw) canvas.width = bw;
          if (canvas.height !== bh) canvas.height = bh;

          ctx.clearRect(0, 0, canvas.width, canvas.height);

          if (video.currentTime !== lastVideoTime && video.videoWidth > 0) {
            lastVideoTime = video.currentTime;

            // Safari requires a STRICTLY increasing timestamp — guard against
            // duplicate / decreasing performance.now() values (else it throws).
            let ts = performance.now();
            if (ts <= lastTimestamp) ts = lastTimestamp + 1;
            lastTimestamp = ts;

            const result = recognizer.recognizeForVideo(video, ts);
            const drawingUtils = new DrawingUtils(ctx);

            const numHands = result.landmarks?.length ?? 0;
            setHandsDetected(numHands);

            // Draw skeleton on canvas
            if (result.landmarks) {
              for (const landmarks of result.landmarks) {
                drawingUtils.drawConnectors(
                  landmarks,
                  GestureRecognizer.HAND_CONNECTIONS,
                  { color: "#4ade80", lineWidth: 2 * dpr } // ~2 CSS px on any DPR
                );
                drawingUtils.drawLandmarks(landmarks, {
                  color: "#f87171",
                  fillColor: "#ef4444",
                  lineWidth: 1 * dpr,
                  radius: 4 * dpr, // ~4 CSS px on any DPR
                });
              }
            }

            // ── Recognition (first hand): pretrained gesture + trained KNN ──
            // Pretrained candidate — map MediaPipe's category to a canonical id.
            let pretrained: GestureReadout | null = null;
            if (result.gestures?.length > 0) {
              const top = result.gestures[0][0];
              if (top.categoryName && top.categoryName !== "None") {
                const mapped = SIGN_BY_GESTURE.get(top.categoryName);
                if (mapped) pretrained = { name: mapped.id, score: top.score };
              }
            }

            // Trained candidate — KNN over the normalized first-hand landmarks.
            let trained: GestureReadout | null = null;
            const vector = normalizeLandmarks(result.landmarks?.[0]);
            if (vector) {
              const { label, confidence } = getClassifier().predict(vector);
              if (label && confidence >= KNN_THRESHOLD && SIGN_BY_ID.has(label)) {
                trained = { name: label, score: confidence };
              }
            }

            // Prefer the trained sign when confident; else the pretrained gesture.
            // Decouple the DISPLAYED readout from per-frame churn: re-render only on
            // a label change, or a >0.05 score change throttled to ~6/sec. The
            // per-frame computation above still runs, so hold-to-confirm stays correct.
            const current = trained ?? pretrained;
            const prev = lastSetRef.current;
            const curName = current?.name ?? null;
            const curScore = current?.score ?? 0;
            const labelChanged = curName !== prev.name;
            const scoreChanged = Math.abs(curScore - prev.score) > 0.05 && ts - prev.t > 150;
            if (labelChanged || scoreChanged) {
              lastSetRef.current = { name: curName, score: curScore, t: ts };
              setGesture(current);
            }
          }
          } catch (frameErr) {
            // A single bad frame (or a Safari-specific recognizeForVideo throw)
            // must never bubble or stop the loop — log once, skip, keep going.
            if (!frameErrorLogged) {
              frameErrorLogged = true;
              console.error("[CameraSignDetector] detect-frame error (skipping frames):", frameErr);
            }
          }

          if (!cancelled) rafId = requestAnimationFrame(detectFrame);
        }

        detectFrame();
      } catch (err) {
        if (cancelled) return;
        const e = err as DOMException & Error;
        if (e?.name === "NotAllowedError" || e?.name === "PermissionDeniedError") {
          setStatus("denied");
        } else {
          console.error("[CameraSignDetector]", e);
          setError(e?.message ?? String(e));
          setStatus("error");
        }
      }
    }

    init();

    return () => {
      cancelled = true;
      if (rafId !== null) cancelAnimationFrame(rafId);
      recognizer?.close();
      stream?.getTracks().forEach((t) => t.stop());
    };
  }, []);

  // Emit gesture changes to parent (hold-to-confirm lives in the call screen)
  useEffect(() => {
    onGesture?.(gesture);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [gesture?.name, gesture?.score]);

  // Load the bundled seed model (public/sign-model.json) if the user has no local
  // model yet, then stay in sync with the trainer. Keeps trained signs available.
  useEffect(() => {
    let active = true;
    hydrateFromSeedIfEmpty().then(() => {
      if (!active) return;
      reloadFromStorage();
      const c = getClassifier();
      console.log(
        `[CameraSignDetector] sign model loaded — ${c.size()} samples across ${c.trainedLabels().length} signs`
      );
    });
    // NOTE: must NOT call reloadFromStorage() here — it calls notify(),
    // which re-fires this subscriber → infinite recursion (stack overflow).
    // The detector reads getClassifier() live each frame, so no reload is needed;
    // we only need to stay subscribed so the singleton ref stays warm.
    const unsub = subscribe(() => {});
    return () => {
      active = false;
      unsub();
    };
  }, []);

  // ── Render ──────────────────────────────────────────────────────────────

  const statusLabel: Record<Status, string> = {
    idle: "Initializing…",
    "loading-camera": "Requesting camera…",
    "loading-model": "Loading MediaPipe model…",
    ready: "",
    denied: "Camera access denied",
    error: "Initialization error",
  };

  // Light-mode tokens for the stats panel (on white card)
  const L   = "#1D1D1F";
  const SL  = "rgba(60,60,67,0.60)";
  const TL  = "rgba(60,60,67,0.30)";
  // Camera overlay colours — always on dark video bg, so stay white
  const OSL = "rgba(255,255,255,0.70)";
  const OTL = "rgba(255,255,255,0.40)";
  // System colours (light-mode)
  const BLUE  = "#007AFF";
  const GREEN = "#34C759";
  const RED   = "#FF3B30";

  return (
    <div className="flex flex-col gap-2.5 w-full h-full">

      {/* ── Video + canvas overlay — grows to fill the panel ── */}
      <div className="relative bg-black/70 rounded-[10px] overflow-hidden w-full flex-1 min-h-0">
        {/* Mirror video so it feels like a mirror */}
        <video
          ref={videoRef}
          className="absolute inset-0 w-full h-full object-cover [transform:scaleX(-1)]"
          autoPlay
          muted
          playsInline
        />
        {/* Canvas mirrored so landmarks overlay correctly */}
        <canvas
          ref={canvasRef}
          className="absolute inset-0 w-full h-full [transform:scaleX(-1)]"
        />

        {/* Overlay states — text stays white (dark camera bg) */}
        {status !== "ready" && (
          <div
            className="absolute inset-0 flex items-center justify-center rounded-[10px] p-4"
            style={{ background: "rgba(0,0,0,0.64)", backdropFilter: "blur(6px)" }}
          >
            {(status === "loading-camera" || status === "loading-model") && (
              <div className="flex flex-col items-center gap-2.5 text-center">
                <div
                  className="w-7 h-7 border-[2.5px] border-t-transparent rounded-full animate-spin"
                  style={{ borderColor: `${BLUE} ${BLUE} ${BLUE} transparent` }}
                />
                <p className="text-[13px]" style={{ color: OSL }}>
                  {statusLabel[status]}
                </p>
              </div>
            )}

            {status === "denied" && (
              <div className="flex flex-col items-center gap-2 text-center max-w-xs">
                <span className="text-3xl">🚫</span>
                <p className="text-[13px] font-semibold" style={{ color: RED }}>
                  Camera access denied
                </p>
                <p className="text-[11px] leading-relaxed" style={{ color: OSL }}>
                  Click the camera icon in Chrome&apos;s address bar → Allow →
                  then refresh.
                </p>
              </div>
            )}

            {status === "error" && (
              <div className="flex flex-col items-center gap-2 text-center max-w-xs">
                <span className="text-3xl">⚠️</span>
                <p className="text-[13px] font-semibold" style={{ color: RED }}>
                  Failed to start
                </p>
                {error && (
                  <p
                    className="text-[11px] font-mono rounded-[6px] px-2 py-1"
                    style={{ background: "rgba(255,255,255,0.10)", color: OSL }}
                  >
                    {error}
                  </p>
                )}
                <p className="text-[11px]" style={{ color: OTL }}>
                  Check the browser console.
                </p>
              </div>
            )}

            {status === "idle" && (
              <div className="flex flex-col items-center gap-2">
                <div
                  className="w-6 h-6 border-2 border-t-transparent rounded-full animate-spin"
                  style={{ borderColor: `${OTL} ${OTL} ${OTL} transparent` }}
                />
                <p className="text-[11px]" style={{ color: OTL }}>Starting…</p>
              </div>
            )}
          </div>
        )}

        {/* Live badge — dark pill on dark camera feed */}
        {status === "ready" && (
          <div
            className="absolute top-2 left-2 flex items-center gap-1.5 rounded-full
              px-2.5 py-[3px] text-[11px] font-semibold text-white"
            style={{ background: "rgba(0,0,0,0.55)", backdropFilter: "blur(6px)" }}
          >
            <span
              className="w-[6px] h-[6px] rounded-full animate-pulse"
              style={{ background: RED }}
            />
            LIVE
          </div>
        )}
      </div>

      {/* ── Detection readout — light surface card, pinned below the camera ── */}
      <div
        className="flex-shrink-0 rounded-[10px] p-3.5 space-y-2.5 transition-opacity"
        style={{
          background: "#FFFFFF",
          border:     "1px solid rgba(60,60,67,0.12)",
          boxShadow:  "0 2px 8px rgba(0,0,0,0.06)",
          opacity:    status === "ready" ? 1 : 0.45,
        }}
      >
        {/* Hands detected */}
        <div className="flex items-center justify-between">
          <span className="text-[13px]" style={{ color: SL }}>Hands detected</span>
          <span className="text-[13px] font-semibold tabular-nums" style={{ color: L }}>
            {handsDetected}{" "}
            {handsDetected === 1 ? "✋" : handsDetected === 2 ? "🙌" : "—"}
          </span>
        </div>

        {/* Gesture */}
        <div className="flex items-center justify-between">
          <span className="text-[13px]" style={{ color: SL }}>Gesture</span>
          <span
            className="text-[13px] font-semibold"
            style={{ color: gesture ? GREEN : TL }}
          >
            {gesture ? (SIGN_BY_ID.get(gesture.name)?.display ?? gesture.name) : "None"}
          </span>
        </div>

        {/* Confidence — systemBlue progress bar */}
        <div className="space-y-1">
          <div className="flex items-center justify-between">
            <span className="text-[11px]" style={{ color: TL }}>Confidence</span>
            <span className="text-[11px] tabular-nums" style={{ color: TL }}>
              {gesture ? `${(gesture.score * 100).toFixed(0)}%` : "—"}
            </span>
          </div>
          <div
            className="w-full h-[4px] rounded-full overflow-hidden"
            style={{ background: "rgba(60,60,67,0.10)" }}
          >
            <div
              className="h-full rounded-full transition-all duration-200"
              style={{
                width:      gesture ? `${gesture.score * 100}%` : "0%",
                background: BLUE,
              }}
            />
          </div>
        </div>

        {/* Hint — always occupies its slot (visibility toggled) so the card
            height never shifts when a hand appears / disappears. */}
        <p
          className="text-[11px] text-center pt-0.5"
          style={{
            color: TL,
            visibility: status === "ready" && handsDetected === 0 ? "visible" : "hidden",
          }}
        >
          Show your hand to the camera 👋
        </p>
      </div>
    </div>
  );
}