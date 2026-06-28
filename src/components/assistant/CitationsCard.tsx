import { useState } from "react";
import { ShieldCheck, ChevronDown, FileText } from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";
import type { Citation } from "@/lib/chat-store";

/**
 * Cited-answer trust UI (ARB #41).
 *
 * Renders the grounding sources behind a RAG answer as a collapsible "trust card"
 * below the assistant message. Collapsed by default to keep the chat clean; the
 * header signals the answer is grounded ("Grounded in N source(s)") and expanding
 * reveals each source's title, category, and the retrieved excerpt the answer drew on.
 */
export function CitationsCard({ citations }: { citations: Citation[] }) {
  const [open, setOpen] = useState(false);

  if (!citations || citations.length === 0) return null;

  return (
    <div className="mt-3 rounded-xl border border-emerald-500/20 bg-emerald-500/[0.04] dark:bg-emerald-500/[0.06] overflow-hidden">
      <button
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-center gap-2 px-3 py-2 text-left transition-colors hover:bg-emerald-500/[0.08]"
        aria-expanded={open}
      >
        <ShieldCheck className="h-4 w-4 shrink-0 text-emerald-600 dark:text-emerald-400" />
        <span className="text-[12.5px] font-semibold text-emerald-700 dark:text-emerald-300">
          Grounded in {citations.length} {citations.length === 1 ? "source" : "sources"}
        </span>
        <ChevronDown
          className={`ml-auto h-3.5 w-3.5 text-emerald-600/70 dark:text-emerald-400/70 transition-transform ${
            open ? "rotate-180" : ""
          }`}
        />
      </button>

      <AnimatePresence initial={false}>
        {open && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: "auto", opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.18, ease: "easeOut" }}
            className="overflow-hidden"
          >
            <div className="flex flex-col gap-2 px-3 pb-3 pt-1">
              {citations.map((c, idx) => (
                <div
                  key={idx}
                  className="rounded-lg border border-border/60 bg-background/60 px-3 py-2"
                >
                  <div className="flex items-center gap-2">
                    <FileText className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                    <span className="text-[12.5px] font-semibold text-foreground truncate">
                      {c.title}
                    </span>
                    {c.category && (
                      <span className="ml-auto shrink-0 rounded-full bg-muted px-2 py-0.5 text-[10px] font-medium text-muted-foreground">
                        {c.category}
                      </span>
                    )}
                  </div>
                  {c.excerpt && (
                    <p className="mt-1 text-[11.5px] leading-relaxed text-muted-foreground line-clamp-3">
                      “{c.excerpt}…”
                    </p>
                  )}
                </div>
              ))}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
