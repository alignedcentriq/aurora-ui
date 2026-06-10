import React from "react";
import { cn } from "@/lib/utils";
import { CheckCircle2, AlertCircle, XCircle } from "lucide-react";

export interface StatusBadgeProps {
  status: string | null;
  className?: string;
}

const DEFAULT_STATUS_BADGE: Record<string, string> = {
  pending: "bg-amber-500/10 text-amber-600 dark:text-amber-400 border border-amber-500/20",
  approved: "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border border-emerald-500/20",
  active: "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border border-emerald-500/20",
  rejected: "bg-rose-500/10 text-rose-600 dark:text-rose-400 border border-rose-500/20",
  surrendered: "bg-zinc-500/10 text-zinc-500 dark:text-zinc-400 border border-zinc-500/20",
  expired: "bg-zinc-500/10 text-zinc-500 dark:text-zinc-400 border border-zinc-500/20",
  open: "bg-blue-500/10 text-blue-600 dark:text-blue-400 border border-blue-500/20",
  "in progress": "bg-violet-500/10 text-violet-600 dark:text-violet-400 border border-violet-500/20",
  "awaiting approval": "bg-amber-500/15 text-amber-400 border border-amber-500/20",
  acknowledged: "bg-blue-500/10 text-blue-600 dark:text-blue-400 border border-blue-500/20",
  resolved: "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border border-emerald-500/20",
  closed: "bg-zinc-500/10 text-zinc-500 dark:text-zinc-400 border border-zinc-500/20",
  "auto-rejected": "bg-rose-500/10 text-rose-600 dark:text-rose-400 border border-rose-500/20",
  released: "bg-zinc-500/10 text-zinc-500 dark:text-zinc-400 border border-zinc-500/20",
  due: "bg-amber-500/10 text-amber-600 dark:text-amber-400 border border-amber-500/20",
  paid: "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border border-emerald-500/20",
  installed: "bg-emerald-500/15 text-emerald-400 border border-emerald-500/20",
  
  // Welcome log status keys
  pending_hr: "bg-amber-500/15 text-amber-400 border border-amber-500/20",
  welcome_sent: "bg-emerald-500/15 text-emerald-400 border border-emerald-500/20",
  skipped: "bg-zinc-500/15 text-zinc-400 border border-zinc-500/20",
  
  // Travel status keys
  pending_rm: "bg-amber-500/10 text-amber-600 dark:text-amber-400 border border-amber-500/20",
  rm_approved: "bg-blue-500/10 text-blue-600 dark:text-blue-400 border border-blue-500/20",
  rm_rejected: "bg-rose-500/10 text-rose-600 dark:text-rose-400 border border-rose-500/20",
  admin_approved: "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border border-emerald-500/20",
  admin_rejected: "bg-rose-500/10 text-rose-600 dark:text-rose-400 border border-rose-500/20",
  completed: "bg-zinc-500/10 text-zinc-500 dark:text-zinc-400 border border-zinc-500/20",
};

// Friendly labels for specific internal keys
const FRIENDLY_STATUS_LABELS: Record<string, string> = {
  pending_rm: "Pending RM Approval",
  rm_approved: "RM Approved",
  pmo_approved: "PMO Approved",
  ticket_booked: "Ticket Booked",
  hotel_booked: "Hotel Booked",
  completed: "Completed",
  rejected: "Rejected",
  cancelled: "Cancelled",
  pending_fm: "Pending FM Approval",
  fm_approved: "FM Approved",
  finance_processed: "Finance Processed",
  pending: "Pending",
  approved: "Approved",
  pending_hr: "Pending HR",
  welcome_sent: "Sent",
  skipped: "Skipped",
};

export function StatusBadge({ status, className }: StatusBadgeProps) {
  if (!status) return <span className={cn("text-xs text-muted-foreground", className)}>—</span>;

  const cleanStatus = status.trim().toLowerCase();

  // Special UI badges for AutomationHub rules last_status
  if (cleanStatus === "sent") {
    return (
      <span className={cn("inline-flex items-center gap-1 text-xs font-medium text-emerald-600 bg-emerald-50 border border-emerald-200 rounded-full px-2 py-0.5", className)}>
        <CheckCircle2 className="h-3 w-3" /> Sent
      </span>
    );
  }
  if (cleanStatus.startsWith("failed:no_recipients")) {
    return (
      <span className={cn("inline-flex items-center gap-1 text-xs font-medium text-amber-600 bg-amber-50 border border-amber-200 rounded-full px-2 py-0.5", className)}>
        <AlertCircle className="h-3 w-3" /> No recipients
      </span>
    );
  }
  if (cleanStatus.startsWith("failed")) {
    return (
      <span className={cn("inline-flex items-center gap-1 text-xs font-medium text-red-600 bg-red-50 border border-red-200 rounded-full px-2 py-0.5", className)}>
        <XCircle className="h-3 w-3" /> Failed
      </span>
    );
  }

  // General badges
  const badgeClass = DEFAULT_STATUS_BADGE[cleanStatus] ?? "bg-zinc-500/10 text-zinc-500 dark:text-zinc-400 border border-zinc-500/20";
  
  // Format the label
  const label = FRIENDLY_STATUS_LABELS[cleanStatus] ?? 
    status
      .replace(/[_-]/g, " ")
      .replace(/\b\w/g, (c) => c.toUpperCase());

  return (
    <span className={cn("rounded-full px-2.5 py-1 text-[11px] font-semibold transition-all inline-block whitespace-nowrap", badgeClass, className)}>
      {label}
    </span>
  );
}
