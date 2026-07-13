import { useEffect, useState, useCallback } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Sunrise, CalendarDays, X, ChevronRight, Sparkles, AlertCircle, AlertTriangle, Info } from "lucide-react";
import { useAuth } from "@/lib/auth-store";
import { Dialog, DialogContent } from "@/components/ui/dialog";

/**
 * Morning Briefing (ARB #39).
 *
 * A proactive "here's your day" card shown on the assistant home. It fuses the
 * caller's proactive nudges, leave balance, and self-scoped personal metrics from
 * GET /api/briefing/me. Read-only + best-effort: hidden entirely when the backend
 * has nothing to surface, dismissible for the day, and each attention item hands
 * off into the chat via `onAction`.
 */

interface AttentionItem {
  id: number | null;
  title: string;
  body: string;
  severity: string;
  action_type: string | null;
  action_payload: Record<string, unknown>;
}

interface LeaveBalance {
  summary: string;
  total_remaining: number;
  items: { type: string; balance: number }[];
}

interface Highlight {
  label: string;
  value: string;
  unit: string;
}

interface Briefing {
  greeting: string;
  date_label: string;
  generated_at: string;
  attention: AttentionItem[];
  leave_balance: LeaveBalance | null;
  highlights: Highlight[];
  has_anything: boolean;
}

const SEVERITY_CONFIG: Record<string, { icon: typeof AlertCircle; color: string; bg: string; border: string }> = {
  high: { icon: AlertCircle, color: "text-rose-600 dark:text-rose-400", bg: "bg-rose-50 dark:bg-rose-500/10", border: "border-rose-100 dark:border-rose-500/20" },
  warning: { icon: AlertTriangle, color: "text-amber-600 dark:text-amber-400", bg: "bg-amber-50 dark:bg-amber-500/10", border: "border-amber-100 dark:border-amber-500/20" },
  medium: { icon: AlertTriangle, color: "text-amber-600 dark:text-amber-400", bg: "bg-amber-50 dark:bg-amber-500/10", border: "border-amber-100 dark:border-amber-500/20" },
  info: { icon: Info, color: "text-blue-600 dark:text-blue-400", bg: "bg-blue-50 dark:bg-blue-500/10", border: "border-blue-100 dark:border-blue-500/20" },
  low: { icon: Info, color: "text-blue-600 dark:text-blue-400", bg: "bg-blue-50 dark:bg-blue-500/10", border: "border-blue-100 dark:border-blue-500/20" },
};

/** Hide the briefing for the rest of the calendar day once dismissed. */
function dismissedTodayKey() {
  return `centriq.briefing.dismissed.${new Date().toISOString().slice(0, 10)}`;
}

export function MorningBriefing({ onAction }: { onAction: (prompt: string) => void }) {
  const { user } = useAuth();
  const [briefing, setBriefing] = useState<Briefing | null>(null);
  const [dismissed, setDismissed] = useState(true);

  useEffect(() => {
    if (typeof window !== "undefined" && localStorage.getItem(dismissedTodayKey())) {
      setDismissed(true);
      return;
    }
    setDismissed(false);
    if (!user?.email) return;
    const controller = new AbortController();
    fetch("/api/briefing/me", {
      signal: controller.signal,
      headers: {
        ...(user?.email ? { "x-user-email": user.email } : {}),
        ...(user?.role ? { "x-user-role": user.role.toLowerCase() } : {}),
      },
    })
      .then((r) => (r.ok ? r.json() : null))
      .then((data: Briefing | null) => {
        if (data && data.has_anything) setBriefing(data);
      })
      .catch(() => {});
    return () => controller.abort();
  }, [user?.email, user?.role]);

  const dismiss = useCallback(() => {
    setDismissed(true);
    try {
      localStorage.setItem(dismissedTodayKey(), "1");
    } catch {
      /* private mode — best effort */
    }
  }, []);

  // "Read all": dismiss the nudge-backed priorities server-side (so they clear
  // from the bell too) and close the briefing for the day.
  const readAll = useCallback(() => {
    const headers = {
      "Content-Type": "application/json",
      ...(user?.email ? { "x-user-email": user.email } : {}),
      ...(user?.role ? { "x-user-role": user.role.toLowerCase() } : {}),
    };
    briefing?.attention.forEach((it) => {
      if (it.id != null)
        fetch(`/api/nudges/${it.id}/dismiss`, { method: "POST", headers }).catch(() => {});
    });
    dismiss();
  }, [briefing, user?.email, user?.role, dismiss]);

  if (dismissed || !briefing || !briefing.has_anything) return null;

  return (
    <Dialog open={!dismissed} onOpenChange={(open) => { if (!open) dismiss(); }}>
      <DialogContent className="sm:max-w-2xl p-0 border-none bg-transparent shadow-none [&>button]:hidden">
        <div className="relative w-full rounded-3xl border border-border/80 dark:border-zinc-800/80 bg-gradient-to-br from-amber-500/[0.05] via-background to-indigo-500/[0.03] dark:from-amber-500/[0.02] dark:via-zinc-950 dark:to-indigo-500/[0.02] p-5 md:p-6 shadow-2xl backdrop-blur-xl overflow-hidden group">
          {/* Subtle background glow */}
          <div className="absolute -right-20 -top-20 h-40 w-40 rounded-full bg-amber-500/10 dark:bg-amber-500/5 blur-3xl pointer-events-none group-hover:bg-amber-500/15 transition-all duration-500" />
          <div className="absolute -left-20 -bottom-20 h-40 w-40 rounded-full bg-indigo-500/10 dark:bg-indigo-500/5 blur-3xl pointer-events-none group-hover:bg-indigo-500/15 transition-all duration-500" />
          
          {/* Header */}
          <div className="flex items-center gap-3.5 mb-5">
            <span className="flex h-10 w-10 items-center justify-center rounded-2xl bg-gradient-to-tr from-amber-500/20 to-orange-500/10 border border-amber-500/30 text-amber-600 dark:text-amber-400 shadow-sm">
              <Sunrise className="h-5 w-5 animate-pulse" />
            </span>
            <div className="min-w-0 flex-1">
              <h3 className="text-base font-bold tracking-tight text-foreground truncate">
                {briefing.greeting}
              </h3>
              <p className="flex items-center gap-1.5 text-xs text-amber-600/90 dark:text-amber-400/80 mt-0.5 font-medium">
                <CalendarDays className="h-3.5 w-3.5" />
                {briefing.date_label}
              </p>
            </div>
            <button
              onClick={dismiss}
              aria-label="Dismiss briefing"
              className="rounded-xl p-2 text-muted-foreground/60 transition-all hover:bg-muted/80 hover:text-foreground border border-transparent hover:border-border"
            >
              <X className="h-4 w-4" />
            </button>
          </div>

          {/* Attention items */}
          {briefing.attention.length > 0 && (
            <div className="mb-5 flex flex-col gap-2">
              <div className="flex items-center justify-between mb-1">
                <p className="text-[10px] font-bold uppercase tracking-[0.15em] text-muted-foreground/80">
                  Priorities needing attention
                </p>
                <button
                  onClick={readAll}
                  className="text-[11px] font-medium text-primary hover:underline"
                >
                  Read all
                </button>
              </div>
              <div className="flex flex-col gap-2">
                {briefing.attention.map((item, idx) => {
                  const sev = SEVERITY_CONFIG[item.severity] || SEVERITY_CONFIG.info;
                  const SevIcon = sev.icon;
                  return (
                    <button
                      key={item.id ?? idx}
                      onClick={() => onAction(item.title)}
                      className={`group flex items-start gap-3.5 rounded-2xl border ${sev.border} bg-white/60 dark:bg-zinc-900/60 px-4 py-3 text-left transition-all duration-300 hover:bg-white/95 dark:hover:bg-zinc-900/95 hover:-translate-y-0.5 hover:shadow-md hover:border-primary/20`}
                    >
                      <span className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-xl ${sev.bg} ${sev.color} border border-transparent group-hover:border-current/10`}>
                        <SevIcon className="h-4.5 w-4.5" />
                      </span>
                      <span className="min-w-0 flex-1 pt-0.5">
                        <span className="block text-[13.5px] font-semibold text-foreground group-hover:text-primary transition-colors">
                          {item.title}
                        </span>
                        {item.body && (
                          <span className="block text-xs leading-relaxed text-muted-foreground mt-0.5 line-clamp-2">
                            {item.body}
                          </span>
                        )}
                      </span>
                      <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-xl text-muted-foreground/45 transition-all group-hover:bg-primary/10 group-hover:text-primary group-hover:translate-x-0.5 self-center">
                        <ChevronRight className="h-4.5 w-4.5" />
                      </span>
                    </button>
                  );
                })}
              </div>
            </div>
          )}

          {/* Leave balance + highlights row */}
          <div className="flex flex-wrap items-center gap-2 pt-3 border-t border-border/40">
            {briefing.leave_balance && (
              <span
                className="inline-flex items-center gap-2 rounded-2xl border border-emerald-500/20 bg-emerald-500/[0.06] px-3.5 py-1.5 text-xs font-semibold text-emerald-700 dark:text-emerald-300 shadow-sm"
                title={briefing.leave_balance.items
                  .map((b) => `${b.type}: ${b.balance}`)
                  .join(" · ")}
              >
                <Sparkles className="h-3.5 w-3.5 animate-bounce" />
                {briefing.leave_balance.summary}
              </span>
            )}
            {briefing.highlights.map((h) => (
              <span
                key={h.label}
                className="inline-flex items-center gap-2 rounded-2xl border border-border/80 bg-white/70 dark:bg-zinc-900/70 px-3.5 py-1.5 text-xs font-medium text-muted-foreground shadow-sm"
              >
                <span className="font-bold text-foreground">{h.value}</span>
                {h.label}
              </span>
            ))}
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
