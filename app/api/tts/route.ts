import { NextRequest, NextResponse } from "next/server";

const GEORGE_VOICE_ID = "JBFqnCBsd6RMkjVDRZzb";
const MODEL = "eleven_multilingual_v2";

type VoiceSettings = {
  stability:         number;
  similarity_boost:  number;
  style:             number;
  use_speaker_boost: boolean;
};

function voiceSettings(tone?: string): VoiceSettings {
  switch (tone) {
    case "happy":
    case "grateful": return { stability: 0.35, similarity_boost: 0.80, style: 0.65, use_speaker_boost: true };
    case "friendly": return { stability: 0.50, similarity_boost: 0.80, style: 0.45, use_speaker_boost: true };
    case "urgent":   return { stability: 0.40, similarity_boost: 0.80, style: 0.55, use_speaker_boost: true };
    case "polite":   return { stability: 0.60, similarity_boost: 0.75, style: 0.30, use_speaker_boost: true };
    case "calm":
    default:         return { stability: 0.70, similarity_boost: 0.75, style: 0.20, use_speaker_boost: true };
  }
}

export async function POST(req: NextRequest) {
  const apiKey = process.env.ELEVENLABS_API_KEY;
  if (!apiKey) {
    return NextResponse.json({ fallback: true, error: "TTS not configured" });
  }

  let text: string, tone: string | undefined, voiceId: string;
  try {
    const body = await req.json();
    text    = body.text    ?? "";
    tone    = body.tone;
    voiceId = body.voiceId ?? GEORGE_VOICE_ID;
  } catch {
    return NextResponse.json({ fallback: true, error: "Invalid request body" });
  }

  if (!text.trim()) {
    return NextResponse.json({ fallback: true, error: "Empty text" });
  }

  try {
    const response = await fetch(
      `https://api.elevenlabs.io/v1/text-to-speech/${voiceId}`,
      {
        method:  "POST",
        headers: {
          "xi-api-key":   apiKey,
          "Content-Type": "application/json",
          "Accept":       "audio/mpeg",
        },
        body: JSON.stringify({
          text,
          model_id:       MODEL,
          voice_settings: voiceSettings(tone),
        }),
      }
    );

    if (!response.ok) {
      const errText = await response.text().catch(() => response.statusText);
      return NextResponse.json({ fallback: true, error: `ElevenLabs ${response.status}: ${errText}` });
    }

    const audio = await response.arrayBuffer();
    return new NextResponse(audio, {
      status:  200,
      headers: {
        "Content-Type":   "audio/mpeg",
        "Content-Length": String(audio.byteLength),
      },
    });
  } catch (err) {
    return NextResponse.json({ fallback: true, error: String(err) });
  }
}
