import { useAuth } from "@/lib/auth-store";
import { useState, useEffect, useCallback, useMemo } from "react";
import {
  UserCog, Users, CalendarClock, Mail, Download, Loader2, RefreshCw,
  AlertCircle, CheckCircle2, Plus, Trash2, Clock, Power,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { toast } from "sonner";
import { flyBanner } from "@/lib/fly-banner";

interface Member {
  employee: string; email: string; department: string; designation: string;
  reports_to: string; present: number; absent: number; wfh: number; late: number; half_day: number;
}
interface TeamReport {
  success: boolean; error?: string; message?: string;
  manager?: string; period?: string; month?: number; year?: number; headcount?: number;
  members?: Member[];
  totals?: { present: number; absent: number; wfh: number; late: number; half_day: number };
}
interface Schedule {
  id: number; frequency: string; day_of_week: number | null; day_of_month: number | null;
  hour: number; recipients: string[]; period_mode: string; active: boolean;
  next_run: string | null; last_run: string | null; last_status: string | null;
}

const MONTHS = ["January","February","March","April","May","June","July","August","September","October","November","December"];
const DOW = ["Monday","Tuesday","Wednesday","Thursday","Friday","Saturday","Sunday"];

function fmtDateTime(iso: string | null) {
  if (!iso) return "—";
  const d = new Date(iso);
  return d.toLocaleString("en-IN", { day: "numeric", month: "short", hour: "numeric", minute: "2-digit", hour12: true });
}

function describeCadence(s: Schedule): string {
  const at = `${s.hour % 12 || 12}${s.hour >= 12 ? "PM" : "AM"}`;
  if (s.frequency === "daily") return `Every weekday at ${at}`;
  if (s.frequency === "weekly") return `Every ${DOW[s.day_of_week ?? 0]} at ${at}`;
  if (s.frequency === "monthly") return `Monthly on day ${s.day_of_month ?? 1} at ${at}`;
  if (s.day_of_week != null) return `Every ${DOW[s.day_of_week]} at ${at}`;
  if (s.day_of_month != null) return `Monthly on day ${s.day_of_month} at ${at}`;
  return `Custom at ${at}`;
}

export function ManagerPortal() {
  const { user } = useAuth();
  const auth = useMemo(
    () => ({ "x-user-email": user?.email ?? "", "x-user-role": (user?.role ?? "").toLowerCase() }),
    [user?.email, user?.role]
  );

  const now = new Date();
  const [month, setMonth] = useState(now.getMonth() + 1);
  const [year, setYear] = useState(now.getFullYear());

  const [report, setReport] = useState<TeamReport | null>(null);
  const [loading, setLoading] = useState(true);
  const [emailing, setEmailing] = useState(false);

  const loadReport = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch(`/api/portal/manager/attendance?month=${month}&year=${year}`, { headers: auth });
      const data = await res.json().catch(() => ({}));
      if (res.status === 403) { setReport({ success: false, message: "This area is for Functional Managers only." }); return; }
      setReport(data);
    } catch {
      setReport({ success: false, message: "Could not reach the server." });
    } finally {
      setLoading(false);
    }
  }, [auth, month, year]);

  useEffect(() => { loadReport(); }, [loadReport]);

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
        toast.error("Could not send the email — is your Microsoft account connected?");
      }
    } catch {
      toast.error("Could not reach the server.");
    } finally {
      setEmailing(false);
    }
  };

  const downloadCsv = () => {
    if (!report?.success || !report.members) return;
    const head = ["Employee","Email","Department","Designation","Reports To","Present","Absent","WFH","Late","Half-day"];
    const rows = report.members.map(m =>
      [m.employee, m.email, m.department, m.designation, m.reports_to, m.present, m.absent, m.wfh, m.late, m.half_day]
        .map(v => `"${String(v ?? "").replace(/"/g, '""')}"`).join(",")
    );
    const t = report.totals!;
    rows.push(["TOTAL","","","","",t.present,t.absent,t.wfh,t.late,t.half_day].map(v => `"${v}"`).join(","));
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
    <div className="mx-auto w-full max-w-6xl px-4 py-6">
      {/* Header */}
      <div className="mb-6 flex items-center gap-3">
        <div className="flex h-11 w-11 items-center justify-center rounded-2xl bg-[var(--collaboration)]/15">
          <UserCog className="h-5 w-5 text-[var(--collaboration)]" />
        </div>
        <div>
          <h1 className="text-xl font-bold text-foreground">Manager Portal</h1>
          <p className="text-sm text-muted-foreground">Whole-hierarchy attendance for everyone reporting up to you.</p>
        </div>
      </div>

      {/* Controls */}
      <div className="mb-5 flex flex-wrap items-center gap-2">
        <select value={month} onChange={e => setMonth(Number(e.target.value))}
          className="rounded-xl border border-border bg-background px-3 py-2 text-sm">
          {MONTHS.map((m, i) => <option key={m} value={i + 1}>{m}</option>)}
        </select>
        <select value={year} onChange={e => setYear(Number(e.target.value))}
          className="rounded-xl border border-border bg-background px-3 py-2 text-sm">
          {[year - 1, year, year + 1].filter((v, i, a) => a.indexOf(v) === i).map(y => <option key={y} value={y}>{y}</option>)}
        </select>
        <button onClick={loadReport}
          className="flex items-center gap-1.5 rounded-xl border border-border bg-background px-3 py-2 text-sm font-medium hover:bg-muted">
          <RefreshCw className="h-3.5 w-3.5" /> Refresh
        </button>
        <div className="flex-1" />
        <button onClick={downloadCsv} disabled={!report?.success}
          className="flex items-center gap-1.5 rounded-xl border border-border bg-background px-3 py-2 text-sm font-medium hover:bg-muted disabled:opacity-50">
          <Download className="h-3.5 w-3.5" /> CSV
        </button>
        <button onClick={emailNow} disabled={!report?.success || emailing}
          className="flex items-center gap-1.5 rounded-xl bg-[var(--collaboration)] px-3 py-2 text-sm font-semibold text-white hover:opacity-90 disabled:opacity-50">
          {emailing ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Mail className="h-3.5 w-3.5" />}
          Email me the report
        </button>
      </div>

      {/* Report */}
      {loading ? (
        <div className="flex items-center gap-2.5 py-8 text-sm text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin text-primary" /> Loading your team's attendance…
        </div>
      ) : !report?.success ? (
        <div className="flex items-start gap-2 rounded-xl border border-amber-500/20 bg-amber-500/5 px-4 py-3 text-sm text-amber-600 dark:text-amber-400">
          <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
          {report?.message || "No employees report up to you — nothing to report."}
        </div>
      ) : (
        <>
          {/* Totals */}
          <div className="mb-5 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
            {[
              { label: "Team Size", value: report.headcount, icon: Users },
              { label: "Present", value: totals!.present },
              { label: "Absent", value: totals!.absent },
              { label: "WFH", value: totals!.wfh },
              { label: "Late", value: totals!.late },
              { label: "Half-day", value: totals!.half_day },
            ].map(c => (
              <div key={c.label} className="rounded-2xl border border-border bg-card/50 px-4 py-3">
                <p className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">{c.label}</p>
                <p className="mt-1 text-2xl font-bold text-foreground">{c.value}</p>
              </div>
            ))}
          </div>

          {/* Roster table */}
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
                  <tr key={m.email || i} className={cn("border-t border-border", i % 2 ? "bg-muted/20" : "")}>
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

      {/* Schedules */}
      <SchedulesSection auth={auth} />
    </div>
  );
}

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
    } catch { /* ignore */ } finally { setLoading(false); }
  }, [auth]);

  useEffect(() => { load(); }, [load]);

  const toggle = async (s: Schedule) => {
    await fetch(`/api/portal/manager/attendance/schedules/${s.id}`, {
      method: "PATCH",
      headers: { ...auth, "Content-Type": "application/json" },
      body: JSON.stringify({ active: !s.active }),
    });
    load();
  };

  const remove = async (s: Schedule) => {
    await fetch(`/api/portal/manager/attendance/schedules/${s.id}`, { method: "DELETE", headers: auth });
    flyBanner("Automation removed");
    load();
  };

  return (
    <div className="mt-8">
      <div className="mb-3 flex items-center gap-2">
        <CalendarClock className="h-4 w-4 text-[var(--collaboration)]" />
        <h2 className="text-sm font-bold uppercase tracking-widest text-muted-foreground">Email Automations</h2>
        <div className="flex-1" />
        <button onClick={() => setShowForm(v => !v)}
          className="flex items-center gap-1.5 rounded-xl border border-border bg-background px-3 py-1.5 text-xs font-semibold hover:bg-muted">
          <Plus className="h-3.5 w-3.5" /> New automation
        </button>
      </div>

      {showForm && <ScheduleForm auth={auth} onCreated={() => { setShowForm(false); load(); }} />}

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
          {schedules.map(s => (
            <div key={s.id} className="flex items-center justify-between gap-3 rounded-2xl border border-border bg-card/50 px-4 py-3">
              <div className="min-w-0">
                <div className="flex items-center gap-2">
                  <span className="font-semibold text-foreground">{describeCadence(s)}</span>
                  {!s.active && <span className="rounded-full bg-muted px-2 py-0.5 text-[10px] font-semibold uppercase text-muted-foreground">Paused</span>}
                  {s.period_mode === "prev_period" && <span className="rounded-full bg-[var(--collaboration)]/10 px-2 py-0.5 text-[10px] font-semibold text-[var(--collaboration)]">Prev. period</span>}
                </div>
                <div className="mt-1 flex flex-wrap items-center gap-x-3 text-[11px] text-muted-foreground">
                  <span className="flex items-center gap-1"><Clock className="h-3 w-3" /> Next: {fmtDateTime(s.next_run)}</span>
                  <span>To: {s.recipients.length ? s.recipients.join(", ") : "you"}</span>
                  {s.last_status && <span>Last: {s.last_status} ({fmtDateTime(s.last_run)})</span>}
                </div>
              </div>
              <div className="flex shrink-0 items-center gap-1.5">
                <button onClick={() => toggle(s)} title={s.active ? "Pause" : "Resume"}
                  className={cn("flex items-center gap-1 rounded-xl border px-2.5 py-1.5 text-xs font-semibold",
                    s.active ? "border-border hover:bg-muted" : "border-emerald-500/30 bg-emerald-500/5 text-emerald-600")}>
                  <Power className="h-3.5 w-3.5" /> {s.active ? "Pause" : "Resume"}
                </button>
                <button onClick={() => remove(s)} title="Delete"
                  className="flex items-center gap-1 rounded-xl border border-destructive/30 bg-destructive/5 px-2.5 py-1.5 text-xs font-semibold text-destructive hover:bg-destructive/10">
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

function ScheduleForm({ auth, onCreated, prefill }: {
  auth: Record<string, string>;
  onCreated: () => void;
  prefill?: Partial<{ frequency: string; day_of_week: number; day_of_month: number; hour: number }>;
}) {
  const [frequency, setFrequency] = useState(prefill?.frequency ?? "monthly");
  const [dayOfWeek, setDayOfWeek] = useState(prefill?.day_of_week ?? 0);
  const [dayOfMonth, setDayOfMonth] = useState(prefill?.day_of_month ?? 1);
  const [hour, setHour] = useState(prefill?.hour ?? 8);
  const [recipients, setRecipients] = useState("");
  const [periodMode, setPeriodMode] = useState("prev_period");
  const [saving, setSaving] = useState(false);

  const submit = async () => {
    setSaving(true);
    const body: Record<string, unknown> = { frequency, hour, period_mode: periodMode };
    if (frequency === "weekly" || frequency === "custom") body.day_of_week = dayOfWeek;
    if (frequency === "monthly" || frequency === "custom") body.day_of_month = dayOfMonth;
    if (recipients.trim()) body.recipients = recipients.split(",").map(r => r.trim()).filter(Boolean);
    try {
      const res = await fetch("/api/portal/manager/attendance/schedules", {
        method: "POST",
        headers: { ...auth, "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      if (res.ok) { flyBanner("Automation scheduled"); onCreated(); }
      else toast.error("Could not create the automation.");
    } catch { toast.error("Could not reach the server."); } finally { setSaving(false); }
  };

  return (
    <div className="mb-3 grid gap-3 rounded-2xl border border-border bg-card/50 p-4 sm:grid-cols-2">
      <label className="text-xs font-medium text-muted-foreground">
        Frequency
        <select value={frequency} onChange={e => setFrequency(e.target.value)}
          className="mt-1 w-full rounded-xl border border-border bg-background px-3 py-2 text-sm text-foreground">
          <option value="daily">Daily (weekdays)</option>
          <option value="weekly">Weekly</option>
          <option value="monthly">Monthly</option>
          <option value="custom">Custom</option>
        </select>
      </label>

      <label className="text-xs font-medium text-muted-foreground">
        Time (hour)
        <select value={hour} onChange={e => setHour(Number(e.target.value))}
          className="mt-1 w-full rounded-xl border border-border bg-background px-3 py-2 text-sm text-foreground">
          {Array.from({ length: 24 }, (_, h) => <option key={h} value={h}>{h % 12 || 12}:00 {h >= 12 ? "PM" : "AM"}</option>)}
        </select>
      </label>

      {(frequency === "weekly" || frequency === "custom") && (
        <label className="text-xs font-medium text-muted-foreground">
          Day of week
          <select value={dayOfWeek} onChange={e => setDayOfWeek(Number(e.target.value))}
            className="mt-1 w-full rounded-xl border border-border bg-background px-3 py-2 text-sm text-foreground">
            {DOW.map((d, i) => <option key={d} value={i}>{d}</option>)}
          </select>
        </label>
      )}

      {(frequency === "monthly" || frequency === "custom") && (
        <label className="text-xs font-medium text-muted-foreground">
          Day of month (1–28)
          <input type="number" min={1} max={28} value={dayOfMonth}
            onChange={e => setDayOfMonth(Math.min(28, Math.max(1, Number(e.target.value))))}
            className="mt-1 w-full rounded-xl border border-border bg-background px-3 py-2 text-sm text-foreground" />
        </label>
      )}

      <label className="text-xs font-medium text-muted-foreground">
        Report period
        <select value={periodMode} onChange={e => setPeriodMode(e.target.value)}
          className="mt-1 w-full rounded-xl border border-border bg-background px-3 py-2 text-sm text-foreground">
          <option value="prev_period">Previous month</option>
          <option value="current">Current month-to-date</option>
        </select>
      </label>

      <label className="text-xs font-medium text-muted-foreground sm:col-span-2">
        Recipients (comma-separated; leave blank to send to yourself)
        <input value={recipients} onChange={e => setRecipients(e.target.value)}
          placeholder="you@alignedautomation.com"
          className="mt-1 w-full rounded-xl border border-border bg-background px-3 py-2 text-sm text-foreground" />
      </label>

      <div className="sm:col-span-2">
        <button onClick={submit} disabled={saving}
          className="flex items-center gap-1.5 rounded-xl bg-[var(--collaboration)] px-4 py-2 text-sm font-semibold text-white hover:opacity-90 disabled:opacity-50">
          {saving ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <CheckCircle2 className="h-3.5 w-3.5" />}
          Save automation
        </button>
      </div>
    </div>
  );
}
