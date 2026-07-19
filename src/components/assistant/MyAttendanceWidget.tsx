import { useState, useEffect } from "react";
import { motion } from "framer-motion";
import { Calendar, ChevronLeft, ChevronRight, Loader2, AlertCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Tooltip, TooltipTrigger, TooltipContent, TooltipProvider } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";

interface DayRecord {
  date: string;
  status: string;
  check_in: string | null;
  check_out: string | null;
  late: boolean;
}

function isPresent(record: DayRecord) {
  return record.status !== "Absent";
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
  { color: "bg-red-400", label: "Absent" },
];

function dayClass(record: DayRecord | undefined, isFuture: boolean, isWeekend: boolean) {
  if (isFuture || (!record && isWeekend)) return "text-muted-foreground/30";
  if (!record) return "text-muted-foreground/40";
  if (isPresent(record))
    return "bg-emerald-100 text-emerald-800 dark:bg-emerald-900/40 dark:text-emerald-200";
  return "bg-red-100 text-red-800 dark:bg-red-900/40 dark:text-red-200";
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
  const stats = { present: 0, absent: 0 };
  (data?.days ?? []).forEach((d) => {
    if (isPresent(d)) stats.present++;
    else stats.absent++;
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
      className="mt-3 overflow-hidden rounded-2xl border border-border bg-card/50 shadow-[0_1px_0_0_rgba(255,255,255,0.04)_inset,0_10px_30px_-16px_rgba(0,0,0,0.35)] backdrop-blur-sm"
    >
      {/* Header */}
      <div className="flex items-center gap-2 border-b border-border bg-gradient-to-r from-[var(--collaboration)]/10 via-muted/40 to-muted/40 px-4 py-2.5">
        <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-md bg-[var(--collaboration)]/15">
          <Calendar className="h-3 w-3 text-[var(--collaboration)]" />
        </span>
        <span className="text-[11px] font-bold uppercase tracking-widest text-muted-foreground">
          My Attendance
        </span>
      </div>

      <div className="p-4">
        {/* Month navigation */}
        <div className="mb-3 flex items-center justify-between">
          <Button
            variant="ghost"
            size="icon"
            onClick={prevMonth}
            aria-label="Previous month"
            className="h-7 w-7 text-muted-foreground hover:text-foreground"
          >
            <ChevronLeft className="h-4 w-4" />
          </Button>
          <span className="text-sm font-semibold text-foreground">{periodLabel}</span>
          <Button
            variant="ghost"
            size="icon"
            onClick={nextMonth}
            disabled={isCurrentMonth}
            aria-label="Next month"
            className="h-7 w-7 text-muted-foreground hover:text-foreground"
          >
            <ChevronRight className="h-4 w-4" />
          </Button>
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
              <Badge
                variant="secondary"
                className="bg-emerald-100 text-emerald-700 hover:bg-emerald-100 dark:bg-emerald-900/40 dark:text-emerald-300 rounded-full font-semibold"
              >
                {stats.present} Present
              </Badge>
              <Badge
                variant="secondary"
                className="bg-red-100 text-red-700 hover:bg-red-100 dark:bg-red-900/40 dark:text-red-300 rounded-full font-semibold"
              >
                {stats.absent} Absent
              </Badge>
            </div>

            {/* Calendar grid */}
            <TooltipProvider delayDuration={200}>
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

                    const tooltip = record ? (isPresent(record) ? "Present" : "Absent") : undefined;

                    const cell = (
                      <button
                        type="button"
                        disabled={!record}
                        aria-label={tooltip ? `${day}: ${tooltip}` : `${day}`}
                        className={cn(
                          "relative m-[1.5px] flex aspect-square w-[calc(100%-3px)] items-center justify-center rounded-md text-[11px] font-medium transition-all duration-150 disabled:cursor-default",
                          "enabled:hover:scale-110 enabled:hover:shadow-sm enabled:hover:z-10",
                          dayClass(record, isFuture, isWeekend),
                          isToday ? "ring-2 ring-primary ring-inset" : "",
                        )}
                      >
                        {day}
                      </button>
                    );

                    return tooltip ? (
                      <Tooltip key={day}>
                        <TooltipTrigger asChild>{cell}</TooltipTrigger>
                        <TooltipContent>{tooltip}</TooltipContent>
                      </Tooltip>
                    ) : (
                      <div key={day}>{cell}</div>
                    );
                  })}
                </div>
              </div>
            </TooltipProvider>

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
