import { useState, useEffect, useMemo } from "react";
import { motion } from "framer-motion";
import {
  Users, Mail, CalendarClock, Loader2, AlertCircle, CheckCircle2, Clock,
} from "lucide-react";
import { flyBanner } from "@/lib/fly-banner";
import type { AttendanceSchedulePrefill } from "@/lib/chat-store";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

interface Member {
  employee: string; department: string; reports_to: string;
  present: number; absent: number; wfh: number; late: number; half_day: number;
}
interface TeamReport {
  success: boolean; message?: string; error?: string;
  manager?: string; period?: string; headcount?: number;
  members?: Member[];
  totals?: { present: number; absent: number; wfh: number; late: number; half_day: number };
}

const DOW = ["Monday","Tuesday","Wednesday","Thursday","Friday","Saturday","Sunday"];

interface Props {
  userEmail: string;
  userRole: string;
  mode: "report" | "schedule";
  prefill?: AttendanceSchedulePrefill;
  onDone: (message: string) => void;
}

function Shell({ icon, title, children }: { icon: React.ReactNode; title: string; children: React.ReactNode }) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }}
      transition={{ type: "spring", stiffness: 300, damping: 30 }}
      className="mt-3 overflow-hidden rounded-2xl border border-border bg-card/50 backdrop-blur-sm"
    >
      <div className="flex items-center gap-2 border-b border-border bg-muted/40 px-4 py-2.5">
        {icon}
        <span className="text-[11px] font-bold uppercase tracking-widest text-muted-foreground">{title}</span>
      </div>
      <div className="p-4">{children}</div>
    </motion.div>
  );
}

export function AttendanceScheduleWidget({ userEmail, userRole, mode, prefill, onDone }: Props) {
  const auth = useMemo(
    () => ({ "x-user-email": userEmail, "x-user-role": userRole.toLowerCase() }),
    [userEmail, userRole]
  );
  const isManager = userRole.toLowerCase() === "functional manager";

  if (!isManager) {
    return (
      <Shell icon={<AlertCircle className="h-3.5 w-3.5 text-amber-500" />} title="Manager Only">
        <p className="text-sm text-muted-foreground">
          Whole-hierarchy attendance is available to Functional Managers only.
        </p>
      </Shell>
    );
  }
  return mode === "schedule"
    ? <ScheduleMode auth={auth} prefill={prefill} onDone={onDone} />
    : <ReportMode auth={auth} onDone={onDone} />;
}

function ReportMode({ auth, onDone }: { auth: Record<string, string>; onDone: (m: string) => void }) {
  const [report, setReport] = useState<TeamReport | null>(null);
  const [loading, setLoading] = useState(true);
  const [emailing, setEmailing] = useState(false);

  useEffect(() => {
    (async () => {
      try {
        const res = await fetch("/api/portal/manager/attendance", { headers: auth });
        const data = await res.json().catch(() => ({}));
        if (res.status === 403) { setReport({ success: false, message: "Functional Managers only." }); return; }
        setReport(data);
      } catch {
        setReport({ success: false, message: "Could not reach the server." });
      } finally { setLoading(false); }
    })();
  }, [auth]);

  const emailNow = async () => {
    setEmailing(true);
    try {
      const res = await fetch("/api/portal/manager/attendance/email", {
        method: "POST", headers: { ...auth, "Content-Type": "application/json" }, body: "{}",
      });
      const data = await res.json().catch(() => ({}));
      if (data.success && data.sent) {
        flyBanner("Attendance report emailed");
        onDone(`✅ Emailed your team attendance report for **${data.period}** to ${data.recipients?.join(", ")}.`);
      } else {
        onDone("⚠️ Couldn't send the email — make sure your Microsoft account is connected in Settings.");
      }
    } catch { onDone("⚠️ Could not reach the server."); } finally { setEmailing(false); }
  };

  return (
    <Shell icon={<Users className="h-3.5 w-3.5 text-[var(--collaboration)]" />} title="Team Attendance">
      {loading ? (
        <div className="flex items-center gap-2.5 py-3 text-sm text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin text-primary" /> Gathering attendance for your hierarchy…
        </div>
      ) : !report?.success ? (
        <p className="py-2 text-sm text-muted-foreground">{report?.message || "No employees report up to you."}</p>
      ) : (
        <>
          <p className="mb-3 text-sm text-foreground">
            <strong>{report.headcount}</strong> people in your hierarchy · <strong>{report.period}</strong>
          </p>
          <div className="mb-3 overflow-x-auto rounded-xl border border-border">
            <table className="w-full text-xs">
              <thead>
                <tr className="bg-muted/50 text-left uppercase text-muted-foreground">
                  <th className="px-2.5 py-2">Employee</th>
                  <th className="px-2.5 py-2 text-center">P</th>
                  <th className="px-2.5 py-2 text-center">A</th>
                  <th className="px-2.5 py-2 text-center">WFH</th>
                  <th className="px-2.5 py-2 text-center">Late</th>
                  <th className="px-2.5 py-2 text-center">Half</th>
                </tr>
              </thead>
              <tbody>
                {report.members!.slice(0, 12).map((m, i) => (
                  <tr key={i} className={i % 2 ? "bg-muted/20" : ""}>
                    <td className="px-2.5 py-1.5">
                      <div className="font-medium text-foreground">{m.employee}</div>
                      <div className="text-[10px] text-muted-foreground">{m.department}</div>
                    </td>
                    <td className="px-2.5 py-1.5 text-center">{m.present}</td>
                    <td className="px-2.5 py-1.5 text-center">{m.absent}</td>
                    <td className="px-2.5 py-1.5 text-center">{m.wfh}</td>
                    <td className="px-2.5 py-1.5 text-center">{m.late}</td>
                    <td className="px-2.5 py-1.5 text-center">{m.half_day}</td>
                  </tr>
                ))}
                <tr className="border-t border-border bg-muted/40 font-semibold text-foreground">
                  <td className="px-2.5 py-2">TOTAL</td>
                  <td className="px-2.5 py-2 text-center">{report.totals!.present}</td>
                  <td className="px-2.5 py-2 text-center">{report.totals!.absent}</td>
                  <td className="px-2.5 py-2 text-center">{report.totals!.wfh}</td>
                  <td className="px-2.5 py-2 text-center">{report.totals!.late}</td>
                  <td className="px-2.5 py-2 text-center">{report.totals!.half_day}</td>
                </tr>
              </tbody>
            </table>
          </div>
          {report.members!.length > 12 && (
            <p className="mb-2 text-[11px] text-muted-foreground">Showing 12 of {report.members!.length}. The emailed Excel has everyone.</p>
          )}
          <button onClick={emailNow} disabled={emailing}
            className="flex items-center gap-1.5 rounded-xl bg-[var(--collaboration)] px-3 py-2 text-sm font-semibold text-white hover:opacity-90 disabled:opacity-50">
            {emailing ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Mail className="h-3.5 w-3.5" />}
            Email me this report (with Excel)
          </button>
        </>
      )}
    </Shell>
  );
}

function ScheduleMode({ auth, prefill, onDone }: {
  auth: Record<string, string>; prefill?: AttendanceSchedulePrefill; onDone: (m: string) => void;
}) {
  const [frequency, setFrequency] = useState(prefill?.frequency ?? "monthly");
  const [dayOfWeek, setDayOfWeek] = useState(prefill?.day_of_week ?? 0);
  const [dayOfMonth, setDayOfMonth] = useState(prefill?.day_of_month ?? 1);
  const [hour, setHour] = useState(prefill?.hour ?? 8);
  const [periodMode, setPeriodMode] = useState("prev_period");
  const [recipients, setRecipients] = useState("");
  const [saving, setSaving] = useState(false);
  const [done, setDone] = useState(false);

  const submit = async () => {
    setSaving(true);
    const body: Record<string, unknown> = { frequency, hour, period_mode: periodMode };
    if (frequency === "weekly" || frequency === "custom") body.day_of_week = dayOfWeek;
    if (frequency === "monthly" || frequency === "custom") body.day_of_month = dayOfMonth;
    if (recipients.trim()) body.recipients = recipients.split(",").map(r => r.trim()).filter(Boolean);
    try {
      const res = await fetch("/api/portal/manager/attendance/schedules", {
        method: "POST", headers: { ...auth, "Content-Type": "application/json" }, body: JSON.stringify(body),
      });
      const data = await res.json().catch(() => ({}));
      if (res.ok) {
        flyBanner("Attendance automation scheduled");
        setDone(true);
        const when = data.next_run ? new Date(data.next_run).toLocaleString("en-IN",
          { day: "numeric", month: "short", hour: "numeric", minute: "2-digit", hour12: true }) : "soon";
        onDone(`✅ Automation set up — your team's attendance report will be emailed **${frequency}**. First run: ${when}. Manage it anytime in the Manager Portal.`);
      } else { onDone("⚠️ Couldn't create the automation."); }
    } catch { onDone("⚠️ Could not reach the server."); } finally { setSaving(false); }
  };

  if (done) {
    return (
      <Shell icon={<CheckCircle2 className="h-3.5 w-3.5 text-emerald-500" />} title="Automation Scheduled">
        <p className="flex items-center gap-2 text-sm text-emerald-600 dark:text-emerald-400">
          <Clock className="h-4 w-4" /> Your attendance report automation is active.
        </p>
      </Shell>
    );
  }

  const field = "mt-1 w-full rounded-xl border border-border bg-background px-3 py-2 text-sm text-foreground";
  return (
    <Shell icon={<CalendarClock className="h-3.5 w-3.5 text-[var(--collaboration)]" />} title="Schedule Attendance Email">
      <div className="grid gap-3 sm:grid-cols-2">
        <div className="flex flex-col">
          <label className="text-xs font-semibold text-muted-foreground mb-1.5">Frequency</label>
          <Select value={frequency} onValueChange={setFrequency}>
            <SelectTrigger className="w-full h-[38px] rounded-xl border border-border bg-background px-3 py-2 text-sm text-foreground outline-none focus:ring-2 focus:ring-primary/20 transition-all hover:bg-muted/10">
              <SelectValue />
            </SelectTrigger>
            <SelectContent className="max-h-60 bg-card border-border rounded-xl shadow-xl z-50">
              <SelectItem value="daily">Daily (weekdays)</SelectItem>
              <SelectItem value="weekly">Weekly</SelectItem>
              <SelectItem value="monthly">Monthly</SelectItem>
              <SelectItem value="custom">Custom</SelectItem>
            </SelectContent>
          </Select>
        </div>

        <div className="flex flex-col">
          <label className="text-xs font-semibold text-muted-foreground mb-1.5">Time</label>
          <Select value={String(hour)} onValueChange={(val) => setHour(Number(val))}>
            <SelectTrigger className="w-full h-[38px] rounded-xl border border-border bg-background px-3 py-2 text-sm text-foreground outline-none focus:ring-2 focus:ring-primary/20 transition-all hover:bg-muted/10">
              <SelectValue />
            </SelectTrigger>
            <SelectContent className="max-h-60 bg-card border-border rounded-xl shadow-xl z-50">
              {Array.from({ length: 24 }, (_, h) => (
                <SelectItem key={h} value={String(h)}>
                  {h % 12 || 12}:00 {h >= 12 ? "PM" : "AM"}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        {(frequency === "weekly" || frequency === "custom") && (
          <div className="flex flex-col">
            <label className="text-xs font-semibold text-muted-foreground mb-1.5">Day of week</label>
            <Select value={String(dayOfWeek)} onValueChange={(val) => setDayOfWeek(Number(val))}>
              <SelectTrigger className="w-full h-[38px] rounded-xl border border-border bg-background px-3 py-2 text-sm text-foreground outline-none focus:ring-2 focus:ring-primary/20 transition-all hover:bg-muted/10">
                <SelectValue />
              </SelectTrigger>
              <SelectContent className="max-h-60 bg-card border-border rounded-xl shadow-xl z-50">
                {DOW.map((d, i) => (
                  <SelectItem key={d} value={String(i)}>
                    {d}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        )}

        {(frequency === "monthly" || frequency === "custom") && (
          <div className="flex flex-col">
            <label className="text-xs font-semibold text-muted-foreground mb-1.5">Day of month (1–28)</label>
            <input type="number" min={1} max={28} value={dayOfMonth}
              onChange={e => setDayOfMonth(Math.min(28, Math.max(1, Number(e.target.value))))} className="w-full h-[38px] rounded-xl border border-border bg-background px-3 py-2 text-sm text-foreground outline-none focus:ring-2 focus:ring-primary/20 transition-shadow" />
          </div>
        )}

        <div className="flex flex-col">
          <label className="text-xs font-semibold text-muted-foreground mb-1.5">Report period</label>
          <Select value={periodMode} onValueChange={setPeriodMode}>
            <SelectTrigger className="w-full h-[38px] rounded-xl border border-border bg-background px-3 py-2 text-sm text-foreground outline-none focus:ring-2 focus:ring-primary/20 transition-all hover:bg-muted/10">
              <SelectValue />
            </SelectTrigger>
            <SelectContent className="max-h-60 bg-card border-border rounded-xl shadow-xl z-50">
              <SelectItem value="prev_period">Previous month</SelectItem>
              <SelectItem value="current">Current month-to-date</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <label className="text-xs font-medium text-muted-foreground sm:col-span-2">
          Recipients (comma-separated; blank = you)
          <input value={recipients} onChange={e => setRecipients(e.target.value)} placeholder="you@alignedautomation.com" className={field} />
        </label>
      </div>
      <button onClick={submit} disabled={saving}
        className="mt-3 flex items-center gap-1.5 rounded-xl bg-[var(--collaboration)] px-4 py-2 text-sm font-semibold text-white hover:opacity-90 disabled:opacity-50">
        {saving ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <CheckCircle2 className="h-3.5 w-3.5" />}
        Save automation
      </button>
    </Shell>
  );
}
