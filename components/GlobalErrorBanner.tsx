"use client";

import { useEffect, useState } from "react";

// ─────────────────────────────────────────────────────────────────────────────
// GlobalErrorBanner — catches errors that escape React render, e.g. throws inside
// the MediaPipe rAF loop, async init, or unhandled promise rejections. Renders a
// fixed red banner with the message + first stack lines so a blank/white page on
// Safari becomes a readable error instead of nothing.
//
// Uses only widely-supported APIs (addEventListener "error"/"unhandledrejection").
// ─────────────────────────────────────────────────────────────────────────────

export default function GlobalErrorBanner() {
  const [errors, setErrors] = useState<string[]>([]);

  useEffect(() => {
    function push(msg: string) {
      setErrors((prev) => (prev.includes(msg) ? prev : [...prev, msg].slice(-6)));
    }

    function firstStack(err: unknown): string {
      const stack = (err as { stack?: string })?.stack;
      if (!stack) return "";
      return String(stack).split("\n").slice(0, 5).join("\n");
    }

    function onError(event: ErrorEvent) {
      const detail = event.error ? firstStack(event.error) : `${event.filename}:${event.lineno}:${event.colno}`;
      push(`Error: ${event.message}\n${detail}`);
    }

    function onRejection(event: PromiseRejectionEvent) {
      const reason = event.reason as { message?: string };
      const msg = reason?.message ?? String(event.reason);
      push(`Unhandled promise rejection: ${msg}\n${firstStack(event.reason)}`);
    }

    // ── Silence MediaPipe / TFLite INFO noise that Next.js dev overlay
    // mis-flags as "Console Error". These are benign init logs, e.g.
    // "INFO: Created TensorFlow Lite XNNPACK delegate for CPU." Drop only
    // those exact-shaped lines; everything else passes through untouched.
    const NOISE = /Created TensorFlow Lite XNNPACK delegate|^INFO:|GL version|gl_context|TfLite|XNNPACK/i;
    const origError = console.error;
    const origWarn = console.warn;
    const isNoise = (args: unknown[]) =>
      args.length > 0 && typeof args[0] === "string" && NOISE.test(args[0]);
    console.error = (...args: unknown[]) => { if (isNoise(args)) return; (origError as (...a: unknown[]) => void)(...args); };
    console.warn  = (...args: unknown[]) => { if (isNoise(args)) return; (origWarn  as (...a: unknown[]) => void)(...args); };

    window.addEventListener("error", onError);
    window.addEventListener("unhandledrejection", onRejection);
    return () => {
      window.removeEventListener("error", onError);
      window.removeEventListener("unhandledrejection", onRejection);
      console.error = origError;
      console.warn = origWarn;
    };
  }, []);

  if (errors.length === 0) return null;

  return (
    <div
      style={{
        position: "fixed",
        top: 0,
        left: 0,
        right: 0,
        zIndex: 999999,
        background: "#FF3B30",
        color: "#FFFFFF",
        padding: "10px 40px 10px 14px",
        font: '12px/1.45 ui-monospace, SFMono-Regular, Menlo, monospace',
        maxHeight: "45vh",
        overflow: "auto",
        boxShadow: "0 2px 14px rgba(0,0,0,0.35)",
      }}
      role="alert"
    >
      <div style={{ fontWeight: 700, marginBottom: 6 }}>
        ⚠️ JavaScript error ({errors.length}) — Phone With Hand
      </div>
      <button
        onClick={() => setErrors([])}
        aria-label="Dismiss errors"
        style={{
          position: "fixed",
          top: 8,
          right: 12,
          background: "rgba(255,255,255,0.25)",
          border: "none",
          color: "#FFFFFF",
          borderRadius: 6,
          padding: "3px 9px",
          fontWeight: 700,
          cursor: "pointer",
          zIndex: 1000000,
        }}
      >
        ×
      </button>
      {errors.map((e, i) => (
        <pre key={i} style={{ whiteSpace: "pre-wrap", wordBreak: "break-word", margin: "0 0 8px" }}>
          {e}
        </pre>
      ))}
    </div>
  );
}