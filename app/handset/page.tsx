"use client";

import { useEffect, useRef, useState } from "react";
import { Mic, MicOff, PhoneOff, Phone } from "lucide-react";
import { getHandset } from "@/lib/handset";

// ─────────────────────────────────────────────────────────────────────────────
// /handset — the iPhone handset page. Open this in iOS Safari via the HTTPS ngrok
// URL (iOS blocks mic on http). Tap "Start call" (a user gesture is required to
// start the mic + unlock audio). Captures mic → bridge; plays the Mac's TTS reply.
// NO camera, NO avatar here.
// ─────────────────────────────────────────────────────────────────────────────

const T = {
  bg: "#0B0B0F",
  card: "#16161C",
  label: "#FFFFFF",
  sub: "rgba(255,255,255,0.6)",
  green: "#34C759",
  red: "#FF3B30",
  blue: "#0A84FF",
};

export default function HandsetPage() {
  const [started, setStarted] = useState(false);
  const [peer, setPeer] = useState(false);
  const [muted, setMuted] = useState(false);
  const [level, setLevel] = useState(0);
  const [notice, setNotice] = useState<string | null>(null);
  const levelRef = useRef(0);

  // Smooth the meter a touch via rAF so it doesn't thrash React.
  useEffect(() => {
    let raf = 0;
    const tick = () => { setLevel((l) => l + (levelRef.current - l) * 0.3); raf = requestAnimationFrame(tick); };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, []);

  useEffect(() => () => { try { getHandset().close(); } catch { /* noop */ } }, []);

  async function startCall() {
    setNotice(null);
    const h = getHandset();
    h.onPeer((role, connected) => { if (role === "mac") setPeer(connected); });
    h.onLevel((lv) => { levelRef.current = lv; });
    try {
      h.connect("phone");
      await h.startPlayback();   // unlock audio output on this user gesture
      await h.startMic();        // start capturing the caller's voice
      setStarted(true);
    } catch (e) {
      console.warn("[handset] start failed:", e);
      setNotice("Microphone blocked. Use the HTTPS link and allow mic access, then tap Start again.");
    }
  }

  function toggleMute() {
    const h = getHandset();
    const next = !muted;
    setMuted(next);
    h.setMuted(next);
  }

  function endCall() {
    try { getHandset().close(); } catch { /* noop */ }
    setStarted(false);
    setPeer(false);
  }

  const meterPct = Math.round(Math.min(1, level) * 100);

  return (
    <div className="min-h-screen flex flex-col items-center justify-between" style={{ background: T.bg, color: T.label, padding: "28px 20px 36px" }}>
      {/* Top status */}
      <div className="w-full max-w-[460px] text-center" style={{ paddingTop: 12 }}>
        <p style={{ fontSize: 13, letterSpacing: "0.18em", textTransform: "uppercase", color: T.sub }}>Phone With Hand</p>
        <h1 style={{ fontSize: 30, fontWeight: 700, marginTop: 8 }}>Handset</h1>
        <div
          className="inline-flex items-center gap-2 mt-4 rounded-full px-4 py-2"
          style={{ background: T.card, border: "1px solid rgba(255,255,255,0.08)" }}
        >
          <span className="w-2.5 h-2.5 rounded-full" style={{ background: started ? (peer ? T.green : "#FFD60A") : T.sub }} />
          <span style={{ fontSize: 15, fontWeight: 600 }}>
            {!started ? "Not started" : peer ? "Connected to Mac" : "Waiting for Mac…"}
          </span>
        </div>
      </div>

      {/* Center: big call indicator + level meter */}
      <div className="w-full max-w-[460px] flex flex-col items-center gap-8">
        <div
          className="rounded-full flex items-center justify-center"
          style={{
            width: 168, height: 168, borderRadius: 999,
            background: started ? "rgba(52,199,89,0.12)" : "rgba(255,255,255,0.06)",
            border: `2px solid ${started ? T.green : "rgba(255,255,255,0.12)"}`,
            transform: `scale(${started ? 1 + Math.min(0.12, level * 0.18) : 1})`,
            transition: "transform 80ms linear",
          }}
        >
          <span style={{ fontSize: 64 }}>{started ? "📞" : "🤙"}</span>
        </div>

        {/* mic level meter */}
        <div className="w-full">
          <div className="flex items-center justify-between mb-2" style={{ color: T.sub, fontSize: 13 }}>
            <span>Mic level</span>
            <span>{started ? (muted ? "Muted" : `${meterPct}%`) : "—"}</span>
          </div>
          <div className="w-full rounded-full overflow-hidden" style={{ height: 10, background: "rgba(255,255,255,0.08)" }}>
            <div className="h-full rounded-full" style={{ width: `${muted ? 0 : meterPct}%`, background: muted ? T.sub : T.green, transition: "width 80ms linear" }} />
          </div>
        </div>

        {notice && (
          <p className="text-center" style={{ color: T.red, fontSize: 14, lineHeight: 1.5 }}>{notice}</p>
        )}
      </div>

      {/* Bottom controls */}
      <div className="w-full max-w-[460px]">
        {!started ? (
          <button
            onClick={startCall}
            className="w-full flex items-center justify-center gap-3 rounded-[18px] focus:outline-none"
            style={{ background: T.green, color: "#06210F", fontSize: 20, fontWeight: 700, padding: "20px 0" }}
          >
            <Phone size={24} /> Start call
          </button>
        ) : (
          <div className="grid grid-cols-2 gap-3">
            <button
              onClick={toggleMute}
              className="flex items-center justify-center gap-2 rounded-[16px] focus:outline-none"
              style={{ background: muted ? "rgba(255,255,255,0.10)" : T.card, color: T.label, fontSize: 17, fontWeight: 600, padding: "18px 0", border: "1px solid rgba(255,255,255,0.10)" }}
            >
              {muted ? <MicOff size={20} /> : <Mic size={20} />} {muted ? "Unmute" : "Mute"}
            </button>
            <button
              onClick={endCall}
              className="flex items-center justify-center gap-2 rounded-[16px] focus:outline-none"
              style={{ background: T.red, color: "#fff", fontSize: 17, fontWeight: 700, padding: "18px 0" }}
            >
              <PhoneOff size={20} /> End
            </button>
          </div>
        )}
        <p className="text-center mt-4" style={{ color: T.sub, fontSize: 12, lineHeight: 1.5 }}>
          Hold the phone to your ear like a normal call. The caller&apos;s voice is captured here; the reply plays from this speaker.
        </p>
      </div>
    </div>
  );
}
