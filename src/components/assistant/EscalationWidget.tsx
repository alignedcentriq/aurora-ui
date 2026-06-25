import { useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  AlertTriangle,
  ChevronDown,
  ChevronUp,
  Send,
  CheckCircle2,
  Loader2,
  X,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { useAuth } from "@/lib/auth-store";

// Escalation matrix — must mirror backend _DOMAIN_MATRIX
const DOMAIN_DEPARTMENTS: Record<string, string> = {
  hr: "HR Team",
  admin: "Admin & Facilities",
  it_support: "IT Helpdesk",
  pmo: "PMO Team",
  functional_manager: "Your Manager",
  ms365: "IT Helpdesk",
  general: "Support Team",
};

const PRIORITY_OPTIONS = ["Low", "Medium", "High"] as const;
type Priority = (typeof PRIORITY_OPTIONS)[number];

type EscalateReason = "error" | "no_response" | "unsatisfied";

interface EscalationWidgetProps {
  domain?: string;
  sessionId?: string;
  originalQuery?: string;
  errorType?: EscalateReason;
  /** Called after a successful escalation so the parent can record the ref ID */
  onEscalated?: (referenceId: string, department: string) => void;
  /** Compact trigger mode — shown inside message action bar */
  compact?: boolean;
}

export function EscalationWidget({
  domain,
  sessionId,
  originalQuery,
  errorType,
  onEscalated,
  compact = false,
}: EscalationWidgetProps) {
  const { user } = useAuth();
  const [open, setOpen] = useState(false);
  const [description, setDescription] = useState("");
  const [priority, setPriority] = useState<Priority>("Medium");
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<{ refId: string; dept: string } | null>(null);
  const [error, setError] = useState<string | null>(null);

  const dept = DOMAIN_DEPARTMENTS[domain ?? "general"] ?? "Support Team";

  const handleSubmit = async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/escalate", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(user?.email ? { "x-user-email": user.email } : {}),
          ...(user?.role ? { "x-user-role": user.role.toLowerCase() } : {}),
        },
        body: JSON.stringify({
          domain: domain ?? "general",
          original_query: originalQuery ?? null,
          error_type: errorType ?? "unsatisfied",
          description: description.trim() || null,
          priority,
          session_id: sessionId ?? null,
        }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.detail ?? "Failed to raise escalation.");
      }
      const data = await res.json();
      setResult({ refId: data.reference_id, dept: data.department });
      onEscalated?.(data.reference_id, data.department);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Something went wrong.");
    } finally {
      setLoading(false);
    }
  };

  // ── Confirmed state ──────────────────────────────────────────────────────
  if (result) {
    return (
      <motion.div
        initial={{ opacity: 0, y: 4 }}
        animate={{ opacity: 1, y: 0 }}
        className="flex items-start gap-2.5 rounded-xl border border-emerald-500/20 bg-emerald-500/5 px-3.5 py-2.5 mt-1"
      >
        <CheckCircle2 className="h-4 w-4 text-emerald-500 mt-0.5 shrink-0" />
        <div className="flex-1 min-w-0">
          <p className="text-[12px] font-semibold text-emerald-700 dark:text-emerald-400">
            Escalation raised — {result.refId}
          </p>
          <p className="text-[11px] text-muted-foreground mt-0.5">
            {result.dept} has been notified and will reach out to you directly.
          </p>
        </div>
      </motion.div>
    );
  }

  // ── Compact trigger (used in message action bar) ─────────────────────────
  if (compact && !open) {
    return (
      <motion.button
        whileTap={{ scale: 0.9 }}
        onClick={() => setOpen(true)}
        className="flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-[11px] font-medium text-amber-600 dark:text-amber-400 hover:bg-amber-500/10 transition-all"
        title={`Escalate to ${dept}`}
      >
        <AlertTriangle className="h-3.5 w-3.5" />
        Escalate
      </motion.button>
    );
  }

  // ── Full form ────────────────────────────────────────────────────────────
  return (
    <AnimatePresence>
      <motion.div
        initial={{ opacity: 0, height: 0 }}
        animate={{ opacity: 1, height: "auto" }}
        exit={{ opacity: 0, height: 0 }}
        className="rounded-xl border border-amber-500/20 bg-amber-500/5 mt-1 overflow-hidden"
      >
        {/* Header */}
        <button
          onClick={() => setOpen((v) => !v)}
          className="flex w-full items-center justify-between px-3.5 py-2.5 text-left"
        >
          <div className="flex items-center gap-2">
            <AlertTriangle className="h-3.5 w-3.5 text-amber-500" />
            <span className="text-[12px] font-semibold text-amber-700 dark:text-amber-400">
              Escalate to {dept}
            </span>
          </div>
          {open ? (
            <ChevronUp className="h-3.5 w-3.5 text-muted-foreground" />
          ) : (
            <ChevronDown className="h-3.5 w-3.5 text-muted-foreground" />
          )}
        </button>

        <AnimatePresence>
          {open && (
            <motion.div
              initial={{ opacity: 0, height: 0 }}
              animate={{ opacity: 1, height: "auto" }}
              exit={{ opacity: 0, height: 0 }}
              className="px-3.5 pb-3.5 space-y-3 overflow-hidden"
            >
              <p className="text-[11px] text-muted-foreground leading-relaxed">
                A ticket will be created and{" "}
                <span className="font-medium text-foreground">{dept}</span> will be notified to
                contact you directly.
              </p>

              {/* Priority */}
              <div>
                <p className="text-[11px] font-medium text-foreground/70 mb-1.5">Priority</p>
                <div className="flex gap-1.5">
                  {PRIORITY_OPTIONS.map((p) => (
                    <button
                      key={p}
                      onClick={() => setPriority(p)}
                      className={cn(
                        "rounded-lg px-3 py-1 text-[11px] font-semibold border transition-all",
                        priority === p
                          ? p === "High"
                            ? "bg-red-500/10 border-red-500/30 text-red-600 dark:text-red-400"
                            : p === "Medium"
                              ? "bg-amber-500/10 border-amber-500/30 text-amber-600 dark:text-amber-400"
                              : "bg-emerald-500/10 border-emerald-500/30 text-emerald-600 dark:text-emerald-400"
                          : "border-border bg-background text-muted-foreground hover:border-muted-foreground",
                      )}
                    >
                      {p}
                    </button>
                  ))}
                </div>
              </div>

              {/* Description */}
              <div>
                <p className="text-[11px] font-medium text-foreground/70 mb-1.5">
                  Additional context <span className="text-muted-foreground">(optional)</span>
                </p>
                <textarea
                  autoFocus
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  rows={2}
                  placeholder="Describe what you were trying to do and what went wrong…"
                  className="w-full resize-none rounded-xl border border-border bg-background px-3 py-2 text-[13px] text-foreground placeholder:text-muted-foreground/50 outline-none focus:ring-1 focus:ring-amber-500/30 transition-all"
                />
              </div>

              {error && <p className="text-[11px] text-red-500">{error}</p>}

              <div className="flex items-center justify-end gap-2">
                <button
                  onClick={() => setOpen(false)}
                  className="text-[11px] text-muted-foreground hover:text-foreground transition-colors"
                >
                  Cancel
                </button>
                <motion.button
                  whileTap={{ scale: 0.95 }}
                  onClick={handleSubmit}
                  disabled={loading}
                  className="flex items-center gap-1.5 rounded-lg bg-amber-500/10 px-3 py-1.5 text-[11px] font-semibold text-amber-600 dark:text-amber-400 hover:bg-amber-500/20 transition-all disabled:opacity-50"
                >
                  {loading ? (
                    <Loader2 className="h-3 w-3 animate-spin" />
                  ) : (
                    <Send className="h-3 w-3" />
                  )}
                  {loading ? "Raising…" : "Raise escalation"}
                </motion.button>
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </motion.div>
    </AnimatePresence>
  );
}

// ── Standalone error-bar variant ─────────────────────────────────────────────
// Shown below AI error messages (busy, timeout, tool failure, no response).

interface ErrorEscalationBarProps {
  domain?: string;
  sessionId?: string;
  originalQuery?: string;
  errorType?: EscalateReason;
}

export function ErrorEscalationBar(props: ErrorEscalationBarProps) {
  const [dismissed, setDismissed] = useState(false);
  const [escalated, setEscalated] = useState<string | null>(null);

  if (dismissed && !escalated) return null;

  if (escalated) {
    return (
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        className="flex items-center gap-2 mt-1 px-3 py-2 rounded-xl border border-emerald-500/20 bg-emerald-500/5"
      >
        <CheckCircle2 className="h-3.5 w-3.5 text-emerald-500 shrink-0" />
        <p className="text-[11px] text-emerald-700 dark:text-emerald-400 font-medium">
          Escalation {escalated} raised — the team will contact you.
        </p>
      </motion.div>
    );
  }

  return <EscalationWidget {...props} onEscalated={(refId) => setEscalated(refId)} />;
}
