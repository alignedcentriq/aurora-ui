import { ArrowUp, Paperclip, Sparkles } from "lucide-react";
import { useRef, useEffect } from "react";

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
    el.style.height = Math.min(el.scrollHeight, 220) + "px";
  }, [value]);

  return (
    <div className="relative">
      {/* Outer glow */}
      <div
        aria-hidden
        className="pointer-events-none absolute -inset-1 rounded-[22px] opacity-60 blur-xl transition-opacity"
        style={{ background: "var(--gradient-primary)", opacity: 0.18 }}
      />

      <div
        className="glass-strong relative flex flex-col rounded-[20px] p-2 shadow-[var(--shadow-elevated)] focus-within:border-[color:var(--accent-cyan)]/50"
      >
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
          placeholder="Ask anything — leaves, payslip, VPN, policies, forms…"
          rows={1}
          className="max-h-[220px] min-h-[44px] w-full resize-none bg-transparent px-3 py-2.5 text-[15px] leading-relaxed text-foreground outline-none placeholder:text-muted-foreground/70"
        />

        <div className="flex items-center justify-between gap-2 px-2 pb-1 pt-1">
          <div className="flex items-center gap-1">
            <button
              type="button"
              onClick={onAttach}
              className="flex h-8 items-center gap-1.5 rounded-lg border border-transparent px-2.5 text-xs text-muted-foreground transition-all hover:border-[var(--color-border-strong)] hover:bg-surface/60 hover:text-foreground active:scale-95"
            >
              <Paperclip className="h-3.5 w-3.5" />
              Attach
            </button>
            <button
              type="button"
              onClick={onSuggest}
              className="flex h-8 items-center gap-1.5 rounded-lg border border-transparent px-2.5 font-mono text-[11px] text-muted-foreground transition-all hover:border-[var(--color-border-strong)] hover:bg-surface/60 hover:text-foreground active:scale-95"
            >
              <Sparkles className="h-3.5 w-3.5" />
              /suggest
            </button>
          </div>

          <button
            type="button"
            onClick={() => value.trim() && onSubmit()}
            disabled={disabled || !value.trim()}
            className="group relative flex h-9 items-center gap-2 overflow-hidden rounded-xl px-4 text-sm font-semibold text-primary-foreground transition-all disabled:cursor-not-allowed disabled:opacity-40 active:scale-[0.97]"
            style={{
              background: "var(--gradient-primary)",
              boxShadow:
                "0 0 0 1px color-mix(in oklab, var(--accent-cyan) 30%, transparent), 0 8px 24px -8px color-mix(in oklab, var(--accent-cyan) 55%, transparent)",
            }}
          >
            <span>Ask</span>
            <ArrowUp className="h-4 w-4 transition-transform group-hover:-translate-y-0.5" strokeWidth={2.5} />
          </button>
        </div>
      </div>

      <div className="mt-3 text-center font-mono text-[10px] uppercase tracking-[0.2em] text-muted-foreground/70">
        Synapse may make mistakes · Verify sensitive info with HR/IT
      </div>
    </div>
  );
}
