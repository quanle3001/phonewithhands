import { NextRequest, NextResponse } from "next/server";

// ASI:1 (Fetch.ai) — OpenAI-compatible chat completions
const ASI1_URL   = "https://api.asi1.ai/v1/chat/completions";
const ASI1_MODEL = "asi1-mini";

const TONES = ["friendly", "polite", "happy", "calm", "grateful", "urgent"] as const;
type Tone = (typeof TONES)[number];

interface AiBody {
  glosses: string[];
  context?: string;
}

function buildPrompt(glosses: string[], context?: string) {
  const gloss = glosses.join(" ");
  return [
    {
      role: "system",
      content:
        "You convert American Sign Language gloss (uppercase keywords) into a single, " +
        "natural spoken English sentence for a Deaf user making a phone call. " +
        "Keep it short, warm, and first-person. Also pick the emotional tone. " +
        "Respond ONLY as compact JSON: {\"phrase\": string, \"tone\": one of " +
        TONES.map((t) => '"' + t + '"').join(", ") + "}. No extra text.",
    },
    {
      role: "user",
      content:
        (context ? "Call context: " + context + "\n" : "") +
        "ASL gloss: " + gloss + "\nReturn the JSON now.",
    },
  ];
}

export async function POST(req: NextRequest) {
  let body: AiBody;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ fallback: true, error: "bad json" }, { status: 400 });
  }
  const glosses = Array.isArray(body.glosses) ? body.glosses : [];
  if (glosses.length === 0) {
    return NextResponse.json({ fallback: true, error: "no glosses" });
  }

  const key = process.env.ASI1_API_KEY;
  if (!key) {
    // No key configured → let the client use its rule-based fallback.
    return NextResponse.json({ fallback: true, error: "no key" });
  }

  try {
    const resp = await fetch(ASI1_URL, {
      method: "POST",
      headers: {
        Authorization: "Bearer " + key,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: ASI1_MODEL,
        messages: buildPrompt(glosses, body.context),
        max_tokens: 120,
        temperature: 0.5,
      }),
    });

    if (!resp.ok) {
      return NextResponse.json({ fallback: true, error: "asi1 " + resp.status });
    }

    const data = await resp.json();
    const raw: string = data?.choices?.[0]?.message?.content ?? "";

    // Extract JSON object from the model output (robust to stray text).
    const match = raw.match(/\{[\s\S]*\}/);
    if (!match) {
      return NextResponse.json({ fallback: true, error: "no json in output" });
    }
    const parsed = JSON.parse(match[0]);
    const phrase: string = typeof parsed.phrase === "string" ? parsed.phrase.trim() : "";
    const tone: Tone = TONES.includes(parsed.tone) ? parsed.tone : "calm";
    if (!phrase) {
      return NextResponse.json({ fallback: true, error: "empty phrase" });
    }

    return NextResponse.json({ phrase, tone, source: "ai" });
  } catch (err) {
    return NextResponse.json({ fallback: true, error: String(err) });
  }
}
