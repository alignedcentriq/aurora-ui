import React, { useState, useEffect, useCallback, useMemo } from "react";
import { useAuth } from "@/lib/auth-store";
import {
  Check,
  X,
  Car,
  Receipt,
  AlertTriangle,
  UtensilsCrossed,
  Loader2,
  RefreshCw,
  ChevronDown,
  BookOpen,
  Plus,
  Pencil,
  KeyRound,
  Wallet,
  Send,
  Save,
  Plane,
  FileText,
  Settings2,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { toast } from "sonner";
import { flyBanner } from "@/lib/fly-banner";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";

type Tab =
  | "reimbursements"
  | "parking"
  | "parking-dues"
  | "desk-keys"
  | "complaints"
  | "food-complaints"
  | "bookshelf"
  | "travel";

// Maps each tab to the scope required to see it
const TAB_SCOPE_MAP: Record<Tab, string> = {
  reimbursements: "reimbursements",
  parking: "parking",
  "parking-dues": "parking",
  "desk-keys": "desk_keys",
  complaints: "food_complaints",
  "food-complaints": "food_complaints",
  bookshelf: "bookshelf",
  travel: "travel_management",
};

const ALL_PORTAL_TABS = [
  { id: "reimbursements" as Tab, label: "Reimbursements", icon: Receipt },
  { id: "travel" as Tab, label: "Travel", icon: Plane },
  { id: "parking" as Tab, label: "Parking Stickers", icon: Car },
  { id: "parking-dues" as Tab, label: "Parking Charges & Dues", icon: Wallet },
  { id: "desk-keys" as Tab, label: "Desk Keys", icon: KeyRound },
  { id: "complaints" as Tab, label: "Facility Complaints", icon: AlertTriangle },
  { id: "food-complaints" as Tab, label: "Food Complaints", icon: UtensilsCrossed },
  { id: "bookshelf" as Tab, label: "Bookshelf Buddy", icon: BookOpen },
];

import { StatusBadge } from "@/components/ui/StatusBadge";
import { FilterBar } from "@/components/ui/FilterBar";
import { TableLoader } from "@/components/ui/TableLoader";
import { TableEmpty } from "@/components/ui/TableEmpty";

const PRIORITY_BADGE: Record<string, string> = {
  Low: "text-zinc-400",
  Medium: "text-amber-400",
  High: "text-orange-400",
  Critical: "text-rose-400",
};

export function AdminPortal() {
  const { user } = useAuth();
  const [tab, setTab] = useState<Tab>("reimbursements");

  const authHeaders = {
    "Content-Type": "application/json",
    ...(user?.email ? { "x-user-email": user.email } : {}),
    ...(user?.role ? { "x-user-role": user.role.toLowerCase() } : {}),
  };

  const scopes = user?.scopes ?? [];
  const fullAccess = scopes.length === 0; // empty scopes = full admin access

  // true if user has any access to scopeId (full scope OR any action variant)
  const hasScopeAccess = (scopeId: string) =>
    fullAccess || scopes.includes(scopeId) || scopes.some((s) => s.startsWith(`${scopeId}:`));

  // true if user can perform a specific action within a scope
  const hasAction = (scopeId: string, actionId: string) =>
    fullAccess || scopes.includes(scopeId) || scopes.includes(`${scopeId}:${actionId}`);

  const allowedTabs = useMemo(
    () => ALL_PORTAL_TABS.filter(({ id }) => hasScopeAccess(TAB_SCOPE_MAP[id])),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [fullAccess, scopes.join(",")],
  );

  // If current tab is no longer in scope, jump to first allowed tab
  useEffect(() => {
    if (allowedTabs.length > 0 && !allowedTabs.some((t) => t.id === tab)) {
      setTab(allowedTabs[0].id);
    }
  }, [allowedTabs, tab]);

  if (user?.role !== "Admin") {
    return (
      <div className="flex h-full items-center justify-center text-muted-foreground">
        Access restricted to Admin team.
      </div>
    );
  }

  if (allowedTabs.length === 0) {
    return (
      <div className="flex h-full items-center justify-center text-muted-foreground text-sm">
        No portal sections are enabled for your account. Contact your Super Admin.
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full overflow-hidden">
      {/* Header */}
      <div className="flex flex-col gap-1 sm:flex-row sm:items-center sm:justify-between px-4 py-4 sm:px-8 sm:py-5 border-b border-[#e2e8f0] dark:border-white/[0.08] shrink-0 bg-white dark:bg-card">
        <div>
          <p className="text-[11px] font-bold uppercase tracking-[0.1em] text-[#00a29a] dark:text-[#00c4bb] mb-1">
            Management Portals
          </p>
          <h1 className="text-[22px] font-bold text-[#0f172a] dark:text-white tracking-tight">
            Admin Portal
          </h1>
          <p className="text-[13px] text-[#64748b] dark:text-white/50 mt-0.5">
            Manage reimbursements, parking stickers, facility complaints, food complaints, and the
            company library.
          </p>
        </div>
      </div>

      {/* Tabs — only show sections this admin is scoped to */}
      <div className="px-4 py-3 sm:px-8 sm:py-4 bg-[#f5f7fa] dark:bg-background shrink-0 flex overflow-x-auto no-scrollbar">
        <div className="bg-white dark:bg-card border border-[#e2e8f0] dark:border-white/[0.08] rounded-2xl p-1.5 flex gap-1.5 w-max shrink-0 shadow-sm">
          {allowedTabs.map(({ id, label, icon: Icon }) => (
            <button
              key={id}
              onClick={() => setTab(id)}
              className={cn(
                "flex items-center gap-2 rounded-full px-4 py-2 text-[13px] font-semibold transition-all duration-200 shrink-0",
                tab === id
                  ? "bg-[#00a29a] text-white shadow-sm"
                  : "text-[#64748b] dark:text-white/50 hover:bg-[#f1f5f9] dark:hover:bg-white/[0.04] hover:text-[#0f172a] dark:hover:text-white",
              )}
            >
              <Icon className="h-3.5 w-3.5" />
              {label}
            </button>
          ))}
        </div>
      </div>

      <div className="flex-1 overflow-auto px-8 py-6 bg-[#f5f7fa] dark:bg-background">
        {tab === "reimbursements" && (
          <ReimbursementsTab
            authHeaders={authHeaders}
            canApprove={hasAction("reimbursements", "approve")}
          />
        )}
        {tab === "parking" && (
          <ParkingTab authHeaders={authHeaders} canManage={hasAction("parking", "manage")} />
        )}
        {tab === "parking-dues" && (
          <ParkingDuesTab authHeaders={authHeaders} canManage={hasAction("parking", "manage")} />
        )}
        {tab === "desk-keys" && (
          <DeskKeysTab authHeaders={authHeaders} canManage={hasAction("desk_keys", "manage")} />
        )}
        {tab === "complaints" && (
          <ComplaintsTab
            authHeaders={authHeaders}
            canManage={hasAction("food_complaints", "manage")}
          />
        )}
        {tab === "food-complaints" && (
          <FoodComplaintsTab
            authHeaders={authHeaders}
            canManage={hasAction("food_complaints", "manage")}
          />
        )}
        {tab === "bookshelf" && (
          <BookshelfTab authHeaders={authHeaders} canManage={hasAction("bookshelf", "manage")} />
        )}
        {tab === "travel" && (
          <TravelTab
            authHeaders={authHeaders}
            canApprove={hasAction("travel_management", "approve")}
            canSettings={hasAction("travel_management", "settings")}
          />
        )}
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

function ReimbursementsTab({
  authHeaders,
  canApprove,
}: {
  authHeaders: Record<string, string>;
  canApprove: boolean;
}) {
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
    } catch {
      toast.error("Failed to load");
    } finally {
      setLoading(false);
    }
  }, [filter]);

  useEffect(() => {
    fetch_();
  }, [fetch_]);

  const act = async (id: number, type: "approve" | "reject") => {
    setActing(id);
    try {
      const res = await fetch(`/api/portal/admin/reimbursements/${id}/${type}`, {
        method: "PUT",
        headers: authHeaders,
      });
      if (!res.ok) throw new Error((await res.json().catch(() => ({}))).detail || "Failed");
      if (type === "approve") flyBanner("Reimbursement approved");
      else toast.success("Reimbursement rejected");
      fetch_();
    } catch (e: unknown) {
      toast.error(e instanceof Error ? e.message : "Failed");
    } finally {
      setActing(null);
    }
  };

  return (
    <div>
      <FilterBar
        filter={filter}
        setFilter={setFilter}
        options={["Pending", "Approved", "Rejected", "All"]}
        onRefresh={fetch_}
      />
      {loading ? (
        <TableLoader />
      ) : items.length === 0 ? (
        <TableEmpty label="reimbursements" />
      ) : (
        <div className="overflow-x-auto rounded-2xl border border-[#e2e8f0] dark:border-white/[0.08] bg-white dark:bg-card">
          <table className="w-full min-w-[900px] text-[13px]">
            <thead>
              <tr className="border-b border-[#e2e8f0] dark:border-white/[0.08]">
                <th className="sticky left-0 z-20 bg-white dark:bg-card py-3 px-5 text-left text-[11px] font-bold uppercase tracking-wider text-[#94a3b8] dark:text-white/40">
                  Employee
                </th>
                {["Type", "Amount", "Reason", "Status", "Submitted", "Actions"].map((h) => (
                  <th
                    key={h}
                    className="text-left py-3 px-4 text-[11px] font-bold uppercase tracking-wider text-[#94a3b8] dark:text-white/40"
                  >
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {items.map((r) => (
                <tr
                  key={r.id}
                  className="border-b border-[#f1f5f9] dark:border-white/[0.05] last:border-0 hover:bg-[#f8fafc] dark:hover:bg-white/[0.02] transition-colors"
                >
                  <td className="sticky left-0 z-10 bg-white dark:bg-card py-3.5 px-5">
                    <div className="font-semibold text-[#0f172a] dark:text-white">
                      {r.employee_name}
                    </div>
                    <div className="text-[11px] text-[#94a3b8] dark:text-white/40">
                      {r.employee_email}
                    </div>
                  </td>
                  <td className="py-3.5 px-4 text-[#64748b] dark:text-white/60 whitespace-nowrap">
                    {r.type}
                  </td>
                  <td className="py-3.5 px-4 font-semibold text-[#0f172a] dark:text-white whitespace-nowrap">
                    ₹ {r.amount.toLocaleString("en-IN")}
                  </td>
                  <td className="py-3.5 px-4 text-[#64748b] dark:text-white/50 max-w-[220px]">
                    <p className="line-clamp-2 leading-snug" title={r.reason}>
                      {r.reason || "—"}
                    </p>
                  </td>
                  <td className="py-3.5 px-4">
                    <StatusBadge status={r.status} />
                  </td>
                  <td className="py-3.5 px-4 text-[#94a3b8] dark:text-white/40 whitespace-nowrap">
                    {r.created_at.slice(0, 10)}
                  </td>
                  <td className="py-3.5 px-4">
                    {r.status === "Pending" && canApprove ? (
                      <ActionButtons
                        id={r.id}
                        acting={acting}
                        onApprove={() => act(r.id, "approve")}
                        onReject={() => act(r.id, "reject")}
                      />
                    ) : (
                      <span className="text-[#94a3b8] dark:text-white/30 text-[12px]">
                        {r.approved_by
                          ? `by ${r.approved_by}`
                          : r.status === "Pending"
                            ? "View only"
                            : "—"}
                      </span>
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

function ParkingTab({
  authHeaders,
  canManage,
}: {
  authHeaders: Record<string, string>;
  canManage: boolean;
}) {
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
    } catch {
      toast.error("Failed to load");
    } finally {
      setLoading(false);
    }
  }, [filter]);

  useEffect(() => {
    fetch_();
  }, [fetch_]);

  const approve = async (id: number) => {
    const sticker = stickerInputs[id]?.trim();
    if (!sticker) {
      toast.error("Enter a sticker number first");
      return;
    }
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
    } catch (e: unknown) {
      toast.error(e instanceof Error ? e.message : "Failed");
    } finally {
      setActing(null);
    }
  };

  const revoke = async (id: number) => {
    setActing(id);
    try {
      const res = await fetch(`/api/portal/admin/parking/${id}/revoke`, {
        method: "PUT",
        headers: authHeaders,
      });
      if (!res.ok) throw new Error((await res.json().catch(() => ({}))).detail || "Failed");
      toast.success("Parking sticker revoked");
      fetch_();
    } catch (e: unknown) {
      toast.error(e instanceof Error ? e.message : "Failed");
    } finally {
      setActing(null);
    }
  };

  return (
    <div>
      <FilterBar
        filter={filter}
        setFilter={setFilter}
        options={["Pending", "Active", "Surrendered", "All"]}
        onRefresh={fetch_}
      />
      {loading ? (
        <TableLoader />
      ) : items.length === 0 ? (
        <TableEmpty label="parking stickers" />
      ) : (
        <div className="overflow-x-auto rounded-2xl border border-[#e2e8f0] dark:border-white/[0.08] bg-white dark:bg-card">
          <table className="w-full min-w-[900px] text-[13px]">
            <thead>
              <tr className="border-b border-[#e2e8f0] dark:border-white/[0.08]">
                <th className="py-3 px-5 text-left text-[11px] font-bold uppercase tracking-wider text-[#94a3b8] dark:text-white/40">
                  Employee
                </th>
                {["Vehicle", "Type", "Sticker #", "Valid Until", "Status", "Actions"].map((h) => (
                  <th
                    key={h}
                    className="text-left py-3 px-4 text-[11px] font-bold uppercase tracking-wider text-[#94a3b8] dark:text-white/40"
                  >
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {items.map((s) => (
                <tr
                  key={s.id}
                  className="border-b border-[#f1f5f9] dark:border-white/[0.05] last:border-0 hover:bg-[#f8fafc] dark:hover:bg-white/[0.02] transition-colors"
                >
                  <td className="py-3.5 px-5">
                    <div className="font-semibold text-foreground">{s.employee_name}</div>
                    <div className="text-[11px] text-muted-foreground">{s.employee_email}</div>
                  </td>
                  <td className="py-3.5 px-4">
                    <div className="font-medium text-foreground">{s.vehicle_number}</div>
                    {(s.vehicle_make || s.vehicle_model) && (
                      <div className="text-[11px] text-muted-foreground">
                        {[s.vehicle_make, s.vehicle_model].filter(Boolean).join(" ")}
                      </div>
                    )}
                  </td>
                  <td className="py-3.5 px-4 text-foreground/80 capitalize">{s.vehicle_type}</td>
                  <td className="py-3.5 px-4 text-foreground/80 font-mono">
                    {s.sticker_number || "—"}
                  </td>
                  <td className="py-3.5 px-4 text-foreground/50">{s.valid_until || "—"}</td>
                  <td className="py-3.5 px-4">
                    <StatusBadge status={s.status} />
                  </td>
                  <td className="py-3.5 px-4">
                    {!canManage ? (
                      <span className="text-muted-foreground/40 text-[12px]">View only</span>
                    ) : s.status === "Pending" ? (
                      <div className="flex items-center gap-2">
                        <input
                          type="text"
                          placeholder="Sticker #"
                          value={stickerInputs[s.id] ?? ""}
                          onChange={(e) =>
                            setStickerInputs((p) => ({ ...p, [s.id]: e.target.value }))
                          }
                          className="w-24 rounded-lg border border-[var(--border)] bg-secondary/50 px-2 py-1 text-[12px] text-foreground outline-none focus:border-primary/50"
                        />
                        <button
                          onClick={() => approve(s.id)}
                          disabled={acting === s.id}
                          className="flex items-center gap-1 rounded-lg px-2.5 py-1.5 text-[12px] font-medium bg-emerald-500/10 text-emerald-400 hover:bg-emerald-500/20 transition-colors disabled:opacity-50"
                        >
                          {acting === s.id ? (
                            <Loader2 className="h-3 w-3 animate-spin" />
                          ) : (
                            <Check className="h-3 w-3" />
                          )}
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

function ComplaintsTab({
  authHeaders,
  canManage,
}: {
  authHeaders: Record<string, string>;
  canManage: boolean;
}) {
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
    } catch {
      toast.error("Failed to load");
    } finally {
      setLoading(false);
    }
  }, [filter]);

  useEffect(() => {
    fetch_();
  }, [fetch_]);

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
    } catch (e: unknown) {
      toast.error(e instanceof Error ? e.message : "Failed");
    } finally {
      setActing(null);
    }
  };

  const showClosure = filter === "Closed" || filter === "All";

  return (
    <div>
      <FilterBar
        filter={filter}
        setFilter={setFilter}
        options={["Open", "In Progress", "Closed", "All"]}
        onRefresh={fetch_}
      />
      {loading ? (
        <TableLoader />
      ) : items.length === 0 ? (
        <TableEmpty label="complaints" />
      ) : (
        <div className="overflow-x-auto rounded-lg">
          <table className="w-full min-w-[1000px] text-[13px]">
            <thead>
              <tr className="border-b border-[var(--border)]">
                <th className="sticky left-0 z-20 bg-background py-3 pr-4 text-left text-[11px] font-bold uppercase tracking-wider text-[#94a3b8] dark:text-white/40">
                  Ticket
                </th>
                {[
                  "Employee",
                  "Category",
                  "Description",
                  "Location",
                  "Priority",
                  "Status",
                  "Reported",
                  ...(showClosure ? ["Closure Comment"] : []),
                  "Update Status",
                ].map((h) => (
                  <th
                    key={h}
                    className="text-left py-3 pr-4 text-[11px] font-bold uppercase tracking-wider text-[#94a3b8] dark:text-white/40"
                  >
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {items.map((c) => (
                <tr
                  key={c.id}
                  className="border-b border-[var(--border)]/50 hover:bg-white/[0.02] transition-colors"
                >
                  <td className="sticky left-0 z-10 bg-background py-3.5 pr-4 font-mono text-[12px] text-primary">
                    {c.ticket_id}
                  </td>
                  <td className="py-3.5 pr-4">
                    <div className="font-medium text-foreground">{c.employee_name}</div>
                    <div className="text-[11px] text-muted-foreground">{c.employee_email}</div>
                  </td>
                  <td className="py-3.5 pr-4 text-foreground/80">{c.category}</td>
                  <td className="py-3.5 pr-4 text-foreground/70 max-w-[220px]">
                    <p className="line-clamp-2 leading-snug" title={c.description}>
                      {c.description}
                    </p>
                  </td>
                  <td className="py-3.5 pr-4 text-foreground/70 whitespace-nowrap">{c.location}</td>
                  <td className="py-3.5 pr-4">
                    <span
                      className={cn(
                        "text-[12px] font-medium",
                        PRIORITY_BADGE[c.priority] ?? "text-zinc-400",
                      )}
                    >
                      {c.priority}
                    </span>
                  </td>
                  <td className="py-3.5 pr-4">
                    <StatusBadge status={c.status} />
                  </td>
                  <td className="py-3.5 pr-4 text-foreground/50 whitespace-nowrap">
                    {c.created_at.slice(0, 10)}
                  </td>
                  {showClosure && (
                    <td className="py-3.5 pr-4 text-foreground/60 max-w-[180px]">
                      <span title={c.closure_comment ?? ""}>
                        {c.closure_comment
                          ? c.closure_comment.slice(0, 60) +
                            (c.closure_comment.length > 60 ? "…" : "")
                          : "—"}
                      </span>
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
                            onClick={() => {
                              if (closureComment.trim())
                                updateStatus(c.ticket_id, "Closed", closureComment.trim());
                              else toast.error("Closure comment is required");
                            }}
                            className="flex-1 rounded-lg px-2.5 py-1.5 text-[12px] font-medium bg-zinc-500/10 text-zinc-300 hover:bg-zinc-500/20 transition-colors"
                          >
                            Confirm Close
                          </button>
                          <button
                            onClick={() => {
                              setClosingTicket(null);
                              setClosureComment("");
                              setOpenDropdown(null);
                            }}
                            className="rounded-lg px-2 py-1.5 text-[12px] text-muted-foreground hover:bg-secondary transition-colors"
                          >
                            Cancel
                          </button>
                        </div>
                      </div>
                    ) : c.status === "Closed" ? (
                      <span className="text-muted-foreground/40 text-[12px]">—</span>
                    ) : !canManage ? (
                      <span className="text-muted-foreground/40 text-[12px]">View only</span>
                    ) : (
                      <div className="relative inline-block">
                        <button
                          onClick={() =>
                            setOpenDropdown(openDropdown === c.ticket_id ? null : c.ticket_id)
                          }
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
                                  if (s === "Closed") {
                                    setClosingTicket(c.ticket_id);
                                    setClosureComment("");
                                  } else updateStatus(c.ticket_id, s);
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

function FoodComplaintsTab({
  authHeaders,
  canManage,
}: {
  authHeaders: Record<string, string>;
  canManage: boolean;
}) {
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
    } catch {
      toast.error("Failed to load");
    } finally {
      setLoading(false);
    }
  }, [filter]);

  useEffect(() => {
    fetch_();
  }, [fetch_]);

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
    } catch (e: unknown) {
      toast.error(e instanceof Error ? e.message : "Failed");
    } finally {
      setActing(null);
    }
  };

  const showClosure = filter === "Closed" || filter === "All";

  return (
    <div>
      <FilterBar
        filter={filter}
        setFilter={setFilter}
        options={["Open", "In Progress", "Closed", "All"]}
        onRefresh={fetch_}
      />
      {loading ? (
        <TableLoader />
      ) : items.length === 0 ? (
        <TableEmpty label="food complaints" />
      ) : (
        <div className="overflow-x-auto rounded-lg">
          <table className="w-full min-w-[1000px] text-[13px]">
            <thead>
              <tr className="border-b border-[var(--border)]">
                <th className="sticky left-0 z-20 bg-background py-3 pr-4 text-left text-[11px] font-bold uppercase tracking-wider text-[#94a3b8] dark:text-white/40">
                  Ticket
                </th>
                {[
                  "Employee",
                  "Vendor",
                  "Type",
                  "Description",
                  "Status",
                  "Submitted",
                  ...(showClosure ? ["Closure Comment"] : []),
                  "Update Status",
                ].map((h) => (
                  <th
                    key={h}
                    className="text-left py-3 pr-4 text-[11px] font-bold uppercase tracking-wider text-[#94a3b8] dark:text-white/40"
                  >
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {items.map((c) => (
                <tr
                  key={c.id}
                  className="border-b border-[var(--border)]/50 hover:bg-white/[0.02] transition-colors"
                >
                  <td className="sticky left-0 z-10 bg-background py-3.5 pr-4 font-mono text-[12px] text-primary">
                    {c.ticket_id}
                  </td>
                  <td className="py-3.5 pr-4">
                    <div className="font-medium text-foreground">{c.employee_name}</div>
                    <div className="text-[11px] text-muted-foreground">{c.employee_email}</div>
                  </td>
                  <td className="py-3.5 pr-4 text-foreground/80 whitespace-nowrap">
                    {c.vendor_name}
                  </td>
                  <td className="py-3.5 pr-4 text-foreground/70 whitespace-nowrap">
                    {c.complaint_type}
                  </td>
                  <td className="py-3.5 pr-4 text-foreground/70 max-w-[220px]">
                    <p className="line-clamp-2 leading-snug" title={c.description}>
                      {c.description}
                    </p>
                  </td>
                  <td className="py-3.5 pr-4">
                    <StatusBadge status={c.status} />
                  </td>
                  <td className="py-3.5 pr-4 text-foreground/50 whitespace-nowrap">
                    {c.submitted_at.slice(0, 10)}
                  </td>
                  {showClosure && (
                    <td className="py-3.5 pr-4 text-foreground/60 max-w-[180px]">
                      <span title={c.closure_comment ?? ""}>
                        {c.closure_comment
                          ? c.closure_comment.slice(0, 60) +
                            (c.closure_comment.length > 60 ? "…" : "")
                          : "—"}
                      </span>
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
                            onClick={() => {
                              if (closureComment.trim())
                                updateStatus(c.ticket_id, "Closed", closureComment.trim());
                              else toast.error("Closure comment is required");
                            }}
                            className="flex-1 rounded-lg px-2.5 py-1.5 text-[12px] font-medium bg-zinc-500/10 text-zinc-300 hover:bg-zinc-500/20 transition-colors"
                          >
                            Confirm Close
                          </button>
                          <button
                            onClick={() => {
                              setClosingTicket(null);
                              setClosureComment("");
                              setOpenDropdown(null);
                            }}
                            className="rounded-lg px-2 py-1.5 text-[12px] text-muted-foreground hover:bg-secondary transition-colors"
                          >
                            Cancel
                          </button>
                        </div>
                      </div>
                    ) : c.status === "Closed" ? (
                      <span className="text-muted-foreground/40 text-[12px]">—</span>
                    ) : !canManage ? (
                      <span className="text-muted-foreground/40 text-[12px]">View only</span>
                    ) : (
                      <div className="relative inline-block">
                        <button
                          onClick={() =>
                            setOpenDropdown(openDropdown === c.ticket_id ? null : c.ticket_id)
                          }
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
                                  if (s === "Closed") {
                                    setClosingTicket(c.ticket_id);
                                    setClosureComment("");
                                  } else updateStatus(c.ticket_id, s);
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
  due_soon: number;
  pending_requests: number;
  pending_extensions: number;
  active_borrowers: number;
  lost_books: number;
  damaged_books: number;
}

interface AssignmentRow {
  ticket_id: string;
  book_title: string;
  book_author: string;
  employee_name: string;
  employee_email: string;
  copy_number: number;
  issued_at: string | null;
  due_date: string;
  status: string;
}

interface DashboardListRow {
  title: string;
  employee_name: string;
  employee_email: string;
  due_date: string;
  copy_number: number;
}

interface Dashboard {
  metrics: DashboardMetrics;
  popular_books: { title: string; author: string; request_count: number }[];
  most_issued: { title: string; author: string; issued_copies: number }[];
  overdue_list: DashboardListRow[];
  due_soon_list: DashboardListRow[];
  assignment_list: AssignmentRow[];
}

interface BookExtension {
  id: number;
  request_id: number;
  ticket_id: string;
  employee_name: string;
  employee_email: string;
  book_title: string;
  book_author: string;
  additional_days: number;
  reason: string;
  status: string;
  admin_remarks: string;
  previous_due: string | null;
  new_due_date: string | null;
  current_due_date: string | null;
  requested_at: string;
  actioned_at: string | null;
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

function BookshelfTab({
  authHeaders,
  canManage,
}: {
  authHeaders: Record<string, string>;
  canManage: boolean;
}) {
  const [view, setView] = useState<
    "dashboard" | "requests" | "extensions" | "assignments" | "books"
  >("dashboard");
  const [requests, setRequests] = useState<BookRequest[]>([]);
  const [books, setBooks] = useState<Book[]>([]);
  const [dashboard, setDashboard] = useState<Dashboard | null>(null);
  const [extensions, setExtensions] = useState<BookExtension[]>([]);
  const [loadingReq, setLoadingReq] = useState(true);
  const [loadingBooks, setLoadingBooks] = useState(true);
  const [loadingDash, setLoadingDash] = useState(true);
  const [loadingExt, setLoadingExt] = useState(true);
  const [acting, setActing] = useState<number | null>(null);
  const [actingExt, setActingExt] = useState<number | null>(null);
  const [expandedBook, setExpandedBook] = useState<number | null>(null);
  const [reqFilter, setReqFilter] = useState("Pending");
  const [extFilter, setExtFilter] = useState("Pending");
  const [showBookForm, setShowBookForm] = useState(false);
  const [bookForm, setBookForm] = useState({
    title: "",
    author: "",
    category: "",
    description: "",
    total_copies: 1,
  });
  const [savingBook, setSavingBook] = useState(false);

  const fetchDashboard = useCallback(async () => {
    setLoadingDash(true);
    try {
      const res = await fetch(`/api/portal/admin/library/dashboard`, { headers: authHeaders });
      setDashboard(await res.json());
    } catch {
      toast.error("Failed to load dashboard");
    } finally {
      setLoadingDash(false);
    }
  }, []);

  const fetchRequests = useCallback(async () => {
    setLoadingReq(true);
    try {
      const qs = reqFilter !== "All" ? `?status=${reqFilter}` : "";
      const res = await fetch(`/api/portal/admin/book-requests${qs}`, { headers: authHeaders });
      setRequests(await res.json());
    } catch {
      toast.error("Failed to load book requests");
    } finally {
      setLoadingReq(false);
    }
  }, [reqFilter]);

  const fetchBooks = useCallback(async () => {
    setLoadingBooks(true);
    try {
      const res = await fetch(`/api/portal/admin/books`, { headers: authHeaders });
      setBooks(await res.json());
    } catch {
      toast.error("Failed to load books");
    } finally {
      setLoadingBooks(false);
    }
  }, []);

  const fetchBookCopies = useCallback(
    async (bookId: number) => {
      try {
        const res = await fetch(`/api/portal/admin/books/${bookId}`, { headers: authHeaders });
        const data = await res.json();
        setBooks((prev) => prev.map((b) => (b.id === bookId ? { ...b, copies: data.copies } : b)));
      } catch {
        toast.error("Failed to load copies");
      }
    },
    [authHeaders],
  );

  const fetchExtensions = useCallback(async () => {
    setLoadingExt(true);
    try {
      const qs = extFilter !== "All" ? `?status=${extFilter}` : "";
      const res = await fetch(`/api/portal/admin/book-extensions${qs}`, { headers: authHeaders });
      setExtensions(await res.json());
    } catch {
      toast.error("Failed to load extension requests");
    } finally {
      setLoadingExt(false);
    }
  }, [extFilter]);

  const actOnExtension = async (id: number, action: "approve" | "reject") => {
    setActingExt(id);
    try {
      const res = await fetch(`/api/portal/admin/book-extensions/${id}/${action}`, {
        method: "PUT",
        headers: authHeaders,
        body: JSON.stringify({}),
      });
      if (!res.ok) throw new Error((await res.json().catch(() => ({}))).detail || "Failed");
      toast.success(action === "approve" ? "Extension approved" : "Extension rejected");
      fetchExtensions();
      if (view === "dashboard") fetchDashboard();
    } catch (e: unknown) {
      toast.error(e instanceof Error ? e.message : "Failed");
    } finally {
      setActingExt(null);
    }
  };

  useEffect(() => {
    if (view === "dashboard") fetchDashboard();
  }, [view, fetchDashboard]);
  useEffect(() => {
    if (view === "requests") fetchRequests();
  }, [view, fetchRequests]);
  useEffect(() => {
    if (view === "extensions") fetchExtensions();
  }, [view, fetchExtensions]);
  useEffect(() => {
    if (view === "books") fetchBooks();
  }, [view, fetchBooks]);

  const actOnRequest = async (id: number, action: "approve" | "reject" | "return") => {
    setActing(id);
    try {
      const res = await fetch(`/api/portal/admin/book-requests/${id}/${action}`, {
        method: "PUT",
        headers: authHeaders,
        body: JSON.stringify({}),
      });
      if (!res.ok) throw new Error((await res.json().catch(() => ({}))).detail || "Failed");
      toast.success(
        action === "approve"
          ? "Request approved"
          : action === "reject"
            ? "Request rejected"
            : "Book marked returned",
      );
      fetchRequests();
      if (view === "dashboard") fetchDashboard();
    } catch (e: unknown) {
      toast.error(e instanceof Error ? e.message : "Failed");
    } finally {
      setActing(null);
    }
  };

  const actOnCopy = async (
    copyId: number,
    action: "lost" | "damaged" | "restore",
    bookId: number,
  ) => {
    try {
      const res = await fetch(`/api/portal/admin/library/copies/${copyId}/${action}`, {
        method: "PUT",
        headers: authHeaders,
        body: JSON.stringify({}),
      });
      if (!res.ok) throw new Error((await res.json().catch(() => ({}))).detail || "Failed");
      toast.success(`Copy marked as ${action}`);
      fetchBookCopies(bookId);
      fetchBooks();
    } catch (e: unknown) {
      toast.error(e instanceof Error ? e.message : "Failed");
    }
  };

  const saveBook = async () => {
    if (!bookForm.title.trim()) {
      toast.error("Title is required");
      return;
    }
    setSavingBook(true);
    try {
      const res = await fetch(`/api/portal/admin/books`, {
        method: "POST",
        headers: authHeaders,
        body: JSON.stringify(bookForm),
      });
      if (!res.ok) throw new Error((await res.json().catch(() => ({}))).detail || "Failed");
      toast.success("Book added to Nexus library");
      setShowBookForm(false);
      setBookForm({ title: "", author: "", category: "", description: "", total_copies: 1 });
      fetchBooks();
    } catch (e: unknown) {
      toast.error(e instanceof Error ? e.message : "Failed");
    } finally {
      setSavingBook(false);
    }
  };

  return (
    <div>
      {/* Sub-navigation */}
      <div className="flex flex-col gap-2.5 sm:flex-row sm:items-center sm:justify-between mb-5">
        <div className="flex gap-1 flex-wrap">
          {(["dashboard", "requests", "extensions", "assignments", "books"] as const).map((v) => (
            <button
              key={v}
              onClick={() => setView(v)}
              className={cn(
                "rounded-lg px-3.5 py-1.5 text-[13px] font-medium capitalize transition-colors",
                view === v
                  ? "bg-primary/10 text-primary"
                  : "text-muted-foreground hover:bg-secondary hover:text-foreground",
              )}
            >
              {v === "requests"
                ? "Borrow Requests"
                : v === "extensions"
                  ? "Extensions"
                  : v === "assignments"
                    ? "Assignments"
                    : v === "books"
                      ? "Manage Books"
                      : "Dashboard"}
            </button>
          ))}
        </div>
        <div className="flex items-center gap-2 self-end sm:self-auto">
          {view === "books" && canManage && (
            <button
              onClick={() => setShowBookForm(true)}
              className="flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-[13px] font-medium bg-primary/10 text-primary hover:bg-primary/20 transition-colors"
            >
              <Plus className="h-3.5 w-3.5" /> Add Book
            </button>
          )}
          {view === "dashboard" && (
            <button
              onClick={fetchDashboard}
              className="flex items-center gap-1.5 text-[13px] text-muted-foreground hover:text-foreground transition-colors"
            >
              <RefreshCw className="h-3.5 w-3.5" /> Refresh
            </button>
          )}
        </div>
      </div>

      {/* ── Dashboard ── */}
      {view === "dashboard" &&
        (loadingDash ? (
          <TableLoader />
        ) : !dashboard ? (
          <TableEmpty label="dashboard data" />
        ) : (
          <div className="space-y-6">
            {/* Metrics Grid */}
            <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6 gap-3">
              {[
                {
                  label: "Total Books",
                  value: dashboard.metrics.total_books,
                  color: "text-foreground",
                },
                {
                  label: "Available",
                  value: dashboard.metrics.available_copies,
                  color: "text-emerald-400",
                },
                { label: "Issued", value: dashboard.metrics.issued_copies, color: "text-blue-400" },
                {
                  label: "Active Borrowers",
                  value: dashboard.metrics.active_borrowers ?? 0,
                  color: "text-cyan-400",
                },
                {
                  label: "Pending Requests",
                  value: dashboard.metrics.pending_requests ?? 0,
                  color: "text-amber-400",
                },
                {
                  label: "Pending Extensions",
                  value: dashboard.metrics.pending_extensions ?? 0,
                  color: "text-violet-400",
                },
                {
                  label: "Due Soon (≤7d)",
                  value: dashboard.metrics.due_soon ?? 0,
                  color: "text-amber-300",
                },
                {
                  label: "Overdue",
                  value: dashboard.metrics.overdue_books,
                  color: "text-rose-400",
                },
                {
                  label: "Total Copies",
                  value: dashboard.metrics.total_copies,
                  color: "text-foreground",
                },
                {
                  label: "Reserved",
                  value: dashboard.metrics.reserved_copies,
                  color: "text-amber-400",
                },
                { label: "Lost", value: dashboard.metrics.lost_books, color: "text-rose-500" },
                {
                  label: "Damaged",
                  value: dashboard.metrics.damaged_books,
                  color: "text-orange-400",
                },
              ].map(({ label, value, color }) => (
                <div key={label} className="rounded-xl border border-[var(--border)] bg-card p-4">
                  <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground/60 mb-1">
                    {label}
                  </p>
                  <p className={cn("text-[22px] md:text-[28px] font-bold leading-none", color)}>
                    {value}
                  </p>
                </div>
              ))}
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {/* Popular Books */}
              <div className="rounded-xl border border-[var(--border)] bg-card p-4">
                <h3 className="text-[13px] font-semibold text-foreground mb-3">
                  Most Requested Books
                </h3>
                {dashboard.popular_books.length === 0 ? (
                  <p className="text-[13px] text-muted-foreground">No data yet</p>
                ) : (
                  <div className="space-y-2">
                    {dashboard.popular_books.map((b, i) => (
                      <div key={i} className="flex flex-col md:flex-row md:items-center justify-between gap-4">
                        <div>
                          <p className="text-[13px] font-medium text-foreground">{b.title}</p>
                          <p className="text-[11px] text-muted-foreground">{b.author}</p>
                        </div>
                        <span className="text-[12px] font-semibold text-primary">
                          {b.request_count} requests
                        </span>
                      </div>
                    ))}
                  </div>
                )}
              </div>

              {/* Overdue List */}
              <div className="rounded-xl border border-[var(--border)] bg-card p-4">
                <h3 className="text-[13px] font-semibold text-foreground mb-3">Overdue Books</h3>
                {dashboard.overdue_list.length === 0 ? (
                  <p className="text-[13px] text-muted-foreground">No overdue books</p>
                ) : (
                  <div className="space-y-2">
                    {dashboard.overdue_list.map((o, i) => (
                      <div key={i} className="flex items-start justify-between">
                        <div>
                          <p className="text-[13px] font-medium text-foreground">
                            {o.title}{" "}
                            <span className="text-muted-foreground font-normal">
                              #{o.copy_number}
                            </span>
                          </p>
                          <p className="text-[11px] text-muted-foreground">{o.employee_name}</p>
                        </div>
                        <span className="text-[12px] font-semibold text-rose-400">
                          Due {o.due_date}
                        </span>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>

            {/* Due Soon List */}
            <div className="rounded-xl border border-[var(--border)] bg-card p-4">
              <h3 className="text-[13px] font-semibold text-foreground mb-3">Due Within 7 Days</h3>
              {(dashboard.due_soon_list || []).length === 0 ? (
                <p className="text-[13px] text-muted-foreground">Nothing due in the next 7 days.</p>
              ) : (
                <div className="space-y-2">
                  {(dashboard.due_soon_list || []).map((o, i) => (
                    <div key={i} className="flex items-start justify-between">
                      <div>
                        <p className="text-[13px] font-medium text-foreground">
                          {o.title}{" "}
                          <span className="text-muted-foreground font-normal">
                            #{o.copy_number}
                          </span>
                        </p>
                        <p className="text-[11px] text-muted-foreground">{o.employee_name}</p>
                      </div>
                      <span className="text-[12px] font-semibold text-amber-300">
                        Due {o.due_date}
                      </span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        ))}

      {/* ── Extensions ── */}
      {view === "extensions" && (
        <>
          <FilterBar
            filter={extFilter}
            setFilter={setExtFilter}
            options={["Pending", "Approved", "Rejected", "All"]}
            onRefresh={fetchExtensions}
          />
          {loadingExt ? (
            <TableLoader />
          ) : extensions.length === 0 ? (
            <TableEmpty label="extension requests" />
          ) : (
            <div className="overflow-x-auto rounded-lg">
              <table className="w-full min-w-[960px] text-[13px]">
                <thead>
                  <tr className="border-b border-[var(--border)]">
                    {[
                      "Ticket",
                      "Employee",
                      "Book",
                      "+Days",
                      "Reason",
                      "Current Due",
                      "New Due",
                      "Status",
                      "Actions",
                    ].map((h) => (
                      <th
                        key={h}
                        className="text-left py-3 pr-4 text-[11px] font-bold uppercase tracking-wider text-[#94a3b8] dark:text-white/40"
                      >
                        {h}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {extensions.map((e) => (
                    <tr
                      key={e.id}
                      className="border-b border-[var(--border)]/50 hover:bg-white/[0.02] transition-colors"
                    >
                      <td className="py-3.5 pr-4 font-mono text-[12px] text-primary">
                        {e.ticket_id}
                      </td>
                      <td className="py-3.5 pr-4">
                        <div className="font-medium text-foreground">{e.employee_name}</div>
                        <div className="text-[11px] text-muted-foreground">{e.employee_email}</div>
                      </td>
                      <td className="py-3.5 pr-4">
                        <div className="font-medium text-foreground">{e.book_title}</div>
                        {e.book_author && (
                          <div className="text-[11px] text-muted-foreground">{e.book_author}</div>
                        )}
                      </td>
                      <td className="py-3.5 pr-4 font-semibold">+{e.additional_days}</td>
                      <td className="py-3.5 pr-4 text-foreground/70 max-w-[180px]">
                        <p className="line-clamp-2 leading-snug" title={e.reason}>
                          {e.reason || "—"}
                        </p>
                      </td>
                      <td className="py-3.5 pr-4 text-foreground/60 whitespace-nowrap text-[12px]">
                        {e.current_due_date || "—"}
                      </td>
                      <td className="py-3.5 pr-4 text-foreground/60 whitespace-nowrap text-[12px]">
                        {e.new_due_date || "—"}
                      </td>
                      <td className="py-3.5 pr-4">
                        <StatusBadge status={e.status} />
                      </td>
                      <td className="py-3.5">
                        {actingExt === e.id ? (
                          <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
                        ) : e.status === "Pending" ? (
                          <div className="flex items-center gap-1.5">
                            <button
                              onClick={() => actOnExtension(e.id, "approve")}
                              className="flex items-center gap-1 rounded-lg px-2.5 py-1.5 text-[12px] font-medium bg-emerald-500/10 text-emerald-400 hover:bg-emerald-500/20 transition-colors"
                            >
                              <Check className="h-3.5 w-3.5" /> Approve
                            </button>
                            <button
                              onClick={() => actOnExtension(e.id, "reject")}
                              className="flex items-center gap-1 rounded-lg px-2.5 py-1.5 text-[12px] font-medium bg-rose-500/10 text-rose-400 hover:bg-rose-500/20 transition-colors"
                            >
                              <X className="h-3.5 w-3.5" /> Reject
                            </button>
                          </div>
                        ) : (
                          <span className="text-[11px] text-muted-foreground">—</span>
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

      {/* ── Assignments — flat Book | Employee | Issue Date | Due Date | Status view ── */}
      {view === "assignments" &&
        (loadingDash ? (
          <TableLoader />
        ) : !dashboard ? (
          <TableEmpty label="assignments" />
        ) : (dashboard.assignment_list || []).length === 0 ? (
          <TableEmpty label="active assignments" />
        ) : (
          <div className="overflow-x-auto rounded-lg">
            <table className="w-full min-w-[900px] text-[13px]">
              <thead>
                <tr className="border-b border-[var(--border)]">
                  {["Book", "Employee", "Ticket", "Copy", "Issue Date", "Due Date", "Status"].map(
                    (h) => (
                      <th
                        key={h}
                        className="text-left py-3 pr-4 text-[11px] font-bold uppercase tracking-wider text-[#94a3b8] dark:text-white/40"
                      >
                        {h}
                      </th>
                    ),
                  )}
                </tr>
              </thead>
              <tbody>
                {(dashboard.assignment_list || []).map((a) => (
                  <tr
                    key={a.ticket_id}
                    className="border-b border-[var(--border)]/50 hover:bg-white/[0.02] transition-colors"
                  >
                    <td className="py-3.5 pr-4">
                      <div className="font-medium text-foreground">{a.book_title}</div>
                      {a.book_author && (
                        <div className="text-[11px] text-muted-foreground">{a.book_author}</div>
                      )}
                    </td>
                    <td className="py-3.5 pr-4">
                      <div className="font-medium text-foreground">{a.employee_name}</div>
                      <div className="text-[11px] text-muted-foreground">{a.employee_email}</div>
                    </td>
                    <td className="py-3.5 pr-4 font-mono text-[12px] text-primary">
                      {a.ticket_id}
                    </td>
                    <td className="py-3.5 pr-4 text-foreground/70">#{a.copy_number}</td>
                    <td className="py-3.5 pr-4 text-foreground/60 whitespace-nowrap text-[12px]">
                      {a.issued_at ? a.issued_at.slice(0, 10) : "—"}
                    </td>
                    <td className="py-3.5 pr-4 text-foreground/60 whitespace-nowrap text-[12px]">
                      {a.due_date}
                    </td>
                    <td className="py-3.5 pr-4">
                      <StatusBadge status={a.status} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ))}

      {/* ── Borrow Requests ── */}
      {view === "requests" && (
        <>
          <FilterBar
            filter={reqFilter}
            setFilter={setReqFilter}
            options={["Pending", "Approved", "Rejected", "Returned", "All"]}
            onRefresh={fetchRequests}
          />
          {loadingReq ? (
            <TableLoader />
          ) : requests.length === 0 ? (
            <TableEmpty label="book requests" />
          ) : (
            <div className="overflow-x-auto rounded-lg">
              <table className="w-full min-w-[960px] text-[13px]">
                <thead>
                  <tr className="border-b border-[var(--border)]">
                    {[
                      "Ticket",
                      "Employee",
                      "Book",
                      "Notes",
                      "Status",
                      "Due Date",
                      "Requested",
                      "Actions",
                    ].map((h) => (
                      <th
                        key={h}
                        className="text-left py-3 pr-4 text-[11px] font-bold uppercase tracking-wider text-[#94a3b8] dark:text-white/40"
                      >
                        {h}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {requests.map((r) => (
                    <tr
                      key={r.id}
                      className="border-b border-[var(--border)]/50 hover:bg-white/[0.02] transition-colors"
                    >
                      <td className="py-3.5 pr-4 font-mono text-[12px] text-primary">
                        {r.ticket_id}
                      </td>
                      <td className="py-3.5 pr-4">
                        <div className="font-medium text-foreground">{r.employee_name}</div>
                        <div className="text-[11px] text-muted-foreground">{r.employee_email}</div>
                      </td>
                      <td className="py-3.5 pr-4">
                        <div className="font-medium text-foreground">{r.book_title}</div>
                        {r.book_author && (
                          <div className="text-[11px] text-muted-foreground">{r.book_author}</div>
                        )}
                      </td>
                      <td className="py-3.5 pr-4 text-foreground/70 max-w-[160px]">
                        <p className="line-clamp-2 leading-snug" title={r.notes}>
                          {r.notes || "—"}
                        </p>
                      </td>
                      <td className="py-3.5 pr-4">
                        <StatusBadge status={r.status} />
                        {r.admin_remarks && (
                          <div className="text-[11px] text-muted-foreground mt-0.5">
                            {r.admin_remarks}
                          </div>
                        )}
                      </td>
                      <td className="py-3.5 pr-4 text-foreground/60 whitespace-nowrap text-[12px]">
                        {r.due_date || "—"}
                      </td>
                      <td className="py-3.5 pr-4 text-foreground/50 whitespace-nowrap">
                        {r.requested_at.slice(0, 10)}
                      </td>
                      <td className="py-3.5">
                        {acting === r.id ? (
                          <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
                        ) : !canManage ? (
                          <span className="text-muted-foreground/40 text-[12px]">View only</span>
                        ) : r.status === "Pending" ? (
                          <div className="flex items-center gap-1.5">
                            <button
                              onClick={() => actOnRequest(r.id, "approve")}
                              className="flex items-center gap-1 rounded-lg px-2.5 py-1.5 text-[12px] font-medium bg-emerald-500/10 text-emerald-400 hover:bg-emerald-500/20 transition-colors"
                            >
                              <Check className="h-3 w-3" /> Approve
                            </button>
                            <button
                              onClick={() => actOnRequest(r.id, "reject")}
                              className="flex items-center gap-1 rounded-lg px-2.5 py-1.5 text-[12px] font-medium bg-rose-500/10 text-rose-400 hover:bg-rose-500/20 transition-colors"
                            >
                              <X className="h-3 w-3" /> Reject
                            </button>
                          </div>
                        ) : r.status === "Approved" ? (
                          <button
                            onClick={() => actOnRequest(r.id, "return")}
                            className="flex items-center gap-1 rounded-lg px-2.5 py-1.5 text-[12px] font-medium bg-violet-500/10 text-violet-400 hover:bg-violet-500/20 transition-colors"
                          >
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
              <h3 className="text-[14px] font-semibold text-foreground mb-4">
                Add New Book to Nexus Library
              </h3>
              <div className="grid grid-cols-2 gap-3">
                {[
                  { label: "Title *", key: "title", placeholder: "e.g. Clean Code" },
                  { label: "Author", key: "author", placeholder: "e.g. Robert C. Martin" },
                  { label: "Category", key: "category", placeholder: "Technology, Management…" },
                ].map(({ label, key, placeholder }) => (
                  <div key={key}>
                    <label className="block text-[11px] font-semibold uppercase tracking-wider text-muted-foreground/60 mb-1">
                      {label}
                    </label>
                    <input
                      type="text"
                      placeholder={placeholder}
                      value={(bookForm as Record<string, string | number>)[key] as string}
                      onChange={(e) => setBookForm((p) => ({ ...p, [key]: e.target.value }))}
                      className="w-full rounded-lg border border-[var(--border)] bg-secondary/50 px-3 py-1.5 text-[13px] text-foreground outline-none focus:border-primary/50"
                    />
                  </div>
                ))}
                <div>
                  <label className="block text-[11px] font-semibold uppercase tracking-wider text-muted-foreground/60 mb-1">
                    Total Copies
                  </label>
                  <input
                    type="number"
                    min={1}
                    value={bookForm.total_copies}
                    onChange={(e) =>
                      setBookForm((p) => ({ ...p, total_copies: parseInt(e.target.value) || 1 }))
                    }
                    className="w-full rounded-lg border border-[var(--border)] bg-secondary/50 px-3 py-1.5 text-[13px] text-foreground outline-none focus:border-primary/50"
                  />
                </div>
                <div className="col-span-2">
                  <label className="block text-[11px] font-semibold uppercase tracking-wider text-muted-foreground/60 mb-1">
                    Description
                  </label>
                  <textarea
                    placeholder="Brief description…"
                    value={bookForm.description}
                    onChange={(e) => setBookForm((p) => ({ ...p, description: e.target.value }))}
                    rows={2}
                    className="w-full rounded-lg border border-[var(--border)] bg-secondary/50 px-3 py-1.5 text-[13px] text-foreground outline-none focus:border-primary/50 resize-none"
                  />
                </div>
              </div>
              <div className="flex gap-2 mt-4">
                <button
                  onClick={saveBook}
                  disabled={savingBook}
                  className="flex items-center gap-1.5 rounded-lg px-4 py-1.5 text-[13px] font-medium bg-primary/10 text-primary hover:bg-primary/20 transition-colors disabled:opacity-50"
                >
                  {savingBook ? (
                    <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  ) : (
                    <Check className="h-3.5 w-3.5" />
                  )}{" "}
                  Add Book
                </button>
                <button
                  onClick={() => setShowBookForm(false)}
                  className="rounded-lg px-4 py-1.5 text-[13px] text-muted-foreground hover:bg-secondary transition-colors"
                >
                  Cancel
                </button>
              </div>
            </div>
          )}

          {loadingBooks ? (
            <TableLoader />
          ) : books.length === 0 ? (
            <TableEmpty label="books" />
          ) : (
            <div className="space-y-2">
              {books.map((b) => (
                <div
                  key={b.id}
                  className="rounded-xl border border-[var(--border)] bg-card overflow-hidden"
                >
                  {/* Book row */}
                  <div
                    className="flex items-center gap-4 px-4 py-3 cursor-pointer hover:bg-white/[0.02] transition-colors"
                    onClick={() => {
                      if (expandedBook === b.id) {
                        setExpandedBook(null);
                      } else {
                        setExpandedBook(b.id);
                        fetchBookCopies(b.id);
                      }
                    }}
                  >
                    <ChevronDown
                      className={cn(
                        "h-4 w-4 text-muted-foreground shrink-0 transition-transform",
                        expandedBook === b.id && "rotate-180",
                      )}
                    />
                    <div className="flex-1 min-w-0">
                      <span className="font-medium text-foreground text-[13px]">{b.title}</span>
                      {b.author && (
                        <span className="text-muted-foreground text-[12px] ml-2">
                          by {b.author}
                        </span>
                      )}
                      {b.category && (
                        <span className="ml-2 rounded-full bg-secondary px-2 py-0.5 text-[11px] text-muted-foreground">
                          {b.category}
                        </span>
                      )}
                    </div>
                    <div className="flex items-center gap-4 text-[12px] shrink-0">
                      <span className="text-emerald-400 font-medium">
                        {b.available_copies} avail
                      </span>
                      <span className="text-blue-400">{b.issued_copies} issued</span>
                      {b.reserved_copies > 0 && (
                        <span className="text-amber-400">{b.reserved_copies} reserved</span>
                      )}
                      {b.lost_copies > 0 && (
                        <span className="text-rose-400">{b.lost_copies} lost</span>
                      )}
                      {b.damaged_copies > 0 && (
                        <span className="text-orange-400">{b.damaged_copies} damaged</span>
                      )}
                      <span className="text-muted-foreground/50">/ {b.total_copies} total</span>
                    </div>
                  </div>

                  {/* Copies detail */}
                  {expandedBook === b.id && (
                    <div className="border-t border-[var(--border)] px-4 py-3 bg-secondary/20">
                      <p className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground/60 mb-2">
                        Individual Copies
                      </p>
                      {!b.copies ? (
                        <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
                      ) : (
                        <div className="flex flex-wrap gap-2">
                          {b.copies.map((c) => (
                            <div
                              key={c.id}
                              className="rounded-lg border border-[var(--border)] bg-card px-3 py-2 text-[12px] min-w-[160px]"
                            >
                              <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 mb-1">
                                <span className="font-semibold text-foreground">
                                  Copy #{c.copy_number}
                                </span>
                                <span
                                  className={cn(
                                    "font-medium",
                                    COPY_STATUS_COLORS[c.status] ?? "text-zinc-400",
                                  )}
                                >
                                  {c.status}
                                </span>
                              </div>
                              {c.current_employee_name && (
                                <div className="text-muted-foreground text-[11px]">
                                  {c.current_employee_name}
                                </div>
                              )}
                              {c.due_date && (
                                <div className="text-muted-foreground text-[11px]">
                                  Due: {c.due_date}
                                </div>
                              )}
                              {c.status === "Available" && (
                                <div className="flex gap-1 mt-1.5">
                                  <button
                                    onClick={() => actOnCopy(c.id, "lost", b.id)}
                                    className="rounded px-1.5 py-0.5 text-[11px] bg-rose-500/10 text-rose-400 hover:bg-rose-500/20 transition-colors"
                                  >
                                    Lost
                                  </button>
                                  <button
                                    onClick={() => actOnCopy(c.id, "damaged", b.id)}
                                    className="rounded px-1.5 py-0.5 text-[11px] bg-orange-500/10 text-orange-400 hover:bg-orange-500/20 transition-colors"
                                  >
                                    Damaged
                                  </button>
                                </div>
                              )}
                              {(c.status === "Lost" || c.status === "Damaged") && (
                                <button
                                  onClick={() => actOnCopy(c.id, "restore", b.id)}
                                  className="mt-1.5 rounded px-1.5 py-0.5 text-[11px] bg-emerald-500/10 text-emerald-400 hover:bg-emerald-500/20 transition-colors"
                                >
                                  Restore
                                </button>
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

// ── Desk Keys Tab ──────────────────────────────────────────────────────────────

interface DeskKey {
  id: number;
  employee_name: string;
  employee_email: string;
  desk_number: string;
  reason: string;
  status: string;
  decided_by: string;
  decision_reason: string;
  created_at: string | null;
}

function DeskKeysTab({
  authHeaders,
  canManage,
}: {
  authHeaders: Record<string, string>;
  canManage: boolean;
}) {
  const [items, setItems] = useState<DeskKey[]>([]);
  const [loading, setLoading] = useState(true);
  const [acting, setActing] = useState<number | null>(null);
  const [filter, setFilter] = useState("Pending");

  const [rejectId, setRejectId] = useState<number | null>(null);
  const [rejectReason, setRejectReason] = useState("");
  const [rejectDialogOpen, setRejectDialogOpen] = useState(false);

  const fetch_ = useCallback(async () => {
    setLoading(true);
    try {
      const qs = filter !== "All" ? `?status=${filter}` : "";
      const res = await fetch(`/api/portal/admin/desk-keys${qs}`, { headers: authHeaders });
      setItems(await res.json());
    } catch {
      toast.error("Failed to load");
    } finally {
      setLoading(false);
    }
  }, [filter]);

  useEffect(() => {
    fetch_();
  }, [fetch_]);

  const act = async (id: number, action: "approve" | "reject" | "release", reason?: string) => {
    let body: string | undefined;
    if (action === "reject") {
      if (!reason) return;
      body = JSON.stringify({ reason });
    }
    setActing(id);
    try {
      const res = await fetch(`/api/portal/admin/desk-keys/${id}/${action}`, {
        method: "PUT",
        headers: authHeaders,
        body,
      });
      if (!res.ok) throw new Error((await res.json().catch(() => ({}))).detail || "Failed");
      if (action === "approve") flyBanner("Desk key issued");
      else toast.success(action === "reject" ? "Request rejected" : "Desk released");
      setRejectDialogOpen(false);
      fetch_();
    } catch (e: unknown) {
      toast.error(e instanceof Error ? e.message : "Failed");
    } finally {
      setActing(null);
    }
  };

  return (
    <div>
      <FilterBar
        filter={filter}
        setFilter={setFilter}
        options={["Pending", "Approved", "Rejected", "Auto-Rejected", "Released", "All"]}
        onRefresh={fetch_}
      />
      {loading ? (
        <TableLoader />
      ) : items.length === 0 ? (
        <TableEmpty label="desk key requests" />
      ) : (
        <table className="w-full text-[13px]">
          <thead>
            <tr className="border-b border-[var(--border)]">
              {["Employee", "Desk", "Reason", "Status", "Actions"].map((h) => (
                <th
                  key={h}
                  className="text-left py-3 pr-4 text-[11px] font-bold uppercase tracking-wider text-[#94a3b8] dark:text-white/40"
                >
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {items.map((d) => (
              <tr
                key={d.id}
                className="border-b border-[var(--border)]/50 hover:bg-white/[0.02] transition-colors"
              >
                <td className="py-3.5 pr-4">
                  <div className="font-medium text-foreground">{d.employee_name}</div>
                  <div className="text-[11px] text-muted-foreground">{d.employee_email}</div>
                </td>
                <td className="py-3.5 pr-4 font-mono text-foreground/90">{d.desk_number}</td>
                <td className="py-3.5 pr-4 text-foreground/70 max-w-[260px]">
                  {d.reason || d.decision_reason || "—"}
                </td>
                <td className="py-3.5 pr-4">
                  <StatusBadge status={d.status} />
                </td>
                <td className="py-3.5">
                  {!canManage ? (
                    <span className="text-muted-foreground/40 text-[12px]">View only</span>
                  ) : d.status === "Pending" ? (
                    <ActionButtons
                      id={d.id}
                      acting={acting}
                      onApprove={() => act(d.id, "approve")}
                      onReject={() => {
                        setRejectId(d.id);
                        setRejectReason("");
                        setRejectDialogOpen(true);
                      }}
                    />
                  ) : d.status === "Approved" ? (
                    <button
                      onClick={() => act(d.id, "release")}
                      disabled={acting === d.id}
                      className="flex items-center gap-1 rounded-lg px-2.5 py-1.5 text-[12px] font-medium bg-zinc-500/10 text-zinc-400 hover:bg-zinc-500/20 transition-colors disabled:opacity-50"
                    >
                      {acting === d.id ? (
                        <Loader2 className="h-3 w-3 animate-spin" />
                      ) : (
                        <X className="h-3 w-3" />
                      )}
                      Release
                    </button>
                  ) : (
                    <span className="text-muted-foreground/40 text-[12px]">—</span>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      <Dialog open={rejectDialogOpen} onOpenChange={setRejectDialogOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Reject Desk Key Request</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <label className="text-xs font-medium text-muted-foreground block">
              Reason for rejecting this desk key request *
              <textarea
                value={rejectReason}
                onChange={(e) => setRejectReason(e.target.value)}
                rows={3}
                placeholder="Enter reason..."
                className="mt-1 w-full rounded-xl border border-border bg-background px-3 py-2 text-sm text-foreground resize-none focus:outline-none focus:ring-1 focus:ring-primary"
              />
            </label>
          </div>
          <DialogFooter className="flex gap-2">
            <Button variant="outline" size="sm" onClick={() => setRejectDialogOpen(false)}>
              Cancel
            </Button>
            <Button
              size="sm"
              disabled={!rejectReason.trim() || acting === rejectId}
              onClick={() => {
                if (rejectId) {
                  act(rejectId, "reject", rejectReason.trim());
                }
              }}
            >
              {acting === rejectId && <Loader2 className="h-3.5 w-3.5 animate-spin mr-1.5" />}
              Reject Request
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

// ── Parking Dues Tab ─────────────────────────────────────────────────────────

interface ParkingDuePayment {
  id: number;
  month: string;
  amount_due: number;
  amount_paid: number;
  status: string;
}
interface ParkingDueHolder {
  employee_name: string;
  employee_email: string;
  vehicle_type: string;
  vehicle_number: string;
  outstanding: number;
  monthly_cost: number;
  payments: ParkingDuePayment[];
}
interface ParkingDuesSettings {
  two_wheeler_cost: number;
  four_wheeler_cost: number;
  cadence: string;
  last_run: string;
}

function ParkingDuesTab({
  authHeaders,
  canManage,
}: {
  authHeaders: Record<string, string>;
  canManage: boolean;
}) {
  const [holders, setHolders] = useState<ParkingDueHolder[]>([]);
  const [settings, setSettings] = useState<ParkingDuesSettings | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [acting, setActing] = useState<string | null>(null);
  const [expanded, setExpanded] = useState<string | null>(null);
  const [twoW, setTwoW] = useState("");
  const [fourW, setFourW] = useState("");
  const [cadence, setCadence] = useState("monthly");

  const fetch_ = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch(`/api/portal/admin/parking-dues`, { headers: authHeaders });
      const data = await res.json();
      setHolders(data.holders ?? []);
      setSettings(data.settings ?? null);
      setTwoW(String(data.settings?.two_wheeler_cost ?? ""));
      setFourW(String(data.settings?.four_wheeler_cost ?? ""));
      setCadence(data.settings?.cadence ?? "monthly");
    } catch {
      toast.error("Failed to load");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetch_();
  }, [fetch_]);

  const saveSettings = async () => {
    setSaving(true);
    try {
      const res = await fetch(`/api/portal/admin/parking-dues/settings`, {
        method: "PUT",
        headers: authHeaders,
        body: JSON.stringify({
          two_wheeler_cost: parseFloat(twoW) || 0,
          four_wheeler_cost: parseFloat(fourW) || 0,
          cadence,
        }),
      });
      if (!res.ok) throw new Error("Failed");
      toast.success("Settings saved");
      fetch_();
    } catch {
      toast.error("Failed to save settings");
    } finally {
      setSaving(false);
    }
  };

  const remind = async (email?: string) => {
    setActing(email ?? "ALL");
    try {
      const res = await fetch(`/api/portal/admin/parking-dues/remind`, {
        method: "POST",
        headers: authHeaders,
        body: JSON.stringify({ email: email ?? null }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.detail || "Failed");
      flyBanner(data.message || "Reminder sent");
    } catch (e: unknown) {
      toast.error(e instanceof Error ? e.message : "Failed");
    } finally {
      setActing(null);
    }
  };

  const markPaid = async (paymentId: number) => {
    setActing(`p${paymentId}`);
    try {
      const res = await fetch(`/api/portal/admin/parking-dues/${paymentId}/paid`, {
        method: "PUT",
        headers: authHeaders,
      });
      if (!res.ok) throw new Error("Failed");
      toast.success("Marked paid");
      fetch_();
    } catch {
      toast.error("Failed");
    } finally {
      setActing(null);
    }
  };

  const closeMonth = async (paymentId: number) => {
    setActing(`c${paymentId}`);
    try {
      const res = await fetch(`/api/portal/admin/parking-dues/${paymentId}/close`, {
        method: "PUT",
        headers: authHeaders,
      });
      if (!res.ok) throw new Error("Failed");
      toast.success("Month closed");
      fetch_();
    } catch {
      toast.error("Failed");
    } finally {
      setActing(null);
    }
  };

  const payFull = async (email: string) => {
    setActing(`full${email}`);
    try {
      const res = await fetch(
        `/api/portal/admin/parking-dues/${encodeURIComponent(email)}/pay-full`,
        { method: "POST", headers: authHeaders },
      );
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.detail || "Failed");
      flyBanner(data.message || "Settled");
      fetch_();
    } catch (e: unknown) {
      toast.error(e instanceof Error ? e.message : "Failed");
    } finally {
      setActing(null);
    }
  };

  return (
    <div className="space-y-6">
      {/* Settings card */}
      <div className="rounded-2xl border border-[var(--border)] bg-card p-5">
        <h3 className="text-[14px] font-semibold text-foreground mb-1">
          Parking Charges & Reminders
        </h3>
        <p className="text-[12px] text-muted-foreground/70 mb-4">
          These are the official monthly parking charges — quoted to employees when they ask the
          assistant, and billed automatically per active sticker on the cadence below.
        </p>
        <div className="flex flex-wrap items-end gap-4">
          <div>
            <label className="block text-[11px] font-semibold uppercase tracking-wider text-muted-foreground/60 mb-1.5">
              2-Wheeler / month (INR)
            </label>
            <input
              type="number"
              value={twoW}
              onChange={(e) => setTwoW(e.target.value)}
              className="w-36 rounded-lg border border-[var(--border)] bg-secondary/50 px-3 py-2 text-[13px] text-foreground outline-none focus:border-primary/50"
            />
          </div>
          <div>
            <label className="block text-[11px] font-semibold uppercase tracking-wider text-muted-foreground/60 mb-1.5">
              4-Wheeler / month (INR)
            </label>
            <input
              type="number"
              value={fourW}
              onChange={(e) => setFourW(e.target.value)}
              className="w-36 rounded-lg border border-[var(--border)] bg-secondary/50 px-3 py-2 text-[13px] text-foreground outline-none focus:border-primary/50"
            />
          </div>
          <div>
            <label className="block text-[11px] font-semibold uppercase tracking-wider text-muted-foreground/60 mb-1.5">
              Reminder cadence
            </label>
            <select
              value={cadence}
              onChange={(e) => setCadence(e.target.value)}
              className="rounded-lg border border-[var(--border)] bg-secondary/50 px-3 py-2 text-[13px] text-foreground outline-none focus:border-primary/50"
            >
              <option value="weekly">Weekly</option>
              <option value="monthly">Monthly</option>
              <option value="quarterly">Quarterly</option>
            </select>
          </div>
          {canManage && (
            <>
              <button
                onClick={saveSettings}
                disabled={saving}
                className="flex items-center gap-1.5 rounded-lg px-4 py-2 text-[13px] font-medium bg-primary/10 text-primary hover:bg-primary/20 transition-colors disabled:opacity-50"
              >
                {saving ? (
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                ) : (
                  <Save className="h-3.5 w-3.5" />
                )}
                Save
              </button>
              <button
                onClick={() => remind()}
                disabled={acting === "ALL"}
                className="flex items-center gap-1.5 rounded-lg px-4 py-2 text-[13px] font-medium bg-amber-500/10 text-amber-400 hover:bg-amber-500/20 transition-colors disabled:opacity-50"
              >
                {acting === "ALL" ? (
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                ) : (
                  <Send className="h-3.5 w-3.5" />
                )}
                Send reminders to all
              </button>
            </>
          )}
        </div>
        {settings?.last_run && (
          <p className="text-[11px] text-muted-foreground/60 mt-3">
            Last reminder run: {settings.last_run}
          </p>
        )}
      </div>

      {/* Holders */}
      {loading ? (
        <TableLoader />
      ) : holders.length === 0 ? (
        <TableEmpty label="parking holders" />
      ) : (
        <div className="space-y-2">
          {holders.map((h) => {
            const open = expanded === h.employee_email;
            return (
              <div
                key={h.employee_email}
                className="rounded-xl border border-[var(--border)] bg-card overflow-hidden"
              >
                <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 px-4 py-3">
                  <button
                    onClick={() => setExpanded(open ? null : h.employee_email)}
                    className="flex items-center gap-3 text-left"
                  >
                    <ChevronDown
                      className={cn(
                        "h-4 w-4 text-muted-foreground transition-transform",
                        open && "rotate-180",
                      )}
                    />
                    <div>
                      <div className="font-medium text-foreground">{h.employee_name}</div>
                      <div className="text-[11px] text-muted-foreground">
                        {h.vehicle_number} · {h.vehicle_type} · INR{" "}
                        {h.monthly_cost.toLocaleString()}/mo
                      </div>
                    </div>
                  </button>
                  <div className="flex items-center gap-3">
                    <span
                      className={cn(
                        "text-[13px] font-semibold",
                        h.outstanding > 0 ? "text-rose-400" : "text-emerald-400",
                      )}
                    >
                      INR {h.outstanding.toLocaleString()} {h.outstanding > 0 ? "due" : "clear"}
                    </span>
                    {h.outstanding > 0 && canManage && (
                      <>
                        <button
                          onClick={() => remind(h.employee_email)}
                          disabled={acting === h.employee_email}
                          className="flex items-center gap-1 rounded-lg px-2.5 py-1.5 text-[12px] font-medium bg-amber-500/10 text-amber-400 hover:bg-amber-500/20 transition-colors disabled:opacity-50"
                        >
                          {acting === h.employee_email ? (
                            <Loader2 className="h-3 w-3 animate-spin" />
                          ) : (
                            <Send className="h-3 w-3" />
                          )}
                          Remind
                        </button>
                        <button
                          onClick={() => payFull(h.employee_email)}
                          disabled={acting === `full${h.employee_email}`}
                          className="flex items-center gap-1 rounded-lg px-2.5 py-1.5 text-[12px] font-medium bg-emerald-500/10 text-emerald-400 hover:bg-emerald-500/20 transition-colors disabled:opacity-50"
                        >
                          {acting === `full${h.employee_email}` ? (
                            <Loader2 className="h-3 w-3 animate-spin" />
                          ) : (
                            <Check className="h-3 w-3" />
                          )}
                          Mark full paid
                        </button>
                      </>
                    )}
                  </div>
                </div>
                {open && (
                  <div className="border-t border-[var(--border)]/60 px-4 py-3">
                    {h.payments.length === 0 ? (
                      <p className="text-[12px] text-muted-foreground">No charges accrued yet.</p>
                    ) : (
                      <table className="w-full text-[12px]">
                        <thead>
                          <tr className="text-left text-[11px] font-bold uppercase tracking-wider text-[#94a3b8] dark:text-white/40">
                            <th className="py-1.5 pr-4">Month</th>
                            <th className="py-1.5 pr-4">Amount</th>
                            <th className="py-1.5 pr-4">Status</th>
                            <th className="py-1.5">Actions</th>
                          </tr>
                        </thead>
                        <tbody>
                          {h.payments.map((p) => (
                            <tr key={p.id} className="border-t border-[var(--border)]/40">
                              <td className="py-2 pr-4 text-foreground/90">{p.month}</td>
                              <td className="py-2 pr-4 text-foreground/80">
                                INR {p.amount_due.toLocaleString()}
                              </td>
                              <td className="py-2 pr-4">
                                <StatusBadge status={p.status} />
                              </td>
                              <td className="py-2">
                                {p.status === "Due" && canManage ? (
                                  <div className="flex items-center gap-1.5">
                                    <button
                                      onClick={() => markPaid(p.id)}
                                      disabled={acting === `p${p.id}`}
                                      className="flex items-center gap-1 rounded-lg px-2 py-1 text-[11px] font-medium bg-emerald-500/10 text-emerald-400 hover:bg-emerald-500/20 transition-colors disabled:opacity-50"
                                    >
                                      {acting === `p${p.id}` ? (
                                        <Loader2 className="h-3 w-3 animate-spin" />
                                      ) : (
                                        <Check className="h-3 w-3" />
                                      )}
                                      Paid
                                    </button>
                                    <button
                                      onClick={() => closeMonth(p.id)}
                                      disabled={acting === `c${p.id}`}
                                      className="flex items-center gap-1 rounded-lg px-2 py-1 text-[11px] font-medium bg-zinc-500/10 text-zinc-400 hover:bg-zinc-500/20 transition-colors disabled:opacity-50"
                                    >
                                      Close
                                    </button>
                                  </div>
                                ) : (
                                  <span className="text-muted-foreground/40">—</span>
                                )}
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

function ActionButtons({
  id,
  acting,
  onApprove,
  onReject,
}: {
  id: number;
  acting: number | null;
  onApprove: () => void;
  onReject: () => void;
}) {
  return (
    <div className="flex items-center gap-2">
      <button
        onClick={onApprove}
        disabled={acting === id}
        className="flex items-center gap-1 rounded-lg px-3 py-1.5 text-[12px] font-medium text-emerald-600 dark:text-emerald-400 hover:bg-emerald-500/10 transition-colors disabled:opacity-50"
      >
        {acting === id ? (
          <Loader2 className="h-3 w-3 animate-spin" />
        ) : (
          <Check className="h-3.5 w-3.5" />
        )}
        Approve
      </button>
      <button
        onClick={onReject}
        disabled={acting === id}
        className="flex items-center gap-1 rounded-lg px-3 py-1.5 text-[12px] font-medium text-rose-600 dark:text-rose-400 hover:bg-rose-500/10 transition-colors disabled:opacity-50"
      >
        <X className="h-3.5 w-3.5" />
        Reject
      </button>
    </div>
  );
}

// ── Travel Tab ─────────────────────────────────────────────────────────────────

const TRAVEL_STATUS_BADGE: Record<string, string> = {
  pending_rm: "bg-amber-500/10 text-amber-600 dark:text-amber-400 border border-amber-500/20",
  rm_approved: "bg-blue-500/10 text-blue-600 dark:text-blue-400 border border-blue-500/20",
  rm_rejected: "bg-rose-500/10 text-rose-600 dark:text-rose-400 border border-rose-500/20",
  admin_approved:
    "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border border-emerald-500/20",
  admin_rejected: "bg-rose-500/10 text-rose-600 dark:text-rose-400 border border-rose-500/20",
  completed: "bg-zinc-500/10 text-zinc-500 dark:text-zinc-400 border border-zinc-500/20",
};

const EXPENSE_STATUS_BADGE: Record<string, string> = {
  Pending: "bg-amber-500/10 text-amber-600 dark:text-amber-400 border border-amber-500/20",
  Approved: "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border border-emerald-500/20",
  Rejected: "bg-rose-500/10 text-rose-600 dark:text-rose-400 border border-rose-500/20",
};

const TRAVEL_STATUS_LABEL: Record<string, string> = {
  pending_rm: "Pending RM Approval",
  rm_approved: "RM Approved — Pending Admin",
  rm_rejected: "Rejected by RM",
  admin_approved: "Approved",
  admin_rejected: "Rejected by Admin",
  completed: "Completed",
};

type TravelSubTab = "requests" | "expenses" | "settings";

function TravelTab({
  authHeaders,
  canApprove,
  canSettings,
}: {
  authHeaders: Record<string, string>;
  canApprove: boolean;
  canSettings: boolean;
}) {
  const [sub, setSub] = useState<TravelSubTab>("requests");

  return (
    <div className="space-y-4">
      <div className="flex gap-2 mb-4">
        {(["requests", "expenses", "settings"] as TravelSubTab[]).map((s) => {
          if (s === "settings" && !canSettings) return null;
          const labels: Record<TravelSubTab, string> = {
            requests: "Travel Requests",
            expenses: "Expense Claims",
            settings: "Settings",
          };
          const icons: Record<TravelSubTab, React.ReactElement> = {
            requests: <Plane className="h-3.5 w-3.5" />,
            expenses: <FileText className="h-3.5 w-3.5" />,
            settings: <Settings2 className="h-3.5 w-3.5" />,
          };
          return (
            <button
              key={s}
              onClick={() => setSub(s)}
              className={cn(
                "flex items-center gap-1.5 px-3 py-1.5 rounded-full text-[12px] font-semibold transition-all",
                sub === s
                  ? "bg-[#00a29a] text-white"
                  : "bg-white dark:bg-card border border-[#e2e8f0] dark:border-white/[0.08] text-[#64748b] dark:text-white/50 hover:text-[#0f172a] dark:hover:text-white",
              )}
            >
              {icons[s]}
              {labels[s]}
            </button>
          );
        })}
      </div>
      {sub === "requests" && (
        <TravelRequestsSubTab authHeaders={authHeaders} canApprove={canApprove} />
      )}
      {sub === "expenses" && (
        <TravelExpensesSubTab authHeaders={authHeaders} canApprove={canApprove} />
      )}
      {sub === "settings" && <TravelSettingsSubTab authHeaders={authHeaders} />}
    </div>
  );
}

const CURRENCIES = ["INR", "USD", "EUR", "GBP", "AED", "SGD", "JPY", "CAD", "AUD"];

type TravelRequest = {
  id: number;
  ref_id: string;
  employee_name: string;
  employee_email: string;
  from_location: string;
  to_destination: string;
  travel_date: string;
  return_date?: string;
  is_international: boolean;
  visa_required: boolean;
  mode_of_travel: string;
  accommodation_required: boolean;
  estimated_cost?: number;
  business_reason: string;
  notes?: string;
  status: string;
  expense_limit?: number;
  expense_limit_currency?: string;
  ticket_details?: string;
  hotel_details?: string;
  visa_status?: string;
  admin_rejection_reason?: string;
  rm_rejection_reason?: string;
  created_at: string;
};

function TravelRequestsSubTab({
  authHeaders,
  canApprove,
}: {
  authHeaders: Record<string, string>;
  canApprove: boolean;
}) {
  const [items, setItems] = useState<TravelRequest[]>([]);
  const [loading, setLoading] = useState(false);
  const [filter, setFilter] = useState("All");
  const [actingId, setActingId] = useState<number | null>(null);
  const [approveModal, setApproveModal] = useState<TravelRequest | null>(null);
  const [rejectModal, setRejectModal] = useState<{ id: number; ref_id: string } | null>(null);
  const [rejectReason, setRejectReason] = useState("");
  const [approveForm, setApproveForm] = useState({
    expense_limit: "",
    expense_limit_currency: "INR",
    ticket_details: "",
    hotel_details: "",
    visa_status: "",
  });

  const fetch_ = useCallback(async () => {
    setLoading(true);
    try {
      const qs = filter !== "All" ? `?status=${filter}` : "";
      const res = await fetch(`/api/portal/admin/travel${qs}`, { headers: authHeaders });
      const data = await res.json();
      setItems(Array.isArray(data) ? data : []);
      if (!res.ok) toast.error(data?.detail || "Failed to load travel requests");
    } catch {
      toast.error("Failed to load travel requests");
    } finally {
      setLoading(false);
    }
  }, [filter, authHeaders]);

  useEffect(() => {
    fetch_();
  }, [fetch_]);

  const openApprove = (item: TravelRequest) => {
    setApproveForm({
      expense_limit: item.expense_limit ? String(item.expense_limit) : "",
      expense_limit_currency: item.expense_limit_currency || "INR",
      ticket_details: item.ticket_details || "",
      hotel_details: item.hotel_details || "",
      visa_status: item.visa_status || "",
    });
    setApproveModal(item);
  };

  const confirmApprove = async () => {
    if (!approveModal) return;
    setActingId(approveModal.id);
    try {
      const res = await fetch(`/api/portal/admin/travel/${approveModal.id}/approve`, {
        method: "PUT",
        headers: authHeaders,
        body: JSON.stringify({
          expense_limit: approveForm.expense_limit ? parseFloat(approveForm.expense_limit) : null,
          expense_limit_currency: approveForm.expense_limit_currency || "INR",
          ticket_details: approveForm.ticket_details,
          hotel_details: approveForm.hotel_details,
          visa_status: approveForm.visa_status,
        }),
      });
      if (!res.ok) throw new Error((await res.json().catch(() => ({}))).detail || "Failed");
      flyBanner("Travel request approved — employee notified with trip details");
      setApproveModal(null);
      fetch_();
    } catch (e: any) {
      toast.error(e.message || "Failed");
    } finally {
      setActingId(null);
    }
  };

  const confirmReject = async () => {
    if (!rejectModal) return;
    setActingId(rejectModal.id);
    try {
      const res = await fetch(`/api/portal/admin/travel/${rejectModal.id}/reject`, {
        method: "PUT",
        headers: authHeaders,
        body: JSON.stringify({ reason: rejectReason }),
      });
      if (!res.ok) throw new Error((await res.json().catch(() => ({}))).detail || "Failed");
      toast.success("Travel request rejected");
      setRejectModal(null);
      setRejectReason("");
      fetch_();
    } catch (e: any) {
      toast.error(e.message || "Failed");
    } finally {
      setActingId(null);
    }
  };

  const filterOptions = [
    "All",
    "pending_rm",
    "rm_approved",
    "admin_approved",
    "rm_rejected",
    "admin_rejected",
    "completed",
  ];

  return (
    <div>
      <FilterBar filter={filter} setFilter={setFilter} options={filterOptions} onRefresh={fetch_} />
      {loading ? (
        <TableLoader />
      ) : items.length === 0 ? (
        <TableEmpty label="travel requests" />
      ) : (
        <div className="overflow-x-auto rounded-2xl border border-[#e2e8f0] dark:border-white/[0.08] bg-white dark:bg-card">
          <table className="w-full min-w-[1000px] text-[13px]">
            <thead>
              <tr className="border-b border-[#e2e8f0] dark:border-white/[0.08] bg-[#f8fafc] dark:bg-white/[0.02]">
                {["Ref", "Employee", "Route", "Date", "Mode", "Est. Cost", "Status", "Actions"].map(
                  (h) => (
                    <th
                      key={h}
                      className="text-left px-4 py-3 text-[11px] font-bold text-[#64748b] dark:text-white/40 uppercase tracking-wider"
                    >
                      {h}
                    </th>
                  ),
                )}
              </tr>
            </thead>
            <tbody>
              {items.map((item) => (
                <tr
                  key={item.id}
                  className="border-b border-[#f1f5f9] dark:border-white/[0.04] hover:bg-[#f8fafc] dark:hover:bg-white/[0.02] transition-colors"
                >
                  <td className="px-4 py-3 font-mono text-[12px] text-[#94a3b8]">{item.ref_id}</td>
                  <td className="px-4 py-3">
                    <div className="font-semibold text-[#0f172a] dark:text-white">
                      {item.employee_name}
                    </div>
                    <div className="text-[11px] text-[#94a3b8]">{item.employee_email}</div>
                  </td>
                  <td className="px-4 py-3">
                    <div className="font-medium text-[#0f172a] dark:text-white">
                      {item.from_location} → {item.to_destination}
                    </div>
                    {item.is_international && (
                      <span className="text-[10px] bg-violet-100 dark:bg-violet-900/30 text-violet-600 dark:text-violet-400 px-1.5 py-0.5 rounded-full ml-0 mt-0.5 inline-block">
                        International
                      </span>
                    )}
                    <div
                      className="text-[11px] text-[#94a3b8] mt-0.5 max-w-[200px] truncate"
                      title={item.business_reason}
                    >
                      {item.business_reason}
                    </div>
                  </td>
                  <td className="px-4 py-3 whitespace-nowrap">
                    <div>{item.travel_date}</div>
                    {item.return_date && (
                      <div className="text-[11px] text-[#94a3b8]">→ {item.return_date}</div>
                    )}
                  </td>
                  <td className="px-4 py-3">{item.mode_of_travel || "—"}</td>
                  <td className="px-4 py-3">
                    {item.estimated_cost ? `INR ${item.estimated_cost.toLocaleString()}` : "—"}
                    {item.expense_limit && (
                      <div className="text-[11px] text-emerald-600">
                        Limit: {item.expense_limit_currency || "INR"}{" "}
                        {item.expense_limit.toLocaleString()}
                      </div>
                    )}
                  </td>
                  <td className="px-4 py-3">
                    <span
                      className={cn(
                        "px-2 py-1 rounded-full text-[11px] font-semibold",
                        TRAVEL_STATUS_BADGE[item.status] || "bg-zinc-100 text-zinc-500",
                      )}
                    >
                      {TRAVEL_STATUS_LABEL[item.status] || item.status}
                    </span>
                    {(item.rm_rejection_reason || item.admin_rejection_reason) && (
                      <div
                        className="text-[10px] text-rose-500 mt-0.5 max-w-[160px] truncate"
                        title={item.rm_rejection_reason || item.admin_rejection_reason || ""}
                      >
                        {item.rm_rejection_reason || item.admin_rejection_reason}
                      </div>
                    )}
                  </td>
                  <td className="px-4 py-3">
                    {canApprove && item.status === "rm_approved" && (
                      <div className="flex gap-2">
                        <button
                          onClick={() => openApprove(item)}
                          disabled={actingId === item.id}
                          className="flex items-center gap-1 bg-emerald-500 hover:bg-emerald-600 text-white text-[11px] font-semibold px-2.5 py-1.5 rounded-lg transition-colors disabled:opacity-50"
                        >
                          {actingId === item.id ? (
                            <Loader2 className="h-3 w-3 animate-spin" />
                          ) : (
                            <Check className="h-3 w-3" />
                          )}{" "}
                          Approve
                        </button>
                        <button
                          onClick={() => {
                            setRejectModal({ id: item.id, ref_id: item.ref_id });
                            setRejectReason("");
                          }}
                          disabled={actingId === item.id}
                          className="flex items-center gap-1 bg-rose-500 hover:bg-rose-600 text-white text-[11px] font-semibold px-2.5 py-1.5 rounded-lg transition-colors disabled:opacity-50"
                        >
                          <X className="h-3 w-3" /> Reject
                        </button>
                      </div>
                    )}
                    {canApprove && item.status === "admin_approved" && (
                      <span className="text-[11px] text-emerald-600 font-semibold">Approved ✓</span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Approve Modal */}
      {approveModal && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <div className="bg-white dark:bg-card rounded-2xl shadow-2xl w-full max-w-lg border border-[#e2e8f0] dark:border-white/[0.08] max-h-[90vh] overflow-y-auto">
            <div className="p-6 border-b border-[#e2e8f0] dark:border-white/[0.08]">
              <h3 className="text-[16px] font-bold text-[#0f172a] dark:text-white">
                Approve Travel Request
              </h3>
              <p className="text-[12px] text-[#64748b] dark:text-white/50 mt-1">
                {approveModal.ref_id} — {approveModal.from_location} → {approveModal.to_destination}{" "}
                · {approveModal.employee_name}
              </p>
            </div>
            <div className="p-6 space-y-4">
              <div>
                <label className="block text-[12px] font-semibold text-[#374151] dark:text-white/70 mb-1.5">
                  Expense Limit{" "}
                  <span className="text-[#94a3b8] font-normal">
                    optional — leave blank to use global limit
                  </span>
                </label>
                <div className="flex gap-2">
                  <select
                    value={approveForm.expense_limit_currency}
                    onChange={(e) =>
                      setApproveForm((f) => ({ ...f, expense_limit_currency: e.target.value }))
                    }
                    className="border border-[#e2e8f0] dark:border-white/[0.08] rounded-lg px-2 py-2 text-[13px] bg-white dark:bg-background text-[#0f172a] dark:text-white focus:outline-none focus:ring-2 focus:ring-[#00a29a]/30 w-24"
                  >
                    {CURRENCIES.map((c) => (
                      <option key={c} value={c}>
                        {c}
                      </option>
                    ))}
                  </select>
                  <input
                    type="number"
                    placeholder="e.g. 25000"
                    value={approveForm.expense_limit}
                    onChange={(e) =>
                      setApproveForm((f) => ({ ...f, expense_limit: e.target.value }))
                    }
                    className="flex-1 border border-[#e2e8f0] dark:border-white/[0.08] rounded-lg px-3 py-2 text-[13px] bg-white dark:bg-background text-[#0f172a] dark:text-white focus:outline-none focus:ring-2 focus:ring-[#00a29a]/30"
                  />
                </div>
              </div>
              <div>
                <label className="block text-[12px] font-semibold text-[#374151] dark:text-white/70 mb-1.5">
                  Ticket Details{" "}
                  <span className="text-[#94a3b8] font-normal">flight/train PNR, booking ref</span>
                </label>
                <textarea
                  rows={3}
                  placeholder="e.g. IndiGo 6E-431, PNR: ABC123, 08:00 Mumbai–Delhi"
                  value={approveForm.ticket_details}
                  onChange={(e) =>
                    setApproveForm((f) => ({ ...f, ticket_details: e.target.value }))
                  }
                  className="w-full border border-[#e2e8f0] dark:border-white/[0.08] rounded-lg px-3 py-2 text-[13px] bg-white dark:bg-background text-[#0f172a] dark:text-white focus:outline-none focus:ring-2 focus:ring-[#00a29a]/30 resize-none"
                />
              </div>
              {approveModal.accommodation_required && (
                <div>
                  <label className="block text-[12px] font-semibold text-[#374151] dark:text-white/70 mb-1.5">
                    Hotel / Accommodation Details
                  </label>
                  <textarea
                    rows={3}
                    placeholder="Hotel name, address, check-in/out dates, booking ref"
                    value={approveForm.hotel_details}
                    onChange={(e) =>
                      setApproveForm((f) => ({ ...f, hotel_details: e.target.value }))
                    }
                    className="w-full border border-[#e2e8f0] dark:border-white/[0.08] rounded-lg px-3 py-2 text-[13px] bg-white dark:bg-background text-[#0f172a] dark:text-white focus:outline-none focus:ring-2 focus:ring-[#00a29a]/30 resize-none"
                  />
                </div>
              )}
              {approveModal.is_international && (
                <div>
                  <label className="block text-[12px] font-semibold text-[#374151] dark:text-white/70 mb-1.5">
                    Visa Status / Notes
                  </label>
                  <textarea
                    rows={2}
                    placeholder="Visa applied / approved / processing, expected date"
                    value={approveForm.visa_status}
                    onChange={(e) => setApproveForm((f) => ({ ...f, visa_status: e.target.value }))}
                    className="w-full border border-[#e2e8f0] dark:border-white/[0.08] rounded-lg px-3 py-2 text-[13px] bg-white dark:bg-background text-[#0f172a] dark:text-white focus:outline-none focus:ring-2 focus:ring-[#00a29a]/30 resize-none"
                  />
                </div>
              )}
            </div>
            <div className="p-6 border-t border-[#e2e8f0] dark:border-white/[0.08] flex gap-3 justify-end">
              <button
                onClick={() => setApproveModal(null)}
                className="px-4 py-2 text-[13px] font-semibold text-[#64748b] dark:text-white/50 hover:text-[#0f172a] dark:hover:text-white transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={confirmApprove}
                disabled={actingId !== null}
                className="flex items-center gap-2 bg-emerald-500 hover:bg-emerald-600 text-white px-4 py-2 rounded-lg text-[13px] font-semibold transition-colors disabled:opacity-50"
              >
                {actingId !== null ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <Check className="h-4 w-4" />
                )}{" "}
                Approve & Notify Employee
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Reject Modal */}
      {rejectModal && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <div className="bg-white dark:bg-card rounded-2xl shadow-2xl w-full max-w-md border border-[#e2e8f0] dark:border-white/[0.08]">
            <div className="p-6 border-b border-[#e2e8f0] dark:border-white/[0.08]">
              <h3 className="text-[16px] font-bold text-[#0f172a] dark:text-white">
                Reject Travel Request
              </h3>
              <p className="text-[12px] text-[#64748b] dark:text-white/50 mt-1">
                {rejectModal.ref_id}
              </p>
            </div>
            <div className="p-6">
              <label className="block text-[12px] font-semibold text-[#374151] dark:text-white/70 mb-1.5">
                Reason for Rejection{" "}
                <span className="text-[#94a3b8] font-normal">optional but recommended</span>
              </label>
              <textarea
                rows={3}
                placeholder="Please provide a reason..."
                value={rejectReason}
                onChange={(e) => setRejectReason(e.target.value)}
                className="w-full border border-[#e2e8f0] dark:border-white/[0.08] rounded-lg px-3 py-2 text-[13px] bg-white dark:bg-background text-[#0f172a] dark:text-white focus:outline-none focus:ring-2 focus:ring-rose-500/30 resize-none"
              />
            </div>
            <div className="p-6 border-t border-[#e2e8f0] dark:border-white/[0.08] flex gap-3 justify-end">
              <button
                onClick={() => setRejectModal(null)}
                className="px-4 py-2 text-[13px] font-semibold text-[#64748b] dark:text-white/50 hover:text-[#0f172a] dark:hover:text-white transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={confirmReject}
                disabled={actingId !== null}
                className="flex items-center gap-2 bg-rose-500 hover:bg-rose-600 text-white px-4 py-2 rounded-lg text-[13px] font-semibold transition-colors disabled:opacity-50"
              >
                {actingId !== null ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <X className="h-4 w-4" />
                )}{" "}
                Confirm Rejection
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

type ExpenseClaim = {
  id: number;
  ref_id: string;
  travel_ref: string;
  employee_name: string;
  employee_email: string;
  from_location: string;
  to_destination: string;
  amount: number;
  currency?: string;
  breakdown?: string;
  over_limit_reason?: string;
  expense_limit?: number;
  expense_limit_currency?: string;
  status: string;
  approved_by?: string;
  rejection_reason?: string;
  created_at: string;
};

function TravelExpensesSubTab({
  authHeaders,
  canApprove,
}: {
  authHeaders: Record<string, string>;
  canApprove: boolean;
}) {
  const [items, setItems] = useState<ExpenseClaim[]>([]);
  const [loading, setLoading] = useState(false);
  const [filter, setFilter] = useState("All");
  const [actingId, setActingId] = useState<number | null>(null);
  const [rejectModal, setRejectModal] = useState<{ id: number; ref_id: string } | null>(null);
  const [rejectReason, setRejectReason] = useState("");

  const fetch_ = useCallback(async () => {
    setLoading(true);
    try {
      const qs = filter !== "All" ? `?status=${filter}` : "";
      const res = await fetch(`/api/portal/admin/travel/expenses${qs}`, { headers: authHeaders });
      const data = await res.json();
      setItems(Array.isArray(data) ? data : []);
      if (!res.ok) toast.error(data?.detail || "Failed to load expense claims");
    } catch {
      toast.error("Failed to load expense claims");
    } finally {
      setLoading(false);
    }
  }, [filter, authHeaders]);

  useEffect(() => {
    fetch_();
  }, [fetch_]);

  const act = async (id: number, type: "approve" | "reject", reason = "") => {
    setActingId(id);
    try {
      const res = await fetch(`/api/portal/admin/travel/expenses/${id}/${type}`, {
        method: "PUT",
        headers: authHeaders,
        body: JSON.stringify(type === "reject" ? { reason } : {}),
      });
      if (!res.ok) throw new Error((await res.json().catch(() => ({}))).detail || "Failed");
      if (type === "approve") flyBanner("Expense claim approved");
      else toast.success("Expense claim rejected");
      if (type === "reject") {
        setRejectModal(null);
        setRejectReason("");
      }
      fetch_();
    } catch (e: any) {
      toast.error(e.message || "Failed");
    } finally {
      setActingId(null);
    }
  };

  return (
    <div>
      <FilterBar
        filter={filter}
        setFilter={setFilter}
        options={["All", "Pending", "Approved", "Rejected"]}
        onRefresh={fetch_}
      />
      {loading ? (
        <TableLoader />
      ) : items.length === 0 ? (
        <TableEmpty label="expense claims" />
      ) : (
        <div className="overflow-x-auto rounded-2xl border border-[#e2e8f0] dark:border-white/[0.08] bg-white dark:bg-card">
          <table className="w-full min-w-[900px] text-[13px]">
            <thead>
              <tr className="border-b border-[#e2e8f0] dark:border-white/[0.08] bg-[#f8fafc] dark:bg-white/[0.02]">
                {[
                  "Expense Ref",
                  "Travel Ref",
                  "Employee",
                  "Route",
                  "Amount vs Limit",
                  "Breakdown",
                  "Status",
                  "Actions",
                ].map((h) => (
                  <th
                    key={h}
                    className="text-left px-4 py-3 text-[11px] font-bold text-[#64748b] dark:text-white/40 uppercase tracking-wider"
                  >
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {items.map((item) => {
                const overLimit = item.expense_limit && item.amount > item.expense_limit;
                return (
                  <tr
                    key={item.id}
                    className="border-b border-[#f1f5f9] dark:border-white/[0.04] hover:bg-[#f8fafc] dark:hover:bg-white/[0.02] transition-colors"
                  >
                    <td className="px-4 py-3 font-mono text-[12px] text-[#94a3b8]">
                      {item.ref_id}
                    </td>
                    <td className="px-4 py-3 font-mono text-[12px] text-[#94a3b8]">
                      {item.travel_ref}
                    </td>
                    <td className="px-4 py-3">
                      <div className="font-semibold text-[#0f172a] dark:text-white">
                        {item.employee_name}
                      </div>
                      <div className="text-[11px] text-[#94a3b8]">{item.employee_email}</div>
                    </td>
                    <td className="px-4 py-3 text-[#374151] dark:text-white/70">
                      {item.from_location} → {item.to_destination}
                    </td>
                    <td className="px-4 py-3">
                      <div
                        className={cn(
                          "font-bold",
                          overLimit ? "text-rose-600" : "text-[#0f172a] dark:text-white",
                        )}
                      >
                        {item.currency || "INR"} {item.amount.toLocaleString()}
                      </div>
                      {item.expense_limit && (
                        <div className="text-[11px] text-[#94a3b8]">
                          Limit: {item.expense_limit_currency || "INR"}{" "}
                          {item.expense_limit.toLocaleString()}
                        </div>
                      )}
                      {overLimit && (
                        <div className="text-[10px] text-rose-500 font-semibold">
                          Over by {item.expense_limit_currency || "INR"}{" "}
                          {(item.amount - item.expense_limit!).toLocaleString()}
                        </div>
                      )}
                    </td>
                    <td className="px-4 py-3 max-w-[160px]">
                      {item.breakdown && (
                        <div className="text-[12px] truncate" title={item.breakdown}>
                          {item.breakdown}
                        </div>
                      )}
                      {item.over_limit_reason && (
                        <div
                          className="text-[11px] text-amber-600 mt-0.5 truncate"
                          title={item.over_limit_reason}
                        >
                          Reason: {item.over_limit_reason}
                        </div>
                      )}
                    </td>
                    <td className="px-4 py-3">
                      <span
                        className={cn(
                          "px-2 py-1 rounded-full text-[11px] font-semibold",
                          EXPENSE_STATUS_BADGE[item.status] || "bg-zinc-100 text-zinc-500",
                        )}
                      >
                        {item.status}
                      </span>
                      {item.rejection_reason && (
                        <div
                          className="text-[10px] text-rose-500 mt-0.5 max-w-[120px] truncate"
                          title={item.rejection_reason}
                        >
                          {item.rejection_reason}
                        </div>
                      )}
                    </td>
                    <td className="px-4 py-3">
                      {canApprove && item.status === "Pending" && (
                        <div className="flex gap-2">
                          <button
                            onClick={() => act(item.id, "approve")}
                            disabled={actingId === item.id}
                            className="flex items-center gap-1 bg-emerald-500 hover:bg-emerald-600 text-white text-[11px] font-semibold px-2.5 py-1.5 rounded-lg transition-colors disabled:opacity-50"
                          >
                            {actingId === item.id ? (
                              <Loader2 className="h-3 w-3 animate-spin" />
                            ) : (
                              <Check className="h-3 w-3" />
                            )}{" "}
                            Approve
                          </button>
                          <button
                            onClick={() => {
                              setRejectModal({ id: item.id, ref_id: item.ref_id });
                              setRejectReason("");
                            }}
                            disabled={actingId === item.id}
                            className="flex items-center gap-1 bg-rose-500 hover:bg-rose-600 text-white text-[11px] font-semibold px-2.5 py-1.5 rounded-lg transition-colors disabled:opacity-50"
                          >
                            <X className="h-3 w-3" /> Reject
                          </button>
                        </div>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {rejectModal && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <div className="bg-white dark:bg-card rounded-2xl shadow-2xl w-full max-w-md border border-[#e2e8f0] dark:border-white/[0.08]">
            <div className="p-6 border-b border-[#e2e8f0] dark:border-white/[0.08]">
              <h3 className="text-[16px] font-bold text-[#0f172a] dark:text-white">
                Reject Expense Claim
              </h3>
              <p className="text-[12px] text-[#64748b] dark:text-white/50 mt-1">
                {rejectModal.ref_id}
              </p>
            </div>
            <div className="p-6">
              <label className="block text-[12px] font-semibold text-[#374151] dark:text-white/70 mb-1.5">
                Reason for Rejection
              </label>
              <textarea
                rows={3}
                placeholder="Please provide a reason..."
                value={rejectReason}
                onChange={(e) => setRejectReason(e.target.value)}
                className="w-full border border-[#e2e8f0] dark:border-white/[0.08] rounded-lg px-3 py-2 text-[13px] bg-white dark:bg-background text-[#0f172a] dark:text-white focus:outline-none focus:ring-2 focus:ring-rose-500/30 resize-none"
              />
            </div>
            <div className="p-6 border-t border-[#e2e8f0] dark:border-white/[0.08] flex gap-3 justify-end">
              <button
                onClick={() => setRejectModal(null)}
                className="px-4 py-2 text-[13px] font-semibold text-[#64748b] dark:text-white/50 hover:text-[#0f172a] dark:hover:text-white transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={() => act(rejectModal.id, "reject", rejectReason)}
                disabled={actingId !== null}
                className="flex items-center gap-2 bg-rose-500 hover:bg-rose-600 text-white px-4 py-2 rounded-lg text-[13px] font-semibold transition-colors disabled:opacity-50"
              >
                {actingId !== null ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <X className="h-4 w-4" />
                )}{" "}
                Confirm Rejection
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function TravelSettingsSubTab({ authHeaders }: { authHeaders: Record<string, string> }) {
  const [limit, setLimit] = useState<string>("");
  const [currency, setCurrency] = useState<string>("INR");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    fetch("/api/portal/admin/travel/settings", { headers: authHeaders })
      .then((r) => r.json())
      .then((d) => {
        setLimit(d.global_expense_limit != null ? String(d.global_expense_limit) : "");
        setCurrency(d.global_expense_limit_currency || "INR");
      })
      .catch(() => {});
  }, [authHeaders]);

  const save = async () => {
    setSaving(true);
    try {
      const res = await fetch("/api/portal/admin/travel/settings", {
        method: "PUT",
        headers: authHeaders,
        body: JSON.stringify({
          global_expense_limit: limit ? parseFloat(limit) : null,
          global_expense_limit_currency: currency,
        }),
      });
      if (!res.ok) throw new Error("Failed");
      toast.success("Travel settings saved");
    } catch {
      toast.error("Failed to save settings");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="max-w-md">
      <div className="bg-white dark:bg-card rounded-2xl border border-[#e2e8f0] dark:border-white/[0.08] p-6">
        <h3 className="text-[15px] font-bold text-[#0f172a] dark:text-white mb-1">
          Travel Expense Limits
        </h3>
        <p className="text-[12px] text-[#64748b] dark:text-white/50 mb-6">
          Set a default expense limit applied to all travel requests. Admin can override this
          per-trip when approving.
        </p>
        <div className="mb-4">
          <label className="block text-[12px] font-semibold text-[#374151] dark:text-white/70 mb-1.5">
            Global Expense Limit{" "}
            <span className="text-[#94a3b8] font-normal">— leave blank for no limit</span>
          </label>
          <div className="flex gap-2">
            <select
              value={currency}
              onChange={(e) => setCurrency(e.target.value)}
              className="border border-[#e2e8f0] dark:border-white/[0.08] rounded-lg px-2 py-2 text-[13px] bg-white dark:bg-background text-[#0f172a] dark:text-white focus:outline-none focus:ring-2 focus:ring-[#00a29a]/30 w-24"
            >
              {CURRENCIES.map((c) => (
                <option key={c} value={c}>
                  {c}
                </option>
              ))}
            </select>
            <input
              type="number"
              placeholder="e.g. 25000"
              value={limit}
              onChange={(e) => setLimit(e.target.value)}
              className="flex-1 border border-[#e2e8f0] dark:border-white/[0.08] rounded-lg px-3 py-2 text-[13px] bg-white dark:bg-background text-[#0f172a] dark:text-white focus:outline-none focus:ring-2 focus:ring-[#00a29a]/30"
            />
          </div>
          <p className="text-[11px] text-[#94a3b8] mt-1.5">
            When an employee files a post-trip expense that exceeds this limit, they must provide a
            reason. Admin can then approve or reject the excess.
          </p>
        </div>
        <button
          onClick={save}
          disabled={saving}
          className="flex items-center gap-2 bg-[#00a29a] hover:bg-[#00918a] text-white px-4 py-2 rounded-lg text-[13px] font-semibold transition-colors disabled:opacity-50"
        >
          {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}{" "}
          Save Settings
        </button>
      </div>
    </div>
  );
}
