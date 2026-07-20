import { useAuth } from "@/lib/auth-store";
import { useState, useEffect, useCallback, useMemo, useRef } from "react";
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
  Search,
  X,
  ClipboardList,
  Headset,
  ExternalLink,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { toast } from "sonner";
import { StatusBadge } from "@/components/ui/StatusBadge";
import { motion, AnimatePresence } from "framer-motion";

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
  | "udemy"
  | "form"
  | "it_ticket";

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
  /** Set only for `type === "form"` — identifies the originating Form Library template. */
  formTemplateId?: number;
  formName?: string;
  /** Set only for `type === "it_ticket"` when synced — e.g. "RE-7964" from ManageEngine. */
  externalRefId?: string;
}

// ManageEngine ServiceDesk — IT tickets live here, not in our own DB, so every IT-ticket
// link points out to it rather than an in-app detail view.
const MANAGE_ENGINE_BASE = "https://helpdesk.alignedautomation.com";
const MANAGE_ENGINE_LIST_URL = `${MANAGE_ENGINE_BASE}/WOListView.do`;
function manageEngineTicketUrl(externalRefId?: string): string {
  const numericId = (externalRefId || "").replace(/\D/g, "");
  return numericId
    ? `${MANAGE_ENGINE_BASE}/WorkOrder.do?woMode=viewWO&woID=${numericId}`
    : MANAGE_ENGINE_LIST_URL;
}

// ── Constants & Mappings ──────────────────────────────────────────────────────

const TYPE_LABEL: Record<RequestType, string> = {
  escalation: "Escalation",
  document: "Document Request",
  query: "HR Query",
  grievance: "Grievance",
  facility: "Facility Issue",
  parking: "Parking Permit",
  leave: "Leave Request",
  expense: "Expense Claim",
  travel_request: "Travel Request",
  travel_expense: "Travel Expense",
  udemy: "Udemy License",
  form: "Form Submission",
  it_ticket: "IT Ticket",
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
  form: ClipboardList,
  it_ticket: Headset,
};

const PRIORITY_BADGE: Record<string, string> = {
  Low: "bg-zinc-500/10 text-zinc-400 border border-zinc-500/15",
  Normal: "bg-zinc-500/10 text-zinc-400 border border-zinc-500/15",
  Medium: "bg-amber-500/10 text-amber-500 border border-amber-500/15",
  High: "bg-rose-500/10 text-rose-500 border border-rose-500/15",
};

// 4C Domains mapping for requests
const COLOR_4C: Record<
  RequestType,
  { name: string; color: string; border: string; bg: string; text: string }
> = {
  leave: {
    name: "Collaboration",
    color: "text-emerald-500",
    border: "border-l-4 border-l-emerald-500",
    bg: "bg-emerald-500/10",
    text: "text-emerald-500",
  },
  grievance: {
    name: "Collaboration",
    color: "text-emerald-500",
    border: "border-l-4 border-l-emerald-500",
    bg: "bg-emerald-500/10",
    text: "text-emerald-500",
  },

  travel_request: {
    name: "Connectivity",
    color: "text-cyan-500",
    border: "border-l-4 border-l-cyan-500",
    bg: "bg-cyan-500/10",
    text: "text-cyan-500",
  },
  travel_expense: {
    name: "Connectivity",
    color: "text-cyan-500",
    border: "border-l-4 border-l-cyan-500",
    bg: "bg-cyan-500/10",
    text: "text-cyan-500",
  },
  facility: {
    name: "Connectivity",
    color: "text-cyan-500",
    border: "border-l-4 border-l-cyan-500",
    bg: "bg-cyan-500/10",
    text: "text-cyan-500",
  },
  parking: {
    name: "Connectivity",
    color: "text-cyan-500",
    border: "border-l-4 border-l-cyan-500",
    bg: "bg-cyan-500/10",
    text: "text-cyan-500",
  },
  it_ticket: {
    name: "Connectivity",
    color: "text-cyan-500",
    border: "border-l-4 border-l-cyan-500",
    bg: "bg-cyan-500/10",
    text: "text-cyan-500",
  },

  expense: {
    name: "Capacity",
    color: "text-pink-500",
    border: "border-l-4 border-l-pink-500",
    bg: "bg-pink-500/10",
    text: "text-pink-500",
  },
  udemy: {
    name: "Capacity",
    color: "text-pink-500",
    border: "border-l-4 border-l-pink-500",
    bg: "bg-pink-500/10",
    text: "text-pink-500",
  },

  escalation: {
    name: "Clarity",
    color: "text-indigo-500",
    border: "border-l-4 border-l-indigo-500",
    bg: "bg-indigo-500/10",
    text: "text-indigo-500",
  },
  document: {
    name: "Clarity",
    color: "text-indigo-500",
    border: "border-l-4 border-l-indigo-500",
    bg: "bg-indigo-500/10",
    text: "text-indigo-500",
  },
  query: {
    name: "Clarity",
    color: "text-indigo-500",
    border: "border-l-4 border-l-indigo-500",
    bg: "bg-indigo-500/10",
    text: "text-indigo-500",
  },

  // Admin-defined Form Library submissions — Capacity domain, distinct violet accent.
  form: {
    name: "Capacity",
    color: "text-violet-500",
    border: "border-l-4 border-l-violet-500",
    bg: "bg-violet-500/10",
    text: "text-violet-500",
  },
};

type StatusFilter = "all" | "open" | "closed" | "in-progress";

const STATUS_FILTERS: { key: StatusFilter; label: string; icon: React.ElementType }[] = [
  { key: "all", label: "All", icon: Filter },
  { key: "open", label: "Open", icon: CircleDot },
  { key: "in-progress", label: "In Progress", icon: Clock },
  { key: "closed", label: "Closed", icon: XCircle },
];

const OPEN_STATUSES = ["open", "pending approval", "draft", "pending", "pending_rm", "pending_fm"];
const CLOSED_STATUSES = [
  "resolved",
  "closed",
  "verified",
  "approved",
  "completed",
  "cancelled",
  "finance_processed",
  "rejected",
];
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
  "awaiting approval",
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
  // "all" | a static RequestType | `form-<templateId>` for a specific Form Library form.
  const [typeFilter, setTypeFilter] = useState<string>("all");
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("all");
  const [searchQuery, setSearchQuery] = useState("");
  // Date-range filter (YYYY-MM-DD inclusive) — driven by the copilot sidebar
  // (centriq:requests-filter) and clearable from the header chip.
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  const [rangeLabel, setRangeLabel] = useState("");
  const [expanded, setExpanded] = useState<string | null>(null);
  const [typeDropdownOpen, setTypeDropdownOpen] = useState(false);

  const typeDropdownRef = useRef<HTMLDivElement>(null);

  // Close type dropdown on click outside
  useEffect(() => {
    const handleClick = (e: MouseEvent) => {
      if (typeDropdownRef.current && !typeDropdownRef.current.contains(e.target as Node)) {
        setTypeDropdownOpen(false);
      }
    };
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, []);

  // Listen for filter events dispatched by the chat intercept. A status-only payload
  // (legacy deep-link from other pages) just sets the status; a richer payload from the
  // My Requests sidebar applies type + status + date range as one fresh filter.
  useEffect(() => {
    const handler = (e: Event) => {
      const detail =
        (
          e as CustomEvent<{
            status?: StatusFilter;
            type?: string;
            dateFrom?: string;
            dateTo?: string;
            rangeLabel?: string;
          }>
        ).detail || {};
      // Legacy: status-only payload (no `type` key) — set status alone, leave the rest.
      if (detail.type === undefined && detail.dateFrom === undefined) {
        if (detail.status) setStatusFilter(detail.status);
        return;
      }
      // Full filter: apply every dimension wholesale so each command is a clean slate.
      setTypeFilter(detail.type ?? "all");
      setStatusFilter(detail.status ?? "all");
      setDateFrom(detail.dateFrom ?? "");
      setDateTo(detail.dateTo ?? "");
      setRangeLabel(detail.rangeLabel ?? "");
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
    [user?.email, user?.role],
  );

  const fetchAll = useCallback(async () => {
    if (!user?.email) return;
    setLoading(true);
    try {
      const [reqsRes, docRes] = await Promise.all([
        fetch("/api/employees/me/requests", { headers: authHeaders }),
        fetch("/api/documents/list", { headers: authHeaders }),
      ]);

      const [reqsData, docData] = (await Promise.all([
        reqsRes.ok ? reqsRes.json() : {},
        docRes.ok ? docRes.json() : { results: [] },
      ])) as [any, any];

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
        // Documents
        ...(docData.results ?? [])
          .filter(
            (d: Record<string, unknown>) =>
              String(d.generated_by_email ?? "").toLowerCase() === userEmail ||
              String(d.subject_email ?? "").toLowerCase() === userEmail,
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
        // IT Tickets — the real state lives in ManageEngine ServiceDesk; we show our local
        // record plus the synced reference id (when the backend has managed to match it).
        ...(reqsData.it_tickets ?? []).map((t: Record<string, unknown>) => ({
          key: `it-${t.id}`,
          type: "it_ticket" as RequestType,
          reference_id: String(t.ticket_id ?? `IT-${t.id}`),
          subject: String(t.subject ?? "IT Support Ticket"),
          description: String(t.description ?? ""),
          status: String(t.status ?? "Open"),
          priority: String(t.priority ?? "Medium"),
          created_at: String(t.created_at ?? ""),
          raw: t,
          externalRefId: t.external_ref_id ? String(t.external_ref_id) : undefined,
        })),
        // Dynamic Form Library submissions — one entry per submission, labelled by its form.
        ...(reqsData.form_submissions ?? []).map((s: Record<string, unknown>) => {
          const values = (s.field_values ?? {}) as Record<string, unknown>;
          const preview = Object.values(values)
            .map((v) => (Array.isArray(v) ? v.join(", ") : String(v ?? "")))
            .filter(Boolean)
            .slice(0, 3)
            .join(" · ");
          return {
            key: `form-${s.id}`,
            type: "form" as RequestType,
            reference_id: String(s.reference_id ?? `FRM-${s.id}`),
            subject: String(s.form_name ?? "Form Submission"),
            description: preview || "No details provided",
            status: String(s.status ?? "Pending"),
            created_at: String(s.submitted_at ?? ""),
            raw: s,
            formTemplateId: typeof s.form_template_id === "number" ? s.form_template_id : undefined,
            formName: String(s.form_name ?? "Form Submission"),
          };
        }),
      ];

      normalized.sort(
        (a, b) => new Date(b.created_at || 0).getTime() - new Date(a.created_at || 0).getTime(),
      );
      setItems(normalized);
    } catch {
      toast.error("Failed to load requests dashboard");
    } finally {
      setLoading(false);
    }
  }, [authHeaders, user?.email]);

  useEffect(() => {
    fetchAll();
  }, [fetchAll]);

  // Filtered items (by Type, Status, and Search Query)
  const filtered = useMemo(() => {
    return items.filter((i) => {
      if (typeFilter !== "all") {
        if (typeFilter.startsWith("form-")) {
          // A specific Form Library form selected.
          if (!(i.type === "form" && `form-${i.formTemplateId}` === typeFilter)) return false;
        } else if (i.type !== typeFilter) {
          return false;
        }
      }
      if (!matchesStatusFilter(i.status, statusFilter)) return false;
      if (dateFrom || dateTo) {
        const d = (i.created_at || "").slice(0, 10);
        if (!d) return false;
        if (dateFrom && d < dateFrom) return false;
        if (dateTo && d > dateTo) return false;
      }
      if (searchQuery.trim()) {
        const q = searchQuery.toLowerCase();
        const subjectMatch = i.subject.toLowerCase().includes(q);
        const refMatch = i.reference_id.toLowerCase().includes(q);
        const descMatch = i.description.toLowerCase().includes(q);
        if (!subjectMatch && !refMatch && !descMatch) return false;
      }
      return true;
    });
  }, [items, typeFilter, statusFilter, searchQuery, dateFrom, dateTo]);

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
    form: items.filter((i) => i.type === "form").length,
    it_ticket: items.filter((i) => i.type === "it_ticket").length,
  };

  // Distinct Form Library forms the user has submitted — each becomes its own filter option,
  // so any new admin-defined form shows up here automatically once it's been submitted.
  const formGroups = useMemo(() => {
    const m = new Map<number, { id: number; name: string; count: number }>();
    for (const i of items) {
      if (i.type === "form" && typeof i.formTemplateId === "number") {
        const g = m.get(i.formTemplateId);
        if (g) g.count += 1;
        else
          m.set(i.formTemplateId, { id: i.formTemplateId, name: i.formName || "Form", count: 1 });
      }
    }
    return Array.from(m.values()).sort((a, b) => a.name.localeCompare(b.name));
  }, [items]);

  // Status counts
  const statusCounts = {
    all: items.length,
    open: items.filter((i) => matchesStatusFilter(i.status, "open")).length,
    "in-progress": items.filter((i) => matchesStatusFilter(i.status, "in-progress")).length,
    closed: items.filter((i) => matchesStatusFilter(i.status, "closed")).length,
  };

  const TYPE_OPTIONS: { key: string; label: string }[] = [
    { key: "all", label: `All Requests (${counts.all})` },
    { key: "leave", label: `Leaves (${counts.leave})` },
    { key: "travel_request", label: `Travel Requests (${counts.travel_request})` },
    { key: "travel_expense", label: `Travel Expenses (${counts.travel_expense})` },
    { key: "expense", label: `Expense Claims (${counts.expense})` },
    { key: "udemy", label: `Udemy Licenses (${counts.udemy})` },
    { key: "it_ticket", label: `IT Tickets (${counts.it_ticket})` },
    { key: "facility", label: `Facility Issues (${counts.facility})` },
    { key: "parking", label: `Parking Permits (${counts.parking})` },
    { key: "query", label: `HR Queries (${counts.query})` },
    { key: "escalation", label: `Escalations (${counts.escalation})` },
    { key: "grievance", label: `Grievances (${counts.grievance})` },
    { key: "document", label: `Documents (${counts.document})` },
    // One option per Form Library form the user has submitted (added automatically).
    ...formGroups.map((g) => ({ key: `form-${g.id}`, label: `${g.name} (${g.count})` })),
  ];

  // Label shown on the collapsed dropdown button for the active type filter.
  const activeTypeLabel =
    typeFilter === "all"
      ? "All Request Types"
      : (TYPE_OPTIONS.find((o) => o.key === typeFilter)?.label.split(" (")[0] ??
        TYPE_LABEL[typeFilter as RequestType] ??
        "Filtered");

  return (
    <div className="flex flex-col h-full overflow-hidden relative select-none">
      {/* Decorative corporate hex mesh overlay */}
      <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_top,_var(--tw-gradient-stops))] from-primary/5 via-transparent to-transparent pointer-events-none -z-10" />
      <div
        className="absolute inset-0 pointer-events-none opacity-[0.02] -z-10"
        style={{
          backgroundImage: `url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='60' height='60'%3E%3Cpath d='M30 0 L60 15 L60 45 L30 60 L0 45 L0 15 Z' fill='none' stroke='currentColor' stroke-width='1'/%3E%3C/svg%3E")`,
          backgroundSize: "60px 60px",
        }}
      />

      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between px-4 sm:px-8 py-4 sm:py-6 border-b border-border/40 shrink-0 gap-4">
        <div>
          <p className="text-[11px] sm:text-xs md:text-sm text-muted-foreground mt-0.5 font-medium">
            Monitor and track your leaves, expenses, travel bookings, and support tickets in one
            place.
          </p>
          <a
            href={MANAGE_ENGINE_LIST_URL}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-1.5 text-[11px] sm:text-xs text-cyan-500 hover:text-cyan-400 font-semibold mt-1.5"
          >
            IT tickets are managed in ManageEngine ServiceDesk
            <ExternalLink className="h-3 w-3" />
          </a>
        </div>
        <button
          onClick={fetchAll}
          className="self-start sm:self-auto flex items-center gap-2 rounded-xl px-3 py-1.5 sm:px-4 sm:py-2 text-xs font-semibold text-foreground/80 hover:text-foreground bg-muted/40 hover:bg-muted/70 transition-all border border-border/50 shadow-sm cursor-pointer"
        >
          <RefreshCw className="h-3.5 w-3.5" />
          <span>Refresh</span>
        </button>
      </div>

      {/* Redesigned Unified Control Row */}
      <div className="flex flex-col lg:flex-row lg:items-center justify-between px-4 sm:px-8 py-4 shrink-0 gap-4 border-b border-border/30 bg-muted/5">
        {/* Left Side: Status Tabs (All, Open, In Progress, Closed) */}
        <div className="flex overflow-x-auto no-scrollbar flex-nowrap gap-1 bg-muted/40 p-1 rounded-2xl border border-border/40 w-full lg:w-auto relative select-none">
          {STATUS_FILTERS.map((f) => {
            const active = statusFilter === f.key;
            return (
              <button
                key={f.key}
                onClick={() => setStatusFilter(f.key)}
                className={cn(
                  "relative flex-initial flex items-center justify-center gap-1 sm:gap-2 px-3 py-1.5 sm:px-4 sm:py-2 rounded-xl text-[11px] sm:text-xs font-bold transition-all cursor-pointer shrink-0 whitespace-nowrap",
                  active
                    ? "text-primary shadow-sm bg-background border border-border/60"
                    : "text-muted-foreground hover:text-foreground",
                )}
              >
                <f.icon className="h-3.5 w-3.5 shrink-0 hidden sm:inline-block" />
                <span>
                  {f.key === "in-progress" ? (
                    <>
                      <span className="hidden sm:inline">In </span>Progress
                    </>
                  ) : (
                    f.label
                  )}
                </span>
                <span
                  className={cn(
                    "text-[9px] font-black rounded-full px-1.5 py-0.5 shrink-0",
                    active ? "bg-primary/20 text-primary" : "bg-muted text-muted-foreground",
                  )}
                >
                  {statusCounts[f.key]}
                </span>
              </button>
            );
          })}
        </div>

        {/* Right Side: Search Input + Custom Popover Filter Dropdown */}
        <div className="flex flex-col sm:flex-row items-center gap-3 w-full lg:w-auto">
          {/* Search Field */}
          <div className="relative flex items-center w-full sm:w-64">
            <Search className="absolute left-3.5 h-3.5 w-3.5 text-muted-foreground pointer-events-none" />
            <input
              type="text"
              placeholder="Search request ID or title..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="w-full bg-muted/30 border border-border/50 hover:border-primary/20 focus:border-primary/45 focus:bg-background text-xs text-foreground placeholder:text-muted-foreground/60 rounded-xl pl-9.5 pr-8.5 py-2.5 focus:outline-none transition-all"
            />
            {searchQuery && (
              <button
                onClick={() => setSearchQuery("")}
                className="absolute right-2.5 p-1 rounded-md text-muted-foreground/60 hover:text-foreground hover:bg-muted/50 transition-all cursor-pointer"
              >
                <X className="h-3.5 w-3.5" />
              </button>
            )}
          </div>

          {/* Type popover dropdown */}
          <div className="relative w-full sm:w-56" ref={typeDropdownRef}>
            <button
              onClick={() => setTypeDropdownOpen(!typeDropdownOpen)}
              className="w-full flex items-center justify-between gap-2.5 rounded-xl border border-border/60 bg-card/45 hover:bg-muted/40 px-4 py-2.5 text-xs font-semibold text-foreground/80 hover:text-foreground transition-all cursor-pointer shadow-sm"
            >
              <div className="flex items-center gap-2 truncate">
                <Filter className="h-3.5 w-3.5 text-primary shrink-0" />
                <span className="truncate">{activeTypeLabel}</span>
              </div>
              <ChevronDown
                className={cn(
                  "h-3.5 w-3.5 opacity-55 transition-transform duration-200",
                  typeDropdownOpen && "rotate-180",
                )}
              />
            </button>

            <AnimatePresence>
              {typeDropdownOpen && (
                <motion.div
                  initial={{ opacity: 0, y: 8, scale: 0.95 }}
                  animate={{ opacity: 1, y: 0, scale: 1 }}
                  exit={{ opacity: 0, y: 8, scale: 0.95 }}
                  transition={{ duration: 0.15, ease: [0.16, 1, 0.3, 1] }}
                  className="absolute right-0 mt-2 w-full sm:w-64 z-20 rounded-2xl border border-border/60 bg-popover/95 backdrop-blur-xl p-2 shadow-2xl max-h-72 overflow-y-auto no-scrollbar"
                >
                  <div className="px-3.5 py-1.5 border-b border-border/40 mb-1 flex items-center gap-1.5">
                    <span className="text-[9px] font-bold uppercase tracking-[0.12em] text-muted-foreground/60">
                      Filter by Category
                    </span>
                  </div>

                  {TYPE_OPTIONS.map((opt) => {
                    const active = typeFilter === opt.key;
                    const TIcon =
                      opt.key === "all"
                        ? Filter
                        : opt.key.startsWith("form-")
                          ? ClipboardList
                          : TYPE_ICON[opt.key as RequestType];

                    return (
                      <button
                        key={opt.key}
                        onClick={() => {
                          setTypeFilter(opt.key);
                          setTypeDropdownOpen(false);
                        }}
                        className={cn(
                          "w-full flex items-center justify-between gap-2 px-3 py-2 text-xs rounded-xl transition-all text-left",
                          active
                            ? "bg-primary/10 text-primary font-bold"
                            : "text-foreground/75 hover:bg-muted/65 hover:text-foreground",
                        )}
                      >
                        <div className="flex items-center gap-2 truncate">
                          <TIcon
                            className={cn(
                              "h-3.5 w-3.5 shrink-0",
                              active ? "text-primary" : "text-muted-foreground/70",
                            )}
                          />
                          <span className="truncate">{opt.label.split(" (")[0]}</span>
                        </div>
                        <span
                          className={cn(
                            "text-[9px] font-black rounded-full px-1.5 py-0.5",
                            active
                              ? "bg-primary/20 text-primary"
                              : "bg-muted text-muted-foreground",
                          )}
                        >
                          {opt.label.includes("(") ? opt.label.match(/\((\d+)\)/)?.[1] : counts.all}
                        </span>
                      </button>
                    );
                  })}
                </motion.div>
              )}
            </AnimatePresence>
          </div>
        </div>
      </div>

      {/* Active date-range chip (driven by the copilot sidebar) */}
      {(dateFrom || dateTo) && (
        <div className="flex items-center gap-2 px-4 sm:px-8 py-2.5 shrink-0 border-b border-border/30 bg-muted/5">
          <span className="text-[10px] font-black uppercase tracking-wider text-muted-foreground/70">
            Date
          </span>
          <span className="inline-flex items-center gap-1.5 rounded-full border border-primary/30 bg-primary/10 px-2.5 py-1 text-[12px] font-bold text-primary">
            <CalendarDays className="h-3.5 w-3.5" />
            {rangeLabel || `${dateFrom || "…"} → ${dateTo || "…"}`}
            <button
              onClick={() => {
                setDateFrom("");
                setDateTo("");
                setRangeLabel("");
              }}
              className="ml-0.5 rounded-full hover:bg-primary/20 p-0.5 transition-colors"
              title="Clear date filter"
            >
              <X className="h-3 w-3" />
            </button>
          </span>
        </div>
      )}

      {/* Redesigned Cards Grid List */}
      <div className="flex-1 overflow-y-auto px-4 sm:px-8 py-4 sm:py-6 no-scrollbar">
        {loading ? (
          <div className="flex h-56 items-center justify-center">
            <Loader2 className="h-6 w-6 animate-spin text-primary" />
          </div>
        ) : filtered.length === 0 ? (
          <div className="flex flex-col h-56 items-center justify-center gap-2 text-muted-foreground/60">
            <Inbox className="h-7 w-7 opacity-75" />
            <span className="text-xs font-semibold">
              {items.length === 0
                ? "You haven't submitted any requests yet"
                : "No requests matching the active filters"}
            </span>
          </div>
        ) : (
          <div className="space-y-4 max-w-6xl mx-auto pb-12">
            {filtered.map((item) => {
              const isExpanded = expanded === item.key;
              const meta4C = COLOR_4C[item.type];
              const TIcon = TYPE_ICON[item.type];

              return (
                <div
                  key={item.key}
                  className={cn(
                    "border border-border/40 bg-card/45 backdrop-blur-md rounded-2xl overflow-hidden transition-all duration-200",
                    isExpanded
                      ? "shadow-xl border-primary/20 ring-1 ring-primary/5 bg-card/85"
                      : "hover:scale-[1.008] hover:bg-card/75 hover:shadow-md",
                  )}
                >
                  {/* Card Main Summary Header */}
                  <div
                    onClick={() => setExpanded(isExpanded ? null : item.key)}
                    className={cn(
                      "p-4 md:p-5 flex flex-col md:flex-row md:items-center justify-between gap-4 cursor-pointer select-none",
                      meta4C?.border,
                    )}
                  >
                    {/* Left Details */}
                    <div className="flex items-center gap-4 min-w-0 flex-1">
                      <div
                        className={cn(
                          "h-10 w-10 rounded-xl flex items-center justify-center shrink-0 shadow-inner",
                          meta4C?.bg,
                        )}
                      >
                        <TIcon className={cn("h-5 w-5", meta4C?.color)} />
                      </div>
                      <div className="min-w-0 flex-1 space-y-0.5">
                        <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                          <span
                            className={cn(
                              "text-[10px] font-extrabold uppercase tracking-widest px-2 py-0.5 rounded-full border",
                              badgeClass(meta4C.name),
                            )}
                          >
                            {meta4C.name} • {TYPE_LABEL[item.type]}
                          </span>
                          <span className="text-[10px] font-bold text-muted-foreground font-mono">
                            {item.reference_id}
                          </span>
                          {item.priority && (
                            <span
                              className={cn(
                                "rounded-full px-2 py-0.5 text-[9px] font-extrabold uppercase tracking-wider md:hidden",
                                PRIORITY_BADGE[item.priority],
                              )}
                            >
                              {item.priority}
                            </span>
                          )}
                        </div>
                        <h3 className="text-[13px] md:text-sm font-bold text-foreground truncate">
                          {item.subject}
                        </h3>
                        <p className="text-xs text-muted-foreground truncate font-medium">
                          {item.description}
                        </p>
                      </div>
                    </div>

                    {/* Middle: Priority & Theme Info */}
                    <div className="hidden md:flex items-center gap-3 shrink-0">
                      {item.priority ? (
                        <span
                          className={cn(
                            "rounded-full px-2 py-0.5 text-[10px] font-bold",
                            PRIORITY_BADGE[item.priority],
                          )}
                        >
                          {item.priority}
                        </span>
                      ) : (
                        <span className="text-muted-foreground/30 text-xs font-semibold">—</span>
                      )}
                    </div>

                    {/* Right: Status, Date & Chevron */}
                    <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 md:justify-end gap-5 shrink-0 border-t md:border-t-0 border-border/30 pt-3.5 md:pt-0">
                      <div className="text-left md:text-right space-y-0.5">
                        <StatusBadge
                          status={item.status}
                          className="px-2.5 py-0.5 text-[11px] font-bold shadow-xs"
                        />
                        <p className="text-[10px] text-muted-foreground/70 font-semibold">
                          {item.created_at ? item.created_at.slice(0, 10) : "—"}
                        </p>
                      </div>
                      <ChevronDown
                        className={cn(
                          "h-4 w-4 text-muted-foreground/50 transition-all duration-200 shrink-0",
                          isExpanded && "rotate-180 text-primary",
                        )}
                      />
                    </div>
                  </div>

                  {/* Expanded Detail Panel */}
                  <AnimatePresence>
                    {isExpanded && (
                      <motion.div
                        initial={{ opacity: 0, height: 0 }}
                        animate={{ opacity: 1, height: "auto" }}
                        exit={{ opacity: 0, height: 0 }}
                        transition={{ duration: 0.2, ease: "easeInOut" }}
                        className="border-t border-border/40"
                      >
                        <DetailPanel item={item} />
                      </motion.div>
                    )}
                  </AnimatePresence>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}

// Turn a stored snake_case field name into a readable label ("vehicle_number" → "Vehicle Number").
function humanizeFieldName(name: string): string {
  return name
    .replace(/[_-]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/\b\w/g, (c) => c.toUpperCase());
}

// 4C pill color codes helpers
function badgeClass(domainName: string) {
  if (domainName === "Collaboration")
    return "bg-emerald-500/10 text-emerald-500 border-emerald-500/20";
  if (domainName === "Connectivity") return "bg-cyan-500/10 text-cyan-500 border-cyan-500/20";
  if (domainName === "Capacity") return "bg-pink-500/10 text-pink-500 border-pink-500/20";
  return "bg-indigo-500/10 text-indigo-500 border-indigo-500/20";
}

// ── Detail Panel ──────────────────────────────────────────────────────────────

function DetailPanel({ item }: { item: RequestItem }) {
  const raw = item.raw;
  const isFinal = CLOSED_STATUSES.includes(item.status.toLowerCase());

  const Detail = ({ label, value }: { label: string; value: React.ReactNode }) =>
    value ? (
      <div className="space-y-0.5">
        <p className="text-[10px] uppercase tracking-wider text-muted-foreground/60 font-bold">
          {label}
        </p>
        <p className="text-xs font-semibold text-foreground leading-relaxed">{value}</p>
      </div>
    ) : null;

  return (
    <div className="flex flex-col md:flex-row gap-6 p-5 md:p-6 bg-muted/15 border-t border-border/20 select-none">
      {/* Detailed Fields */}
      <div className="flex-1 min-w-0 space-y-4">
        {item.type === "escalation" && (
          <>
            {raw.error_type && (
              <span className="inline-block rounded-full bg-rose-500/15 text-rose-400 px-2.5 py-0.5 text-[11px] font-semibold capitalize border border-rose-500/20">
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
              <span className="text-[11px] font-semibold bg-sky-500/15 text-sky-400 rounded-full px-2.5 py-0.5 border border-sky-500/20">
                {String(raw.category || "")}
              </span>
              {!!raw.priority && (
                <span
                  className={cn(
                    "text-[11px] font-medium rounded-full px-2.5 py-0.5",
                    PRIORITY_BADGE[String(raw.priority)] ?? "bg-zinc-500/15 text-zinc-400",
                  )}
                >
                  {String(raw.priority)}
                </span>
              )}
            </div>
            <Detail label="Subject" value={String(raw.subject || "")} />
            <Detail label="Description" value={String(raw.description || "")} />
            {raw.response && (
              <div className="space-y-1">
                <p className="text-[10px] uppercase tracking-wide text-muted-foreground/60 font-bold mb-1">
                  Response
                </p>
                <div className="rounded-xl bg-emerald-500/5 border border-emerald-500/15 px-3.5 py-2.5 text-xs text-foreground/80 leading-relaxed font-semibold">
                  {String(raw.response)}
                </div>
                {!!raw.responded_by && (
                  <p className="text-[10px] text-muted-foreground/50 mt-1 font-semibold">
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
              <span className="text-[11px] font-semibold bg-amber-500/15 text-amber-400 rounded-full px-2.5 py-0.5 border border-amber-500/20">
                {String(raw.category || "")}
              </span>
              {!!raw.is_anonymous && (
                <span className="text-[11px] bg-zinc-500/15 text-zinc-400 rounded-full px-2.5 py-0.5 border border-zinc-500/20">
                  Anonymous
                </span>
              )}
            </div>
            <Detail label="Description" value={String(raw.description || "")} />
            {raw.resolution_notes && (
              <div className="space-y-1">
                <p className="text-[10px] uppercase tracking-wide text-muted-foreground/60 font-bold">
                  Resolution Notes
                </p>
                <div className="rounded-xl bg-card border border-border/50 px-3.5 py-2.5 text-xs text-foreground/85 leading-relaxed font-semibold">
                  {String(raw.resolution_notes)}
                </div>
              </div>
            )}
          </>
        )}

        {item.type === "facility" && (
          <>
            <div className="flex items-center gap-2 flex-wrap">
              <span className="text-[11px] font-semibold bg-cyan-500/15 text-cyan-400 rounded-full px-2.5 py-0.5 border border-cyan-500/20">
                {String(raw.category || "General")}
              </span>
              {!!raw.priority && (
                <span
                  className={cn(
                    "text-[11px] font-medium rounded-full px-2.5 py-0.5",
                    PRIORITY_BADGE[String(raw.priority)] ?? "bg-zinc-500/15 text-zinc-400",
                  )}
                >
                  {String(raw.priority)} Priority
                </span>
              )}
            </div>
            <Detail label="Location" value={String(raw.location || "—")} />
            <Detail label="Description" value={String(raw.description || "—")} />
            {raw.resolution_notes && (
              <div className="space-y-1">
                <p className="text-[10px] uppercase tracking-wide text-muted-foreground/60 font-bold">
                  Resolution Notes
                </p>
                <div className="rounded-xl bg-emerald-500/5 border border-emerald-500/15 px-3.5 py-2.5 text-xs text-foreground/80 leading-relaxed font-semibold">
                  {String(raw.resolution_notes)}
                </div>
              </div>
            )}
          </>
        )}

        {item.type === "parking" && (
          <>
            <div className="flex items-center gap-2 flex-wrap">
              <span className="text-[11px] font-semibold bg-teal-500/15 text-teal-400 rounded-full px-2.5 py-0.5 border border-teal-500/20">
                {String(raw.vehicle_type || "Vehicle")}
              </span>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <Detail
                label="Vehicle Details"
                value={`${raw.vehicle_make || ""} ${raw.vehicle_model || ""}`.trim() || "—"}
              />
              <Detail label="Vehicle Number" value={String(raw.vehicle_number || "—")} />
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <Detail label="Sticker Number" value={String(raw.sticker_number || "Pending")} />
              {!!raw.valid_from && (
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
              <span className="text-[11px] font-semibold bg-emerald-500/15 text-emerald-400 rounded-full px-2.5 py-0.5 border border-emerald-500/20">
                {String(raw.leave_type || "Leave")}
              </span>
              <span className="text-[11px] bg-zinc-500/15 text-zinc-400 rounded-full px-2.5 py-0.5 border border-zinc-500/20">
                {String(raw.days ?? "")} Day(s)
              </span>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <Detail
                label="Start Date"
                value={raw.start_date ? String(raw.start_date).slice(0, 10) : "—"}
              />
              <Detail
                label="End Date"
                value={raw.end_date ? String(raw.end_date).slice(0, 10) : "—"}
              />
            </div>
            <Detail label="Reason for Leave" value={String(raw.reason || "—")} />
          </>
        )}

        {item.type === "expense" && (
          <>
            <div className="flex items-center gap-2 flex-wrap">
              <span className="text-[11px] font-semibold bg-indigo-500/15 text-indigo-400 rounded-full px-2.5 py-0.5 border border-indigo-500/20">
                {String(raw.type || "Reimbursement")}
              </span>
              <span className="text-[11px] font-bold bg-white/5 border border-border/50 rounded-full px-2.5 py-0.5">
                ${String(raw.amount ?? "")}
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
              <span
                className={cn(
                  "text-[11px] font-semibold rounded-full px-2.5 py-0.5 border",
                  raw.is_international
                    ? "bg-fuchsia-500/15 text-fuchsia-400 border-fuchsia-500/20"
                    : "bg-blue-500/15 text-blue-400 border-blue-500/20",
                )}
              >
                {raw.is_international ? "International Travel" : "Domestic Travel"}
              </span>
              <span className="text-[11px] bg-zinc-500/15 text-zinc-400 rounded-full px-2.5 py-0.5 border border-zinc-500/20">
                Mode: {String(raw.mode_of_travel || "—")}
              </span>
              {!!raw.accommodation_required && (
                <span className="text-[11px] bg-cyan-500/15 text-cyan-400 rounded-full px-2.5 py-0.5 border border-cyan-500/20">
                  Hotel Required
                </span>
              )}
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <Detail label="From" value={String(raw.from_location || "—")} />
              <Detail label="Destination" value={String(raw.to_destination || "—")} />
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <Detail
                label="Travel Date"
                value={raw.travel_date ? String(raw.travel_date).slice(0, 10) : "—"}
              />
              <Detail
                label="Return Date"
                value={raw.return_date ? String(raw.return_date).slice(0, 10) : "—"}
              />
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <Detail
                label="Estimated Cost"
                value={raw.estimated_cost ? `$${raw.estimated_cost}` : "—"}
              />
              <Detail
                label="Expense Limit Allocated"
                value={
                  raw.expense_limit
                    ? `${raw.expense_limit_currency || "INR"} ${raw.expense_limit.toLocaleString()}`
                    : "—"
                }
              />
            </div>
            {raw.notes && <Detail label="Travel Justification/Notes" value={String(raw.notes)} />}
            {(raw.ticket_details || raw.hotel_details || raw.visa_status) && (
              <div className="border-t border-border/40 pt-3 mt-1.5 space-y-2">
                <p className="text-[10px] uppercase tracking-wider text-muted-foreground/60 font-bold">
                  Booking Details
                </p>
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 bg-muted/40 p-3 rounded-xl border border-border/40">
                  <Detail label="Ticket Details" value={String(raw.ticket_details || "—")} />
                  <Detail label="Hotel Details" value={String(raw.hotel_details || "—")} />
                  {!!raw.visa_required && (
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
              <span className="text-[11px] font-semibold bg-fuchsia-500/15 text-fuchsia-400 rounded-full px-2.5 py-0.5 border border-fuchsia-500/20">
                Travel Expense Claim
              </span>
              <span className="text-[11px] font-bold bg-white/5 border border-border/50 rounded-full px-2.5 py-0.5">
                Claim Amount: ${String(raw.amount ?? "")}
              </span>
              <span className="text-[11px] text-muted-foreground font-semibold">
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
              <div className="rounded-xl bg-rose-500/5 border border-rose-500/15 p-3.5 text-xs text-rose-500 mt-2 font-semibold">
                <p className="text-[10px] uppercase tracking-wide text-rose-500/60 mb-1 font-bold">
                  Rejection Reason
                </p>
                {String(raw.rejection_reason)}
              </div>
            )}
          </>
        )}

        {item.type === "udemy" && (
          <>
            <div className="flex items-center gap-2 flex-wrap">
              <span className="text-[11px] font-semibold bg-orange-500/15 text-orange-400 rounded-full px-2.5 py-0.5 border border-orange-500/20">
                {String(raw.platform || "Udemy")}
              </span>
            </div>
            <Detail label="Course Name" value={String(raw.course_name || "—")} />
            <Detail label="Justification" value={String(raw.justification || "—")} />
            {raw.decided_by && <Detail label="Decided By" value={String(raw.decided_by)} />}
            {raw.decision_reason && (
              <div className="rounded-xl bg-card border border-border/50 p-3.5 text-xs text-foreground/80 leading-relaxed mt-2 font-semibold">
                <p className="text-[10px] uppercase tracking-wide text-muted-foreground/60 mb-1 font-bold">
                  Decision Details
                </p>
                {String(raw.decision_reason)}
              </div>
            )}
          </>
        )}

        {item.type === "it_ticket" && (
          <>
            <div className="flex items-center gap-2 flex-wrap">
              {!!raw.category && (
                <span className="text-[11px] font-semibold bg-cyan-500/15 text-cyan-400 rounded-full px-2.5 py-0.5 border border-cyan-500/20">
                  {String(raw.category)}
                </span>
              )}
              {!!item.externalRefId && (
                <span className="text-[11px] text-muted-foreground font-semibold">
                  ManageEngine ref: {item.externalRefId}
                </span>
              )}
            </div>
            <a
              href={manageEngineTicketUrl(item.externalRefId)}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1.5 text-xs font-semibold text-cyan-500 hover:text-cyan-400 mt-1"
            >
              View in ManageEngine ServiceDesk
              <ExternalLink className="h-3.5 w-3.5" />
            </a>
          </>
        )}

        {item.type === "form" && (
          <>
            <div className="flex items-center gap-2 flex-wrap">
              <span className="text-[11px] font-semibold bg-violet-500/15 text-violet-400 rounded-full px-2.5 py-0.5 border border-violet-500/20">
                {String(raw.form_name || "Form")}
              </span>
              {!!raw.category && (
                <span className="text-[11px] bg-zinc-500/15 text-zinc-400 rounded-full px-2.5 py-0.5 border border-zinc-500/20">
                  {String(raw.category)}
                </span>
              )}
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              {Object.entries((raw.field_values ?? {}) as Record<string, unknown>).map(([k, v]) => (
                <Detail
                  key={k}
                  label={humanizeFieldName(k)}
                  value={Array.isArray(v) ? v.join(", ") : String(v ?? "—")}
                />
              ))}
            </div>
            {!!raw.admin_remarks && (
              <div className="space-y-1">
                <p className="text-[10px] uppercase tracking-wide text-muted-foreground/60 font-bold">
                  Admin Remarks
                </p>
                <div className="rounded-xl bg-card border border-border/50 px-3.5 py-2.5 text-xs text-foreground/85 leading-relaxed font-semibold">
                  {String(raw.admin_remarks)}
                  {!!raw.reviewed_by && (
                    <p className="text-[10px] text-muted-foreground/50 mt-1 font-semibold">
                      by {String(raw.reviewed_by)}
                    </p>
                  )}
                </div>
              </div>
            )}
          </>
        )}
      </div>

      {/* Right side: Status and Submission Time stamps */}
      <div className="w-full md:w-48 shrink-0 flex flex-col items-start gap-3 border-t md:border-t-0 md:border-l border-border/20 pt-4 md:pt-0 md:pl-6">
        <div>
          <p className="text-[10px] uppercase tracking-wider text-muted-foreground/60 font-bold mb-1">
            Current Status
          </p>
          <StatusBadge status={item.status} className="px-3 py-1 text-xs font-bold shadow-xs" />
        </div>
        {isFinal && (
          <div className="flex items-center gap-1.5 text-emerald-500 text-xs mt-1 font-semibold">
            <CheckCircle2 className="h-4 w-4" />
            <span>Resolved</span>
          </div>
        )}
        {item.created_at && (
          <div>
            <p className="text-[10px] uppercase tracking-wider text-muted-foreground/60 font-bold mb-0.5">
              Submitted On
            </p>
            <p className="text-xs text-foreground/75 font-semibold">
              {item.created_at.slice(0, 10)}
            </p>
          </div>
        )}
      </div>
    </div>
  );
}
