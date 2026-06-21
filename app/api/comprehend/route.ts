import { NextRequest, NextResponse } from "next/server";

// ─────────────────────────────────────────────────────────────────────────────
// /api/comprehend — caller speech → structured comprehension (Phase 2).
//
// The OPPOSITE direction of /api/ai (which turns a Deaf user's ASL gloss into
// spoken English). Here a hearing caller's transcript is turned into a plain
// restatement + tone + key facts + ASL-style gloss tokens, so the Deaf user can
// understand what was said. Reuses the same ASI:1 (Fetch.ai) client pattern.
// ─────────────────────────────────────────────────────────────────────────────

const ASI1_URL = "https://api.asi1.ai/v1/chat/completions";
const ASI1_MODEL = "asi1-mini";

interface Body {
  transcript?: string;
}

function buildPrompt(transcript: string) {
  return [
    {
      role: "system",
      content:
        "You help a Deaf user understand what a hearing caller said on a phone call. " +
        "Given the caller's transcribed speech, respond ONLY as compact JSON with EXACTLY these keys: " +
        '"meaning" (a plain, simple one-sentence restatement of what the caller said), ' +
        '"tone" (ONE word describing how it was said: Friendly, Urgent, Neutral, Reassuring, Apologetic, Formal, Happy, or Serious), ' +
        '"keyInfo" (array of short strings — the key facts, instructions, times, dates, amounts, or items the user must remember), ' +
        '"gloss" (array of UPPERCASE ASL-style gloss tokens that convey the meaning, e.g. ["YOU","BRING","INSURANCE-CARD"]). ' +
        "No markdown, no code fences, no extra text.",
    },
    {
      role: "user",
      content: 'Caller said: "' + transcript + '"\nReturn the JSON now.',
    },
  ];
}

export async function POST(req: NextRequest) {
  let body: Body;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ fallback: true, error: "bad json" }, { status: 400 });
  }

  const transcript = typeof body.transcript === "string" ? body.transcript.trim() : "";
  if (!transcript) {
    return NextResponse.json({ fallback: true, error: "no transcript" });
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
        messages: buildPrompt(transcript),
        max_tokens: 320,
        temperature: 0.3,
      }),
    });

    if (!resp.ok) {
      return NextResponse.json({ fallback: true, error: "asi1 " + resp.status });
    }

    const data = await resp.json();
    let raw: string = data?.choices?.[0]?.message?.content ?? "";

    // Strip code fences, then extract the JSON object (robust to stray text).
    raw = raw.replace(/```json/gi, "").replace(/```/g, "").trim();
    const match = raw.match(/\{[\s\S]*\}/);
    if (!match) {
      return NextResponse.json({ fallback: true, error: "no json in output" });
    }

    const parsed = JSON.parse(match[0]);
    const meaning: string = typeof parsed.meaning === "string" ? parsed.meaning.trim() : "";
    const tone: string =
      typeof parsed.tone === "string" && parsed.tone.trim() ? parsed.tone.trim() : "Neutral";
    const keyInfo: string[] = Array.isArray(parsed.keyInfo)
      ? parsed.keyInfo.filter((x: unknown): x is string => typeof x === "string" && x.trim() !== "").map((x: string) => x.trim()).slice(0, 8)
      : [];
    const gloss: string[] = Array.isArray(parsed.gloss)
      ? parsed.gloss.filter((x: unknown): x is string => typeof x === "string" && x.trim() !== "").map((x: string) => x.trim().toUpperCase()).slice(0, 16)
      : [];

    if (!meaning) {
      return NextResponse.json({ fallback: true, error: "empty meaning" });
    }

    return NextResponse.json({ meaning, tone, keyInfo, gloss, source: "ai" });
  } catch (err) {
    return NextResponse.json({ fallback: true, error: String(err) });
  }
}
