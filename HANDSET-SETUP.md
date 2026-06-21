# 📱 Handset Mode — iPhone as the phone, Mac as the translator

A **free, no-telephony** bridge. You hold your **iPhone** like a phone: its **mic**
captures the caller's voice and its **speaker** plays the app's spoken reply. The
**Mac** runs the translator UI (webcam Sign→Speech + 3D avatar Speech→Sign). Audio
is relayed in real time over a WebSocket. **No Twilio, no phone number, no PSTN.**

```
 iPhone (Safari, /handset)  ⇄  Bridge (ws, :5051)  ⇄  Mac (/call/live-phone)
   mic → PCM → bridge ── ElevenLabs Scribe STT ──→ transcript → Mac
   speaker ← PCM ← bridge ←─ ElevenLabs TTS ←── "speak" ← Mac (also speaks locally)
```

All audio is **16-bit PCM, mono, 16000 Hz** in both directions.

---

## Prerequisites

- `.env.local` already has `ELEVENLABS_API_KEY` and `ASI1_API_KEY` (do not commit it).
- Node 24 (the bridge uses built-in `fetch`/`FormData`/`Blob`).
- Deps installed: `ws`, `express`, `dotenv`.

---

## Run steps

> Use the Node on PATH: `export PATH="$HOME/.nvm/versions/node/v24.17.0/bin:$PATH"`

1. **Dev server (Mac UI)** — port 3000 (probably already running):
   ```bash
   npm run dev
   ```

2. **Handset bridge** — port 5051:
   ```bash
   npm run handset
   ```
   It logs `handset bridge on http://localhost:5051 (WS path /ws)`.

3. **ngrok for the iPhone.** iOS Safari only grants mic access over **HTTPS**, and
   the iPhone must reach BOTH the page and the WebSocket. Pick one:

   **Option A — two tunnels (most reliable):**
   ```bash
   ngrok http 3000     # → https://APP.ngrok-free.app   (serves /handset page + Mac UI)
   ngrok http 5051     # → https://BRIDGE.ngrok-free.app (the WebSocket bridge)
   ```
   Then set the WS env so BOTH roles use the public bridge (next step).

   **Option B — single tunnel on the bridge:** if you serve the Mac UI only on
   `localhost:3000` and just need the phone to reach the bridge, tunnel **5051**
   and open the handset page from that same origin is NOT served by the bridge —
   so Option A is recommended. (The bridge only serves `/` health + `/ws`.)

4. **Set env vars**, then restart `npm run dev` so `NEXT_PUBLIC_*` is picked up
   (the bridge reads its vars at `npm run handset` start):
   ```bash
   # .env.local (additions)
   NEXT_PUBLIC_HANDSET_WS=wss://BRIDGE.ngrok-free.app/ws   # public bridge WS (Option A)
   # ELEVENLABS_VOICE_ID=JBFqnCBsd6RMkjVDRZzb             # optional (default George)
   # HANDSET_PORT=5051                                     # optional (bridge port)
   ```
   - If you DON'T set `NEXT_PUBLIC_HANDSET_WS`, the client derives it from the page
     host: `ws://localhost:5051/ws` on localhost, or `wss://<host>:5051/ws` on an
     https host. Behind ngrok that derived `:5051` host usually isn't reachable —
     so **set `NEXT_PUBLIC_HANDSET_WS` to the public bridge wss URL**.
   - The Mac (on `localhost:3000`) can use the same public WS, or omit the env and
     fall back to `ws://localhost:5051/ws`. The iPhone **must** use the public wss.

5. **On the Mac:** open **`http://localhost:3000/call/live-phone`** (or the ngrok
   app URL). Allow the webcam. You'll see a "Handset: waiting" badge.

6. **On the iPhone (Safari):** open the **HTTPS ngrok app URL** → **`/handset`**
   → tap **Start call** (this user gesture is what lets iOS start the mic + audio).
   The Mac badge flips to **connected**.

Now: sign on the Mac → the sentence is spoken on the Mac **and** on the iPhone
speaker. Speak into the iPhone → the Mac shows the transcript + meaning/tone/key-info
and the avatar signs the gloss.

---

## Environment variables

| Var | Where | Default | Purpose |
|---|---|---|---|
| `ELEVENLABS_API_KEY` | bridge | — (required) | Scribe STT + TTS |
| `ELEVENLABS_VOICE_ID` | bridge | `JBFqnCBsd6RMkjVDRZzb` (George) | TTS voice |
| `HANDSET_PORT` | bridge | `5051` | bridge HTTP/WS port |
| `NEXT_PUBLIC_HANDSET_WS` | both pages | derived | full WS URL incl. `/ws` (set to the public bridge wss behind ngrok) |
| `ASI1_API_KEY` | app | — | existing comprehension (unchanged) |

---

## Troubleshooting

- **No mic on iPhone** → you must open the **HTTPS ngrok** URL (not http, not the
  LAN IP) and tap **Start call** (iOS requires a user gesture). Re-tap if blocked,
  and check Safari site settings → Microphone → Allow.
- **No audio back on the iPhone** → make sure you tapped **Start call** (unlocks
  the AudioContext). Confirm the bridge logged a `speak`/TTS and that TTS uses
  `output_format=pcm_16000`; the phone playback queue expects 16-bit PCM @ 16kHz.
- **No transcript on the Mac** → check the bridge console for `STT HTTP <code>`
  (ElevenLabs key / quota), confirm the WAV is 16kHz mono 16-bit, and speak long
  enough (VAD needs ≥300ms speech + ~700ms trailing silence to finalize).
- **Peers not pairing** → both must use the **same room** (default `demo`) and the
  **same bridge** (`NEXT_PUBLIC_HANDSET_WS`). The badge shows connected only when
  both `mac` and `phone` are joined. Latest of each role wins.
- **Choppy/overlapping playback** → network jitter; the phone schedules PCM back to
  back. Lower latency by keeping the bridge near the Mac (same LAN) and using a
  fast tunnel.

---

## Files

- `server/handset-bridge.mjs` — standalone WS relay + VAD + ElevenLabs STT/TTS.
- `lib/handset.ts` — browser client (connect, mic capture/downsample, playback queue).
- `app/handset/page.tsx` — the iPhone handset page.
- `app/call/live-phone/page.tsx` — the Mac translator page (Sign→Speech + Speech→Sign).
- `npm run handset` — starts the bridge.

> Nothing here changes the existing routes/pages — it's all additive.
