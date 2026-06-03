import { useState } from "react";
import { ClipboardList, ArrowRight } from "lucide-react";
import { Popover, PopoverTrigger, PopoverContent } from "@/components/ui/popover";
import { cn } from "@/lib/utils";
import { motion, AnimatePresence } from "framer-motion";

type Props = {
  suggestions: string[];
  onSelect: (text: string) => void;
};

export function SuggestionChips({ suggestions, onSelect }: Props) {
  const [open, setOpen] = useState(false);

  if (!suggestions.length) return null;

  const inline = suggestions.slice(0, 2);

  const handleSelect = (text: string) => {
    setOpen(false);
    onSelect(text);
  };

  return (
    <motion.div
      initial={{ opacity: 0, y: 6 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.3, ease: [0.16, 1, 0.3, 1] }}
      className="flex items-center justify-end gap-2 mb-2 flex-wrap"
    >
      {inline.map((s, i) => (
        <motion.button
          key={s}
          initial={{ opacity: 0, scale: 0.9 }}
          animate={{ opacity: 1, scale: 1 }}
          transition={{ delay: i * 0.08, type: "spring", stiffness: 400, damping: 25 }}
          whileHover={{ scale: 1.03 }}
          whileTap={{ scale: 0.95 }}
          onClick={() => handleSelect(s)}
          className={cn(
            "rounded-full border border-border bg-card/60 backdrop-blur-sm px-3 py-1.5",
            "text-[12px] font-medium text-foreground hover:bg-secondary hover:border-primary/20",
            "transition-colors max-w-[220px] truncate shrink-0 shadow-sm"
          )}
          title={s}
        >
          {s}
        </motion.button>
      ))}

      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>
          <motion.button
            initial={{ opacity: 0, scale: 0.9 }}
            animate={{ opacity: 1, scale: 1 }}
            transition={{ delay: 0.16, type: "spring", stiffness: 400, damping: 25 }}
            whileTap={{ scale: 0.95 }}
            className={cn(
              "flex items-center gap-1.5 rounded-full border border-border",
              "bg-card/60 backdrop-blur-sm px-3 py-1.5 text-[12px] font-medium text-muted-foreground",
              "hover:bg-secondary hover:text-foreground hover:border-primary/20 transition-colors shrink-0 shadow-sm"
            )}
            title="View prompts"
          >
            <ClipboardList className="h-3.5 w-3.5" />
            <span>View prompts</span>
            <span className="flex h-4 w-4 items-center justify-center rounded-full bg-primary text-[10px] font-bold text-white leading-none">
              {suggestions.length}
            </span>
          </motion.button>
        </PopoverTrigger>
        <PopoverContent
          className="w-80 p-0 overflow-hidden rounded-2xl border-border bg-card/95 backdrop-blur-xl shadow-2xl"
          align="end"
          side="top"
          sideOffset={12}
        >
          <p className="px-4 pt-3 pb-2 text-[10px] font-semibold uppercase tracking-widest text-muted-foreground/60">
            Suggested follow-ups
          </p>
          <div className="flex flex-col divide-y divide-border">
            {suggestions.map((s) => (
              <button
                key={s}
                onClick={() => handleSelect(s)}
                className="flex items-center justify-between gap-3 w-full px-4 py-3 text-left text-[13px] text-foreground hover:bg-secondary/50 transition-colors group"
              >
                <span className="line-clamp-2 flex-1">{s}</span>
                <ArrowRight className="h-3.5 w-3.5 shrink-0 text-muted-foreground group-hover:text-primary transition-colors" />
              </button>
            ))}
          </div>
          <div className="h-1" />
        </PopoverContent>
      </Popover>
    </motion.div>
  );
}
