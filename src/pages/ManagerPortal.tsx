import { useAuth } from "@/lib/auth-store";
import { useState, useEffect, useCallback, useMemo, useRef } from "react";
import {
  UserCog,
  Users,
  CalendarClock,
  Mail,
  Download,
  Loader2,
  RefreshCw,
  AlertCircle,
  CheckCircle2,
  Plus,
  Trash2,
  Clock,
  Power,
  Briefcase,
  Wrench,
  Gauge,
  GraduationCap,
  ClipboardList,
  Server,
  ShieldX,
  ChevronDown,
  ChevronUp,
  Search,
  UserPlus,
  Trophy,
  X,
  Upload,
  Building2,
  ZoomIn,
  Star,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { toast } from "sonner";
import { flyBanner } from "@/lib/fly-banner";
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

interface Member {
  employee: string;
  email: string;
  department: string;
  designation: string;
  reports_to: string;
  present: number;
  absent: number;
  wfh: number;
  late: number;
  half_day: number;
}
interface TeamReport {
  success: boolean;
  error?: string;
  message?: string;
  manager?: string;
  period?: string;
  month?: number;
  year?: number;
  headcount?: number;
  members?: Member[];
  totals?: { present: number; absent: number; wfh: number; late: number; half_day: number };
}
interface Schedule {
  id: number;
  frequency: string;
  day_of_week: number | null;
  day_of_month: number | null;
  hour: number;
  minute?: number;
  recipients: string[];
  period_mode: string;
  active: boolean;
  next_run: string | null;
  last_run: string | null;
  last_status: string | null;
}
interface TeamMember {
  id: number;
  name: string;
  email: string;
  department: string;
  designation: string;
}
interface Allocation {
  id: number;
  employee_name: string;
  project_name: string;
  sub_project: string | null;
  client_master: string | null;
  project_lead: string | null;
  completion_status: string;
  efforts_percent: number | null;
  billability_percent: number | null;
  project_status: string;
  billing: string | null;
  project_type: string | null;
  allocation_date: string | null;
  expected_end_date: string | null;
  status: string;
}
interface Skill {
  employee_name: string;
  employee_email: string;
  skill: string;
  certification: string | null;
  is_primary: boolean;
  years_experience: number | null;
  last_used: string | null;
}
interface OnboardingReq {
  id: number;
  ref_id: string;
  employee_name: string;
  employee_email: string | null;
  steps: { drug_test?: boolean; background_check?: boolean; client_onboarding?: boolean };
  client_name: string | null;
  notes: string | null;
  status: string;
  created_at: string | null;
}
interface PMOReq {
  id: number;
  ref_id: string;
  request_type: string;
  request_type_label: string;
  employee_name: string;
  employee_email: string | null;
  details: string | null;
  status: string;
  created_at: string | null;
}

// ── Constants ─────────────────────────────────────────────────────────────────

const MONTHS = [
  "January",
  "February",
  "March",
  "April",
  "May",
  "June",
  "July",
  "August",
  "September",
  "October",
  "November",
  "December",
];
const DOW = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"];

function fmtDateTime(iso: string | null) {
  if (!iso) return "—";
  return new Date(iso).toLocaleString("en-IN", {
    day: "numeric",
    month: "short",
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
  });
}
function fmtDate(iso: string | null) {
  if (!iso) return "—";
  return new Date(iso).toLocaleDateString("en-IN", {
    day: "numeric",
    month: "short",
    year: "numeric",
  });
}
function describeCadence(s: Schedule): string {
  const m = ((s.minute ?? 0) as number).toString().padStart(2, "0");
  const at = `${s.hour % 12 || 12}:${m} ${s.hour >= 12 ? "PM" : "AM"}`;
  if (s.frequency === "daily") return `Every weekday at ${at}`;
  if (s.frequency === "weekly") return `Every ${DOW[s.day_of_week ?? 0]} at ${at}`;
  if (s.frequency === "monthly") return `Monthly on day ${s.day_of_month ?? 1} at ${at}`;
  return `Custom at ${at}`;
}

type TabId =
  | "attendance"
  | "allocations"
  | "readiness"
  | "skills"
  | "onboarding"
  | "pmo-requests"
  | "appreciations";

const TABS: { id: TabId; label: string; icon: typeof Users }[] = [
  { id: "attendance", label: "Attendance", icon: CalendarClock },
  { id: "allocations", label: "Allocations", icon: Briefcase },
  { id: "readiness", label: "Readiness", icon: Gauge },
  { id: "skills", label: "Skills", icon: Wrench },
  { id: "onboarding", label: "Onboarding", icon: ClipboardList },
  { id: "pmo-requests", label: "PMO Requests", icon: Server },
  { id: "appreciations", label: "Appreciations", icon: Trophy },
];

const STATUS_COLORS: Record<string, string> = {
  Pending: "bg-amber-500/10 text-amber-600",
  "In Progress": "bg-blue-500/10 text-blue-600",
  Completed: "bg-emerald-500/10 text-emerald-600",
  Rejected: "bg-red-500/10 text-red-600",
};

// ── Root component ────────────────────────────────────────────────────────────

export function ManagerPortal() {
  const { user } = useAuth();
  const auth = useMemo(
    () => ({ "x-user-email": user?.email ?? "", "x-user-role": (user?.role ?? "").toLowerCase() }),
    [user?.email, user?.role],
  );

  const [activeTab, setActiveTab] = useState<TabId>("attendance");
  const [team, setTeam] = useState<TeamMember[]>([]);

  useEffect(() => {
    fetch("/api/portal/manager/team", { headers: auth })
      .then((r) => r.json())
      .then((d) => (Array.isArray(d) ? setTeam(d) : null))
      .catch(() => {});
  }, [auth]);

  return (
    <div className="h-full overflow-y-auto w-full px-4 py-6">
      {/* Header */}
      <div className="mb-5 flex items-center gap-3">
        <div className="flex h-11 w-11 items-center justify-center rounded-2xl bg-[var(--collaboration)]/15">
          <UserCog className="h-5 w-5 text-[var(--collaboration)]" />
        </div>
        <div>
          <h1 className="text-xl font-bold text-foreground">My Team</h1>
          <p className="text-sm text-muted-foreground">Manage your whole reporting hierarchy.</p>
        </div>
      </div>

      {/* Tab bar */}
      <div className="mb-5 flex gap-1 overflow-x-auto no-scrollbar rounded-2xl border border-border bg-muted/30 p-1">
        {TABS.map((t) => {
          const Icon = t.icon;
          return (
            <button
              key={t.id}
              onClick={() => setActiveTab(t.id)}
              className={cn(
                "flex shrink-0 items-center gap-1.5 rounded-xl px-3 py-2 text-sm font-medium transition-colors",
                activeTab === t.id
                  ? "bg-background text-foreground shadow-sm"
                  : "text-muted-foreground hover:text-foreground",
              )}
            >
              <Icon className="h-3.5 w-3.5" />
              {t.label}
            </button>
          );
        })}
      </div>

      {/* Tab content */}
      {activeTab === "attendance" && <AttendanceTab auth={auth} />}
      {activeTab === "allocations" && <AllocationsTab auth={auth} />}
      {activeTab === "readiness" && <ReadinessTab auth={auth} />}
      {activeTab === "skills" && <SkillsTab auth={auth} />}
      {activeTab === "onboarding" && <OnboardingTab auth={auth} team={team} />}
      {activeTab === "pmo-requests" && <PMORequestsTab auth={auth} team={team} />}
      {activeTab === "appreciations" && <AppreciationsTab auth={auth} team={team} />}
    </div>
  );
}

// ── Attendance tab ────────────────────────────────────────────────────────────

function AttendanceTab({ auth }: { auth: Record<string, string> }) {
  const now = new Date();
  const [month, setMonth] = useState(now.getMonth() + 1);
  const [year, setYear] = useState(now.getFullYear());
  const [report, setReport] = useState<TeamReport | null>(null);
  const [loading, setLoading] = useState(true);
  const [emailing, setEmailing] = useState(false);

  const loadReport = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch(`/api/portal/manager/attendance?month=${month}&year=${year}`, {
        headers: auth,
      });
      const data = await res.json().catch(() => ({}));
      if (res.status === 403) {
        setReport({ success: false, message: "This area is for Functional Managers only." });
        return;
      }
      setReport(data);
    } catch {
      setReport({ success: false, message: "Could not reach the server." });
    } finally {
      setLoading(false);
    }
  }, [auth, month, year]);

  useEffect(() => {
    loadReport();
  }, [loadReport]);

  const emailNow = async () => {
    setEmailing(true);
    try {
      const res = await fetch("/api/portal/manager/attendance/email", {
        method: "POST",
        headers: { ...auth, "Content-Type": "application/json" },
        body: JSON.stringify({ month: String(month), year: String(year) }),
      });
      const data = await res.json().catch(() => ({}));
      if (data.success && data.sent) {
        flyBanner("Attendance report emailed");
        toast.success(`Report for ${data.period} sent to ${data.recipients?.join(", ")}`);
      } else if (data.error === "no_team") {
        toast.error("No team under you to report on.");
      } else {
        toast.error("Could not send — is your Microsoft account connected?");
      }
    } catch {
      toast.error("Could not reach the server.");
    } finally {
      setEmailing(false);
    }
  };

  const downloadCsv = () => {
    if (!report?.success || !report.members) return;
    const head = [
      "Employee",
      "Email",
      "Department",
      "Designation",
      "Reports To",
      "Present",
      "Absent",
      "WFH",
      "Late",
      "Half-day",
    ];
    const rows = report.members.map((m) =>
      [
        m.employee,
        m.email,
        m.department,
        m.designation,
        m.reports_to,
        m.present,
        m.absent,
        m.wfh,
        m.late,
        m.half_day,
      ]
        .map((v) => `"${String(v ?? "").replace(/"/g, '""')}"`)
        .join(","),
    );
    const t = report.totals!;
    rows.push(
      ["TOTAL", "", "", "", "", t.present, t.absent, t.wfh, t.late, t.half_day]
        .map((v) => `"${v}"`)
        .join(","),
    );
    const csv = [head.join(","), ...rows].join("\n");
    const blob = new Blob([csv], { type: "text/csv" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `Team_Attendance_${report.period?.replace(" ", "_")}.csv`;
    a.click();
    URL.revokeObjectURL(a.href);
  };

  const totals = report?.totals;

  return (
    <div>
      {/* Email automations at top */}
      <SchedulesSection auth={auth} />

      {/* Controls */}
      <div className="mb-5 mt-6 flex flex-wrap items-center gap-2">
        <select
          value={month}
          onChange={(e) => setMonth(Number(e.target.value))}
          className="rounded-xl border border-border bg-background px-3 py-2 text-sm flex-1 sm:flex-none"
        >
          {MONTHS.map((m, i) => (
            <option key={m} value={i + 1}>
              {m}
            </option>
          ))}
        </select>
        <select
          value={year}
          onChange={(e) => setYear(Number(e.target.value))}
          className="rounded-xl border border-border bg-background px-3 py-2 text-sm flex-1 sm:flex-none"
        >
          {[year - 1, year, year + 1]
            .filter((v, i, a) => a.indexOf(v) === i)
            .map((y) => (
              <option key={y} value={y}>
                {y}
              </option>
            ))}
        </select>
        <button
          onClick={loadReport}
          className="flex items-center justify-center gap-1.5 rounded-xl border border-border bg-background px-3 py-2 text-sm font-medium hover:bg-muted flex-1 sm:flex-none"
        >
          <RefreshCw className="h-3.5 w-3.5" /> Refresh
        </button>
        <div className="hidden sm:block flex-1" />
        <div className="flex w-full sm:w-auto items-center gap-2 mt-1 sm:mt-0">
          <button
            onClick={downloadCsv}
            disabled={!report?.success}
            className="flex-1 sm:flex-initial flex items-center justify-center gap-1.5 rounded-xl border border-border bg-background px-3 py-2 text-sm font-medium hover:bg-muted disabled:opacity-50"
          >
            <Download className="h-3.5 w-3.5" /> CSV
          </button>
          <button
            onClick={emailNow}
            disabled={!report?.success || emailing}
            className="flex-1 sm:flex-initial flex items-center justify-center gap-1.5 rounded-xl bg-[var(--collaboration)] px-3 py-2 text-sm font-semibold text-white hover:opacity-90 disabled:opacity-50 whitespace-nowrap"
          >
            {emailing ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
            ) : (
              <Mail className="h-3.5 w-3.5" />
            )}
            Email me the report
          </button>
        </div>
      </div>

      {loading ? (
        <div className="flex items-center gap-2.5 py-8 text-sm text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin text-primary" /> Loading attendance…
        </div>
      ) : !report?.success ? (
        <div className="flex items-start gap-2 rounded-xl border border-amber-500/20 bg-amber-500/5 px-4 py-3 text-sm text-amber-600 dark:text-amber-400">
          <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
          {report?.message || "No employees report up to you."}
        </div>
      ) : (
        <>
          <div className="mb-5 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
            {[
              { label: "Team Size", value: report.headcount },
              { label: "Present", value: totals!.present },
              { label: "Absent", value: totals!.absent },
              { label: "WFH", value: totals!.wfh },
              { label: "Late", value: totals!.late },
              { label: "Half-day", value: totals!.half_day },
            ].map((c) => (
              <div key={c.label} className="rounded-2xl border border-border bg-card/50 px-4 py-3">
                <p className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
                  {c.label}
                </p>
                <p className="mt-1 text-2xl font-bold text-foreground">{c.value}</p>
              </div>
            ))}
          </div>
          <div className="overflow-x-auto rounded-2xl border border-border">
            <table className="w-full text-sm">
              <thead>
                <tr className="bg-muted/50 text-left text-[11px] uppercase tracking-wide text-muted-foreground">
                  <th className="px-3 py-2.5 font-semibold">Employee</th>
                  <th className="px-3 py-2.5 font-semibold">Department</th>
                  <th className="px-3 py-2.5 font-semibold">Reports To</th>
                  <th className="px-3 py-2.5 text-center font-semibold">Present</th>
                  <th className="px-3 py-2.5 text-center font-semibold">Absent</th>
                  <th className="px-3 py-2.5 text-center font-semibold">WFH</th>
                  <th className="px-3 py-2.5 text-center font-semibold">Late</th>
                  <th className="px-3 py-2.5 text-center font-semibold">Half-day</th>
                </tr>
              </thead>
              <tbody>
                {report.members!.map((m, i) => (
                  <tr
                    key={m.email || i}
                    className={cn("border-t border-border", i % 2 ? "bg-muted/20" : "")}
                  >
                    <td className="px-3 py-2.5">
                      <div className="font-medium text-foreground">{m.employee}</div>
                      <div className="text-[11px] text-muted-foreground">{m.designation}</div>
                    </td>
                    <td className="px-3 py-2.5 text-muted-foreground">{m.department}</td>
                    <td className="px-3 py-2.5 text-muted-foreground">{m.reports_to}</td>
                    <td className="px-3 py-2.5 text-center">{m.present}</td>
                    <td className="px-3 py-2.5 text-center">{m.absent}</td>
                    <td className="px-3 py-2.5 text-center">{m.wfh}</td>
                    <td className="px-3 py-2.5 text-center">{m.late}</td>
                    <td className="px-3 py-2.5 text-center">{m.half_day}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
    </div>
  );
}

// ── Schedules section (used inside Attendance tab) ────────────────────────────

function SchedulesSection({ auth }: { auth: Record<string, string> }) {
  const [schedules, setSchedules] = useState<Schedule[]>([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/portal/manager/attendance/schedules", { headers: auth });
      const data = await res.json().catch(() => []);
      setSchedules(Array.isArray(data) ? data : []);
    } catch {
      /* ignore */
    } finally {
      setLoading(false);
    }
  }, [auth]);

  useEffect(() => {
    load();
  }, [load]);

  const toggle = async (s: Schedule) => {
    await fetch(`/api/portal/manager/attendance/schedules/${s.id}`, {
      method: "PATCH",
      headers: { ...auth, "Content-Type": "application/json" },
      body: JSON.stringify({ active: !s.active }),
    });
    load();
  };

  const remove = async (s: Schedule) => {
    await fetch(`/api/portal/manager/attendance/schedules/${s.id}`, {
      method: "DELETE",
      headers: auth,
    });
    flyBanner("Automation removed");
    load();
  };

  return (
    <div className="mb-6">
      <div className="mb-3 flex flex-row items-center justify-between gap-2 flex-wrap sm:flex-nowrap">
        <div className="flex items-center gap-2">
          <CalendarClock className="h-4 w-4 text-[var(--collaboration)]" />
          <h2 className="text-sm font-bold uppercase tracking-widest text-muted-foreground">
            Email Automations
          </h2>
        </div>
        <button
          onClick={() => setShowForm((v) => !v)}
          className="flex items-center gap-1.5 rounded-xl border border-border bg-background px-3 py-1.5 text-xs font-semibold hover:bg-muted shrink-0"
        >
          <Plus className="h-3.5 w-3.5" /> New automation
        </button>
      </div>
      {showForm && (
        <ScheduleForm
          auth={auth}
          onCreated={() => {
            setShowForm(false);
            load();
          }}
        />
      )}
      {loading ? (
        <div className="flex items-center gap-2 py-4 text-sm text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin text-primary" /> Loading automations…
        </div>
      ) : schedules.length === 0 ? (
        <p className="py-3 text-sm text-muted-foreground">
          No automations yet. Add one to get your team's attendance emailed on a schedule.
        </p>
      ) : (
        <div className="space-y-2">
          {schedules.map((s) => (
            <div
              key={s.id}
              className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 rounded-2xl border border-border bg-card/50 px-4 py-3"
            >
              <div className="min-w-0">
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="font-semibold text-foreground">{describeCadence(s)}</span>
                  {!s.active && (
                    <span className="rounded-full bg-muted px-2 py-0.5 text-[10px] font-semibold uppercase text-muted-foreground shrink-0">
                      Paused
                    </span>
                  )}
                  {s.period_mode === "prev_period" && (
                    <span className="rounded-full bg-[var(--collaboration)]/10 px-2 py-0.5 text-[10px] font-semibold text-[var(--collaboration)] shrink-0">
                      Prev. period
                    </span>
                  )}
                </div>
                <div className="mt-1 flex flex-wrap items-center gap-x-3 text-[11px] text-muted-foreground">
                  <span className="flex items-center gap-1">
                    <Clock className="h-3 w-3" /> Next: {fmtDateTime(s.next_run)}
                  </span>
                  <span>To: {s.recipients.length ? s.recipients.join(", ") : "you"}</span>
                  {s.last_status && (
                    <span>
                      Last: {s.last_status} ({fmtDateTime(s.last_run)})
                    </span>
                  )}
                </div>
              </div>
              <div className="flex shrink-0 items-center gap-1.5 justify-end sm:justify-start">
                <button
                  onClick={() => toggle(s)}
                  title={s.active ? "Pause" : "Resume"}
                  className={cn(
                    "flex items-center gap-1 rounded-xl border px-2.5 py-1.5 text-xs font-semibold",
                    s.active
                      ? "border-border hover:bg-muted"
                      : "border-emerald-500/30 bg-emerald-500/5 text-emerald-600",
                  )}
                >
                  <Power className="h-3.5 w-3.5" /> {s.active ? "Pause" : "Resume"}
                </button>
                <button
                  onClick={() => remove(s)}
                  className="flex items-center gap-1 rounded-xl border border-destructive/30 bg-destructive/5 px-2.5 py-1.5 text-xs font-semibold text-destructive hover:bg-destructive/10"
                >
                  <Trash2 className="h-3.5 w-3.5" />
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function ScheduleForm({
  auth,
  onCreated,
}: {
  auth: Record<string, string>;
  onCreated: () => void;
}) {
  const [frequency, setFrequency] = useState("monthly");
  const [dayOfWeek, setDayOfWeek] = useState(0);
  const [dayOfMonth, setDayOfMonth] = useState(1);
  const [hour, setHour] = useState(8);
  const [minute, setMinute] = useState(0);
  const [periodMode, setPeriodMode] = useState("prev_period");
  const [saving, setSaving] = useState(false);

  // Recipient picker state
  const [recipients, setRecipients] = useState<{ name: string; email: string }[]>([]);
  const [recipientSearch, setRecipientSearch] = useState("");
  const [recipientResults, setRecipientResults] = useState<{ name: string; email: string }[]>([]);
  const [showRecipientDrop, setShowRecipientDrop] = useState(false);
  const searchTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  function handleRecipientSearch(q: string) {
    setRecipientSearch(q);
    setShowRecipientDrop(q.length >= 2);
    if (searchTimer.current) clearTimeout(searchTimer.current);
    if (q.length < 2) {
      setRecipientResults([]);
      return;
    }
    searchTimer.current = setTimeout(async () => {
      try {
        const res = await fetch(`/api/portal/manager/users/search?q=${encodeURIComponent(q)}`, {
          headers: auth,
        });
        const data = await res.json();
        setRecipientResults(Array.isArray(data) ? data : []);
      } catch {
        setRecipientResults([]);
      }
    }, 250);
  }

  function addRecipient(u: { name: string; email: string }) {
    if (!recipients.some((r) => r.email === u.email)) {
      setRecipients((prev) => [...prev, u]);
    }
    setRecipientSearch("");
    setRecipientResults([]);
    setShowRecipientDrop(false);
  }

  function removeRecipient(email: string) {
    setRecipients((prev) => prev.filter((r) => r.email !== email));
  }

  const submit = async () => {
    setSaving(true);
    const body: Record<string, unknown> = { frequency, hour, minute, period_mode: periodMode };
    if (frequency === "weekly" || frequency === "custom") body.day_of_week = dayOfWeek;
    if (frequency === "monthly" || frequency === "custom") body.day_of_month = dayOfMonth;
    if (recipients.length) body.recipients = recipients.map((r) => r.email);
    try {
      const res = await fetch("/api/portal/manager/attendance/schedules", {
        method: "POST",
        headers: { ...auth, "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      if (res.ok) {
        flyBanner("Automation scheduled");
        onCreated();
      } else toast.error("Could not create the automation.");
    } catch {
      toast.error("Could not reach the server.");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="mb-3 grid gap-3 rounded-2xl border border-border bg-card/50 p-4 sm:grid-cols-2">
      <label className="text-xs font-medium text-muted-foreground">
        Frequency
        <select
          value={frequency}
          onChange={(e) => setFrequency(e.target.value)}
          className="mt-1 w-full rounded-xl border border-border bg-background px-3 py-2 text-sm text-foreground"
        >
          <option value="daily">Daily (weekdays)</option>
          <option value="weekly">Weekly</option>
          <option value="monthly">Monthly</option>
          <option value="custom">Custom</option>
        </select>
      </label>
      <div className="text-xs font-medium text-muted-foreground">
        Send time
        <div className="mt-1 flex gap-1.5">
          <select
            value={hour}
            onChange={(e) => setHour(Number(e.target.value))}
            className="flex-1 rounded-xl border border-border bg-background px-2 py-2 text-sm text-foreground"
          >
            {Array.from({ length: 24 }, (_, h) => (
              <option key={h} value={h}>
                {h % 12 || 12} {h >= 12 ? "PM" : "AM"}
              </option>
            ))}
          </select>
          <select
            value={minute}
            onChange={(e) => setMinute(Number(e.target.value))}
            className="w-20 rounded-xl border border-border bg-background px-2 py-2 text-sm text-foreground"
          >
            {[0, 5, 10, 15, 20, 25, 30, 35, 40, 45, 50, 55].map((m) => (
              <option key={m} value={m}>
                {m.toString().padStart(2, "0")}
              </option>
            ))}
          </select>
        </div>
      </div>
      {(frequency === "weekly" || frequency === "custom") && (
        <label className="text-xs font-medium text-muted-foreground">
          Day of week
          <select
            value={dayOfWeek}
            onChange={(e) => setDayOfWeek(Number(e.target.value))}
            className="mt-1 w-full rounded-xl border border-border bg-background px-3 py-2 text-sm text-foreground"
          >
            {DOW.map((d, i) => (
              <option key={d} value={i}>
                {d}
              </option>
            ))}
          </select>
        </label>
      )}
      {(frequency === "monthly" || frequency === "custom") && (
        <label className="text-xs font-medium text-muted-foreground">
          Day of month (1–28)
          <input
            type="number"
            min={1}
            max={28}
            value={dayOfMonth}
            onChange={(e) => setDayOfMonth(Math.min(28, Math.max(1, Number(e.target.value))))}
            className="mt-1 w-full rounded-xl border border-border bg-background px-3 py-2 text-sm text-foreground"
          />
        </label>
      )}
      <label className="text-xs font-medium text-muted-foreground">
        Report period
        <select
          value={periodMode}
          onChange={(e) => setPeriodMode(e.target.value)}
          className="mt-1 w-full rounded-xl border border-border bg-background px-3 py-2 text-sm text-foreground"
        >
          <option value="prev_period">Previous month</option>
          <option value="current">Current month-to-date</option>
        </select>
      </label>

      {/* Recipient picker */}
      <div className="sm:col-span-2 text-xs font-medium text-muted-foreground">
        Recipients
        <div className="mt-1 relative">
          <div className="relative">
            <Search className="absolute left-2 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground pointer-events-none" />
            <input
              value={recipientSearch}
              onChange={(e) => handleRecipientSearch(e.target.value)}
              onFocus={() => recipientSearch.length >= 2 && setShowRecipientDrop(true)}
              onBlur={() => setTimeout(() => setShowRecipientDrop(false), 150)}
              placeholder="Search people by name or email… (blank = send to yourself)"
              className="w-full pl-7 pr-3 rounded-xl border border-border bg-background py-2 text-sm text-foreground"
            />
          </div>
          {showRecipientDrop && recipientResults.length > 0 && (
            <div className="absolute left-0 top-full mt-1 z-20 bg-background border border-border rounded-xl shadow-lg w-full max-h-44 overflow-y-auto">
              {recipientResults.map((u) => (
                <button
                  key={u.email}
                  type="button"
                  onMouseDown={() => addRecipient(u)}
                  className="w-full flex items-center gap-2 px-3 py-2 text-sm hover:bg-muted/50 text-left"
                >
                  <UserPlus className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                  <div className="min-w-0">
                    <div className="font-medium truncate">{u.name}</div>
                    <div className="text-[11px] text-muted-foreground truncate">{u.email}</div>
                  </div>
                </button>
              ))}
            </div>
          )}
        </div>
        {recipients.length > 0 && (
          <div className="mt-2 flex flex-wrap gap-1.5">
            {recipients.map((r) => (
              <span
                key={r.email}
                className="flex items-center gap-1 rounded-full border border-border bg-muted/50 px-2 py-0.5 text-[11px]"
              >
                {r.name}
                <button
                  type="button"
                  onClick={() => removeRecipient(r.email)}
                  className="text-muted-foreground hover:text-destructive"
                >
                  ×
                </button>
              </span>
            ))}
          </div>
        )}
      </div>

      <div className="sm:col-span-2">
        <button
          onClick={submit}
          disabled={saving}
          className="flex items-center gap-1.5 rounded-xl bg-[var(--collaboration)] px-4 py-2 text-sm font-semibold text-white hover:opacity-90 disabled:opacity-50"
        >
          {saving ? (
            <Loader2 className="h-3.5 w-3.5 animate-spin" />
          ) : (
            <CheckCircle2 className="h-3.5 w-3.5" />
          )}
          Save automation
        </button>
      </div>
    </div>
  );
}

// ── Allocations tab ───────────────────────────────────────────────────────────

function AllocationsTab({ auth }: { auth: Record<string, string> }) {
  const [allocations, setAllocations] = useState<Allocation[]>([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState("");
  const [showActive, setShowActive] = useState(true);

  useEffect(() => {
    fetch("/api/portal/manager/team/allocations", { headers: auth })
      .then((r) => r.json())
      .then((d) => (Array.isArray(d) ? setAllocations(d) : setAllocations([])))
      .catch(() => setAllocations([]))
      .finally(() => setLoading(false));
  }, [auth]);

  const filtered = useMemo(() => {
    let rows = allocations;
    if (showActive) rows = rows.filter((a) => a.completion_status === "Active");
    if (filter.trim()) {
      const q = filter.toLowerCase();
      rows = rows.filter(
        (a) =>
          a.employee_name.toLowerCase().includes(q) ||
          a.project_name.toLowerCase().includes(q) ||
          (a.client_master || "").toLowerCase().includes(q),
      );
    }
    return rows;
  }, [allocations, filter, showActive]);

  // Group by employee
  const grouped = useMemo(() => {
    const map = new Map<string, Allocation[]>();
    for (const a of filtered) {
      if (!map.has(a.employee_name)) map.set(a.employee_name, []);
      map.get(a.employee_name)!.push(a);
    }
    return map;
  }, [filtered]);

  if (loading) return <LoadingState label="Loading allocations…" />;

  return (
    <div>
      <div className="mb-4 flex flex-wrap items-center gap-2">
        <input
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
          placeholder="Filter by employee, project or client…"
          className="flex-1 min-w-[200px] rounded-xl border border-border bg-background px-3 py-2 text-sm"
        />
        <label className="flex items-center gap-1.5 text-sm text-muted-foreground cursor-pointer select-none">
          <input
            type="checkbox"
            checked={showActive}
            onChange={(e) => setShowActive(e.target.checked)}
            className="rounded"
          />
          Active only
        </label>
      </div>
      {grouped.size === 0 ? (
        <EmptyState label="No allocations found." />
      ) : (
        <div className="space-y-4">
          {[...grouped.entries()].map(([name, rows]) => (
            <ExpandableGroup key={name} title={name} count={rows.length}>
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="bg-muted/40 text-left text-[11px] uppercase tracking-wide text-muted-foreground">
                      <th className="px-3 py-2 font-semibold">Project</th>
                      <th className="px-3 py-2 font-semibold">Client</th>
                      <th className="px-3 py-2 font-semibold">Status</th>
                      <th className="px-3 py-2 text-center font-semibold">Effort %</th>
                      <th className="px-3 py-2 text-center font-semibold">Billable %</th>
                      <th className="px-3 py-2 font-semibold">End Date</th>
                    </tr>
                  </thead>
                  <tbody>
                    {rows.map((a) => (
                      <tr key={a.id} className="border-t border-border">
                        <td className="px-3 py-2">
                          <div className="font-medium text-foreground">{a.project_name}</div>
                          {a.sub_project && (
                            <div className="text-[11px] text-muted-foreground">{a.sub_project}</div>
                          )}
                        </td>
                        <td className="px-3 py-2 text-muted-foreground">
                          {a.client_master || "—"}
                        </td>
                        <td className="px-3 py-2">
                          <span
                            className={cn(
                              "rounded-full px-2 py-0.5 text-[11px] font-semibold",
                              a.completion_status === "Active"
                                ? "bg-emerald-500/10 text-emerald-600"
                                : "bg-muted text-muted-foreground",
                            )}
                          >
                            {a.completion_status}
                          </span>
                        </td>
                        <td className="px-3 py-2 text-center">
                          {a.efforts_percent != null ? `${a.efforts_percent}%` : "—"}
                        </td>
                        <td className="px-3 py-2 text-center">
                          {a.billability_percent != null ? `${a.billability_percent}%` : "—"}
                        </td>
                        <td className="px-3 py-2 text-muted-foreground text-sm">
                          {fmtDate(a.expected_end_date)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </ExpandableGroup>
          ))}
        </div>
      )}
    </div>
  );
}

// ── Skills tab ────────────────────────────────────────────────────────────────

function SkillsTab({ auth }: { auth: Record<string, string> }) {
  const [skills, setSkills] = useState<Skill[]>([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState("");

  useEffect(() => {
    fetch("/api/portal/manager/team/skills", { headers: auth })
      .then((r) => r.json())
      .then((d) => (Array.isArray(d) ? setSkills(d) : setSkills([])))
      .catch(() => setSkills([]))
      .finally(() => setLoading(false));
  }, [auth]);

  const filtered = useMemo(() => {
    if (!filter.trim()) return skills;
    const q = filter.toLowerCase();
    return skills.filter(
      (s) =>
        s.employee_name.toLowerCase().includes(q) ||
        s.skill.toLowerCase().includes(q) ||
        (s.certification || "").toLowerCase().includes(q),
    );
  }, [skills, filter]);

  const grouped = useMemo(() => {
    const map = new Map<string, Skill[]>();
    for (const s of filtered) {
      if (!map.has(s.employee_name)) map.set(s.employee_name, []);
      map.get(s.employee_name)!.push(s);
    }
    return map;
  }, [filtered]);

  if (loading) return <LoadingState label="Loading skills…" />;

  return (
    <div>
      <div className="mb-4">
        <input
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
          placeholder="Filter by name, skill or certification…"
          className="w-full max-w-sm rounded-xl border border-border bg-background px-3 py-2 text-sm"
        />
      </div>
      {grouped.size === 0 ? (
        <EmptyState label="No skills on record for your team." />
      ) : (
        <div className="space-y-4">
          {[...grouped.entries()].map(([name, rows]) => (
            <ExpandableGroup key={name} title={name} count={rows.length} unit="skill">
              <div className="flex flex-wrap gap-2 px-3 pb-3">
                {rows.map((s, i) => (
                  <div
                    key={i}
                    className={cn(
                      "flex items-center gap-1.5 rounded-xl border px-3 py-1.5 text-sm",
                      s.is_primary
                        ? "border-[var(--collaboration)]/30 bg-[var(--collaboration)]/5 text-[var(--collaboration)]"
                        : "border-border bg-card/50 text-foreground",
                    )}
                  >
                    <span className="font-medium">{s.skill}</span>
                    {s.is_primary && (
                      <span className="text-[10px] font-semibold uppercase opacity-70">
                        Primary
                      </span>
                    )}
                    {s.years_experience != null && (
                      <span className="text-[11px] text-muted-foreground">
                        {s.years_experience}y
                      </span>
                    )}
                    {s.certification && (
                      <span className="text-[11px] text-muted-foreground">· {s.certification}</span>
                    )}
                  </div>
                ))}
              </div>
            </ExpandableGroup>
          ))}
        </div>
      )}
    </div>
  );
}

// ── Onboarding tab ────────────────────────────────────────────────────────────

function OnboardingTab({ auth, team }: { auth: Record<string, string>; team: TeamMember[] }) {
  const [requests, setRequests] = useState<OnboardingReq[]>([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const d = await fetch("/api/portal/manager/onboarding", { headers: auth }).then((r) =>
        r.json(),
      );
      setRequests(Array.isArray(d) ? d : []);
    } catch {
      /* ignore */
    } finally {
      setLoading(false);
    }
  }, [auth]);

  useEffect(() => {
    load();
  }, [load]);

  const updateStatus = async (id: number, status: string) => {
    await fetch(`/api/portal/manager/onboarding/${id}`, {
      method: "PATCH",
      headers: { ...auth, "Content-Type": "application/json" },
      body: JSON.stringify({ status }),
    });
    load();
  };

  const stepLabel = (k: string) =>
    ({
      drug_test: "Drug Test",
      background_check: "Background Verification",
      client_onboarding: "Client Onboarding",
    })[k] ?? k;

  return (
    <div>
      <div className="mb-4 flex items-center justify-between">
        <p className="text-sm text-muted-foreground">
          Initiate client-side onboarding for team members. Email notification is sent to PMO.
        </p>
        <button
          onClick={() => setShowForm((v) => !v)}
          className="flex items-center gap-1.5 rounded-xl bg-[var(--collaboration)] px-3 py-2 text-sm font-semibold text-white hover:opacity-90"
        >
          <Plus className="h-3.5 w-3.5" /> New Request
        </button>
      </div>

      {showForm && (
        <OnboardingForm
          auth={auth}
          team={team}
          onCreated={() => {
            setShowForm(false);
            load();
          }}
        />
      )}

      {loading ? (
        <LoadingState label="Loading onboarding requests…" />
      ) : requests.length === 0 ? (
        <EmptyState label="No onboarding requests yet." />
      ) : (
        <div className="space-y-3">
          {requests.map((r) => {
            const activeSteps = Object.entries(r.steps)
              .filter(([, v]) => v)
              .map(([k]) => stepLabel(k));
            return (
              <div key={r.id} className="rounded-2xl border border-border bg-card/50 px-4 py-3">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <div className="flex items-center gap-2">
                      <span className="font-semibold text-foreground">{r.employee_name}</span>
                      <span className="text-[11px] text-muted-foreground">{r.ref_id}</span>
                      <span
                        className={cn(
                          "rounded-full px-2 py-0.5 text-[10px] font-semibold",
                          STATUS_COLORS[r.status] ?? "bg-muted text-muted-foreground",
                        )}
                      >
                        {r.status}
                      </span>
                    </div>
                    {r.employee_email && (
                      <div className="text-[11px] text-muted-foreground mt-0.5">
                        {r.employee_email}
                      </div>
                    )}
                    <div className="mt-1.5 flex flex-wrap gap-1.5">
                      {activeSteps.map((s) => (
                        <span
                          key={s}
                          className="rounded-full border border-border bg-muted/50 px-2 py-0.5 text-[11px] text-muted-foreground"
                        >
                          {s}
                        </span>
                      ))}
                      {r.client_name && (
                        <span className="rounded-full border border-[var(--collaboration)]/30 bg-[var(--collaboration)]/5 px-2 py-0.5 text-[11px] text-[var(--collaboration)]">
                          Client: {r.client_name}
                        </span>
                      )}
                    </div>
                    {r.notes && (
                      <p className="mt-1.5 text-[11px] text-muted-foreground">{r.notes}</p>
                    )}
                    <p className="mt-1 text-[11px] text-muted-foreground">
                      {fmtDate(r.created_at)}
                    </p>
                  </div>
                  <div className="shrink-0">
                    <select
                      value={r.status}
                      onChange={(e) => updateStatus(r.id, e.target.value)}
                      className="rounded-xl border border-border bg-background px-2 py-1 text-xs"
                    >
                      <option>Pending</option>
                      <option>In Progress</option>
                      <option>Completed</option>
                    </select>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

function OnboardingForm({
  auth,
  team,
  onCreated,
}: {
  auth: Record<string, string>;
  team: TeamMember[];
  onCreated: () => void;
}) {
  const [employeeName, setEmployeeName] = useState("");
  const [employeeEmail, setEmployeeEmail] = useState("");
  const [emailAutoFilled, setEmailAutoFilled] = useState(false);
  const [drugTest, setDrugTest] = useState(false);
  const [bgCheck, setBgCheck] = useState(false);
  const [clientOnboarding, setClientOnboarding] = useState(false);
  const [clientName, setClientName] = useState("");
  const [notes, setNotes] = useState("");
  const [saving, setSaving] = useState(false);

  const handleTeamSelect = (name: string) => {
    setEmployeeName(name);
    const m = team.find((t) => t.name === name);
    if (m) {
      setEmployeeEmail(m.email);
      setEmailAutoFilled(true);
    } else {
      setEmployeeEmail("");
      setEmailAutoFilled(false);
    }
  };

  const submit = async () => {
    if (!employeeName.trim()) {
      toast.error("Employee name is required.");
      return;
    }
    if (!drugTest && !bgCheck && !clientOnboarding) {
      toast.error("Select at least one onboarding step.");
      return;
    }
    setSaving(true);
    try {
      const res = await fetch("/api/portal/manager/onboarding", {
        method: "POST",
        headers: { ...auth, "Content-Type": "application/json" },
        body: JSON.stringify({
          employee_name: employeeName,
          employee_email: employeeEmail,
          drug_test: drugTest,
          background_check: bgCheck,
          client_onboarding: clientOnboarding,
          client_name: clientName,
          notes,
        }),
      });
      if (res.ok) {
        flyBanner("Onboarding request submitted");
        onCreated();
      } else {
        const d = await res.json();
        toast.error(d.detail || "Could not submit.");
      }
    } catch {
      toast.error("Could not reach the server.");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="mb-4 rounded-2xl border border-border bg-card/50 p-4 space-y-4">
      <div className="grid gap-3 sm:grid-cols-2">
        <label className="text-xs font-medium text-muted-foreground">
          Team member
          <select
            value={employeeName}
            onChange={(e) => handleTeamSelect(e.target.value)}
            className="mt-1 w-full rounded-xl border border-border bg-background px-3 py-2 text-sm text-foreground"
          >
            <option value="">— Select or type below —</option>
            {team.map((m) => (
              <option key={m.id} value={m.name}>
                {m.name}
              </option>
            ))}
          </select>
        </label>
        <label className="text-xs font-medium text-muted-foreground">
          <span className="flex items-center gap-1.5">
            Employee email
            {emailAutoFilled && (
              <span className="text-[10px] font-semibold text-[var(--collaboration)]">
                auto-filled
              </span>
            )}
          </span>
          <input
            value={employeeEmail}
            onChange={(e) => {
              setEmployeeEmail(e.target.value);
              setEmailAutoFilled(false);
            }}
            placeholder="employee@company.com"
            className={cn(
              "mt-1 w-full rounded-xl border px-3 py-2 text-sm text-foreground",
              emailAutoFilled
                ? "border-[var(--collaboration)]/40 bg-[var(--collaboration)]/5"
                : "border-border bg-background",
            )}
          />
        </label>
        {!team.length && (
          <label className="text-xs font-medium text-muted-foreground sm:col-span-2">
            Employee name (manual entry)
            <input
              value={employeeName}
              onChange={(e) => setEmployeeName(e.target.value)}
              placeholder="Full name"
              className="mt-1 w-full rounded-xl border border-border bg-background px-3 py-2 text-sm text-foreground"
            />
          </label>
        )}
      </div>

      <div>
        <p className="mb-2 text-xs font-medium text-muted-foreground">Onboarding steps required</p>
        <div className="flex flex-wrap gap-3">
          {[
            { key: "drug", label: "Drug Test", val: drugTest, set: setDrugTest },
            { key: "bg", label: "Background Verification", val: bgCheck, set: setBgCheck },
            {
              key: "client",
              label: "Client-Side Onboarding",
              val: clientOnboarding,
              set: setClientOnboarding,
            },
          ].map(({ key, label, val, set }) => (
            <label key={key} className="flex items-center gap-2 cursor-pointer select-none text-sm">
              <input
                type="checkbox"
                checked={val}
                onChange={(e) => set(e.target.checked)}
                className="rounded"
              />
              {label}
            </label>
          ))}
        </div>
      </div>

      {clientOnboarding && (
        <label className="text-xs font-medium text-muted-foreground">
          Client name
          <input
            value={clientName}
            onChange={(e) => setClientName(e.target.value)}
            placeholder="e.g. Accenture, TCS"
            className="mt-1 w-full rounded-xl border border-border bg-background px-3 py-2 text-sm text-foreground"
          />
        </label>
      )}

      <label className="text-xs font-medium text-muted-foreground">
        Notes (optional)
        <textarea
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          rows={2}
          placeholder="Any additional context for PMO team…"
          className="mt-1 w-full rounded-xl border border-border bg-background px-3 py-2 text-sm text-foreground resize-none"
        />
      </label>

      <button
        onClick={submit}
        disabled={saving}
        className="flex items-center gap-1.5 rounded-xl bg-[var(--collaboration)] px-4 py-2 text-sm font-semibold text-white hover:opacity-90 disabled:opacity-50"
      >
        {saving ? (
          <Loader2 className="h-3.5 w-3.5 animate-spin" />
        ) : (
          <CheckCircle2 className="h-3.5 w-3.5" />
        )}
        Submit onboarding request
      </button>
    </div>
  );
}

// ── PMO Requests tab ──────────────────────────────────────────────────────────

function PMORequestsTab({ auth, team }: { auth: Record<string, string>; team: TeamMember[] }) {
  const [requests, setRequests] = useState<PMOReq[]>([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState<"vdi_provision" | "vdi_revoke" | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const d = await fetch("/api/portal/manager/pmo-requests", { headers: auth }).then((r) =>
        r.json(),
      );
      setRequests(Array.isArray(d) ? d : []);
    } catch {
      /* ignore */
    } finally {
      setLoading(false);
    }
  }, [auth]);

  useEffect(() => {
    load();
  }, [load]);

  return (
    <div>
      <div className="mb-4 flex flex-wrap items-center gap-2">
        <p className="flex-1 text-sm text-muted-foreground">
          Submit VDI or access requests to PMO. Email notification is sent automatically.
        </p>
        <button
          onClick={() => setShowForm(showForm === "vdi_provision" ? null : "vdi_provision")}
          className={cn(
            "flex items-center gap-1.5 rounded-xl border px-3 py-2 text-sm font-semibold transition-colors",
            showForm === "vdi_provision"
              ? "border-[var(--collaboration)] bg-[var(--collaboration)]/10 text-[var(--collaboration)]"
              : "border-border bg-background hover:bg-muted",
          )}
        >
          <Server className="h-3.5 w-3.5" /> Request VDI
        </button>
        <button
          onClick={() => setShowForm(showForm === "vdi_revoke" ? null : "vdi_revoke")}
          className={cn(
            "flex items-center gap-1.5 rounded-xl border px-3 py-2 text-sm font-semibold transition-colors",
            showForm === "vdi_revoke"
              ? "border-destructive bg-destructive/10 text-destructive"
              : "border-border bg-background hover:bg-muted",
          )}
        >
          <ShieldX className="h-3.5 w-3.5" /> Revoke Access
        </button>
      </div>

      {showForm && (
        <PMORequestForm
          auth={auth}
          team={team}
          requestType={showForm}
          onCreated={() => {
            setShowForm(null);
            load();
          }}
        />
      )}

      {loading ? (
        <LoadingState label="Loading PMO requests…" />
      ) : requests.length === 0 ? (
        <EmptyState label="No PMO requests yet." />
      ) : (
        <div className="space-y-3">
          {requests.map((r) => (
            <div key={r.id} className="rounded-2xl border border-border bg-card/50 px-4 py-3">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <div className="flex items-center gap-2">
                    <span
                      className={cn(
                        "flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-semibold",
                        r.request_type === "vdi_provision"
                          ? "bg-blue-500/10 text-blue-600"
                          : "bg-red-500/10 text-red-600",
                      )}
                    >
                      {r.request_type === "vdi_provision" ? (
                        <Server className="h-3 w-3" />
                      ) : (
                        <ShieldX className="h-3 w-3" />
                      )}
                      {r.request_type_label}
                    </span>
                    <span className="text-[11px] text-muted-foreground">{r.ref_id}</span>
                  </div>
                  <div className="mt-1 font-semibold text-foreground">{r.employee_name}</div>
                  {r.employee_email && (
                    <div className="text-[11px] text-muted-foreground">{r.employee_email}</div>
                  )}
                  {r.details && (
                    <p className="mt-1.5 text-[11px] text-muted-foreground">{r.details}</p>
                  )}
                  <p className="mt-1 text-[11px] text-muted-foreground">{fmtDate(r.created_at)}</p>
                </div>
                <span
                  className={cn(
                    "shrink-0 rounded-full px-2 py-0.5 text-[10px] font-semibold",
                    STATUS_COLORS[r.status] ?? "bg-muted text-muted-foreground",
                  )}
                >
                  {r.status}
                </span>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function PMORequestForm({
  auth,
  team,
  requestType,
  onCreated,
}: {
  auth: Record<string, string>;
  team: TeamMember[];
  requestType: "vdi_provision" | "vdi_revoke";
  onCreated: () => void;
}) {
  const [employeeName, setEmployeeName] = useState("");
  const [employeeEmail, setEmployeeEmail] = useState("");
  const [emailAutoFilled, setEmailAutoFilled] = useState(false);
  const [details, setDetails] = useState("");
  const [saving, setSaving] = useState(false);

  const handleTeamSelect = (name: string) => {
    setEmployeeName(name);
    const m = team.find((t) => t.name === name);
    if (m) {
      setEmployeeEmail(m.email);
      setEmailAutoFilled(true);
    } else {
      setEmployeeEmail("");
      setEmailAutoFilled(false);
    }
  };

  const submit = async () => {
    if (!employeeName.trim()) {
      toast.error("Employee name is required.");
      return;
    }
    setSaving(true);
    try {
      const res = await fetch("/api/portal/manager/pmo-requests", {
        method: "POST",
        headers: { ...auth, "Content-Type": "application/json" },
        body: JSON.stringify({
          request_type: requestType,
          employee_name: employeeName,
          employee_email: employeeEmail,
          details,
        }),
      });
      if (res.ok) {
        flyBanner("PMO request submitted");
        onCreated();
      } else {
        const d = await res.json();
        toast.error(d.detail || "Could not submit.");
      }
    } catch {
      toast.error("Could not reach the server.");
    } finally {
      setSaving(false);
    }
  };

  const isRevoke = requestType === "vdi_revoke";

  return (
    <div
      className={cn(
        "mb-4 rounded-2xl border p-4 space-y-3",
        isRevoke ? "border-destructive/30 bg-destructive/5" : "border-blue-500/30 bg-blue-500/5",
      )}
    >
      <p className="text-sm font-semibold">
        {isRevoke ? "Revoke VDI / Access" : "Request VDI Provision"}
      </p>
      <div className="grid gap-3 sm:grid-cols-2">
        <label className="text-xs font-medium text-muted-foreground">
          Team member
          <select
            value={employeeName}
            onChange={(e) => handleTeamSelect(e.target.value)}
            className="mt-1 w-full rounded-xl border border-border bg-background px-3 py-2 text-sm text-foreground"
          >
            <option value="">— Select —</option>
            {team.map((m) => (
              <option key={m.id} value={m.name}>
                {m.name}
              </option>
            ))}
          </select>
        </label>
        <label className="text-xs font-medium text-muted-foreground">
          <span className="flex items-center gap-1.5">
            Employee email
            {emailAutoFilled && (
              <span className="text-[10px] font-semibold text-[var(--collaboration)]">
                auto-filled
              </span>
            )}
          </span>
          <input
            value={employeeEmail}
            onChange={(e) => {
              setEmployeeEmail(e.target.value);
              setEmailAutoFilled(false);
            }}
            placeholder="employee@company.com"
            className={cn(
              "mt-1 w-full rounded-xl border px-3 py-2 text-sm text-foreground",
              emailAutoFilled
                ? "border-[var(--collaboration)]/40 bg-[var(--collaboration)]/5"
                : "border-border bg-background",
            )}
          />
        </label>
      </div>
      <label className="text-xs font-medium text-muted-foreground">
        Details / reason
        <textarea
          value={details}
          onChange={(e) => setDetails(e.target.value)}
          rows={2}
          placeholder={
            isRevoke
              ? "Reason for revocation, systems to revoke…"
              : "VDI specs, project context, urgency…"
          }
          className="mt-1 w-full rounded-xl border border-border bg-background px-3 py-2 text-sm text-foreground resize-none"
        />
      </label>
      <button
        onClick={submit}
        disabled={saving}
        className={cn(
          "flex items-center gap-1.5 rounded-xl px-4 py-2 text-sm font-semibold text-white hover:opacity-90 disabled:opacity-50",
          isRevoke ? "bg-destructive" : "bg-[var(--collaboration)]",
        )}
      >
        {saving ? (
          <Loader2 className="h-3.5 w-3.5 animate-spin" />
        ) : (
          <CheckCircle2 className="h-3.5 w-3.5" />
        )}
        Submit to PMO
      </button>
    </div>
  );
}

// ── Shared helpers ────────────────────────────────────────────────────────────

// ── Readiness tab (weekly digest + project readiness checker) ──────────────────
interface DigestItem {
  name: string;
  date?: string;
  free?: number;
  training?: string;
  due?: string;
  load?: number;
  projects?: string[];
}
interface Digest {
  ok: boolean;
  team_size: number;
  rolling_off: DigestItem[];
  on_bench: DigestItem[];
  training_overdue: DigestItem[];
  training_due_soon: DigestItem[];
  load_training_conflicts: DigestItem[];
}
interface ReadinessRow {
  name: string;
  email: string | null;
  matched_skills: string[];
  missing_skills: string[];
  free_pct: number;
  status: "ready" | "one_course_away" | "gap";
  suggested_course: string | null;
}
interface ReadinessResult {
  ok: boolean;
  message?: string;
  required_skills?: string[];
  summary?: { ready: number; one_course_away: number; gap: number };
  rows?: ReadinessRow[];
}

const READINESS_BADGE: Record<string, string> = {
  ready: "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border border-emerald-500/20",
  one_course_away: "bg-amber-500/10 text-amber-600 dark:text-amber-400 border border-amber-500/20",
  gap: "bg-rose-500/10 text-rose-600 dark:text-rose-400 border border-rose-500/20",
};
const READINESS_LABEL: Record<string, string> = {
  ready: "Ready",
  one_course_away: "One course away",
  gap: "Gap",
};

function ReadinessTab({ auth }: { auth: Record<string, string> }) {
  const [digest, setDigest] = useState<Digest | null>(null);
  const [loading, setLoading] = useState(true);
  const [skills, setSkills] = useState("");
  const [result, setResult] = useState<ReadinessResult | null>(null);
  const [checking, setChecking] = useState(false);

  useEffect(() => {
    fetch("/api/portal/manager/team/digest", { headers: auth })
      .then((r) => r.json())
      .then((d) => setDigest(d))
      .catch(() => setDigest(null))
      .finally(() => setLoading(false));
  }, [auth]);

  const check = useCallback(async () => {
    if (!skills.trim()) return;
    setChecking(true);
    try {
      const res = await fetch("/api/portal/manager/team/readiness", {
        method: "POST",
        headers: { ...auth, "Content-Type": "application/json" },
        body: JSON.stringify({ skills }),
      });
      setResult(await res.json());
    } catch {
      toast.error("Failed to compute readiness");
    } finally {
      setChecking(false);
    }
  }, [skills, auth]);

  if (loading) return <LoadingState label="Loading team digest…" />;

  const sections: { key: keyof Digest; label: string; icon: typeof Gauge; tone: string }[] = [
    { key: "rolling_off", label: "Rolling off soon", icon: RefreshCw, tone: "text-indigo-600 dark:text-indigo-400" },
    { key: "on_bench", label: "On the bench", icon: Briefcase, tone: "text-emerald-600 dark:text-emerald-400" },
    { key: "training_overdue", label: "Training overdue", icon: AlertCircle, tone: "text-rose-600 dark:text-rose-400" },
    { key: "training_due_soon", label: "Training due this week", icon: Clock, tone: "text-amber-600 dark:text-amber-400" },
    { key: "load_training_conflicts", label: "Load vs training conflict", icon: ShieldX, tone: "text-rose-600 dark:text-rose-400" },
  ];

  return (
    <div className="space-y-6">
      {/* Weekly digest */}
      <div>
        <h2 className="mb-3 text-sm font-bold text-foreground flex items-center gap-2">
          <Gauge className="h-4 w-4 text-[var(--collaboration)]" />
          Weekly Team Digest
          <span className="text-xs font-normal text-muted-foreground">
            ({digest?.team_size ?? 0} in hierarchy)
          </span>
        </h2>
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
          {sections.map((s) => {
            const items = (digest?.[s.key] as DigestItem[]) ?? [];
            const Icon = s.icon;
            return (
              <div
                key={s.key}
                className="rounded-2xl border border-border bg-muted/20 p-4"
              >
                <div className="flex items-center justify-between mb-2">
                  <span className={cn("text-xs font-bold flex items-center gap-1.5", s.tone)}>
                    <Icon className="h-3.5 w-3.5" />
                    {s.label}
                  </span>
                  <span className="text-sm font-black text-foreground">{items.length}</span>
                </div>
                {items.length === 0 ? (
                  <p className="text-xs text-muted-foreground/70">Nothing this week.</p>
                ) : (
                  <ul className="space-y-1">
                    {items.slice(0, 6).map((it, i) => (
                      <li key={i} className="text-xs text-foreground/90 flex justify-between gap-2">
                        <span className="truncate">{it.name}</span>
                        <span className="text-muted-foreground/70 whitespace-nowrap font-mono text-[10px]">
                          {it.date || it.due || (it.free != null ? `${it.free}% free` : "") || (it.load != null ? `${it.load}% load` : "")}
                          {it.training ? ` · ${it.training}` : ""}
                        </span>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            );
          })}
        </div>
      </div>

      {/* Project readiness checker */}
      <div className="rounded-2xl border border-border bg-muted/20 p-4">
        <h2 className="mb-1 text-sm font-bold text-foreground flex items-center gap-2">
          <GraduationCap className="h-4 w-4 text-[var(--collaboration)]" />
          Team Readiness for a Project
        </h2>
        <p className="text-xs text-muted-foreground mb-3">
          Enter the skills an upcoming project needs — see who's ready, who's one course away, and
          who's a gap.
        </p>
        <div className="flex gap-2">
          <input
            value={skills}
            onChange={(e) => setSkills(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && check()}
            placeholder="e.g. React, Node, AWS"
            className="flex-1 rounded-xl border border-border bg-background px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-primary"
          />
          <button
            onClick={check}
            disabled={checking || !skills.trim()}
            className="flex items-center gap-1.5 rounded-xl bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground disabled:opacity-50"
          >
            {checking ? <Loader2 className="h-4 w-4 animate-spin" /> : <Gauge className="h-4 w-4" />}
            Check
          </button>
        </div>

        {result && result.ok && (
          <div className="mt-4">
            <div className="flex gap-2 mb-3 text-xs font-semibold">
              <span className="px-2 py-1 rounded-lg bg-emerald-500/10 text-emerald-600 dark:text-emerald-400">
                Ready {result.summary?.ready ?? 0}
              </span>
              <span className="px-2 py-1 rounded-lg bg-amber-500/10 text-amber-600 dark:text-amber-400">
                One course away {result.summary?.one_course_away ?? 0}
              </span>
              <span className="px-2 py-1 rounded-lg bg-rose-500/10 text-rose-600 dark:text-rose-400">
                Gap {result.summary?.gap ?? 0}
              </span>
            </div>
            <div className="space-y-1.5">
              {(result.rows ?? []).map((r) => (
                <div
                  key={r.name}
                  className="flex items-center justify-between gap-3 rounded-xl border border-border bg-background px-3 py-2 text-xs"
                >
                  <div className="min-w-0">
                    <span className="font-semibold text-foreground">{r.name}</span>
                    <span className="text-muted-foreground/70 ml-2">{r.free_pct}% free</span>
                    {r.suggested_course && (
                      <span className="text-amber-600 dark:text-amber-400 ml-2">
                        → {r.suggested_course}
                      </span>
                    )}
                    {r.missing_skills.length > 0 && (
                      <span className="text-muted-foreground/60 ml-2">
                        missing: {r.missing_skills.join(", ")}
                      </span>
                    )}
                  </div>
                  <span
                    className={cn(
                      "shrink-0 px-2 py-0.5 rounded-full text-[10px] font-bold",
                      READINESS_BADGE[r.status],
                    )}
                  >
                    {READINESS_LABEL[r.status]}
                  </span>
                </div>
              ))}
            </div>
          </div>
        )}
        {result && !result.ok && (
          <p className="mt-3 text-xs text-rose-600 dark:text-rose-400">
            {result.message || "Couldn't compute readiness."}
          </p>
        )}
      </div>
    </div>
  );
}

function LoadingState({ label }: { label: string }) {
  return (
    <div className="flex items-center gap-2.5 py-8 text-sm text-muted-foreground">
      <Loader2 className="h-4 w-4 animate-spin text-primary" /> {label}
    </div>
  );
}

function EmptyState({ label }: { label: string }) {
  return <p className="py-6 text-sm text-muted-foreground">{label}</p>;
}

function ExpandableGroup({
  title,
  count,
  unit = "project",
  children,
}: {
  title: string;
  count: number;
  unit?: string;
  children: React.ReactNode;
}) {
  const [open, setOpen] = useState(true);
  return (
    <div className="rounded-2xl border border-border bg-card/50 overflow-hidden">
      <button
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-center justify-between px-4 py-3 text-left hover:bg-muted/30 transition-colors"
      >
        <div className="flex items-center gap-2">
          <span className="font-semibold text-foreground">{title}</span>
          <span className="rounded-full bg-muted px-2 py-0.5 text-[11px] font-semibold text-muted-foreground">
            {count} {unit}
            {count !== 1 ? "s" : ""}
          </span>
        </div>
        {open ? (
          <ChevronUp className="h-4 w-4 text-muted-foreground" />
        ) : (
          <ChevronDown className="h-4 w-4 text-muted-foreground" />
        )}
      </button>
      {open && children}
    </div>
  );
}

// ── Appreciations tab ──────────────────────────────────────────────────────────

interface AppreciationRow {
  id: number;
  employee_email: string;
  employee_name: string;
  title: string;
  description: string | null;
  client_name: string | null;
  has_screenshot: boolean;
  screenshot_name: string | null;
  added_by_email: string;
  added_by_name: string | null;
  created_at: string | null;
}

function AppreciationsTab({ auth, team }: { auth: Record<string, string>; team: TeamMember[] }) {
  const [list, setList] = useState<AppreciationRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [lightboxSrc, setLightboxSrc] = useState<string | null>(null);
  const [appreciationToDelete, setAppreciationToDelete] = useState<number | null>(null);

  // Form state
  const [fEmployeeEmail, setFEmployeeEmail] = useState("");
  const [fEmployeeName, setFEmployeeName] = useState("");
  const [fTitle, setFTitle] = useState("");
  const [fDescription, setFDescription] = useState("");
  const [fClientName, setFClientName] = useState("");
  const [fFile, setFFile] = useState<File | null>(null);
  const [fPreview, setFPreview] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  const load = useCallback(() => {
    setLoading(true);
    fetch("/api/appreciations/", { headers: auth })
      .then((r) => (r.ok ? r.json() : []))
      .then(setList)
      .catch(() => setList([]))
      .finally(() => setLoading(false));
  }, [auth]);

  useEffect(() => {
    load();
  }, [load]);

  const pickFile = (e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0];
    if (!f) return;
    if (!f.type.startsWith("image/")) {
      toast.error("Only image files are accepted.");
      return;
    }
    if (f.size > 10 * 1024 * 1024) {
      toast.error("Max 10 MB.");
      return;
    }
    setFFile(f);
    const reader = new FileReader();
    reader.onload = (ev) => setFPreview(ev.target?.result as string);
    reader.readAsDataURL(f);
  };

  const autoFillFromTeam = (email: string) => {
    const member = team.find((m) => m.email.toLowerCase() === email.toLowerCase());
    if (member) setFEmployeeName(member.name);
  };

  const submit = async () => {
    if (!fEmployeeEmail.trim() || !fEmployeeName.trim() || !fTitle.trim()) {
      toast.error("Employee email, name and title are required.");
      return;
    }
    setSaving(true);
    try {
      const fd = new FormData();
      fd.append("employee_email", fEmployeeEmail.trim());
      fd.append("employee_name", fEmployeeName.trim());
      fd.append("title", fTitle.trim());
      if (fDescription.trim()) fd.append("description", fDescription.trim());
      if (fClientName.trim()) fd.append("client_name", fClientName.trim());
      if (fFile) fd.append("screenshot", fFile);

      const res = await fetch("/api/appreciations/", {
        method: "POST",
        headers: auth,
        body: fd,
      });
      if (!res.ok) throw new Error(await res.text());
      flyBanner("Appreciation added! 🏆");
      setShowForm(false);
      setFEmployeeEmail("");
      setFEmployeeName("");
      setFTitle("");
      setFDescription("");
      setFClientName("");
      setFFile(null);
      setFPreview(null);
      load();
    } catch (e: any) {
      toast.error(e.message || "Failed to save appreciation.");
    } finally {
      setSaving(false);
    }
  };

  const deleteRow = async (id: number) => {
    await fetch(`/api/appreciations/${id}`, { method: "DELETE", headers: auth });
    setList((prev) => prev.filter((r) => r.id !== id));
    toast.success("Deleted.");
  };

  // Group by employee
  const grouped = list.reduce<Record<string, AppreciationRow[]>>((acc, r) => {
    (acc[r.employee_email] = acc[r.employee_email] || []).push(r);
    return acc;
  }, {});

  return (
    <div>
      {/* Header */}
      <div className="mb-5 flex items-center justify-between">
        <div>
          <p className="text-sm font-semibold text-foreground">Client Appreciations</p>
          <p className="text-xs text-muted-foreground mt-0.5">
            Record email appreciations received from clients and tag the employee. Screenshots
            appear in their People Directory profile.
          </p>
        </div>
        <button
          onClick={() => setShowForm((v) => !v)}
          className="flex items-center gap-1.5 rounded-xl bg-amber-500 hover:bg-amber-600 px-4 py-2 text-sm font-semibold text-white transition-colors"
        >
          <Plus className="h-3.5 w-3.5" /> Add Appreciation
        </button>
      </div>

      {/* Add Form */}
      {showForm && (
        <div className="mb-6 rounded-2xl border border-amber-200 dark:border-amber-500/30 bg-amber-50/60 dark:bg-amber-500/5 p-5 space-y-4">
          <div className="flex items-center justify-between">
            <p className="text-sm font-semibold text-foreground flex items-center gap-2">
              <Trophy className="h-4 w-4 text-amber-500" /> New Appreciation
            </p>
            <button onClick={() => setShowForm(false)} className="rounded-lg p-1 hover:bg-muted/50">
              <X className="h-4 w-4 text-muted-foreground" />
            </button>
          </div>

          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <label className="text-xs font-medium text-muted-foreground">
              Employee Email *
              <div className="relative mt-1">
                <input
                  value={fEmployeeEmail}
                  onChange={(e) => {
                    setFEmployeeEmail(e.target.value);
                    autoFillFromTeam(e.target.value);
                  }}
                  placeholder="employee@company.com"
                  list="appreciation-team-emails"
                  className="w-full rounded-xl border border-border bg-background px-3 py-2 text-sm text-foreground"
                />
                <datalist id="appreciation-team-emails">
                  {team.map((m) => (
                    <option key={m.id} value={m.email} label={m.name} />
                  ))}
                </datalist>
              </div>
            </label>
            <label className="text-xs font-medium text-muted-foreground">
              Employee Name *
              <input
                value={fEmployeeName}
                onChange={(e) => setFEmployeeName(e.target.value)}
                placeholder="Full name"
                className="mt-1 w-full rounded-xl border border-border bg-background px-3 py-2 text-sm text-foreground"
              />
            </label>
            <label className="text-xs font-medium text-muted-foreground">
              Appreciation Title *
              <input
                value={fTitle}
                onChange={(e) => setFTitle(e.target.value)}
                placeholder="e.g. Outstanding delivery on Q2 release"
                className="mt-1 w-full rounded-xl border border-border bg-background px-3 py-2 text-sm text-foreground"
              />
            </label>
            <label className="text-xs font-medium text-muted-foreground">
              Client Name
              <div className="relative mt-1 flex items-center">
                <Building2 className="absolute left-3 h-3.5 w-3.5 text-muted-foreground/50" />
                <input
                  value={fClientName}
                  onChange={(e) => setFClientName(e.target.value)}
                  placeholder="e.g. Eli Lilly, Dell, Worley"
                  className="w-full rounded-xl border border-border bg-background pl-8 pr-3 py-2 text-sm text-foreground"
                />
              </div>
            </label>
          </div>

          <label className="text-xs font-medium text-muted-foreground">
            Description / Context
            <textarea
              value={fDescription}
              onChange={(e) => setFDescription(e.target.value)}
              rows={3}
              placeholder="Paste the appreciation email content or add context about the recognition…"
              className="mt-1 w-full rounded-xl border border-border bg-background px-3 py-2 text-sm text-foreground resize-none"
            />
          </label>

          {/* Screenshot Upload */}
          <div>
            <p className="text-xs font-medium text-muted-foreground mb-2">
              Screenshot of Email (optional)
            </p>
            {fPreview ? (
              <div className="relative inline-block">
                <img
                  src={fPreview}
                  alt="Preview"
                  className="h-32 rounded-xl border border-border object-cover"
                />
                <button
                  onClick={() => {
                    setFFile(null);
                    setFPreview(null);
                    if (fileRef.current) fileRef.current.value = "";
                  }}
                  className="absolute -top-2 -right-2 rounded-full bg-destructive p-1 text-white shadow"
                >
                  <X className="h-3 w-3" />
                </button>
              </div>
            ) : (
              <button
                onClick={() => fileRef.current?.click()}
                className="flex items-center gap-2 rounded-xl border-2 border-dashed border-amber-300 dark:border-amber-500/30 bg-amber-50 dark:bg-amber-500/5 px-4 py-3 text-sm text-amber-700 dark:text-amber-400 hover:border-amber-400 transition-colors"
              >
                <Upload className="h-4 w-4" /> Upload screenshot (JPG, PNG, max 10 MB)
              </button>
            )}
            <input
              ref={fileRef}
              type="file"
              accept="image/*"
              className="hidden"
              onChange={pickFile}
            />
          </div>

          <div className="flex justify-end gap-2 pt-1">
            <button
              onClick={() => setShowForm(false)}
              className="rounded-xl border border-border px-4 py-2 text-sm font-medium hover:bg-muted"
            >
              Cancel
            </button>
            <button
              onClick={submit}
              disabled={saving}
              className="flex items-center gap-1.5 rounded-xl bg-amber-500 hover:bg-amber-600 px-5 py-2 text-sm font-semibold text-white disabled:opacity-50"
            >
              {saving ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
              ) : (
                <Trophy className="h-3.5 w-3.5" />
              )}
              Save Appreciation
            </button>
          </div>
        </div>
      )}

      {/* List */}
      {loading ? (
        <LoadingState label="Loading appreciations…" />
      ) : list.length === 0 ? (
        <div className="flex flex-col items-center py-12 text-center">
          <Trophy className="h-10 w-10 text-amber-400/40 mb-3" />
          <p className="text-sm font-medium text-muted-foreground">No appreciations recorded yet</p>
          <p className="text-xs text-muted-foreground/60 mt-1">
            Start by adding the first client appreciation above.
          </p>
        </div>
      ) : (
        <div className="space-y-4">
          {Object.entries(grouped).map(([email, rows]) => (
            <div
              key={email}
              className="rounded-2xl border border-border bg-card/50 overflow-hidden"
            >
              <div className="flex items-center gap-3 border-b border-border px-4 py-3 bg-muted/20">
                <div className="h-8 w-8 rounded-full bg-amber-500/10 text-amber-600 flex items-center justify-center text-[13px] font-bold">
                  {(rows[0].employee_name || "?")
                    .split(" ")
                    .map((n) => n[0])
                    .join("")
                    .slice(0, 2)
                    .toUpperCase()}
                </div>
                <div>
                  <p className="text-sm font-semibold text-foreground">{rows[0].employee_name}</p>
                  <p className="text-xs text-muted-foreground">{email}</p>
                </div>
                <span className="ml-auto flex items-center gap-1 text-[11px] font-semibold text-amber-600 dark:text-amber-400 bg-amber-500/10 border border-amber-500/20 rounded-full px-2.5 py-0.5">
                  <Trophy className="h-3 w-3" /> {rows.length} appreciation
                  {rows.length > 1 ? "s" : ""}
                </span>
              </div>
              <div className="divide-y divide-border">
                {rows.map((r) => (
                  <div key={r.id} className="flex items-start gap-4 px-4 py-4">
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <p className="text-sm font-semibold text-foreground">{r.title}</p>
                        {r.client_name && (
                          <span className="flex items-center gap-1 text-[10px] font-medium text-amber-700 dark:text-amber-400 bg-amber-500/10 border border-amber-500/20 rounded-full px-2 py-0.5">
                            <Building2 className="h-2.5 w-2.5" />
                            {r.client_name}
                          </span>
                        )}
                      </div>
                      {r.description && (
                        <p className="mt-1 text-xs text-muted-foreground leading-relaxed line-clamp-3">
                          {r.description}
                        </p>
                      )}
                      <p className="mt-1.5 text-[11px] text-muted-foreground/50">
                        Added by {r.added_by_name || r.added_by_email}
                        {r.created_at &&
                          ` · ${new Date(r.created_at).toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" })}`}
                      </p>
                    </div>
                    <div className="flex items-center gap-2 shrink-0">
                      {r.has_screenshot && (
                        <button
                          onClick={() => setLightboxSrc(`/api/appreciations/${r.id}/screenshot`)}
                          className="rounded-lg overflow-hidden border border-border hover:border-amber-400 transition-colors group relative"
                          title="View screenshot"
                        >
                          <img
                            src={`/api/appreciations/${r.id}/screenshot`}
                            alt="Screenshot"
                            className="h-12 w-16 object-cover"
                          />
                          <div className="absolute inset-0 bg-black/0 group-hover:bg-black/20 transition-colors flex items-center justify-center">
                            <ZoomIn className="h-3.5 w-3.5 text-white opacity-0 group-hover:opacity-100 transition-opacity" />
                          </div>
                        </button>
                      )}
                      <button
                        onClick={() => setAppreciationToDelete(r.id)}
                        className="rounded-lg p-1.5 text-muted-foreground hover:text-destructive hover:bg-destructive/10 transition-colors"
                        title="Delete"
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Lightbox */}
      {lightboxSrc && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-sm"
          onClick={() => setLightboxSrc(null)}
        >
          <div className="relative max-w-4xl max-h-[90vh] p-4">
            <img
              src={lightboxSrc}
              alt="Appreciation screenshot"
              className="max-h-[85vh] max-w-full rounded-xl shadow-2xl object-contain"
            />
            <button
              onClick={(e) => {
                e.stopPropagation();
                setLightboxSrc(null);
              }}
              className="absolute top-2 right-2 rounded-full bg-black/50 p-1.5 text-white hover:bg-black/70"
            >
              <X className="h-4 w-4" />
            </button>
          </div>
        </div>
      )}

      <AlertDialog
        open={appreciationToDelete !== null}
        onOpenChange={(open) => !open && setAppreciationToDelete(null)}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete Appreciation</AlertDialogTitle>
            <AlertDialogDescription>
              Are you sure you want to delete this appreciation? This action cannot be undone and
              this appreciation will no longer be visible on the employee's profile.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                if (appreciationToDelete !== null) {
                  deleteRow(appreciationToDelete);
                  setAppreciationToDelete(null);
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
