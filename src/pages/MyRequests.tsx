import { useAuth } from "@/lib/auth-store";
import { useState, useEffect, useCallback, useMemo } from "react";
import {
  Loader2,
  RefreshCw,
  Inbox,
  AlertCircle,
  FileText,
  MessageSquare,
  ShieldAlert,
  ChevronDown,
  CheckCircle2,
  Filter,
  Clock,
  XCircle,
  CircleDot,
  Wrench,
  Car,
  CalendarDays,
  Plane,
  Receipt,
  GraduationCap,
  DollarSign,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { toast } from "sonner";
import { StatusBadge } from "@/components/ui/StatusBadge";

// ── Types ─────────────────────────────────────────────────────────────────────

type RequestType =
  | "escalation"
  | "document"
  | "query"
  | "grievance"
  | "facility"
  | "parking"
  | "leave"
  | "expense"
  | "travel_request"
  | "travel_expense"
  | "udemy";

interface RequestItem {
  key: string;
  type: RequestType;
  reference_id: string;
  subject: string;
  description: string;
  status: string;
  priority?: string;
  created_at: string;
  raw: Record<string, unknown>;
}

// ── Constants ────────────────────────────────────────────────────────────────

const TYPE_BADGE: Record<RequestType, string> = {
  escalation: "bg-rose-500/15 text-rose-400 border border-rose-500/20",
  document: "bg-violet-500/15 text-violet-400 border border-violet-500/20",
  query: "bg-sky-500/15 text-sky-400 border border-sky-500/20",
  grievance: "bg-amber-500/15 text-amber-400 border border-amber-500/20",
  facility: "bg-cyan-500/15 text-cyan-400 border border-cyan-500/20",
  parking: "bg-teal-500/15 text-teal-400 border border-teal-500/20",
  leave: "bg-emerald-500/15 text-emerald-400 border border-emerald-500/20",
  expense: "bg-indigo-500/15 text-indigo-400 border border-indigo-500/20",
  travel_request: "bg-blue-500/15 text-blue-400 border border-blue-500/20",
  travel_expense: "bg-fuchsia-500/15 text-fuchsia-400 border border-fuchsia-500/20",
  udemy: "bg-orange-500/15 text-orange-400 border border-orange-500/20",
};

const TYPE_LABEL: Record<RequestType, string> = {
  escalation: "Escalation",
  document: "Document",
  query: "HR Query",
  grievance: "Grievance",
  facility: "Facility Complaint",
  parking: "Parking Sticker",
  leave: "Leave Request",
  expense: "Expense Claim",
  travel_request: "Travel Request",
  travel_expense: "Travel Expense",
  udemy: "Udemy License",
};

const TYPE_ICON: Record<RequestType, React.ElementType> = {
  escalation: AlertCircle,
  document: FileText,
  query: MessageSquare,
  grievance: ShieldAlert,
  facility: Wrench,
  parking: Car,
  leave: CalendarDays,
  expense: DollarSign,
  travel_request: Plane,
  travel_expense: Receipt,
  udemy: GraduationCap,
};

const PRIORITY_BADGE: Record<string, string> = {
  Low: "bg-zinc-500/15 text-zinc-400",
  Normal: "bg-zinc-500/15 text-zinc-400",
  Medium: "bg-amber-500/15 text-amber-400",
  High: "bg-rose-500/15 text-rose-400",
};

type StatusFilter = "all" | "open" | "closed" | "in-progress";

const STATUS_FILTERS: { key: StatusFilter; label: string; icon: React.ElementType }[] = [
  { key: "all", label: "All", icon: Filter },
  { key: "open", label: "Open", icon: CircleDot },
  { key: "in-progress", label: "In Progress", icon: Clock },
  { key: "closed", label: "Closed", icon: XCircle },
];

const OPEN_STATUSES = ["open", "pending approval", "draft", "pending", "pending_rm", "pending_fm"];
const CLOSED_STATUSES = ["resolved", "closed", "verified", "approved", "completed", "cancelled", "finance_processed", "rejected"];
const IN_PROGRESS_STATUSES = [
  "acknowledged",
  "under review",
  "in progress",
  "in_progress",
  "rm_approved",
  "pmo_approved",
  "ticket_booked",
  "hotel_booked",
  "fm_approved",
];

function matchesStatusFilter(status: string, filter: StatusFilter): boolean {
  if (filter === "all") return true;
  const s = status.toLowerCase();
  if (filter === "open") return OPEN_STATUSES.includes(s);
  if (filter === "closed") return CLOSED_STATUSES.includes(s);
  if (filter === "in-progress") return IN_PROGRESS_STATUSES.includes(s);
  return true;
}

// ── Main Component ────────────────────────────────────────────────────────────

export function MyRequests() {
  const { user } = useAuth();
  const [items, setItems] = useState<RequestItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [typeFilter, setTypeFilter] = useState<RequestType | "all">("all");
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("all");
  const [expanded, setExpanded] = useState<string | null>(null);

  // Listen for deep-link filter events dispatched by the chat intercept
  useEffect(() => {
    const handler = (e: CustomEvent<{ status: StatusFilter }>) => {
      if (e.detail?.status) setStatusFilter(e.detail.status);
    };
    window.addEventListener("centriq:requests-filter", handler as EventListener);
    return () => window.removeEventListener("centriq:requests-filter", handler as EventListener);
  }, []);

  const authHeaders = useMemo(
    () => ({
      "Content-Type": "application/json",
      ...(user?.email ? { "x-user-email": user.email } : {}),
      ...(user?.role ? { "x-user-role": user.role.toLowerCase() } : {}),
    }),
    [user?.email, user?.role]
  );

  const fetchAll = useCallback(async () => {
    if (!user?.email) return;
    setLoading(true);
    try {
      // Fetch all request types from the unified endpoint and documents in parallel
      const [reqsRes, docRes] = await Promise.all([
        fetch("/api/employees/me/requests", { headers: authHeaders }),
        fetch("/api/documents/list", { headers: authHeaders }),
      ]);

      const [reqsData, docData] = await Promise.all([
        reqsRes.ok ? reqsRes.json() : {},
        docRes.ok ? docRes.json() : { results: [] },
      ]);

      const userEmail = user.email.toLowerCase();

      const normalized: RequestItem[] = [
        // Escalations
        ...(reqsData.escalations ?? []).map((e: Record<string, unknown>) => ({
          key: `esc-${e.id}`,
          type: "escalation" as RequestType,
          reference_id: String(e.reference_id ?? ""),
          subject: String(e.original_query || "Escalation"),
          description: String(e.description || ""),
          status: String(e.status ?? "Open"),
          priority: e.priority ? String(e.priority) : undefined,
          created_at: String(e.created_at ?? ""),
          raw: e,
        })),
        // Documents — filter to user-generated or subject
        ...(docData.results ?? [])
          .filter(
            (d: Record<string, unknown>) =>
              String(d.generated_by_email ?? "").toLowerCase() === userEmail ||
              String(d.subject_email ?? "").toLowerCase() === userEmail
          )
          .map((d: Record<string, unknown>) => ({
            key: `doc-${d.id}`,
            type: "document" as RequestType,
            reference_id: `DOC-${d.id}`,
            subject: String(d.title || d.label || "Document"),
            description: `${d.label} · For ${d.subject_name || d.subject_email || "—"}`,
            status: d.status === "draft" ? "Pending Approval" : String(d.status ?? ""),
            created_at: String(d.created_at ?? ""),
            raw: d,
          })),
        // HR Queries
        ...(reqsData.hr_queries ?? []).map((q: Record<string, unknown>) => ({
          key: `query-${q.id}`,
          type: "query" as RequestType,
          reference_id: String(q.reference_id ?? ""),
          subject: String(q.subject ?? ""),
          description: String(q.description ?? ""),
          status: String(q.status ?? "Open"),
          priority: q.priority ? String(q.priority) : undefined,
          created_at: String(q.created_at ?? ""),
          raw: q,
        })),
        // Grievances
        ...(reqsData.grievances ?? []).map((g: Record<string, unknown>) => ({
          key: `grv-${g.id}`,
          type: "grievance" as RequestType,
          reference_id: String(g.reference_id ?? ""),
          subject: String(g.category ?? ""),
          description: String(g.description ?? ""),
          status: String(g.status ?? "Open"),
          created_at: String(g.submitted_at ?? ""),
          raw: g,
        })),
        // Facility Complaints
        ...(reqsData.complaints ?? []).map((c: Record<string, unknown>) => ({
          key: `facility-${c.id}`,
          type: "facility" as RequestType,
          reference_id: String(c.ticket_id ?? ""),
          subject: String(c.category ?? "Facility Complaint"),
          description: String(c.description ?? ""),
          status: String(c.status ?? "Open"),
          priority: c.priority ? String(c.priority) : undefined,
          created_at: String(c.created_at ?? ""),
          raw: c,
        })),
        // Parking Stickers
        ...(reqsData.parking ?? []).map((p: Record<string, unknown>) => ({
          key: `parking-${p.id}`,
          type: "parking" as RequestType,
          reference_id: p.sticker_number ? String(p.sticker_number) : `PK-${p.id}`,
          subject: `Parking Sticker Request (${p.vehicle_type})`,
          description: `${p.vehicle_make} ${p.vehicle_model} [${p.vehicle_number}]`,
          status: String(p.status ?? "Pending"),
          created_at: String(p.valid_from ?? p.created_at ?? ""),
          raw: p,
        })),
        // Leaves
        ...(reqsData.leaves ?? []).map((l: Record<string, unknown>) => ({
          key: `leave-${l.id}`,
          type: "leave" as RequestType,
          reference_id: `LV-${l.id}`,
          subject: `${l.leave_type} Leave Request`,
          description: `${l.days} Day(s) · ${l.start_date} to ${l.end_date}`,
          status: String(l.status ?? "Pending"),
          created_at: String(l.created_at ?? l.start_date ?? ""),
          raw: l,
        })),
        // Expense Claims
        ...(reqsData.reimbursements ?? []).map((r: Record<string, unknown>) => ({
          key: `expense-${r.id}`,
          type: "expense" as RequestType,
          reference_id: `EXP-${r.id}`,
          subject: `${r.type} Reimbursement`,
          description: `Amount: $${r.amount} · Reason: ${r.reason}`,
          status: String(r.status ?? "Pending"),
          created_at: String(r.created_at ?? ""),
          raw: r,
        })),
        // Travel Requests
        ...(reqsData.travel_requests ?? []).map((t: Record<string, unknown>) => ({
          key: `travel-req-${t.id}`,
          type: "travel_request" as RequestType,
          reference_id: String(t.ref_id ?? ""),
          subject: `Travel to ${t.to_destination}`,
          description: `From ${t.from_location} · Date: ${t.travel_date}`,
          status: String(t.status ?? "pending_rm"),
          created_at: String(t.created_at ?? ""),
          raw: t,
        })),
        // Travel Expenses
        ...(reqsData.travel_expenses ?? []).map((e: Record<string, unknown>) => ({
          key: `travel-exp-${e.id}`,
          type: "travel_expense" as RequestType,
          reference_id: String(e.ref_id ?? ""),
          subject: `Travel Expense Claim`,
          description: `Amount: $${e.amount} · Breakdown: ${e.breakdown}`,
          status: String(e.status ?? "pending_fm"),
          created_at: String(e.created_at ?? ""),
          raw: e,
        })),
        // Udemy License
        ...(reqsData.udemy ?? []).map((u: Record<string, unknown>) => ({
          key: `udemy-${u.id}`,
          type: "udemy" as RequestType,
          reference_id: `UDM-${u.id}`,
          subject: `Udemy License: ${u.course_name}`,
          description: `Platform: ${u.platform} · Justification: ${u.justification}`,
          status: String(u.status ?? "pending"),
          created_at: String(u.created_at ?? ""),
          raw: u,
        })),
      ];

      normalized.sort(
        (a, b) => new Date(b.created_at || 0).getTime() - new Date(a.created_at || 0).getTime()
      );
      setItems(normalized);
    } catch {
      toast.error("Failed to load your requests");
    } finally {
      setLoading(false);
    }
  }, [authHeaders, user?.email]);

  useEffect(() => {
    fetchAll();
  }, [fetchAll]);

  // Filtered items
  const filtered = useMemo(() => {
    return items.filter((i) => {
      if (typeFilter !== "all" && i.type !== typeFilter) return false;
      if (!matchesStatusFilter(i.status, statusFilter)) return false;
      return true;
    });
  }, [items, typeFilter, statusFilter]);

  // Type counts
  const counts = {
    all: items.length,
    escalation: items.filter((i) => i.type === "escalation").length,
    document: items.filter((i) => i.type === "document").length,
    query: items.filter((i) => i.type === "query").length,
    grievance: items.filter((i) => i.type === "grievance").length,
    facility: items.filter((i) => i.type === "facility").length,
    parking: items.filter((i) => i.type === "parking").length,
    leave: items.filter((i) => i.type === "leave").length,
    expense: items.filter((i) => i.type === "expense").length,
    travel_request: items.filter((i) => i.type === "travel_request").length,
    travel_expense: items.filter((i) => i.type === "travel_expense").length,
    udemy: items.filter((i) => i.type === "udemy").length,
  };

  // Status counts
  const statusCounts = {
    all: items.length,
    open: items.filter((i) => matchesStatusFilter(i.status, "open")).length,
    "in-progress": items.filter((i) => matchesStatusFilter(i.status, "in-progress")).length,
    closed: items.filter((i) => matchesStatusFilter(i.status, "closed")).length,
  };

  // Stat cards
  const STATS: {
    type: RequestType;
    label: string;
    icon: React.ElementType;
    color: string;
    bg: string;
  }[] = [
    { type: "leave", label: "Leaves", icon: CalendarDays, color: "text-emerald-400", bg: "bg-emerald-500/10" },
    { type: "travel_request", label: "Travel Requests", icon: Plane, color: "text-blue-400", bg: "bg-blue-500/10" },
    { type: "travel_expense", label: "Travel Expenses", icon: Receipt, color: "text-fuchsia-400", bg: "bg-fuchsia-500/10" },
    { type: "expense", label: "Expense Claims", icon: DollarSign, color: "text-indigo-400", bg: "bg-indigo-500/10" },
    { type: "udemy", label: "Udemy Licenses", icon: GraduationCap, color: "text-orange-400", bg: "bg-orange-500/10" },
    { type: "facility", label: "Facility", icon: Wrench, color: "text-cyan-400", bg: "bg-cyan-500/10" },
    { type: "parking", label: "Parking", icon: Car, color: "text-teal-400", bg: "bg-teal-500/10" },
    { type: "query", label: "HR Queries", icon: MessageSquare, color: "text-sky-400", bg: "bg-sky-500/10" },
  ];

  const TYPE_PILLS: { key: RequestType | "all"; label: string }[] = [
    { key: "all", label: `All (${counts.all})` },
    { key: "leave", label: `Leaves (${counts.leave})` },
    { key: "travel_request", label: `Travel Requests (${counts.travel_request})` },
    { key: "travel_expense", label: `Travel Expenses (${counts.travel_expense})` },
    { key: "expense", label: `Expense Claims (${counts.expense})` },
    { key: "udemy", label: `Udemy (${counts.udemy})` },
    { key: "facility", label: `Facility (${counts.facility})` },
    { key: "parking", label: `Parking (${counts.parking})` },
    { key: "query", label: `HR Queries (${counts.query})` },
    { key: "escalation", label: `Escalations (${counts.escalation})` },
    { key: "grievance", label: `Grievances (${counts.grievance})` },
    { key: "document", label: `Documents (${counts.document})` },
  ];

  // Table rows
  const tableRows: JSX.Element[] = [];
  filtered.forEach((item) => {
    const isExpanded = expanded === item.key;
    const TIcon = TYPE_ICON[item.type];
    tableRows.push(
      <tr
        key={item.key}
        onClick={() => setExpanded(isExpanded ? null : item.key)}
        className="border-b border-[var(--border)]/50 hover:bg-white/[0.02] transition-colors cursor-pointer"
      >
        <td className="py-3.5 pr-4">
          <span className={cn("rounded-full px-2 py-0.5 text-[11px] font-semibold inline-flex items-center gap-1", TYPE_BADGE[item.type])}>
            <TIcon className="h-3 w-3" />
            {TYPE_LABEL[item.type]}
          </span>
        </td>
        <td className="py-3.5 pr-4 text-[12px] text-foreground/60 font-mono whitespace-nowrap">
          {item.reference_id || "—"}
        </td>
        <td className="py-3.5 pr-4 max-w-[280px]">
          <div className="text-[13px] font-medium text-foreground truncate">{item.subject}</div>
          {item.description && (
            <div className="text-[11px] text-muted-foreground truncate">{item.description}</div>
          )}
        </td>
        <td className="py-3.5 pr-4">
          {item.priority ? (
            <span
              className={cn(
                "rounded-full px-2 py-0.5 text-[11px] font-medium",
                PRIORITY_BADGE[item.priority] ?? "bg-zinc-500/15 text-zinc-400"
              )}
            >
              {item.priority}
            </span>
          ) : (
            <span className="text-muted-foreground/30 text-[13px]">—</span>
          )}
        </td>
        <td className="py-3.5 pr-4">
          <StatusBadge status={item.status} />
        </td>
        <td className="py-3.5 pr-4 text-[12px] text-muted-foreground/60 whitespace-nowrap">
          {item.created_at ? item.created_at.slice(0, 10) : "—"}
        </td>
        <td className="py-3.5 pr-2 text-muted-foreground/50">
          <ChevronDown
            className={cn("h-3.5 w-3.5 transition-transform duration-150", isExpanded && "rotate-180")}
          />
        </td>
      </tr>
    );
    if (isExpanded) {
      tableRows.push(
        <tr key={`${item.key}-panel`}>
          <td colSpan={7} className="p-0">
            <DetailPanel item={item} />
          </td>
        </tr>
      );
    }
  });

  return (
    <div className="flex flex-col h-full overflow-hidden">
      {/* Header */}
      <div className="flex items-center justify-between px-8 py-6 border-b border-[var(--border)] shrink-0">
        <div>
          <h1 className="text-[20px] font-semibold text-foreground">My Requests</h1>
          <p className="text-[13px] text-muted-foreground mt-0.5">
            Track all your submitted requests, leaves, travel, expenses, and facility queries
          </p>
        </div>
        <button
          onClick={fetchAll}
          className="flex items-center gap-2 rounded-lg px-3.5 py-2 text-[13px] text-muted-foreground hover:bg-secondary transition-colors shrink-0 border border-[var(--border)]"
        >
          <RefreshCw className="h-3.5 w-3.5" />
          Refresh
        </button>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-8 gap-4 px-8 py-4 shrink-0 overflow-x-auto">
        {STATS.map(({ type, label, icon: Icon, color, bg }) => (
          <button
            key={type}
            onClick={() => setTypeFilter(typeFilter === type ? "all" : type)}
            className={cn(
              "rounded-xl border border-[var(--border)] bg-card/40 px-4 py-3 flex items-center gap-3 text-left transition-colors hover:bg-card/70 shrink-0 min-w-[130px]",
              typeFilter === type && "ring-2 ring-primary/30 bg-primary/5"
            )}
          >
            <div className={cn("rounded-lg p-2 shrink-0", bg, color)}>
              <Icon className="h-4 w-4" />
            </div>
            <div>
              <p className={cn("text-[18px] font-bold leading-tight", color)}>
                {counts[type]}
              </p>
              <p className="text-[10px] text-muted-foreground leading-tight truncate">{label}</p>
            </div>
          </button>
        ))}
      </div>

      {/* Filters */}
      <div className="flex flex-col md:flex-row md:items-center justify-between px-8 pb-3 gap-3 shrink-0">
        <div className="flex gap-1.5 flex-wrap">
          {TYPE_PILLS.map(({ key, label }) => (
            <button
              key={key}
              onClick={() => setTypeFilter(key)}
              className={cn(
                "rounded-full px-3 py-1 text-[11px] font-medium transition-colors",
                typeFilter === key
                  ? "bg-primary/15 text-primary"
                  : "bg-secondary/50 text-muted-foreground hover:bg-secondary hover:text-foreground"
              )}
            >
              {label}
            </button>
          ))}
        </div>

        {/* Status filter */}
        <div className="flex gap-1 items-center self-end md:self-auto">
          {STATUS_FILTERS.map(({ key, label, icon: SIcon }) => (
            <button
              key={key}
              onClick={() => setStatusFilter(key)}
              className={cn(
                "flex items-center gap-1.5 rounded-lg px-2.5 py-1 text-[11px] font-medium transition-colors",
                statusFilter === key
                  ? "bg-primary/15 text-primary border border-primary/20"
                  : "text-muted-foreground hover:bg-secondary hover:text-foreground border border-transparent"
              )}
            >
              <SIcon className="h-3 w-3" />
              {label}
              <span className={cn(
                "text-[9px] font-bold rounded-full px-1.5 py-0.5 min-w-[16px] text-center",
                statusFilter === key
                  ? "bg-primary/20 text-primary"
                  : "bg-secondary text-muted-foreground"
              )}>
                {statusCounts[key]}
              </span>
            </button>
          ))}
        </div>
      </div>

      {/* Table */}
      <div className="flex-1 overflow-auto px-8 pb-8">
        {loading ? (
          <div className="flex h-40 items-center justify-center">
            <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
          </div>
        ) : filtered.length === 0 ? (
          <div className="flex flex-col h-40 items-center justify-center gap-2 text-muted-foreground">
            <Inbox className="h-5 w-5" />
            <span className="text-[13px]">
              {items.length === 0
                ? "You haven't submitted any requests yet"
                : "No requests match the current filters"}
            </span>
          </div>
        ) : (
          <table className="w-full text-[13px]">
            <thead>
              <tr className="border-b border-[var(--border)]">
                {["Type", "Reference", "Subject", "Priority", "Status", "Date", ""].map((h) => (
                  <th
                    key={h}
                    className="text-left py-3 pr-4 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground/60"
                  >
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>{tableRows}</tbody>
          </table>
        )}
      </div>
    </div>
  );
}

// ── Detail Panel ──────────────────────────────────────────────────────────────

function DetailPanel({ item }: { item: RequestItem }) {
  const raw = item.raw;
  const isFinal = CLOSED_STATUSES.includes(item.status.toLowerCase());

  const Detail = ({ label, value }: { label: string; value: React.ReactNode }) =>
    value ? (
      <div>
        <p className="text-[10px] uppercase tracking-wide text-muted-foreground/60 mb-0.5">{label}</p>
        <p className="text-[13px] text-foreground leading-relaxed">{value}</p>
      </div>
    ) : null;

  return (
    <div className="flex gap-8 px-8 py-5 bg-muted/20 border-b border-[var(--border)]">
      <div className="flex-1 min-w-0 space-y-3">
        {item.type === "escalation" && (
          <>
            {raw.error_type && (
              <span className="inline-block rounded-full bg-rose-500/15 text-rose-400 px-2.5 py-0.5 text-[11px] font-semibold capitalize">
                {String(raw.error_type).replace(/_/g, " ")}
              </span>
            )}
            <Detail label="Original query" value={String(raw.original_query || "—")} />
            {raw.description && (
              <Detail label="Additional context" value={String(raw.description)} />
            )}
          </>
        )}

        {item.type === "document" && (
          <>
            <Detail label="Document type" value={String(raw.label || raw.doc_type || "")} />
            <Detail label="Issued to" value={String(raw.subject_name || raw.subject_email || "")} />
            <Detail label="Requested by" value={String(raw.generated_by_email || "")} />
            {raw.verified_by_email && (
              <Detail label="Released by" value={String(raw.verified_by_email)} />
            )}
          </>
        )}

        {item.type === "query" && (
          <>
            <div className="flex items-center gap-2 flex-wrap">
              <span className="text-[11px] font-semibold bg-sky-500/15 text-sky-400 rounded-full px-2.5 py-0.5">
                {String(raw.category || "")}
              </span>
              {raw.priority && (
                <span
                  className={cn(
                    "text-[11px] font-medium rounded-full px-2.5 py-0.5",
                    PRIORITY_BADGE[String(raw.priority)] ?? "bg-zinc-500/15 text-zinc-400"
                  )}
                >
                  {String(raw.priority)}
                </span>
              )}
            </div>
            <Detail label="Subject" value={String(raw.subject || "")} />
            <Detail label="Description" value={String(raw.description || "")} />
            {raw.response && (
              <div>
                <p className="text-[10px] uppercase tracking-wide text-muted-foreground/60 mb-1">
                  Response
                </p>
                <div className="rounded-lg bg-emerald-500/5 border border-emerald-500/15 px-3 py-2 text-[12px] text-foreground/80 leading-relaxed">
                  {String(raw.response)}
                </div>
                {raw.responded_by && (
                  <p className="text-[11px] text-muted-foreground/40 mt-1">
                    by {String(raw.responded_by)}
                    {raw.responded_at ? ` · ${String(raw.responded_at).slice(0, 10)}` : ""}
                  </p>
                )}
              </div>
            )}
          </>
        )}

        {item.type === "grievance" && (
          <>
            <div className="flex items-center gap-2 flex-wrap">
              <span className="text-[11px] font-semibold bg-amber-500/15 text-amber-400 rounded-full px-2.5 py-0.5">
                {String(raw.category || "")}
              </span>
              {raw.is_anonymous && (
                <span className="text-[11px] bg-zinc-500/15 text-zinc-400 rounded-full px-2.5 py-0.5">
                  Anonymous
                </span>
              )}
            </div>
            <Detail label="Description" value={String(raw.description || "")} />
            {raw.resolution_notes && (
              <div>
                <p className="text-[10px] uppercase tracking-wide text-muted-foreground/60 mb-1">
                  Resolution Notes
                </p>
                <div className="rounded-lg bg-white/5 border border-[var(--border)] px-3 py-2 text-[12px] text-foreground/80 leading-relaxed">
                  {String(raw.resolution_notes)}
                </div>
              </div>
            )}
          </>
        )}

        {item.type === "facility" && (
          <>
            <div className="flex items-center gap-2 flex-wrap">
              <span className="text-[11px] font-semibold bg-cyan-500/15 text-cyan-400 rounded-full px-2.5 py-0.5">
                {String(raw.category || "General")}
              </span>
              {raw.priority && (
                <span
                  className={cn(
                    "text-[11px] font-medium rounded-full px-2.5 py-0.5",
                    PRIORITY_BADGE[String(raw.priority)] ?? "bg-zinc-500/15 text-zinc-400"
                  )}
                >
                  {String(raw.priority)} Priority
                </span>
              )}
            </div>
            <Detail label="Location" value={String(raw.location || "—")} />
            <Detail label="Description" value={String(raw.description || "—")} />
            {raw.resolution_notes && (
              <div>
                <p className="text-[10px] uppercase tracking-wide text-muted-foreground/60 mb-1">
                  Resolution Notes
                </p>
                <div className="rounded-lg bg-emerald-500/5 border border-emerald-500/15 px-3 py-2 text-[12px] text-foreground/80 leading-relaxed">
                  {String(raw.resolution_notes)}
                </div>
              </div>
            )}
          </>
        )}

        {item.type === "parking" && (
          <>
            <div className="flex items-center gap-2 flex-wrap">
              <span className="text-[11px] font-semibold bg-teal-500/15 text-teal-400 rounded-full px-2.5 py-0.5">
                {String(raw.vehicle_type || "Vehicle")}
              </span>
            </div>
            <div className="grid grid-cols-2 gap-4">
              <Detail label="Vehicle Details" value={`${raw.vehicle_make || ""} ${raw.vehicle_model || ""}`.trim() || "—"} />
              <Detail label="Vehicle Number" value={String(raw.vehicle_number || "—")} />
            </div>
            <div className="grid grid-cols-2 gap-4">
              <Detail label="Sticker Number" value={String(raw.sticker_number || "Pending")} />
              {raw.valid_from && (
                <Detail
                  label="Validity Period"
                  value={`${String(raw.valid_from).slice(0, 10)} to ${raw.valid_until ? String(raw.valid_until).slice(0, 10) : "—"}`}
                />
              )}
            </div>
          </>
        )}

        {item.type === "leave" && (
          <>
            <div className="flex items-center gap-2 flex-wrap">
              <span className="text-[11px] font-semibold bg-emerald-500/15 text-emerald-400 rounded-full px-2.5 py-0.5">
                {String(raw.leave_type || "Leave")}
              </span>
              <span className="text-[11px] bg-zinc-500/15 text-zinc-400 rounded-full px-2.5 py-0.5">
                {raw.days} Day(s)
              </span>
            </div>
            <div className="grid grid-cols-2 gap-4">
              <Detail label="Start Date" value={raw.start_date ? String(raw.start_date).slice(0, 10) : "—"} />
              <Detail label="End Date" value={raw.end_date ? String(raw.end_date).slice(0, 10) : "—"} />
            </div>
            <Detail label="Reason for Leave" value={String(raw.reason || "—")} />
          </>
        )}

        {item.type === "expense" && (
          <>
            <div className="flex items-center gap-2 flex-wrap">
              <span className="text-[11px] font-semibold bg-indigo-500/15 text-indigo-400 rounded-full px-2.5 py-0.5">
                {String(raw.type || "Reimbursement")}
              </span>
              <span className="text-[11px] font-bold bg-white/5 border border-[var(--border)] rounded-full px-2.5 py-0.5">
                ${raw.amount}
              </span>
            </div>
            <Detail label="Reason" value={String(raw.reason || "—")} />
            {raw.approved_by && (
              <Detail label="Approved/Processed By" value={String(raw.approved_by)} />
            )}
          </>
        )}

        {item.type === "travel_request" && (
          <>
            <div className="flex items-center gap-2 flex-wrap">
              <span className={cn("text-[11px] font-semibold rounded-full px-2.5 py-0.5", raw.is_international ? "bg-fuchsia-500/15 text-fuchsia-400" : "bg-blue-500/15 text-blue-400")}>
                {raw.is_international ? "International Travel" : "Domestic Travel"}
              </span>
              <span className="text-[11px] bg-zinc-500/15 text-zinc-400 rounded-full px-2.5 py-0.5">
                Mode: {String(raw.mode_of_travel || "—")}
              </span>
              {raw.accommodation_required && (
                <span className="text-[11px] bg-cyan-500/15 text-cyan-400 rounded-full px-2.5 py-0.5">
                  Hotel Required
                </span>
              )}
            </div>
            <div className="grid grid-cols-2 gap-4">
              <Detail label="From" value={String(raw.from_location || "—")} />
              <Detail label="Destination" value={String(raw.to_destination || "—")} />
            </div>
            <div className="grid grid-cols-2 gap-4">
              <Detail label="Travel Date" value={raw.travel_date ? String(raw.travel_date).slice(0, 10) : "—"} />
              <Detail label="Return Date" value={raw.return_date ? String(raw.return_date).slice(0, 10) : "—"} />
            </div>
            <div className="grid grid-cols-2 gap-4">
              <Detail label="Estimated Cost" value={raw.estimated_cost ? `$${raw.estimated_cost}` : "—"} />
              <Detail label="Expense Limit Allocated" value={raw.expense_limit ? `${raw.expense_limit_currency || "INR"} ${raw.expense_limit.toLocaleString()}` : "—"} />
            </div>
            {raw.notes && <Detail label="Travel Justification/Notes" value={String(raw.notes)} />}
            {(raw.ticket_details || raw.hotel_details || raw.visa_status) && (
              <div className="border-t border-[var(--border)] pt-2.5 mt-2 space-y-2">
                <p className="text-[11px] font-semibold text-foreground">Travel Booking Details</p>
                <div className="grid grid-cols-3 gap-4">
                  <Detail label="Ticket Details" value={String(raw.ticket_details || "—")} />
                  <Detail label="Hotel Details" value={String(raw.hotel_details || "—")} />
                  {raw.visa_required && (
                    <Detail label="Visa Status" value={String(raw.visa_status || "Pending")} />
                  )}
                </div>
              </div>
            )}
          </>
        )}

        {item.type === "travel_expense" && (
          <>
            <div className="flex items-center gap-2 flex-wrap">
              <span className="text-[11px] font-semibold bg-fuchsia-500/15 text-fuchsia-400 rounded-full px-2.5 py-0.5">
                Travel Expense Claim
              </span>
              <span className="text-[11px] font-bold bg-white/5 border border-[var(--border)] rounded-full px-2.5 py-0.5">
                Claim Amount: ${raw.amount}
              </span>
              <span className="text-[11px] text-muted-foreground">
                Req ID: {String(raw.travel_request_id || "—")}
              </span>
            </div>
            <Detail label="Breakdown" value={String(raw.breakdown || "—")} />
            {raw.over_limit_reason && (
              <Detail label="Over-Limit Justification" value={String(raw.over_limit_reason)} />
            )}
            {raw.approved_by && (
              <Detail label="Approved/Processed By" value={String(raw.approved_by)} />
            )}
            {raw.rejection_reason && (
              <div className="rounded-lg bg-rose-500/5 border border-rose-500/15 px-3 py-2 text-[12px] text-rose-400 mt-2">
                <p className="text-[10px] uppercase tracking-wide text-rose-400/60 mb-0.5">Rejection Reason</p>
                {String(raw.rejection_reason)}
              </div>
            )}
          </>
        )}

        {item.type === "udemy" && (
          <>
            <div className="flex items-center gap-2 flex-wrap">
              <span className="text-[11px] font-semibold bg-orange-500/15 text-orange-400 rounded-full px-2.5 py-0.5">
                {String(raw.platform || "Udemy")}
              </span>
            </div>
            <Detail label="Course Name" value={String(raw.course_name || "—")} />
            <Detail label="Justification" value={String(raw.justification || "—")} />
            {raw.decided_by && (
              <Detail label="Decided By" value={String(raw.decided_by)} />
            )}
            {raw.decision_reason && (
              <div className="rounded-lg bg-white/5 border border-[var(--border)] px-3 py-2 text-[12px] text-foreground/80 leading-relaxed mt-2">
                <p className="text-[10px] uppercase tracking-wide text-muted-foreground/60 mb-0.5">Decision Details</p>
                {String(raw.decision_reason)}
              </div>
            )}
          </>
        )}
      </div>

      {/* Status indicator on right side */}
      <div className="w-48 shrink-0 flex flex-col items-start gap-2">
        <p className="text-[10px] uppercase tracking-wide text-muted-foreground/60">Current Status</p>
        <StatusBadge status={item.status} className="px-3 py-1.5 text-[12px]" />
        {isFinal && (
          <div className="flex items-center gap-1.5 text-emerald-400 text-[12px] mt-1">
            <CheckCircle2 className="h-3.5 w-3.5" />
            <span>This request has been resolved</span>
          </div>
        )}
        {item.created_at && (
          <div className="mt-2">
            <p className="text-[10px] uppercase tracking-wide text-muted-foreground/60 mb-0.5">Submitted</p>
            <p className="text-[12px] text-foreground/70">{item.created_at.slice(0, 10)}</p>
          </div>
        )}
      </div>
    </div>
  );
}
