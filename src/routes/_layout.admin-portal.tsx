import { createFileRoute } from "@tanstack/react-router";
import { useAuth } from "@/lib/auth-store";
import { useState, useEffect, useCallback } from "react";
import { Check, X, Car, Receipt, AlertTriangle, UtensilsCrossed, Loader2, RefreshCw, ChevronDown, BookOpen, Plus, Pencil } from "lucide-react";
import { cn } from "@/lib/utils";
import { toast } from "sonner";
import { flyBanner } from "@/lib/fly-banner";

export const Route = createFileRoute("/_layout/admin-portal")({
  component: AdminPortal,
});

type Tab = "reimbursements" | "parking" | "complaints" | "food-complaints" | "bookshelf";

const STATUS_BADGE: Record<string, string> = {
  Pending: "bg-amber-500/15 text-amber-400 border border-amber-500/20",
  Approved: "bg-emerald-500/15 text-emerald-400 border border-emerald-500/20",
  Active: "bg-emerald-500/15 text-emerald-400 border border-emerald-500/20",
  Rejected: "bg-rose-500/15 text-rose-400 border border-rose-500/20",
  Surrendered: "bg-zinc-500/15 text-zinc-400 border border-zinc-500/20",
  Expired: "bg-zinc-500/15 text-zinc-400 border border-zinc-500/20",
  Open: "bg-blue-500/15 text-blue-400 border border-blue-500/20",
  "In Progress": "bg-violet-500/15 text-violet-400 border border-violet-500/20",
  Acknowledged: "bg-amber-500/15 text-amber-400 border border-amber-500/20",
  Resolved: "bg-emerald-500/15 text-emerald-400 border border-emerald-500/20",
  Closed: "bg-zinc-500/15 text-zinc-400 border border-zinc-500/20",
};

const PRIORITY_BADGE: Record<string, string> = {
  Low: "text-zinc-400",
  Medium: "text-amber-400",
  High: "text-orange-400",
  Critical: "text-rose-400",
};

function AdminPortal() {
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
          <p className="text-[13px] text-muted-foreground mt-0.5">Manage reimbursements, parking stickers, facility complaints, food complaints, and the company library</p>
        </div>
      </div>

      {/* Tabs */}
      <div className="flex gap-1 px-8 py-3 border-b border-[var(--border)] shrink-0">
        {[
          { id: "reimbursements", label: "Reimbursements", icon: Receipt },
          { id: "parking", label: "Parking Stickers", icon: Car },
          { id: "complaints", label: "Facility Complaints", icon: AlertTriangle },
          { id: "food-complaints", label: "Food Complaints", icon: UtensilsCrossed },
          { id: "bookshelf", label: "Bookshelf Buddy", icon: BookOpen },
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
        {tab === "food-complaints" && <FoodComplaintsTab authHeaders={authHeaders} />}
        {tab === "bookshelf" && <BookshelfTab authHeaders={authHeaders} />}
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
      if (type === "approve") flyBanner("Reimbursement approved");
      else toast.success("Reimbursement rejected");
      fetch_();
    } catch (e: unknown) { toast.error(e instanceof Error ? e.message : "Failed"); }
    finally { setActing(null); }
  };

  return (
    <div>
      <FilterBar filter={filter} setFilter={setFilter} options={["Pending", "Approved", "Rejected", "All"]} onRefresh={fetch_} />
      {loading ? <TableLoader /> : items.length === 0 ? <TableEmpty label="reimbursements" /> : (
        <div className="overflow-x-auto rounded-lg">
          <table className="w-full min-w-[900px] text-[13px]">
            <thead>
              <tr className="border-b border-[var(--border)]">
                <th className="sticky left-0 z-20 bg-background py-3 pr-4 text-left text-[11px] font-semibold uppercase tracking-wider text-muted-foreground/60">Employee</th>
                {["Type", "Amount (INR)", "Reason", "Status", "Submitted", "Actions"].map((h) => (
                  <th key={h} className="text-left py-3 pr-4 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground/60">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {items.map((r) => (
                <tr key={r.id} className="border-b border-[var(--border)]/50 hover:bg-white/[0.02] transition-colors">
                  <td className="sticky left-0 z-10 bg-background py-3.5 pr-4">
                    <div className="font-medium text-foreground">{r.employee_name}</div>
                    <div className="text-[11px] text-muted-foreground">{r.employee_email}</div>
                  </td>
                  <td className="py-3.5 pr-4 text-foreground/80 whitespace-nowrap">{r.type}</td>
                  <td className="py-3.5 pr-4 font-medium text-foreground whitespace-nowrap">{r.amount.toLocaleString("en-IN")}</td>
                  <td className="py-3.5 pr-4 text-foreground/70 max-w-[220px]">
                    <p className="line-clamp-2 leading-snug" title={r.reason}>{r.reason || "—"}</p>
                  </td>
                  <td className="py-3.5 pr-4"><StatusBadge status={r.status} /></td>
                  <td className="py-3.5 pr-4 text-foreground/50 whitespace-nowrap">{r.created_at.slice(0, 10)}</td>
                  <td className="py-3.5">
                    {r.status === "Pending" ? (
                      <ActionButtons id={r.id} acting={acting} onApprove={() => act(r.id, "approve")} onReject={() => act(r.id, "reject")} />
                    ) : <span className="text-muted-foreground/40 text-[12px]">{r.approved_by ? `by ${r.approved_by}` : "—"}</span>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
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
      flyBanner("Parking sticker approved & issued");
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
  closure_comment: string | null;
  created_at: string;
}

const COMPLAINT_STATUSES = ["In Progress", "Closed"];

function ComplaintsTab({ authHeaders }: { authHeaders: Record<string, string> }) {
  const [items, setItems] = useState<Complaint[]>([]);
  const [loading, setLoading] = useState(true);
  const [acting, setActing] = useState<string | null>(null);
  const [filter, setFilter] = useState("Open");
  const [openDropdown, setOpenDropdown] = useState<string | null>(null);
  const [closingTicket, setClosingTicket] = useState<string | null>(null);
  const [closureComment, setClosureComment] = useState("");

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

  const updateStatus = async (ticketId: string, status: string, comment?: string) => {
    setActing(ticketId);
    setOpenDropdown(null);
    setClosingTicket(null);
    setClosureComment("");
    try {
      const res = await fetch(`/api/portal/admin/complaints/${ticketId}/status`, {
        method: "PUT",
        headers: authHeaders,
        body: JSON.stringify({ status, closure_comment: comment || undefined }),
      });
      if (!res.ok) throw new Error((await res.json().catch(() => ({}))).detail || "Failed");
      toast.success(`Complaint updated to ${status}`);
      fetch_();
    } catch (e: unknown) { toast.error(e instanceof Error ? e.message : "Failed"); }
    finally { setActing(null); }
  };

  const showClosure = filter === "Closed" || filter === "All";

  return (
    <div>
      <FilterBar filter={filter} setFilter={setFilter} options={["Open", "In Progress", "Closed", "All"]} onRefresh={fetch_} />
      {loading ? <TableLoader /> : items.length === 0 ? <TableEmpty label="complaints" /> : (
        <div className="overflow-x-auto rounded-lg">
          <table className="w-full min-w-[1000px] text-[13px]">
            <thead>
              <tr className="border-b border-[var(--border)]">
                <th className="sticky left-0 z-20 bg-background py-3 pr-4 text-left text-[11px] font-semibold uppercase tracking-wider text-muted-foreground/60">
                  Ticket
                </th>
                {["Employee", "Category", "Description", "Location", "Priority", "Status", "Reported",
                  ...(showClosure ? ["Closure Comment"] : []),
                  "Update Status"].map((h) => (
                  <th key={h} className="text-left py-3 pr-4 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground/60">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {items.map((c) => (
                <tr key={c.id} className="border-b border-[var(--border)]/50 hover:bg-white/[0.02] transition-colors">
                  <td className="sticky left-0 z-10 bg-background py-3.5 pr-4 font-mono text-[12px] text-primary">
                    {c.ticket_id}
                  </td>
                  <td className="py-3.5 pr-4">
                    <div className="font-medium text-foreground">{c.employee_name}</div>
                    <div className="text-[11px] text-muted-foreground">{c.employee_email}</div>
                  </td>
                  <td className="py-3.5 pr-4 text-foreground/80">{c.category}</td>
                  <td className="py-3.5 pr-4 text-foreground/70 max-w-[220px]">
                    <p className="line-clamp-2 leading-snug" title={c.description}>{c.description}</p>
                  </td>
                  <td className="py-3.5 pr-4 text-foreground/70 whitespace-nowrap">{c.location}</td>
                  <td className="py-3.5 pr-4">
                    <span className={cn("text-[12px] font-medium", PRIORITY_BADGE[c.priority] ?? "text-zinc-400")}>{c.priority}</span>
                  </td>
                  <td className="py-3.5 pr-4"><StatusBadge status={c.status} /></td>
                  <td className="py-3.5 pr-4 text-foreground/50 whitespace-nowrap">{c.created_at.slice(0, 10)}</td>
                  {showClosure && (
                    <td className="py-3.5 pr-4 text-foreground/60 max-w-[180px]">
                      <span title={c.closure_comment ?? ""}>{c.closure_comment ? c.closure_comment.slice(0, 60) + (c.closure_comment.length > 60 ? "…" : "") : "—"}</span>
                    </td>
                  )}
                  <td className="py-3.5 relative">
                    {acting === c.ticket_id ? (
                      <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
                    ) : closingTicket === c.ticket_id ? (
                      <div className="flex flex-col gap-1.5 min-w-[200px]">
                        <textarea
                          autoFocus
                          placeholder="Closure comment (required)"
                          value={closureComment}
                          onChange={(e) => setClosureComment(e.target.value)}
                          rows={2}
                          className="w-full rounded-lg border border-[var(--border)] bg-secondary/50 px-2 py-1.5 text-[12px] text-foreground outline-none focus:border-primary/50 resize-none"
                        />
                        <div className="flex gap-1.5">
                          <button
                            onClick={() => { if (closureComment.trim()) updateStatus(c.ticket_id, "Closed", closureComment.trim()); else toast.error("Closure comment is required"); }}
                            className="flex-1 rounded-lg px-2.5 py-1.5 text-[12px] font-medium bg-zinc-500/10 text-zinc-300 hover:bg-zinc-500/20 transition-colors"
                          >
                            Confirm Close
                          </button>
                          <button
                            onClick={() => { setClosingTicket(null); setClosureComment(""); setOpenDropdown(null); }}
                            className="rounded-lg px-2 py-1.5 text-[12px] text-muted-foreground hover:bg-secondary transition-colors"
                          >
                            Cancel
                          </button>
                        </div>
                      </div>
                    ) : c.status === "Closed" ? (
                      <span className="text-muted-foreground/40 text-[12px]">—</span>
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
                                onClick={() => {
                                  setOpenDropdown(null);
                                  if (s === "Closed") { setClosingTicket(c.ticket_id); setClosureComment(""); }
                                  else updateStatus(c.ticket_id, s);
                                }}
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
        </div>
      )}
    </div>
  );
}

// ── Food Complaints Tab ────────────────────────────────────────────────────────

interface FoodComplaint {
  id: number;
  ticket_id: string;
  employee_name: string;
  employee_email: string;
  vendor_name: string;
  complaint_type: string;
  description: string;
  status: string;
  closure_comment: string | null;
  submitted_at: string;
}

const FOOD_COMPLAINT_STATUSES = ["In Progress", "Closed"];

function FoodComplaintsTab({ authHeaders }: { authHeaders: Record<string, string> }) {
  const [items, setItems] = useState<FoodComplaint[]>([]);
  const [loading, setLoading] = useState(true);
  const [acting, setActing] = useState<string | null>(null);
  const [filter, setFilter] = useState("Open");
  const [openDropdown, setOpenDropdown] = useState<string | null>(null);
  const [closingTicket, setClosingTicket] = useState<string | null>(null);
  const [closureComment, setClosureComment] = useState("");

  const fetch_ = useCallback(async () => {
    setLoading(true);
    try {
      const qs = filter !== "All" ? `?status=${filter}` : "";
      const res = await fetch(`/api/portal/admin/food-complaints${qs}`, { headers: authHeaders });
      setItems(await res.json());
    } catch { toast.error("Failed to load"); }
    finally { setLoading(false); }
  }, [filter]);

  useEffect(() => { fetch_(); }, [fetch_]);

  const updateStatus = async (ticketId: string, status: string, comment?: string) => {
    setActing(ticketId);
    setOpenDropdown(null);
    setClosingTicket(null);
    setClosureComment("");
    try {
      const res = await fetch(`/api/portal/admin/food-complaints/${ticketId}/status`, {
        method: "PUT",
        headers: authHeaders,
        body: JSON.stringify({ status, closure_comment: comment || undefined }),
      });
      if (!res.ok) throw new Error((await res.json().catch(() => ({}))).detail || "Failed");
      toast.success(`Complaint updated to ${status}`);
      fetch_();
    } catch (e: unknown) { toast.error(e instanceof Error ? e.message : "Failed"); }
    finally { setActing(null); }
  };

  const showClosure = filter === "Closed" || filter === "All";

  return (
    <div>
      <FilterBar filter={filter} setFilter={setFilter} options={["Open", "In Progress", "Closed", "All"]} onRefresh={fetch_} />
      {loading ? <TableLoader /> : items.length === 0 ? <TableEmpty label="food complaints" /> : (
        <div className="overflow-x-auto rounded-lg">
          <table className="w-full min-w-[1000px] text-[13px]">
            <thead>
              <tr className="border-b border-[var(--border)]">
                <th className="sticky left-0 z-20 bg-background py-3 pr-4 text-left text-[11px] font-semibold uppercase tracking-wider text-muted-foreground/60">
                  Ticket
                </th>
                {["Employee", "Vendor", "Type", "Description", "Status", "Submitted",
                  ...(showClosure ? ["Closure Comment"] : []),
                  "Update Status"].map((h) => (
                  <th key={h} className="text-left py-3 pr-4 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground/60">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {items.map((c) => (
                <tr key={c.id} className="border-b border-[var(--border)]/50 hover:bg-white/[0.02] transition-colors">
                  <td className="sticky left-0 z-10 bg-background py-3.5 pr-4 font-mono text-[12px] text-primary">
                    {c.ticket_id}
                  </td>
                  <td className="py-3.5 pr-4">
                    <div className="font-medium text-foreground">{c.employee_name}</div>
                    <div className="text-[11px] text-muted-foreground">{c.employee_email}</div>
                  </td>
                  <td className="py-3.5 pr-4 text-foreground/80 whitespace-nowrap">{c.vendor_name}</td>
                  <td className="py-3.5 pr-4 text-foreground/70 whitespace-nowrap">{c.complaint_type}</td>
                  <td className="py-3.5 pr-4 text-foreground/70 max-w-[220px]">
                    <p className="line-clamp-2 leading-snug" title={c.description}>{c.description}</p>
                  </td>
                  <td className="py-3.5 pr-4"><StatusBadge status={c.status} /></td>
                  <td className="py-3.5 pr-4 text-foreground/50 whitespace-nowrap">{c.submitted_at.slice(0, 10)}</td>
                  {showClosure && (
                    <td className="py-3.5 pr-4 text-foreground/60 max-w-[180px]">
                      <span title={c.closure_comment ?? ""}>{c.closure_comment ? c.closure_comment.slice(0, 60) + (c.closure_comment.length > 60 ? "…" : "") : "—"}</span>
                    </td>
                  )}
                  <td className="py-3.5 relative">
                    {acting === c.ticket_id ? (
                      <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
                    ) : closingTicket === c.ticket_id ? (
                      <div className="flex flex-col gap-1.5 min-w-[200px]">
                        <textarea
                          autoFocus
                          placeholder="Closure comment (required)"
                          value={closureComment}
                          onChange={(e) => setClosureComment(e.target.value)}
                          rows={2}
                          className="w-full rounded-lg border border-[var(--border)] bg-secondary/50 px-2 py-1.5 text-[12px] text-foreground outline-none focus:border-primary/50 resize-none"
                        />
                        <div className="flex gap-1.5">
                          <button
                            onClick={() => { if (closureComment.trim()) updateStatus(c.ticket_id, "Closed", closureComment.trim()); else toast.error("Closure comment is required"); }}
                            className="flex-1 rounded-lg px-2.5 py-1.5 text-[12px] font-medium bg-zinc-500/10 text-zinc-300 hover:bg-zinc-500/20 transition-colors"
                          >
                            Confirm Close
                          </button>
                          <button
                            onClick={() => { setClosingTicket(null); setClosureComment(""); setOpenDropdown(null); }}
                            className="rounded-lg px-2 py-1.5 text-[12px] text-muted-foreground hover:bg-secondary transition-colors"
                          >
                            Cancel
                          </button>
                        </div>
                      </div>
                    ) : c.status === "Closed" ? (
                      <span className="text-muted-foreground/40 text-[12px]">—</span>
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
                            {FOOD_COMPLAINT_STATUSES.filter((s) => s !== c.status).map((s) => (
                              <button
                                key={s}
                                onClick={() => {
                                  setOpenDropdown(null);
                                  if (s === "Closed") { setClosingTicket(c.ticket_id); setClosureComment(""); }
                                  else updateStatus(c.ticket_id, s);
                                }}
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
        </div>
      )}
    </div>
  );
}

// ── Bookshelf Buddy Tab ────────────────────────────────────────────────────────

interface Book {
  id: number;
  title: string;
  author: string;
  category: string;
  description: string;
  total_copies: number;
  available_copies: number;
  issued_copies: number;
  reserved_copies: number;
  lost_copies: number;
  damaged_copies: number;
  availability_status: string;
  created_at: string;
  copies?: BookCopy[];
}

interface BookCopy {
  id: number;
  book_id: number;
  copy_number: number;
  status: string;
  current_employee_email: string | null;
  current_employee_name: string | null;
  issued_at: string | null;
  due_date: string | null;
}

interface BookRequest {
  id: number;
  ticket_id: string;
  employee_name: string;
  employee_email: string;
  book_id: number;
  book_title: string;
  book_author: string;
  request_type: string;
  status: string;
  notes: string;
  admin_remarks: string;
  due_date: string | null;
  requested_at: string;
}

interface DashboardMetrics {
  total_books: number;
  total_copies: number;
  available_copies: number;
  issued_copies: number;
  reserved_copies: number;
  overdue_books: number;
  lost_books: number;
  damaged_books: number;
}

interface Dashboard {
  metrics: DashboardMetrics;
  popular_books: { title: string; author: string; request_count: number }[];
  most_issued: { title: string; author: string; issued_copies: number }[];
  overdue_list: { title: string; employee_name: string; employee_email: string; due_date: string; copy_number: number }[];
}

const COPY_STATUS_COLORS: Record<string, string> = {
  Available: "text-emerald-400",
  Issued: "text-blue-400",
  Reserved: "text-amber-400",
  Lost: "text-rose-400",
  Damaged: "text-orange-400",
  "Under Maintenance": "text-zinc-400",
  Returned: "text-emerald-400",
};

function BookshelfTab({ authHeaders }: { authHeaders: Record<string, string> }) {
  const [view, setView] = useState<"dashboard" | "requests" | "books">("dashboard");
  const [requests, setRequests] = useState<BookRequest[]>([]);
  const [books, setBooks] = useState<Book[]>([]);
  const [dashboard, setDashboard] = useState<Dashboard | null>(null);
  const [loadingReq, setLoadingReq] = useState(true);
  const [loadingBooks, setLoadingBooks] = useState(true);
  const [loadingDash, setLoadingDash] = useState(true);
  const [acting, setActing] = useState<number | null>(null);
  const [expandedBook, setExpandedBook] = useState<number | null>(null);
  const [reqFilter, setReqFilter] = useState("Pending");
  const [showBookForm, setShowBookForm] = useState(false);
  const [bookForm, setBookForm] = useState({ title: "", author: "", category: "", description: "", total_copies: 1 });
  const [savingBook, setSavingBook] = useState(false);

  const fetchDashboard = useCallback(async () => {
    setLoadingDash(true);
    try {
      const res = await fetch(`/api/portal/admin/library/dashboard`, { headers: authHeaders });
      setDashboard(await res.json());
    } catch { toast.error("Failed to load dashboard"); }
    finally { setLoadingDash(false); }
  }, []);

  const fetchRequests = useCallback(async () => {
    setLoadingReq(true);
    try {
      const qs = reqFilter !== "All" ? `?status=${reqFilter}` : "";
      const res = await fetch(`/api/portal/admin/book-requests${qs}`, { headers: authHeaders });
      setRequests(await res.json());
    } catch { toast.error("Failed to load book requests"); }
    finally { setLoadingReq(false); }
  }, [reqFilter]);

  const fetchBooks = useCallback(async () => {
    setLoadingBooks(true);
    try {
      const res = await fetch(`/api/portal/admin/books`, { headers: authHeaders });
      setBooks(await res.json());
    } catch { toast.error("Failed to load books"); }
    finally { setLoadingBooks(false); }
  }, []);

  const fetchBookCopies = useCallback(async (bookId: number) => {
    try {
      const res = await fetch(`/api/portal/admin/books/${bookId}`, { headers: authHeaders });
      const data = await res.json();
      setBooks((prev) => prev.map((b) => b.id === bookId ? { ...b, copies: data.copies } : b));
    } catch { toast.error("Failed to load copies"); }
  }, [authHeaders]);

  useEffect(() => { if (view === "dashboard") fetchDashboard(); }, [view, fetchDashboard]);
  useEffect(() => { if (view === "requests") fetchRequests(); }, [view, fetchRequests]);
  useEffect(() => { if (view === "books") fetchBooks(); }, [view, fetchBooks]);

  const actOnRequest = async (id: number, action: "approve" | "reject" | "return") => {
    setActing(id);
    try {
      const res = await fetch(`/api/portal/admin/book-requests/${id}/${action}`, { method: "PUT", headers: authHeaders, body: JSON.stringify({}) });
      if (!res.ok) throw new Error((await res.json().catch(() => ({}))).detail || "Failed");
      toast.success(action === "approve" ? "Request approved" : action === "reject" ? "Request rejected" : "Book marked returned");
      fetchRequests();
      if (view === "dashboard") fetchDashboard();
    } catch (e: unknown) { toast.error(e instanceof Error ? e.message : "Failed"); }
    finally { setActing(null); }
  };

  const actOnCopy = async (copyId: number, action: "lost" | "damaged" | "restore", bookId: number) => {
    try {
      const res = await fetch(`/api/portal/admin/library/copies/${copyId}/${action}`, { method: "PUT", headers: authHeaders, body: JSON.stringify({}) });
      if (!res.ok) throw new Error((await res.json().catch(() => ({}))).detail || "Failed");
      toast.success(`Copy marked as ${action}`);
      fetchBookCopies(bookId);
      fetchBooks();
    } catch (e: unknown) { toast.error(e instanceof Error ? e.message : "Failed"); }
  };

  const saveBook = async () => {
    if (!bookForm.title.trim()) { toast.error("Title is required"); return; }
    setSavingBook(true);
    try {
      const res = await fetch(`/api/portal/admin/books`, { method: "POST", headers: authHeaders, body: JSON.stringify(bookForm) });
      if (!res.ok) throw new Error((await res.json().catch(() => ({}))).detail || "Failed");
      toast.success("Book added to Nexus library");
      setShowBookForm(false);
      setBookForm({ title: "", author: "", category: "", description: "", total_copies: 1 });
      fetchBooks();
    } catch (e: unknown) { toast.error(e instanceof Error ? e.message : "Failed"); }
    finally { setSavingBook(false); }
  };

  return (
    <div>
      {/* Sub-navigation */}
      <div className="flex items-center justify-between mb-5">
        <div className="flex gap-1">
          {(["dashboard", "requests", "books"] as const).map((v) => (
            <button key={v} onClick={() => setView(v)}
              className={cn("rounded-lg px-3.5 py-1.5 text-[13px] font-medium capitalize transition-colors",
                view === v ? "bg-primary/10 text-primary" : "text-muted-foreground hover:bg-secondary hover:text-foreground")}>
              {v === "requests" ? "Borrow Requests" : v === "books" ? "Manage Books" : "Dashboard"}
            </button>
          ))}
        </div>
        {view === "books" && (
          <button onClick={() => setShowBookForm(true)}
            className="flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-[13px] font-medium bg-primary/10 text-primary hover:bg-primary/20 transition-colors">
            <Plus className="h-3.5 w-3.5" /> Add Book
          </button>
        )}
        {view === "dashboard" && (
          <button onClick={fetchDashboard} className="flex items-center gap-1.5 text-[13px] text-muted-foreground hover:text-foreground transition-colors">
            <RefreshCw className="h-3.5 w-3.5" /> Refresh
          </button>
        )}
      </div>

      {/* ── Dashboard ── */}
      {view === "dashboard" && (
        loadingDash ? <TableLoader /> : !dashboard ? <TableEmpty label="dashboard data" /> : (
          <div className="space-y-6">
            {/* Metrics Grid */}
            <div className="grid grid-cols-4 gap-3">
              {[
                { label: "Total Books", value: dashboard.metrics.total_books, color: "text-foreground" },
                { label: "Total Copies", value: dashboard.metrics.total_copies, color: "text-foreground" },
                { label: "Available", value: dashboard.metrics.available_copies, color: "text-emerald-400" },
                { label: "Issued", value: dashboard.metrics.issued_copies, color: "text-blue-400" },
                { label: "Reserved", value: dashboard.metrics.reserved_copies, color: "text-amber-400" },
                { label: "Overdue", value: dashboard.metrics.overdue_books, color: "text-rose-400" },
                { label: "Lost", value: dashboard.metrics.lost_books, color: "text-rose-500" },
                { label: "Damaged", value: dashboard.metrics.damaged_books, color: "text-orange-400" },
              ].map(({ label, value, color }) => (
                <div key={label} className="rounded-xl border border-[var(--border)] bg-card p-4">
                  <p className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground/60 mb-1">{label}</p>
                  <p className={cn("text-[28px] font-bold leading-none", color)}>{value}</p>
                </div>
              ))}
            </div>

            <div className="grid grid-cols-2 gap-4">
              {/* Popular Books */}
              <div className="rounded-xl border border-[var(--border)] bg-card p-4">
                <h3 className="text-[13px] font-semibold text-foreground mb-3">Most Requested Books</h3>
                {dashboard.popular_books.length === 0 ? <p className="text-[13px] text-muted-foreground">No data yet</p> : (
                  <div className="space-y-2">
                    {dashboard.popular_books.map((b, i) => (
                      <div key={i} className="flex items-center justify-between">
                        <div>
                          <p className="text-[13px] font-medium text-foreground">{b.title}</p>
                          <p className="text-[11px] text-muted-foreground">{b.author}</p>
                        </div>
                        <span className="text-[12px] font-semibold text-primary">{b.request_count} requests</span>
                      </div>
                    ))}
                  </div>
                )}
              </div>

              {/* Overdue List */}
              <div className="rounded-xl border border-[var(--border)] bg-card p-4">
                <h3 className="text-[13px] font-semibold text-foreground mb-3">Overdue Books</h3>
                {dashboard.overdue_list.length === 0 ? <p className="text-[13px] text-muted-foreground">No overdue books</p> : (
                  <div className="space-y-2">
                    {dashboard.overdue_list.map((o, i) => (
                      <div key={i} className="flex items-start justify-between">
                        <div>
                          <p className="text-[13px] font-medium text-foreground">{o.title} <span className="text-muted-foreground font-normal">#{o.copy_number}</span></p>
                          <p className="text-[11px] text-muted-foreground">{o.employee_name}</p>
                        </div>
                        <span className="text-[12px] font-semibold text-rose-400">Due {o.due_date}</span>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>
          </div>
        )
      )}

      {/* ── Borrow Requests ── */}
      {view === "requests" && (
        <>
          <FilterBar filter={reqFilter} setFilter={setReqFilter} options={["Pending", "Approved", "Rejected", "Returned", "All"]} onRefresh={fetchRequests} />
          {loadingReq ? <TableLoader /> : requests.length === 0 ? <TableEmpty label="book requests" /> : (
            <div className="overflow-x-auto rounded-lg">
              <table className="w-full min-w-[960px] text-[13px]">
                <thead>
                  <tr className="border-b border-[var(--border)]">
                    {["Ticket", "Employee", "Book", "Notes", "Status", "Due Date", "Requested", "Actions"].map((h) => (
                      <th key={h} className="text-left py-3 pr-4 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground/60">{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {requests.map((r) => (
                    <tr key={r.id} className="border-b border-[var(--border)]/50 hover:bg-white/[0.02] transition-colors">
                      <td className="py-3.5 pr-4 font-mono text-[12px] text-primary">{r.ticket_id}</td>
                      <td className="py-3.5 pr-4">
                        <div className="font-medium text-foreground">{r.employee_name}</div>
                        <div className="text-[11px] text-muted-foreground">{r.employee_email}</div>
                      </td>
                      <td className="py-3.5 pr-4">
                        <div className="font-medium text-foreground">{r.book_title}</div>
                        {r.book_author && <div className="text-[11px] text-muted-foreground">{r.book_author}</div>}
                      </td>
                      <td className="py-3.5 pr-4 text-foreground/70 max-w-[160px]">
                        <p className="line-clamp-2 leading-snug" title={r.notes}>{r.notes || "—"}</p>
                      </td>
                      <td className="py-3.5 pr-4">
                        <StatusBadge status={r.status} />
                        {r.admin_remarks && <div className="text-[11px] text-muted-foreground mt-0.5">{r.admin_remarks}</div>}
                      </td>
                      <td className="py-3.5 pr-4 text-foreground/60 whitespace-nowrap text-[12px]">{r.due_date || "—"}</td>
                      <td className="py-3.5 pr-4 text-foreground/50 whitespace-nowrap">{r.requested_at.slice(0, 10)}</td>
                      <td className="py-3.5">
                        {acting === r.id ? (
                          <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
                        ) : r.status === "Pending" ? (
                          <div className="flex items-center gap-1.5">
                            <button onClick={() => actOnRequest(r.id, "approve")} className="flex items-center gap-1 rounded-lg px-2.5 py-1.5 text-[12px] font-medium bg-emerald-500/10 text-emerald-400 hover:bg-emerald-500/20 transition-colors">
                              <Check className="h-3 w-3" /> Approve
                            </button>
                            <button onClick={() => actOnRequest(r.id, "reject")} className="flex items-center gap-1 rounded-lg px-2.5 py-1.5 text-[12px] font-medium bg-rose-500/10 text-rose-400 hover:bg-rose-500/20 transition-colors">
                              <X className="h-3 w-3" /> Reject
                            </button>
                          </div>
                        ) : r.status === "Approved" ? (
                          <button onClick={() => actOnRequest(r.id, "return")} className="flex items-center gap-1 rounded-lg px-2.5 py-1.5 text-[12px] font-medium bg-violet-500/10 text-violet-400 hover:bg-violet-500/20 transition-colors">
                            <BookOpen className="h-3 w-3" /> Mark Returned
                          </button>
                        ) : (
                          <span className="text-muted-foreground/40 text-[12px]">—</span>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </>
      )}

      {/* ── Manage Books ── */}
      {view === "books" && (
        <>
          {/* Add Book Form */}
          {showBookForm && (
            <div className="mb-5 rounded-xl border border-[var(--border)] bg-card p-5">
              <h3 className="text-[14px] font-semibold text-foreground mb-4">Add New Book to Nexus Library</h3>
              <div className="grid grid-cols-2 gap-3">
                {[
                  { label: "Title *", key: "title", placeholder: "e.g. Clean Code" },
                  { label: "Author", key: "author", placeholder: "e.g. Robert C. Martin" },
                  { label: "Category", key: "category", placeholder: "Technology, Management…" },
                ].map(({ label, key, placeholder }) => (
                  <div key={key}>
                    <label className="block text-[11px] font-semibold uppercase tracking-wider text-muted-foreground/60 mb-1">{label}</label>
                    <input type="text" placeholder={placeholder}
                      value={(bookForm as Record<string, string | number>)[key] as string}
                      onChange={(e) => setBookForm((p) => ({ ...p, [key]: e.target.value }))}
                      className="w-full rounded-lg border border-[var(--border)] bg-secondary/50 px-3 py-1.5 text-[13px] text-foreground outline-none focus:border-primary/50" />
                  </div>
                ))}
                <div>
                  <label className="block text-[11px] font-semibold uppercase tracking-wider text-muted-foreground/60 mb-1">Total Copies</label>
                  <input type="number" min={1} value={bookForm.total_copies}
                    onChange={(e) => setBookForm((p) => ({ ...p, total_copies: parseInt(e.target.value) || 1 }))}
                    className="w-full rounded-lg border border-[var(--border)] bg-secondary/50 px-3 py-1.5 text-[13px] text-foreground outline-none focus:border-primary/50" />
                </div>
                <div className="col-span-2">
                  <label className="block text-[11px] font-semibold uppercase tracking-wider text-muted-foreground/60 mb-1">Description</label>
                  <textarea placeholder="Brief description…" value={bookForm.description}
                    onChange={(e) => setBookForm((p) => ({ ...p, description: e.target.value }))} rows={2}
                    className="w-full rounded-lg border border-[var(--border)] bg-secondary/50 px-3 py-1.5 text-[13px] text-foreground outline-none focus:border-primary/50 resize-none" />
                </div>
              </div>
              <div className="flex gap-2 mt-4">
                <button onClick={saveBook} disabled={savingBook}
                  className="flex items-center gap-1.5 rounded-lg px-4 py-1.5 text-[13px] font-medium bg-primary/10 text-primary hover:bg-primary/20 transition-colors disabled:opacity-50">
                  {savingBook ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Check className="h-3.5 w-3.5" />} Add Book
                </button>
                <button onClick={() => setShowBookForm(false)} className="rounded-lg px-4 py-1.5 text-[13px] text-muted-foreground hover:bg-secondary transition-colors">Cancel</button>
              </div>
            </div>
          )}

          {loadingBooks ? <TableLoader /> : books.length === 0 ? <TableEmpty label="books" /> : (
            <div className="space-y-2">
              {books.map((b) => (
                <div key={b.id} className="rounded-xl border border-[var(--border)] bg-card overflow-hidden">
                  {/* Book row */}
                  <div
                    className="flex items-center gap-4 px-4 py-3 cursor-pointer hover:bg-white/[0.02] transition-colors"
                    onClick={() => {
                      if (expandedBook === b.id) { setExpandedBook(null); }
                      else { setExpandedBook(b.id); fetchBookCopies(b.id); }
                    }}
                  >
                    <ChevronDown className={cn("h-4 w-4 text-muted-foreground shrink-0 transition-transform", expandedBook === b.id && "rotate-180")} />
                    <div className="flex-1 min-w-0">
                      <span className="font-medium text-foreground text-[13px]">{b.title}</span>
                      {b.author && <span className="text-muted-foreground text-[12px] ml-2">by {b.author}</span>}
                      {b.category && <span className="ml-2 rounded-full bg-secondary px-2 py-0.5 text-[11px] text-muted-foreground">{b.category}</span>}
                    </div>
                    <div className="flex items-center gap-4 text-[12px] shrink-0">
                      <span className="text-emerald-400 font-medium">{b.available_copies} avail</span>
                      <span className="text-blue-400">{b.issued_copies} issued</span>
                      {b.reserved_copies > 0 && <span className="text-amber-400">{b.reserved_copies} reserved</span>}
                      {b.lost_copies > 0 && <span className="text-rose-400">{b.lost_copies} lost</span>}
                      {b.damaged_copies > 0 && <span className="text-orange-400">{b.damaged_copies} damaged</span>}
                      <span className="text-muted-foreground/50">/ {b.total_copies} total</span>
                    </div>
                  </div>

                  {/* Copies detail */}
                  {expandedBook === b.id && (
                    <div className="border-t border-[var(--border)] px-4 py-3 bg-secondary/20">
                      <p className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground/60 mb-2">Individual Copies</p>
                      {!b.copies ? (
                        <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
                      ) : (
                        <div className="flex flex-wrap gap-2">
                          {b.copies.map((c) => (
                            <div key={c.id} className="rounded-lg border border-[var(--border)] bg-card px-3 py-2 text-[12px] min-w-[160px]">
                              <div className="flex items-center justify-between mb-1">
                                <span className="font-semibold text-foreground">Copy #{c.copy_number}</span>
                                <span className={cn("font-medium", COPY_STATUS_COLORS[c.status] ?? "text-zinc-400")}>{c.status}</span>
                              </div>
                              {c.current_employee_name && (
                                <div className="text-muted-foreground text-[11px]">{c.current_employee_name}</div>
                              )}
                              {c.due_date && (
                                <div className="text-muted-foreground text-[11px]">Due: {c.due_date}</div>
                              )}
                              {c.status === "Available" && (
                                <div className="flex gap-1 mt-1.5">
                                  <button onClick={() => actOnCopy(c.id, "lost", b.id)}
                                    className="rounded px-1.5 py-0.5 text-[11px] bg-rose-500/10 text-rose-400 hover:bg-rose-500/20 transition-colors">Lost</button>
                                  <button onClick={() => actOnCopy(c.id, "damaged", b.id)}
                                    className="rounded px-1.5 py-0.5 text-[11px] bg-orange-500/10 text-orange-400 hover:bg-orange-500/20 transition-colors">Damaged</button>
                                </div>
                              )}
                              {(c.status === "Lost" || c.status === "Damaged") && (
                                <button onClick={() => actOnCopy(c.id, "restore", b.id)}
                                  className="mt-1.5 rounded px-1.5 py-0.5 text-[11px] bg-emerald-500/10 text-emerald-400 hover:bg-emerald-500/20 transition-colors">Restore</button>
                              )}
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}
        </>
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
