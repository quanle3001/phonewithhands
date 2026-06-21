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
| `http://localhost:3000` | Home page — project pitch |
| `http://localhost:3000/demo` | 3-column demo shell with live hand detection |

---

## Key Files

```
app/
  page.tsx                  Home page (pitch + CTA)
  demo/page.tsx             3-column demo layout (shell + mock data)
  globals.css               Tailwind base

components/
  CameraSignDetector.tsx    ← CORE: webcam + MediaPipe hand tracking
  GlossPanel.tsx            Animated ASL gloss cards (Framer Motion)
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
