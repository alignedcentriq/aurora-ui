import { CheckCircle2, ArrowRight, ThumbsUp, ThumbsDown, Send } from "lucide-react";
import { useState, type ReactNode } from "react";
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
    </div>
  );
}

const DOMAIN_BADGE: Record<string, { label: string; classes: string }> = {
  hr: { label: "HR", classes: "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400" },
  admin: { label: "Admin", classes: "bg-amber-500/10 text-amber-600 dark:text-amber-400" },
  it_support: { label: "IT Support", classes: "bg-blue-500/10 text-blue-600 dark:text-blue-400" },
  pmo: { label: "PMO", classes: "bg-violet-500/10 text-violet-600 dark:text-violet-400" },
  functional_manager: { label: "Manager", classes: "bg-indigo-500/10 text-indigo-600 dark:text-indigo-400" },
  general: { label: "General", classes: "bg-muted text-muted-foreground" },
};

type FeedbackState = "idle" | "up" | "down_pending" | "submitted";

export function AIMessage({
  children,
  live,
  onFeedback,
  domain,
}: {
  children: ReactNode;
  live?: boolean;
  onFeedback?: (rating: "up" | "down", feedbackText?: string) => void;
  domain?: string;
}) {
  const badge = domain ? DOMAIN_BADGE[domain] : null;
  const [feedbackState, setFeedbackState] = useState<FeedbackState>("idle");
  const [feedbackText, setFeedbackText] = useState("");

  const handleThumbsUp = () => {
    if (feedbackState !== "idle") return;
    setFeedbackState("up");
    onFeedback?.("up");
  };

  const handleThumbsDown = () => {
    if (feedbackState !== "idle") return;
    setFeedbackState("down_pending");
  };

  const handleSubmitNegative = () => {
    onFeedback?.("down", feedbackText.trim());
    setFeedbackState("submitted");
  };

  const handleSkipReason = () => {
    onFeedback?.("down");
    setFeedbackState("submitted");
  };

  return (
    <div className="flex w-full justify-start animate-[slide-up_.5s_cubic-bezier(0.16,1,0.3,1)_both]">
      <div className="flex max-w-[85%] gap-3">
        <Logo size="sm" className="mt-1 shadow-sm shrink-0" />

        <div className="flex-1 space-y-2">
          <div className="chat-bubble-assistant">
            <div className="group/msg relative">{children}</div>
          </div>

          <div className="flex flex-col gap-2 px-1">
            {/* Brand + domain badge row */}
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <div className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground/60 flex items-center">
                  <BrandName withAI />
                </div>
                {badge && (
                  <span className={cn("rounded-md px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wider", badge.classes)}>
                    {badge.label}
                  </span>
                )}
              </div>

              {/* Feedback buttons — only shown when idle and not live */}
              {!live && onFeedback && feedbackState === "idle" && (
                <div className="flex items-center gap-1 opacity-0 transition-opacity hover:opacity-100 group-hover:opacity-100">
                  <button
                    onClick={handleThumbsUp}
                    title="Helpful"
                    className="flex h-6 w-6 items-center justify-center rounded-md text-muted-foreground hover:bg-secondary hover:text-primary transition-all"
                  >
                    <ThumbsUp className="h-3 w-3" />
                  </button>
                  <button
                    onClick={handleThumbsDown}
                    title="Not helpful"
                    className="flex h-6 w-6 items-center justify-center rounded-md text-muted-foreground hover:bg-secondary hover:text-destructive transition-all"
                  >
                    <ThumbsDown className="h-3 w-3" />
                  </button>
                </div>
              )}

              {/* Confirmed thumbs up */}
              {!live && feedbackState === "up" && (
                <span className="flex items-center gap-1 text-[10px] font-medium text-emerald-500">
                  <ThumbsUp className="h-3 w-3" />
                  Helpful
                </span>
              )}

              {/* After negative feedback submitted */}
              {!live && feedbackState === "submitted" && (
                <span className="text-[10px] font-medium text-muted-foreground">
                  Thanks for the feedback
                </span>
              )}
            </div>

            {/* Inline negative-feedback form */}
            {!live && feedbackState === "down_pending" && (
              <div className="rounded-xl border border-destructive/20 bg-destructive/5 p-3 space-y-2">
                <p className="text-[11px] font-medium text-foreground/70">
                  What was wrong with this answer? <span className="text-muted-foreground">(optional)</span>
                </p>
                <textarea
                  autoFocus
                  value={feedbackText}
                  onChange={(e) => setFeedbackText(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" && !e.shiftKey) {
                      e.preventDefault();
                      handleSubmitNegative();
                    }
                    if (e.key === "Escape") handleSkipReason();
                  }}
                  placeholder="e.g. The policy details were incorrect, or it gave a generic answer..."
                  rows={2}
                  className="w-full resize-none rounded-lg border border-border bg-background px-3 py-2 text-[13px] text-foreground placeholder:text-muted-foreground/50 outline-none focus:ring-1 focus:ring-destructive/30 transition-all"
                />
                <div className="flex items-center justify-end gap-2">
                  <button
                    onClick={handleSkipReason}
                    className="text-[11px] text-muted-foreground hover:text-foreground transition-colors"
                  >
                    Skip
                  </button>
                  <button
                    onClick={handleSubmitNegative}
                    className="flex items-center gap-1.5 rounded-lg bg-destructive/10 px-3 py-1.5 text-[11px] font-semibold text-destructive hover:bg-destructive/20 transition-all"
                  >
                    <Send className="h-3 w-3" />
                    Send feedback
                  </button>
                </div>
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
