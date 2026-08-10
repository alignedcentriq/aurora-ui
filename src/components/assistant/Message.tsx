import {
  CheckCircle2,
  ArrowRight,
  ThumbsUp,
  ThumbsDown,
  Send,
  Copy,
  Check,
  Bookmark,
} from "lucide-react";
import { useState, type ReactNode } from "react";
import { cn } from "@/lib/utils";
import { Logo } from "@/components/Logo";
import { motion } from "framer-motion";
import { EscalationWidget } from "./EscalationWidget";

export function UserMessage({
  name,
  initials,
  children,
  text,
  onSaveQuickSearch,
}: {
  name?: string;
  initials?: string;
  children: ReactNode;
  text?: string;
  onSaveQuickSearch?: (text: string) => void;
}) {
  return (
    <div className="flex w-full justify-end gap-3 group/user-msg relative items-center">
      {onSaveQuickSearch && text && (
        <motion.button
          whileTap={{ scale: 0.85 }}
          onClick={() => onSaveQuickSearch(text)}
          className="opacity-0 group-hover/user-msg:opacity-100 transition-all duration-200 flex h-7 w-7 items-center justify-center rounded-lg text-muted-foreground hover:bg-secondary hover:text-foreground mr-1 shrink-0 cursor-pointer"
          title="Save Prompt"
        >
          <Bookmark className="h-3.5 w-3.5" />
        </motion.button>
      )}
      <div className="chat-bubble-user">
        <div className="text-[15px] leading-relaxed select-text cursor-text">{children}</div>
      </div>
    </div>
  );
}

// Phrases that indicate the AI couldn't answer the question.
// When matched, a compact "Need help from a person?" escalation hint appears.
const REFUSAL_PHRASES = [
  // Explicit inability
  "i'm unable to help",
  "i am unable to help",
  "i'm not able to help",
  "i cannot help with",
  "i can't help with",
  "i'm unable to assist",
  "i am unable to assist",
  "i cannot assist with",
  "i can't assist with",
  "not able to provide",
  "unable to provide",
  "i cannot provide",
  "i can't provide that",
  "i'm afraid i can't",
  // Scope / area
  "outside my area",
  "outside the scope",
  "outside of my expertise",
  "beyond my capabilities",
  "beyond what i can",
  "beyond my expertise",
  "not within my",
  "this is outside",
  "that falls outside",
  // No information found
  "i couldn't find",
  "i could not find",
  "couldn't find it in the policy",
  "couldn't find any information",
  "no information found",
  "not found in the policy",
  "i don't have access to that",
  "i do not have access to that",
  "i don't have information about that",
  "i don't have enough information to",
  "unfortunately, i don't have",
  "unfortunately i don't have",
  "i'm not sure i can help",
  // Explicit referrals / "please contact ..."
  "please contact hr",
  "please contact the hr",
  "please contact admin",
  "please contact it",
  "please contact your manager",
  "please contact the it",
  "please contact the admin",
  "please contact the relevant",
  "please reach out to hr",
  "please reach out to the hr",
  "please reach out to it",
  "please reach out to admin",
  "reach out to hr",
  "reach out to the it",
  "reach out to admin",
  "contact hr directly",
  "contact the hr team",
  "contact your hr",
  "contact the it helpdesk",
  "contact the it team",
  "contact your manager",
  "contact the admin",
  "i recommend contacting",
  "i suggest contacting",
  "i recommend reaching out",
  "you may want to contact",
  "you should contact",
  "you can contact",
];

const REFERRAL_PHRASES = [
  "please contact",
  "please reach out",
  "reach out to hr",
  "reach out to the it",
  "reach out to admin",
  "contact hr directly",
  "contact the hr",
  "contact your hr",
  "contact the it",
  "contact the admin",
  "contact your manager",
  "i recommend contacting",
  "i suggest contacting",
  "i recommend reaching out",
  "you may want to contact",
  "you should contact",
  "you can contact",
];

function detectsRefusal(text?: string): boolean {
  if (!text || text.length < 15) return false;
  const lower = text.toLowerCase();
  return REFUSAL_PHRASES.some((p) => lower.includes(p));
}

function detectsReferral(text?: string): boolean {
  if (!text) return false;
  const lower = text.toLowerCase();
  return REFERRAL_PHRASES.some((p) => lower.includes(p));
}

const DOMAIN_BADGE: Record<string, { label: string; classes: string; borderColor: string }> = {
  hr: {
    label: "HR",
    classes: "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400",
    borderColor: "border-l-emerald-500",
  },
  admin: {
    label: "Admin",
    classes: "bg-amber-500/10 text-amber-600 dark:text-amber-400",
    borderColor: "border-l-amber-500",
  },
  it_support: {
    label: "IT Support",
    classes: "bg-blue-500/10 text-blue-600 dark:text-blue-400",
    borderColor: "border-l-blue-500",
  },
  pmo: {
    label: "PMO",
    classes: "bg-violet-500/10 text-violet-600 dark:text-violet-400",
    borderColor: "border-l-violet-500",
  },
  functional_manager: {
    label: "Manager",
    classes: "bg-indigo-500/10 text-indigo-600 dark:text-indigo-400",
    borderColor: "border-l-indigo-500",
  },
  general: {
    label: "General",
    classes: "bg-muted text-muted-foreground",
    borderColor: "border-l-muted-foreground",
  },
};

type FeedbackState = "idle" | "up" | "down_pending" | "submitted";

export function AIMessage({
  children,
  live,
  onFeedback,
  domain,
  text,
  isError,
  sessionId,
  originalQuery,
  isPrivate,
  onVideoBg,
}: {
  children: ReactNode;
  live?: boolean;
  onFeedback?: (rating: "up" | "down", feedbackText?: string) => void;
  domain?: string;
  text?: string;
  /** Mark this as an error message so the escalation bar shows automatically */
  isError?: boolean;
  sessionId?: string;
  originalQuery?: string;
  isPrivate?: boolean;
  /** Renders as dark frosted glass instead of a solid bubble — used over the home tab's video background. */
  onVideoBg?: boolean;
}) {
  const badge = domain ? DOMAIN_BADGE[domain] : null;
  const [feedbackState, setFeedbackState] = useState<FeedbackState>("idle");
  const [feedbackText, setFeedbackText] = useState("");
  const [copied, setCopied] = useState(false);

  // Detect soft refusals / explicit referrals — show escalation hint without waiting for thumbs-down
  const softRefusal = !isError && !live && detectsRefusal(text);
  const isReferral = softRefusal && detectsReferral(text);

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

  const handleCopy = () => {
    if (!text) return;
    navigator.clipboard.writeText(text).then(() => {
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2000);
    });
  };

  return (
    <div className="flex w-full justify-start">
      <div className="group flex max-w-[90%] lg:max-w-[85%] gap-3">
        {/* AI Avatar with subtle breathe animation */}
        <motion.div
          animate={live ? { scale: [1, 1.05, 1] } : {}}
          transition={live ? { duration: 2, repeat: Infinity, ease: "easeInOut" } : {}}
          className="mt-1 shrink-0"
        >
          <Logo size="sm" className="shadow-sm" />
        </motion.div>

        <div className="flex-1 min-w-0 space-y-1.5">
          {/* Message bubble with domain border accent */}
          <div
            className={cn(
              "chat-bubble-assistant",
              onVideoBg && "on-video dark",
              badge && `border-l-2 ${badge.borderColor}`,
            )}
          >
            <div className="relative">{children}</div>
          </div>

          {/* Action bar — copy + feedback */}
          {!live && (
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              transition={{ delay: 0.3 }}
              className="flex items-center gap-1 px-1 opacity-100 lg:opacity-0 lg:group-hover:opacity-100 transition-opacity duration-200"
            >
              {/* Copy */}
              {text && (
                <motion.button
                  whileTap={{ scale: 0.9 }}
                  onClick={handleCopy}
                  title="Copy response"
                  className={cn(
                    "flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-[11px] font-medium transition-all",
                    copied
                      ? "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400"
                      : onVideoBg
                        ? "text-white/60 hover:bg-white/10 hover:text-white"
                        : "text-muted-foreground hover:bg-secondary hover:text-foreground",
                  )}
                >
                  {copied ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />}
                  {copied ? "Copied" : "Copy"}
                </motion.button>
              )}

              {onFeedback && feedbackState === "idle" && !isPrivate && (
                <>
                  {text && (
                    <div className={cn("w-px h-3.5 mx-0.5", onVideoBg ? "bg-white/20" : "bg-border/60")} />
                  )}
                  <motion.button
                    whileTap={{ scale: 0.85 }}
                    onClick={handleThumbsUp}
                    title="Helpful"
                    className={cn(
                      "flex h-7 w-7 items-center justify-center rounded-lg transition-all",
                      onVideoBg
                        ? "text-white/60 hover:bg-white/10 hover:text-emerald-400"
                        : "text-muted-foreground hover:bg-secondary hover:text-emerald-500",
                    )}
                  >
                    <ThumbsUp className="h-3.5 w-3.5" />
                  </motion.button>
                  <motion.button
                    whileTap={{ scale: 0.85 }}
                    onClick={handleThumbsDown}
                    title="Not helpful"
                    className={cn(
                      "flex h-7 w-7 items-center justify-center rounded-lg transition-all",
                      onVideoBg
                        ? "text-white/60 hover:bg-white/10 hover:text-destructive"
                        : "text-muted-foreground hover:bg-secondary hover:text-destructive",
                    )}
                  >
                    <ThumbsDown className="h-3.5 w-3.5" />
                  </motion.button>
                </>
              )}

              {feedbackState === "up" && (
                <motion.span
                  initial={{ opacity: 0, scale: 0.8 }}
                  animate={{ opacity: 1, scale: 1 }}
                  className="flex items-center gap-1 text-[11px] font-medium text-emerald-500 px-1"
                >
                  <ThumbsUp className="h-3.5 w-3.5" />
                  Helpful
                </motion.span>
              )}

              {feedbackState === "submitted" && (
                <motion.span
                  initial={{ opacity: 0, scale: 0.8 }}
                  animate={{ opacity: 1, scale: 1 }}
                  className={cn(
                    "text-[11px] font-medium px-1",
                    onVideoBg ? "text-white/60" : "text-muted-foreground",
                  )}
                >
                  Thanks for the feedback
                </motion.span>
              )}
            </motion.div>
          )}

          {/* Inline negative-feedback form */}
          {!live && feedbackState === "down_pending" && (
            <motion.div
              initial={{ opacity: 0, height: 0 }}
              animate={{ opacity: 1, height: "auto" }}
              className="rounded-xl border border-destructive/20 bg-destructive/5 p-3 space-y-2 mx-1 overflow-hidden"
            >
              <p className="text-[11px] font-medium text-foreground/70">
                What was wrong with this answer?{" "}
                <span className="text-muted-foreground">(optional)</span>
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
                className="w-full resize-none rounded-xl border border-border bg-background px-3 py-2 text-[13px] text-foreground placeholder:text-muted-foreground/50 outline-none focus:ring-1 focus:ring-destructive/30 transition-all"
              />
              <div className="flex items-center justify-end gap-2">
                <button
                  onClick={handleSkipReason}
                  className="text-[11px] text-muted-foreground hover:text-foreground transition-colors"
                >
                  Skip
                </button>
                <motion.button
                  whileTap={{ scale: 0.95 }}
                  onClick={handleSubmitNegative}
                  className="flex items-center gap-1.5 rounded-lg bg-destructive/10 px-3 py-1.5 text-[11px] font-semibold text-destructive hover:bg-destructive/20 transition-all"
                >
                  <Send className="h-3 w-3" />
                  Send feedback
                </motion.button>
              </div>
            </motion.div>
          )}

          {/* Soft refusal / referral hint — AI said it can't help or directed user elsewhere */}
          {softRefusal && feedbackState === "idle" && !isPrivate && (
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              transition={{ delay: 0.6 }}
              className="flex items-center gap-2 px-1"
            >
              <span className="text-[11px] text-muted-foreground">
                {isReferral ? "Contact them directly:" : "Need help from a person?"}
              </span>
              <EscalationWidget
                domain={domain}
                sessionId={sessionId}
                originalQuery={originalQuery}
                errorType="unsatisfied"
                compact
                onVideoBg={onVideoBg}
              />
            </motion.div>
          )}

          {/* Escalation — shown after thumbs-down is submitted or on hard error messages */}
          {!live && (feedbackState === "submitted" || isError) && !isPrivate && (
            <EscalationWidget
              domain={domain}
              sessionId={sessionId}
              originalQuery={originalQuery}
              errorType={isError ? "error" : "unsatisfied"}
              compact={feedbackState === "submitted"}
              onVideoBg={onVideoBg}
            />
          )}
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
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay: 0.2, type: "spring", stiffness: 300, damping: 30 }}
      className="glass-card mt-3 overflow-hidden rounded-2xl p-5"
    >
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
        {rows.map((r, i) => (
          <motion.div
            key={r.label}
            initial={{ opacity: 0, x: -8 }}
            animate={{ opacity: 1, x: 0 }}
            transition={{ delay: 0.3 + i * 0.05 }}
            className={cn(
              "flex items-center justify-between rounded-xl px-3 py-2 text-sm transition-colors",
              r.highlight
                ? "bg-primary/5 text-primary border border-primary/10"
                : "bg-muted/30 text-foreground border border-transparent",
            )}
          >
            <span className="opacity-70 font-medium">{r.label}</span>
            <span className={cn("font-bold", r.highlight && "text-primary")}>{r.value}</span>
          </motion.div>
        ))}
      </div>

      {cta && (
        <div className="mt-4 flex justify-end">
          <motion.button
            whileHover={{ scale: 1.02 }}
            whileTap={{ scale: 0.97 }}
            onClick={cta.onClick}
            className="flex items-center gap-1.5 rounded-xl bg-primary px-4 py-2 text-xs font-bold text-white shadow-sm shadow-primary/20 transition-all hover:bg-primary/90"
          >
            {cta.label}
            <ArrowRight className="h-3.5 w-3.5" />
          </motion.button>
        </div>
      )}
    </motion.div>
  );
}
