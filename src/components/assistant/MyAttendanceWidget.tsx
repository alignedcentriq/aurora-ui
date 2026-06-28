import { useState, useEffect } from "react";
import { motion } from "framer-motion";
import { Calendar, ChevronLeft, ChevronRight, Loader2, AlertCircle } from "lucide-react";

interface DayRecord {
  date: string;
  status: string;
  check_in: string | null;
  check_out: string | null;
  late: boolean;
}

interface CalendarData {
  success: boolean;
  employee?: string;
  month?: number;
  year?: number;
  period?: string;
  days?: DayRecord[];
  error?: string;
}

interface Props {
  userEmail: string;
  userRole: string;
}

const LEGEND = [
  { color: "bg-emerald-400", label: "Present" },
  { color: "bg-amber-400", label: "Late" },
  { color: "bg-blue-400", label: "WFH" },
  { color: "bg-red-400", label: "Absent" },
  { color: "bg-purple-400", label: "Half-day" },
];

function dayClass(record: DayRecord | undefined, isFuture: boolean, isWeekend: boolean) {
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

export function MyAttendanceWidget({ userEmail, userRole }: Props) {
  const today = new Date();
  const todayStr = today.toISOString().slice(0, 10);
  const [viewMonth, setViewMonth] = useState(today.getMonth() + 1);
  const [viewYear, setViewYear] = useState(today.getFullYear());
  const [data, setData] = useState<CalendarData | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    setLoading(true);
    setData(null);
    fetch(`/api/attendance/my/calendar?month=${viewMonth}&year=${viewYear}`, {
      headers: { "x-user-email": userEmail, "x-user-role": userRole.toLowerCase() },
    })
      .then((r) => r.json())
      .then(setData)
      .catch(() => setData({ success: false, error: "network_error" }))
      .finally(() => setLoading(false));
  }, [viewMonth, viewYear, userEmail, userRole]);

  const isCurrentMonth = viewYear === today.getFullYear() && viewMonth === today.getMonth() + 1;

  const prevMonth = () => {
    if (viewMonth === 1) {
      setViewYear((y) => y - 1);
      setViewMonth(12);
    } else setViewMonth((m) => m - 1);
  };
  const nextMonth = () => {
    if (isCurrentMonth) return;
    if (viewMonth === 12) {
      setViewYear((y) => y + 1);
      setViewMonth(1);
    } else setViewMonth((m) => m + 1);
  };

  // Build lookup by date string
  const dayMap: Record<string, DayRecord> = {};
  (data?.days ?? []).forEach((d) => {
    dayMap[d.date] = d;
  });

  // Compute summary
  const stats = { present: 0, absent: 0, wfh: 0, late: 0, half_day: 0 };
  (data?.days ?? []).forEach((d) => {
    if (d.status === "Present") {
      stats.present++;
      if (d.late) stats.late++;
    } else if (d.status === "Absent") stats.absent++;
    else if (d.status === "WFH") stats.wfh++;
    else if (d.status === "Half-day") stats.half_day++;
  });

  // Calendar geometry
  const firstDow = new Date(viewYear, viewMonth - 1, 1).getDay(); // 0=Sun
  const daysInMonth = new Date(viewYear, viewMonth, 0).getDate();
  const periodLabel = new Date(viewYear, viewMonth - 1, 1).toLocaleDateString("en-IN", {
    month: "long",
    year: "numeric",
  });

  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ type: "spring", stiffness: 300, damping: 30 }}
      className="mt-3 overflow-hidden rounded-2xl border border-border bg-card/50 backdrop-blur-sm"
    >
      {/* Header */}
      <div className="flex items-center gap-2 border-b border-border bg-muted/40 px-4 py-2.5">
        <Calendar className="h-3.5 w-3.5 text-[var(--collaboration)]" />
        <span className="text-[11px] font-bold uppercase tracking-widest text-muted-foreground">
          My Attendance
        </span>
      </div>

      <div className="p-4">
        {/* Month navigation */}
        <div className="mb-3 flex items-center justify-between">
          <button
            onClick={prevMonth}
            className="rounded-lg p-1 text-muted-foreground hover:bg-muted/60 hover:text-foreground"
          >
            <ChevronLeft className="h-4 w-4" />
          </button>
          <span className="text-sm font-semibold text-foreground">{periodLabel}</span>
          <button
            onClick={nextMonth}
            disabled={isCurrentMonth}
            className="rounded-lg p-1 text-muted-foreground hover:bg-muted/60 hover:text-foreground disabled:opacity-30"
          >
            <ChevronRight className="h-4 w-4" />
          </button>
        </div>

        {loading ? (
          <div className="flex items-center gap-2 py-6 text-sm text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin text-primary" />
            Loading attendance…
          </div>
        ) : !data?.success ? (
          <div className="flex items-center gap-2 py-4 text-sm text-muted-foreground">
            <AlertCircle className="h-4 w-4 text-amber-500" />
            Could not load attendance data.
          </div>
        ) : (
          <>
            {/* Summary chips */}
            <div className="mb-3 flex flex-wrap gap-1.5">
              {[
                {
                  label: "Present",
                  count: stats.present,
                  cls: "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300",
                },
                {
                  label: "Absent",
                  count: stats.absent,
                  cls: "bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-300",
                },
                {
                  label: "WFH",
                  count: stats.wfh,
                  cls: "bg-blue-100 text-blue-700 dark:bg-blue-900/40 dark:text-blue-300",
                },
                {
                  label: "Late",
                  count: stats.late,
                  cls: "bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300",
                },
                {
                  label: "Half-day",
                  count: stats.half_day,
                  cls: "bg-purple-100 text-purple-700 dark:bg-purple-900/40 dark:text-purple-300",
                },
              ].map(({ label, count, cls }) => (
                <span
                  key={label}
                  className={`inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-xs font-semibold ${cls}`}
                >
                  {count} {label}
                </span>
              ))}
            </div>

            {/* Calendar grid */}
            <div className="overflow-hidden rounded-xl border border-border">
              {/* Day-of-week header */}
              <div className="grid grid-cols-7 bg-muted/50 text-center text-[10px] font-bold uppercase tracking-wide text-muted-foreground">
                {["Su", "Mo", "Tu", "We", "Th", "Fr", "Sa"].map((d) => (
                  <div key={d} className="py-1.5">
                    {d}
                  </div>
                ))}
              </div>
              {/* Day cells */}
              <div className="grid grid-cols-7">
                {Array.from({ length: firstDow }).map((_, i) => (
                  <div key={`pre-${i}`} className="aspect-square" />
                ))}
                {Array.from({ length: daysInMonth }, (_, i) => i + 1).map((day) => {
                  const dateStr = `${viewYear}-${String(viewMonth).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
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
                      ]
                        .filter(Boolean)
                        .join(" · ")
                    : undefined;

                  return (
                    <div
                      key={day}
                      title={tooltip}
                      className={[
                        "flex aspect-square items-center justify-center text-[11px] font-medium transition-colors",
                        dayClass(record, isFuture, isWeekend),
                        isToday ? "ring-2 ring-primary ring-inset" : "",
                      ].join(" ")}
                    >
                      {day}
                    </div>
                  );
                })}
              </div>
            </div>

            {/* Legend */}
            <div className="mt-3 flex flex-wrap gap-x-3 gap-y-1 text-[10px] text-muted-foreground">
              {LEGEND.map(({ color, label }) => (
                <span key={label} className="flex items-center gap-1">
                  <span className={`inline-block h-2 w-2 rounded-full ${color}`} />
                  {label}
                </span>
              ))}
            </div>
          </>
        )}
      </div>
    </motion.div>
  );
}
