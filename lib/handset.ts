// ─────────────────────────────────────────────────────────────────────────────
// lib/handset.ts — browser client for the handset bridge (used by BOTH pages).
//
// Audio is 16-bit signed PCM, little-endian, MONO, 16000 Hz in both directions
// (must match server/handset-bridge.mjs). The phone captures mic → downsamples to
// 16kHz PCM16 → base64 → sendMic(); and queues onAudio() PCM for seamless speaker
// playback. The mac sends speak(text); and receives onTranscript()/onPeer().
//
// WS URL: NEXT_PUBLIC_HANDSET_WS overrides everything. Otherwise it derives
//   ws://localhost:5051/ws        (localhost)
//   wss://<host>:5051/ws          (https / ngrok host)
// Behind a single ngrok tunnel, set NEXT_PUBLIC_HANDSET_WS to the bridge's public
// wss URL (see HANDSET-SETUP.md). Everything is wrapped so it never hard-crashes.
// ─────────────────────────────────────────────────────────────────────────────

export type HandsetRole = "mac" | "phone";

type PeerCb = (role: HandsetRole, connected: boolean) => void;
type TextCb = (text: string) => void;
type AudioCb = (pcmBase64: string) => void;
type StatusCb = (msg: Record<string, unknown>) => void;
type LevelCb = (level: number) => void;

const TARGET_RATE = 16000;
const CHUNK_SAMPLES = 4000; // ~250ms at 16kHz

function resolveWsUrl(): string {
  const env = process.env.NEXT_PUBLIC_HANDSET_WS;
  if (env) return env;
  if (typeof window === "undefined") return "ws://localhost:5051/ws";
  const https = window.location.protocol === "https:";
  return `${https ? "wss" : "ws"}://${window.location.hostname}:5051/ws`;
}

// base64 <-> Int16 helpers (browser-safe).
function int16ToBase64(int16: Int16Array): string {
  const bytes = new Uint8Array(int16.buffer, int16.byteOffset, int16.byteLength);
  let bin = "";
  const CH = 0x8000;
  for (let i = 0; i < bytes.length; i += CH) {
    bin += String.fromCharCode.apply(null, Array.from(bytes.subarray(i, i + CH)) as unknown as number[]);
  }
  return btoa(bin);
}
function base64ToInt16(b64: string): Int16Array {
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  // copy into a fresh aligned buffer (length may be odd-guarded)
  const usable = bytes.length - (bytes.length % 2);
  return new Int16Array(bytes.buffer.slice(0, usable));
}

// Linear downsample Float32 @ inRate → Float32 @ 16kHz.
function downsampleTo16k(input: Float32Array, inRate: number): Float32Array {
  if (inRate === TARGET_RATE) return input;
  const ratio = inRate / TARGET_RATE;
  const outLen = Math.floor(input.length / ratio);
  const out = new Float32Array(outLen);
  for (let i = 0; i < outLen; i++) {
    const start = Math.floor(i * ratio);
    const end = Math.min(input.length, Math.floor((i + 1) * ratio));
    let sum = 0, cnt = 0;
    for (let j = start; j < end; j++) { sum += input[j]; cnt++; }
    out[i] = cnt ? sum / cnt : input[start] || 0;
  }
  return out;
}

export class HandsetClient {
  private ws: WebSocket | null = null;
  private role: HandsetRole = "phone";
  private room = "demo";
  private wantOpen = false;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;

  private peerCb: PeerCb | null = null;
  private transcriptCb: TextCb | null = null;
  private audioCb: AudioCb | null = null;
  private statusCb: StatusCb | null = null;
  private levelCb: LevelCb | null = null;

  // mic capture
  private micStream: MediaStream | null = null;
  private micCtx: AudioContext | null = null;
  // eslint-disable-next-line @typescript-eslint/no-deprecated
  private micNode: ScriptProcessorNode | null = null;
  private micSrc: MediaStreamAudioSourceNode | null = null;
  private micBuf: number[] = [];
  private seq = 0;
  private muted = false;

  // playback
  private playCtx: AudioContext | null = null;
  private nextStart = 0;

  // ── connection ─────────────────────────────────────────────────────────────
  connect(role: HandsetRole, room = "demo") {
    this.role = role;
    this.room = room;
    this.wantOpen = true;
    this.open();
  }
  private open() {
    if (typeof window === "undefined") return;
    try {
      const url = resolveWsUrl();
      const ws = new WebSocket(url);
      this.ws = ws;
      ws.onopen = () => {
        this.sendJson({ type: "hello", role: this.role, room: this.room });
      };
      ws.onmessage = (ev) => {
        let msg: Record<string, unknown>;
        try { msg = JSON.parse(typeof ev.data === "string" ? ev.data : ""); } catch { return; }
        if (!msg || typeof msg !== "object") return;
        switch (msg.type) {
          case "peer": this.peerCb?.(msg.role as HandsetRole, !!msg.connected); break;
          case "transcript": if (typeof msg.text === "string") this.transcriptCb?.(msg.text); break;
          case "audio": if (typeof msg.pcm === "string") { this.audioCb?.(msg.pcm); this.enqueueAudio(msg.pcm); } break;
          case "status": this.statusCb?.(msg); break;
          default: break;
        }
      };
      ws.onclose = () => { this.ws = null; if (this.wantOpen) this.scheduleReconnect(); };
      ws.onerror = () => { try { ws.close(); } catch { /* noop */ } };
    } catch (e) {
      console.warn("[handset] connect failed:", e);
      if (this.wantOpen) this.scheduleReconnect();
    }
  }
  private scheduleReconnect() {
    if (this.reconnectTimer) return;
    this.reconnectTimer = setTimeout(() => { this.reconnectTimer = null; if (this.wantOpen) this.open(); }, 1500);
  }
  private sendJson(obj: Record<string, unknown>) {
    try { if (this.ws && this.ws.readyState === WebSocket.OPEN) this.ws.send(JSON.stringify(obj)); }
    catch (e) { console.warn("[handset] send failed:", e); }
  }
  close() {
    this.wantOpen = false;
    if (this.reconnectTimer) { clearTimeout(this.reconnectTimer); this.reconnectTimer = null; }
    this.stopMic();
    try { this.ws?.close(); } catch { /* noop */ }
    this.ws = null;
    try { this.playCtx?.close(); } catch { /* noop */ }
    this.playCtx = null;
  }

  // ── event subscriptions ──────────────────────────────────────────────────────
  onPeer(cb: PeerCb) { this.peerCb = cb; }
  onTranscript(cb: TextCb) { this.transcriptCb = cb; }
  onAudio(cb: AudioCb) { this.audioCb = cb; }
  onStatus(cb: StatusCb) { this.statusCb = cb; }
  onLevel(cb: LevelCb) { this.levelCb = cb; }

  // ── mac → phone speech ───────────────────────────────────────────────────────
  speak(text: string) { if (text && text.trim()) this.sendJson({ type: "speak", text }); }
  sendStatus(msg: Record<string, unknown>) { this.sendJson({ type: "status", ...msg }); }
  sendMic(pcmBase64: string) { this.sendJson({ type: "mic", seq: this.seq++, pcm: pcmBase64 }); }

  // ── PHONE: mic capture ───────────────────────────────────────────────────────
  async startMic(): Promise<void> {
    try {
      this.micStream = await navigator.mediaDevices.getUserMedia({
        audio: { channelCount: 1, echoCancellation: true, noiseSuppression: true, autoGainControl: true, sampleRate: 16000 },
      });
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const Ctx = (window.AudioContext || (window as any).webkitAudioContext) as typeof AudioContext;
      this.micCtx = new Ctx();
      await this.micCtx.resume().catch(() => {});
      const inRate = this.micCtx.sampleRate;
      this.micSrc = this.micCtx.createMediaStreamSource(this.micStream);
      // ScriptProcessor is deprecated but works reliably on iOS Safari.
      // eslint-disable-next-line @typescript-eslint/no-deprecated
      this.micNode = this.micCtx.createScriptProcessor(4096, 1, 1);
      this.micNode.onaudioprocess = (e: AudioProcessingEvent) => {
        try {
          const input = e.inputBuffer.getChannelData(0);
          // level meter (RMS)
          let s = 0; for (let i = 0; i < input.length; i++) s += input[i] * input[i];
          this.levelCb?.(Math.min(1, Math.sqrt(s / input.length) * 4));
          if (this.muted) return;
          const ds = downsampleTo16k(input, inRate);
          for (let i = 0; i < ds.length; i++) this.micBuf.push(ds[i]);
          while (this.micBuf.length >= CHUNK_SAMPLES) {
            const slice = this.micBuf.splice(0, CHUNK_SAMPLES);
            const int16 = new Int16Array(slice.length);
            for (let i = 0; i < slice.length; i++) {
              const v = Math.max(-1, Math.min(1, slice[i]));
              int16[i] = v < 0 ? v * 0x8000 : v * 0x7fff;
            }
            this.sendMic(int16ToBase64(int16));
          }
        } catch (err) { console.warn("[handset] mic frame error:", err); }
      };
      this.micSrc.connect(this.micNode);
      this.micNode.connect(this.micCtx.destination); // required for onaudioprocess to fire
    } catch (e) {
      console.warn("[handset] startMic failed:", e);
      throw e;
    }
  }
  stopMic() {
    try { this.micNode?.disconnect(); } catch { /* noop */ }
    try { this.micSrc?.disconnect(); } catch { /* noop */ }
    try { this.micStream?.getTracks().forEach((t) => t.stop()); } catch { /* noop */ }
    try { this.micCtx?.close(); } catch { /* noop */ }
    this.micNode = null; this.micSrc = null; this.micStream = null; this.micCtx = null; this.micBuf = [];
  }
  setMuted(m: boolean) { this.muted = m; }
  isMuted() { return this.muted; }

  // ── PHONE: speaker playback (must be unlocked by a user gesture on iOS) ───────
  async startPlayback(): Promise<void> {
    try {
      if (!this.playCtx) {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const Ctx = (window.AudioContext || (window as any).webkitAudioContext) as typeof AudioContext;
        this.playCtx = new Ctx();
      }
      await this.playCtx.resume().catch(() => {});
      this.nextStart = this.playCtx.currentTime;
    } catch (e) { console.warn("[handset] startPlayback failed:", e); }
  }
  private enqueueAudio(b64: string) {
    try {
      const ctx = this.playCtx;
      if (!ctx) return; // playback not unlocked yet
      const int16 = base64ToInt16(b64);
      if (int16.length === 0) return;
      const buf = ctx.createBuffer(1, int16.length, TARGET_RATE);
      const ch = buf.getChannelData(0);
      for (let i = 0; i < int16.length; i++) ch[i] = int16[i] / 0x8000;
      const src = ctx.createBufferSource();
      src.buffer = buf;
      src.connect(ctx.destination);
      const now = ctx.currentTime;
      const start = Math.max(now + 0.02, this.nextStart);
      src.start(start);
      this.nextStart = start + buf.duration;
    } catch (e) { console.warn("[handset] playback error:", e); }
  }
}

// One shared client per page/tab.
let singleton: HandsetClient | null = null;
export function getHandset(): HandsetClient {
  if (!singleton) singleton = new HandsetClient();
  return singleton;
}
