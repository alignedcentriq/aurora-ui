import { useAuth } from "@/lib/auth-store";
import React, { useState, useEffect, useCallback } from "react";
import {
  X,
  Clock,
  Loader2,
  RefreshCw,
  Gift,
  Settings2,
  Plus,
  Pencil,
  Trash2,
  Send,
  RotateCcw,
  Inbox,
  AlertCircle,
  FileText,
  MessageSquare,
  ShieldAlert,
  ChevronDown,
  CheckCircle2,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { toast } from "sonner";
import { StatusBadge } from "@/components/ui/StatusBadge";
import { TableLoader } from "@/components/ui/TableLoader";
import { TableEmpty } from "@/components/ui/TableEmpty";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";

// ── Types ─────────────────────────────────────────────────────────────────────

type PortalTab = "requests" | "welcome-logs" | "welcome-config";
type RequestType = "escalation" | "document" | "query" | "grievance";

interface RequestItem {
  key: string;
  type: RequestType;
  reference_id: string;
  from_name: string;
  from_email: string;
  subject: string;
  description: string;
  status: string;
  priority?: string;
  created_at: string;
  raw: Record<string, unknown>;
}

interface WelcomeLog {
  id: number;
  employee_name: string;
  employee_email: string;
  status: "pending_hr" | "welcome_sent" | "skipped";
  created_at: string;
  acted_at: string | null;
  acted_by: string | null;
}

interface WelcomeResource {
  id: number;
  name: string;
  url: string | null;
  description: string | null;
  category: string | null;
  icon: string | null;
  is_active: boolean;
  sort_order: number;
}

// ── Constants ────────────────────────────────────────────────────────────────

const CATEGORY_OPTIONS = [
  "App Guide", "HR", "Policy", "IT", "Admin", "Facilities", "Video", "Deck", "General",
];

const CATEGORY_DEFAULT_ICON: Record<string, string> = {
  Video: "🎬",
  Deck: "📊",
  "App Guide": "📱",
  HR: "👥",
  Policy: "📋",
  IT: "💻",
  Admin: "🏢",
  Facilities: "🏗️",
  General: "📌",
};

const TYPE_BADGE: Record<RequestType, string> = {
  escalation: "bg-rose-500/15 text-rose-400",
  document: "bg-violet-500/15 text-violet-400",
  query: "bg-sky-500/15 text-sky-400",
  grievance: "bg-amber-500/15 text-amber-400",
};

const TYPE_LABEL: Record<RequestType, string> = {
  escalation: "Escalation",
  document: "Document",
  query: "HR Query",
  grievance: "Grievance",
};

const PRIORITY_BADGE: Record<string, string> = {
  Low: "bg-zinc-500/15 text-zinc-400",
  Normal: "bg-zinc-500/15 text-zinc-400",
  Medium: "bg-amber-500/15 text-amber-400",
  High: "bg-rose-500/15 text-rose-400",
};

// ── Main component ────────────────────────────────────────────────────────────

export function HRPortal() {
  const { user } = useAuth();
  const [tab, setTab] = useState<PortalTab>("requests");

  const authHeaders = {
    "Content-Type": "application/json",
    ...(user?.email ? { "x-user-email": user.email } : {}),
    ...(user?.role ? { "x-user-role": user.role.toLowerCase() } : {}),
  };

  if (user?.role !== "HR" && user?.role !== "Admin") {
    return (
      <div className="flex h-full items-center justify-center text-muted-foreground">
        Access restricted to HR team.
      </div>
    );
  }

  const TABS: { id: PortalTab; label: string; icon: React.ElementType }[] = [
    { id: "requests", label: "Requests", icon: Inbox },
    { id: "welcome-logs", label: "Welcome Logs", icon: Gift },
    { id: "welcome-config", label: "Welcome Resources", icon: Settings2 },
  ];

  return (
    <div className="flex flex-col h-full overflow-hidden">
      {/* Header */}
      <div className="flex flex-col gap-1 sm:flex-row sm:items-center sm:justify-between px-4 py-4 sm:px-8 sm:py-6 border-b border-[var(--border)] shrink-0">
        <div>
          <h1 className="text-[20px] font-semibold text-foreground">HR Portal</h1>
          <p className="text-[13px] text-muted-foreground mt-0.5">
            Manage requests and new employee onboarding
          </p>
        </div>
      </div>

      {/* Top tabs */}
      <div className="flex gap-1 overflow-x-auto px-4 sm:px-8 pt-4 pb-0 border-b border-[var(--border)] shrink-0 no-scrollbar">
        {TABS.map(({ id, label, icon: Icon }) => (
          <button
            key={id}
            onClick={() => setTab(id)}
            className={cn(
              "flex items-center gap-1.5 px-4 py-2 text-[13px] font-medium rounded-t-lg border-b-2 transition-colors -mb-px",
              tab === id
                ? "border-primary text-primary bg-primary/5"
                : "border-transparent text-muted-foreground hover:text-foreground hover:bg-secondary/50"
            )}
          >
            <Icon className="h-3.5 w-3.5" />
            {label}
          </button>
        ))}
      </div>

      {/* Tab content */}
      <div className="flex-1 overflow-hidden">
        {tab === "requests" && <RequestsTab authHeaders={authHeaders} />}
        {tab === "welcome-logs" && <WelcomeLogsTab authHeaders={authHeaders} />}
        {tab === "welcome-config" && <WelcomeConfigTab authHeaders={authHeaders} />}
      </div>
    </div>
  );
}

// ── Requests Tab ──────────────────────────────────────────────────────────────

function RequestsTab({ authHeaders }: { authHeaders: Record<string, string> }) {
  const [items, setItems] = useState<RequestItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [typeFilter, setTypeFilter] = useState<RequestType | "all">("all");
  const [expanded, setExpanded] = useState<string | null>(null);

  const fetchAll = useCallback(async () => {
    setLoading(true);
    try {
      const [escRes, docRes, queryRes, grvRes] = await Promise.all([
        fetch("/api/escalations?domain=hr&limit=100", { headers: authHeaders }),
        fetch("/api/documents/list?scope=pending&limit=100", { headers: authHeaders }),
        fetch("/api/portal/hr/queries", { headers: authHeaders }),
        fetch("/api/portal/hr/grievances", { headers: authHeaders }),
      ]);

      const [escData, docData, queryData, grvData] = await Promise.all([
        escRes.ok ? escRes.json() : { items: [] },
        docRes.ok ? docRes.json() : { results: [] },
        queryRes.ok ? queryRes.json() : [],
        grvRes.ok ? grvRes.json() : [],
      ]);

      const normalized: RequestItem[] = [
        ...(escData.items ?? []).map((e: Record<string, unknown>) => ({
          key: `esc-${e.id}`,
          type: "escalation" as RequestType,
          reference_id: String(e.reference_id ?? ""),
          from_name: String(e.user_name || e.user_email || ""),
          from_email: String(e.user_email ?? ""),
          subject: String(e.original_query || "Escalation"),
          description: String(e.description || ""),
          status: String(e.status ?? "Open"),
          priority: e.priority ? String(e.priority) : undefined,
          created_at: String(e.created_at ?? ""),
          raw: e,
        })),
        ...(docData.results ?? []).map((d: Record<string, unknown>) => ({
          key: `doc-${d.id}`,
          type: "document" as RequestType,
          reference_id: `DOC-${d.id}`,
          from_name: String(d.subject_name || d.subject_email || ""),
          from_email: String(d.subject_email ?? ""),
          subject: String(d.title || d.label || "Document"),
          description: `${d.label} · Requested by ${d.generated_by_email}`,
          status: d.status === "draft" ? "Pending Approval" : String(d.status ?? ""),
          created_at: String(d.created_at ?? ""),
          raw: d,
        })),
        ...(Array.isArray(queryData) ? queryData : []).map((q: Record<string, unknown>) => ({
          key: `query-${q.id}`,
          type: "query" as RequestType,
          reference_id: String(q.reference_id ?? ""),
          from_name: String(q.employee_name ?? ""),
          from_email: String(q.employee_email ?? ""),
          subject: String(q.subject ?? ""),
          description: String(q.description ?? ""),
          status: String(q.status ?? "Open"),
          priority: q.priority ? String(q.priority) : undefined,
          created_at: String(q.created_at ?? ""),
          raw: q,
        })),
        ...(Array.isArray(grvData) ? grvData : []).map((g: Record<string, unknown>) => ({
          key: `grv-${g.id}`,
          type: "grievance" as RequestType,
          reference_id: String(g.reference_id ?? ""),
          from_name: g.is_anonymous ? "Anonymous" : String(g.employee_name || "Unknown"),
          from_email: "",
          subject: String(g.category ?? ""),
          description: String(g.description ?? ""),
          status: String(g.status ?? "Open"),
          created_at: String(g.submitted_at ?? ""),
          raw: g,
        })),
      ];

      normalized.sort(
        (a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime()
      );
      setItems(normalized);
    } catch {
      toast.error("Failed to load requests");
    } finally {
      setLoading(false);
    }
  }, [authHeaders]);

  useEffect(() => { fetchAll(); }, [fetchAll]);

  const handleDone = useCallback(() => { setExpanded(null); fetchAll(); }, [fetchAll]);

  const filtered = typeFilter === "all" ? items : items.filter((i) => i.type === typeFilter);

  const counts = {
    escalation: items.filter((i) => i.type === "escalation").length,
    document: items.filter((i) => i.type === "document").length,
    query: items.filter((i) => i.type === "query").length,
    grievance: items.filter((i) => i.type === "grievance").length,
  };

  const openCount = (type: RequestType) =>
    items.filter(
      (i) =>
        i.type === type &&
        !["resolved", "closed", "verified"].includes(i.status.toLowerCase())
    ).length;

  const STATS: {
    type: RequestType;
    label: string;
    icon: React.ElementType;
    color: string;
    bg: string;
  }[] = [
    { type: "escalation", label: "Open Escalations", icon: AlertCircle, color: "text-rose-400", bg: "bg-rose-500/10" },
    { type: "document", label: "Pending Documents", icon: FileText, color: "text-violet-400", bg: "bg-violet-500/10" },
    { type: "query", label: "Open HR Queries", icon: MessageSquare, color: "text-sky-400", bg: "bg-sky-500/10" },
    { type: "grievance", label: "Open Grievances", icon: ShieldAlert, color: "text-amber-400", bg: "bg-amber-500/10" },
  ];

  const FILTER_PILLS: { key: RequestType | "all"; label: string }[] = [
    { key: "all", label: `All (${items.length})` },
    { key: "escalation", label: `Escalations (${counts.escalation})` },
    { key: "document", label: `Documents (${counts.document})` },
    { key: "query", label: `HR Queries (${counts.query})` },
    { key: "grievance", label: `Grievances (${counts.grievance})` },
  ];

  const tableRows: React.ReactNode[] = [];
  filtered.forEach((item) => {
    const isExpanded = expanded === item.key;
    tableRows.push(
      <tr
        key={item.key}
        onClick={() => setExpanded(isExpanded ? null : item.key)}
        className="border-b border-[var(--border)]/50 hover:bg-white/[0.02] transition-colors cursor-pointer"
      >
        <td className="py-3.5 pr-4">
          <span className={cn("rounded-full px-2 py-0.5 text-[11px] font-semibold", TYPE_BADGE[item.type])}>
            {TYPE_LABEL[item.type]}
          </span>
        </td>
        <td className="py-3.5 pr-4 text-[12px] text-foreground/60 font-mono whitespace-nowrap">
          {item.reference_id}
        </td>
        <td className="py-3.5 pr-4">
          <div className="text-[13px] font-medium text-foreground leading-tight">{item.from_name}</div>
          {item.from_email && (
            <div className="text-[11px] text-muted-foreground">{item.from_email}</div>
          )}
        </td>
        <td className="py-3.5 pr-4 max-w-[220px]">
          <div className="text-[13px] text-foreground truncate">{item.subject}</div>
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
          <td colSpan={8} className="p-0">
            <ActionPanel item={item} authHeaders={authHeaders} onDone={handleDone} />
          </td>
        </tr>
      );
    }
  });

  return (
    <div className="flex flex-col h-full overflow-hidden">
      {/* Stats */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 sm:gap-4 px-4 py-4 sm:px-8 shrink-0">
        {STATS.map(({ type, label, icon: Icon, color, bg }) => (
          <button
            key={type}
            onClick={() => setTypeFilter(typeFilter === type ? "all" : type)}
            className={cn(
              "rounded-xl border border-[var(--border)] bg-card/40 px-5 py-4 flex items-center gap-4 text-left transition-colors hover:bg-card/70",
              typeFilter === type && "ring-2 ring-primary/30 bg-primary/5"
            )}
          >
            <div className={cn("rounded-lg p-2.5 shrink-0", bg, color)}>
              <Icon className="h-4 w-4" />
            </div>
            <div>
              <p className={cn("text-[22px] font-bold", color)}>{openCount(type)}</p>
              <p className="text-[12px] text-muted-foreground">{label}</p>
            </div>
          </button>
        ))}
      </div>

      {/* Filter pills + refresh */}
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between px-4 sm:px-8 pb-3 shrink-0">
        <div className="flex gap-1.5 flex-wrap">
          {FILTER_PILLS.map(({ key, label }) => (
            <button
              key={key}
              onClick={() => setTypeFilter(key)}
              className={cn(
                "rounded-full px-3 py-1 text-[12px] font-medium transition-colors",
                typeFilter === key
                  ? "bg-primary/15 text-primary"
                  : "bg-secondary/50 text-muted-foreground hover:bg-secondary hover:text-foreground"
              )}
            >
              {label}
            </button>
          ))}
        </div>
        <button
          onClick={fetchAll}
          className="flex items-center gap-2 rounded-lg px-3 py-2 text-[13px] text-muted-foreground hover:bg-secondary transition-colors shrink-0"
        >
          <RefreshCw className="h-3.5 w-3.5" />
          Refresh
        </button>
      </div>

      {/* Table */}
      <div className="flex-1 overflow-auto px-4 sm:px-8 pb-8">
        {loading ? (
          <TableLoader />
        ) : filtered.length === 0 ? (
          <TableEmpty label="requests" icon={<Inbox className="h-4 w-4" />} />
        ) : (
          <table className="w-full text-[13px]">
            <thead>
              <tr className="border-b border-[var(--border)]">
                {["Type", "Reference", "From", "Subject", "Priority", "Status", "Date", ""].map((h) => (
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

// ── Action Panel ──────────────────────────────────────────────────────────────

function ActionPanel({
  item,
  authHeaders,
  onDone,
}: {
  item: RequestItem;
  authHeaders: Record<string, string>;
  onDone: () => void;
}) {
  const raw = item.raw;
  const isFinal = ["resolved", "closed", "verified", "rejected"].includes(item.status.toLowerCase());

  const [responseText, setResponseText] = useState(
    item.type === "query" ? String(raw.response ?? "") : ""
  );
  const [selectedStatus, setSelectedStatus] = useState(
    item.type === "grievance"
      ? (isFinal ? item.status : "Under Review")
      : item.type === "escalation"
      ? (item.status === "Open" ? "Acknowledged" : "Resolved")
      : ""
  );
  const [notes, setNotes] = useState(
    item.type === "grievance" ? String(raw.resolution_notes ?? "") : ""
  );
  const [rejectReason, setRejectReason] = useState("");
  const [showRejectForm, setShowRejectForm] = useState(false);
  const [acting, setActing] = useState(false);

  const act = async (action: string) => {
    if (action === "query-respond" && !responseText.trim()) {
      toast.error("Response cannot be empty");
      return;
    }
    setActing(true);
    try {
      const endpoints: Record<string, { url: string; method: string; body?: string }> = {
        "esc-status": {
          url: `/api/escalations/${item.reference_id}/status`,
          method: "PATCH",
          body: JSON.stringify({ status: selectedStatus }),
        },
        "doc-approve": {
          url: `/api/documents/${raw.id as number}/approve`,
          method: "POST",
        },
        "doc-reject": {
          url: `/api/documents/${raw.id as number}/reject`,
          method: "POST",
          body: JSON.stringify({ reason: rejectReason }),
        },
        "query-respond": {
          url: `/api/portal/hr/queries/${raw.id as number}/respond`,
          method: "PATCH",
          body: JSON.stringify({ response: responseText }),
        },
        "query-close": {
          url: `/api/portal/hr/queries/${raw.id as number}/close`,
          method: "PATCH",
        },
        "grv-update": {
          url: `/api/portal/hr/grievances/${item.reference_id}/resolve`,
          method: "PUT",
          body: JSON.stringify({ status: selectedStatus, resolution_notes: notes }),
        },
      };

      const ep = endpoints[action];
      if (!ep) return;

      const fetchHeaders: Record<string, string> = { ...authHeaders };
      if (ep.body) fetchHeaders["Content-Type"] = "application/json";
      const res = await fetch(ep.url, { method: ep.method, headers: fetchHeaders, body: ep.body });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error((err as { detail?: string }).detail || "Action failed");
      }
      toast.success("Updated successfully");
      onDone();
    } catch (e: unknown) {
      toast.error((e as Error).message || "Action failed");
    } finally {
      setActing(false);
    }
  };

  const Detail = ({ label, value }: { label: string; value: React.ReactNode }) =>
    value ? (
      <div>
        <p className="text-[10px] uppercase tracking-wide text-muted-foreground/60 mb-0.5">{label}</p>
        <p className="text-[13px] text-foreground leading-relaxed">{value}</p>
      </div>
    ) : null;

  return (
    <div className="flex flex-col lg:flex-row gap-6 lg:gap-8 px-4 py-4 sm:px-8 sm:py-5 bg-muted/20 border-b border-[var(--border)]">
      {/* Details */}
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
            {raw.session_id && (
              <p className="text-[11px] text-muted-foreground/40 font-mono">
                Session: {String(raw.session_id)}
              </p>
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
              {!!raw.priority && (
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
                  Previous Response
                </p>
                <div className="rounded-lg bg-emerald-500/5 border border-emerald-500/15 px-3 py-2 text-[12px] text-foreground/80 leading-relaxed">
                  {String(raw.response)}
                </div>
                {!!raw.responded_by && (
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
              {!!raw.is_anonymous && (
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
      </div>

      {/* Action form */}
      <div className="w-full lg:w-72 shrink-0 space-y-3">
        {/* Escalation */}
        {item.type === "escalation" && (
          isFinal ? (
            <div className="flex items-center gap-2 text-emerald-400 text-[13px]">
              <CheckCircle2 className="h-4 w-4" />
              Resolved
            </div>
          ) : (
            <>
              <div>
                <label className="block text-[11px] text-muted-foreground mb-1 uppercase tracking-wide">
                  Update Status
                </label>
                <select
                  className="w-full rounded-lg border border-[var(--border)] bg-background px-3 py-2 text-[13px] focus:outline-none focus:ring-1 focus:ring-primary"
                  value={selectedStatus}
                  onChange={(e) => setSelectedStatus(e.target.value)}
                >
                  {item.status === "Open" && <option value="Acknowledged">Acknowledged</option>}
                  <option value="Resolved">Resolved</option>
                </select>
              </div>
              <button
                onClick={() => act("esc-status")}
                disabled={acting}
                className="flex items-center justify-center gap-1.5 w-full rounded-lg px-4 py-2 text-[13px] font-medium bg-primary/10 text-primary hover:bg-primary/20 transition-colors disabled:opacity-50"
              >
                {acting && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
                Update Status
              </button>
            </>
          )
        )}

        {/* Document */}
        {item.type === "document" && (
          isFinal ? (
            <div className={`flex items-center gap-2 text-[13px] ${item.status.toLowerCase() === "rejected" ? "text-rose-400" : "text-emerald-400"}`}>
              <CheckCircle2 className="h-4 w-4" />
              {item.status.toLowerCase() === "rejected"
                ? `Rejected by ${String(raw.verified_by_email || "HR")}`
                : `Released by ${String(raw.verified_by_email || "HR")}`}
            </div>
          ) : showRejectForm ? (
            <div className="space-y-2">
              <div>
                <label className="block text-[11px] text-muted-foreground mb-1 uppercase tracking-wide">
                  Reason for rejection
                </label>
                <textarea
                  rows={3}
                  className="w-full rounded-lg border border-[var(--border)] bg-background px-3 py-2 text-[13px] focus:outline-none focus:ring-1 focus:ring-primary resize-none"
                  value={rejectReason}
                  onChange={(e) => setRejectReason(e.target.value)}
                  placeholder="Optional — will be included in the notification email"
                />
              </div>
              <div className="flex gap-2">
                <button
                  onClick={() => { act("doc-reject"); setShowRejectForm(false); }}
                  disabled={acting}
                  className="flex-1 flex items-center justify-center gap-1.5 rounded-lg px-4 py-2 text-[13px] font-medium bg-rose-500/10 text-rose-400 hover:bg-rose-500/20 transition-colors disabled:opacity-50"
                >
                  {acting ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <X className="h-3.5 w-3.5" />}
                  Confirm Reject
                </button>
                <button
                  onClick={() => setShowRejectForm(false)}
                  className="rounded-lg px-3 py-2 text-[13px] text-muted-foreground hover:bg-muted/40 transition-colors"
                >
                  Cancel
                </button>
              </div>
            </div>
          ) : (
            <div className="flex gap-2">
              <button
                onClick={() => act("doc-approve")}
                disabled={acting}
                className="flex-1 flex items-center justify-center gap-1.5 rounded-lg px-4 py-2.5 text-[13px] font-medium bg-emerald-500/10 text-emerald-400 hover:bg-emerald-500/20 transition-colors disabled:opacity-50"
              >
                {acting ? (
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                ) : (
                  <CheckCircle2 className="h-3.5 w-3.5" />
                )}
                Approve &amp; Release
              </button>
              <button
                onClick={() => setShowRejectForm(true)}
                disabled={acting}
                className="flex items-center justify-center gap-1.5 rounded-lg px-3 py-2.5 text-[13px] font-medium bg-rose-500/10 text-rose-400 hover:bg-rose-500/20 transition-colors disabled:opacity-50"
              >
                <X className="h-3.5 w-3.5" />
                Reject
              </button>
            </div>
          )
        )}

        {/* HR Query */}
        {item.type === "query" && (
          item.status.toLowerCase() === "closed" ? (
            <div className="flex items-center gap-2 text-zinc-400 text-[13px]">
              <X className="h-4 w-4" />
              Closed
            </div>
          ) : (
            <>
              <div>
                <label className="block text-[11px] text-muted-foreground mb-1 uppercase tracking-wide">
                  {raw.response ? "Update Response" : "Response"}
                </label>
                <textarea
                  rows={4}
                  className="w-full rounded-lg border border-[var(--border)] bg-background px-3 py-2 text-[13px] focus:outline-none focus:ring-1 focus:ring-primary resize-none"
                  value={responseText}
                  onChange={(e) => setResponseText(e.target.value)}
                  placeholder="Type your response to the employee…"
                />
              </div>
              <button
                onClick={() => act("query-respond")}
                disabled={acting}
                className="flex items-center justify-center gap-1.5 w-full rounded-lg px-4 py-2 text-[13px] font-medium bg-primary/10 text-primary hover:bg-primary/20 transition-colors disabled:opacity-50"
              >
                {acting ? (
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                ) : (
                  <Send className="h-3.5 w-3.5" />
                )}
                Send Response
              </button>
              <button
                onClick={() => act("query-close")}
                disabled={acting}
                className="flex items-center justify-center gap-1.5 w-full rounded-lg px-4 py-2 text-[13px] font-medium text-muted-foreground hover:bg-secondary transition-colors disabled:opacity-50"
              >
                Close Query
              </button>
            </>
          )
        )}

        {/* Grievance */}
        {item.type === "grievance" && (
          item.status.toLowerCase() === "closed" ? (
            <div className="flex items-center gap-2 text-zinc-400 text-[13px]">
              <X className="h-4 w-4" />
              Closed{raw.resolved_by ? ` by ${String(raw.resolved_by)}` : ""}
            </div>
          ) : (
            <>
              <div>
                <label className="block text-[11px] text-muted-foreground mb-1 uppercase tracking-wide">
                  Update Status
                </label>
                <select
                  className="w-full rounded-lg border border-[var(--border)] bg-background px-3 py-2 text-[13px] focus:outline-none focus:ring-1 focus:ring-primary"
                  value={selectedStatus}
                  onChange={(e) => setSelectedStatus(e.target.value)}
                >
                  <option value="Under Review">Under Review</option>
                  <option value="Resolved">Resolved</option>
                  <option value="Closed">Closed</option>
                </select>
              </div>
              <div>
                <label className="block text-[11px] text-muted-foreground mb-1 uppercase tracking-wide">
                  Resolution Notes
                </label>
                <textarea
                  rows={3}
                  className="w-full rounded-lg border border-[var(--border)] bg-background px-3 py-2 text-[13px] focus:outline-none focus:ring-1 focus:ring-primary resize-none"
                  value={notes}
                  onChange={(e) => setNotes(e.target.value)}
                  placeholder="Add resolution notes…"
                />
              </div>
              <button
                onClick={() => act("grv-update")}
                disabled={acting}
                className="flex items-center justify-center gap-1.5 w-full rounded-lg px-4 py-2 text-[13px] font-medium bg-primary/10 text-primary hover:bg-primary/20 transition-colors disabled:opacity-50"
              >
                {acting && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
                Update Grievance
              </button>
            </>
          )
        )}
      </div>
    </div>
  );
}

// ── Welcome Logs Tab ──────────────────────────────────────────────────────────

function WelcomeLogsTab({ authHeaders }: { authHeaders: Record<string, string> }) {
  const [logs, setLogs] = useState<WelcomeLog[]>([]);
  const [loading, setLoading] = useState(true);
  const [resending, setResending] = useState<number | null>(null);

  const fetchLogs = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/portal/hr/welcome/logs", { headers: authHeaders });
      if (!res.ok) throw new Error("Failed");
      setLogs(await res.json());
    } catch {
      toast.error("Failed to load welcome logs");
    } finally {
      setLoading(false);
    }
  }, [authHeaders]);

  useEffect(() => { fetchLogs(); }, [fetchLogs]);

  const handleResend = async (logId: number, name: string) => {
    setResending(logId);
    try {
      const res = await fetch(`/api/portal/hr/welcome/resend/${logId}`, {
        method: "POST",
        headers: authHeaders,
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.detail || "Failed");
      }
      toast.success(`Welcome email sent to ${name}`);
      fetchLogs();
    } catch (e: unknown) {
      toast.error((e as Error).message);
    } finally {
      setResending(null);
    }
  };

  const stats = {
    pending: logs.filter((l) => l.status === "pending_hr").length,
    sent: logs.filter((l) => l.status === "welcome_sent").length,
    skipped: logs.filter((l) => l.status === "skipped").length,
  };

  return (
    <div className="flex flex-col h-full overflow-hidden">
      {/* Stats */}
      <div className="grid grid-cols-3 gap-4 px-8 py-4 shrink-0">
        {[
          { label: "Pending HR Action", value: stats.pending, color: "text-amber-400", icon: Clock },
          { label: "Welcome Sent", value: stats.sent, color: "text-emerald-400", icon: Send },
          { label: "Skipped", value: stats.skipped, color: "text-zinc-400", icon: X },
        ].map(({ label, value, color, icon: Icon }) => (
          <div
            key={label}
            className="rounded-xl border border-[var(--border)] bg-card/40 px-5 py-4 flex items-center gap-4"
          >
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

      <div className="flex items-center justify-between px-8 pb-3 shrink-0">
        <p className="text-[12px] text-muted-foreground">
          HR receives an email when a new employee is detected. Click Yes in that email to send them the welcome package.
        </p>
        <button
          onClick={fetchLogs}
          className="flex items-center gap-2 rounded-lg px-3 py-2 text-[13px] text-muted-foreground hover:bg-secondary transition-colors shrink-0"
        >
          <RefreshCw className="h-3.5 w-3.5" />
          Refresh
        </button>
      </div>

      <div className="flex-1 overflow-auto px-8 pb-8">
        {loading ? (
          <TableLoader />
        ) : logs.length === 0 ? (
          <TableEmpty icon={<Gift className="h-4 w-4" />}>
            <span>No welcome logs yet — they appear when new employees are detected</span>
          </TableEmpty>
        ) : (
          <table className="w-full text-[13px]">
            <thead>
              <tr className="border-b border-[var(--border)]">
                {["Employee", "Detected On", "Status", "Acted", "Actions"].map((h) => (
                  <th
                    key={h}
                    className="text-left py-3 pr-4 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground/60"
                  >
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {logs.map((l) => (
                <tr
                  key={l.id}
                  className="border-b border-[var(--border)]/50 hover:bg-white/[0.02] transition-colors"
                >
                  <td className="py-3.5 pr-4">
                    <div className="font-medium text-foreground">{l.employee_name}</div>
                    <div className="text-[11px] text-muted-foreground">{l.employee_email}</div>
                  </td>
                  <td className="py-3.5 pr-4 text-foreground/60">{l.created_at.slice(0, 10)}</td>
                  <td className="py-3.5 pr-4">
                    <StatusBadge status={l.status} />
                  </td>
                  <td className="py-3.5 pr-4 text-foreground/50 text-[12px]">
                    {l.acted_at ? (
                      <span title={l.acted_by ?? ""}>{l.acted_at.slice(0, 10)}</span>
                    ) : (
                      "—"
                    )}
                  </td>
                  <td className="py-3.5 pr-4">
                    <button
                      onClick={() => handleResend(l.id, l.employee_name)}
                      disabled={resending === l.id}
                      className="flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-[12px] font-medium bg-primary/10 text-primary hover:bg-primary/20 transition-colors disabled:opacity-50"
                    >
                      {resending === l.id ? (
                        <Loader2 className="h-3 w-3 animate-spin" />
                      ) : (
                        <RotateCcw className="h-3 w-3" />
                      )}
                      {l.status === "welcome_sent" ? "Resend" : "Send Now"}
                    </button>
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

// ── Welcome Config Tab ────────────────────────────────────────────────────────

const DEFAULT_WELCOME_MESSAGE =
  "Welcome to the team, {name}! 🎉\n\nWe're thrilled to have you on board. Below are the tools and resources available to you through Centriq AI — your digital workplace assistant. Just open the app and ask anything!";

function WelcomeConfigTab({ authHeaders }: { authHeaders: Record<string, string> }) {
  const [resources, setResources] = useState<WelcomeResource[]>([]);
  const [loading, setLoading] = useState(true);
  const [editingId, setEditingId] = useState<number | "new" | null>(null);
  const [form, setForm] = useState<Partial<WelcomeResource>>({});
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState<number | null>(null);
  const [resourceToDelete, setResourceToDelete] = useState<{ id: number; name: string } | null>(null);

  // Message editor state
  const [message, setMessage] = useState("");
  const [messageSaving, setMessageSaving] = useState(false);
  const [messageEditing, setMessageEditing] = useState(false);

  const fetchResources = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/portal/hr/welcome/config", { headers: authHeaders });
      if (!res.ok) throw new Error("Failed");
      setResources(await res.json());
    } catch {
      toast.error("Failed to load resources");
    } finally {
      setLoading(false);
    }
  }, [authHeaders]);

  const fetchMessage = useCallback(async () => {
    try {
      const res = await fetch("/api/portal/hr/welcome/message", { headers: authHeaders });
      if (res.ok) {
        const data = await res.json();
        setMessage(data.text ?? DEFAULT_WELCOME_MESSAGE);
      }
    } catch { /* non-fatal */ }
  }, [authHeaders]);

  useEffect(() => { fetchResources(); fetchMessage(); }, [fetchResources, fetchMessage]);

  const saveMessage = async () => {
    if (!message.trim()) { toast.error("Message cannot be empty"); return; }
    setMessageSaving(true);
    try {
      const res = await fetch("/api/portal/hr/welcome/message", {
        method: "PUT",
        headers: authHeaders,
        body: JSON.stringify({ text: message }),
      });
      if (!res.ok) throw new Error("Save failed");
      toast.success("Welcome message saved");
      setMessageEditing(false);
    } catch {
      toast.error("Failed to save message");
    } finally {
      setMessageSaving(false);
    }
  };

  const startEdit = (r: WelcomeResource) => {
    setEditingId(r.id);
    setForm({ ...r });
  };

  const startNew = () => {
    setEditingId("new");
    setForm({
      name: "",
      url: "",
      description: "",
      category: "App Guide",
      icon: CATEGORY_DEFAULT_ICON["App Guide"],
      is_active: true,
      sort_order: resources.length,
    });
  };

  const cancelEdit = () => { setEditingId(null); setForm({}); };

  const saveResource = async () => {
    if (!form.name?.trim()) { toast.error("Name is required"); return; }
    setSaving(true);
    try {
      const isNew = editingId === "new";
      const url = isNew
        ? "/api/portal/hr/welcome/config"
        : `/api/portal/hr/welcome/config/${editingId}`;
      const res = await fetch(url, {
        method: isNew ? "POST" : "PUT",
        headers: authHeaders,
        body: JSON.stringify(form),
      });
      if (!res.ok) throw new Error("Save failed");
      toast.success(isNew ? "Resource added" : "Resource updated");
      setEditingId(null);
      setForm({});
      fetchResources();
    } catch {
      toast.error("Failed to save resource");
    } finally {
      setSaving(false);
    }
  };

  const deleteResource = async (id: number) => {
    setDeleting(id);
    try {
      const res = await fetch(`/api/portal/hr/welcome/config/${id}`, {
        method: "DELETE",
        headers: authHeaders,
      });
      if (!res.ok) throw new Error("Delete failed");
      toast.success("Resource deleted");
      fetchResources();
    } catch {
      toast.error("Failed to delete resource");
    } finally {
      setDeleting(null);
    }
  };

  const toggleActive = async (r: WelcomeResource) => {
    try {
      const res = await fetch(`/api/portal/hr/welcome/config/${r.id}`, {
        method: "PUT",
        headers: authHeaders,
        body: JSON.stringify({ ...r, is_active: !r.is_active }),
      });
      if (!res.ok) throw new Error();
      fetchResources();
    } catch {
      toast.error("Failed to update");
    }
  };

  return (
    <div className="flex flex-col h-full overflow-hidden">
      {/* Welcome message editor */}
      <div className="mx-8 mt-4 mb-2 rounded-xl border border-[var(--border)] bg-card/40 shrink-0">
        <div className="flex items-center justify-between px-5 py-3.5 border-b border-[var(--border)]/50">
          <div>
            <p className="text-[13px] font-medium text-foreground">Welcome Message</p>
            <p className="text-[12px] text-muted-foreground mt-0.5">
              Intro text sent to new employees. Use <code className="bg-primary/10 text-primary rounded px-1">{"{name}"}</code> as a placeholder for their name.
            </p>
          </div>
          {!messageEditing && (
            <button
              onClick={() => setMessageEditing(true)}
              className="flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-[12px] font-medium text-muted-foreground hover:bg-secondary transition-colors shrink-0"
            >
              <Pencil className="h-3 w-3" />
              Edit
            </button>
          )}
        </div>
        <div className="px-5 py-4">
          {messageEditing ? (
            <div className="space-y-3">
              <textarea
                rows={5}
                className="w-full rounded-lg border border-[var(--border)] bg-background px-3 py-2.5 text-[13px] focus:outline-none focus:ring-1 focus:ring-primary resize-none leading-relaxed"
                value={message}
                onChange={(e) => setMessage(e.target.value)}
                placeholder="Welcome to the team, {name}!…"
              />
              <div className="flex items-center justify-between">
                <button
                  onClick={() => { setMessage(DEFAULT_WELCOME_MESSAGE); }}
                  className="text-[12px] text-muted-foreground hover:text-foreground transition-colors"
                >
                  Reset to default
                </button>
                <div className="flex gap-2">
                  <button
                    onClick={() => { setMessageEditing(false); fetchMessage(); }}
                    className="rounded-lg px-3 py-1.5 text-[12px] text-muted-foreground hover:bg-secondary transition-colors"
                  >
                    Cancel
                  </button>
                  <button
                    onClick={saveMessage}
                    disabled={messageSaving}
                    className="flex items-center gap-1.5 rounded-lg px-4 py-1.5 text-[12px] font-medium bg-primary text-primary-foreground hover:bg-primary/90 transition-colors disabled:opacity-50"
                  >
                    {messageSaving && <Loader2 className="h-3 w-3 animate-spin" />}
                    Save
                  </button>
                </div>
              </div>
            </div>
          ) : (
            <p className="text-[13px] text-foreground/80 leading-relaxed whitespace-pre-wrap">
              {message || DEFAULT_WELCOME_MESSAGE}
            </p>
          )}
        </div>
      </div>

      <div className="flex items-center justify-between px-8 py-3 shrink-0">
        <p className="text-[13px] text-muted-foreground">
          Resources below appear in the email. Supports links, videos, and slide decks.
        </p>
        <button
          onClick={startNew}
          className="flex items-center gap-1.5 rounded-lg px-3 py-2 text-[13px] font-medium bg-primary/10 text-primary hover:bg-primary/20 transition-colors shrink-0"
        >
          <Plus className="h-3.5 w-3.5" />
          Add Resource
        </button>
      </div>

      {/* Inline editor */}
      {editingId !== null && (
        <div className="mx-8 mb-4 rounded-xl border border-primary/20 bg-primary/5 p-5 shrink-0">
          <p className="text-[13px] font-semibold text-foreground mb-4">
            {editingId === "new" ? "New Resource" : "Edit Resource"}
          </p>
          <div className="grid grid-cols-2 gap-3">
            <div className="col-span-2 flex gap-3">
              <div className="flex-1">
                <label className="block text-[11px] text-muted-foreground mb-1 uppercase tracking-wide">
                  Name *
                </label>
                <input
                  className="w-full rounded-lg border border-[var(--border)] bg-background px-3 py-2 text-[13px] focus:outline-none focus:ring-1 focus:ring-primary"
                  value={form.name ?? ""}
                  onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
                  placeholder="e.g. Onboarding Video, Policy Deck"
                />
              </div>
              <div className="w-24">
                <label className="block text-[11px] text-muted-foreground mb-1 uppercase tracking-wide">
                  Icon
                </label>
                <input
                  className="w-full rounded-lg border border-[var(--border)] bg-background px-3 py-2 text-[13px] focus:outline-none focus:ring-1 focus:ring-primary"
                  value={form.icon ?? ""}
                  onChange={(e) => setForm((f) => ({ ...f, icon: e.target.value }))}
                  placeholder="🎬"
                />
              </div>
            </div>
            <div>
              <label className="block text-[11px] text-muted-foreground mb-1 uppercase tracking-wide">
                Type / Category
              </label>
              <select
                className="w-full rounded-lg border border-[var(--border)] bg-background px-3 py-2 text-[13px] focus:outline-none focus:ring-1 focus:ring-primary"
                value={form.category ?? "App Guide"}
                onChange={(e) => {
                  const cat = e.target.value;
                  setForm((f) => ({
                    ...f,
                    category: cat,
                    icon: CATEGORY_DEFAULT_ICON[cat] ?? f.icon ?? "📌",
                  }));
                }}
              >
                {CATEGORY_OPTIONS.map((c) => <option key={c}>{c}</option>)}
              </select>
            </div>
            <div>
              <label className="block text-[11px] text-muted-foreground mb-1 uppercase tracking-wide">
                URL (link, YouTube, Google Slides…)
              </label>
              <input
                className="w-full rounded-lg border border-[var(--border)] bg-background px-3 py-2 text-[13px] focus:outline-none focus:ring-1 focus:ring-primary"
                value={form.url ?? ""}
                onChange={(e) => setForm((f) => ({ ...f, url: e.target.value }))}
                placeholder="https://…"
              />
            </div>
            <div className="col-span-2">
              <label className="block text-[11px] text-muted-foreground mb-1 uppercase tracking-wide">
                Description
              </label>
              <input
                className="w-full rounded-lg border border-[var(--border)] bg-background px-3 py-2 text-[13px] focus:outline-none focus:ring-1 focus:ring-primary"
                value={form.description ?? ""}
                onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))}
                placeholder="Brief description shown in the email"
              />
            </div>
          </div>
          <div className="flex justify-end gap-2 mt-4">
            <button
              onClick={cancelEdit}
              className="rounded-lg px-4 py-2 text-[13px] text-muted-foreground hover:bg-secondary transition-colors"
            >
              Cancel
            </button>
            <button
              onClick={saveResource}
              disabled={saving}
              className="flex items-center gap-1.5 rounded-lg px-4 py-2 text-[13px] font-medium bg-primary text-primary-foreground hover:bg-primary/90 transition-colors disabled:opacity-50"
            >
              {saving && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
              Save
            </button>
          </div>
        </div>
      )}

      <div className="flex-1 overflow-auto px-8 pb-8">
        {loading ? (
          <div className="flex h-40 items-center justify-center">
            <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
          </div>
        ) : resources.length === 0 ? (
          <div className="flex h-40 items-center justify-center gap-2 text-muted-foreground">
            <Gift className="h-4 w-4" />
            <span className="text-[13px]">No resources yet — add some above</span>
          </div>
        ) : (
          <div className="space-y-2">
            {resources.map((r) => (
              <div
                key={r.id}
                className={cn(
                  "flex items-center gap-4 rounded-xl border px-5 py-3.5 transition-all",
                  r.is_active
                    ? "border-[var(--border)] bg-card/40"
                    : "border-[var(--border)]/40 bg-card/20 opacity-50"
                )}
              >
                <span className="text-[22px] w-8 text-center shrink-0">{r.icon || "•"}</span>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="font-medium text-[13px] text-foreground">{r.name}</span>
                    {r.category && (
                      <span
                        className={cn(
                          "text-[10px] rounded-full px-2 py-0.5 font-medium",
                          r.category === "Video"
                            ? "bg-rose-500/10 text-rose-400"
                            : r.category === "Deck"
                            ? "bg-violet-500/10 text-violet-400"
                            : "bg-primary/10 text-primary"
                        )}
                      >
                        {r.category}
                      </span>
                    )}
                    {r.url && (
                      <a
                        href={r.url}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-[10px] text-muted-foreground hover:text-primary transition-colors truncate max-w-[180px]"
                      >
                        {r.url}
                      </a>
                    )}
                  </div>
                  {r.description && (
                    <p className="text-[12px] text-muted-foreground mt-0.5 truncate">{r.description}</p>
                  )}
                </div>

                {/* Toggle */}
                <button
                  onClick={() => toggleActive(r)}
                  className={cn(
                    "text-[11px] font-medium rounded-full px-3 py-1 transition-colors shrink-0",
                    r.is_active
                      ? "bg-emerald-500/10 text-emerald-400 hover:bg-emerald-500/20"
                      : "bg-zinc-500/10 text-zinc-400 hover:bg-zinc-500/20"
                  )}
                >
                  {r.is_active ? "Active" : "Inactive"}
                </button>

                <button
                  onClick={() => startEdit(r)}
                  className="rounded-lg p-1.5 text-muted-foreground hover:bg-secondary hover:text-foreground transition-colors shrink-0"
                >
                  <Pencil className="h-3.5 w-3.5" />
                </button>
                <button
                  onClick={() => setResourceToDelete({ id: r.id, name: r.name })}
                  disabled={deleting === r.id}
                  className="rounded-lg p-1.5 text-muted-foreground hover:bg-rose-500/10 hover:text-rose-400 transition-colors shrink-0"
                >
                  {deleting === r.id ? (
                    <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  ) : (
                    <Trash2 className="h-3.5 w-3.5" />
                  )}
                </button>
              </div>
            ))}
          </div>
        )}
      </div>

      <AlertDialog
        open={!!resourceToDelete}
        onOpenChange={(open) => !open && setResourceToDelete(null)}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete Welcome Resource</AlertDialogTitle>
            <AlertDialogDescription>
              Are you sure you want to delete "{resourceToDelete?.name}"? This action cannot be undone
              and this resource will no longer be included in welcome emails sent to new employees.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                if (resourceToDelete) {
                  deleteResource(resourceToDelete.id);
                  setResourceToDelete(null);
                }
              }}
              className="bg-destructive hover:bg-destructive/90 text-destructive-foreground"
            >
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
