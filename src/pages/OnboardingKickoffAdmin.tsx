import React, { useState, useEffect, useCallback } from "react";
import {
  Loader2,
  RefreshCw,
  Gift,
  Settings2,
  Plus,
  Pencil,
  Trash2,
  Send,
  RotateCcw,
  AlertCircle,
  FileText,
  CheckCircle2,
  UserPlus,
  Rocket,
  Search,
  CalendarClock,
  Users2,
  Clock,
  X,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { toast } from "sonner";
import { StatusBadge } from "@/components/ui/StatusBadge";
import { ExportCsvButton } from "@/components/ui/ExportCsvButton";
import { TableLoader } from "@/components/ui/TableLoader";
import { TableEmpty } from "@/components/ui/TableEmpty";
import { Skeleton } from "@/components/ui/skeleton";
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
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

// This is the "Kickoff" view inside Onboarding Tracker — everything that gets a new
// hire's onboarding actually moving: adding the employee, one-click triggering /
// resending welcome emails and manager intro-call invites, and the templates/settings
// behind them. Kept as its own file (mirrors OnboardingContentAdmin.tsx's pattern of a
// self-contained admin surface with its own nested tab bar) so OnboardingTracker.tsx
// stays focused on journey progress + step/document/video configuration.

// ── Types ─────────────────────────────────────────────────────────────────────

interface OnboardingAuditRow {
  employee_id: number;
  name: string;
  email: string;
  department: string | null;
  designation: string | null;
  added_at: string | null;
  welcome: {
    log_id: number | null;
    status: "not_started" | "pending_hr" | "welcome_sent" | "skipped";
    initiated_at: string | null;
    initiated_by: string | null;
    completed_at: string | null;
  };
  manager_call: {
    invite_id: number | null;
    status: "not_started" | "pending" | "scheduled" | "cancelled";
    manager_name: string | null;
    manager_email: string | null;
    initiated_at: string | null;
    completed_at: string | null;
  };
  journey: {
    status: "not_started" | "active" | "completed";
    started_at: string | null;
    completed_at: string | null;
  };
  documents: {
    submitted: number;
    required: number;
    failed: number;
    failed_ids: number[];
  };
  onboarding_triggered: boolean;
}

interface OnboardingAuditPage {
  total: number;
  offset: number;
  limit: number;
  results: OnboardingAuditRow[];
}

interface EmailHealth {
  connected: boolean;
  mailbox: string;
  reason: string | null;
}

interface WelcomeResourceSnapshot {
  name: string;
  category: string | null;
  url: string | null;
}

interface WelcomeLog {
  id: number;
  employee_name: string;
  employee_email: string;
  status: "pending_hr" | "welcome_sent" | "skipped";
  created_at: string;
  acted_at: string | null;
  acted_by: string | null;
  resources_sent: WelcomeResourceSnapshot[];
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
  "App Guide",
  "HR",
  "Policy",
  "IT",
  "Admin",
  "Facilities",
  "Video",
  "Deck",
  "General",
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

// ── Onboarding Tab (audit trail + one-click trigger) ─────────────────────────

const EMPLOYMENT_TYPE_OPTIONS = ["Full-time", "Part-time", "Contract", "Intern"];

const EMPTY_NEW_EMPLOYEE = {
  name: "",
  email: "",
  department: "",
  designation: "",
  location: "",
  joining_date: "",
  employment_type: "Full-time",
};

const WELCOME_LABEL: Record<string, string> = {
  not_started: "Not sent",
  pending_hr: "Awaiting HR",
  welcome_sent: "Sent",
  skipped: "Skipped",
};
const WELCOME_COLOR: Record<string, string> = {
  not_started: "bg-zinc-500/15 text-zinc-400",
  pending_hr: "bg-amber-500/15 text-amber-400",
  welcome_sent: "bg-emerald-500/15 text-emerald-400",
  skipped: "bg-zinc-500/15 text-zinc-400",
};
const MC_LABEL: Record<string, string> = {
  not_started: "Not invited",
  pending: "Pending",
  scheduled: "Scheduled",
  cancelled: "Cancelled",
};
const MC_COLOR: Record<string, string> = {
  not_started: "bg-zinc-500/15 text-zinc-400",
  pending: "bg-amber-500/15 text-amber-400",
  scheduled: "bg-emerald-500/15 text-emerald-400",
  cancelled: "bg-zinc-500/15 text-zinc-400",
};
const JOURNEY_LABEL: Record<string, string> = {
  not_started: "Not started",
  active: "In progress",
  completed: "Completed",
};
const JOURNEY_COLOR: Record<string, string> = {
  not_started: "bg-zinc-500/15 text-zinc-400",
  active: "bg-sky-500/15 text-sky-400",
  completed: "bg-emerald-500/15 text-emerald-400",
};

function Pill({ label, color, title }: { label: string; color: string; title?: string }) {
  return (
    <span className={cn("rounded-full px-2 py-0.5 text-[11px] font-medium", color)} title={title}>
      {label}
    </span>
  );
}

function shortDate(iso: string | null): string {
  return iso ? iso.slice(0, 10) : "—";
}

function AddEmployeeForm({
  authHeaders,
  onSuccess,
}: {
  authHeaders: Record<string, string>;
  onSuccess: () => void;
}) {
  const [form, setForm] = useState({ ...EMPTY_NEW_EMPLOYEE });
  const [submitting, setSubmitting] = useState(false);

  const setField = (key: keyof typeof EMPTY_NEW_EMPLOYEE, value: string) =>
    setForm((f) => ({ ...f, [key]: value }));

  const submit = async () => {
    if (!form.name.trim() || !form.email.trim()) {
      toast.error("Name and email are required");
      return;
    }
    setSubmitting(true);
    try {
      const res = await fetch("/api/people/employees", {
        method: "POST",
        headers: authHeaders,
        body: JSON.stringify(form),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(data.detail || "Failed to add employee");
      }
      toast.success(data.message || `${form.name} added`);
      setForm({ ...EMPTY_NEW_EMPLOYEE });
      onSuccess();
    } catch (e: unknown) {
      toast.error((e as Error).message);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="space-y-4">
      <p className="text-[12px] text-muted-foreground -mt-2">
        Sends the welcome email and invites the manager automatically — no extra step
        needed. Switch to "review" mode under Welcome Resources if you'd rather approve
        each welcome email first.
      </p>
      <div className="grid grid-cols-2 gap-4">
        <div className="col-span-2 sm:col-span-1">
          <label className="block text-[11px] text-muted-foreground mb-1 uppercase tracking-wide">
            Name *
          </label>
          <Input value={form.name} onChange={(e) => setField("name", e.target.value)} placeholder="Jane Doe" />
        </div>
        <div className="col-span-2 sm:col-span-1">
          <label className="block text-[11px] text-muted-foreground mb-1 uppercase tracking-wide">
            Email *
          </label>
          <Input
            type="email"
            value={form.email}
            onChange={(e) => setField("email", e.target.value)}
            placeholder="jane.doe@company.com"
          />
        </div>
        <div className="col-span-2 sm:col-span-1">
          <label className="block text-[11px] text-muted-foreground mb-1 uppercase tracking-wide">
            Department
          </label>
          <Input
            value={form.department}
            onChange={(e) => setField("department", e.target.value)}
            placeholder="Engineering"
          />
        </div>
        <div className="col-span-2 sm:col-span-1">
          <label className="block text-[11px] text-muted-foreground mb-1 uppercase tracking-wide">
            Designation
          </label>
          <Input
            value={form.designation}
            onChange={(e) => setField("designation", e.target.value)}
            placeholder="Software Engineer"
          />
        </div>
        <div className="col-span-2 sm:col-span-1">
          <label className="block text-[11px] text-muted-foreground mb-1 uppercase tracking-wide">
            Location
          </label>
          <Input value={form.location} onChange={(e) => setField("location", e.target.value)} placeholder="Pune" />
        </div>
        <div className="col-span-2 sm:col-span-1">
          <label className="block text-[11px] text-muted-foreground mb-1 uppercase tracking-wide">
            Joining Date
          </label>
          <Input
            type="date"
            value={form.joining_date}
            onChange={(e) => setField("joining_date", e.target.value)}
          />
        </div>
        <div className="col-span-2 sm:col-span-1">
          <label className="block text-[11px] text-muted-foreground mb-1 uppercase tracking-wide">
            Employment Type
          </label>
          <Select value={form.employment_type} onValueChange={(v) => setField("employment_type", v)}>
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {EMPLOYMENT_TYPE_OPTIONS.map((opt) => (
                <SelectItem key={opt} value={opt}>
                  {opt}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>

      <Button onClick={submit} disabled={submitting} className="w-full sm:w-auto">
        {submitting ? (
          <Loader2 className="h-3.5 w-3.5 animate-spin mr-1.5" />
        ) : (
          <UserPlus className="h-3.5 w-3.5 mr-1.5" />
        )}
        Add Employee
      </Button>
    </div>
  );
}

function OnboardingTab({ authHeaders }: { authHeaders: Record<string, string> }) {
  const [rows, setRows] = useState<OnboardingAuditRow[]>([]);
  const [total, setTotal] = useState(0);
  const [counts, setCounts] = useState({ not_triggered: 0, in_progress: 0, completed: 0 });
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(0); // 0-indexed
  const [addOpen, setAddOpen] = useState(false);
  const [triggering, setTriggering] = useState<number | null>(null);
  const [resendingWelcome, setResendingWelcome] = useState<number | null>(null);
  const [resendingInvite, setResendingInvite] = useState<number | null>(null);
  const [resendingDocs, setResendingDocs] = useState<number | null>(null);
  const [health, setHealth] = useState<EmailHealth | null>(null);
  const itemsPerPage = 10;

  const fetchAudit = useCallback(
    async (q: string, pageIndex: number) => {
      setLoading(true);
      try {
        const params = new URLSearchParams();
        if (q) params.set("q", q);
        params.set("limit", String(itemsPerPage));
        params.set("offset", String(pageIndex * itemsPerPage));
        const res = await fetch(`/api/people/onboarding-audit?${params.toString()}`, { headers: authHeaders });
        if (!res.ok) throw new Error("Failed");
        const data: OnboardingAuditPage & { counts: typeof counts } = await res.json();
        setRows(data.results);
        setTotal(data.total);
        setCounts(data.counts);
      } catch {
        toast.error("Failed to load onboarding audit");
      } finally {
        setLoading(false);
      }
    },
    [authHeaders],
  );

  const fetchHealth = useCallback(async () => {
    try {
      const res = await fetch("/api/portal/hr/email-health", { headers: authHeaders });
      if (res.ok) setHealth(await res.json());
    } catch {
      /* non-fatal */
    }
  }, [authHeaders]);

  useEffect(() => {
    fetchHealth();
  }, [fetchHealth]);

  useEffect(() => {
    const t = setTimeout(() => fetchAudit(search, page), 300);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [search, page]);

  const triggerOnboarding = async (row: OnboardingAuditRow) => {
    setTriggering(row.employee_id);
    try {
      const res = await fetch(`/api/people/employees/${row.employee_id}/trigger-onboarding`, {
        method: "POST",
        headers: authHeaders,
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.detail || "Failed to trigger onboarding");
      toast.success(`Onboarding triggered for ${row.name}`);
      fetchAudit(search, page);
    } catch (e: unknown) {
      toast.error((e as Error).message);
    } finally {
      setTriggering(null);
    }
  };

  const resendWelcome = async (row: OnboardingAuditRow) => {
    if (!row.welcome.log_id) return;
    setResendingWelcome(row.employee_id);
    try {
      const res = await fetch(`/api/portal/hr/welcome/resend/${row.welcome.log_id}`, {
        method: "POST",
        headers: authHeaders,
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.detail || "Resend failed");
      toast.success(data.message || "Welcome email resent");
      fetchAudit(search, page);
    } catch (e: unknown) {
      toast.error((e as Error).message);
    } finally {
      setResendingWelcome(null);
    }
  };

  const resendInvite = async (row: OnboardingAuditRow) => {
    if (!row.manager_call.invite_id) return;
    setResendingInvite(row.employee_id);
    try {
      const res = await fetch(`/api/manager-call/invites/${row.manager_call.invite_id}/resend`, {
        method: "POST",
        headers: authHeaders,
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.detail || "Resend failed");
      toast.success("Manager invite resent");
      fetchAudit(search, page);
    } catch (e: unknown) {
      toast.error((e as Error).message);
    } finally {
      setResendingInvite(null);
    }
  };

  const resendDocs = async (row: OnboardingAuditRow) => {
    const ids = row.documents.failed_ids;
    if (!ids.length) return;
    setResendingDocs(row.employee_id);
    try {
      const results = await Promise.all(
        ids.map((id) =>
          fetch(`/api/onboard/admin/doc-submissions/${id}/resend`, {
            method: "POST",
            headers: authHeaders,
          })
            .then((res) => res.ok)
            .catch(() => false),
        ),
      );
      const okCount = results.filter(Boolean).length;
      if (okCount === ids.length) {
        toast.success(`Resent ${okCount} document${okCount === 1 ? "" : "s"} to HR`);
      } else {
        toast.error(`Resent ${okCount}/${ids.length} documents — some still failed`);
      }
      fetchAudit(search, page);
    } finally {
      setResendingDocs(null);
    }
  };

  const totalPages = Math.max(1, Math.ceil(total / itemsPerPage));

  return (
    <div className="flex flex-col h-full overflow-hidden">
      {health && !health.connected && (
        <div className="mx-8 mt-4 rounded-xl border border-rose-500/30 bg-rose-500/10 px-5 py-3 flex items-center gap-3 shrink-0">
          <AlertCircle className="h-4 w-4 text-rose-400 shrink-0" />
          <p className="text-[13px] text-rose-200">
            Onboarding email delivery is broken
            {health.mailbox ? ` — ${health.mailbox} isn't connected` : " — no sender mailbox configured"}.
            Connect a Microsoft 365 account under Settings → Integrations.
          </p>
        </div>
      )}
      {health && health.connected && (
        <div className="mx-8 mt-4 rounded-lg border border-emerald-500/20 bg-emerald-500/5 px-5 py-2 flex items-center gap-2 shrink-0">
          <CheckCircle2 className="h-3.5 w-3.5 text-emerald-400 shrink-0" />
          <p className="text-[12px] text-emerald-300/80">
            Onboarding email delivery OK — sending as {health.mailbox}
          </p>
        </div>
      )}

      <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 px-8 py-4 shrink-0">
        {[
          { label: "Total Employees", value: total, color: "text-foreground", icon: Users2 },
          { label: "Not Triggered", value: counts.not_triggered, color: "text-amber-400", icon: Clock },
          { label: "Onboarding", value: counts.in_progress, color: "text-sky-400", icon: Rocket },
          { label: "Completed", value: counts.completed, color: "text-emerald-400", icon: CheckCircle2 },
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

      <div className="flex flex-col md:flex-row md:items-center justify-between gap-3 px-8 pb-3 shrink-0">
        <div className="relative w-full md:w-72">
          <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground/60" />
          <Input
            value={search}
            onChange={(e) => {
              setSearch(e.target.value);
              setPage(0);
            }}
            placeholder="Search by name or email…"
            className="pl-8"
          />
        </div>
        <div className="flex gap-2 shrink-0">
          <ExportCsvButton
            rows={rows.map((r) => ({
              Employee: r.name,
              Email: r.email,
              Department: r.department ?? "",
              Designation: r.designation ?? "",
              Added: shortDate(r.added_at),
              "Welcome Email": WELCOME_LABEL[r.welcome.status],
              "Manager Call": MC_LABEL[r.manager_call.status],
              Documents: `${r.documents.submitted}/${r.documents.required}`,
              Journey: JOURNEY_LABEL[r.journey.status],
            }))}
            filename="onboarding-kickoff.csv"
          />
          <Button
            variant="ghost"
            size="sm"
            onClick={() => fetchAudit(search, page)}
            className="flex items-center gap-2 text-muted-foreground"
          >
            <RefreshCw className="h-3.5 w-3.5" />
            Refresh
          </Button>
          <Button onClick={() => setAddOpen(true)} className="flex items-center gap-1.5">
            <UserPlus className="h-3.5 w-3.5" />
            Add Employee
          </Button>
        </div>
      </div>

      <div className="flex-1 overflow-auto px-8 pb-8">
        {loading ? (
          <TableLoader />
        ) : rows.length === 0 ? (
          <TableEmpty icon={<Rocket className="h-4 w-4" />}>
            <span>No employees found</span>
          </TableEmpty>
        ) : (
          <div className="space-y-4">
            <Table>
              <TableHeader>
                <TableRow>
                  {["Employee", "Added", "Welcome Email", "Manager Call", "Documents", "Journey", "Actions"].map(
                    (h) => (
                      <TableHead key={h}>{h}</TableHead>
                    ),
                  )}
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map((r) => (
                  <TableRow key={r.employee_id}>
                    <TableCell className="py-3.5 pr-4">
                      <div className="font-medium text-foreground">{r.name}</div>
                      <div className="text-[11px] text-muted-foreground">{r.email}</div>
                      {(r.department || r.designation) && (
                        <div className="text-[11px] text-muted-foreground/70">
                          {[r.designation, r.department].filter(Boolean).join(" · ")}
                        </div>
                      )}
                    </TableCell>
                    <TableCell className="py-3.5 pr-4 text-foreground/60">{shortDate(r.added_at)}</TableCell>
                    <TableCell className="py-3.5 pr-4">
                      <Pill
                        label={WELCOME_LABEL[r.welcome.status]}
                        color={WELCOME_COLOR[r.welcome.status]}
                        title={
                          r.welcome.initiated_by
                            ? `Initiated by ${r.welcome.initiated_by} on ${shortDate(r.welcome.initiated_at)}`
                            : undefined
                        }
                      />
                      {r.welcome.completed_at && (
                        <div className="text-[10px] text-muted-foreground/60 mt-0.5">
                          {shortDate(r.welcome.completed_at)}
                        </div>
                      )}
                    </TableCell>
                    <TableCell className="py-3.5 pr-4">
                      <Pill
                        label={MC_LABEL[r.manager_call.status]}
                        color={MC_COLOR[r.manager_call.status]}
                        title={r.manager_call.manager_name || r.manager_call.manager_email || undefined}
                      />
                      {r.manager_call.completed_at && (
                        <div className="text-[10px] text-muted-foreground/60 mt-0.5">
                          {shortDate(r.manager_call.completed_at)}
                        </div>
                      )}
                    </TableCell>
                    <TableCell className="py-3.5 pr-4">
                      <span
                        className={cn(
                          "text-[12px]",
                          r.documents.failed > 0 ? "text-rose-400" : "text-foreground/70",
                        )}
                      >
                        {r.documents.submitted}/{r.documents.required}
                      </span>
                      {r.documents.failed > 0 && (
                        <div className="text-[10px] text-rose-400 mt-0.5">{r.documents.failed} failed</div>
                      )}
                    </TableCell>
                    <TableCell className="py-3.5 pr-4">
                      <Pill label={JOURNEY_LABEL[r.journey.status]} color={JOURNEY_COLOR[r.journey.status]} />
                    </TableCell>
                    <TableCell className="py-3.5 pr-4">
                      <div className="flex items-center gap-1.5 flex-wrap">
                        {!r.onboarding_triggered && (
                          <Button
                            size="sm"
                            onClick={() => triggerOnboarding(r)}
                            disabled={triggering === r.employee_id}
                            className="flex items-center gap-1.5"
                          >
                            {triggering === r.employee_id ? (
                              <Loader2 className="h-3 w-3 animate-spin" />
                            ) : (
                              <Rocket className="h-3 w-3" />
                            )}
                            Trigger Onboarding
                          </Button>
                        )}
                        {r.onboarding_triggered && r.welcome.status !== "welcome_sent" && r.welcome.log_id && (
                          <Button
                            variant="outline"
                            size="sm"
                            title="Resend welcome email"
                            onClick={() => resendWelcome(r)}
                            disabled={resendingWelcome === r.employee_id}
                          >
                            {resendingWelcome === r.employee_id ? (
                              <Loader2 className="h-3 w-3 animate-spin" />
                            ) : (
                              <Send className="h-3 w-3" />
                            )}
                          </Button>
                        )}
                        {r.onboarding_triggered && r.manager_call.status === "pending" && r.manager_call.invite_id && (
                          <Button
                            variant="outline"
                            size="sm"
                            title="Resend manager invite"
                            onClick={() => resendInvite(r)}
                            disabled={resendingInvite === r.employee_id}
                          >
                            {resendingInvite === r.employee_id ? (
                              <Loader2 className="h-3 w-3 animate-spin" />
                            ) : (
                              <CalendarClock className="h-3 w-3" />
                            )}
                          </Button>
                        )}
                        {r.documents.failed_ids.length > 0 && (
                          <Button
                            variant="outline"
                            size="sm"
                            title="Resend failed documents to HR"
                            onClick={() => resendDocs(r)}
                            disabled={resendingDocs === r.employee_id}
                          >
                            {resendingDocs === r.employee_id ? (
                              <Loader2 className="h-3 w-3 animate-spin" />
                            ) : (
                              <FileText className="h-3 w-3" />
                            )}
                          </Button>
                        )}
                        {r.onboarding_triggered &&
                          r.welcome.status === "welcome_sent" &&
                          r.manager_call.status !== "pending" &&
                          r.documents.failed_ids.length === 0 && (
                            <span className="text-muted-foreground/30 text-[12px]">—</span>
                          )}
                      </div>
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
                        setPage((p) => Math.max(0, p - 1));
                      }}
                    />
                  </PaginationItem>
                  <PaginationItem>
                    <span className="text-sm text-muted-foreground px-4">
                      Page {page + 1} of {totalPages} · {total} total
                    </span>
                  </PaginationItem>
                  <PaginationItem>
                    <PaginationNext
                      href="#"
                      onClick={(e) => {
                        e.preventDefault();
                        setPage((p) => Math.min(totalPages - 1, p + 1));
                      }}
                    />
                  </PaginationItem>
                </PaginationContent>
              </Pagination>
            )}
          </div>
        )}
      </div>

      <Dialog open={addOpen} onOpenChange={setAddOpen}>
        <DialogContent className="max-w-xl">
          <DialogHeader>
            <DialogTitle>Add Employee</DialogTitle>
          </DialogHeader>
          <AddEmployeeForm
            authHeaders={authHeaders}
            onSuccess={() => {
              setAddOpen(false);
              fetchAudit(search, page);
            }}
          />
        </DialogContent>
      </Dialog>
    </div>
  );
}

// ── Welcome Logs Tab ──────────────────────────────────────────────────────────

function WelcomeLogsTab({ authHeaders }: { authHeaders: Record<string, string> }) {
  const [logs, setLogs] = useState<WelcomeLog[]>([]);
  const [loading, setLoading] = useState(true);
  const [resending, setResending] = useState<number | null>(null);
  const [currentPage, setCurrentPage] = useState(1);
  const itemsPerPage = 10;

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

  useEffect(() => {
    fetchLogs();
  }, [fetchLogs]);

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
          {
            label: "Pending HR Action",
            value: stats.pending,
            color: "text-amber-400",
            icon: Clock,
          },
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

      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 px-8 pb-3 shrink-0">
        <p className="text-[12px] text-muted-foreground">
          Welcome emails now send automatically when an employee is added (see the Add
          Employee tab). Use Resend here if a send failed, or switch to review mode under
          Welcome Resources to approve each one manually first.
        </p>
        <div className="flex items-center gap-2 shrink-0">
          <ExportCsvButton
            rows={logs.map((l) => ({
              Employee: l.employee_name,
              Email: l.employee_email,
              "Detected On": l.created_at.slice(0, 10),
              Status: l.status,
              "Resources Sent": l.resources_sent?.map((r) => r.name).join("; ") ?? "",
              Acted: l.acted_at ? l.acted_at.slice(0, 10) : "",
            }))}
            filename="onboarding-welcome-logs.csv"
          />
          <Button
            variant="ghost"
            size="sm"
            onClick={fetchLogs}
            className="flex items-center gap-2 text-muted-foreground"
          >
            <RefreshCw className="h-3.5 w-3.5" />
            Refresh
          </Button>
        </div>
      </div>

      <div className="flex-1 overflow-auto px-8 pb-8">
        {loading ? (
          <TableLoader />
        ) : logs.length === 0 ? (
          <TableEmpty icon={<Gift className="h-4 w-4" />}>
            <span>No welcome logs yet — they appear when new employees are detected</span>
          </TableEmpty>
        ) : (
          <div className="space-y-4">
            <Table>
              <TableHeader>
                <TableRow>
                  {["Employee", "Detected On", "Status", "Resources Sent", "Acted", "Actions"].map((h) => (
                    <TableHead key={h}>{h}</TableHead>
                  ))}
                </TableRow>
              </TableHeader>
              <TableBody>
                {logs.slice((currentPage - 1) * itemsPerPage, currentPage * itemsPerPage).map((l) => (
                  <TableRow key={l.id}>
                    <TableCell className="py-3.5 pr-4">
                      <div className="font-medium text-foreground">{l.employee_name}</div>
                      <div className="text-[11px] text-muted-foreground">{l.employee_email}</div>
                    </TableCell>
                    <TableCell className="py-3.5 pr-4 text-foreground/60">{l.created_at.slice(0, 10)}</TableCell>
                    <TableCell className="py-3.5 pr-4">
                      <StatusBadge status={l.status} />
                    </TableCell>
                    <TableCell className="py-3.5 pr-4 text-[12px]">
                      {l.resources_sent?.length ? (
                        <span
                          className="text-foreground/70"
                          title={l.resources_sent.map((r) => r.name).join(", ")}
                        >
                          {l.resources_sent.length} sent
                        </span>
                      ) : (
                        <span className="text-muted-foreground/30">—</span>
                      )}
                    </TableCell>
                    <TableCell className="py-3.5 pr-4 text-foreground/50 text-[12px]">
                      {l.acted_at ? (
                        <span title={l.acted_by ?? ""}>{l.acted_at.slice(0, 10)}</span>
                      ) : (
                        "—"
                      )}
                    </TableCell>
                    <TableCell className="py-3.5 pr-4">
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => handleResend(l.id, l.employee_name)}
                        disabled={resending === l.id}
                        className="bg-primary/10 text-primary hover:bg-primary/20 hover:text-primary border-primary/20"
                      >
                        {resending === l.id ? (
                          <Loader2 className="h-3 w-3 animate-spin mr-1.5" />
                        ) : (
                          <RotateCcw className="h-3 w-3 mr-1.5" />
                        )}
                        {l.status === "welcome_sent" ? "Resend" : "Send Now"}
                      </Button>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
            
            {Math.ceil(logs.length / itemsPerPage) > 1 && (
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
                      Page {currentPage} of {Math.ceil(logs.length / itemsPerPage)}
                    </span>
                  </PaginationItem>
                  <PaginationItem>
                    <PaginationNext
                      href="#"
                      onClick={(e) => {
                        e.preventDefault();
                        setCurrentPage((p) => Math.min(Math.ceil(logs.length / itemsPerPage), p + 1));
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

// ── Welcome Config Tab ────────────────────────────────────────────────────────

const DEFAULT_WELCOME_MESSAGE =
  "Welcome to the team, {name}! 🎉\n\nWe're thrilled to have you on board as our new {designation} in {department}. Below are the tools and resources available to you through Centriq AI — your digital workplace assistant. Just open the app and ask anything!";

const DEFAULT_WELCOME_SUBJECT = "Welcome to the team, {name}!";

const WELCOME_PLACEHOLDERS = [
  "{name}",
  "{department}",
  "{designation}",
  "{joining_date}",
  "{manager_name}",
];

function WelcomeConfigTab({ authHeaders }: { authHeaders: Record<string, string> }) {
  const [resources, setResources] = useState<WelcomeResource[]>([]);
  const [loading, setLoading] = useState(true);
  const [editingId, setEditingId] = useState<number | "new" | null>(null);
  const [form, setForm] = useState<Partial<WelcomeResource>>({});
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState<number | null>(null);
  const [resourceToDelete, setResourceToDelete] = useState<{ id: number; name: string } | null>(
    null,
  );

  // Message editor state
  const [message, setMessage] = useState("");
  const [subject, setSubject] = useState("");
  const [messageSaving, setMessageSaving] = useState(false);
  const [messageEditing, setMessageEditing] = useState(false);

  // Preview modal state
  const [previewOpen, setPreviewOpen] = useState(false);
  const [previewLoading, setPreviewLoading] = useState(false);
  const [previewHtml, setPreviewHtml] = useState("");
  const [previewSubject, setPreviewSubject] = useState("");

  // Welcome email mode (auto vs. review)
  const [mode, setMode] = useState<"auto" | "review">("auto");
  const [modeSaving, setModeSaving] = useState(false);

  const fetchMode = useCallback(async () => {
    try {
      const res = await fetch("/api/portal/hr/welcome/mode", { headers: authHeaders });
      if (res.ok) {
        const data = await res.json();
        setMode(data.mode === "review" ? "review" : "auto");
      }
    } catch {
      /* non-fatal */
    }
  }, [authHeaders]);

  const changeMode = async (next: "auto" | "review") => {
    if (next === mode) return;
    setModeSaving(true);
    try {
      const res = await fetch("/api/portal/hr/welcome/mode", {
        method: "PUT",
        headers: authHeaders,
        body: JSON.stringify({ mode: next }),
      });
      if (!res.ok) throw new Error("Save failed");
      setMode(next);
      toast.success(
        next === "auto"
          ? "Welcome emails will send automatically for new employees"
          : "New employees will require your Yes/No approval before their welcome email sends",
      );
    } catch {
      toast.error("Failed to update welcome email mode");
    } finally {
      setModeSaving(false);
    }
  };

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
        setSubject(data.subject ?? DEFAULT_WELCOME_SUBJECT);
      }
    } catch {
      /* non-fatal */
    }
  }, [authHeaders]);

  const openPreview = async () => {
    setPreviewOpen(true);
    setPreviewLoading(true);
    try {
      const res = await fetch("/api/portal/hr/welcome/preview", {
        method: "POST",
        headers: authHeaders,
        body: JSON.stringify({}),
      });
      if (!res.ok) throw new Error("Preview failed");
      const data = await res.json();
      setPreviewHtml(data.html ?? "");
      setPreviewSubject(data.subject ?? "");
    } catch {
      toast.error("Failed to render preview");
      setPreviewOpen(false);
    } finally {
      setPreviewLoading(false);
    }
  };

  useEffect(() => {
    fetchResources();
    fetchMessage();
    fetchMode();
  }, [fetchResources, fetchMessage, fetchMode]);

  const saveMessage = async () => {
    if (!message.trim()) {
      toast.error("Message cannot be empty");
      return;
    }
    setMessageSaving(true);
    try {
      const res = await fetch("/api/portal/hr/welcome/message", {
        method: "PUT",
        headers: authHeaders,
        body: JSON.stringify({ text: message, subject }),
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

  const cancelEdit = () => {
    setEditingId(null);
    setForm({});
  };

  const saveResource = async () => {
    if (!form.name?.trim()) {
      toast.error("Name is required");
      return;
    }
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
      {/* Welcome email mode */}
      <div className="mx-8 mt-4 rounded-xl border border-[var(--border)] bg-card/40 px-5 py-4 shrink-0">
        <p className="text-[13px] font-medium text-foreground">Welcome Email Mode</p>
        <p className="text-[12px] text-muted-foreground mt-0.5 mb-3">
          Controls what happens when a new employee is added.
        </p>
        <div className="flex gap-2">
          <button
            onClick={() => changeMode("auto")}
            disabled={modeSaving}
            className={cn(
              "flex-1 rounded-lg border px-4 py-2.5 text-left text-[12px] transition-colors",
              mode === "auto"
                ? "border-primary bg-primary/10 text-foreground"
                : "border-[var(--border)] text-muted-foreground hover:bg-secondary/50",
            )}
          >
            <span className="font-medium block">Automatic (recommended)</span>
            Welcome email sends immediately. HR gets an FYI, no action required.
          </button>
          <button
            onClick={() => changeMode("review")}
            disabled={modeSaving}
            className={cn(
              "flex-1 rounded-lg border px-4 py-2.5 text-left text-[12px] transition-colors",
              mode === "review"
                ? "border-primary bg-primary/10 text-foreground"
                : "border-[var(--border)] text-muted-foreground hover:bg-secondary/50",
            )}
          >
            <span className="font-medium block">Review first</span>
            HR must click Yes/No in an email before the welcome email sends.
          </button>
        </div>
      </div>

      {/* Welcome message editor */}
      <div className="mx-8 mt-4 mb-2 rounded-xl border border-[var(--border)] bg-card/40 shrink-0">
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 px-5 py-3.5 border-b border-[var(--border)]/50">
          <div>
            <p className="text-[13px] font-medium text-foreground">Welcome Message</p>
            <p className="text-[12px] text-muted-foreground mt-0.5">
              Subject + intro text sent to new employees. Placeholders:{" "}
              {WELCOME_PLACEHOLDERS.map((p, i) => (
                <React.Fragment key={p}>
                  <code className="bg-primary/10 text-primary rounded px-1">{p}</code>
                  {i < WELCOME_PLACEHOLDERS.length - 1 ? " " : ""}
                </React.Fragment>
              ))}
            </p>
          </div>
          <div className="flex items-center gap-2 shrink-0">
            <Button
              variant="outline"
              size="sm"
              onClick={openPreview}
              className="flex items-center gap-1.5 text-muted-foreground"
            >
              <Send className="h-3 w-3" />
              Preview
            </Button>
            {!messageEditing && (
              <Button
                variant="ghost"
                size="sm"
                onClick={() => setMessageEditing(true)}
                className="flex items-center gap-1.5 text-muted-foreground"
              >
                <Pencil className="h-3 w-3" />
                Edit
              </Button>
            )}
          </div>
        </div>
        <div className="px-5 py-4">
          {messageEditing ? (
            <div className="space-y-3">
              <div>
                <label className="block text-[11px] text-muted-foreground mb-1 uppercase tracking-wide">
                  Subject
                </label>
                <Input
                  value={subject}
                  onChange={(e) => setSubject(e.target.value)}
                  placeholder="Welcome to the team, {name}!"
                />
              </div>
              <div>
                <label className="block text-[11px] text-muted-foreground mb-1 uppercase tracking-wide">
                  Intro
                </label>
                <Textarea
                  rows={5}
                  value={message}
                  onChange={(e) => setMessage(e.target.value)}
                  placeholder="Welcome to the team, {name}!…"
                />
              </div>
              <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
                <Button
                  variant="link"
                  size="sm"
                  onClick={() => {
                    setMessage(DEFAULT_WELCOME_MESSAGE);
                    setSubject(DEFAULT_WELCOME_SUBJECT);
                  }}
                  className="text-muted-foreground hover:text-foreground"
                >
                  Reset to default
                </Button>
                <div className="flex gap-2">
                  <Button
                    variant="secondary"
                    size="sm"
                    onClick={() => {
                      setMessageEditing(false);
                      fetchMessage();
                    }}
                  >
                    Cancel
                  </Button>
                  <Button
                    size="sm"
                    onClick={saveMessage}
                    disabled={messageSaving}
                  >
                    {messageSaving && <Loader2 className="h-3 w-3 animate-spin mr-1.5" />}
                    Save
                  </Button>
                </div>
              </div>
            </div>
          ) : (
            <div className="space-y-1.5">
              <p className="text-[12px] text-muted-foreground">
                Subject: <span className="text-foreground/80">{subject || DEFAULT_WELCOME_SUBJECT}</span>
              </p>
              <p className="text-[13px] text-foreground/80 leading-relaxed whitespace-pre-wrap">
                {message || DEFAULT_WELCOME_MESSAGE}
              </p>
            </div>
          )}
        </div>
      </div>

      {/* Preview modal */}
      <Dialog open={previewOpen} onOpenChange={setPreviewOpen}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle>Welcome Email Preview</DialogTitle>
          </DialogHeader>
          <p className="text-[12px] text-muted-foreground -mt-2">
            Rendered with sample data using your last <strong>saved</strong> message. Subject:{" "}
            <span className="text-foreground/80">{previewSubject}</span>
          </p>
          <div className="rounded-lg border border-[var(--border)] overflow-hidden bg-white">
            {previewLoading ? (
              <div className="flex items-center justify-center h-[400px]">
                <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
              </div>
            ) : (
              <iframe
                title="Welcome email preview"
                srcDoc={previewHtml}
                className="w-full h-[500px] border-0"
              />
            )}
          </div>
        </DialogContent>
      </Dialog>

      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 px-8 py-3 shrink-0">
        <p className="text-[13px] text-muted-foreground">
          Resources below appear in the email. Supports links, videos, and slide decks.
        </p>
        <Button
          onClick={startNew}
          className="flex items-center gap-1.5 bg-primary/10 text-primary hover:bg-primary/20 shrink-0"
        >
          <Plus className="h-3.5 w-3.5" />
          Add Resource
        </Button>
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
                <Input
                  value={form.name ?? ""}
                  onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
                  placeholder="e.g. Onboarding Video, Policy Deck"
                />
              </div>
              <div className="w-24">
                <label className="block text-[11px] text-muted-foreground mb-1 uppercase tracking-wide">
                  Icon
                </label>
                <Input
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
              <Select 
                value={form.category ?? "App Guide"} 
                onValueChange={(cat) => {
                  setForm((f) => ({
                    ...f,
                    category: cat,
                    icon: CATEGORY_DEFAULT_ICON[cat] ?? f.icon ?? "📌",
                  }));
                }}
              >
                <SelectTrigger className="w-full">
                  <SelectValue placeholder="Select a category" />
                </SelectTrigger>
                <SelectContent>
                  {CATEGORY_OPTIONS.map((c) => (
                    <SelectItem key={c} value={c}>{c}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div>
              <label className="block text-[11px] text-muted-foreground mb-1 uppercase tracking-wide">
                URL (link, YouTube, Google Slides…)
              </label>
              <Input
                value={form.url ?? ""}
                onChange={(e) => setForm((f) => ({ ...f, url: e.target.value }))}
                placeholder="https://…"
              />
            </div>
            <div className="col-span-2">
              <label className="block text-[11px] text-muted-foreground mb-1 uppercase tracking-wide">
                Description
              </label>
              <Input
                value={form.description ?? ""}
                onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))}
                placeholder="Brief description shown in the email"
              />
            </div>
          </div>
          <div className="flex justify-end gap-2 mt-4">
            <Button
              variant="secondary"
              onClick={cancelEdit}
            >
              Cancel
            </Button>
            <Button
              onClick={saveResource}
              disabled={saving}
            >
              {saving && <Loader2 className="h-3.5 w-3.5 animate-spin mr-1.5" />}
              Save
            </Button>
          </div>
        </div>
      )}

      <div className="flex-1 overflow-auto px-8 pb-8">
        {loading ? (
          <div className="space-y-2 py-2">
            {Array.from({ length: 4 }).map((_, i) => (
              <div key={i} className="flex items-center gap-3 rounded-xl border border-border bg-card p-3">
                <Skeleton className="h-9 w-9 rounded-xl" />
                <div className="flex-1 space-y-1.5">
                  <Skeleton className="h-4 w-48" />
                  <Skeleton className="h-3 w-64" />
                </div>
                <Skeleton className="h-7 w-16 rounded-lg" />
              </div>
            ))}
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
                    : "border-[var(--border)]/40 bg-card/20 opacity-50",
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
                              : "bg-primary/10 text-primary",
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
                    <p className="text-[12px] text-muted-foreground mt-0.5 truncate">
                      {r.description}
                    </p>
                  )}
                </div>

                {/* Toggle */}
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => toggleActive(r)}
                  className={cn(
                    "h-7 text-[11px] px-3",
                    r.is_active
                      ? "bg-emerald-500/10 text-emerald-400 hover:bg-emerald-500/20 hover:text-emerald-400 border-emerald-500/20"
                      : "bg-zinc-500/10 text-zinc-400 hover:bg-zinc-500/20 hover:text-zinc-400 border-zinc-500/20",
                  )}
                >
                  {r.is_active ? "Active" : "Inactive"}
                </Button>

                <Button
                  variant="ghost"
                  size="icon"
                  onClick={() => startEdit(r)}
                  className="h-8 w-8 text-muted-foreground"
                >
                  <Pencil className="h-3.5 w-3.5" />
                </Button>
                <Button
                  variant="ghost"
                  size="icon"
                  onClick={() => setResourceToDelete({ id: r.id, name: r.name })}
                  disabled={deleting === r.id}
                  className="h-8 w-8 text-muted-foreground hover:bg-rose-500/10 hover:text-rose-400"
                >
                  {deleting === r.id ? (
                    <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  ) : (
                    <Trash2 className="h-3.5 w-3.5" />
                  )}
                </Button>
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
              Are you sure you want to delete "{resourceToDelete?.name}"? This action cannot be
              undone and this resource will no longer be included in welcome emails sent to new
              employees.
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

// ── Manager Call Settings Tab ─────────────────────────────────────────────────

const MC_PLACEHOLDERS = ["{new_hire_name}", "{manager_name}", "{manager_name_first}"];

interface ManagerCallSettings {
  sender_email: string;
  subject: string;
  intro: string;
  reminder_days: number;
}

const DEFAULT_MC_SETTINGS: ManagerCallSettings = {
  sender_email: "",
  subject: "Schedule an intro call with {new_hire_name}",
  intro:
    "Hi {manager_name_first},\n\n{new_hire_name} has just joined your team. Please schedule a short intro call to welcome them and help them get started.\n\nClick below to pick a date and time — a Microsoft Teams meeting will be created and sent to you both automatically.",
  reminder_days: 3,
};

function ManagerCallSettingsTab({ authHeaders }: { authHeaders: Record<string, string> }) {
  const [settings, setSettings] = useState<ManagerCallSettings>(DEFAULT_MC_SETTINGS);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  const fetchSettings = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/manager-call/settings", { headers: authHeaders });
      if (res.ok) {
        setSettings(await res.json());
      }
    } catch {
      toast.error("Failed to load manager-call settings");
    } finally {
      setLoading(false);
    }
  }, [authHeaders]);

  useEffect(() => {
    fetchSettings();
  }, [fetchSettings]);

  const save = async () => {
    setSaving(true);
    try {
      const res = await fetch("/api/manager-call/settings", {
        method: "PUT",
        headers: authHeaders,
        body: JSON.stringify(settings),
      });
      if (!res.ok) throw new Error("Save failed");
      toast.success("Manager call settings saved");
    } catch {
      toast.error("Failed to save settings");
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return (
      <div className="p-8">
        <Skeleton className="h-40 w-full max-w-2xl" />
      </div>
    );
  }

  return (
    <div className="flex-1 overflow-auto px-8 py-6">
      <div className="max-w-2xl space-y-4">
        <div className="rounded-xl border border-primary/20 bg-primary/5 px-5 py-4 flex items-start gap-3">
          <CalendarClock className="h-4 w-4 text-primary shrink-0 mt-0.5" />
          <p className="text-[13px] text-foreground/80 leading-relaxed">
            When a new hire is added, their manager gets an email inviting them to schedule
            a short intro call. Customize the sender, copy, and reminder cadence below.
          </p>
        </div>

        <div className="rounded-xl border border-[var(--border)] bg-card/40 p-5 space-y-4">
          <div>
            <label className="block text-[11px] text-muted-foreground mb-1 uppercase tracking-wide">
              Sender mailbox (optional)
            </label>
            <Input
              value={settings.sender_email}
              onChange={(e) => setSettings((s) => ({ ...s, sender_email: e.target.value }))}
              placeholder="Falls back to the configured system sender if left blank"
            />
          </div>
          <div>
            <label className="block text-[11px] text-muted-foreground mb-1 uppercase tracking-wide">
              Subject
            </label>
            <Input
              value={settings.subject}
              onChange={(e) => setSettings((s) => ({ ...s, subject: e.target.value }))}
            />
          </div>
          <div>
            <label className="block text-[11px] text-muted-foreground mb-1 uppercase tracking-wide">
              Intro — placeholders:{" "}
              {MC_PLACEHOLDERS.map((p, i) => (
                <React.Fragment key={p}>
                  <code className="bg-primary/10 text-primary rounded px-1">{p}</code>
                  {i < MC_PLACEHOLDERS.length - 1 ? " " : ""}
                </React.Fragment>
              ))}
            </label>
            <Textarea
              rows={5}
              value={settings.intro}
              onChange={(e) => setSettings((s) => ({ ...s, intro: e.target.value }))}
            />
          </div>
          <div className="w-40">
            <label className="block text-[11px] text-muted-foreground mb-1 uppercase tracking-wide">
              Reminder after (days)
            </label>
            <Input
              type="number"
              min={1}
              value={settings.reminder_days}
              onChange={(e) =>
                setSettings((s) => ({ ...s, reminder_days: parseInt(e.target.value, 10) || 1 }))
              }
            />
            <p className="text-[11px] text-muted-foreground mt-1">
              Nudge the manager if the call is still unscheduled after this many days.
            </p>
          </div>

          <div className="flex justify-between items-center">
            <Button
              variant="link"
              size="sm"
              onClick={() => setSettings(DEFAULT_MC_SETTINGS)}
              className="text-muted-foreground hover:text-foreground"
            >
              Reset to default
            </Button>
            <Button onClick={save} disabled={saving}>
              {saving && <Loader2 className="h-3.5 w-3.5 animate-spin mr-1.5" />}
              Save
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}

// ── Kickoff (wrapper with nested tab bar) ─────────────────────────────────────

type KickoffTab = "overview" | "welcome-logs" | "welcome-config" | "manager-call";

const KICKOFF_TABS = [
  { id: "overview", label: "Overview", icon: Rocket },
  { id: "welcome-logs", label: "Welcome Logs", icon: Gift },
  { id: "welcome-config", label: "Welcome Resources", icon: Settings2 },
  { id: "manager-call", label: "Manager Call", icon: CalendarClock },
] as const;

export default function OnboardingKickoffAdmin({
  authHeaders,
}: {
  authHeaders: Record<string, string>;
}) {
  const [tab, setTab] = useState<KickoffTab>("overview");

  return (
    <div className="flex-1 overflow-hidden flex flex-col">
      <nav className="flex flex-wrap items-center gap-1.5 px-6 sm:px-8 pt-4 pb-3 shrink-0">
        {KICKOFF_TABS.map((t) => {
          const Icon = t.icon;
          const active = tab === t.id;
          return (
            <button
              key={t.id}
              onClick={() => setTab(t.id)}
              className={cn(
                "flex items-center gap-1.5 rounded-xl px-3 py-1.5 text-[12px] font-semibold transition-all border",
                active
                  ? "bg-violet-600 text-white border-violet-600 shadow-sm shadow-violet-600/30"
                  : "bg-white/60 dark:bg-zinc-900/50 text-muted-foreground hover:text-foreground border-slate-200/70 dark:border-white/[0.06]",
              )}
            >
              <Icon className="h-3.5 w-3.5" />
              {t.label}
            </button>
          );
        })}
      </nav>
      <div className="flex-1 overflow-hidden">
        {tab === "overview" && <OnboardingTab authHeaders={authHeaders} />}
        {tab === "welcome-logs" && <WelcomeLogsTab authHeaders={authHeaders} />}
        {tab === "welcome-config" && <WelcomeConfigTab authHeaders={authHeaders} />}
        {tab === "manager-call" && <ManagerCallSettingsTab authHeaders={authHeaders} />}
      </div>
    </div>
  );
}
