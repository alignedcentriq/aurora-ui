import { createFileRoute } from "@tanstack/react-router";
import { useAuth } from "@/lib/auth-store";
import { useState, useEffect, useCallback } from "react";
import { Check, X, Loader2, RefreshCw, GraduationCap } from "lucide-react";
import { cn } from "@/lib/utils";
import { toast } from "sonner";
import { flyBanner } from "@/lib/fly-banner";

export const Route = createFileRoute("/_layout/pmo-portal")({
  component: PMOPortal,
});

const STATUS_BADGE: Record<string, string> = {
  Pending: "bg-amber-500/15 text-amber-400 border border-amber-500/20",
  Approved: "bg-emerald-500/15 text-emerald-400 border border-emerald-500/20",
  Rejected: "bg-rose-500/15 text-rose-400 border border-rose-500/20",
};

interface UdemyRequest {
  id: number;
  employee_name: string;
  employee_email: string;
  course_name: string;
  justification: string;
  status: string;
  decided_by: string;
  decision_reason: string;
  created_at: string | null;
}

function PMOPortal() {
  const { user } = useAuth();

  const authHeaders = {
    "Content-Type": "application/json",
    ...(user?.email ? { "x-user-email": user.email } : {}),
    ...(user?.role ? { "x-user-role": user.role.toLowerCase() } : {}),
  };

  if (user?.role !== "PMO" && user?.role !== "Admin") {
    return (
      <div className="flex h-full items-center justify-center text-muted-foreground">
        Access restricted to the PMO team.
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full overflow-hidden">
      <div className="flex items-center justify-between px-8 py-6 border-b border-[var(--border)] shrink-0">
        <div>
          <h1 className="text-[20px] font-semibold text-foreground">PMO Portal</h1>
          <p className="text-[13px] text-muted-foreground mt-0.5">Review and action Udemy license requests</p>
        </div>
      </div>
      <div className="flex gap-1 px-8 py-3 border-b border-[var(--border)] shrink-0">
        <button className="flex items-center gap-2 rounded-lg px-4 py-2 text-[13px] font-medium bg-primary/10 text-primary">
          <GraduationCap className="h-3.5 w-3.5" />
          Udemy Licenses
        </button>
      </div>
      <div className="flex-1 overflow-auto px-8 py-6">
        <UdemyTab authHeaders={authHeaders} />
      </div>
    </div>
  );
}

function UdemyTab({ authHeaders }: { authHeaders: Record<string, string> }) {
  const [items, setItems] = useState<UdemyRequest[]>([]);
  const [loading, setLoading] = useState(true);
  const [acting, setActing] = useState<number | null>(null);
  const [filter, setFilter] = useState("Pending");

  const fetch_ = useCallback(async () => {
    setLoading(true);
    try {
      const qs = filter !== "All" ? `?status=${filter}` : "";
      const res = await fetch(`/api/portal/pmo/udemy${qs}`, { headers: authHeaders });
      setItems(await res.json());
    } catch { toast.error("Failed to load"); }
    finally { setLoading(false); }
  }, [filter]);

  useEffect(() => { fetch_(); }, [fetch_]);

  const approve = async (id: number) => {
    setActing(id);
    try {
      const res = await fetch(`/api/portal/pmo/udemy/${id}/approve`, { method: "PUT", headers: authHeaders });
      if (!res.ok) throw new Error((await res.json().catch(() => ({}))).detail || "Failed");
      flyBanner("Udemy license approved");
      fetch_();
    } catch (e: unknown) { toast.error(e instanceof Error ? e.message : "Failed"); }
    finally { setActing(null); }
  };

  const reject = async (id: number) => {
    const reason = window.prompt("Reason for declining (shown to the employee):")?.trim();
    if (!reason) return;
    setActing(id);
    try {
      const res = await fetch(`/api/portal/pmo/udemy/${id}/reject`, {
        method: "PUT", headers: authHeaders, body: JSON.stringify({ reason }),
      });
      if (!res.ok) throw new Error((await res.json().catch(() => ({}))).detail || "Failed");
      toast.success("Request declined");
      fetch_();
    } catch (e: unknown) { toast.error(e instanceof Error ? e.message : "Failed"); }
    finally { setActing(null); }
  };

  return (
    <div>
      <div className="flex items-center justify-between mb-4">
        <div className="flex gap-1">
          {["Pending", "Approved", "Rejected", "All"].map((s) => (
            <button
              key={s}
              onClick={() => setFilter(s)}
              className={cn(
                "rounded-lg px-3.5 py-1.5 text-[13px] font-medium transition-colors",
                filter === s ? "bg-primary/10 text-primary" : "text-muted-foreground hover:bg-secondary hover:text-foreground"
              )}
            >
              {s}
            </button>
          ))}
        </div>
        <button onClick={fetch_} className="flex items-center gap-1.5 text-[13px] text-muted-foreground hover:text-foreground transition-colors">
          <RefreshCw className="h-3.5 w-3.5" />
          Refresh
        </button>
      </div>

      {loading ? (
        <div className="flex h-40 items-center justify-center"><Loader2 className="h-5 w-5 animate-spin text-muted-foreground" /></div>
      ) : items.length === 0 ? (
        <div className="flex h-40 items-center justify-center text-[13px] text-muted-foreground">No Udemy license requests found</div>
      ) : (
        <table className="w-full text-[13px]">
          <thead>
            <tr className="border-b border-[var(--border)]">
              {["Employee", "Course", "Justification", "Status", "Actions"].map((h) => (
                <th key={h} className="text-left py-3 pr-4 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground/60">{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {items.map((r) => (
              <tr key={r.id} className="border-b border-[var(--border)]/50 hover:bg-white/[0.02] transition-colors">
                <td className="py-3.5 pr-4">
                  <div className="font-medium text-foreground">{r.employee_name}</div>
                  <div className="text-[11px] text-muted-foreground">{r.employee_email}</div>
                </td>
                <td className="py-3.5 pr-4 text-foreground/90">{r.course_name || "—"}</td>
                <td className="py-3.5 pr-4 text-foreground/70 max-w-[300px]">{r.justification || r.decision_reason || "—"}</td>
                <td className="py-3.5 pr-4">
                  <span className={cn("rounded-full px-2.5 py-1 text-[11px] font-medium", STATUS_BADGE[r.status] ?? "bg-zinc-500/10 text-zinc-400")}>
                    {r.status}
                  </span>
                </td>
                <td className="py-3.5">
                  {r.status === "Pending" ? (
                    <div className="flex items-center gap-1.5">
                      <button onClick={() => approve(r.id)} disabled={acting === r.id}
                        className="flex items-center gap-1 rounded-lg px-2.5 py-1.5 text-[12px] font-medium bg-emerald-500/10 text-emerald-400 hover:bg-emerald-500/20 transition-colors disabled:opacity-50">
                        {acting === r.id ? <Loader2 className="h-3 w-3 animate-spin" /> : <Check className="h-3 w-3" />}
                        Approve
                      </button>
                      <button onClick={() => reject(r.id)} disabled={acting === r.id}
                        className="flex items-center gap-1 rounded-lg px-2.5 py-1.5 text-[12px] font-medium bg-rose-500/10 text-rose-400 hover:bg-rose-500/20 transition-colors disabled:opacity-50">
                        <X className="h-3 w-3" />
                        Decline
                      </button>
                    </div>
                  ) : <span className="text-muted-foreground/40 text-[12px]">—</span>}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}
