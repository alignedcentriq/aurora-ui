import { ExternalLink, HelpCircle, ChevronRight, Sparkles, Globe } from "lucide-react";
import { motion } from "framer-motion";
import type { QuickChoiceData } from "@/lib/chat-store";

interface Props {
  data: QuickChoiceData;
  onMessage: (text: string) => void;
}

const ACTION_ICON: Record<string, React.ElementType> = {
  sparkles: Sparkles,
  "external-link": Globe,
};

export function ChoiceWidget({ data, onMessage }: Props) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 6 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.2 }}
      className="mt-3 rounded-2xl border border-border bg-card shadow-md overflow-hidden max-w-sm"
    >
      <div className="px-4 py-3 border-b border-border/60 bg-muted/30">
        <p className="text-[13px] font-semibold text-foreground flex items-center gap-1.5">
          <HelpCircle className="h-3.5 w-3.5 shrink-0 text-primary" />
          {data.question}
        </p>
      </div>
      <div className="flex flex-col">
        {data.options.map((opt, i) => {
          const ActionIcon = ACTION_ICON[opt.icon ?? ""] ?? ChevronRight;
          if (opt.action === "link") {
            return (
              <a
                key={i}
                href={opt.value}
                target="_blank"
                rel="noopener noreferrer"
                className="group flex items-center gap-3 px-4 py-3 hover:bg-primary/[0.08] border-b border-border/40 last:border-0 transition-colors"
              >
                <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-muted/70 text-[12px] font-bold text-foreground/50 group-hover:bg-primary/15 group-hover:text-primary transition-colors">
                  {i + 1}
                </span>
                <span className="flex-1 text-[13px] font-medium text-foreground">{opt.label}</span>
                <ExternalLink className="h-3.5 w-3.5 text-foreground/30 group-hover:text-primary transition-colors" />
              </a>
            );
          }
          return (
            <button
              key={i}
              onClick={() => onMessage(opt.value)}
              className="group flex items-center gap-3 px-4 py-3 hover:bg-primary/[0.08] border-b border-border/40 last:border-0 transition-colors text-left w-full"
            >
              <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-muted/70 text-[12px] font-bold text-foreground/50 group-hover:bg-primary/15 group-hover:text-primary transition-colors">
                {i + 1}
              </span>
              <span className="flex-1 text-[13px] font-medium text-foreground">{opt.label}</span>
              <ActionIcon className="h-3.5 w-3.5 text-foreground/30 group-hover:text-primary transition-colors" />
            </button>
          );
        })}
      </div>
    </motion.div>
  );
}
