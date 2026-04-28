import { Sparkles, CheckCircle2, ArrowRight, ThumbsUp, ThumbsDown } from "lucide-react";
import type { ReactNode } from "react";

export function UserMessage({ name, initials, children }: { name: string; initials: string; children: ReactNode }) {
  return (
    <div className="mx-auto flex w-full max-w-[780px] gap-4 px-1 animate-[fade-in_.4s_ease-out_both]">
      <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full border border-[var(--color-border-strong)] bg-surface/80 font-mono text-[11px] font-semibold text-muted-foreground">
        {initials}
      </div>
      <div className="flex-1 pt-1">
        <div className="mb-1.5 font-mono text-[10px] uppercase tracking-[0.18em] text-muted-foreground">
          {name}
        </div>
        <div className="text-[15px] leading-relaxed text-foreground/90">{children}</div>
      </div>
    </div>
  );
}

export function AIMessage({ 
  children, 
  live, 
  onFeedback 
}: { 
  children: ReactNode; 
  live?: boolean;
  onFeedback?: (rating: "up" | "down") => void;
}) {
  return (
    <div className="mx-auto flex w-full max-w-[780px] gap-4 px-1 animate-[slide-up_.5s_cubic-bezier(0.22,1,0.36,1)_both]">
      <div className="relative flex h-8 w-8 shrink-0 items-center justify-center rounded-full">
        <div
          className="absolute inset-0 rounded-full"
          style={{
            background: "var(--gradient-primary)",
            boxShadow:
              "0 0 0 1px color-mix(in oklab, var(--accent-cyan) 40%, transparent), 0 6px 24px -6px color-mix(in oklab, var(--accent-cyan) 60%, transparent)",
          }}
        />
        <Sparkles className="relative h-4 w-4 text-primary-foreground" strokeWidth={2.5} />
      </div>
      <div className="flex-1 space-y-3 pt-1">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2 font-mono text-[10px] uppercase tracking-[0.18em]">
            <span className="text-primary font-bold">Nexus AI</span>
            {live && (
              <span className="inline-flex items-center gap-1 rounded-full border-primary/30 bg-primary/10 px-1.5 py-[1px] text-[9px] text-primary font-bold">
                <span className="h-1 w-1 rounded-full bg-primary animate-pulse" />
                Thinking
              </span>
            )}
          </div>
          {!live && onFeedback && (
            <div className="flex items-center gap-1 opacity-0 transition-opacity group-hover/msg:opacity-100">
              <button 
                onClick={() => onFeedback("up")}
                className="flex h-7 w-7 items-center justify-center rounded-md text-muted-foreground hover:bg-surface/60 hover:text-primary transition-all"
              >
                <ThumbsUp className="h-3.5 w-3.5" />
              </button>
              <button 
                onClick={() => onFeedback("down")}
                className="flex h-7 w-7 items-center justify-center rounded-md text-muted-foreground hover:bg-surface/60 hover:text-destructive transition-all"
              >
                <ThumbsDown className="h-3.5 w-3.5" />
              </button>
            </div>
          )}
        </div>
        <div className="group/msg relative">
          {children}
        </div>
      </div>
    </div>
  );
}

export function AnswerCard({
  title,
  rows,
  cta,
  meta,
}: {
  title: string;
  meta?: string;
  rows: { label: string; value: string; highlight?: boolean }[];
  cta?: { label: string; onClick?: () => void };
}) {
  return (
    <div
      className="relative overflow-hidden rounded-2xl border border-[var(--color-border-strong)] bg-card/70 p-5 backdrop-blur-xl"
      style={{ boxShadow: "var(--shadow-elevated)" }}
    >
      {/* top highlight line */}
      <div
        className="absolute inset-x-0 top-0 h-px bg-[color:var(--accent-cyan)]/30"
      />
      {/* corner glow */}
      <div
        aria-hidden
        className="pointer-events-none absolute -right-20 -top-20 h-40 w-40 rounded-full blur-3xl"
        style={{ background: "color-mix(in oklab, var(--accent-cyan) 25%, transparent)" }}
      />

      <div className="relative flex items-start justify-between">
        <div>
          <div className="text-[13px] font-semibold tracking-tight">{title}</div>
          {meta && (
            <div className="mt-0.5 font-mono text-[10px] uppercase tracking-wider text-muted-foreground">
              {meta}
            </div>
          )}
        </div>
        <div className="flex items-center gap-1.5 rounded-full border border-emerald-400/30 bg-emerald-400/10 px-2 py-0.5 text-[10px] font-medium text-emerald-400">
          <CheckCircle2 className="h-3 w-3" strokeWidth={2.5} />
          Resolved in 1 step
        </div>
      </div>

      <div className="relative mt-4 grid gap-1.5">
        {rows.map((r) => (
          <div
            key={r.label}
            className={
              r.highlight
                ? "flex items-center justify-between rounded-lg border border-[color:var(--accent-cyan)]/30 bg-[color:var(--accent-cyan)]/10 px-3 py-2 text-sm"
                : "flex items-center justify-between rounded-lg border border-[var(--color-border)] bg-surface/50 px-3 py-2 text-sm"
            }
          >
            <span className="text-muted-foreground">{r.label}</span>
            <span
              className={
                r.highlight
                  ? "font-mono tabular-nums text-[color:var(--accent-cyan)]"
                  : "font-medium tabular-nums"
              }
            >
              {r.value}
            </span>
          </div>
        ))}
      </div>

      {cta && (
        <div className="relative mt-4 flex justify-end">
          <button
            onClick={cta.onClick}
            className="group inline-flex items-center gap-1.5 rounded-lg border border-[color:var(--accent-cyan)]/40 bg-[color:var(--accent-cyan)]/10 px-3 py-1.5 text-xs font-medium text-[color:var(--accent-cyan)] transition-all hover:bg-[color:var(--accent-cyan)]/20"
          >
            {cta.label}
            <ArrowRight className="h-3.5 w-3.5 transition-transform group-hover:translate-x-0.5" />
          </button>
        </div>
      )}
    </div>
  );
}
