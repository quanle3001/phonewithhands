"use client";

import React from "react";

// ─────────────────────────────────────────────────────────────────────────────
// CallErrorBoundary — catches errors thrown during render of the call screen and
// shows a readable fallback (message + stack) instead of a blank/white page.
// (Errors outside React render are caught separately by GlobalErrorBanner.)
// ─────────────────────────────────────────────────────────────────────────────

interface Props {
  children: React.ReactNode;
}
interface State {
  error: Error | null;
}

export default class CallErrorBoundary extends React.Component<Props, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error, info: React.ErrorInfo) {
    console.error("[CallErrorBoundary] render error:", error, info?.componentStack);
  }

  render() {
    const { error } = this.state;
    if (!error) return this.props.children;

    return (
      <div
        style={{
          minHeight: "100vh",
          background: "#F5F5F7",
          color: "#1D1D1F",
          padding: "32px 20px",
          font: "14px/1.5 -apple-system, BlinkMacSystemFont, system-ui, sans-serif",
        }}
      >
        <div
          style={{
            maxWidth: 720,
            margin: "0 auto",
            background: "#FFFFFF",
            borderRadius: 18,
            boxShadow: "0 4px 24px rgba(0,0,0,0.08)",
            border: "1px solid rgba(60,60,67,0.12)",
            overflow: "hidden",
          }}
        >
          <div style={{ padding: "18px 22px", borderBottom: "1px solid rgba(60,60,67,0.12)" }}>
            <p style={{ fontSize: 20, fontWeight: 700, letterSpacing: "-0.02em", margin: 0 }}>
              ⚠️ The call screen hit an error
            </p>
            <p style={{ fontSize: 13, color: "rgba(60,60,67,0.60)", margin: "6px 0 0" }}>
              This panel replaces the blank page so the error is readable. Send this text back.
            </p>
          </div>

          <div style={{ padding: "18px 22px" }}>
            <p style={{ fontWeight: 600, margin: "0 0 6px", color: "#FF3B30" }}>
              {error.name}: {error.message}
            </p>
            <pre
              style={{
                whiteSpace: "pre-wrap",
                wordBreak: "break-word",
                background: "rgba(0,0,0,0.04)",
                border: "1px solid rgba(60,60,67,0.12)",
                borderRadius: 10,
                padding: "12px 14px",
                margin: "0 0 16px",
                maxHeight: "45vh",
                overflow: "auto",
                font: "12px/1.45 ui-monospace, SFMono-Regular, Menlo, monospace",
              }}
            >
              {error.stack ?? "(no stack available)"}
            </pre>

            <a
              href="/"
              style={{
                display: "inline-block",
                background: "#007AFF",
                color: "#FFFFFF",
                borderRadius: 12,
                padding: "10px 24px",
                fontSize: 15,
                fontWeight: 600,
                textDecoration: "none",
              }}
            >
              ← Back to Contacts
            </a>
          </div>
        </div>
      </div>
    );
  }
}
