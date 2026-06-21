"use client";

import { motion, AnimatePresence, useReducedMotion } from "framer-motion";
import { useEffect, useState } from "react";

const MOCK_GLOSS = ["BRING", "INSURANCE", "CARD", "AND", "PHOTO", "ID"];

const SPRING = { type: "spring" as const, stiffness: 260, damping: 30, mass: 0.9 };

// Apple light-mode tokens
const T = {
  label:     "#1D1D1F",
  tertLabel: "rgba(60,60,67,0.30)",
  separator: "rgba(60,60,67,0.12)",
  blue:      "#007AFF",
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
        style={{ color: T.tertLabel }}
      >
        ASL Gloss
      </p>

      <AnimatePresence>
        {visible &&
          MOCK_GLOSS.map((sign, i) => (
            <motion.div
              key={sign + i}
              initial={{ opacity: 0, y: rm ? 0 : 6, scale: rm ? 1 : 0.90 }}
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

      <motion.p
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ delay: MOCK_GLOSS.length * 0.08 + 0.25 }}
        className="text-[10px] mt-0.5"
        style={{ color: "rgba(60,60,67,0.20)" }}
      >
        mock data
      </motion.p>
    </div>
  );
}
