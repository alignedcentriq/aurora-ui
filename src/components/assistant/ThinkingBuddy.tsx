import { useState, useEffect } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { useBuddyColors, useSettings } from "@/lib/settings-store";
import { getCharacter } from "./characters";

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

export function ThinkingBuddy({ activity }: { activity?: string }) {
  const colors = useBuddyColors();
  const charId = useSettings((s) => s.buddyCharId);
  const character = getCharacter(charId);
  const ThinkingComponent = character.Thinking;

  const [phraseIndex, setPhraseIndex] = useState(() => Math.floor(Math.random() * PHRASES.length));

  // Phrase cycling
  useEffect(() => {
    const id = setInterval(() => {
      setPhraseIndex((i) => (i + 1) % PHRASES.length);
    }, 2800);
    return () => clearInterval(id);
  }, []);

  return (
    <div className="flex items-center gap-3 py-1 select-none">
      {/* Character SVG — rendered from registry */}
      <ThinkingComponent colors={colors} />

      {/* Thought bubble */}
      <div className="flex flex-col gap-2">
        <div className="relative pl-6">
          {/* Comic connector dots */}
          <div className="absolute left-0.5 top-[18px] w-1.5 h-1.5 rounded-full bg-muted border border-border/50" />
          <div className="absolute left-[10px] top-[13px] w-2.5 h-2.5 rounded-full bg-muted border border-border/50" />
          <div className="rounded-2xl border border-border/50 bg-muted px-3.5 py-2.5 max-w-[195px] sm:max-w-[240px] shadow-sm relative overflow-hidden">
            {/* Live activity indicator header */}
            <div className="flex items-center gap-1.5 mb-1 opacity-75 border-b border-border/30 pb-0.5 select-none">
              <span className="relative flex h-1.5 w-1.5">
                <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75"></span>
                <span className="relative inline-flex rounded-full h-1.5 w-1.5 bg-emerald-500"></span>
              </span>
              <span className="text-[10px] font-bold text-emerald-600 dark:text-emerald-400 tracking-wide uppercase">
                {activity || "Thinking..."}
              </span>
            </div>

            <AnimatePresence mode="wait">
              <motion.span
                key={phraseIndex}
                initial={{ opacity: 0, y: 4 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -4 }}
                transition={{ duration: 0.25 }}
                className="text-[12px] leading-snug text-muted-foreground font-medium block"
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
