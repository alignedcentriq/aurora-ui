import { useAuth } from "@/lib/auth-store";
import React, { useState, useEffect, useCallback, useMemo, useRef } from "react";
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
  CalendarDays,
  Search,
  Users,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { toast } from "sonner";
import { StatusBadge } from "@/components/ui/StatusBadge";
import { ExportCsvButton } from "@/components/ui/ExportCsvButton";
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
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import {
  Empty,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
  EmptyDescription,
} from "@/components/ui/empty";

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

type PortalTab = "requests" | "attendance" | "leaves";

export function HRPortal() {
  const { user } = useAuth();
  const [tab, setTab] = useState<PortalTab>("requests");

  const authHeaders = useMemo(
    () => ({
      "Content-Type": "application/json",
      ...(user?.email ? { "x-user-email": user.email } : {}),
      ...(user?.role ? { "x-user-role": user.role.toLowerCase() } : {}),
    }),
    [user?.email, user?.role],
  );

  if (user?.role !== "HR" && user?.role !== "Admin") {
    return (
      <div className="flex h-full items-center justify-center text-muted-foreground">
        Access restricted to HR team.
      </div>
    );
  }

  const TABS: { key: PortalTab; label: string; icon: React.ElementType; desc: string }[] = [
    {
      key: "requests",
      label: "Requests",
      icon: Inbox,
      desc: "Handle escalations, document requests, HR queries, and grievances.",
    },
    {
      key: "attendance",
      label: "Company Attendance",
      icon: Users,
      desc: "See who's in, who's off, and who's on leave — company-wide, any date.",
    },
    {
      key: "leaves",
      label: "Leave Records",
      icon: CalendarDays,
      desc: "Every employee's leave history, reason, and upcoming leave.",
    },
  ];

  return (
    <div className="flex flex-col h-full overflow-hidden">
      {/* Header */}
      <div className="flex flex-col gap-0.5 px-4 py-4 sm:px-8 sm:py-6 border-b border-[var(--border)] shrink-0">
        <h1 className="text-[17px] font-bold text-foreground">HR Portal</h1>
        <p className="text-[13px] text-muted-foreground">
          {TABS.find((t) => t.key === tab)?.desc}
        </p>
      </div>

      <Tabs
        value={tab}
        onValueChange={(v) => setTab(v as PortalTab)}
        className="flex flex-col flex-1 h-full overflow-hidden"
      >
        <TabsList className="w-full justify-start px-4 sm:px-8 py-3 h-auto rounded-none border-b border-[var(--border)] bg-transparent gap-1">
          {TABS.map(({ key, label, icon: Icon }) => (
            <TabsTrigger
              key={key}
              value={key}
              className="flex items-center gap-2 rounded-lg px-4 py-2 text-[13px] font-medium data-[state=active]:bg-primary/10 data-[state=active]:text-primary data-[state=active]:shadow-none data-[state=inactive]:text-muted-foreground data-[state=inactive]:hover:bg-secondary transition-colors"
            >
              <Icon className="h-3.5 w-3.5" />
              {label}
            </TabsTrigger>
          ))}
        </TabsList>

        <div className="flex-1 overflow-hidden">
          <TabsContent value="requests" className="m-0 h-full data-[state=inactive]:hidden">
            <RequestsTab authHeaders={authHeaders} />
          </TabsContent>
          <TabsContent value="attendance" className="m-0 h-full data-[state=inactive]:hidden">
            <AttendanceTab authHeaders={authHeaders} />
          </TabsContent>
          <TabsContent value="leaves" className="m-0 h-full data-[state=inactive]:hidden">
            <LeaveRecordsTab authHeaders={authHeaders} />
          </TabsContent>
        </div>
      </Tabs>
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
        <div className="flex items-center gap-2">
          <ExportCsvButton
            rows={filtered.map((item) => ({
              Type: TYPE_LABEL[item.type],
              Reference: item.reference_id,
              From: item.from_name,
              Email: item.from_email,
              Subject: item.subject,
              Description: item.description,
              Priority: item.priority ?? "",
              Status: item.status,
              Date: item.created_at ? item.created_at.slice(0, 10) : "",
            }))}
            filename="hr-requests.csv"
          />
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

// ── Company Attendance Tab ──────────────────────────────────────────────────────

interface AttendanceMember {
  employee: string;
  email: string;
  department: string;
  designation: string;
  reports_to: string;
  status: string;
  leave_type: string | null;
  check_in: string | null;
  check_out: string | null;
  late: boolean;
}

interface AttendanceSnapshot {
  success: boolean;
  date: string;
  is_weekend: boolean;
  headcount: number;
  members: AttendanceMember[];
  totals: Record<string, number>;
  error?: string;
  message?: string;
}

const ATTENDANCE_STATUS_BADGE: Record<
  string,
  "success" | "destructive" | "info" | "warning" | "violet" | "secondary"
> = {
  present: "success",
  absent: "destructive",
  wfh: "info",
  "half-day": "warning",
  "on leave": "violet",
  weekend: "secondary",
};

function todayISO(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

const ATTENDANCE_STATUS_FILTERS = [
  { key: "all", label: "All" },
  { key: "present", label: "Present" },
  { key: "absent", label: "Absent" },
  { key: "on leave", label: "On Leave" },
  { key: "wfh", label: "WFH" },
  { key: "half-day", label: "Half-day" },
  { key: "weekend", label: "Weekend" },
];

function AttendanceTab({ authHeaders }: { authHeaders: Record<string, string> }) {
  const [date, setDate] = useState(todayISO());
  const [data, setData] = useState<AttendanceSnapshot | null>(null);
  const [loading, setLoading] = useState(true);
  const [statusFilter, setStatusFilter] = useState("all");
  const [deptFilter, setDeptFilter] = useState("all");
  const [search, setSearch] = useState("");
  const [currentPage, setCurrentPage] = useState(1);
  const itemsPerPage = 10;

  useEffect(() => {
    setCurrentPage(1);
  }, [date, statusFilter, deptFilter, search]);

  // Guards against out-of-order responses: if the user flips dates quickly, an older
  // request can resolve after a newer one and must not clobber it.
  const latestRequestedDate = useRef(date);

  const fetchSnapshot = useCallback(async () => {
    const requestedDate = date;
    latestRequestedDate.current = requestedDate;
    setLoading(true);
    try {
      const res = await fetch(`/api/portal/hr/attendance?date=${requestedDate}`, {
        headers: authHeaders,
      });
      const json = await res.json();
      if (latestRequestedDate.current !== requestedDate) return;
      setData(json);
    } catch {
      if (latestRequestedDate.current !== requestedDate) return;
      toast.error("Failed to load attendance");
      setData(null);
    } finally {
      if (latestRequestedDate.current === requestedDate) setLoading(false);
    }
  }, [authHeaders, date]);

  useEffect(() => {
    fetchSnapshot();
  }, [fetchSnapshot]);

  const departments = useMemo(() => {
    const set = new Set<string>();
    (data?.members ?? []).forEach((m) => m.department && set.add(m.department));
    return Array.from(set).sort();
  }, [data]);

  const filtered = useMemo(() => {
    let rows = data?.members ?? [];
    if (statusFilter !== "all") {
      rows = rows.filter((m) => m.status.toLowerCase() === statusFilter);
    }
    if (deptFilter !== "all") {
      rows = rows.filter((m) => m.department === deptFilter);
    }
    if (search.trim()) {
      const q = search.trim().toLowerCase();
      rows = rows.filter(
        (m) => m.employee.toLowerCase().includes(q) || m.email.toLowerCase().includes(q),
      );
    }
    return rows;
  }, [data, statusFilter, deptFilter, search]);

  const totalPages = Math.max(1, Math.ceil(filtered.length / itemsPerPage));
  const paginatedRows = filtered.slice(
    (currentPage - 1) * itemsPerPage,
    currentPage * itemsPerPage,
  );

  const shiftDate = (deltaDays: number) => {
    const d = new Date(`${date}T00:00:00`);
    d.setDate(d.getDate() + deltaDays);
    setDate(
      `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`,
    );
  };

  return (
    <div className="flex flex-col h-full overflow-hidden">
      {/* Date + quick nav */}
      <div className="flex flex-wrap items-center gap-3 px-4 py-4 sm:px-8 shrink-0">
        <div className="flex items-center gap-2">
          <CalendarDays className="size-4 text-muted-foreground" />
          <Input
            type="date"
            value={date}
            onChange={(e) => setDate(e.target.value)}
            className="w-[160px] h-8 text-[13px]"
          />
        </div>
        <Button variant="secondary" size="sm" className="h-8" onClick={() => shiftDate(-1)}>
          Prev day
        </Button>
        <Button variant="secondary" size="sm" className="h-8" onClick={() => setDate(todayISO())}>
          Today
        </Button>
        <Button variant="secondary" size="sm" className="h-8" onClick={() => shiftDate(1)}>
          Next day
        </Button>
        {data?.is_weekend && <Badge variant="secondary">Weekend</Badge>}
        <div className="flex-1" />
        <ExportCsvButton
          rows={filtered.map((m) => ({
            Employee: m.employee,
            Email: m.email,
            Department: m.department,
            Designation: m.designation,
            "Reports To": m.reports_to,
            Status: m.status,
            "Leave Type": m.leave_type ?? "",
          }))}
          filename="hr-company-attendance.csv"
        />
        <Button variant="ghost" size="sm" onClick={fetchSnapshot} className="text-muted-foreground">
          <RefreshCw data-icon="inline-start" />
          Refresh
        </Button>
      </div>

      {/* Status filter — single-select toggle group, counts inline */}
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between px-4 sm:px-8 pb-3 shrink-0">
        <ToggleGroup
          type="single"
          value={statusFilter}
          onValueChange={(v) => v && setStatusFilter(v)}
          className="flex-wrap justify-start"
        >
          {ATTENDANCE_STATUS_FILTERS.map(({ key, label }) => {
            const count = data?.success
              ? key === "all"
                ? data.headcount
                : data.totals[key.replace(/[- ]/g, "_")]
              : undefined;
            return (
              <ToggleGroupItem key={key} value={key}>
                {label}
                {count !== undefined && <span className="tabular-nums opacity-70">{count}</span>}
              </ToggleGroupItem>
            );
          })}
        </ToggleGroup>
        <div className="flex gap-2 items-center">
          <Select value={deptFilter} onValueChange={setDeptFilter}>
            <SelectTrigger className="h-8 w-[160px] text-[12px]">
              <SelectValue placeholder="Department" />
            </SelectTrigger>
            <SelectContent>
              <SelectGroup>
                <SelectItem value="all">All Departments</SelectItem>
                {departments.map((d) => (
                  <SelectItem key={d} value={d}>
                    {d}
                  </SelectItem>
                ))}
              </SelectGroup>
            </SelectContent>
          </Select>
          <div className="relative">
            <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 size-3.5 text-muted-foreground pointer-events-none" />
            <Input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search name or email…"
              className="h-8 w-[200px] pl-8 text-[12px]"
            />
          </div>
        </div>
      </div>

      {/* Table */}
      <div className="flex-1 overflow-auto px-4 sm:px-8 pb-4">
        {loading ? (
          <Table>
            <TableHeader>
              <TableRow>
                {["Employee", "Department", "Designation", "Reports To", "Status"].map((h) => (
                  <TableHead key={h}>{h}</TableHead>
                ))}
              </TableRow>
            </TableHeader>
            <TableBody>
              {Array.from({ length: 8 }).map((_, i) => (
                <TableRow key={i}>
                  {Array.from({ length: 5 }).map((__, j) => (
                    <TableCell key={j} className="py-3 pr-4">
                      <Skeleton className="h-4 w-full max-w-32" />
                    </TableCell>
                  ))}
                </TableRow>
              ))}
            </TableBody>
          </Table>
        ) : !data?.success ? (
          <Empty className="h-full">
            <EmptyHeader>
              <EmptyMedia variant="icon">
                <AlertCircle />
              </EmptyMedia>
              <EmptyTitle>Couldn't load attendance</EmptyTitle>
              <EmptyDescription>
                {data?.message || "Something went wrong fetching today's attendance."}
              </EmptyDescription>
            </EmptyHeader>
          </Empty>
        ) : filtered.length === 0 ? (
          <Empty className="h-full">
            <EmptyHeader>
              <EmptyMedia variant="icon">
                <Users />
              </EmptyMedia>
              <EmptyTitle>No employees match these filters</EmptyTitle>
              <EmptyDescription>
                Try a different date, status, or department.
              </EmptyDescription>
            </EmptyHeader>
          </Empty>
        ) : (
          <div className="space-y-4">
            <Table>
              <TableHeader>
                <TableRow>
                  {["Employee", "Department", "Designation", "Reports To", "Status"].map((h) => (
                    <TableHead key={h}>{h}</TableHead>
                  ))}
                </TableRow>
              </TableHeader>
              <TableBody>
                {paginatedRows.map((m) => (
                  <TableRow key={m.email}>
                    <TableCell className="py-3 pr-4">
                      <div className="text-[13px] font-medium text-foreground leading-tight">
                        {m.employee}
                      </div>
                      <div className="text-[11px] text-muted-foreground">{m.email}</div>
                    </TableCell>
                    <TableCell className="py-3 pr-4 text-[13px] text-foreground/80">
                      {m.department || "—"}
                    </TableCell>
                    <TableCell className="py-3 pr-4 text-[13px] text-foreground/80">
                      {m.designation || "—"}
                    </TableCell>
                    <TableCell className="py-3 pr-4 text-[13px] text-foreground/80">
                      {m.reports_to || "—"}
                    </TableCell>
                    <TableCell className="py-3 pr-4">
                      <Badge variant={ATTENDANCE_STATUS_BADGE[m.status.toLowerCase()] ?? "outline"}>
                        {m.status}
                      </Badge>
                      {m.status === "On Leave" && m.leave_type && (
                        <p className="mt-1 text-[11px] text-muted-foreground">{m.leave_type}</p>
                      )}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
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

// ── Leave Records Tab ────────────────────────────────────────────────────────

interface LeaveHistoryEntry {
  type: string;
  from: string;
  to: string;
  days: number;
  status: string;
  reason: string;
}

interface LeaveRecordEmployee {
  employee_id: string;
  name: string;
  email: string;
  department: string | null;
  history: LeaveHistoryEntry[];
  upcoming: LeaveHistoryEntry[];
}

function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  return ((parts[0]?.[0] ?? "") + (parts[parts.length - 1]?.[0] ?? "")).toUpperCase() || "—";
}

function LeaveRecordsTab({ authHeaders }: { authHeaders: Record<string, string> }) {
  const [records, setRecords] = useState<LeaveRecordEmployee[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [expanded, setExpanded] = useState<string | null>(null);
  const [deptFilter, setDeptFilter] = useState("all");
  const [typeFilter, setTypeFilter] = useState("all");
  const [statusFilter, setStatusFilter] = useState("all");
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");

  const fetchRecords = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/portal/hr/leave-records", { headers: authHeaders });
      const json = await res.json();
      setRecords(json.employees ?? []);
    } catch {
      toast.error("Failed to load leave records");
    } finally {
      setLoading(false);
    }
  }, [authHeaders]);

  useEffect(() => {
    fetchRecords();
  }, [fetchRecords]);

  const departments = useMemo(() => {
    const set = new Set<string>();
    records.forEach((r) => r.department && set.add(r.department));
    return Array.from(set).sort();
  }, [records]);

  const leaveTypes = useMemo(() => {
    const set = new Set<string>();
    records.forEach((r) => r.history.forEach((h) => h.type && set.add(h.type)));
    return Array.from(set).sort();
  }, [records]);

  const statuses = useMemo(() => {
    const set = new Set<string>();
    records.forEach((r) => r.history.forEach((h) => h.status && set.add(h.status)));
    return Array.from(set).sort();
  }, [records]);

  const hasHistoryFilter = typeFilter !== "all" || statusFilter !== "all" || !!dateFrom || !!dateTo;

  const matchesHistoryFilters = useCallback(
    (h: LeaveHistoryEntry) => {
      if (typeFilter !== "all" && h.type !== typeFilter) return false;
      if (statusFilter !== "all" && h.status !== statusFilter) return false;
      if (dateFrom && h.to < dateFrom) return false;
      if (dateTo && h.from > dateTo) return false;
      return true;
    },
    [typeFilter, statusFilter, dateFrom, dateTo],
  );

  const filtered = useMemo(() => {
    let rows = records;
    if (deptFilter !== "all") {
      rows = rows.filter((r) => r.department === deptFilter);
    }
    if (search.trim()) {
      const q = search.trim().toLowerCase();
      rows = rows.filter((r) => r.name.toLowerCase().includes(q) || r.email.toLowerCase().includes(q));
    }
    if (hasHistoryFilter) {
      rows = rows
        .map((r) => ({ ...r, history: r.history.filter(matchesHistoryFilters) }))
        .filter((r) => r.history.length > 0);
    }
    return rows;
  }, [records, deptFilter, search, hasHistoryFilter, matchesHistoryFilters]);

  const activeFilterCount = [
    deptFilter !== "all",
    typeFilter !== "all",
    statusFilter !== "all",
    !!dateFrom,
    !!dateTo,
  ].filter(Boolean).length;

  const clearFilters = () => {
    setDeptFilter("all");
    setTypeFilter("all");
    setStatusFilter("all");
    setDateFrom("");
    setDateTo("");
  };

  const stats = useMemo(() => {
    const weekOut = new Date();
    weekOut.setDate(weekOut.getDate() + 7);
    const weekOutISO = weekOut.toISOString().slice(0, 10);
    return {
      employees: records.length,
      onLeaveThisWeek: records.filter((r) => r.upcoming.some((u) => u.from <= weekOutISO)).length,
      totalRequests: records.reduce((sum, r) => sum + r.history.length, 0),
    };
  }, [records]);

  const STATS: { label: string; value: number; icon: React.ElementType; color: string; bg: string }[] = [
    { label: "Employees on Record", value: stats.employees, icon: Users, color: "text-sky-400", bg: "bg-sky-500/10" },
    { label: "On Leave Within 7 Days", value: stats.onLeaveThisWeek, icon: CalendarDays, color: "text-amber-400", bg: "bg-amber-500/10" },
    { label: "Total Leave Requests", value: stats.totalRequests, icon: CheckCircle2, color: "text-emerald-400", bg: "bg-emerald-500/10" },
  ];

  return (
    <div className="flex flex-col h-full overflow-hidden">
      {/* Stats */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 sm:gap-4 px-4 py-4 sm:px-8 shrink-0">
        {STATS.map(({ label, value, icon: Icon, color, bg }) => (
          <div
            key={label}
            className="rounded-xl border border-[var(--border)] bg-card/40 px-5 py-4 flex items-center gap-4"
          >
            <div className={cn("rounded-lg p-2.5 shrink-0", bg, color)}>
              <Icon className="h-4 w-4" />
            </div>
            <div>
              <p className={cn("text-[22px] font-bold", color)}>{value}</p>
              <p className="text-[12px] text-muted-foreground">{label}</p>
            </div>
          </div>
        ))}
      </div>

      <div className="flex flex-wrap items-center gap-2 px-4 pb-3 sm:px-8 shrink-0">
        <div className="relative">
          <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 size-3.5 text-muted-foreground pointer-events-none" />
          <Input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search name or email…"
            className="h-8 w-[200px] pl-8 text-[12px]"
          />
        </div>
        <Select value={deptFilter} onValueChange={setDeptFilter}>
          <SelectTrigger className="h-8 w-[150px] text-[12px]">
            <SelectValue placeholder="Department" />
          </SelectTrigger>
          <SelectContent>
            <SelectGroup>
              <SelectItem value="all">All Departments</SelectItem>
              {departments.map((d) => (
                <SelectItem key={d} value={d}>
                  {d}
                </SelectItem>
              ))}
            </SelectGroup>
          </SelectContent>
        </Select>
        <Select value={typeFilter} onValueChange={setTypeFilter}>
          <SelectTrigger className="h-8 w-[150px] text-[12px]">
            <SelectValue placeholder="Leave Type" />
          </SelectTrigger>
          <SelectContent>
            <SelectGroup>
              <SelectItem value="all">All Leave Types</SelectItem>
              {leaveTypes.map((t) => (
                <SelectItem key={t} value={t}>
                  {t}
                </SelectItem>
              ))}
            </SelectGroup>
          </SelectContent>
        </Select>
        <Select value={statusFilter} onValueChange={setStatusFilter}>
          <SelectTrigger className="h-8 w-[140px] text-[12px]">
            <SelectValue placeholder="Status" />
          </SelectTrigger>
          <SelectContent>
            <SelectGroup>
              <SelectItem value="all">All Statuses</SelectItem>
              {statuses.map((s) => (
                <SelectItem key={s} value={s}>
                  {s}
                </SelectItem>
              ))}
            </SelectGroup>
          </SelectContent>
        </Select>
        <div className="flex items-center gap-1.5">
          <Input
            type="date"
            value={dateFrom}
            onChange={(e) => setDateFrom(e.target.value)}
            className="h-8 w-[140px] text-[12px]"
            aria-label="From date"
          />
          <span className="text-[12px] text-muted-foreground">to</span>
          <Input
            type="date"
            value={dateTo}
            onChange={(e) => setDateTo(e.target.value)}
            className="h-8 w-[140px] text-[12px]"
            aria-label="To date"
          />
        </div>
        {activeFilterCount > 0 && (
          <Button variant="ghost" size="sm" onClick={clearFilters} className="h-8 text-muted-foreground">
            <X data-icon="inline-start" />
            Clear filters ({activeFilterCount})
          </Button>
        )}
        <div className="flex-1" />
        <ExportCsvButton
          rows={filtered.map((r) => ({
            Employee: r.name,
            Email: r.email,
            Department: r.department ?? "",
            "Upcoming Leave": r.upcoming
              .map((u) => `${u.type} ${u.from}${u.to !== u.from ? `→${u.to}` : ""}`)
              .join("; "),
            "Leave Taken": r.history.length,
            "Last Request": r.history[0] ? `${r.history[0].from} · ${r.history[0].status}` : "",
          }))}
          filename="hr-leave-records.csv"
        />
        <Button variant="ghost" size="sm" onClick={fetchRecords} className="text-muted-foreground">
          <RefreshCw data-icon="inline-start" />
          Refresh
        </Button>
      </div>

      <div className="flex-1 overflow-auto px-4 sm:px-8 pb-4">
        {loading ? (
          <TableLoader />
        ) : filtered.length === 0 ? (
          <TableEmpty label="leave records" icon={<CalendarDays className="h-4 w-4" />} />
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                {["Employee", "Department", "Upcoming Leave", "Leave Taken", "Last Request"].map((h) => (
                  <TableHead key={h}>{h}</TableHead>
                ))}
                <TableHead className="w-8" />
              </TableRow>
            </TableHeader>
            <TableBody>
              {filtered.map((r) => {
                const isExpanded = expanded === r.email;
                const last = r.history[0];
                return (
                  <React.Fragment key={r.email}>
                    <TableRow
                      className="cursor-pointer"
                      onClick={() => setExpanded(isExpanded ? null : r.email)}
                    >
                      <TableCell className="py-3 pr-4">
                        <div className="flex items-center gap-3">
                          <Avatar className="h-8 w-8">
                            <AvatarFallback className="text-[11px]">{initials(r.name)}</AvatarFallback>
                          </Avatar>
                          <div>
                            <div className="text-[13px] font-medium text-foreground leading-tight">
                              {r.name}
                            </div>
                            <div className="text-[11px] text-muted-foreground">{r.email}</div>
                          </div>
                        </div>
                      </TableCell>
                      <TableCell className="py-3 pr-4 text-[13px] text-foreground/80">
                        {r.department || "—"}
                      </TableCell>
                      <TableCell className="py-3 pr-4">
                        {r.upcoming.length === 0 ? (
                          <span className="text-[13px] text-muted-foreground/60">None</span>
                        ) : (
                          <div className="flex flex-col gap-0.5">
                            {r.upcoming.slice(0, 2).map((u, i) => (
                              <span key={i} className="text-[12px] text-foreground/80">
                                {u.type} · {u.from}
                                {u.to !== u.from ? ` → ${u.to}` : ""}
                              </span>
                            ))}
                            {r.upcoming.length > 2 && (
                              <span className="text-[11px] text-muted-foreground">
                                +{r.upcoming.length - 2} more
                              </span>
                            )}
                          </div>
                        )}
                      </TableCell>
                      <TableCell className="py-3 pr-4">
                        <Badge variant="secondary" className="text-[12px] font-semibold">
                          {r.history.length}
                        </Badge>
                      </TableCell>
                      <TableCell className="py-3 pr-4 text-[12px] text-muted-foreground/70 whitespace-nowrap">
                        {last ? `${last.from} · ${last.status}` : "—"}
                      </TableCell>
                      <TableCell className="py-3 pr-2 text-muted-foreground/50">
                        <ChevronDown
                          className={cn("h-4 w-4 transition-transform", isExpanded && "rotate-180")}
                        />
                      </TableCell>
                    </TableRow>
                    {isExpanded && (
                      <TableRow>
                        <TableCell colSpan={6} className="bg-muted/20 py-3 px-4">
                          <div className="space-y-2">
                            {r.history.map((h, i) => (
                              <div
                                key={i}
                                className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[12px] border-b border-border/30 last:border-0 pb-2 last:pb-0"
                              >
                                <span className="font-medium text-foreground">{h.type}</span>
                                <span className="text-muted-foreground">
                                  {h.from}
                                  {h.to !== h.from ? ` → ${h.to}` : ""} ({h.days}d)
                                </span>
                                <StatusBadge status={h.status} className="px-2 py-0 text-[10px]" />
                                {h.reason && (
                                  <span className="text-muted-foreground/80 italic">"{h.reason}"</span>
                                )}
                              </div>
                            ))}
                          </div>
                        </TableCell>
                      </TableRow>
                    )}
                  </React.Fragment>
                );
              })}
            </TableBody>
          </Table>
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

