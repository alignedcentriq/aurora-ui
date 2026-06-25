import { useState, useEffect, useMemo } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { CalendarMinus, Calendar, Loader2, AlertCircle, CheckCircle2, XCircle } from "lucide-react";
import { flyBanner } from "@/lib/fly-banner";

interface LeaveRecord {
  id: number;
  leave_type: string;
  start_date: string;
  end_date: string;
  status: string;
  reason: string;
  days: number;
}

interface Props {
  userEmail: string;
  userRole: string;
  onCancelled: (message: string) => void;
}

function fmtDate(iso: string) {
  const [y, mo, d] = iso.split("-").map(Number);
  return new Date(y, mo - 1, d).toLocaleDateString("en-IN", {
    day: "numeric",
    month: "short",
    year: "numeric",
  });
}

const STATUS_COLOR: Record<string, string> = {
  Approved: "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400",
  Pending: "bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400",
  Rejected: "bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400",
  Cancelled: "bg-muted text-muted-foreground",
};

export function CancelLeaveWidget({ userEmail, userRole, onCancelled }: Props) {
  const auth = useMemo(
    () => ({ "x-user-email": userEmail, "x-user-role": userRole.toLowerCase() }),
    [userEmail, userRole],
  );

  const [leaves, setLeaves] = useState<LeaveRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [cancelling, setCancelling] = useState<number | null>(null);
  const [cancelled, setCancelled] = useState<Set<number>>(new Set());

  useEffect(() => {
    (async () => {
      try {
        const res = await fetch("/api/hr/leaves", { headers: auth });
        const data = await res.json().catch(() => []);
        if (!res.ok) {
          setError("Failed to load your leave records.");
          return;
        }
        // Only show cancellable leaves (Pending or Approved)
        setLeaves(
          (data as LeaveRecord[]).filter((l) => l.status === "Pending" || l.status === "Approved"),
        );
      } catch {
        setError("Could not reach the server. Please try again.");
      } finally {
        setLoading(false);
      }
    })();
  }, [auth]);

  const handleCancel = async (leave: LeaveRecord) => {
    if (cancelling !== null) return;
    setCancelling(leave.id);
    try {
      const res = await fetch(`/api/leave/${leave.id}/cancel`, {
        method: "POST",
        headers: auth,
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.detail ?? "Cancellation failed.");

      setCancelled((prev) => new Set([...prev, leave.id]));
      const balanceNote = data.was_approved ? " Balance restored." : "";
      flyBanner(`${leave.leave_type} leave cancelled${balanceNote}`);
      onCancelled(
        `✅ **${leave.leave_type}** leave (${fmtDate(leave.start_date)} – ${fmtDate(leave.end_date)}, ${leave.days} day${leave.days !== 1 ? "s" : ""}) has been cancelled.` +
          (data.was_approved ? " Your leave balance has been restored." : ""),
      );
    } catch (e) {
      setError(e instanceof Error ? e.message : "Cancellation failed.");
    } finally {
      setCancelling(null);
    }
  };

  const visible = leaves.filter((l) => !cancelled.has(l.id));

  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ type: "spring", stiffness: 300, damping: 30 }}
      className="mt-3 overflow-hidden rounded-2xl border border-border bg-card/50 backdrop-blur-sm"
    >
      {/* Header */}
      <div className="flex items-center gap-2 border-b border-border bg-muted/40 px-4 py-2.5">
        <CalendarMinus className="h-3.5 w-3.5 text-destructive" />
        <span className="text-[11px] font-bold uppercase tracking-widest text-muted-foreground">
          Cancel a Leave
        </span>
      </div>

      <div className="p-4">
        {/* Loading */}
        {loading && (
          <div className="flex items-center gap-2.5 py-3 text-sm text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin text-primary" />
            Loading your leave records…
          </div>
        )}

        {/* Error */}
        {error && (
          <div className="flex items-start gap-2 rounded-xl border border-destructive/20 bg-destructive/5 px-3 py-2.5 text-xs text-destructive">
            <AlertCircle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
            {error}
          </div>
        )}

        {/* No cancellable leaves */}
        {!loading && !error && visible.length === 0 && cancelled.size === 0 && (
          <p className="py-2 text-sm text-muted-foreground">
            No pending or approved leaves to cancel.
          </p>
        )}

        {/* Leave list */}
        <AnimatePresence>
          {visible.map((leave) => (
            <motion.div
              key={leave.id}
              initial={{ opacity: 0, y: 4 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, x: -8, transition: { duration: 0.2 } }}
              className="mb-2 flex items-start justify-between gap-3 rounded-xl border border-border bg-background px-3 py-3 last:mb-0"
            >
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2">
                  <p className="text-sm font-semibold text-foreground">{leave.leave_type}</p>
                  <span
                    className={`rounded-full px-2 py-0.5 text-[10px] font-semibold ${STATUS_COLOR[leave.status] ?? "bg-muted text-muted-foreground"}`}
                  >
                    {leave.status}
                  </span>
                  {leave.status === "Approved" && (
                    <span className="rounded-full bg-sky-100 px-2 py-0.5 text-[10px] font-semibold text-sky-700 dark:bg-sky-900/30 dark:text-sky-400">
                      Balance will be restored
                    </span>
                  )}
                </div>
                <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-0.5 text-[11px] text-muted-foreground">
                  <span className="flex items-center gap-1">
                    <Calendar className="h-3 w-3 text-primary" />
                    {fmtDate(leave.start_date)} – {fmtDate(leave.end_date)}
                  </span>
                  <span>
                    {leave.days} day{leave.days !== 1 ? "s" : ""}
                  </span>
                </div>
                {leave.reason && (
                  <p className="mt-1 text-[11px] text-muted-foreground truncate">{leave.reason}</p>
                )}
              </div>

              <motion.button
                whileHover={{ scale: 1.03 }}
                whileTap={{ scale: 0.95 }}
                onClick={() => handleCancel(leave)}
                disabled={cancelling === leave.id}
                className="flex shrink-0 items-center gap-1.5 rounded-xl border border-destructive/30 bg-destructive/5 px-3 py-1.5 text-xs font-semibold text-destructive transition-all hover:bg-destructive/10 disabled:cursor-not-allowed disabled:opacity-50"
              >
                {cancelling === leave.id ? (
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                ) : (
                  <XCircle className="h-3.5 w-3.5" />
                )}
                {cancelling === leave.id ? "Cancelling…" : "Cancel"}
              </motion.button>
            </motion.div>
          ))}
        </AnimatePresence>

        {/* All done */}
        {!loading && !error && leaves.length > 0 && visible.length === 0 && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            className="flex items-center gap-2 py-2 text-sm text-emerald-600 dark:text-emerald-400"
          >
            <CheckCircle2 className="h-4 w-4" />
            All selected leaves have been cancelled.
          </motion.div>
        )}
      </div>
    </motion.div>
  );
}
