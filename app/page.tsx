import Link from "next/link";

export default function Home() {
  return (
    <main className="min-h-screen bg-gray-950 flex flex-col items-center justify-center p-8">
      <div className="max-w-2xl w-full text-center space-y-8">
        {/* Logo */}
        <div className="flex flex-col items-center gap-4">
          <span className="text-7xl select-none" aria-hidden>🤟</span>
          <div>
            <h1 className="text-4xl font-bold tracking-tight text-white">
              Phone With Hand
            </h1>
            <p className="mt-1 text-sm font-semibold tracking-widest text-indigo-400 uppercase">
              Berkeley AI Hackathon 2026
            </p>
          </div>
        </div>

        {/* Pitch */}
        <p className="text-lg text-gray-300 leading-relaxed max-w-lg mx-auto">
          An accessibility bridge that helps Deaf&nbsp;/&nbsp;ASL users make
          phone calls independently — live hand detection, real-time ASL
          interpretation, no relay service needed.
        </p>

        {/* Feature pills */}
        <div className="flex flex-wrap gap-2 justify-center">
          {[
            "🖐 MediaPipe Hand Tracking",
            "🧠 LLM Interpretation (soon)",
            "🗣️ TTS Voice Output (soon)",
            "🤖 Sign Avatar (soon)",
          ].map((f) => (
            <span
              key={f}
              className="px-3 py-1.5 rounded-full bg-gray-800 text-gray-300 text-sm"
            >
              {f}
            </span>
          ))}
        </div>

        {/* CTA */}
        <Link
          href="/demo"
          className="inline-flex items-center gap-2 px-8 py-4 bg-indigo-600 hover:bg-indigo-500 active:scale-95 rounded-2xl font-semibold text-lg text-white transition-all shadow-lg shadow-indigo-900/40"
        >
          Start Demo
          <span aria-hidden>→</span>
        </Link>

        <p className="text-xs text-gray-600">
          Chrome recommended &nbsp;·&nbsp; Camera permission required &nbsp;·&nbsp;
          No data leaves your device
        </p>
      </div>
    </main>
  );
}
