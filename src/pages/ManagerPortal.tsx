import { useAuth } from "@/lib/auth-store";
import { Fragment, useState, useEffect, useCallback, useMemo, useRef } from "react";
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
  CalendarIcon,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { toast } from "sonner";
import { flyBanner } from "@/lib/fly-banner";
import { apiUrl } from "@/lib/api-base";
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
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { AssignTrainingDialog } from "@/components/AssignTrainingDialog";
import { Button } from "@/components/ui/button";
import {
  Table,
  TableHeader,
  TableBody,
  TableRow,
  TableHead,
  TableCell,
} from "@/components/ui/table";
import { ScrollArea, ScrollBar } from "@/components/ui/scroll-area";
import { Calendar } from "@/components/ui/calendar";
import { Popover, PopoverTrigger, PopoverContent } from "@/components/ui/popover";
import { Tooltip, TooltipTrigger, TooltipContent, TooltipProvider } from "@/components/ui/tooltip";
import { format } from "date-fns";
import { Progress } from "@/components/ui/progress";

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
  self?: Member;
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
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
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
  | "email-automation"
  | "allocations"
  | "readiness"
  | "skills"
  | "onboarding"
  | "pmo-requests"
  | "appreciations";

// `cap` gates a tab on a Manager-Portal capability (from /api/portal/manager/access).
// Tabs without `cap` are visible to anyone who reaches the portal (has reports / Super Admin).
type TabCap = "onboarding" | "pmo";
const BASE_TABS: { id: TabId; label: string; icon: typeof Users; cap?: TabCap }[] = [
  { id: "attendance", label: "Attendance", icon: CalendarClock },
  { id: "email-automation", label: "Email Automation", icon: Mail },
  { id: "allocations", label: "Allocations", icon: Briefcase },
  { id: "readiness", label: "Readiness", icon: Gauge },
  { id: "skills", label: "Skills", icon: Wrench },
  { id: "onboarding", label: "Onboarding", icon: ClipboardList, cap: "onboarding" },
  { id: "pmo-requests", label: "PMO Requests", icon: Server, cap: "pmo" },
  { id: "appreciations", label: "Appreciations", icon: Trophy },
];

interface ManagerAccess {
  can_onboarding: boolean;
  can_vdi_provision: boolean;
  can_vdi_revoke: boolean;
  can_pmo_requests: boolean;
}
const NO_ACCESS: ManagerAccess = {
  can_onboarding: false,
  can_vdi_provision: false,
  can_vdi_revoke: false,
  can_pmo_requests: false,
};

const STATUS_COLORS: Record<string, string> = {
  Pending: "bg-amber-500/10 text-amber-600",
  "In Progress": "bg-blue-500/10 text-blue-600",
  Completed: "bg-emerald-500/10 text-emerald-600",
  Rejected: "bg-red-500/10 text-red-600",
};

// ── Root component ────────────────────────────────────────────────────────────

export function ManagerPortal() {
  const { user } = useAuth();
  const isFM = user?.role === "Functional Manager" || user?.role === "Super Admin";
  const auth = useMemo(
    () => ({ "x-user-email": user?.email ?? "", "x-user-role": (user?.role ?? "").toLowerCase() }),
    [user?.email, user?.role],
  );

  // Team-operation tabs (onboarding / PMO requests) are gated by assignable capabilities,
  // resolved by the backend. Until loaded, they stay hidden (fail-closed).
  const [access, setAccess] = useState<ManagerAccess>(NO_ACCESS);
  const TABS = BASE_TABS.filter((t) => {
    if (t.cap === "onboarding") return access.can_onboarding;
    if (t.cap === "pmo") return access.can_pmo_requests;
    return true;
  });

  const [activeTab, setActiveTab] = useState<TabId>("attendance");
  const [team, setTeam] = useState<TeamMember[]>([]);

  useEffect(() => {
    if (!TABS.find((t) => t.id === activeTab)) setActiveTab("attendance");
  }, [access]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    fetch("/api/portal/manager/team", { headers: auth })
      .then((r) => r.json())
      .then((d) => (Array.isArray(d) ? setTeam(d) : null))
      .catch(() => {});
    fetch("/api/portal/manager/access", { headers: auth })
      .then((r) => (r.ok ? r.json() : NO_ACCESS))
      .then((d) => setAccess({ ...NO_ACCESS, ...(d || {}) }))
      .catch(() => setAccess(NO_ACCESS));
  }, [auth]);

  return (
    <div className="h-full overflow-y-auto w-full px-4 sm:px-6 py-6 sm:py-8 bg-gradient-to-b from-background via-background to-muted/20">
      {/* Header */}
      <div className="mb-6 flex flex-col sm:flex-row sm:items-center justify-between gap-4 pb-4 border-b border-border/60">
        <div className="flex items-center gap-3 sm:gap-4">
          <div className="flex h-12 w-12 sm:h-14 sm:w-14 items-center justify-center rounded-2xl bg-gradient-to-tr from-[var(--collaboration)]/20 to-[var(--collaboration)]/5 shadow-inner border border-[var(--collaboration)]/25">
            <UserCog className="h-6 w-6 sm:h-7 sm:w-7 text-[var(--collaboration)] animate-pulse" />
          </div>
          <div>
            <p className="text-xs sm:text-sm text-muted-foreground mt-0.5">
              {isFM
                ? "Manage hierarchy allocations, track readiness, onboarding, and team operations."
                : "View your team's attendance, allocations, readiness, and skills."}
            </p>
          </div>
        </div>
      </div>

      {/* Tabs */}
      <Tabs value={activeTab} onValueChange={(v) => setActiveTab(v as TabId)}>
        <div className="relative mb-6">
          <div className="overflow-x-auto no-scrollbar -mx-4 px-4 sm:mx-0 sm:px-0">
            <TabsList className="inline-flex h-auto w-max gap-1 rounded-2xl border border-border/60 bg-muted/40 p-1.5 backdrop-blur-sm">
              {TABS.map((t) => {
                const Icon = t.icon;
                return (
                  <TabsTrigger
                    key={t.id}
                    value={t.id}
                    className="flex shrink-0 items-center gap-1.5 rounded-xl px-3 py-2 text-xs font-semibold data-[state=active]:bg-background data-[state=active]:text-foreground data-[state=active]:shadow-sm data-[state=active]:border data-[state=active]:border-border/50 data-[state=inactive]:text-muted-foreground"
                  >
                    <Icon className="h-3.5 w-3.5" />
                    <span className="whitespace-nowrap hidden sm:inline">{t.label}</span>
                    <span className="whitespace-nowrap sm:hidden">{t.label.split(" ")[0]}</span>
                  </TabsTrigger>
                );
              })}
            </TabsList>
          </div>
          <div className="pointer-events-none absolute inset-y-0 right-0 w-8 bg-gradient-to-l from-background to-transparent sm:hidden" />
        </div>

        <TabsContent value="attendance">
          <AttendanceTab auth={auth} />
        </TabsContent>
        <TabsContent value="email-automation">
          <EmailAutomationTab auth={auth} />
        </TabsContent>
        <TabsContent value="allocations">
          <AllocationsTab auth={auth} />
        </TabsContent>
        <TabsContent value="readiness">
          <ReadinessTab auth={auth} />
        </TabsContent>
        <TabsContent value="skills">
          <SkillsTab auth={auth} />
        </TabsContent>
        {access.can_onboarding && (
          <TabsContent value="onboarding">
            <OnboardingTab auth={auth} team={team} />
          </TabsContent>
        )}
        {access.can_pmo_requests && (
          <TabsContent value="pmo-requests">
            <PMORequestsTab auth={auth} team={team} access={access} />
          </TabsContent>
        )}
        <TabsContent value="appreciations">
          <AppreciationsTab auth={auth} team={team} />
        </TabsContent>
      </Tabs>
    </div>
  );
}

// ── Attendance tab ────────────────────────────────────────────────────────────

function AttendanceTab({ auth }: { auth: Record<string, string> }) {
  const now = new Date();
  const [selectedDate, setSelectedDate] = useState<Date>(new Date(now.getFullYear(), now.getMonth(), 1));
  const [calendarOpen, setCalendarOpen] = useState(false);
  const month = selectedDate.getMonth() + 1;
  const year = selectedDate.getFullYear();
  const [report, setReport] = useState<TeamReport | null>(null);
  const [loading, setLoading] = useState(true);
  const [emailing, setEmailing] = useState(false);
  const [calendarMember, setCalendarMember] = useState<Member | null>(null);

  const handleDateSelect = (date: Date | undefined) => {
    if (date) {
      setSelectedDate(new Date(date.getFullYear(), date.getMonth(), 1));
      setCalendarOpen(false);
    }
  };

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
      "Employee", "Email", "Department", "Designation", "Reports To",
      "Present", "Absent", "WFH", "Late", "Half-day",
    ];
    const rowSource = report.self ? [report.self, ...report.members] : report.members;
    const rows = rowSource.map((m) =>
      [m.employee, m.email, m.department, m.designation, m.reports_to,
       m.present, m.absent, m.wfh, m.late, m.half_day]
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
    <div className="space-y-6">
      {/* Controls bar */}
      <Card>
        <CardContent className="p-3 sm:p-5">
          <div className="flex items-center gap-2 flex-wrap">
            <Popover open={calendarOpen} onOpenChange={setCalendarOpen}>
              <PopoverTrigger asChild>
                <Button variant="outline" size="sm" className="gap-2 min-w-[160px] justify-start font-medium">
                  <CalendarIcon className="h-3.5 w-3.5 text-muted-foreground" />
                  {format(selectedDate, "MMMM yyyy")}
                </Button>
              </PopoverTrigger>
              <PopoverContent className="w-auto p-0" align="start">
                <Calendar
                  mode="single"
                  selected={selectedDate}
                  onSelect={handleDateSelect}
                  defaultMonth={selectedDate}
                  captionLayout="dropdown"
                  fromYear={year - 3}
                  toYear={year + 1}
                />
              </PopoverContent>
            </Popover>
            <Button variant="outline" size="sm" onClick={loadReport} className="px-2.5">
              <RefreshCw className="h-3.5 w-3.5" />
            </Button>
            <div className="flex-1" />
            <Button variant="outline" size="sm" onClick={downloadCsv} disabled={!report?.success} className="px-2.5 sm:px-3">
              <Download className="h-3.5 w-3.5" />
              <span className="hidden sm:inline">CSV</span>
            </Button>
            <Button size="sm" onClick={emailNow} disabled={!report?.success || emailing}>
              {emailing ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Mail className="h-3.5 w-3.5" />}
              <span className="hidden sm:inline">Email Report</span>
            </Button>
          </div>
        </CardContent>
      </Card>

      {loading ? (
        <LoadingState label="Loading attendance data…" />
      ) : !report?.success ? (
        <Card className="border-amber-500/20 bg-amber-500/5">
          <CardContent className="flex items-start gap-3 p-4 sm:p-5 text-sm text-amber-600 dark:text-amber-400">
            <AlertCircle className="mt-0.5 h-5 w-5 shrink-0" />
            <p className="leading-relaxed">{report?.message || "No employees report up to you."}</p>
          </CardContent>
        </Card>
      ) : (
        <>
          {/* Stats grid */}
          <div className="grid grid-cols-2 gap-3 sm:gap-4 sm:grid-cols-3 lg:grid-cols-6">
            {[
              { label: "Team Size", value: report.headcount, color: "text-violet-500", bg: "bg-violet-500/10", border: "border-violet-500/20" },
              { label: "Present", value: totals!.present, color: "text-emerald-500", bg: "bg-emerald-500/10", border: "border-emerald-500/20" },
              { label: "Absent", value: totals!.absent, color: "text-rose-500", bg: "bg-rose-500/10", border: "border-rose-500/20" },
              { label: "WFH", value: totals!.wfh, color: "text-sky-500", bg: "bg-sky-500/10", border: "border-sky-500/20" },
              { label: "Late", value: totals!.late, color: "text-amber-500", bg: "bg-amber-500/10", border: "border-amber-500/20" },
              { label: "Half-day", value: totals!.half_day, color: "text-orange-500", bg: "bg-orange-500/10", border: "border-orange-500/20" },
            ].map((c) => (
              <div key={c.label} className={`rounded-2xl border ${c.border} ${c.bg} px-4 py-4 backdrop-blur-sm hover:shadow-md transition-all duration-200 group`}>
                <p className={`text-[10.5px] font-bold uppercase tracking-[0.1em] ${c.color} mb-2`}>{c.label}</p>
                <p className="text-2xl sm:text-3xl font-extrabold text-foreground group-hover:scale-105 transition-transform origin-left">{c.value}</p>
              </div>
            ))}
          </div>

          {/* Attendance table */}
          <Card>
            <Table paginate itemsPerPage={10}>
              <TableHeader>
                <TableRow className="bg-muted/60 text-[11px] font-bold uppercase tracking-[0.1em]">
                  <TableHead className="px-4 py-3">Employee</TableHead>
                  <TableHead className="px-4 py-3 hidden md:table-cell">Department</TableHead>
                  <TableHead className="px-4 py-3 hidden lg:table-cell">Reports To</TableHead>
                  <TableHead className="px-4 py-3 text-center">Present</TableHead>
                  <TableHead className="px-4 py-3 text-center">Absent</TableHead>
                  <TableHead className="px-4 py-3 text-center hidden sm:table-cell">WFH</TableHead>
                  <TableHead className="px-4 py-3 text-center hidden sm:table-cell">Late</TableHead>
                  <TableHead className="px-4 py-3 text-center hidden sm:table-cell">Half-day</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {report.self && (
                  <AttendanceRow
                    member={report.self}
                    isSelf
                    className="bg-primary/5 hover:bg-primary/10"
                    onOpen={() => setCalendarMember(report.self!)}
                  />
                )}
                {report.members!.map((m, i) => (
                  <AttendanceRow
                    key={m.email || i}
                    member={m}
                    className={i % 2 ? "bg-muted/10 hover:bg-muted/40" : "bg-background/60 hover:bg-muted/40"}
                    onOpen={() => setCalendarMember(m)}
                  />
                ))}
              </TableBody>
            </Table>
            <p className="px-4 py-2.5 text-[11px] text-muted-foreground border-t border-border">
              Tip: click any row to see that person's day-by-day calendar.
            </p>
          </Card>

          <MemberCalendarDialog
            member={calendarMember}
            month={month}
            year={year}
            auth={auth}
            onClose={() => setCalendarMember(null)}
          />
        </>
      )}
    </div>
  );
}

// ── Attendance table row (clickable → calendar drill-down) ─────────────────────

function AttendanceRow({
  member: m,
  isSelf = false,
  className = "",
  onOpen,
}: {
  member: Member;
  isSelf?: boolean;
  className?: string;
  onOpen: () => void;
}) {
  return (
    <TableRow
      className={cn("cursor-pointer transition-colors", className)}
      onClick={onOpen}
      tabIndex={0}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          onOpen();
        }
      }}
    >
      <TableCell className="px-4 py-3">
        <div className="flex items-center gap-2">
          <span className="font-semibold text-foreground">{m.employee}</span>
          {isSelf && (
            <Badge className="bg-primary/15 text-primary hover:bg-primary/15 text-[10px] font-bold uppercase tracking-wide px-1.5 py-0">
              You
            </Badge>
          )}
        </div>
        <div className="text-[11px] text-muted-foreground mt-0.5">{m.designation}</div>
        <div className="text-[11px] text-muted-foreground mt-0.5 md:hidden">{m.department}</div>
      </TableCell>
      <TableCell className="px-4 py-3 hidden md:table-cell">
        <Badge variant="secondary" className="text-xs font-medium">{m.department}</Badge>
      </TableCell>
      <TableCell className="px-4 py-3 text-sm text-muted-foreground hidden lg:table-cell">{m.reports_to}</TableCell>
      <TableCell className="px-4 py-3 text-center">
        <span className="inline-flex h-7 w-9 items-center justify-center rounded-lg bg-emerald-500/10 text-sm font-bold text-emerald-600">{m.present}</span>
      </TableCell>
      <TableCell className="px-4 py-3 text-center">
        <span className="inline-flex h-7 w-9 items-center justify-center rounded-lg bg-rose-500/10 text-sm font-bold text-rose-600">{m.absent}</span>
      </TableCell>
      <TableCell className="px-4 py-3 text-center hidden sm:table-cell">
        <span className="inline-flex h-7 w-9 items-center justify-center rounded-lg bg-sky-500/10 text-sm font-bold text-sky-600">{m.wfh}</span>
      </TableCell>
      <TableCell className="px-4 py-3 text-center hidden sm:table-cell">
        <span className="inline-flex h-7 w-9 items-center justify-center rounded-lg bg-amber-500/10 text-sm font-bold text-amber-600">{m.late}</span>
      </TableCell>
      <TableCell className="px-4 py-3 text-center hidden sm:table-cell">
        <span className="inline-flex h-7 w-9 items-center justify-center rounded-lg bg-orange-500/10 text-sm font-bold text-orange-600">{m.half_day}</span>
      </TableCell>
    </TableRow>
  );
}

// ── Member attendance calendar drill-down ──────────────────────────────────────

interface CalDay {
  date: string;
  status: string;
  check_in: string | null;
  check_out: string | null;
  late: boolean;
}
interface MemberCalendar {
  success: boolean;
  employee?: string;
  month?: number;
  year?: number;
  period?: string;
  days?: CalDay[];
  message?: string;
}

const CAL_LEGEND = [
  { color: "bg-emerald-400", label: "Present" },
  { color: "bg-amber-400", label: "Late" },
  { color: "bg-purple-400", label: "Half-day" },
  { color: "bg-red-400", label: "Absent" },
];

function calDayClass(record: CalDay | undefined, isFuture: boolean, isWeekend: boolean) {
  if (isFuture || (!record && isWeekend)) return "text-muted-foreground/30";
  if (!record) return "text-muted-foreground/40";
  if (record.late) return "bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-200";
  if (record.status === "Present")
    return "bg-emerald-100 text-emerald-800 dark:bg-emerald-900/40 dark:text-emerald-200";
  if (record.status === "Absent")
    return "bg-red-100 text-red-800 dark:bg-red-900/40 dark:text-red-200";
  if (record.status === "WFH")
    return "bg-blue-100 text-blue-800 dark:bg-blue-900/40 dark:text-blue-200";
  if (record.status === "Half-day")
    return "bg-purple-100 text-purple-800 dark:bg-purple-900/40 dark:text-purple-200";
  return "text-muted-foreground/40";
}

function MemberCalendarDialog({
  member,
  month,
  year,
  auth,
  onClose,
}: {
  member: Member | null;
  month: number;
  year: number;
  auth: Record<string, string>;
  onClose: () => void;
}) {
  const [data, setData] = useState<MemberCalendar | null>(null);
  const [loading, setLoading] = useState(false);
  const [selectedDate, setSelectedDate] = useState<string | null>(null);

  useEffect(() => {
    if (!member) return;
    setLoading(true);
    setData(null);
    setSelectedDate(null);
    fetch(
      `/api/portal/manager/attendance/calendar?email=${encodeURIComponent(member.email)}&month=${month}&year=${year}`,
      { headers: auth },
    )
      .then((r) => r.json())
      .then(setData)
      .catch(() => setData({ success: false, message: "network_error" }))
      .finally(() => setLoading(false));
  }, [member, month, year, auth]);

  const todayStr = new Date().toISOString().slice(0, 10);
  const dayMap: Record<string, CalDay> = {};
  (data?.days ?? []).forEach((d) => {
    dayMap[d.date] = d;
  });

  const firstDow = new Date(year, month - 1, 1).getDay();
  const daysInMonth = new Date(year, month, 0).getDate();
  const periodLabel = new Date(year, month - 1, 1).toLocaleDateString("en-IN", {
    month: "long",
    year: "numeric",
  });

  return (
    <Dialog open={!!member} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>{member?.employee}</DialogTitle>
          <DialogDescription>
            {member?.designation ? `${member.designation} · ` : ""}Attendance for {periodLabel}
          </DialogDescription>
        </DialogHeader>

        {loading ? (
          <div className="flex items-center gap-2 py-8 text-sm text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin text-primary" />
            Loading calendar…
          </div>
        ) : !data?.success ? (
          <div className="flex items-center gap-2 py-6 text-sm text-muted-foreground">
            <AlertCircle className="h-4 w-4 text-amber-500" />
            Could not load this person's calendar.
          </div>
        ) : (
          <>
            {/* Calendar grid */}
            <TooltipProvider delayDuration={200}>
              <div className="overflow-hidden rounded-xl border border-border">
                <div className="grid grid-cols-7 bg-muted/50 text-center text-[10px] font-bold uppercase tracking-wide text-muted-foreground">
                  {["Su", "Mo", "Tu", "We", "Th", "Fr", "Sa"].map((d) => (
                    <div key={d} className="py-1.5">{d}</div>
                  ))}
                </div>
                <div className="grid grid-cols-7">
                  {Array.from({ length: firstDow }).map((_, i) => (
                    <div key={`pre-${i}`} className="aspect-square" />
                  ))}
                  {Array.from({ length: daysInMonth }, (_, i) => i + 1).map((day) => {
                    const dateStr = `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
                    const record = dayMap[dateStr];
                    const isFuture = dateStr > todayStr;
                    const dow = new Date(dateStr).getDay();
                    const isWeekend = dow === 0 || dow === 6;
                    const isToday = dateStr === todayStr;
                    const tooltip = record
                      ? [
                          record.status + (record.late ? " (Late)" : ""),
                          record.check_in ? `In: ${record.check_in}` : null,
                          record.check_out ? `Out: ${record.check_out}` : null,
                        ].filter(Boolean).join(" · ")
                      : undefined;
                    const cell = (
                      <Button
                        type="button"
                        variant="ghost"
                        disabled={!record}
                        onClick={() => setSelectedDate(dateStr === selectedDate ? null : dateStr)}
                        className={cn(
                          "aspect-square h-auto w-full rounded-none p-0 text-[11px] font-medium transition-colors",
                          calDayClass(record, isFuture, isWeekend),
                          isToday ? "ring-2 ring-primary ring-inset" : "",
                          selectedDate === dateStr ? "ring-2 ring-primary" : "",
                        )}
                      >
                        {day}
                      </Button>
                    );
                    return record ? (
                      <Tooltip key={day}>
                        <TooltipTrigger asChild>{cell}</TooltipTrigger>
                        <TooltipContent>{tooltip}</TooltipContent>
                      </Tooltip>
                    ) : (
                      <Fragment key={day}>{cell}</Fragment>
                    );
                  })}
                </div>
              </div>
            </TooltipProvider>

            {/* Selected day detail */}
            {selectedDate && dayMap[selectedDate] && (
              <div className="mt-1 flex items-center justify-between rounded-lg border border-border bg-muted/40 px-3 py-2 text-xs">
                <span className="font-semibold">
                  {new Date(selectedDate).toLocaleDateString("en-IN", { weekday: "short", day: "numeric", month: "short" })}
                </span>
                <span className="text-muted-foreground">
                  {dayMap[selectedDate].status}
                  {dayMap[selectedDate].late ? " (Late)" : ""}
                  {" · In: "}{dayMap[selectedDate].check_in ?? "—"}
                  {" · Out: "}{dayMap[selectedDate].check_out ?? "—"}
                </span>
              </div>
            )}

            {/* Legend */}
            <div className="mt-1 flex flex-wrap gap-x-3 gap-y-1 text-[10px] text-muted-foreground">
              {CAL_LEGEND.map(({ color, label }) => (
                <span key={label} className="flex items-center gap-1">
                  <span className={`inline-block h-2 w-2 rounded-full ${color}`} />
                  {label}
                </span>
              ))}
            </div>
            <p className="text-[10px] text-muted-foreground/70">
              Weekends are unshaded. Days with no biometric punch show as Absent.
            </p>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}

// ── Email Automation tab ─────────────────────────────────────────────────────

function EmailAutomationTab({ auth }: { auth: Record<string, string> }) {
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
    <div className="space-y-6">
      <Card>
        <CardHeader className="p-4 sm:p-5 pb-0 sm:pb-0">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
            <div className="flex items-center gap-2.5">
              <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-[var(--collaboration)]/10 border border-[var(--collaboration)]/20">
                <Mail className="h-4.5 w-4.5 text-[var(--collaboration)]" />
              </span>
              <div>
                <CardTitle className="text-sm">Email Automations</CardTitle>
                <CardDescription className="mt-0.5">Auto-schedule attendance reports to your inbox</CardDescription>
              </div>
            </div>
            <Button
              variant="outline"
              size="sm"
              onClick={() => setShowForm((v) => !v)}
              className="border-[var(--collaboration)]/30 bg-[var(--collaboration)]/5 text-[var(--collaboration)] hover:bg-[var(--collaboration)]/10 w-full sm:w-auto"
            >
              <Plus className="h-3.5 w-3.5" /> New Automation
            </Button>
          </div>
        </CardHeader>
        <CardContent className="p-4 sm:p-5">
          {showForm && (
            <div className="mb-4">
              <ScheduleForm
                auth={auth}
                onCreated={() => { setShowForm(false); load(); }}
              />
            </div>
          )}
          {loading ? (
            <div className="flex items-center gap-2 py-6 text-sm text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin text-primary" /> Loading automations…
            </div>
          ) : schedules.length === 0 ? (
            <div className="flex flex-col items-center gap-2 py-8 text-center">
              <span className="flex h-10 w-10 items-center justify-center rounded-2xl bg-muted text-muted-foreground">
                <CalendarClock className="h-5 w-5" />
              </span>
              <p className="text-sm font-medium text-muted-foreground">No automations yet</p>
              <p className="text-xs text-muted-foreground/70">Add one to get attendance reports emailed on a schedule.</p>
            </div>
          ) : (
            <div className="space-y-2.5">
              {schedules.map((s) => (
                <Card key={s.id} className="shadow-none">
                  <CardContent className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 p-4">
                    <div className="min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="font-semibold text-foreground text-sm">{describeCadence(s)}</span>
                        {!s.active && <Badge variant="secondary">Paused</Badge>}
                        {s.period_mode === "prev_period" && (
                          <Badge className="bg-[var(--collaboration)]/8 text-[var(--collaboration)] border-[var(--collaboration)]/25">Prev. period</Badge>
                        )}
                      </div>
                      <div className="mt-1.5 flex flex-wrap items-center gap-x-4 text-[11px] text-muted-foreground">
                        <span className="flex items-center gap-1.5">
                          <Clock className="h-3 w-3" /> Next: {fmtDateTime(s.next_run)}
                        </span>
                        <span>To: {s.recipients.length ? s.recipients.join(", ") : "you"}</span>
                        {s.last_status && (
                          <span>Last: {s.last_status} ({fmtDateTime(s.last_run)})</span>
                        )}
                      </div>
                    </div>
                    <div className="flex shrink-0 items-center gap-2">
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => toggle(s)}
                        className={cn(
                          s.active
                            ? ""
                            : "border-emerald-500/30 bg-emerald-500/8 text-emerald-600 hover:bg-emerald-500/15",
                        )}
                      >
                        <Power className="h-3.5 w-3.5" /> {s.active ? "Pause" : "Resume"}
                      </Button>
                      <Button variant="destructive" size="sm" onClick={() => remove(s)} className="px-2.5">
                        <Trash2 className="h-3.5 w-3.5" />
                      </Button>
                    </div>
                  </CardContent>
                </Card>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
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
    <Card className="shadow-none">
      <CardContent className="grid gap-3 p-4 sm:grid-cols-2">
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
                <option key={d} value={i}>{d}</option>
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
              <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground pointer-events-none" />
              <input
                value={recipientSearch}
                onChange={(e) => handleRecipientSearch(e.target.value)}
                onFocus={() => recipientSearch.length >= 2 && setShowRecipientDrop(true)}
                onBlur={() => setTimeout(() => setShowRecipientDrop(false), 150)}
                placeholder="Search people by name or email… (blank = send to yourself)"
                className="w-full pl-8 pr-3 rounded-xl border border-border bg-background py-2 text-sm text-foreground"
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
                <Badge key={r.email} variant="secondary" className="gap-1 pr-1">
                  {r.name}
                  <button
                    type="button"
                    onClick={() => removeRecipient(r.email)}
                    className="text-muted-foreground hover:text-destructive ml-0.5"
                  >
                    <X className="h-3 w-3" />
                  </button>
                </Badge>
              ))}
            </div>
          )}
        </div>

        <div className="sm:col-span-2">
          <Button size="sm" onClick={submit} disabled={saving}>
            {saving ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <CheckCircle2 className="h-3.5 w-3.5" />}
            Save automation
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}

// ── Allocations tab ───────────────────────────────────────────────────────────

function AllocationsTab({ auth }: { auth: Record<string, string> }) {
  const [allocations, setAllocations] = useState<Allocation[]>([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState("");
  const [showActive, setShowActive] = useState(false);

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

  const grouped = useMemo(() => {
    const map = new Map<string, Allocation[]>();
    for (const a of filtered) {
      if (!map.has(a.employee_name)) map.set(a.employee_name, []);
      map.get(a.employee_name)!.push(a);
    }
    return map;
  }, [filtered]);

  // KPIs
  const totalMembers = grouped.size;
  const activeAllocations = allocations.filter((a) => a.completion_status === "Active");
  const uniqueActiveProjects = new Set(activeAllocations.map(a => a.project_name)).size;
  const avgEffort = activeAllocations.length
    ? Math.round(activeAllocations.reduce((sum, a) => sum + (a.efforts_percent || 0), 0) / activeAllocations.length)
    : 0;
  const avgBillability = activeAllocations.length
    ? Math.round(activeAllocations.reduce((sum, a) => sum + (a.billability_percent || 0), 0) / activeAllocations.length)
    : 0;

  if (loading) return <LoadingState label="Loading allocations…" />;

  return (
    <div className="space-y-6">
      {/* KPI Cards */}
      <div className="grid grid-cols-2 gap-3 sm:gap-4 lg:grid-cols-4">
        {[
          { label: "Team Members", value: totalMembers, color: "text-violet-500", bg: "bg-violet-500/10", border: "border-violet-500/20" },
          { label: "Active Projects", value: uniqueActiveProjects, color: "text-emerald-500", bg: "bg-emerald-500/10", border: "border-emerald-500/20" },
          { label: "Avg Effort", value: `${avgEffort}%`, color: "text-sky-500", bg: "bg-sky-500/10", border: "border-sky-500/20" },
          { label: "Avg Billability", value: `${avgBillability}%`, color: "text-amber-500", bg: "bg-amber-500/10", border: "border-amber-500/20" },
        ].map((c) => (
          <div key={c.label} className={cn("rounded-2xl border px-4 py-4 backdrop-blur-sm", c.border, c.bg)}>
            <p className={cn("text-[10.5px] font-bold uppercase tracking-[0.1em] mb-2", c.color)}>{c.label}</p>
            <p className="text-2xl sm:text-3xl font-extrabold text-foreground">{c.value}</p>
          </div>
        ))}
      </div>

      <Card>
        <CardContent className="p-3 sm:p-4 flex flex-col sm:flex-row gap-3">
          <div className="relative flex-1 min-w-0">
            <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground pointer-events-none" />
            <input
              value={filter}
              onChange={(e) => setFilter(e.target.value)}
              placeholder="Search by name, project, client…"
              className="w-full pl-9 pr-3 rounded-xl border border-border bg-background py-2 text-sm focus:outline-none focus:ring-1 focus:ring-[var(--collaboration)]"
            />
          </div>
          <div className="flex items-center">
            <label className="flex items-center gap-2 px-3 py-2 rounded-xl bg-muted/40 border border-border cursor-pointer select-none text-sm font-medium hover:bg-muted/60 transition-colors">
              <input
                type="checkbox"
                checked={showActive}
                onChange={(e) => setShowActive(e.target.checked)}
                className="rounded text-[var(--collaboration)] focus:ring-[var(--collaboration)]"
              />
              Show Active Only
            </label>
          </div>
        </CardContent>
      </Card>

      {grouped.size === 0 ? (
        <EmptyState label="No allocations found matching your criteria." />
      ) : (
        <div className="space-y-4">
          {[...grouped.entries()].map(([name, rows]) => {
            const uniqueProjectsCount = new Set(rows.map(r => r.project_name)).size;
            return (
              <ExpandableGroup key={name} title={name} count={uniqueProjectsCount} unit="project">
                <div className="grid gap-3 p-3 sm:grid-cols-2 xl:grid-cols-3 bg-muted/20 rounded-b-2xl border-t border-border/50">
                  {rows.map((a) => (
                    <Card key={a.id} className="shadow-none bg-background hover:shadow-md transition-all duration-200 border-border/80">
                      <CardContent className="p-4 flex flex-col h-full gap-3">
                        <div className="flex justify-between items-start gap-2">
                          <div className="min-w-0">
                            <h4 className="font-semibold text-sm text-foreground truncate" title={a.project_name}>
                              {a.project_name}
                            </h4>
                            {(a.client_master || a.sub_project) && (
                              <p className="text-xs text-muted-foreground mt-0.5 truncate flex items-center gap-1" title={a.client_master || a.sub_project || ""}>
                                <Building2 className="h-3 w-3 shrink-0" />
                                {a.client_master || a.sub_project}
                              </p>
                            )}
                          </div>
                          <Badge
                            variant={a.completion_status === "Active" ? "default" : "secondary"}
                            className={cn(
                              "shrink-0 text-[10px] px-1.5 py-0 font-bold uppercase tracking-wide",
                              a.completion_status === "Active"
                                ? "bg-emerald-500/10 text-emerald-600 border border-emerald-500/20"
                                : ""
                            )}
                          >
                            {a.completion_status}
                          </Badge>
                        </div>
                        
                        <div className="mt-auto space-y-3">
                          {a.efforts_percent != null && (
                            <div className="space-y-1.5">
                              <div className="flex justify-between text-[11px] font-medium">
                                <span className="text-muted-foreground uppercase tracking-wide">Effort</span>
                                <span className="text-foreground">{a.efforts_percent}%</span>
                              </div>
                              <Progress value={a.efforts_percent} className="h-1.5" />
                            </div>
                          )}
                          {a.billability_percent != null && (
                            <div className="space-y-1.5">
                              <div className="flex justify-between text-[11px] font-medium">
                                <span className="text-muted-foreground uppercase tracking-wide">Billable</span>
                                <span className="text-foreground">{a.billability_percent}%</span>
                              </div>
                              <Progress value={a.billability_percent} className="h-1.5" />
                            </div>
                          )}
                        </div>

                        <div className="pt-3 mt-1 border-t border-border flex justify-between items-center text-[11px] text-muted-foreground font-medium">
                          {a.project_type ? (
                            <span className="flex items-center gap-1.5">
                              <Briefcase className="h-3.5 w-3.5" /> {a.project_type}
                            </span>
                          ) : <span />}
                          <span className="flex items-center gap-1.5">
                            <CalendarIcon className="h-3.5 w-3.5" /> {fmtDate(a.expected_end_date) || "No end date"}
                          </span>
                        </div>
                      </CardContent>
                    </Card>
                  ))}
                </div>
              </ExpandableGroup>
            );
          })}
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
    <div className="space-y-4">
      <div className="relative max-w-sm">
        <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground pointer-events-none" />
        <input
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
          placeholder="Filter by name, skill…"
          className="w-full pl-8 pr-3 rounded-xl border border-border bg-background py-2 text-sm"
        />
      </div>
      {grouped.size === 0 ? (
        <EmptyState label="No skills on record for your team." />
      ) : (
        <div className="space-y-4">
          {[...grouped.entries()].map(([name, rows]) => (
            <ExpandableGroup key={name} title={name} count={rows.length} unit="skill">
              <div className="flex flex-wrap gap-1.5 px-3 pb-3">
                {rows.map((s, i) => (
                  <span
                    key={i}
                    className={cn(
                      "inline-flex items-center gap-1 rounded-lg border px-2 py-1 text-[11px] font-medium normal-case tracking-normal",
                      s.is_primary
                        ? "border-[var(--collaboration)]/30 bg-[var(--collaboration)]/8 text-[var(--collaboration)]"
                        : "border-border bg-card/50 text-foreground",
                    )}
                  >
                    {s.skill}
                    {s.is_primary && (
                      <span className="text-[9px] font-bold uppercase opacity-60">Primary</span>
                    )}
                    {s.years_experience != null && (
                      <span className="text-[10px] text-muted-foreground">{s.years_experience}y</span>
                    )}
                    {s.certification && (
                      <span className="text-[10px] text-muted-foreground">· {s.certification}</span>
                    )}
                  </span>
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
    <div className="space-y-4">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <p className="text-sm text-muted-foreground">
          Initiate client-side onboarding for team members. Email notification is sent to PMO.
        </p>
        <Button size="sm" onClick={() => setShowForm((v) => !v)} className="w-full sm:w-auto">
          <Plus className="h-3.5 w-3.5" /> New Request
        </Button>
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
              <Card key={r.id}>
                <CardContent className="p-4">
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="font-semibold text-foreground">{r.employee_name}</span>
                        <span className="text-[11px] text-muted-foreground">{r.ref_id}</span>
                        <Badge
                          className={cn(STATUS_COLORS[r.status] ?? "bg-muted text-muted-foreground")}
                        >
                          {r.status}
                        </Badge>
                      </div>
                      {r.employee_email && (
                        <div className="text-[11px] text-muted-foreground mt-0.5">{r.employee_email}</div>
                      )}
                      <div className="mt-1.5 flex flex-wrap gap-1.5">
                        {activeSteps.map((s) => (
                          <Badge key={s} variant="secondary">{s}</Badge>
                        ))}
                        {r.client_name && (
                          <Badge className="bg-[var(--collaboration)]/5 text-[var(--collaboration)] border-[var(--collaboration)]/30">
                            Client: {r.client_name}
                          </Badge>
                        )}
                      </div>
                      {r.notes && (
                        <p className="mt-1.5 text-[11px] text-muted-foreground">{r.notes}</p>
                      )}
                      <p className="mt-1 text-[11px] text-muted-foreground">{fmtDate(r.created_at)}</p>
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
                </CardContent>
              </Card>
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
    <Card>
      <CardContent className="p-4 space-y-4">
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
                <option key={m.id} value={m.name}>{m.name}</option>
              ))}
            </select>
          </label>
          <label className="text-xs font-medium text-muted-foreground">
            <span className="flex items-center gap-1.5">
              Employee email
              {emailAutoFilled && (
                <span className="text-[10px] font-semibold text-[var(--collaboration)]">auto-filled</span>
              )}
            </span>
            <input
              value={employeeEmail}
              onChange={(e) => { setEmployeeEmail(e.target.value); setEmailAutoFilled(false); }}
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
              { key: "client", label: "Client-Side Onboarding", val: clientOnboarding, set: setClientOnboarding },
            ].map(({ key, label, val, set }) => (
              <label key={key} className="flex items-center gap-2 cursor-pointer select-none text-sm">
                <input type="checkbox" checked={val} onChange={(e) => set(e.target.checked)} className="rounded" />
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

        <Button size="sm" onClick={submit} disabled={saving}>
          {saving ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <CheckCircle2 className="h-3.5 w-3.5" />}
          Submit onboarding request
        </Button>
      </CardContent>
    </Card>
  );
}

// ── PMO Requests tab ──────────────────────────────────────────────────────────

function PMORequestsTab({
  auth,
  team,
  access,
}: {
  auth: Record<string, string>;
  team: TeamMember[];
  access: ManagerAccess;
}) {
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
    <div className="space-y-4">
      <div className="flex flex-col sm:flex-row sm:items-center gap-3">
        <p className="flex-1 text-sm text-muted-foreground">
          Submit VDI or access requests to PMO. Email notification is sent automatically.
        </p>
        <div className="flex flex-wrap gap-2">
          {access.can_vdi_provision && (
            <Button
              variant={showForm === "vdi_provision" ? "default" : "outline"}
              size="sm"
              onClick={() => setShowForm(showForm === "vdi_provision" ? null : "vdi_provision")}
              className="w-full sm:w-auto"
            >
              <Server className="h-3.5 w-3.5" /> Request VDI
            </Button>
          )}
          {access.can_vdi_revoke && (
            <Button
              variant={showForm === "vdi_revoke" ? "destructive" : "outline"}
              size="sm"
              onClick={() => setShowForm(showForm === "vdi_revoke" ? null : "vdi_revoke")}
              className="w-full sm:w-auto"
            >
              <ShieldX className="h-3.5 w-3.5" /> Revoke Access
            </Button>
          )}
        </div>
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
            <Card key={r.id}>
              <CardContent className="p-4">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <div className="flex items-center gap-2 flex-wrap">
                      <Badge
                        className={cn(
                          "gap-1",
                          r.request_type === "vdi_provision"
                            ? "bg-blue-500/10 text-blue-600 border-blue-500/20"
                            : "bg-red-500/10 text-red-600 border-red-500/20",
                        )}
                      >
                        {r.request_type === "vdi_provision" ? (
                          <Server className="h-3 w-3" />
                        ) : (
                          <ShieldX className="h-3 w-3" />
                        )}
                        {r.request_type_label}
                      </Badge>
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
                  <Badge className={cn(STATUS_COLORS[r.status] ?? "bg-muted text-muted-foreground")}>
                    {r.status}
                  </Badge>
                </div>
              </CardContent>
            </Card>
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
    <Card className={isRevoke ? "border-destructive/30 bg-destructive/5" : "border-blue-500/30 bg-blue-500/5"}>
      <CardContent className="p-4 space-y-3">
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
                <option key={m.id} value={m.name}>{m.name}</option>
              ))}
            </select>
          </label>
          <label className="text-xs font-medium text-muted-foreground">
            <span className="flex items-center gap-1.5">
              Employee email
              {emailAutoFilled && (
                <span className="text-[10px] font-semibold text-[var(--collaboration)]">auto-filled</span>
              )}
            </span>
            <input
              value={employeeEmail}
              onChange={(e) => { setEmployeeEmail(e.target.value); setEmailAutoFilled(false); }}
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
        <Button
          size="sm"
          variant={isRevoke ? "destructive" : "default"}
          onClick={submit}
          disabled={saving}
        >
          {saving ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <CheckCircle2 className="h-3.5 w-3.5" />}
          Submit to PMO
        </Button>
      </CardContent>
    </Card>
  );
}

// ── Readiness tab ──────────────────────────────────────────────────────────────

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
  suggested_course_id: number | null;
  employee_id: number | null;
}
interface ReadinessResult {
  ok: boolean;
  message?: string;
  required_skills?: string[];
  summary?: { ready: number; one_course_away: number; gap: number };
  rows?: ReadinessRow[];
}
interface ForecastItem {
  name: string;
  date?: string;
  free?: number;
  load?: number;
  projects?: string[];
}
interface Insights {
  ok: boolean;
  team_size: number;
  capacity?: {
    avg_load: number;
    fully_utilized: number;
    overloaded: number;
    on_bench: number;
    available: number;
    forecast: {
      free_now: ForecastItem[];
      in_30: ForecastItem[];
      in_60: ForecastItem[];
      in_90: ForecastItem[];
    };
  };
  skills?: {
    total_distinct: number;
    top: { skill: string; count: number; holders: string[] }[];
    single_points: { skill: string; holder: string }[];
    single_points_total: number;
  };
  attention?: {
    name: string;
    severity: number;
    kind: string;
    issue: string;
    detail: string;
    action: string;
  }[];
  readiness_score?: {
    name: string;
    email: string | null;
    score: number;
    band: "high" | "medium" | "low";
    free_pct: number;
    skills_count: number;
    overdue: number;
    due_soon: number;
  }[];
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
  const [insights, setInsights] = useState<Insights | null>(null);
  const [loading, setLoading] = useState(true);
  const [skills, setSkills] = useState("");
  const [result, setResult] = useState<ReadinessResult | null>(null);
  const [checking, setChecking] = useState(false);
  const [acting, setActing] = useState<string | null>(null);
  const [assignDialogUser, setAssignDialogUser] = useState<ReadinessRow | null>(null);

  useEffect(() => {
    Promise.all([
      fetch("/api/portal/manager/team/digest", { headers: auth })
        .then((r) => r.json())
        .then((d) => setDigest(d))
        .catch(() => setDigest(null)),
      fetch("/api/portal/manager/team/readiness-insights", { headers: auth })
        .then((r) => r.json())
        .then((d) => setInsights(d))
        .catch(() => setInsights(null)),
    ]).finally(() => setLoading(false));
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

  const handleAssign = async (r: ReadinessRow) => {
    if (!r.suggested_course_id || !r.employee_id) return;
    setActing(r.name);
    try {
      const res = await fetch("/api/portal/manager/team/readiness/assign", {
        method: "POST",
        headers: { ...auth, "Content-Type": "application/json" },
        body: JSON.stringify({
          employee_id: r.employee_id,
          email: r.email,
          training_id: r.suggested_course_id,
          due_date: new Date(Date.now() + 14 * 86400000).toISOString().split('T')[0],
        }),
      });
      if (!res.ok) throw new Error((await res.json().catch(() => ({}))).detail || "Failed");
      flyBanner(`Assigned ${r.suggested_course} to ${r.name}`);
    } catch (e: any) {
      toast.error(e.message || "Failed to assign training");
    } finally {
      setActing(null);
    }
  };

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
      {/* Capacity health + availability forecast */}
      <CapacityStrip insights={insights} />

      {/* Attention needed roll-up */}
      <AttentionRollup insights={insights} />

      {/* Weekly digest */}
      <div>
        <h2 className="mb-3 text-sm font-bold text-foreground flex items-center gap-2">
          <Gauge className="h-4 w-4 text-[var(--collaboration)]" />
          Weekly Team Digest
          <span className="text-xs font-normal text-muted-foreground">
            ({digest?.team_size ?? 0} in hierarchy)
          </span>
        </h2>
        <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-4">
          {sections.map((s) => {
            const items = (digest?.[s.key] as DigestItem[]) ?? [];
            const Icon = s.icon;
            return (
              <Card key={s.key} className="shadow-none">
                <CardContent className="p-4">
                  <div className="flex items-center justify-between gap-2 mb-2">
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
                </CardContent>
              </Card>
            );
          })}
        </div>
      </div>

      {/* Skill coverage & risk */}
      <SkillCoverage insights={insights} />

      {/* Readiness score leaderboard */}
      <ReadinessLeaderboard insights={insights} />

      {/* Project readiness checker */}
      <Card>
        <CardContent className="p-4">
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
              className="flex-1 min-w-0 rounded-xl border border-border bg-background px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-primary"
            />
            <Button
              size="sm"
              onClick={check}
              disabled={checking || !skills.trim()}
              className="shrink-0"
            >
              {checking ? <Loader2 className="h-4 w-4 animate-spin" /> : <Gauge className="h-4 w-4" />}
              <span className="hidden sm:inline">Check</span>
            </Button>
          </div>

          {result && result.ok && (
            <div className="mt-4">
              <div className="flex flex-wrap gap-2 mb-3">
                <Badge className="bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border-emerald-500/20">
                  Ready {result.summary?.ready ?? 0}
                </Badge>
                <Badge className="bg-amber-500/10 text-amber-600 dark:text-amber-400 border-amber-500/20">
                  One course away {result.summary?.one_course_away ?? 0}
                </Badge>
                <Badge className="bg-rose-500/10 text-rose-600 dark:text-rose-400 border-rose-500/20">
                  Gap {result.summary?.gap ?? 0}
                </Badge>
              </div>
              <div className="space-y-1.5">
                {(result.rows ?? []).map((r) => (
                  <div
                    key={r.name}
                    className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 rounded-xl border border-border bg-background px-3 py-2 text-xs"
                  >
                    <div className="min-w-0">
                      <span className="font-semibold text-foreground">{r.name}</span>
                      <span className="text-muted-foreground/70 ml-2">{r.free_pct}% free</span>
                      {r.suggested_course ? (
                        <span className="text-amber-600 dark:text-amber-400 ml-2 flex items-center gap-1.5 mt-1 sm:mt-0 sm:inline-flex">
                          → {r.suggested_course}
                          {r.suggested_course_id && (
                            <Button 
                              size="icon" 
                              variant="ghost" 
                              className="h-5 w-5 rounded-full hover:bg-amber-500/10 text-amber-600" 
                              onClick={() => handleAssign(r)} 
                              title="Assign Training"
                              disabled={acting === r.name}
                            >
                              {acting === r.name ? <Loader2 className="h-3 w-3 animate-spin" /> : <Plus className="h-3 w-3" />}
                            </Button>
                          )}
                        </span>
                      ) : (r.status === "gap" || r.status === "one_course_away") && (
                        <Button
                          size="sm"
                          variant="outline"
                          className="ml-2 h-6 text-xs text-amber-600 border-amber-600/30 hover:bg-amber-600/10"
                          onClick={() => setAssignDialogUser(r)}
                        >
                          Assign Training...
                        </Button>
                      )}
                      {r.missing_skills.length > 0 && (
                        <span className="text-muted-foreground/60 ml-2">
                          missing: {r.missing_skills.join(", ")}
                        </span>
                      )}
                    </div>
                    <Badge className={cn("shrink-0", READINESS_BADGE[r.status])}>
                      {READINESS_LABEL[r.status]}
                    </Badge>
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
        </CardContent>
      </Card>
      <AssignTrainingDialog
        isOpen={!!assignDialogUser}
        onClose={() => setAssignDialogUser(null)}
        employee={assignDialogUser}
        authHeaders={auth}
        onSuccess={() => {
          // Re-fetch digest or just rely on state if needed
        }}
      />
    </div>
  );
}

// ── Readiness: capacity health + availability forecast ────────────────────────

function CapacityStrip({ insights }: { insights: Insights | null }) {
  const c = insights?.capacity;
  if (!c) return null;
  const tiles = [
    { label: "Avg Load", value: `${c.avg_load}%`, color: "text-violet-500", bg: "bg-violet-500/10", border: "border-violet-500/20" },
    { label: "Fully Utilized", value: c.fully_utilized, color: "text-emerald-500", bg: "bg-emerald-500/10", border: "border-emerald-500/20" },
    { label: "Overloaded", value: c.overloaded, color: "text-rose-500", bg: "bg-rose-500/10", border: "border-rose-500/20" },
    { label: "On Bench", value: c.on_bench, color: "text-sky-500", bg: "bg-sky-500/10", border: "border-sky-500/20" },
    { label: "Available Now", value: c.available, color: "text-amber-500", bg: "bg-amber-500/10", border: "border-amber-500/20" },
  ];
  const buckets = [
    { key: "in_30" as const, label: "Next 30 days" },
    { key: "in_60" as const, label: "31–60 days" },
    { key: "in_90" as const, label: "61–90 days" },
  ];
  const hasForecast = buckets.some((b) => (c.forecast?.[b.key]?.length ?? 0) > 0);

  return (
    <div>
      <h2 className="mb-3 text-sm font-bold text-foreground flex items-center gap-2">
        <Gauge className="h-4 w-4 text-[var(--collaboration)]" />
        Team Capacity
      </h2>
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3 sm:gap-4">
        {tiles.map((t) => (
          <div key={t.label} className={cn("rounded-2xl border px-4 py-4 backdrop-blur-sm", t.border, t.bg)}>
            <p className={cn("text-[10.5px] font-bold uppercase tracking-[0.1em] mb-2", t.color)}>{t.label}</p>
            <p className="text-2xl sm:text-3xl font-extrabold text-foreground">{t.value}</p>
          </div>
        ))}
      </div>

      {/* Availability forecast */}
      <Card className="mt-4 shadow-none">
        <CardContent className="p-4">
          <div className="flex items-center gap-2 mb-3">
            <CalendarClock className="h-4 w-4 text-[var(--collaboration)]" />
            <span className="text-xs font-bold text-foreground">Coming available (roll-off forecast)</span>
          </div>
          {!hasForecast ? (
            <p className="text-xs text-muted-foreground/70">
              No upcoming roll-offs in the next 90 days.
              {c.available > 0 ? ` ${c.available} people are available right now.` : ""}
            </p>
          ) : (
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
              {buckets.map((b) => {
                const items = c.forecast?.[b.key] ?? [];
                return (
                  <div key={b.key} className="rounded-xl border border-border bg-background/60 p-3">
                    <div className="flex items-center justify-between mb-2">
                      <span className="text-[11px] font-bold uppercase tracking-wide text-muted-foreground">{b.label}</span>
                      <span className="text-sm font-black text-foreground">{items.length}</span>
                    </div>
                    {items.length === 0 ? (
                      <p className="text-[11px] text-muted-foreground/60">—</p>
                    ) : (
                      <ul className="space-y-1">
                        {items.slice(0, 6).map((it, i) => (
                          <li key={i} className="text-[11px] text-foreground/90 flex justify-between gap-2">
                            <span className="truncate">{it.name}</span>
                            <span className="text-muted-foreground/70 font-mono text-[10px] whitespace-nowrap">{it.date}</span>
                          </li>
                        ))}
                        {items.length > 6 && (
                          <li className="text-[10px] text-muted-foreground/60">+{items.length - 6} more</li>
                        )}
                      </ul>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

// ── Readiness: prioritised attention roll-up ──────────────────────────────────

const ATTN_TONE: Record<number, string> = {
  3: "bg-rose-500/10 text-rose-600 dark:text-rose-400 border-rose-500/20",
  2: "bg-amber-500/10 text-amber-600 dark:text-amber-400 border-amber-500/20",
  1: "bg-sky-500/10 text-sky-600 dark:text-sky-400 border-sky-500/20",
};
const ATTN_DOT: Record<number, string> = { 3: "bg-rose-500", 2: "bg-amber-500", 1: "bg-sky-500" };

function AttentionRollup({ insights }: { insights: Insights | null }) {
  const [showAll, setShowAll] = useState(false);
  const items = insights?.attention ?? [];
  if (!insights) return null;

  const shown = showAll ? items : items.slice(0, 8);
  return (
    <Card className="shadow-none">
      <CardContent className="p-4">
        <div className="flex items-center justify-between gap-2 mb-3">
          <span className="text-sm font-bold text-foreground flex items-center gap-2">
            <AlertCircle className="h-4 w-4 text-rose-500" />
            Attention Needed
          </span>
          <Badge variant="secondary" className="text-xs">{items.length}</Badge>
        </div>
        {items.length === 0 ? (
          <p className="text-xs text-muted-foreground/70 flex items-center gap-1.5">
            <CheckCircle2 className="h-3.5 w-3.5 text-emerald-500" />
            All clear — nothing needs your attention this week.
          </p>
        ) : (
          <>
            <ul className="space-y-1.5">
              {shown.map((a, i) => (
                <li
                  key={i}
                  className="flex flex-col sm:flex-row sm:items-center justify-between gap-1.5 rounded-xl border border-border bg-background px-3 py-2"
                >
                  <div className="flex items-start gap-2 min-w-0">
                    <span className={cn("mt-1.5 h-1.5 w-1.5 rounded-full shrink-0", ATTN_DOT[a.severity])} />
                    <div className="min-w-0">
                      <span className="text-xs font-semibold text-foreground">{a.name}</span>
                      <span className="text-xs text-foreground/80 ml-2">{a.issue}</span>
                      <span className="text-[11px] text-muted-foreground/70 ml-2">{a.detail}</span>
                    </div>
                  </div>
                  <Badge className={cn("shrink-0 text-[10px]", ATTN_TONE[a.severity])}>{a.action}</Badge>
                </li>
              ))}
            </ul>
            {items.length > 8 && (
              <button
                onClick={() => setShowAll((s) => !s)}
                className="mt-2 text-[11px] font-medium text-primary hover:underline"
              >
                {showAll ? "Show less" : `Show all ${items.length}`}
              </button>
            )}
          </>
        )}
      </CardContent>
    </Card>
  );
}

// ── Readiness: skill coverage & single-points-of-failure ──────────────────────

function SkillCoverage({ insights }: { insights: Insights | null }) {
  const s = insights?.skills;
  if (!s || s.total_distinct === 0) return null;
  const maxCount = Math.max(1, ...s.top.map((t) => t.count));

  return (
    <Card className="shadow-none">
      <CardContent className="p-4">
        <div className="flex items-center justify-between gap-2 mb-3">
          <span className="text-sm font-bold text-foreground flex items-center gap-2">
            <Wrench className="h-4 w-4 text-[var(--collaboration)]" />
            Skill Coverage &amp; Risk
          </span>
          <span className="text-xs text-muted-foreground">{s.total_distinct} distinct skills</span>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          {/* Coverage bars */}
          <div>
            <p className="text-[11px] font-bold uppercase tracking-wide text-muted-foreground mb-2">
              Most-covered skills
            </p>
            <div className="space-y-1.5">
              {s.top.map((t) => (
                <div key={t.skill} className="flex items-center gap-2" title={t.holders.join(", ")}>
                  <span className="w-32 shrink-0 truncate text-xs text-foreground/90">{t.skill}</span>
                  <div className="flex-1 h-4 rounded-full bg-muted overflow-hidden">
                    <div
                      className="h-full rounded-full bg-[var(--collaboration)]/70"
                      style={{ width: `${(t.count / maxCount) * 100}%` }}
                    />
                  </div>
                  <span className="w-6 text-right text-xs font-bold text-foreground">{t.count}</span>
                </div>
              ))}
            </div>
          </div>

          {/* Single points of failure */}
          <div>
            <p className="text-[11px] font-bold uppercase tracking-wide text-rose-600 dark:text-rose-400 mb-2 flex items-center gap-1.5">
              <ShieldX className="h-3.5 w-3.5" />
              Single points of failure ({s.single_points_total})
            </p>
            {s.single_points.length === 0 ? (
              <p className="text-xs text-muted-foreground/70">
                No bus-factor risks — every team skill is held by at least two people.
              </p>
            ) : (
              <>
                <p className="text-[11px] text-muted-foreground/70 mb-2">
                  Only one person on the team holds each of these — a leave or exit leaves a gap.
                </p>
                <div className="flex flex-wrap gap-1.5">
                  {s.single_points.map((sp) => (
                    <span
                      key={sp.skill}
                      title={`Only ${sp.holder} has this`}
                      className="inline-flex items-center gap-1 rounded-full border border-rose-500/20 bg-rose-500/10 px-2.5 py-0.5 text-[11px] text-rose-600 dark:text-rose-400"
                    >
                      {sp.skill}
                      <span className="text-rose-500/60">· {sp.holder.split(" ")[0]}</span>
                    </span>
                  ))}
                </div>
              </>
            )}
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

// ── Readiness: per-person readiness-score leaderboard ─────────────────────────

const BAND_TONE: Record<string, string> = {
  high: "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border-emerald-500/20",
  medium: "bg-amber-500/10 text-amber-600 dark:text-amber-400 border-amber-500/20",
  low: "bg-rose-500/10 text-rose-600 dark:text-rose-400 border-rose-500/20",
};
const BAND_BAR: Record<string, string> = { high: "bg-emerald-500", medium: "bg-amber-500", low: "bg-rose-500" };

function ReadinessLeaderboard({ insights }: { insights: Insights | null }) {
  const [showAll, setShowAll] = useState(false);
  const rows = insights?.readiness_score ?? [];
  if (!insights || rows.length === 0) return null;

  const shown = showAll ? rows : rows.slice(0, 10);
  return (
    <Card className="shadow-none">
      <CardContent className="p-4">
        <div className="flex items-center justify-between gap-2 mb-1">
          <span className="text-sm font-bold text-foreground flex items-center gap-2">
            <Trophy className="h-4 w-4 text-[var(--collaboration)]" />
            Deployment Readiness
          </span>
          <span className="text-xs text-muted-foreground">availability · skills · training</span>
        </div>
        <p className="text-[11px] text-muted-foreground/70 mb-3">
          Composite score of how deployment-ready each person is: capacity to take work, skill
          breadth, and training currency.
        </p>
        <div className="space-y-1.5">
          {shown.map((r, i) => (
            <div
              key={r.email || r.name}
              className="flex items-center gap-3 rounded-xl border border-border bg-background px-3 py-2"
            >
              <span className="w-5 shrink-0 text-center text-xs font-bold text-muted-foreground">{i + 1}</span>
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2">
                  <span className="text-xs font-semibold text-foreground truncate">{r.name}</span>
                  {r.overdue > 0 && (
                    <span className="text-[10px] text-rose-500 whitespace-nowrap">{r.overdue} overdue</span>
                  )}
                </div>
                <div className="mt-1 flex items-center gap-2">
                  <div className="flex-1 h-1.5 rounded-full bg-muted overflow-hidden max-w-[220px]">
                    <div className={cn("h-full rounded-full", BAND_BAR[r.band])} style={{ width: `${r.score}%` }} />
                  </div>
                  <span className="text-[10px] text-muted-foreground/70 whitespace-nowrap">
                    {r.free_pct}% free · {r.skills_count} skills
                  </span>
                </div>
              </div>
              <div className="flex items-center gap-2 shrink-0">
                <span className="text-sm font-black text-foreground tabular-nums">{r.score}</span>
                <Badge className={cn("text-[10px] capitalize", BAND_TONE[r.band])}>{r.band}</Badge>
              </div>
            </div>
          ))}
        </div>
        {rows.length > 10 && (
          <button
            onClick={() => setShowAll((s) => !s)}
            className="mt-2 text-[11px] font-medium text-primary hover:underline"
          >
            {showAll ? "Show less" : `Show all ${rows.length}`}
          </button>
        )}
      </CardContent>
    </Card>
  );
}

// ── Shared helpers ────────────────────────────────────────────────────────────

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
  const [open, setOpen] = useState(false);
  return (
    <Card className="overflow-hidden">
      <button
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-center justify-between px-3 sm:px-4 py-2.5 sm:py-3 text-left hover:bg-muted/30 transition-colors"
      >
        <div className="flex items-center gap-2 min-w-0">
          <span className="text-sm font-semibold text-foreground truncate">{title}</span>
          <Badge variant="secondary" className="shrink-0">
            {count} {unit}{count !== 1 ? "s" : ""}
          </Badge>
        </div>
        {open ? (
          <ChevronUp className="h-4 w-4 text-muted-foreground" />
        ) : (
          <ChevronDown className="h-4 w-4 text-muted-foreground" />
        )}
      </button>
      {open && children}
    </Card>
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
      flyBanner("Appreciation added!");
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

  const grouped = list.reduce<Record<string, AppreciationRow[]>>((acc, r) => {
    (acc[r.employee_email] = acc[r.employee_email] || []).push(r);
    return acc;
  }, {});

  return (
    <div className="space-y-5">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div>
          <p className="text-sm font-semibold text-foreground">Client Appreciations</p>
          <p className="text-xs text-muted-foreground mt-0.5">
            Record email appreciations received from clients and tag the employee. Screenshots
            appear in their People Directory profile.
          </p>
        </div>
        <Button
          size="sm"
          onClick={() => setShowForm((v) => !v)}
          className="bg-amber-500 hover:bg-amber-600 border-amber-500 w-full sm:w-auto"
        >
          <Plus className="h-3.5 w-3.5" /> Add Appreciation
        </Button>
      </div>

      {/* Add Form */}
      {showForm && (
        <Card className="border-amber-200 dark:border-amber-500/30 bg-amber-50/60 dark:bg-amber-500/5">
          <CardContent className="p-5 space-y-4">
            <div className="flex items-center justify-between">
              <p className="text-sm font-semibold text-foreground flex items-center gap-2">
                <Trophy className="h-4 w-4 text-amber-500" /> New Appreciation
              </p>
              <Button variant="ghost" size="icon" onClick={() => setShowForm(false)} className="h-7 w-7">
                <X className="h-4 w-4" />
              </Button>
            </div>

            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <label className="text-xs font-medium text-muted-foreground">
                Employee Email *
                <div className="relative mt-1">
                  <input
                    value={fEmployeeEmail}
                    onChange={(e) => { setFEmployeeEmail(e.target.value); autoFillFromTeam(e.target.value); }}
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
                    onClick={() => { setFFile(null); setFPreview(null); if (fileRef.current) fileRef.current.value = ""; }}
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

            <div className="flex flex-col sm:flex-row justify-end gap-2 pt-1">
              <Button variant="outline" size="sm" onClick={() => setShowForm(false)} className="w-full sm:w-auto">
                Cancel
              </Button>
              <Button
                size="sm"
                onClick={submit}
                disabled={saving}
                className="bg-amber-500 hover:bg-amber-600 border-amber-500 w-full sm:w-auto"
              >
                {saving ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Trophy className="h-3.5 w-3.5" />}
                Save Appreciation
              </Button>
            </div>
          </CardContent>
        </Card>
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
            <Card key={email} className="overflow-hidden">
              <div className="flex items-center gap-3 border-b border-border px-4 py-3 bg-muted/20">
                <div className="h-8 w-8 rounded-full bg-amber-500/10 text-amber-600 flex items-center justify-center text-[13px] font-bold">
                  {(rows[0].employee_name || "?")
                    .split(" ")
                    .map((n) => n[0])
                    .join("")
                    .slice(0, 2)
                    .toUpperCase()}
                </div>
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-semibold text-foreground truncate">{rows[0].employee_name}</p>
                  <p className="text-xs text-muted-foreground truncate">{email}</p>
                </div>
                <Badge className="bg-amber-500/10 text-amber-600 dark:text-amber-400 border-amber-500/20 gap-1 shrink-0">
                  <Trophy className="h-3 w-3" /> {rows.length} appreciation{rows.length > 1 ? "s" : ""}
                </Badge>
              </div>
              <div className="divide-y divide-border">
                {rows.map((r) => (
                  <div key={r.id} className="flex items-start gap-3 sm:gap-4 px-4 py-4">
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <p className="text-sm font-semibold text-foreground">{r.title}</p>
                        {r.client_name && (
                          <Badge className="bg-amber-500/10 text-amber-700 dark:text-amber-400 border-amber-500/20 gap-1">
                            <Building2 className="h-2.5 w-2.5" />
                            {r.client_name}
                          </Badge>
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
                            src={apiUrl(`/api/appreciations/${r.id}/screenshot`)}
                            alt="Screenshot"
                            className="h-12 w-16 object-cover"
                          />
                          <div className="absolute inset-0 bg-black/0 group-hover:bg-black/20 transition-colors flex items-center justify-center">
                            <ZoomIn className="h-3.5 w-3.5 text-white opacity-0 group-hover:opacity-100 transition-opacity" />
                          </div>
                        </button>
                      )}
                      <Button
                        variant="ghost"
                        size="icon"
                        onClick={() => setAppreciationToDelete(r.id)}
                        className="h-8 w-8 text-muted-foreground hover:text-destructive hover:bg-destructive/10"
                        title="Delete"
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </Button>
                    </div>
                  </div>
                ))}
              </div>
            </Card>
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
              onClick={(e) => { e.stopPropagation(); setLightboxSrc(null); }}
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
