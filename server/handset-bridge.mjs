import httpProxy from "http-proxy";// ─────────────────────────────────────────────────────────────────────────────
// handset-bridge.mjs — standalone WS relay between the Mac translator UI ("mac")
// and the iPhone handset ("phone"). NO Twilio / PSTN — pure LAN/tunnel bridge.
//
// AUDIO FORMAT (both directions): 16-bit signed PCM, little-endian, MONO, 16000 Hz.
//   phone → bridge : {type:"mic",   seq, pcm}  base64 PCM chunks (~250ms)
//   bridge → mac   : {type:"transcript", text}  (after VAD + ElevenLabs Scribe STT)
//   mac   → bridge : {type:"speak", text}        → ElevenLabs TTS (pcm_16000)
//   bridge → phone : {type:"audio", pcm}         base64 PCM for speaker playback
//   either → either: {type:"status", ...}        relayed verbatim
//   {type:"peer", role, connected} announces peer presence to the other side.
//
// Run:  npm run handset   (HANDSET_PORT, default 5051)
// ngrok should tunnel THIS port (5051) so the iPhone's wss reaches the bridge.
// ─────────────────────────────────────────────────────────────────────────────

import http from "node:http";
import express from "express";
import dotenv from "dotenv";
import { WebSocketServer } from "ws";

dotenv.config({ path: ".env.local" });

const PORT = Number(process.env.HANDSET_PORT || 5051);
const ELEVEN_KEY = process.env.ELEVENLABS_API_KEY || "";
const VOICE_ID = process.env.ELEVENLABS_VOICE_ID || "JBFqnCBsd6RMkjVDRZzb"; // George

const STT_URL = "https://api.elevenlabs.io/v1/speech-to-text";
const TTS_URL = `https://api.elevenlabs.io/v1/text-to-speech/${VOICE_ID}?output_format=pcm_16000`;

// ── Audio constants (keep consistent everywhere) ─────────────────────────────
const SAMPLE_RATE = 16000;
const VAD_RMS = 0.006;        // speech energy threshold (0..1) — lower = more sensitive
const SILENCE_MS = 700;       // trailing silence that ends an utterance
const MIN_SPEECH_MS = 300;    // ignore blips shorter than this
const MAX_UTTER_MS = 8000;    // hard cap per utterance
const PREROLL_CHUNKS = 3;     // keep ~2 chunks (~250-500ms) before speech onset

// ── Rooms ────────────────────────────────────────────────────────────────────
/** room -> { mac, phone, vad } */
const rooms = new Map();
function getRoom(name) {
  let r = rooms.get(name);
  if (!r) { r = { mac: null, phone: null, vad: newVad() }; rooms.set(name, r); }
  return r;
}
function newVad() {
  return { chunks: [], preroll: [], speaking: false, silenceMs: 0, speechMs: 0, totalMs: 0, busy: false };
}
function send(ws, obj) {
  try { if (ws && ws.readyState === ws.OPEN) ws.send(JSON.stringify(obj)); } catch (e) { console.warn("[bridge] send failed:", e?.message || e); }
}

// ── PCM helpers ──────────────────────────────────────────────────────────────
function rmsOfPcm(buf) {
  const n = Math.floor(buf.length / 2);
  if (n === 0) return 0;
  let sum = 0;
  for (let i = 0; i < n; i++) {
    const s = buf.readInt16LE(i * 2) / 32768;
    sum += s * s;
  }
  return Math.sqrt(sum / n);
}
function pcmMs(buf) { return (buf.length / 2) / (SAMPLE_RATE / 1000); }

// Build a 44-byte WAV header + PCM body (16kHz mono 16-bit).
function pcmToWav(pcm) {
  const channels = 1, bits = 16, rate = SAMPLE_RATE;
  const byteRate = (rate * channels * bits) / 8;
  const blockAlign = (channels * bits) / 8;
  const header = Buffer.alloc(44);
  header.write("RIFF", 0);
  header.writeUInt32LE(36 + pcm.length, 4);
  header.write("WAVE", 8);
  header.write("fmt ", 12);
  header.writeUInt32LE(16, 16);       // fmt chunk size
  header.writeUInt16LE(1, 20);        // PCM
  header.writeUInt16LE(channels, 22);
  header.writeUInt32LE(rate, 24);
  header.writeUInt32LE(byteRate, 28);
  header.writeUInt16LE(blockAlign, 32);
  header.writeUInt16LE(bits, 34);
  header.write("data", 36);
  header.writeUInt32LE(pcm.length, 40);
  return Buffer.concat([header, pcm]);
}

// ── ElevenLabs: STT (Scribe) + TTS ───────────────────────────────────────────
async function transcribe(pcm) {
  if (!ELEVEN_KEY) { console.warn("[bridge] no ELEVENLABS_API_KEY → skip STT"); return null; }
  try {
    const wav = pcmToWav(pcm);
    const fd = new FormData();
    fd.append("file", new Blob([wav], { type: "audio/wav" }), "caller.wav");
    fd.append("model_id", "scribe_v1");
    fd.append("language_code", "eng");      // English only
    fd.append("tag_audio_events", "false"); // skip [laughter] etc.
    const res = await fetch(STT_URL, { method: "POST", headers: { "xi-api-key": ELEVEN_KEY }, body: fd });
    if (!res.ok) { console.warn("[bridge] STT HTTP", res.status); return null; }
    const j = await res.json();
    const text = (j && typeof j.text === "string") ? j.text.trim() : "";
    return text || null;
  } catch (e) {
    console.warn("[bridge] STT error:", e?.message || e);
    return null;
  }
}

async function synthesize(text) {
  if (!ELEVEN_KEY) { console.warn("[bridge] no ELEVENLABS_API_KEY → skip TTS"); return null; }
  try {
    const res = await fetch(TTS_URL, {
      method: "POST",
      headers: { "xi-api-key": ELEVEN_KEY, "Content-Type": "application/json" },
      body: JSON.stringify({ text, model_id: "eleven_turbo_v2_5" }),
    });
    if (!res.ok) { console.warn("[bridge] TTS HTTP", res.status); return null; }
    const ab = await res.arrayBuffer();
    return Buffer.from(ab); // raw PCM 16-bit 16kHz mono
  } catch (e) {
    console.warn("[bridge] TTS error:", e?.message || e);
    return null;
  }
}

// ── VAD: accumulate phone mic, finalize utterances, STT → mac ────────────────
async function onMicChunk(room, b64) {
  const v = room.vad;
  let buf;
  try { buf = Buffer.from(b64, "base64"); } catch { return; }
  if (!buf || buf.length < 2) return;

  const energy = rmsOfPcm(buf);
  const ms = pcmMs(buf);
  const voiced = energy > VAD_RMS;

  if (voiced) {
    if (!v.speaking) {
      // Speech just started — prepend the pre-roll so word onsets aren't clipped.
      for (const p of v.preroll) v.chunks.push(p);
      v.preroll = [];
      v.speaking = true;
    }
    v.speechMs += ms;
    v.silenceMs = 0;
    v.chunks.push(buf);
  } else if (v.speaking) {
    v.silenceMs += ms;
    v.chunks.push(buf); // keep trailing silence for a natural tail
  } else {
    // Pre-speech silence — keep a short rolling buffer of recent chunks.
    v.preroll.push(buf);
    while (v.preroll.length > PREROLL_CHUNKS) v.preroll.shift();
  }
  if (v.speaking) v.totalMs += ms;

  const endBySilence = v.speaking && v.silenceMs >= SILENCE_MS && v.speechMs >= MIN_SPEECH_MS;
  const endByCap = v.totalMs >= MAX_UTTER_MS && v.speechMs >= MIN_SPEECH_MS;
  if ((endBySilence || endByCap) && !v.busy) {
    const pcm = Buffer.concat(v.chunks);
    room.vad = newVad();      // reset for the next utterance
    room.vad.busy = true;     // guard while STT runs
    const text = await transcribe(pcm);
    room.vad.busy = false;
    if (text) {
      console.log("[bridge] transcript:", text);
      send(room.mac, { type: "transcript", text });
    }
  }
}

async function onSpeak(room, text) {
  if (!text || !text.trim()) return;
  const pcm = await synthesize(text.trim());
  if (!pcm) return;
  send(room.phone, { type: "audio", pcm: pcm.toString("base64") });
}

// ── Server ───────────────────────────────────────────────────────────────────
// Single-origin proxy: this bridge serves /ws itself and forwards EVERY other
// request (pages, assets, Next HMR) to the Next dev server on :3000. That lets
// one ngrok tunnel (to THIS port) serve both the iPhone handset page and the
// audio WebSocket — required because free ngrok gives only one hostname.
const NEXT_TARGET = process.env.NEXT_TARGET || "http://localhost:3000";
const proxy = httpProxy.createProxyServer({ target: NEXT_TARGET, ws: true, changeOrigin: true });
proxy.on("error", (e) => console.warn("[bridge] proxy error:", e?.message || e));

const server = http.createServer((req, res) => {
  if (req.url === "/healthz") { res.writeHead(200); res.end("handset bridge ok"); return; }
  proxy.web(req, res);
});
const wss = new WebSocketServer({ noServer: true });
server.on("upgrade", (req, socket, head) => {
  if (req.url && req.url.startsWith("/ws")) {
    wss.handleUpgrade(req, socket, head, (ws) => wss.emit("connection", ws, req));
  } else {
    proxy.ws(req, socket, head); // forward Next HMR etc.
  }
});

wss.on("connection", (ws) => {
  let room = null;
  let role = null;

  ws.on("message", (data) => {
    let msg;
    try { msg = JSON.parse(data.toString()); } catch { return; }
    if (!msg || typeof msg !== "object") return;

    try {
      if (msg.type === "hello") {
        role = msg.role === "mac" ? "mac" : "phone";
        room = getRoom(msg.room || "demo");
        // latest of each role wins
        const prev = room[role];
        if (prev && prev !== ws) { try { prev.close(); } catch {} }
        room[role] = ws;
        const otherRole = role === "mac" ? "phone" : "mac";
        // tell the joiner whether the other side is here, and vice-versa
        send(ws, { type: "peer", role: otherRole, connected: !!room[otherRole] });
        send(room[otherRole], { type: "peer", role, connected: true });
        console.log(`[bridge] ${role} joined room "${msg.room || "demo"}"`);
        return;
      }
      if (!room) return;

      if (msg.type === "mic" && role === "phone") {
        if (typeof msg.pcm === "string") onMicChunk(room, msg.pcm);
      } else if (msg.type === "speak" && role === "mac") {
        if (typeof msg.text === "string") onSpeak(room, msg.text);
      } else if (msg.type === "status") {
        const other = role === "mac" ? "phone" : "mac";
        send(room[other], msg);
      }
    } catch (e) {
      console.warn("[bridge] message error:", e?.message || e);
    }
  });

  ws.on("close", () => {
    if (room && role && room[role] === ws) {
      room[role] = null;
      const other = role === "mac" ? "phone" : "mac";
      send(room[other], { type: "peer", role, connected: false });
      console.log(`[bridge] ${role} left`);
    }
  });

  ws.on("error", (e) => console.warn("[bridge] ws error:", e?.message || e));
});

server.listen(PORT, () => {
  console.log(`[bridge] handset bridge on http://localhost:${PORT}  (WS path /ws)`);
  console.log(`[bridge] ngrok should tunnel THIS port (${PORT}) so the iPhone can reach wss://<ngrok-host>/ws`);
  if (!ELEVEN_KEY) console.warn("[bridge] WARNING: ELEVENLABS_API_KEY missing — STT/TTS will be skipped");
});