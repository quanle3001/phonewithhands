"use client";

import { useEffect, useRef, useState } from "react";
import type { RawLandmark } from "@/lib/landmarks";

// ─────────────────────────────────────────────────────────────────────────────
// HandTracker — reusable webcam + MediaPipe Hands surface.
//
// Owns the camera stream, the GestureRecognizer (which gives us BOTH the 21 hand
// landmarks AND MediaPipe's 7 pretrained gesture labels), the rAF detection loop,
// and the skeleton overlay. It is purely a *source*: every processed frame it
// calls onFrame() with the raw landmarks + pretrained gesture. Consumers
// (CameraSignDetector, the /train page) decide what to do with that data — run a
// KNN, capture a sample, drive the call, etc.
//
// Extracted from the original CameraSignDetector so the trainer and the call
// screen share one proven camera pipeline.
// ─────────────────────────────────────────────────────────────────────────────

type Status =
  | "idle"
  | "loading-camera"
  | "loading-model"
  | "ready"
  | "denied"
  | "error";

export interface RawGesture {
  name: string; // MediaPipe categoryName, e.g. "Open_Palm"
  score: number; // 0..1
}

export interface HandFrame {
  /** First detected hand's 21 landmarks, or null if no hand. */
  landmarks: RawLandmark[] | null;
  /** MediaPipe's pretrained gesture for the first hand, or null. */
  gesture: RawGesture | null;
  /** Number of hands in frame. */
  handCount: number;
}

interface HandTrackerProps {
  onFrame?: (frame: HandFrame) => void;
  /** Optional badge text shown top-left while live (defaults to "LIVE"). */
  badge?: string;
}

const WASM_CDN = "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.14/wasm";
const GESTURE_MODEL =
  "https://storage.googleapis.com/mediapipe-models/gesture_recognizer/gesture_recognizer/float16/1/gesture_recognizer.task";

export default function HandTracker({ onFrame, badge = "LIVE" }: HandTrackerProps) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);

  // Keep the latest onFrame in a ref so the camera effect runs exactly once.
  const onFrameRef = useRef(onFrame);
  onFrameRef.current = onFrame;

  const [status, setStatus] = useState<Status>("idle");
  const [error, setError] = useState<string>("");

  useEffect(() => {
    let rafId: number | null = null;
    let stream: MediaStream | null = null;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let recognizer: any = null;
    let cancelled = false;

    async function init() {
      try {
        // ── Camera ──────────────────────────────────────────────────────────
        setStatus("loading-camera");
        stream = await navigator.mediaDevices.getUserMedia({
          video: { width: { ideal: 640 }, height: { ideal: 480 }, facingMode: "user" },
          audio: false,
        });

        if (cancelled) return;
        const video = videoRef.current!;
        video.srcObject = stream;
        await video.play();
        await new Promise<void>((res) => {
          if (video.readyState >= 3) return res();
          video.addEventListener("loadeddata", () => res(), { once: true });
        });
        if (cancelled) return;

        // ── MediaPipe GestureRecognizer ──────────────────────────────────────
        setStatus("loading-model");
        const { GestureRecognizer, FilesetResolver, DrawingUtils } =
          await import("@mediapipe/tasks-vision");

        if (cancelled) return;

        const vision = await FilesetResolver.forVisionTasks(WASM_CDN);
        recognizer = await GestureRecognizer.createFromOptions(vision, {
          baseOptions: { modelAssetPath: GESTURE_MODEL, delegate: "GPU" },
          runningMode: "VIDEO",
          numHands: 2,
        });

        if (cancelled) return;
        setStatus("ready");

        // ── Detection loop ──────────────────────────────────────────────────
        let lastVideoTime = -1;

        function detectFrame() {
          if (cancelled) return;
          const video = videoRef.current;
          const canvas = canvasRef.current;
          if (!video || !canvas) return;

          const ctx = canvas.getContext("2d");
          if (!ctx) return;

          if (canvas.width !== video.videoWidth) canvas.width = video.videoWidth;
          if (canvas.height !== video.videoHeight) canvas.height = video.videoHeight;

          ctx.clearRect(0, 0, canvas.width, canvas.height);

          if (video.currentTime !== lastVideoTime && video.videoWidth > 0) {
            lastVideoTime = video.currentTime;

            const result = recognizer.recognizeForVideo(video, performance.now());
            const drawingUtils = new DrawingUtils(ctx);

            const handCount = result.landmarks?.length ?? 0;

            if (result.landmarks) {
              for (const landmarks of result.landmarks) {
                drawingUtils.drawConnectors(
                  landmarks,
                  GestureRecognizer.HAND_CONNECTIONS,
                  { color: "#4ade80", lineWidth: 2 }
                );
                drawingUtils.drawLandmarks(landmarks, {
                  color: "#f87171",
                  fillColor: "#ef4444",
                  lineWidth: 1,
                  radius: 4,
                });
              }
            }

            const firstHand: RawLandmark[] | null = result.landmarks?.[0] ?? null;
            let gesture: RawGesture | null = null;
            if (result.gestures?.length > 0) {
              const top = result.gestures[0][0];
              if (top.categoryName && top.categoryName !== "None") {
                gesture = { name: top.categoryName, score: top.score };
              }
            }

            onFrameRef.current?.({ landmarks: firstHand, gesture, handCount });
          }

          rafId = requestAnimationFrame(detectFrame);
        }

        detectFrame();
      } catch (err) {
        if (cancelled) return;
        const e = err as DOMException & Error;
        if (e?.name === "NotAllowedError" || e?.name === "PermissionDeniedError") {
          setStatus("denied");
        } else {
          console.error("[HandTracker]", e);
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

  // ── Render ──────────────────────────────────────────────────────────────────
  const statusLabel: Record<Status, string> = {
    idle: "Initializing…",
    "loading-camera": "Requesting camera…",
    "loading-model": "Loading MediaPipe model…",
    ready: "",
    denied: "Camera access denied",
    error: "Initialization error",
  };

  const OSL = "rgba(255,255,255,0.70)";
  const OTL = "rgba(255,255,255,0.40)";
  const BLUE = "#007AFF";
  const RED = "#FF3B30";

  return (
    <div className="relative bg-black/70 rounded-[10px] overflow-hidden w-full h-full">
      {/* Mirror video so it feels like a mirror */}
      <video
        ref={videoRef}
        className="absolute inset-0 w-full h-full object-cover [transform:scaleX(-1)]"
        autoPlay
        muted
        playsInline
      />
      <canvas
        ref={canvasRef}
        className="absolute inset-0 w-full h-full [transform:scaleX(-1)]"
      />

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
                Click the camera icon in Chrome&apos;s address bar → Allow → then refresh.
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
          {badge}
        </div>
      )}
    </div>
  );
}