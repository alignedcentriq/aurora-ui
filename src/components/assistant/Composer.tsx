import { Send, Paperclip, Plus, Mic, FileText } from "lucide-react";
import { useRef, useEffect, useState } from "react";
import { cn } from "@/lib/utils";
import { BrandName } from "@/components/BrandName";
import { Popover, PopoverTrigger, PopoverContent } from "@/components/ui/popover";

type Props = {
  value: string;
  onChange: (v: string) => void;
  onSubmit: () => void;
  onAttach?: () => void;
  onQuickAction?: (prompt: string) => void;
  onGenerateDoc?: () => void;
  disabled?: boolean;
};

export function Composer({
  value,
  onChange,
  onSubmit,
  onAttach,
  onQuickAction,
  onGenerateDoc,
  disabled,
}: Props) {
  const ref = useRef<HTMLTextAreaElement>(null);

  const [isOpen, setIsOpen] = useState(false);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.style.height = "0px";
    el.style.height = Math.min(el.scrollHeight, 200) + "px";
  }, [value]);

  return (
    <div className="relative w-full max-w-4xl mx-auto">
      <div className="relative flex flex-col rounded-[24px] border border-[var(--border)] bg-card/40 backdrop-blur-2xl shadow-2xl transition-all focus-within:border-primary/30 p-2">
        <textarea
          ref={ref}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              if (value.trim()) onSubmit();
            }
          }}
          placeholder="Message Centriq AI..."
          disabled={disabled}
          className="max-h-[200px] min-h-[40px] w-full resize-none bg-transparent px-4 py-2 text-[16px] leading-relaxed text-foreground outline-none placeholder:text-muted-foreground/40 disabled:opacity-50 disabled:cursor-not-allowed"
        />

        <div className="flex items-center justify-between px-2 pb-2">
          <div className="flex items-center gap-1">
            <Popover open={isOpen} onOpenChange={setIsOpen}>
              <PopoverTrigger asChild>
                <button
                  type="button"
                  className="flex h-10 w-10 items-center justify-center rounded-full text-muted-foreground transition-all hover:bg-secondary hover:text-foreground active:scale-90"
                  title="Add"
                >
                  <Plus className="h-6 w-6" strokeWidth={1.5} />
                </button>
              </PopoverTrigger>
              <PopoverContent className="w-48 p-0 overflow-hidden rounded-2xl border-[var(--border)] bg-card/95 backdrop-blur-xl shadow-2xl" align="start" side="top" sideOffset={12}>
                <div className="flex flex-col">
                  <button
                    onClick={() => {
                      onAttach?.();
                      setIsOpen(false);
                    }}
                    className="flex items-center gap-3 w-full px-4 py-3.5 text-[13px] font-semibold hover:bg-secondary/50 transition-colors text-left group"
                  >
                    <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-primary/10 text-primary group-hover:scale-110 transition-transform">
                      <Paperclip className="h-4 w-4" />
                    </div>
                    Attach Files
                  </button>
                </div>
              </PopoverContent>
            </Popover>
          </div>

          <div className="flex items-center gap-2">
            {onGenerateDoc && (
              <button
                type="button"
                onClick={onGenerateDoc}
                disabled={disabled}
                className="flex h-10 w-10 items-center justify-center rounded-full text-muted-foreground transition-all hover:bg-secondary hover:text-foreground active:scale-90 disabled:cursor-not-allowed disabled:opacity-50"
                title="Generate document"
              >
                <FileText className="h-5 w-5" strokeWidth={1.5} />
              </button>
            )}

            <button
              type="button"
              className="flex h-10 w-10 items-center justify-center rounded-full text-muted-foreground transition-all hover:bg-secondary hover:text-foreground active:scale-90"
              title="Voice input"
            >
              <Mic className="h-5 w-5" strokeWidth={1.5} />
            </button>

            {value.trim() && (
              <button
                type="button"
                onClick={() => onSubmit()}
                disabled={disabled}
                className="flex h-10 w-10 items-center justify-center rounded-full bg-primary text-white shadow-lg shadow-primary/20 transition-all hover:bg-primary/90 active:scale-95"
              >
                <Send className="h-5 w-5" />
              </button>
            )}
          </div>
        </div>
      </div>

      <div className="mt-4 flex items-center justify-center gap-1 text-center text-[11px] font-medium text-muted-foreground/50 uppercase tracking-widest">
        <BrandName withAI plain /> <span className="lowercase">can make mistakes. Consider checking important information.</span>
      </div>
    </div>
  );
}
