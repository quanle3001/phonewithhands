"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { motion, AnimatePresence, useReducedMotion } from "framer-motion";
import { Search, Video, Hand } from "lucide-react";
import { CONTACTS, type Contact } from "@/data/contacts";
import { getRecents, type RecentCall } from "@/lib/recents";

// ── Apple light-mode tokens ────────────────────────────────────────────────────
const T = {
  bg:          "#F5F5F7",
  surface:     "#FFFFFF",
  label:       "#1D1D1F",
  secondLabel: "rgba(60,60,67,0.60)",
  tertLabel:   "rgba(60,60,67,0.30)",
  separator:   "rgba(60,60,67,0.12)",
  blue:        "#007AFF",
  green:       "#34C759",
  red:         "#FF3B30",
} as const;

const SPRING = { type: "spring" as const, stiffness: 260, damping: 30, mass: 0.9 };

// ── Helpers ────────────────────────────────────────────────────────────────────

function fmtTime(ts: number): string {
  return new Date(ts).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}

function fmtDuration(s: number): string {
  if (s < 60) return `${s}s`;
  return `${Math.floor(s / 60)}m ${s % 60}s`;
}

function AvatarCircle({ contact }: { contact: Contact }) {
  const isEmoji = (contact.avatar.codePointAt(0) ?? 0) > 127;
  return (
    <div
      className="rounded-full flex items-center justify-center flex-shrink-0 select-none"
      style={{
        width:      44,
        height:     44,
        background: isEmoji ? "rgba(0,0,0,0.06)" : contact.color + "22",
        border:     `1.5px solid ${contact.color}33`,
      }}
      aria-hidden
    >
      {isEmoji ? (
        <span style={{ fontSize: 20, lineHeight: 1 }}>{contact.avatar}</span>
      ) : (
        <span style={{ fontSize: 14, fontWeight: 700, color: contact.color }}>
          {contact.avatar}
        </span>
      )}
    </div>
  );
}

// ── Contact row ────────────────────────────────────────────────────────────────

interface RowProps {
  contact: Contact;
  index: number;
  isLast: boolean;
  onCall: (c: Contact) => void;
  rm: boolean;
}

function ContactRow({ contact, index, isLast, onCall, rm }: RowProps) {
  return (
    <>
      <motion.div
        initial={{ opacity: 0, y: rm ? 0 : 6 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ ...SPRING, delay: index * 0.04 }}
        role="button"
        tabIndex={0}
        onClick={() => onCall(contact)}
        onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") onCall(contact); }}
        whileHover={{ backgroundColor: "rgba(0,0,0,0.028)" }}
        whileTap={{ scale: 0.99 }}
        className="flex items-center gap-3 px-4 py-3 cursor-pointer
          focus:outline-none focus-visible:ring-2 focus-visible:ring-inset
          focus-visible:ring-[#007AFF] transition-colors"
      >
        <AvatarCircle contact={contact} />

        <div className="flex-1 min-w-0">
          <p
            className="truncate"
            style={{ fontSize: 17, fontWeight: 500, color: T.label, lineHeight: "1.3" }}
          >
            {contact.name}
          </p>
          <p
            className="truncate"
            style={{ fontSize: 15, color: T.secondLabel, lineHeight: "1.3" }}
          >
            {contact.subtitle}
          </p>
        </div>

        <motion.button
          whileHover={{ scale: 1.09 }}
          whileTap={{ scale: 0.88 }}
          onClick={(e) => { e.stopPropagation(); onCall(contact); }}
          aria-label={`Video call ${contact.name}`}
          className="flex items-center justify-center flex-shrink-0 rounded-full
            focus:outline-none focus-visible:ring-2 focus-visible:ring-[#007AFF]"
          style={{
            width:      34,
            height:     34,
            background: contact.callable ? `${T.green}1a` : "rgba(0,0,0,0.05)",
            border:     `1px solid ${contact.callable ? T.green + "44" : "rgba(0,0,0,0.09)"}`,
          }}
        >
          <Video
            size={14}
            style={{ color: contact.callable ? T.green : T.tertLabel }}
          />
        </motion.button>
      </motion.div>

      {/* iOS-style inset separator — hidden after last row */}
      {!isLast && (
        <div style={{ height: 1, background: T.separator, marginLeft: 60 }} />
      )}
    </>
  );
}

// ── Recent row ─────────────────────────────────────────────────────────────────

function RecentRow({ recent, isLast }: { recent: RecentCall; isLast: boolean }) {
  const completed = recent.outcome === "completed";
  return (
    <>
      <div className="flex items-center gap-3 px-4 py-3">
        <div
          className="rounded-full flex items-center justify-center flex-shrink-0"
          style={{ width: 44, height: 44, background: "rgba(0,0,0,0.05)", fontSize: 20 }}
          aria-hidden
        >
          {completed ? "📞" : "📵"}
        </div>
        <div className="flex-1 min-w-0">
          <p
            className="truncate"
            style={{ fontSize: 17, fontWeight: 500, color: T.label }}
          >
            {recent.contactName}
          </p>
          <p style={{ fontSize: 15, color: completed ? T.green : T.red }}>
            {completed ? "Connected" : "Cancelled"}
            {recent.duration > 0 && ` · ${fmtDuration(recent.duration)}`}
          </p>
        </div>
        <p style={{ fontSize: 13, color: T.tertLabel, flexShrink: 0 }}>
          {fmtTime(recent.timestamp)}
        </p>
      </div>
      {!isLast && (
        <div style={{ height: 1, background: T.separator, marginLeft: 60 }} />
      )}
    </>
  );
}

// ── Page ───────────────────────────────────────────────────────────────────────

export default function HomePage() {
  const router    = useRouter();
  const rm        = useReducedMotion();
  const [tab, setTab]       = useState<"contacts" | "recents">("contacts");
  const [query, setQuery]   = useState("");
  const [toast, setToast]   = useState<string | null>(null);
  const [recents, setRecents] = useState<RecentCall[]>([]);
  const toastTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => { setRecents(getRecents()); }, []);
  useEffect(() => () => { if (toastTimer.current) clearTimeout(toastTimer.current); }, []);

  const filtered = CONTACTS.filter(
    (c) =>
      c.name.toLowerCase().includes(query.toLowerCase()) ||
      c.subtitle.toLowerCase().includes(query.toLowerCase())
  );

  function handleCall(contact: Contact) {
    if (!contact.callable) {
      setToast("Demo: only Dr. Smith's Office is connected.");
      if (toastTimer.current) clearTimeout(toastTimer.current);
      toastTimer.current = setTimeout(() => setToast(null), 3200);
      return;
    }
    router.push(`/call/${contact.id}`);
  }

  return (
    <div
      className="min-h-screen overflow-x-hidden relative"
      style={{ background: T.bg }}
    >
      {/* ── Centered column ──────────────────────────────────────────────── */}
      <div className="max-w-[540px] mx-auto px-5 pb-16">

        {/* Large inline title — iOS Contacts style */}
        <div className="flex items-end justify-between" style={{ paddingTop: 56, marginBottom: 12 }}>
          <h1
            className="select-none"
            style={{ fontSize: 34, fontWeight: 700, letterSpacing: "-0.02em", color: T.label }}
          >
            Contacts
          </h1>
          <div className="flex items-center gap-2">
            <Link
              href="/train"
              className="flex items-center gap-1.5 rounded-full px-3.5 py-2 text-[13px] font-semibold
                focus:outline-none focus-visible:ring-2 focus-visible:ring-[#007AFF]"
              style={{ background: "rgba(0,122,255,0.10)", color: T.blue }}
            >
              <Hand size={15} />
              Train signs
            </Link>
            <Link
              href="/capture"
              className="flex items-center gap-1.5 rounded-full px-3.5 py-2 text-[13px] font-semibold
                focus:outline-none focus-visible:ring-2 focus-visible:ring-[#007AFF]"
              style={{ background: "rgba(0,122,255,0.10)", color: T.blue }}
            >
              <Video size={15} />
              Train avatar
            </Link>
          </div>
        </div>

        {/* iOS-style search field */}
        <div
          className="flex items-center gap-2 rounded-[10px] px-3 py-[8px] mb-3"
          style={{ background: "rgba(116,116,128,0.12)" }}
        >
          <Search size={15} style={{ color: T.secondLabel, flexShrink: 0 }} />
          <input
            type="text"
            placeholder="Search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            className="flex-1 bg-transparent text-[15px] outline-none placeholder:opacity-50"
            style={{ color: T.label }}
            aria-label="Search contacts"
          />
        </div>

        {/* Segmented control */}
        <div
          className="flex rounded-[10px] p-[3px] gap-[3px] mb-5"
          style={{ background: "rgba(116,116,128,0.12)" }}
        >
          {(["contacts", "recents"] as const).map((t) => (
            <button
              key={t}
              onClick={() => setTab(t)}
              className="flex-1 py-[6px] rounded-[8px] text-[13px] font-semibold capitalize
                transition-all focus:outline-none focus-visible:ring-2
                focus-visible:ring-[#007AFF]"
              style={{
                background: tab === t ? "#FFFFFF" : "transparent",
                color:      tab === t ? T.label : T.secondLabel,
                boxShadow:  tab === t ? "0 1px 4px rgba(0,0,0,0.12)" : "none",
              }}
            >
              {t === "contacts" ? "Contacts" : "Recents"}
            </button>
          ))}
        </div>

        {/* List area */}
        <AnimatePresence mode="wait">
          {tab === "contacts" ? (
            <motion.div
              key="contacts"
              initial={{ opacity: 0, y: rm ? 0 : 8 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.18 }}
            >
              {filtered.length === 0 ? (
                <p
                  className="text-center py-14 text-[15px]"
                  style={{ color: T.tertLabel }}
                >
                  No contacts found
                </p>
              ) : (
                <div
                  style={{
                    background:   T.surface,
                    borderRadius: 18,
                    overflow:     "hidden",
                    boxShadow:    "0 4px 24px rgba(0,0,0,0.06)",
                  }}
                >
                  {filtered.map((c, i) => (
                    <ContactRow
                      key={c.id}
                      contact={c}
                      index={i}
                      isLast={i === filtered.length - 1}
                      onCall={handleCall}
                      rm={!!rm}
                    />
                  ))}
                </div>
              )}
            </motion.div>
          ) : (
            <motion.div
              key="recents"
              initial={{ opacity: 0, y: rm ? 0 : 8 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.18 }}
            >
              {recents.length === 0 ? (
                <div className="flex flex-col items-center gap-3 py-14">
                  <span className="text-[32px]" aria-hidden>🕐</span>
                  <p className="text-[15px]" style={{ color: T.tertLabel }}>
                    No recent calls
                  </p>
                </div>
              ) : (
                <div
                  style={{
                    background:   T.surface,
                    borderRadius: 18,
                    overflow:     "hidden",
                    boxShadow:    "0 4px 24px rgba(0,0,0,0.06)",
                  }}
                >
                  {recents.map((r, i) => (
                    <RecentRow key={i} recent={r} isLast={i === recents.length - 1} />
                  ))}
                </div>
              )}
            </motion.div>
          )}
        </AnimatePresence>
      </div>

      {/* ── Toast — slides down from top (iOS notification style) ─────────── */}
      <AnimatePresence>
        {toast && (
          <motion.div
            initial={{ opacity: 0, y: rm ? 0 : -24 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: rm ? 0 : -12 }}
            transition={SPRING}
            className="fixed top-4 left-1/2 -translate-x-1/2 z-50 rounded-full
              px-5 py-2.5 text-[14px] font-medium pointer-events-none"
            style={{
              background:           "rgba(28,28,30,0.86)",
              backdropFilter:       "blur(20px)",
              WebkitBackdropFilter: "blur(20px)",
              color:                "#FFFFFF",
              whiteSpace:           "nowrap",
              boxShadow:            "0 4px 24px rgba(0,0,0,0.25)",
            }}
          >
            {toast}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}