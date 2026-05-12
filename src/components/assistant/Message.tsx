import { Sparkles, CheckCircle2, ArrowRight, ThumbsUp, ThumbsDown } from "lucide-react";
import type { ReactNode } from "react";
import { cn } from "@/lib/utils";
import { Logo } from "@/components/Logo";
import { BrandName } from "@/components/BrandName";

export function UserMessage({
  name,
  initials,
  children,
}: {
  name?: string;
  initials?: string;
  children: ReactNode;
}) {
  return (
    <div className="flex w-full justify-end animate-[fade-in_.4s_ease-out_both] gap-3">
      <div className="chat-bubble-user">
        <div className="text-[15px] leading-relaxed">{children}</div>
      </div>
      {initials ? (
        <div className="mt-1 flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-primary/20 text-[11px] font-bold text-primary shadow-sm">
          {initials}
        </div>
      ) : (
        <div className="mt-1 flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-primary text-white text-[11px] font-bold">
          U
        </div>
      )}
    </div>
  );
}

export function AIMessage({
  children,
  live,
  onFeedback,
}: {
  children: ReactNode;
  live?: boolean;
  onFeedback?: (rating: "up" | "down") => void;
}) {
  return (
    <div className="flex w-full justify-start animate-[slide-up_.5s_cubic-bezier(0.16,1,0.3,1)_both]">
      <div className="flex max-w-[85%] gap-3">
        <Logo size="sm" className="mt-1 shadow-sm shrink-0" />

        <div className="flex-1 space-y-2">
          <div className="chat-bubble-assistant">
            <div className="group/msg relative">{children}</div>
          </div>

          <div className="flex items-center justify-between px-1">
            <div className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground/60 flex items-center">
              <BrandName withAI />
            </div>
            {!live && onFeedback && (
              <div className="flex items-center gap-1 opacity-0 transition-opacity hover:opacity-100 group-hover:opacity-100">
                <button
                  onClick={() => onFeedback("up")}
                  className="flex h-6 w-6 items-center justify-center rounded-md text-muted-foreground hover:bg-secondary hover:text-primary transition-all"
                >
                  <ThumbsUp className="h-3 w-3" />
                </button>
                <button
                  onClick={() => onFeedback("down")}
                  className="flex h-6 w-6 items-center justify-center rounded-md text-muted-foreground hover:bg-secondary hover:text-destructive transition-all"
                >
                  <ThumbsDown className="h-3 w-3" />
                </button>
              </div>
            )}
          </div>
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
    <div className="glass-card mt-3 overflow-hidden rounded-xl p-5 shadow-sm border-[var(--border)]">
      <div className="flex items-start justify-between">
        <div>
          <div className="text-sm font-bold text-foreground tracking-tight">{title}</div>
          {meta && (
            <div className="mt-0.5 text-[10px] font-medium text-muted-foreground">{meta}</div>
          )}
        </div>
        <div className="flex items-center gap-1.5 rounded-full bg-emerald-500/10 px-2 py-0.5 text-[10px] font-bold text-emerald-500">
          <CheckCircle2 className="h-3 w-3" strokeWidth={2.5} />
          Verified
        </div>
      </div>

      <div className="mt-4 space-y-2">
        {rows.map((r) => (
          <div
            key={r.label}
            className={cn(
              "flex items-center justify-between rounded-lg px-3 py-2 text-sm transition-colors",
              r.highlight
                ? "bg-primary/5 text-primary border border-primary/10"
                : "bg-muted/30 text-foreground border border-transparent",
            )}
          >
            <span className="opacity-70 font-medium">{r.label}</span>
            <span className={cn("font-bold", r.highlight && "text-primary")}>{r.value}</span>
          </div>
        ))}
      </div>

      {cta && (
        <div className="mt-4 flex justify-end">
          <button
            onClick={cta.onClick}
            className="flex items-center gap-1.5 rounded-lg bg-primary px-3 py-1.5 text-xs font-bold text-white shadow-sm transition-all hover:bg-primary/90 active:scale-95"
          >
            {cta.label}
            <ArrowRight className="h-3.5 w-3.5" />
          </button>
        </div>
      )}
    </div>
  );
}
