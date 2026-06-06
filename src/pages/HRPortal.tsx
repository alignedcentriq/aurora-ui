import { useAuth } from "@/lib/auth-store";
import { useState, useEffect, useCallback } from "react";
import { Check, X, Clock, CalendarDays, Loader2, RefreshCw } from "lucide-react";
import { cn } from "@/lib/utils";
import { toast } from "sonner";

type LeaveStatus = "All" | "Pending" | "Approved" | "Rejected";

interface LeaveRecord {
  id: number;
  employee_name: string;
  employee_email: string;
  leave_type: string;
  start_date: string;
  end_date: string;
  days: number;
  status: string;
  reason: string;
  created_at: string;
}

const STATUS_BADGE: Record<string, string> = {
  Pending: "bg-amber-500/15 text-amber-400 border border-amber-500/20",
  Approved: "bg-emerald-500/15 text-emerald-400 border border-emerald-500/20",
  Rejected: "bg-rose-500/15 text-rose-400 border border-rose-500/20",
  Cancelled: "bg-zinc-500/15 text-zinc-400 border border-zinc-500/20",
};

export function HRPortal() {
  const { user } = useAuth();
  const [filter, setFilter] = useState<LeaveStatus>("Pending");
  const [leaves, setLeaves] = useState<LeaveRecord[]>([]);
  const [loading, setLoading] = useState(true);

  const authHeaders = {
    "Content-Type": "application/json",
    ...(user?.email ? { "x-user-email": user.email } : {}),
    ...(user?.role ? { "x-user-role": user.role.toLowerCase() } : {}),
  };

  const fetchLeaves = useCallback(async () => {
    setLoading(true);
    try {
      const qs = filter !== "All" ? `?status=${filter}` : "";
      const res = await fetch(`/api/portal/hr/leaves${qs}`, { headers: authHeaders });
      if (!res.ok) throw new Error("Failed to load");
      setLeaves(await res.json());
    } catch {
      toast.error("Failed to load leave requests");
    } finally {
      setLoading(false);
    }
  }, [filter, user]);

  useEffect(() => { fetchLeaves(); }, [fetchLeaves]);

  if (user?.role !== "HR" && user?.role !== "Admin") {
    return (
      <div className="flex h-full items-center justify-center text-muted-foreground">
        Access restricted to HR team.
      </div>
    );
  }

  const pending = leaves.filter((l) => l.status === "Pending").length;
  const approved = leaves.filter((l) => l.status === "Approved").length;
  const rejected = leaves.filter((l) => l.status === "Rejected").length;

  return (
    <div className="flex flex-col h-full overflow-hidden">
      {/* Header */}
      <div className="flex items-center justify-between px-8 py-6 border-b border-[var(--border)] shrink-0">
        <div>
          <h1 className="text-[20px] font-semibold text-foreground">HR Portal</h1>
          <p className="text-[13px] text-muted-foreground mt-0.5">View employee leave requests</p>
        </div>
        <button
          onClick={fetchLeaves}
          className="flex items-center gap-2 rounded-lg px-3 py-2 text-[13px] text-muted-foreground hover:bg-secondary transition-colors"
        >
          <RefreshCw className="h-3.5 w-3.5" />
          Refresh
        </button>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-3 gap-4 px-8 py-4 shrink-0">
        {[
          { label: "Pending", value: pending, icon: Clock, color: "text-amber-400" },
          { label: "Approved", value: approved, icon: Check, color: "text-emerald-400" },
          { label: "Rejected", value: rejected, icon: X, color: "text-rose-400" },
        ].map(({ label, value, icon: Icon, color }) => (
          <div key={label} className="rounded-xl border border-[var(--border)] bg-card/40 px-5 py-4 flex items-center gap-4">
            <div className={cn("rounded-lg bg-white/5 p-2.5", color)}>
              <Icon className="h-4 w-4" />
            </div>
            <div>
              <p className="text-[22px] font-bold text-foreground">{value}</p>
              <p className="text-[12px] text-muted-foreground">{label}</p>
            </div>
          </div>
        ))}
      </div>

      {/* Filter tabs */}
      <div className="flex gap-1 px-8 pb-3 shrink-0">
        {(["Pending", "Approved", "Rejected", "All"] as LeaveStatus[]).map((s) => (
          <button
            key={s}
            onClick={() => setFilter(s)}
            className={cn(
              "rounded-lg px-4 py-1.5 text-[13px] font-medium transition-colors",
              filter === s
                ? "bg-primary/10 text-primary"
                : "text-muted-foreground hover:bg-secondary hover:text-foreground"
            )}
          >
            {s}
          </button>
        ))}
      </div>

      {/* Table */}
      <div className="flex-1 overflow-auto px-8 pb-8">
        {loading ? (
          <div className="flex h-40 items-center justify-center">
            <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
          </div>
        ) : leaves.length === 0 ? (
          <div className="flex h-40 items-center justify-center gap-2 text-muted-foreground">
            <CalendarDays className="h-4 w-4" />
            <span className="text-[13px]">No {filter !== "All" ? filter.toLowerCase() : ""} leave requests</span>
          </div>
        ) : (
          <table className="w-full text-[13px]">
            <thead>
              <tr className="border-b border-[var(--border)]">
                {["Employee", "Leave Type", "From", "To", "Days", "Reason", "Applied On", "Status"].map((h) => (
                  <th key={h} className="text-left py-3 pr-4 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground/60">
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {leaves.map((l) => (
                <tr key={l.id} className="border-b border-[var(--border)]/50 hover:bg-white/[0.02] transition-colors">
                  <td className="py-3.5 pr-4">
                    <div className="font-medium text-foreground">{l.employee_name}</div>
                    <div className="text-[11px] text-muted-foreground">{l.employee_email}</div>
                  </td>
                  <td className="py-3.5 pr-4 text-foreground/80">{l.leave_type}</td>
                  <td className="py-3.5 pr-4 text-foreground/80">{l.start_date}</td>
                  <td className="py-3.5 pr-4 text-foreground/80">{l.end_date}</td>
                  <td className="py-3.5 pr-4 text-foreground/80">{l.days}d</td>
                  <td className="py-3.5 pr-4 text-foreground/60 max-w-[180px] truncate" title={l.reason}>{l.reason || "—"}</td>
                  <td className="py-3.5 pr-4 text-foreground/50">{l.created_at.slice(0, 10)}</td>
                  <td className="py-3.5 pr-4">
                    <span className={cn("rounded-full px-2.5 py-1 text-[11px] font-medium", STATUS_BADGE[l.status] ?? "bg-zinc-500/10 text-zinc-400")}>
                      {l.status}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
