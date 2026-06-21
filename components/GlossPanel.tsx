"use client";

import { motion, AnimatePresence, useReducedMotion } from "framer-motion";
import { useEffect, useState } from "react";

const MOCK_GLOSS = ["BRING", "INSURANCE", "CARD", "AND", "PHOTO", "ID"];

// macOS-authentic spring — same as page.tsx
const SPRING = { type: "spring" as const, stiffness: 300, damping: 30, mass: 0.8 };

const SYS = {
  label:         "rgba(255,255,255,0.85)",
  tertiaryLabel: "rgba(255,255,255,0.25)",
  separator:     "rgba(255,255,255,0.10)",
};

export default function GlossPanel() {
  const [visible, setVisible] = useState(false);
  const rm = useReducedMotion();

  useEffect(() => {
    const t = setTimeout(() => setVisible(true), 480);
    return () => clearTimeout(t);
  }, []);

  return (
    <div className="flex flex-col items-center gap-2 w-full select-none">
      <p
        className="text-[10px] font-semibold uppercase tracking-widest mb-0.5"
        style={{ color: SYS.tertiaryLabel }}
      >
        ASL Gloss
      </p>

      {/* Chips — stagger in, then stay put (no repeat animation per macOS HIG) */}
      <AnimatePresence>
        {visible &&
          MOCK_GLOSS.map((sign, i) => (
            <motion.div
              key={sign + i}
              initial={{
                opacity: 0,
                y:     rm ? 0 : 6,
                scale: rm ? 1 : 0.90,
              }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0, scale: 0.88 }}
              transition={{ ...SPRING, delay: i * 0.08 }}
              className="w-full flex justify-center"
            >
              <div
                className="inline-flex items-center justify-center
                  text-[13px] font-semibold rounded-[8px]
                  px-4 py-[7px] min-w-[88px] text-center"
                style={{
                  background:  "rgba(255,255,255,0.08)",
                  border:      `1px solid ${SYS.separator}`,
                  boxShadow:   "inset 0 1px 0 rgba(255,255,255,0.06), 0 1px 3px rgba(0,0,0,0.20)",
                  color:       SYS.label,
                  letterSpacing: "0.04em",
                }}
              >
                {sign}
              </div>
            </motion.div>
          ))}
      </AnimatePresence>

      {/* Subtle footnote */}
      <motion.p
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ delay: MOCK_GLOSS.length * 0.08 + 0.25 }}
        className="text-[10px] mt-0.5"
        style={{ color: "rgba(255,255,255,0.14)" }}
      >
        mock data
      </motion.p>
    </div>
  );
}
