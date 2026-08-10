import { useEffect, useState } from "react";
import { BarChart3 } from "lucide-react";
import { Spinner } from "@/pages/TechElevateLocalPortal";

const API = "/api/portal/techelevate";

const KPI_LABELS: Record<string, string> = {
  total_employees: "Employees",
  total_trainings: "Trainings",
  total_assignments: "Assignments",
  completed_assignments: "Completed",
  in_progress_assignments: "In Progress",
  assigned_assignments: "Assigned",
  failed_assignments: "Failed",
  completion_rate: "Completion Rate",
  progress_rate: "Progress Rate",
  engagement_rate: "Engagement Rate",
};

function fmtValue(key: string, value: any) {
  if (typeof value === "number" && key.endsWith("_rate")) return `${value.toFixed(1)}%`;
  return value;
}

export function ReportsPanel({ authHeaders }: { authHeaders: Record<string, string> }) {
  const [overview, setOverview] = useState<Record<string, any> | null>(null);
  const [topTrainings, setTopTrainings] = useState<any[]>([]);
  const [topEmployees, setTopEmployees] = useState<any[]>([]);
  const [categoryPerf, setCategoryPerf] = useState<any[]>([]);
  const [deptPerf, setDeptPerf] = useState<any[]>([]);
  const [loginOverview, setLoginOverview] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setLoading(true);
    setError(null);
    Promise.all([
      fetch(`${API}/reports/overview`, { headers: authHeaders }).then((r) => (r.ok ? r.json() : null)),
      fetch(`${API}/reports/top-trainings`, { headers: authHeaders }).then((r) => (r.ok ? r.json() : [])),
      fetch(`${API}/reports/top-employees`, { headers: authHeaders }).then((r) => (r.ok ? r.json() : [])),
      fetch(`${API}/reports/category-performance`, { headers: authHeaders }).then((r) => (r.ok ? r.json() : [])),
      fetch(`${API}/reports/department-performance`, { headers: authHeaders }).then((r) => (r.ok ? r.json() : [])),
      fetch(`${API}/analytics/login-overview`, { headers: authHeaders }).then((r) => (r.ok ? r.json() : null)),
    ])
      .then(([ov, tt, te, cp, dp, lo]) => {
        setOverview(ov);
        setTopTrainings(Array.isArray(tt) ? tt : []);
        setTopEmployees(Array.isArray(te) ? te : []);
        setCategoryPerf(Array.isArray(cp) ? cp : []);
        setDeptPerf(Array.isArray(dp) ? dp : []);
        setLoginOverview(lo);
      })
      .catch((e) => setError(e.message || "Couldn't load reports."))
      .finally(() => setLoading(false));
  }, [authHeaders]);

  if (loading) return <Spinner label="Loading reports from TechElevate…" />;
  if (error) {
    return <p className="text-center py-16 text-xs font-semibold text-slate-500 dark:text-zinc-400">{error}</p>;
  }

  return (
    <div className="flex flex-col gap-6">
      {overview && (
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5">
          {Object.entries(overview)
            .filter(([k]) => KPI_LABELS[k])
            .map(([k, v]) => (
              <div key={k} className="rounded-2xl border border-slate-200/50 dark:border-zinc-800 bg-white/70 dark:bg-zinc-900/40 p-3">
                <p className="text-[9px] font-bold uppercase tracking-wider text-slate-400 dark:text-zinc-500">
                  {KPI_LABELS[k]}
                </p>
                <p className="text-lg font-extrabold text-slate-800 dark:text-zinc-100">{fmtValue(k, v)}</p>
              </div>
            ))}
        </div>
      )}

      {loginOverview?.today && (
        <Section title="Today's Logins">
          <div className="flex gap-4 text-xs font-semibold text-slate-600 dark:text-zinc-300">
            {Object.entries(loginOverview.today).map(([k, v]) => (
              <span key={k}>
                {k.replace(/_/g, " ")}: <b className="text-slate-900 dark:text-zinc-100">{String(v)}</b>
              </span>
            ))}
          </div>
        </Section>
      )}

      <Section title="Top Trainings">
        <RankedList
          rows={topTrainings}
          primary={(r) => r.title}
          secondary={(r) => r.category}
          metric={(r) => `${r.completed_employees ?? 0}/${r.assigned_employees ?? 0} completed`}
        />
      </Section>

      <Section title="Top Employees">
        <RankedList
          rows={topEmployees}
          primary={(r) => r.name}
          secondary={(r) => r.designation}
          metric={(r) => `${r.completed_courses ?? 0}/${r.total_courses ?? 0} · avg ${r.avg_score ?? 0}%`}
        />
      </Section>

      <Section title="Category Performance">
        <RankedList
          rows={categoryPerf}
          primary={(r) => r.category || "Uncategorized"}
          secondary={() => ""}
          metric={(r) => `${r.completed_employees ?? 0}/${r.total_employees ?? 0} · avg ${(r.avg_score ?? 0).toFixed?.(1) ?? r.avg_score ?? 0}%`}
        />
      </Section>

      <Section title="Department Performance">
        <RankedList
          rows={deptPerf}
          primary={(r) => r.department || "Unknown"}
          secondary={() => ""}
          metric={(r) => `${r.completed_trainings ?? 0}/${r.total_trainings ?? 0} trainings`}
        />
      </Section>
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-2.5">
      <h4 className="text-[10px] font-extrabold uppercase tracking-wider text-slate-400 dark:text-zinc-500 inline-flex items-center gap-1.5">
        <BarChart3 className="w-3.5 h-3.5" /> {title}
      </h4>
      {children}
    </div>
  );
}

function RankedList<T>({
  rows,
  primary,
  secondary,
  metric,
}: {
  rows: T[];
  primary: (r: T) => string;
  secondary: (r: T) => string;
  metric: (r: T) => string;
}) {
  if (!rows.length) {
    return <p className="text-xs text-slate-400 dark:text-zinc-500 italic">No data yet.</p>;
  }
  return (
    <div className="rounded-2xl border border-slate-200/50 dark:border-zinc-800 divide-y divide-slate-100 dark:divide-zinc-800/60 overflow-hidden">
      {rows.slice(0, 10).map((r, i) => (
        <div key={i} className="flex items-center justify-between gap-3 px-4 py-2.5 bg-white/70 dark:bg-zinc-900/40">
          <div className="min-w-0">
            <p className="text-xs font-bold text-slate-800 dark:text-zinc-200 truncate">{primary(r)}</p>
            {secondary(r) && <p className="text-[10px] text-slate-400 dark:text-zinc-500">{secondary(r)}</p>}
          </div>
          <span className="text-[11px] font-semibold text-slate-500 dark:text-zinc-400 shrink-0">{metric(r)}</span>
        </div>
      ))}
    </div>
  );
}
