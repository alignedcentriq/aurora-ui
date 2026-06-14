import { useEffect } from "react";
import { ExternalLink, HelpCircle, ChevronRight, Sparkles, Globe, BookOpen, CornerDownLeft } from "lucide-react";
import { motion } from "framer-motion";
import type { QuickChoiceData } from "@/lib/chat-store";

interface Props {
  data: QuickChoiceData;
  onMessage: (text: string) => void;
  /** Number-key hotkeys are enabled only while the composer is empty. */
  hotkeysEnabled?: boolean;
}

const ACTION_ICON: Record<string, React.ElementType> = {
  sparkles: Sparkles,
  "external-link": Globe,
  book: BookOpen,
};

/**
 * Pending-choice panel docked directly above the composer (Claude-style): the question and
 * its options sit where the user's attention already is, instead of a small card lost in
 * the message stream. Press 1–9 to pick an option while the input is empty.
 */
export function QuickChoicePanel({ data, onMessage, hotkeysEnabled = true }: Props) {
  useEffect(() => {
    if (!hotkeysEnabled || !data?.options?.length) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      const idx = Number(e.key) - 1;
      if (Number.isNaN(idx) || idx < 0 || idx >= data.options.length) return;
      const target = e.target as HTMLElement | null;
      // Never steal digits the user is typing into a field.
      if (target && (target.tagName === "TEXTAREA" || target.tagName === "INPUT" || target.isContentEditable)) return;
      const opt = data.options[idx];
      e.preventDefault();
      if (opt.action === "link") {
        window.open(opt.value, "_blank", "noopener,noreferrer");
      } else {
        onMessage(opt.value);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [data, onMessage, hotkeysEnabled]);

  return (
    <motion.div
      initial={{ opacity: 0, y: 14, scale: 0.98 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      exit={{ opacity: 0, y: 10, scale: 0.98 }}
      transition={{ type: "spring", stiffness: 360, damping: 30 }}
      className="relative overflow-hidden rounded-2xl border border-primary/25 bg-card/95 shadow-xl shadow-primary/[0.07] backdrop-blur-xl"
    >
      {/* Soft accent wash so the panel reads as "the assistant is asking you something" */}
      <div
        className="pointer-events-none absolute inset-0 opacity-[0.06]"
        style={{ background: "var(--gradient-primary)" }}
      />

      <div className="relative flex items-center gap-2 px-4 pt-3 pb-2">
        <span className="flex h-6 w-6 items-center justify-center rounded-lg bg-primary/12 text-primary">
          <HelpCircle className="h-3.5 w-3.5" />
        </span>
        <p className="flex-1 text-[13px] font-semibold text-foreground">{data.question}</p>
        <span className="hidden sm:flex items-center gap-1 text-[10px] font-medium text-muted-foreground/60">
          <CornerDownLeft className="h-3 w-3" />
          press 1–{data.options.length}
        </span>
      </div>

      <div
        className={
          data.options.length === 2
            ? "relative grid grid-cols-1 sm:grid-cols-2 gap-2 px-3 pb-3"
            : "relative flex flex-col gap-2 px-3 pb-3"
        }
      >
        {data.options.map((opt, i) => {
          const ActionIcon = ACTION_ICON[opt.icon ?? ""] ?? ChevronRight;
          const inner = (
            <>
              <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg border border-border/60 bg-background/70 text-[12px] font-bold text-foreground/55 transition-colors group-hover:border-primary/40 group-hover:bg-primary/12 group-hover:text-primary">
                {i + 1}
              </span>
              <span className="flex-1 truncate text-left text-[13px] font-medium text-foreground">
                {opt.label}
              </span>
              {opt.action === "link" ? (
                <ExternalLink className="h-3.5 w-3.5 shrink-0 text-foreground/30 transition-colors group-hover:text-primary" />
              ) : (
                <ActionIcon className="h-3.5 w-3.5 shrink-0 text-foreground/30 transition-colors group-hover:text-primary" />
              )}
            </>
          );
          const className =
            "group flex w-full items-center gap-3 rounded-xl border border-border/60 bg-background/60 px-3 py-2.5 transition-all hover:-translate-y-px hover:border-primary/40 hover:bg-primary/[0.06] hover:shadow-md hover:shadow-primary/10 active:translate-y-0";
          return opt.action === "link" ? (
            <a key={i} href={opt.value} target="_blank" rel="noopener noreferrer" className={className}>
              {inner}
            </a>
          ) : (
            <button key={i} type="button" onClick={() => onMessage(opt.value)} className={className}>
              {inner}
            </button>
          );
        })}
      </div>
    </motion.div>
  );
}
