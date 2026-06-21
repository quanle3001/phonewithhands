# 🤟 Phone With Hand

> Berkeley AI Hackathon 2026 — Accessibility bridge for Deaf / ASL users on phone calls.

---

## Prerequisites

- **Node.js 18+** (project was developed with Node 24)
- **Chrome** (recommended — MediaPipe WASM + WebRTC works best there)
- **Webcam** connected and accessible to the browser

---

## Install & Run

```bash
# 1. Install dependencies
npm install

# 2. Start the dev server
npm run dev

# 3. Open in Chrome
open http://localhost:3000
```

That's it — no API keys, no backend, everything runs in the browser.

---

## Granting Camera Permission in Chrome

1. Open `http://localhost:3000/demo`
2. Chrome shows a camera permission prompt — click **Allow**
3. If you accidentally denied it: click the **camera icon** (🎥) in the address bar → select **Allow** → refresh

---

## Pages

| URL | Description |
|---|---|
| `http://localhost:3000` | Home page — contacts + **Train signs** button |
| `http://localhost:3000/train` | **Sign trainer** — teach the app custom ASL handshapes |
| `http://localhost:3000/call/dr-smith` | Scripted demo call |
| `http://localhost:3000/call/testing-call` | Testing Call — sign playground (pretrained gestures work out of the box) |
| `http://localhost:3000/demo` | Redirects to the wired call route |

---

## Training your own signs (`/train`)

The trainer is **browser-only** — your webcam frames and the trained model never
leave the device.

1. Open `http://localhost:3000/train` and allow camera access.
2. Pick a trainable sign from the **Vocabulary** list (right). The 7 *pretrained*
   gestures are marked and need **no training** — MediaPipe recognises them
   directly.
3. Make the handshape and **hold the Record button** (or press **Space**) to grab
   ~30 frames. Vary angle/distance slightly for robustness. The per-label sample
   count updates live.
4. Watch **Live prediction** — it shows what the current model thinks your hand is
   and turns green when it matches the selected sign.
5. Use **Clear** (trash icon / "Clear …" button) to redo a label, or **Clear all**
   to start over.
6. **Export** downloads the model as JSON; **Import** loads one back. Trained signs
   immediately drive sign→speech in the call screens.

### Where the model is stored

- **localStorage** key `pwh.signModel.v1` (survives refreshes/restarts).
- **Export to file** for backup or sharing between machines (`Import` to restore).

### How recognition works (classifier-agnostic)

`components/HandTracker.tsx` owns the camera + MediaPipe Hands pipeline and emits,
per frame, the 21 hand landmarks **and** MediaPipe's pretrained gesture. Landmarks
are normalized to be translation- and scale-invariant (`lib/landmarks.ts`:
wrist-centered, scaled by hand size) before classification.

All recognition goes through the **`SignClassifier`** interface
(`lib/classifier/types.ts`) — `train()`, `addSample()`, `predict()`,
`export()`/`import()`. The current implementation is a single-frame **KNN**
(`lib/classifier/knn.ts`); swap it for an LSTM later **without** rewriting the
trainer UI or the call pages — just satisfy the same interface. `lib/signStore.ts`
holds the one app-wide instance + persistence.

---

## Key Files

```
app/
  page.tsx                  Home page (contacts + Train signs button)
  train/page.tsx            ← Sign trainer (KNN, capture, export/import)
  call/[id]/page.tsx        In-call sign→speech experience
  globals.css               Tailwind base

components/
  HandTracker.tsx           ← CORE: webcam + MediaPipe Hands, emits landmarks
  CameraSignDetector.tsx    In-call readout: pretrained + KNN over HandTracker
  GlossPanel.tsx            Animated ASL gloss cards (Framer Motion)

lib/
  landmarks.ts              Translation/scale-invariant landmark normalization
  classifier/types.ts       SignClassifier interface (classifier-agnostic)
  classifier/knn.ts         KNN implementation of SignClassifier
  signStore.ts              App-wide model: localStorage + file import/export

data/
  signs.ts                  Vocabulary: pretrained + KNN labels, phrases, tones
```

### How CameraSignDetector works

1. Calls `getUserMedia` for the webcam stream
2. Dynamically imports `@mediapipe/tasks-vision` (avoids SSR issues)
3. Loads the `GestureRecognizer` WASM from jsDelivr CDN + gesture model from Google Storage — no API key needed
4. Runs `recognizeForVideo()` in a `requestAnimationFrame` loop
5. Draws green skeleton connectors + red landmark dots on a `<canvas>` overlay
6. Shows: **hands detected count**, **gesture name** (Open_Palm / Closed_Fist / Victory / etc.), **confidence %**

---

## Tech Stack

| Layer | Tool |
|---|---|
| Framework | Next.js 15 (App Router) |
| Language | TypeScript |
| Styles | Tailwind CSS |
| Animations | Framer Motion |
| Hand tracking | @mediapipe/tasks-vision (GestureRecognizer, browser WASM) |

---

## What's Mocked (Next Iterations)

| Feature | Status |
|---|---|
| Hand landmark detection | ✅ Live (MediaPipe) |
| Gesture → ASL phrase mapping | 🔜 Next iteration |
| ASL interpretation (LLM) | 🔜 Next iteration |
| TTS voice output | 🔜 Next iteration |
| Sign avatar animation | 🔜 Next iteration |
| Two-device WebSocket link | 🔜 Next iteration |

---

## Ethics Note

This is an accessibility *guide / prototype*, **NOT a certified ASL interpreter**.
It does not replace human interpreters, Video Relay Services (VRS), or CART services.
In high-stakes conversations (medical, legal, financial), use a certified human interpreter.
