import { createFileRoute } from "@tanstack/react-router";
import { useAuth } from "@/lib/auth-store";
import { useState, useEffect, useCallback } from "react";
import { Check, X, Ticket, Package, Loader2, RefreshCw, ChevronDown } from "lucide-react";
import { cn } from "@/lib/utils";
import { toast } from "sonner";

export const Route = createFileRoute("/_layout/it-portal")({
  component: ITPortal,
});

type Tab = "tickets" | "software";

const STATUS_BADGE: Record<string, string> = {
  Open: "bg-blue-500/15 text-blue-400 border border-blue-500/20",
  "Awaiting Approval": "bg-amber-500/15 text-amber-400 border border-amber-500/20",
  "In Progress": "bg-violet-500/15 text-violet-400 border border-violet-500/20",
  Resolved: "bg-emerald-500/15 text-emerald-400 border border-emerald-500/20",
  Closed: "bg-zinc-500/15 text-zinc-400 border border-zinc-500/20",
  Pending: "bg-amber-500/15 text-amber-400 border border-amber-500/20",
  Approved: "bg-emerald-500/15 text-emerald-400 border border-emerald-500/20",
  Rejected: "bg-rose-500/15 text-rose-400 border border-rose-500/20",
  Installed: "bg-emerald-500/15 text-emerald-400 border border-emerald-500/20",
};

const PRIORITY_COLOR: Record<string, string> = {
  Low: "text-zinc-400",
  Medium: "text-amber-400",
  High: "text-orange-400",
  Critical: "text-rose-400",
};

const TICKET_STATUSES = ["Open", "Awaiting Approval", "In Progress", "Resolved", "Closed"];

export default function ITPortal() {
  const { user } = useAuth();
  const [tab, setTab] = useState<Tab>("tickets");

  const authHeaders = {
    "Content-Type": "application/json",
    ...(user?.email ? { "x-user-email": user.email } : {}),
    ...(user?.role ? { "x-user-role": user.role.toLowerCase() } : {}),
  };

  if (user?.role !== "IT" && user?.role !== "Admin") {
    return (
      <div className="flex h-full items-center justify-center text-muted-foreground">
        Access restricted to IT team.
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full overflow-hidden">
      {/* Header */}
      <div className="flex items-center justify-between px-8 py-6 border-b border-[var(--border)] shrink-0">
        <div>
          <h1 className="text-[20px] font-semibold text-foreground">IT Portal</h1>
          <p className="text-[13px] text-muted-foreground mt-0.5">Manage support tickets and software installation requests</p>
        </div>
      </div>

      {/* Tabs */}
      <div className="flex gap-1 px-8 py-3 border-b border-[var(--border)] shrink-0">
        {[
          { id: "tickets", label: "Support Tickets", icon: Ticket },
          { id: "software", label: "Software Requests", icon: Package },
        ].map(({ id, label, icon: Icon }) => (
          <button
            key={id}
            onClick={() => setTab(id as Tab)}
            className={cn(
              "flex items-center gap-2 rounded-lg px-4 py-2 text-[13px] font-medium transition-colors",
              tab === id
                ? "bg-primary/10 text-primary"
                : "text-muted-foreground hover:bg-secondary hover:text-foreground"
            )}
          >
            <Icon className="h-3.5 w-3.5" />
            {label}
          </button>
        ))}
      </div>

      <div className="flex-1 overflow-auto px-8 py-6">
        {tab === "tickets" && <TicketsTab authHeaders={authHeaders} />}
        {tab === "software" && <SoftwareTab authHeaders={authHeaders} />}
      </div>
    </div>
  );
}

// ── Tickets Tab ───────────────────────────────────────────────────────────────

interface ITTicket {
  id: number;
  ticket_id: string;
  employee_name: string;
  employee_email: string;
  category: string;
  subject: string;
  description: string;
  priority: string;
  status: string;
  assigned_to: string | null;
  resolution_notes: string | null;
  created_at: string;
}

function TicketsTab({ authHeaders }: { authHeaders: Record<string, string> }) {
  const [items, setItems] = useState<ITTicket[]>([]);
  const [loading, setLoading] = useState(true);
  const [acting, setActing] = useState<string | null>(null);
  const [filter, setFilter] = useState("Open");
  const [openDropdown, setOpenDropdown] = useState<string | null>(null);

  const fetch_ = useCallback(async () => {
    setLoading(true);
    try {
      const qs = filter !== "All" ? `?status=${encodeURIComponent(filter)}` : "";
      const res = await fetch(`/api/it/portal/tickets${qs}`, { headers: authHeaders });
      setItems(await res.json());
    } catch { toast.error("Failed to load"); }
    finally { setLoading(false); }
  }, [filter]);

  useEffect(() => { fetch_(); }, [fetch_]);

  const updateStatus = async (ticketId: string, status: string) => {
    setActing(ticketId);
    setOpenDropdown(null);
    try {
      const res = await fetch(`/api/it/portal/tickets/${ticketId}`, {
        method: "PUT",
        headers: authHeaders,
        body: JSON.stringify({ status }),
      });
      if (!res.ok) throw new Error((await res.json().catch(() => ({}))).detail || "Failed");
      toast.success(`Ticket updated to ${status}`);
      fetch_();
    } catch (e: unknown) { toast.error(e instanceof Error ? e.message : "Failed"); }
    finally { setActing(null); }
  };

  return (
    <div>
      <FilterBar
        filter={filter}
        setFilter={setFilter}
        options={["Open", "In Progress", "Awaiting Approval", "Resolved", "All"]}
        onRefresh={fetch_}
      />
      {loading ? <TableLoader /> : items.length === 0 ? <TableEmpty label="tickets" /> : (
        <table className="w-full text-[13px]">
          <thead>
            <tr className="border-b border-[var(--border)]">
              {["Ticket ID", "Employee", "Category", "Subject", "Priority", "Status", "Raised On", "Update Status"].map((h) => (
                <th key={h} className="text-left py-3 pr-4 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground/60">{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {items.map((t) => (
              <tr key={t.id} className="border-b border-[var(--border)]/50 hover:bg-white/[0.02] transition-colors">
                <td className="py-3.5 pr-4 font-mono text-[12px] text-primary">{t.ticket_id}</td>
                <td className="py-3.5 pr-4">
                  <div className="font-medium text-foreground">{t.employee_name}</div>
                  <div className="text-[11px] text-muted-foreground">{t.employee_email}</div>
                </td>
                <td className="py-3.5 pr-4 text-foreground/80">{t.category}</td>
                <td className="py-3.5 pr-4 text-foreground/80 max-w-[180px] truncate" title={t.subject}>{t.subject}</td>
                <td className="py-3.5 pr-4">
                  <span className={cn("text-[12px] font-medium", PRIORITY_COLOR[t.priority] ?? "text-zinc-400")}>{t.priority}</span>
                </td>
                <td className="py-3.5 pr-4"><StatusBadge status={t.status} /></td>
                <td className="py-3.5 pr-4 text-foreground/50">{t.created_at.slice(0, 10)}</td>
                <td className="py-3.5 relative">
                  {acting === t.ticket_id ? (
                    <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
                  ) : (
                    <div className="relative inline-block">
                      <button
                        onClick={() => setOpenDropdown(openDropdown === t.ticket_id ? null : t.ticket_id)}
                        className="flex items-center gap-1.5 rounded-lg border border-[var(--border)] px-2.5 py-1.5 text-[12px] text-muted-foreground hover:bg-secondary hover:text-foreground transition-colors"
                      >
                        {t.status}
                        <ChevronDown className="h-3 w-3" />
                      </button>
                      {openDropdown === t.ticket_id && (
                        <div className="absolute right-0 top-8 z-10 w-44 rounded-xl border border-[var(--border)] bg-card shadow-2xl overflow-hidden">
                          {TICKET_STATUSES.filter((s) => s !== t.status).map((s) => (
                            <button
                              key={s}
                              onClick={() => updateStatus(t.ticket_id, s)}
                              className="block w-full px-3 py-2 text-left text-[13px] text-foreground/80 hover:bg-secondary transition-colors"
                            >
                              {s}
                            </button>
                          ))}
                        </div>
                      )}
                    </div>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}

// ── Software Requests Tab ─────────────────────────────────────────────────────

interface SoftwareRequest {
  id: number;
  employee_name: string;
  employee_email: string;
  software_name: string;
  version: string | null;
  justification: string;
  requires_admin: boolean;
  status: string;
  approved_by: string | null;
}

function SoftwareTab({ authHeaders }: { authHeaders: Record<string, string> }) {
  const [items, setItems] = useState<SoftwareRequest[]>([]);
  const [loading, setLoading] = useState(true);
  const [acting, setActing] = useState<number | null>(null);
  const [filter, setFilter] = useState("Pending");

  const fetch_ = useCallback(async () => {
    setLoading(true);
    try {
      const qs = filter !== "All" ? `?status=${filter}` : "";
      const res = await fetch(`/api/it/portal/software-requests${qs}`, { headers: authHeaders });
      setItems(await res.json());
    } catch { toast.error("Failed to load"); }
    finally { setLoading(false); }
  }, [filter]);

  useEffect(() => { fetch_(); }, [fetch_]);

  const act = async (id: number, type: "approve" | "reject") => {
    setActing(id);
    try {
      const res = await fetch(`/api/it/portal/software-requests/${id}/${type}`, { method: "PUT", headers: authHeaders });
      if (!res.ok) throw new Error((await res.json().catch(() => ({}))).detail || "Failed");
      toast.success(`Software request ${type}d`);
      fetch_();
    } catch (e: unknown) { toast.error(e instanceof Error ? e.message : "Failed"); }
    finally { setActing(null); }
  };

  return (
    <div>
      <FilterBar filter={filter} setFilter={setFilter} options={["Pending", "Approved", "Rejected", "All"]} onRefresh={fetch_} />
      {loading ? <TableLoader /> : items.length === 0 ? <TableEmpty label="software requests" /> : (
        <table className="w-full text-[13px]">
          <thead>
            <tr className="border-b border-[var(--border)]">
              {["Employee", "Software", "Version", "Justification", "Admin Req.", "Status", "Actions"].map((h) => (
                <th key={h} className="text-left py-3 pr-4 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground/60">{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {items.map((sr) => (
              <tr key={sr.id} className="border-b border-[var(--border)]/50 hover:bg-white/[0.02] transition-colors">
                <td className="py-3.5 pr-4">
                  <div className="font-medium text-foreground">{sr.employee_name}</div>
                  <div className="text-[11px] text-muted-foreground">{sr.employee_email}</div>
                </td>
                <td className="py-3.5 pr-4 font-medium text-foreground">{sr.software_name}</td>
                <td className="py-3.5 pr-4 text-foreground/60 font-mono text-[12px]">{sr.version || "—"}</td>
                <td className="py-3.5 pr-4 text-foreground/60 max-w-[200px] truncate" title={sr.justification}>{sr.justification}</td>
                <td className="py-3.5 pr-4 text-center">
                  <span className={cn("text-[12px] font-medium", sr.requires_admin ? "text-amber-400" : "text-emerald-400")}>
                    {sr.requires_admin ? "Yes" : "No"}
                  </span>
                </td>
                <td className="py-3.5 pr-4"><StatusBadge status={sr.status} /></td>
                <td className="py-3.5">
                  {sr.status === "Pending" ? (
                    <div className="flex items-center gap-1.5">
                      <button
                        onClick={() => act(sr.id, "approve")}
                        disabled={acting === sr.id}
                        className="flex items-center gap-1 rounded-lg px-2.5 py-1.5 text-[12px] font-medium bg-emerald-500/10 text-emerald-400 hover:bg-emerald-500/20 transition-colors disabled:opacity-50"
                      >
                        {acting === sr.id ? <Loader2 className="h-3 w-3 animate-spin" /> : <Check className="h-3 w-3" />}
                        Approve
                      </button>
                      <button
                        onClick={() => act(sr.id, "reject")}
                        disabled={acting === sr.id}
                        className="flex items-center gap-1 rounded-lg px-2.5 py-1.5 text-[12px] font-medium bg-rose-500/10 text-rose-400 hover:bg-rose-500/20 transition-colors disabled:opacity-50"
                      >
                        <X className="h-3 w-3" />
                        Reject
                      </button>
                    </div>
                  ) : <span className="text-muted-foreground/40 text-[12px]">{sr.approved_by ? `by ${sr.approved_by}` : "—"}</span>}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}

// ── Shared helpers ────────────────────────────────────────────────────────────

function StatusBadge({ status }: { status: string }) {
  return (
    <span className={cn("rounded-full px-2.5 py-1 text-[11px] font-medium", STATUS_BADGE[status] ?? "bg-zinc-500/10 text-zinc-400")}>
      {status}
    </span>
  );
}

function FilterBar({ filter, setFilter, options, onRefresh }: { filter: string; setFilter: (s: string) => void; options: string[]; onRefresh: () => void }) {
  return (
    <div className="flex items-center justify-between mb-4">
      <div className="flex gap-1">
        {options.map((s) => (
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
      <button onClick={onRefresh} className="flex items-center gap-1.5 text-[13px] text-muted-foreground hover:text-foreground transition-colors">
        <RefreshCw className="h-3.5 w-3.5" />
        Refresh
      </button>
    </div>
  );
}

function TableLoader() {
  return <div className="flex h-40 items-center justify-center"><Loader2 className="h-5 w-5 animate-spin text-muted-foreground" /></div>;
}

function TableEmpty({ label }: { label: string }) {
  return <div className="flex h-40 items-center justify-center text-[13px] text-muted-foreground">No {label} found</div>;
}
