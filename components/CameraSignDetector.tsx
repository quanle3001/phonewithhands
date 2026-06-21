"use client";

import { useEffect, useRef, useState } from "react";

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

// MediaPipe WASM and model hosted on CDN — no API key, no server needed
const WASM_CDN =
  "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.14/wasm";
const GESTURE_MODEL =
  "https://storage.googleapis.com/mediapipe-models/gesture_recognizer/gesture_recognizer/float16/1/gesture_recognizer.task";

export default function CameraSignDetector({ onGesture }: CameraSignDetectorProps) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);

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

        // ── Step 2: MediaPipe GestureRecognizer ───────────────────────────
        setStatus("loading-model");
        const { GestureRecognizer, FilesetResolver, DrawingUtils } =
          await import("@mediapipe/tasks-vision");

        if (cancelled) return;

        const vision = await FilesetResolver.forVisionTasks(WASM_CDN);
        recognizer = await GestureRecognizer.createFromOptions(vision, {
          baseOptions: {
            modelAssetPath: GESTURE_MODEL,
            delegate: "GPU",
          },
          runningMode: "VIDEO",
          numHands: 2,
        });

        if (cancelled) return;
        setStatus("ready");

        // ── Step 3: rAF detection loop ────────────────────────────────────
        let lastVideoTime = -1;

        function detectFrame() {
          if (cancelled) return;
          const video = videoRef.current;
          const canvas = canvasRef.current;
          if (!video || !canvas) return;

          const ctx = canvas.getContext("2d");
          if (!ctx) return;

          // Keep canvas in sync with actual video resolution
          if (canvas.width !== video.videoWidth)
            canvas.width = video.videoWidth;
          if (canvas.height !== video.videoHeight)
            canvas.height = video.videoHeight;

          ctx.clearRect(0, 0, canvas.width, canvas.height);

          if (video.currentTime !== lastVideoTime && video.videoWidth > 0) {
            lastVideoTime = video.currentTime;

            const result = recognizer.recognizeForVideo(video, performance.now());
            const drawingUtils = new DrawingUtils(ctx);

            const numHands = result.landmarks?.length ?? 0;
            setHandsDetected(numHands);

            // Draw skeleton on canvas
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

            // Gesture readout (first hand only)
            if (result.gestures?.length > 0) {
              const top = result.gestures[0][0];
              setGesture({ name: top.categoryName, score: top.score });
            } else {
              setGesture(null);
            }
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

      {/* ── Video + canvas overlay ── */}
      <div className="relative bg-black/70 rounded-[10px] overflow-hidden w-full aspect-video">
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

      {/* ── Detection readout — light surface card ── */}
      <div
        className="rounded-[10px] p-3.5 space-y-2.5 transition-opacity"
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
            {gesture ? gesture.name : "None"}
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

        {/* Hint */}
        {status === "ready" && handsDetected === 0 && (
          <p className="text-[11px] text-center pt-0.5" style={{ color: TL }}>
            Show your hand to the camera 👋
          </p>
        )}
      </div>
    </div>
  );
}