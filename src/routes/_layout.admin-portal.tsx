import { createFileRoute } from "@tanstack/react-router";
import { useAuth } from "@/lib/auth-store";
import { useState, useEffect, useCallback } from "react";
import { Check, X, Car, Receipt, AlertTriangle, Loader2, RefreshCw, ChevronDown } from "lucide-react";
import { cn } from "@/lib/utils";
import { toast } from "sonner";

export const Route = createFileRoute("/_layout/admin-portal")({
  component: AdminPortal,
});

type Tab = "reimbursements" | "parking" | "complaints";

const STATUS_BADGE: Record<string, string> = {
  Pending: "bg-amber-500/15 text-amber-400 border border-amber-500/20",
  Approved: "bg-emerald-500/15 text-emerald-400 border border-emerald-500/20",
  Active: "bg-emerald-500/15 text-emerald-400 border border-emerald-500/20",
  Rejected: "bg-rose-500/15 text-rose-400 border border-rose-500/20",
  Surrendered: "bg-zinc-500/15 text-zinc-400 border border-zinc-500/20",
  Expired: "bg-zinc-500/15 text-zinc-400 border border-zinc-500/20",
  Open: "bg-blue-500/15 text-blue-400 border border-blue-500/20",
  "In Progress": "bg-violet-500/15 text-violet-400 border border-violet-500/20",
  Resolved: "bg-emerald-500/15 text-emerald-400 border border-emerald-500/20",
  Closed: "bg-zinc-500/15 text-zinc-400 border border-zinc-500/20",
};

const PRIORITY_BADGE: Record<string, string> = {
  Low: "text-zinc-400",
  Medium: "text-amber-400",
  High: "text-orange-400",
  Critical: "text-rose-400",
};

export default function AdminPortal() {
  const { user } = useAuth();
  const [tab, setTab] = useState<Tab>("reimbursements");

  const authHeaders = {
    "Content-Type": "application/json",
    ...(user?.email ? { "x-user-email": user.email } : {}),
    ...(user?.role ? { "x-user-role": user.role.toLowerCase() } : {}),
  };

  if (user?.role !== "Admin") {
    return (
      <div className="flex h-full items-center justify-center text-muted-foreground">
        Access restricted to Admin team.
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full overflow-hidden">
      {/* Header */}
      <div className="flex items-center justify-between px-8 py-6 border-b border-[var(--border)] shrink-0">
        <div>
          <h1 className="text-[20px] font-semibold text-foreground">Admin Portal</h1>
          <p className="text-[13px] text-muted-foreground mt-0.5">Manage reimbursements, parking stickers, and facility complaints</p>
        </div>
      </div>

      {/* Tabs */}
      <div className="flex gap-1 px-8 py-3 border-b border-[var(--border)] shrink-0">
        {[
          { id: "reimbursements", label: "Reimbursements", icon: Receipt },
          { id: "parking", label: "Parking Stickers", icon: Car },
          { id: "complaints", label: "Facility Complaints", icon: AlertTriangle },
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
        {tab === "reimbursements" && <ReimbursementsTab authHeaders={authHeaders} />}
        {tab === "parking" && <ParkingTab authHeaders={authHeaders} />}
        {tab === "complaints" && <ComplaintsTab authHeaders={authHeaders} />}
      </div>
    </div>
  );
}

// ── Reimbursements Tab ─────────────────────────────────────────────────────────

interface Reimbursement {
  id: number;
  employee_name: string;
  employee_email: string;
  type: string;
  amount: number;
  reason: string;
  status: string;
  approved_by: string | null;
  created_at: string;
}

function ReimbursementsTab({ authHeaders }: { authHeaders: Record<string, string> }) {
  const [items, setItems] = useState<Reimbursement[]>([]);
  const [loading, setLoading] = useState(true);
  const [acting, setActing] = useState<number | null>(null);
  const [filter, setFilter] = useState("Pending");

  const fetch_ = useCallback(async () => {
    setLoading(true);
    try {
      const qs = filter !== "All" ? `?status=${filter}` : "";
      const res = await fetch(`/api/portal/admin/reimbursements${qs}`, { headers: authHeaders });
      setItems(await res.json());
    } catch { toast.error("Failed to load"); }
    finally { setLoading(false); }
  }, [filter]);

  useEffect(() => { fetch_(); }, [fetch_]);

  const act = async (id: number, type: "approve" | "reject") => {
    setActing(id);
    try {
      const res = await fetch(`/api/portal/admin/reimbursements/${id}/${type}`, { method: "PUT", headers: authHeaders });
      if (!res.ok) throw new Error((await res.json().catch(() => ({}))).detail || "Failed");
      toast.success(`Reimbursement ${type}d`);
      fetch_();
    } catch (e: unknown) { toast.error(e instanceof Error ? e.message : "Failed"); }
    finally { setActing(null); }
  };

  return (
    <div>
      <FilterBar filter={filter} setFilter={setFilter} options={["Pending", "Approved", "Rejected", "All"]} onRefresh={fetch_} />
      {loading ? <TableLoader /> : items.length === 0 ? <TableEmpty label="reimbursements" /> : (
        <table className="w-full text-[13px]">
          <thead>
            <tr className="border-b border-[var(--border)]">
              {["Employee", "Type", "Amount (INR)", "Reason", "Status", "Submitted", "Actions"].map((h) => (
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
                <td className="py-3.5 pr-4 text-foreground/80">{r.type}</td>
                <td className="py-3.5 pr-4 font-medium text-foreground">{r.amount.toLocaleString("en-IN")}</td>
                <td className="py-3.5 pr-4 text-foreground/60 max-w-[200px] truncate" title={r.reason}>{r.reason || "—"}</td>
                <td className="py-3.5 pr-4"><StatusBadge status={r.status} /></td>
                <td className="py-3.5 pr-4 text-foreground/50">{r.created_at.slice(0, 10)}</td>
                <td className="py-3.5">
                  {r.status === "Pending" ? (
                    <ActionButtons id={r.id} acting={acting} onApprove={() => act(r.id, "approve")} onReject={() => act(r.id, "reject")} />
                  ) : <span className="text-muted-foreground/40 text-[12px]">{r.approved_by ? `by ${r.approved_by}` : "—"}</span>}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}

// ── Parking Tab ────────────────────────────────────────────────────────────────

interface ParkingSticker {
  id: number;
  employee_name: string;
  employee_email: string;
  vehicle_type: string;
  vehicle_number: string;
  vehicle_make: string | null;
  vehicle_model: string | null;
  sticker_number: string | null;
  status: string;
  valid_from: string | null;
  valid_until: string | null;
}

function ParkingTab({ authHeaders }: { authHeaders: Record<string, string> }) {
  const [items, setItems] = useState<ParkingSticker[]>([]);
  const [loading, setLoading] = useState(true);
  const [acting, setActing] = useState<number | null>(null);
  const [filter, setFilter] = useState("Pending");
  const [stickerInputs, setStickerInputs] = useState<Record<number, string>>({});

  const fetch_ = useCallback(async () => {
    setLoading(true);
    try {
      const qs = filter !== "All" ? `?status=${filter}` : "";
      const res = await fetch(`/api/portal/admin/parking${qs}`, { headers: authHeaders });
      setItems(await res.json());
    } catch { toast.error("Failed to load"); }
    finally { setLoading(false); }
  }, [filter]);

  useEffect(() => { fetch_(); }, [fetch_]);

  const approve = async (id: number) => {
    const sticker = stickerInputs[id]?.trim();
    if (!sticker) { toast.error("Enter a sticker number first"); return; }
    setActing(id);
    try {
      const res = await fetch(`/api/portal/admin/parking/${id}/approve`, {
        method: "PUT",
        headers: authHeaders,
        body: JSON.stringify({ sticker_number: sticker }),
      });
      if (!res.ok) throw new Error((await res.json().catch(() => ({}))).detail || "Failed");
      toast.success("Parking sticker approved and issued");
      fetch_();
    } catch (e: unknown) { toast.error(e instanceof Error ? e.message : "Failed"); }
    finally { setActing(null); }
  };

  const revoke = async (id: number) => {
    setActing(id);
    try {
      const res = await fetch(`/api/portal/admin/parking/${id}/revoke`, { method: "PUT", headers: authHeaders });
      if (!res.ok) throw new Error((await res.json().catch(() => ({}))).detail || "Failed");
      toast.success("Parking sticker revoked");
      fetch_();
    } catch (e: unknown) { toast.error(e instanceof Error ? e.message : "Failed"); }
    finally { setActing(null); }
  };

  return (
    <div>
      <FilterBar filter={filter} setFilter={setFilter} options={["Pending", "Active", "Surrendered", "All"]} onRefresh={fetch_} />
      {loading ? <TableLoader /> : items.length === 0 ? <TableEmpty label="parking stickers" /> : (
        <table className="w-full text-[13px]">
          <thead>
            <tr className="border-b border-[var(--border)]">
              {["Employee", "Vehicle", "Type", "Sticker #", "Valid Until", "Status", "Actions"].map((h) => (
                <th key={h} className="text-left py-3 pr-4 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground/60">{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {items.map((s) => (
              <tr key={s.id} className="border-b border-[var(--border)]/50 hover:bg-white/[0.02] transition-colors">
                <td className="py-3.5 pr-4">
                  <div className="font-medium text-foreground">{s.employee_name}</div>
                  <div className="text-[11px] text-muted-foreground">{s.employee_email}</div>
                </td>
                <td className="py-3.5 pr-4">
                  <div className="font-medium text-foreground">{s.vehicle_number}</div>
                  {(s.vehicle_make || s.vehicle_model) && (
                    <div className="text-[11px] text-muted-foreground">{[s.vehicle_make, s.vehicle_model].filter(Boolean).join(" ")}</div>
                  )}
                </td>
                <td className="py-3.5 pr-4 text-foreground/80 capitalize">{s.vehicle_type}</td>
                <td className="py-3.5 pr-4 text-foreground/80 font-mono">{s.sticker_number || "—"}</td>
                <td className="py-3.5 pr-4 text-foreground/50">{s.valid_until || "—"}</td>
                <td className="py-3.5 pr-4"><StatusBadge status={s.status} /></td>
                <td className="py-3.5">
                  {s.status === "Pending" ? (
                    <div className="flex items-center gap-2">
                      <input
                        type="text"
                        placeholder="Sticker #"
                        value={stickerInputs[s.id] ?? ""}
                        onChange={(e) => setStickerInputs((p) => ({ ...p, [s.id]: e.target.value }))}
                        className="w-24 rounded-lg border border-[var(--border)] bg-secondary/50 px-2 py-1 text-[12px] text-foreground outline-none focus:border-primary/50"
                      />
                      <button
                        onClick={() => approve(s.id)}
                        disabled={acting === s.id}
                        className="flex items-center gap-1 rounded-lg px-2.5 py-1.5 text-[12px] font-medium bg-emerald-500/10 text-emerald-400 hover:bg-emerald-500/20 transition-colors disabled:opacity-50"
                      >
                        {acting === s.id ? <Loader2 className="h-3 w-3 animate-spin" /> : <Check className="h-3 w-3" />}
                        Issue
                      </button>
                    </div>
                  ) : s.status === "Active" ? (
                    <button
                      onClick={() => revoke(s.id)}
                      disabled={acting === s.id}
                      className="flex items-center gap-1 rounded-lg px-2.5 py-1.5 text-[12px] font-medium bg-rose-500/10 text-rose-400 hover:bg-rose-500/20 transition-colors disabled:opacity-50"
                    >
                      <X className="h-3 w-3" />
                      Revoke
                    </button>
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

// ── Complaints Tab ─────────────────────────────────────────────────────────────

interface Complaint {
  id: number;
  ticket_id: string;
  employee_name: string;
  employee_email: string;
  category: string;
  description: string;
  location: string;
  priority: string;
  status: string;
  assigned_to: string | null;
  resolution_notes: string | null;
  created_at: string;
}

const COMPLAINT_STATUSES = ["Open", "In Progress", "Resolved", "Closed"];

function ComplaintsTab({ authHeaders }: { authHeaders: Record<string, string> }) {
  const [items, setItems] = useState<Complaint[]>([]);
  const [loading, setLoading] = useState(true);
  const [acting, setActing] = useState<string | null>(null);
  const [filter, setFilter] = useState("Open");
  const [openDropdown, setOpenDropdown] = useState<string | null>(null);

  const fetch_ = useCallback(async () => {
    setLoading(true);
    try {
      const qs = filter !== "All" ? `?status=${filter}` : "";
      const res = await fetch(`/api/portal/admin/complaints${qs}`, { headers: authHeaders });
      setItems(await res.json());
    } catch { toast.error("Failed to load"); }
    finally { setLoading(false); }
  }, [filter]);

  useEffect(() => { fetch_(); }, [fetch_]);

  const updateStatus = async (ticketId: string, status: string) => {
    setActing(ticketId);
    setOpenDropdown(null);
    try {
      const res = await fetch(`/api/portal/admin/complaints/${ticketId}/status`, {
        method: "PUT",
        headers: authHeaders,
        body: JSON.stringify({ status }),
      });
      if (!res.ok) throw new Error((await res.json().catch(() => ({}))).detail || "Failed");
      toast.success(`Complaint updated to ${status}`);
      fetch_();
    } catch (e: unknown) { toast.error(e instanceof Error ? e.message : "Failed"); }
    finally { setActing(null); }
  };

  return (
    <div>
      <FilterBar filter={filter} setFilter={setFilter} options={["Open", "In Progress", "Resolved", "All"]} onRefresh={fetch_} />
      {loading ? <TableLoader /> : items.length === 0 ? <TableEmpty label="complaints" /> : (
        <table className="w-full text-[13px]">
          <thead>
            <tr className="border-b border-[var(--border)]">
              {["Ticket", "Employee", "Category", "Location", "Priority", "Status", "Reported", "Update Status"].map((h) => (
                <th key={h} className="text-left py-3 pr-4 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground/60">{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {items.map((c) => (
              <tr key={c.id} className="border-b border-[var(--border)]/50 hover:bg-white/[0.02] transition-colors">
                <td className="py-3.5 pr-4 font-mono text-[12px] text-primary">{c.ticket_id}</td>
                <td className="py-3.5 pr-4">
                  <div className="font-medium text-foreground">{c.employee_name}</div>
                  <div className="text-[11px] text-muted-foreground truncate max-w-[120px]" title={c.description}>{c.description}</div>
                </td>
                <td className="py-3.5 pr-4 text-foreground/80">{c.category}</td>
                <td className="py-3.5 pr-4 text-foreground/70">{c.location}</td>
                <td className="py-3.5 pr-4">
                  <span className={cn("text-[12px] font-medium", PRIORITY_BADGE[c.priority] ?? "text-zinc-400")}>{c.priority}</span>
                </td>
                <td className="py-3.5 pr-4"><StatusBadge status={c.status} /></td>
                <td className="py-3.5 pr-4 text-foreground/50">{c.created_at.slice(0, 10)}</td>
                <td className="py-3.5 relative">
                  {acting === c.ticket_id ? (
                    <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
                  ) : (
                    <div className="relative inline-block">
                      <button
                        onClick={() => setOpenDropdown(openDropdown === c.ticket_id ? null : c.ticket_id)}
                        className="flex items-center gap-1.5 rounded-lg border border-[var(--border)] px-2.5 py-1.5 text-[12px] text-muted-foreground hover:bg-secondary hover:text-foreground transition-colors"
                      >
                        {c.status}
                        <ChevronDown className="h-3 w-3" />
                      </button>
                      {openDropdown === c.ticket_id && (
                        <div className="absolute right-0 top-8 z-10 w-36 rounded-xl border border-[var(--border)] bg-card shadow-2xl overflow-hidden">
                          {COMPLAINT_STATUSES.filter((s) => s !== c.status).map((s) => (
                            <button
                              key={s}
                              onClick={() => updateStatus(c.ticket_id, s)}
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

// ── Shared UI helpers ─────────────────────────────────────────────────────────

function StatusBadge({ status }: { status: string }) {
  return (
    <span className={cn("rounded-full px-2.5 py-1 text-[11px] font-medium", STATUS_BADGE[status] ?? "bg-zinc-500/10 text-zinc-400")}>
      {status}
    </span>
  );
}

function ActionButtons({ id, acting, onApprove, onReject }: { id: number; acting: number | null; onApprove: () => void; onReject: () => void }) {
  return (
    <div className="flex items-center gap-1.5">
      <button onClick={onApprove} disabled={acting === id} className="flex items-center gap-1 rounded-lg px-2.5 py-1.5 text-[12px] font-medium bg-emerald-500/10 text-emerald-400 hover:bg-emerald-500/20 transition-colors disabled:opacity-50">
        {acting === id ? <Loader2 className="h-3 w-3 animate-spin" /> : <Check className="h-3 w-3" />}
        Approve
      </button>
      <button onClick={onReject} disabled={acting === id} className="flex items-center gap-1 rounded-lg px-2.5 py-1.5 text-[12px] font-medium bg-rose-500/10 text-rose-400 hover:bg-rose-500/20 transition-colors disabled:opacity-50">
        <X className="h-3 w-3" />
        Reject
      </button>
    </div>
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
