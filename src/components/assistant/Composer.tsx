import { Send, Paperclip, Sparkles, Mic } from "lucide-react";
import { useRef, useEffect } from "react";
import { cn } from "@/lib/utils";

type Props = {
  value: string;
  onChange: (v: string) => void;
  onSubmit: () => void;
  onAttach?: () => void;
  onSuggest?: () => void;
  disabled?: boolean;
};

export function Composer({ value, onChange, onSubmit, onAttach, onSuggest, disabled }: Props) {
  const ref = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.style.height = "0px";
    el.style.height = Math.min(el.scrollHeight, 200) + "px";
  }, [value]);

  return (
    <div className="relative w-full max-w-4xl mx-auto">
      <div className="relative flex flex-col rounded-2xl border border-[var(--border)] bg-card/60 backdrop-blur-xl shadow-lg transition-all focus-within:border-primary/50 focus-within:ring-4 focus-within:ring-primary/5 p-2">
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
          placeholder="Message Nexus AI..."
          rows={1}
          className="max-h-[200px] min-h-[48px] w-full resize-none bg-transparent px-4 py-3 text-[15px] leading-relaxed text-foreground outline-none placeholder:text-muted-foreground/50"
        />

        <div className="flex items-center justify-between gap-2 px-2 pb-1 pt-1">
          <div className="flex items-center gap-1">
            <button
              type="button"
              onClick={onAttach}
              className="flex h-9 w-9 items-center justify-center rounded-xl text-muted-foreground transition-all hover:bg-secondary hover:text-foreground active:scale-90"
              title="Attach files"
            >
              <Paperclip className="h-4 w-4" />
            </button>
            <button
              type="button"
              onClick={onSuggest}
              className="flex h-9 w-9 items-center justify-center rounded-xl text-muted-foreground transition-all hover:bg-secondary hover:text-foreground active:scale-90"
              title="Suggestions"
            >
              <Sparkles className="h-4 w-4" />
            </button>
            <button
              type="button"
              className="flex h-9 w-9 items-center justify-center rounded-xl text-muted-foreground transition-all hover:bg-secondary hover:text-foreground active:scale-90"
              title="Voice input"
            >
              <Mic className="h-4 w-4" />
            </button>
          </div>

          <button
            type="button"
            onClick={() => value.trim() && onSubmit()}
            disabled={disabled || !value.trim()}
            className="flex h-10 w-10 items-center justify-center rounded-xl bg-primary text-white shadow-md shadow-primary/20 transition-all hover:bg-primary/90 disabled:opacity-30 disabled:grayscale disabled:cursor-not-allowed active:scale-95"
          >
            <Send className="h-5 w-5" />
          </button>
        </div>
      </div>

      <div className="mt-4 text-center text-[11px] font-medium text-muted-foreground/50 uppercase tracking-widest">
        Nexus AI can make mistakes. Consider checking important information.
      </div>
    </div>
  );
}
