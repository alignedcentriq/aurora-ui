import { useAuth } from "@/lib/auth-store";
import React, { useState, useEffect, useCallback } from "react";
import {
  X,
  Loader2,
  RefreshCw,
  Inbox,
  AlertCircle,
  FileText,
  MessageSquare,
  ShieldAlert,
  ChevronDown,
  CheckCircle2,
  Send,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { toast } from "sonner";
import { StatusBadge } from "@/components/ui/StatusBadge";
import { TableLoader } from "@/components/ui/TableLoader";
import { TableEmpty } from "@/components/ui/TableEmpty";
import {
  Table,
  TableHeader,
  TableBody,
  TableHead,
  TableRow,
  TableCell,
} from "@/components/ui/table";
import {
  Pagination,
  PaginationContent,
  PaginationItem,
  PaginationNext,
  PaginationPrevious,
} from "@/components/ui/pagination";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

// ── Types ─────────────────────────────────────────────────────────────────────

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

// ── Constants ────────────────────────────────────────────────────────────────

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
//
// This page now covers HR case management only (escalations, document requests,
// HR queries, grievances). Everything onboarding-related — adding employees,
// triggering/resending welcome emails and manager intro-call invites, welcome
// content, and manager-call settings — lives in one place: the "Kickoff" view
// inside Onboarding Tracker (see OnboardingKickoffAdmin.tsx), alongside the
// journey tracker and step/document/video content admin.

export function HRPortal() {
  const { user } = useAuth();

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

  return (
    <div className="flex flex-col h-full overflow-hidden">
      {/* Header */}
      <div className="flex flex-col gap-1 sm:flex-row sm:items-center sm:justify-between px-4 py-4 sm:px-8 sm:py-6 border-b border-[var(--border)] shrink-0">
        <div>
          <p className="text-[13px] text-muted-foreground mt-0.5">
            Handle escalations, document requests, HR queries, and grievances.
          </p>
        </div>
      </div>

      <div className="flex-1 overflow-hidden">
        <RequestsTab authHeaders={authHeaders} />
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
  const [currentPage, setCurrentPage] = useState(1);
  const itemsPerPage = 10;

  useEffect(() => {
    setCurrentPage(1);
  }, [typeFilter]);

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
        (a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime(),
      );
      setItems(normalized);
    } catch {
      toast.error("Failed to load requests");
    } finally {
      setLoading(false);
    }
  }, [authHeaders]);

  useEffect(() => {
    fetchAll();
  }, [fetchAll]);

  const handleDone = useCallback(() => {
    setExpanded(null);
    fetchAll();
  }, [fetchAll]);

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
        i.type === type && !["resolved", "closed", "verified"].includes(i.status.toLowerCase()),
    ).length;

  const STATS: {
    type: RequestType;
    label: string;
    icon: React.ElementType;
    color: string;
    bg: string;
  }[] = [
    {
      type: "escalation",
      label: "Open Escalations",
      icon: AlertCircle,
      color: "text-rose-400",
      bg: "bg-rose-500/10",
    },
    {
      type: "document",
      label: "Pending Documents",
      icon: FileText,
      color: "text-violet-400",
      bg: "bg-violet-500/10",
    },
    {
      type: "query",
      label: "Open HR Queries",
      icon: MessageSquare,
      color: "text-sky-400",
      bg: "bg-sky-500/10",
    },
    {
      type: "grievance",
      label: "Open Grievances",
      icon: ShieldAlert,
      color: "text-amber-400",
      bg: "bg-amber-500/10",
    },
  ];

  const FILTER_PILLS: { key: RequestType | "all"; label: string }[] = [
    { key: "all", label: `All (${items.length})` },
    { key: "escalation", label: `Escalations (${counts.escalation})` },
    { key: "document", label: `Documents (${counts.document})` },
    { key: "query", label: `HR Queries (${counts.query})` },
    { key: "grievance", label: `Grievances (${counts.grievance})` },
  ];

  const totalPages = Math.max(1, Math.ceil(filtered.length / itemsPerPage));
  const paginatedItems = filtered.slice(
    (currentPage - 1) * itemsPerPage,
    currentPage * itemsPerPage
  );

  const tableRows: React.ReactNode[] = [];
  paginatedItems.forEach((item) => {
    const isExpanded = expanded === item.key;
    tableRows.push(
      <TableRow
        key={item.key}
        onClick={() => setExpanded(isExpanded ? null : item.key)}
        className="cursor-pointer"
      >
        <TableCell className="py-3.5 pr-4">
          <span
            className={cn(
              "rounded-full px-2 py-0.5 text-[11px] font-semibold",
              TYPE_BADGE[item.type],
            )}
          >
            {TYPE_LABEL[item.type]}
          </span>
        </TableCell>
        <TableCell className="py-3.5 pr-4 text-[12px] text-foreground/60 font-mono whitespace-nowrap">
          {item.reference_id}
        </TableCell>
        <TableCell className="py-3.5 pr-4">
          <div className="text-[13px] font-medium text-foreground leading-tight">
            {item.from_name}
          </div>
          {item.from_email && (
            <div className="text-[11px] text-muted-foreground">{item.from_email}</div>
          )}
        </TableCell>
        <TableCell className="py-3.5 pr-4 max-w-[220px]">
          <div className="text-[13px] text-foreground truncate">{item.subject}</div>
          {item.description && (
            <div className="text-[11px] text-muted-foreground truncate">{item.description}</div>
          )}
        </TableCell>
        <TableCell className="py-3.5 pr-4">
          {item.priority ? (
            <span
              className={cn(
                "rounded-full px-2 py-0.5 text-[11px] font-medium",
                PRIORITY_BADGE[item.priority] ?? "bg-zinc-500/15 text-zinc-400",
              )}
            >
              {item.priority}
            </span>
          ) : (
            <span className="text-muted-foreground/30 text-[13px]">—</span>
          )}
        </TableCell>
        <TableCell className="py-3.5 pr-4">
          <StatusBadge status={item.status} />
        </TableCell>
        <TableCell className="py-3.5 pr-4 text-[12px] text-muted-foreground/60 whitespace-nowrap">
          {item.created_at ? item.created_at.slice(0, 10) : "—"}
        </TableCell>
        <TableCell className="py-3.5 pr-2 text-muted-foreground/50">
          <ChevronDown
            className={cn(
              "h-3.5 w-3.5 transition-transform duration-150",
              isExpanded && "rotate-180",
            )}
          />
        </TableCell>
      </TableRow>,
    );
    if (isExpanded) {
      tableRows.push(
        <TableRow key={`${item.key}-panel`}>
          <TableCell colSpan={8} className="p-0 border-b-0">
            <ActionPanel item={item} authHeaders={authHeaders} onDone={handleDone} />
          </TableCell>
        </TableRow>,
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
              typeFilter === type && "ring-2 ring-primary/30 bg-primary/5",
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
            <Button
              key={key}
              variant={typeFilter === key ? "default" : "secondary"}
              onClick={() => setTypeFilter(key)}
              className="rounded-full h-7 px-3 text-[12px]"
            >
              {label}
            </Button>
          ))}
        </div>
        <Button
          variant="ghost"
          size="sm"
          onClick={fetchAll}
          className="flex items-center gap-2 text-muted-foreground"
        >
          <RefreshCw className="h-3.5 w-3.5" />
          Refresh
        </Button>
      </div>

      {/* Table */}
      <div className="flex-1 overflow-auto px-4 sm:px-8 pb-8">
        {loading ? (
          <TableLoader />
        ) : filtered.length === 0 ? (
          <TableEmpty label="requests" icon={<Inbox className="h-4 w-4" />} />
        ) : (
          <div className="space-y-4">
            <Table>
              <TableHeader>
                <TableRow>
                  {["Type", "Reference", "From", "Subject", "Priority", "Status", "Date", ""].map(
                    (h) => (
                      <TableHead key={h}>{h}</TableHead>
                    ),
                  )}
                </TableRow>
              </TableHeader>
              <TableBody>{tableRows}</TableBody>
            </Table>
            
            {totalPages > 1 && (
              <Pagination>
                <PaginationContent>
                  <PaginationItem>
                    <PaginationPrevious
                      href="#"
                      onClick={(e) => {
                        e.preventDefault();
                        setCurrentPage((p) => Math.max(1, p - 1));
                      }}
                    />
                  </PaginationItem>
                  <PaginationItem>
                    <span className="text-sm text-muted-foreground px-4">
                      Page {currentPage} of {totalPages}
                    </span>
                  </PaginationItem>
                  <PaginationItem>
                    <PaginationNext
                      href="#"
                      onClick={(e) => {
                        e.preventDefault();
                        setCurrentPage((p) => Math.min(totalPages, p + 1));
                      }}
                    />
                  </PaginationItem>
                </PaginationContent>
              </Pagination>
            )}
          </div>
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
  const isFinal = ["resolved", "closed", "verified", "rejected"].includes(
    item.status.toLowerCase(),
  );

  const [responseText, setResponseText] = useState(
    item.type === "query" ? String(raw.response ?? "") : "",
  );
  const [selectedStatus, setSelectedStatus] = useState(
    item.type === "grievance"
      ? isFinal
        ? item.status
        : "Under Review"
      : item.type === "escalation"
        ? item.status === "Open"
          ? "Acknowledged"
          : "Resolved"
        : "",
  );
  const [notes, setNotes] = useState(
    item.type === "grievance" ? String(raw.resolution_notes ?? "") : "",
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
        <p className="text-[10px] uppercase tracking-wide text-muted-foreground/60 mb-0.5">
          {label}
        </p>
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
        {item.type === "escalation" &&
          (isFinal ? (
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
                <Select value={selectedStatus} onValueChange={setSelectedStatus}>
                  <SelectTrigger className="w-full">
                    <SelectValue placeholder="Select status" />
                  </SelectTrigger>
                  <SelectContent>
                    {item.status === "Open" && <SelectItem value="Acknowledged">Acknowledged</SelectItem>}
                    <SelectItem value="Resolved">Resolved</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <Button
                onClick={() => act("esc-status")}
                disabled={acting}
                className="w-full"
              >
                {acting && <Loader2 className="h-3.5 w-3.5 animate-spin mr-1.5" />}
                Update Status
              </Button>
            </>
          ))}

        {/* Document */}
        {item.type === "document" &&
          (isFinal ? (
            <div
              className={`flex items-center gap-2 text-[13px] ${item.status.toLowerCase() === "rejected" ? "text-rose-400" : "text-emerald-400"}`}
            >
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
                <Textarea
                  rows={3}
                  value={rejectReason}
                  onChange={(e) => setRejectReason(e.target.value)}
                  placeholder="Optional — will be included in the notification email"
                />
              </div>
              <div className="flex gap-2">
                <Button
                  variant="destructive"
                  onClick={() => {
                    act("doc-reject");
                    setShowRejectForm(false);
                  }}
                  disabled={acting}
                  className="flex-1"
                >
                  {acting ? (
                    <Loader2 className="h-3.5 w-3.5 animate-spin mr-1.5" />
                  ) : (
                    <X className="h-3.5 w-3.5 mr-1.5" />
                  )}
                  Confirm Reject
                </Button>
                <Button
                  variant="secondary"
                  onClick={() => setShowRejectForm(false)}
                >
                  Cancel
                </Button>
              </div>
            </div>
          ) : (
            <div className="flex gap-2">
              <Button
                variant="outline"
                className="flex-1 bg-emerald-500/10 text-emerald-400 hover:bg-emerald-500/20 hover:text-emerald-400 border-emerald-500/20"
                onClick={() => act("doc-approve")}
                disabled={acting}
              >
                {acting ? (
                  <Loader2 className="h-3.5 w-3.5 animate-spin mr-1.5" />
                ) : (
                  <CheckCircle2 className="h-3.5 w-3.5 mr-1.5" />
                )}
                Approve & Release
              </Button>
              <Button
                variant="outline"
                className="bg-rose-500/10 text-rose-400 hover:bg-rose-500/20 hover:text-rose-400 border-rose-500/20 px-3"
                onClick={() => setShowRejectForm(true)}
                disabled={acting}
              >
                <X className="h-3.5 w-3.5 mr-1.5" />
                Reject
              </Button>
            </div>
          ))}

        {/* HR Query */}
        {item.type === "query" &&
          (item.status.toLowerCase() === "closed" ? (
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
                <Textarea
                  rows={4}
                  value={responseText}
                  onChange={(e) => setResponseText(e.target.value)}
                  placeholder="Type your response to the employee…"
                />
              </div>
              <Button
                onClick={() => act("query-respond")}
                disabled={acting}
                className="w-full"
              >
                {acting ? (
                  <Loader2 className="h-3.5 w-3.5 animate-spin mr-1.5" />
                ) : (
                  <Send className="h-3.5 w-3.5 mr-1.5" />
                )}
                Send Response
              </Button>
              <Button
                variant="secondary"
                onClick={() => act("query-close")}
                disabled={acting}
                className="w-full"
              >
                Close Query
              </Button>
            </>
          ))}

        {/* Grievance */}
        {item.type === "grievance" &&
          (item.status.toLowerCase() === "closed" ? (
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
                <Select value={selectedStatus} onValueChange={setSelectedStatus}>
                  <SelectTrigger className="w-full">
                    <SelectValue placeholder="Select status" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="Under Review">Under Review</SelectItem>
                    <SelectItem value="Resolved">Resolved</SelectItem>
                    <SelectItem value="Closed">Closed</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div>
                <label className="block text-[11px] text-muted-foreground mb-1 uppercase tracking-wide">
                  Resolution Notes
                </label>
                <Textarea
                  rows={3}
                  value={notes}
                  onChange={(e) => setNotes(e.target.value)}
                  placeholder="Add resolution notes…"
                />
              </div>
              <Button
                onClick={() => act("grv-update")}
                disabled={acting}
                className="w-full"
              >
                {acting && <Loader2 className="h-3.5 w-3.5 animate-spin mr-1.5" />}
                Update Grievance
              </Button>
            </>
          ))}
      </div>
    </div>
  );
}

