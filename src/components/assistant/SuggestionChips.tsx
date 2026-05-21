import { useState } from "react";
import { ClipboardList, ArrowRight } from "lucide-react";
import { Popover, PopoverTrigger, PopoverContent } from "@/components/ui/popover";
import { cn } from "@/lib/utils";

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
    <div className="flex items-center justify-end gap-2 mb-2 flex-wrap animate-[fade-in_.3s_ease-out_both]">
      {inline.map((s) => (
        <button
          key={s}
          onClick={() => handleSelect(s)}
          className={cn(
            "rounded-full border border-[var(--border)] bg-card/60 px-3 py-1.5",
            "text-[12px] font-medium text-foreground hover:bg-secondary",
            "transition-colors max-w-[220px] truncate shrink-0"
          )}
          title={s}
        >
          {s}
        </button>
      ))}

      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>
          <button
            className={cn(
              "flex items-center gap-1.5 rounded-full border border-[var(--border)]",
              "bg-card/60 px-3 py-1.5 text-[12px] font-medium text-muted-foreground",
              "hover:bg-secondary hover:text-foreground transition-colors shrink-0"
            )}
            title="View prompts"
          >
            <ClipboardList className="h-3.5 w-3.5" />
            <span>View prompts</span>
            <span className="flex h-4 w-4 items-center justify-center rounded-full bg-primary text-[10px] font-bold text-white leading-none">
              {suggestions.length}
            </span>
          </button>
        </PopoverTrigger>
        <PopoverContent
          className="w-80 p-0 overflow-hidden rounded-2xl border-[var(--border)] bg-card/95 backdrop-blur-xl shadow-2xl"
          align="end"
          side="top"
          sideOffset={12}
        >
          <p className="px-4 pt-3 pb-2 text-[10px] font-semibold uppercase tracking-widest text-muted-foreground/60">
            Suggested follow-ups
          </p>
          <div className="flex flex-col divide-y divide-[var(--border)]">
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
    </div>
  );
}
