"use client";

import { motion, AnimatePresence, useReducedMotion } from "framer-motion";

const SPRING = { type: "spring" as const, stiffness: 260, damping: 30, mass: 0.9 };

// Apple light-mode tokens
const T = {
  label:     "#1D1D1F",
  tertLabel: "rgba(60,60,67,0.30)",
  separator: "rgba(60,60,67,0.12)",
  blue:      "#007AFF",
};

interface GlossPanelProps {
  /** Display strings for the signs currently buffered into the sentence. */
  signs: string[];
}

// Controlled ASL-gloss panel: renders the live sentence buffer as animated chips.
export default function GlossPanel({ signs }: GlossPanelProps) {
  const rm = useReducedMotion();

  return (
    <div className="flex flex-col items-center gap-2 w-full select-none">
      <p
        className="text-[10px] font-semibold uppercase tracking-widest mb-0.5"
        style={{ color: T.tertLabel }}
      >
        ASL Gloss
      </p>

      <AnimatePresence>
        {signs.map((sign, i) => (
          <motion.div
            key={sign + i}
            layout
            initial={{ opacity: 0, y: rm ? 0 : 6, scale: rm ? 1 : 0.90 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, scale: 0.88 }}
            transition={{ ...SPRING, delay: rm ? 0 : i * 0.05 }}
            className="w-full flex justify-center"
          >
            <div
              className="inline-flex items-center justify-center
                text-[13px] font-semibold rounded-[8px]
                px-4 py-[7px] min-w-[88px] text-center"
              style={{
                background:    "#FFFFFF",
                border:        `1px solid ${T.separator}`,
                boxShadow:     "0 1px 4px rgba(0,0,0,0.06)",
                color:         T.label,
                letterSpacing: "0.04em",
              }}
            >
              {sign}
            </div>
          </motion.div>
        ))}
      </AnimatePresence>

      {signs.length === 0 && (
        <p className="text-[11px] text-center px-2 leading-relaxed" style={{ color: T.tertLabel }}>
          Sign to build a sentence…
        </p>
      )}
    </div>
  );
}
