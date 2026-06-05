import { motion, AnimatePresence } from "framer-motion";
import { X } from "lucide-react";
import { cn } from "@/lib/utils";
import { useVoiceStore } from "@/lib/voice-store";
import { ListeningBuddy } from "./ListeningBuddy";

const STATE_META: Record<string, { label: string; color: string; ring: string }> = {
  listening: { label: "Listening…", color: "text-primary", ring: "ring-primary/40" },
  thinking: { label: "Thinking…", color: "text-amber-500", ring: "ring-amber-500/40" },
  speaking: { label: "Speaking…", color: "text-emerald-500", ring: "ring-emerald-500/40" },
  idle: { label: "Voice mode", color: "text-muted-foreground", ring: "ring-border" },
};

export function VoiceOrb() {
  const { voiceMode, voiceState, liveTranscript, setVoiceMode } = useVoiceStore();
  if (!voiceMode) return null;

  const meta = STATE_META[voiceState] ?? STATE_META.idle;

  return (
    <AnimatePresence>
      <motion.div
        initial={{ opacity: 0, y: 8, scale: 0.96 }}
        animate={{ opacity: 1, y: 0, scale: 1 }}
        exit={{ opacity: 0, y: 8, scale: 0.96 }}
        className="mx-auto mb-3 flex max-w-md items-center gap-3 rounded-2xl border border-border bg-card/70 px-4 py-2.5 backdrop-blur-xl shadow-lg"
      >
        {/* Listening Buddy character */}
        <ListeningBuddy />

        <div className="min-w-0 flex-1">
          <p className={cn("text-[12px] font-semibold", meta.color)}>{meta.label}</p>
          <p className="truncate text-[13px] text-foreground/80">
            {liveTranscript || "Say a command — Buddy is listening."}
          </p>
        </div>

        <button
          onClick={() => setVoiceMode(false)}
          className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground"
          title="Exit voice mode"
        >
          <X className="h-4 w-4" />
        </button>
      </motion.div>
    </AnimatePresence>
  );
}
