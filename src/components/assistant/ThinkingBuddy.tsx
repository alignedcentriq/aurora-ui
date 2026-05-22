import { useState, useEffect } from "react";
import { motion, AnimatePresence } from "framer-motion";

const PHRASES = [
  "Hmm, let me think about that...",
  "Consulting my inner wisdom...",
  "Crunching data at light speed...",
  "Searching through all possibilities...",
  "Deep focus mode activated...",
  "Almost cracked it...",
  "Connecting all the dots...",
  "Turning your question into magic...",
  "Just a sec, genius at work!",
  "Cross-referencing everything...",
  "Pulling the right answer for you...",
  "Thinking really hard right now...",
];

type Phase = "typing" | "glance";

export function ThinkingBuddy() {
  const [phraseIndex, setPhraseIndex] = useState(() =>
    Math.floor(Math.random() * PHRASES.length),
  );
  const [phase, setPhase] = useState<Phase>("typing");
  const [handFrame, setHandFrame] = useState(0);

  // Phrase cycling
  useEffect(() => {
    const id = setInterval(() => {
      setPhraseIndex((i) => (i + 1) % PHRASES.length);
    }, 2800);
    return () => clearInterval(id);
  }, []);

  // Phase: typing (2.4s) → glance (1s) → typing → repeat
  useEffect(() => {
    let t: number;
    const cycle = () => {
      setPhase("glance");
      t = window.setTimeout(() => {
        setPhase("typing");
        t = window.setTimeout(cycle, 2400);
      }, 1000);
    };
    t = window.setTimeout(cycle, 2400);
    return () => window.clearTimeout(t);
  }, []);

  // Alternating hands during typing
  useEffect(() => {
    if (phase !== "typing") return;
    const id = setInterval(() => setHandFrame((f) => (f + 1) % 2), 280);
    return () => clearInterval(id);
  }, [phase]);

  const typing = phase === "typing";

  // Pupils: looking down-center when typing, up-right when glancing
  const lx = typing ? 0 : 2;
  const ly = typing ? 3 : -4;
  const rx = typing ? 0 : 2;
  const ry = typing ? 3 : -4;

  return (
    <div className="flex items-center gap-3 py-1 select-none">
      {/* Character with Framer Motion bob */}
      <motion.div
        className="shrink-0"
        animate={{ y: [0, -6, 0] }}
        transition={{
          duration: 2.4,
          repeat: Infinity,
          ease: "easeInOut",
        }}
        style={{
          filter: "drop-shadow(0 4px 12px rgba(124,58,237,0.35))",
        }}
      >
        <svg
          width="38"
          height="52"
          viewBox="0 0 50 68"
          fill="none"
          xmlns="http://www.w3.org/2000/svg"
        >
          {/* Antenna */}
          <line x1="25" y1="4" x2="25" y2="13" stroke="#7c3aed" strokeWidth="2.5" strokeLinecap="round" />
          <motion.circle
            cx="25" cy="3.5" r="4.5" fill="#8b5cf6"
            animate={{ scale: [1, 1.35, 1], opacity: [0.9, 0.5, 0.9] }}
            transition={{ duration: 1.6, repeat: Infinity, ease: "easeInOut" }}
          />
          <circle cx="26.5" cy="2" r="1.6" fill="white" opacity="0.65" />

          {/* Head */}
          <rect x="3" y="12" width="44" height="38" rx="14" fill="#7c3aed" />

          {/* Ear bumps */}
          <circle cx="2.5" cy="31" r="5" fill="#7c3aed" opacity="0.7" />
          <circle cx="47.5" cy="31" r="5" fill="#7c3aed" opacity="0.7" />

          {/* Eye whites */}
          <ellipse cx="17" cy="29" rx="7.5" ry={typing ? 8 : 9.5} fill="white" style={{ transition: "ry 0.3s ease" }} />
          <ellipse cx="35" cy="29" rx="7.5" ry={typing ? 8 : 9.5} fill="white" style={{ transition: "ry 0.3s ease" }} />

          {/* Pupils */}
          <circle
            cx={17} cy={31} r="4.2" fill="#1e1b4b"
            style={{ transform: `translate(${lx}px, ${ly}px)`, transition: "transform 0.35s cubic-bezier(0.34,1.56,0.64,1)" }}
          />
          <circle
            cx={35} cy={31} r="4.2" fill="#1e1b4b"
            style={{ transform: `translate(${rx}px, ${ry}px)`, transition: "transform 0.35s cubic-bezier(0.34,1.56,0.64,1)" }}
          />

          {/* Pupil highlights */}
          <circle
            cx={17 + lx + 1.5} cy={31 + ly - 2} r="1.4" fill="white"
            style={{ transition: "cx 0.35s ease, cy 0.35s ease" }}
          />
          <circle
            cx={35 + rx + 1.5} cy={31 + ry - 2} r="1.4" fill="white"
            style={{ transition: "cx 0.35s ease, cy 0.35s ease" }}
          />

          {/* Mouth */}
          {typing ? (
            <line x1="19" y1="42" x2="33" y2="42" stroke="white" strokeWidth="2" strokeLinecap="round" opacity="0.75" />
          ) : (
            <path d="M 17 41 Q 26 48 35 41" stroke="white" strokeWidth="2.5" fill="none" strokeLinecap="round" />
          )}

          {/* Blush */}
          <ellipse cx="8" cy="37" rx="5" ry="3" fill="#fca5a5" opacity="0.45" />
          <ellipse cx="44" cy="37" rx="5" ry="3" fill="#fca5a5" opacity="0.45" />

          {/* Keyboard — only when typing */}
          {typing && (
            <>
              <ellipse
                cx="17" cy="55" rx="4" ry="2.5" fill="#6d28d9"
                style={{ transform: handFrame === 0 ? "translateY(-3px)" : "translateY(0px)", transition: "transform 0.14s ease" }}
              />
              <ellipse
                cx="35" cy="55" rx="4" ry="2.5" fill="#6d28d9"
                style={{ transform: handFrame === 1 ? "translateY(-3px)" : "translateY(0px)", transition: "transform 0.14s ease" }}
              />
              <rect x="7" y="58" width="36" height="7" rx="2.5" fill="#6d28d9" opacity="0.7" />
              <rect x="10" y="60" width="5" height="2.5" rx="1" fill="#c4b5fd" opacity="0.9" />
              <rect x="17" y="60" width="5" height="2.5" rx="1" fill="#c4b5fd" opacity="0.9" />
              <rect x="24" y="60" width="5" height="2.5" rx="1" fill="#c4b5fd" opacity="0.9" />
              <rect x="31" y="60" width="5" height="2.5" rx="1" fill="#c4b5fd" opacity="0.9" />
            </>
          )}

          {/* Sparkles when glancing */}
          {!typing && (
            <>
              <text x="38" y="20" fontSize="8" fill="#22d3ee" opacity="0.9">✦</text>
              <text x="41" y="28" fontSize="5" fill="#22d3ee" opacity="0.7">✦</text>
            </>
          )}
        </svg>
      </motion.div>

      {/* Thought bubble */}
      <div className="flex flex-col gap-2">
        <div className="relative pl-6">
          {/* Comic connector dots */}
          <div className="absolute left-0.5 top-[18px] w-1.5 h-1.5 rounded-full bg-muted border border-border/50" />
          <div className="absolute left-[10px] top-[13px] w-2.5 h-2.5 rounded-full bg-muted border border-border/50" />
          <div className="rounded-2xl border border-border/50 bg-muted px-3.5 py-2.5 max-w-[185px] sm:max-w-[230px]">
            <AnimatePresence mode="wait">
              <motion.span
                key={phraseIndex}
                initial={{ opacity: 0, y: 4 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -4 }}
                transition={{ duration: 0.25 }}
                className="text-[12.5px] leading-snug text-muted-foreground font-medium block"
                style={{ minHeight: "1.2em" }}
              >
                {PHRASES[phraseIndex]}
              </motion.span>
            </AnimatePresence>
          </div>
        </div>

        {/* Bouncing dots */}
        <div className="flex gap-1.5 pl-6">
          {[0, 1, 2].map((i) => (
            <motion.div
              key={i}
              className="h-1.5 w-1.5 rounded-full bg-primary/50"
              animate={{ y: [0, -6, 0] }}
              transition={{
                duration: 0.6,
                repeat: Infinity,
                delay: i * 0.15,
                ease: "easeInOut",
              }}
            />
          ))}
        </div>
      </div>
    </div>
  );
}
