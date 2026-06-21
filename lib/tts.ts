import type { Tone } from "@/data/signs";

let currentAudio: HTMLAudioElement | null = null;

export function cancel(): void {
  if (currentAudio) {
    currentAudio.pause();
    currentAudio = null;
  }
  if (typeof window !== "undefined" && window.speechSynthesis) {
    window.speechSynthesis.cancel();
  }
}

interface SpeakOpts {
  tone?:    Tone;
  voiceId?: string;
}

export async function speak(text: string, opts?: SpeakOpts): Promise<void> {
  cancel();
  try {
    const res = await fetch("/api/tts", {
      method:  "POST",
      headers: { "Content-Type": "application/json" },
      body:    JSON.stringify({ text, tone: opts?.tone, voiceId: opts?.voiceId }),
    });

    const contentType = res.headers.get("Content-Type") ?? "";
    if (contentType.includes("audio")) {
      const blob = new Blob([await res.arrayBuffer()], { type: "audio/mpeg" });
      const url  = URL.createObjectURL(blob);
      const audio = new Audio(url);
      currentAudio = audio;
      audio.addEventListener("ended", () => { URL.revokeObjectURL(url); if (currentAudio === audio) currentAudio = null; });
      audio.addEventListener("error", () => { URL.revokeObjectURL(url); if (currentAudio === audio) currentAudio = null; });
      await audio.play();
      return;
    }
  } catch {
    // fall through to Web Speech
  }
  speakFallback(text);
}

function speakFallback(text: string): void {
  if (typeof window === "undefined" || !window.speechSynthesis) return;
  const utter = new SpeechSynthesisUtterance(text);
  utter.rate  = 0.92;
  utter.pitch = 1.0;
  const voices = window.speechSynthesis.getVoices();
  const en = voices.find((v) => v.lang.startsWith("en") && !v.name.includes("Google"));
  if (en) utter.voice = en;
  window.speechSynthesis.speak(utter);
}
