// Personal + team analytics (roadmap item 9). A self-contained panel: a Me / My team scope
// toggle plus metric/dimension/period dropdowns, charting the caller's own leave data (or
// their direct reports' when "My team" is selected). Talks only to the self-scoped
// /api/analytics/me/* endpoints, so it's safe to mount anywhere a logged-in user can reach.

import { useAuth } from "@/lib/auth-store";
import { useCallback, useEffect, useMemo, useState } from "react";
import { Loader2, User, Users } from "lucide-react";
import { cn } from "@/lib/utils";
import { MetricChart, type ChartType } from "./MetricChart";

interface PMetric {
  id: string;
  label: string;
  dims: string[];
  chart_hint: ChartType;
  unit: string;
  scopes: string[];
}
interface PCatalog {
  metrics: PMetric[];
  dimensions: { id: string; label: string }[];
  periods: string[];
  has_team: boolean;
}

const DIM_LABELS: Record<string, string> = {
  leave_type: "Leave type",
  status: "Status",
  day: "Day",
  week: "Week",
  month: "Month",
};

export function MyAnalytics() {
  const { user } = useAuth();
  const authHeaders = useMemo(
    () => ({
      "Content-Type": "application/json",
      ...(user?.email ? { "x-user-email": user.email } : {}),
      ...(user?.role ? { "x-user-role": user.role.toLowerCase() } : {}),
    }),
    [user?.email, user?.role],
  );

  const [catalog, setCatalog] = useState<PCatalog | null>(null);
  const [scope, setScope] = useState<"me" | "my-team">("me");
  const [metric, setMetric] = useState("leaves_taken");
  const [dimension, setDimension] = useState("month");
  const [period, setPeriod] = useState("90d");
  const [data, setData] = useState<any | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    fetch("/api/analytics/me/catalog", { headers: authHeaders })
      .then((r) => (r.ok ? r.json() : null))
      .then((c: PCatalog | null) => c && setCatalog(c));
  }, [authHeaders]);

  const activeMetric = catalog?.metrics.find((m) => m.id === metric) || catalog?.metrics[0];

  const run = useCallback(async () => {
    if (!activeMetric) return;
    setLoading(true);
    try {
      const res = await fetch("/api/analytics/me/query", {
        method: "POST",
        headers: authHeaders,
        body: JSON.stringify({ metric, dimension, period, scope }),
      });
      setData(res.ok ? await res.json() : null);
    } catch {
      setData(null);
    } finally {
      setLoading(false);
    }
  }, [authHeaders, metric, dimension, period, scope, activeMetric]);

  useEffect(() => {
    run();
  }, [run]);

  if (!catalog) {
    return (
      <div className="flex h-[200px] items-center justify-center text-muted-foreground">
        <Loader2 className="h-5 w-5 animate-spin" />
      </div>
    );
  }

  const dims = activeMetric?.dims || [];

  return (
    <div className="rounded-2xl border border-[var(--border)] bg-card p-5">
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <div>
          <h3 className="text-[15px] font-semibold text-foreground">My analytics</h3>
          <p className="text-[12px] text-muted-foreground">
            Your leave activity{catalog.has_team ? " — switch to My team for your reports" : ""}.
          </p>
        </div>
        {/* Scope toggle */}
        <div className="flex rounded-xl border border-[var(--border)] overflow-hidden">
          {(["me", ...(catalog.has_team ? ["my-team"] : [])] as const).map((s) => (
            <button
              key={s}
              onClick={() => setScope(s as "me" | "my-team")}
              className={cn(
                "flex items-center gap-1.5 px-3 py-1.5 text-[12px] font-medium transition-colors",
                scope === s
                  ? "bg-primary/10 text-primary"
                  : "text-muted-foreground hover:text-foreground",
              )}
            >
              {s === "me" ? <User className="h-3.5 w-3.5" /> : <Users className="h-3.5 w-3.5" />}
              {s === "me" ? "Me" : "My team"}
            </button>
          ))}
        </div>
      </div>

      <div className="mb-4 flex flex-wrap gap-3">
        <select
          value={metric}
          onChange={(e) => {
            setMetric(e.target.value);
          }}
          className={selectCls}
        >
          {catalog.metrics.map((m) => (
            <option key={m.id} value={m.id}>
              {m.label}
            </option>
          ))}
        </select>
        <select
          value={dimension}
          onChange={(e) => setDimension(e.target.value)}
          className={selectCls}
        >
          {dims.map((d) => (
            <option key={d} value={d}>
              {DIM_LABELS[d] || d}
            </option>
          ))}
        </select>
        <select value={period} onChange={(e) => setPeriod(e.target.value)} className={selectCls}>
          {catalog.periods.map((p) => (
            <option key={p} value={p}>
              {p}
            </option>
          ))}
        </select>
      </div>

      {loading ? (
        <div className="flex h-[260px] items-center justify-center">
          <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
        </div>
      ) : data && (data.series || []).length > 0 ? (
        <MetricChart
          chartType={activeMetric?.chart_hint || "bar"}
          series={data.series}
          unit={data.unit}
        />
      ) : (
        <div className="flex h-[200px] items-center justify-center text-[13px] text-muted-foreground">
          No leave data for this {scope === "me" ? "view" : "team"} in the selected period.
        </div>
      )}
    </div>
  );
}

const selectCls =
  "rounded-xl border border-[var(--border)] bg-background px-3 py-2 text-[13px] text-foreground focus:outline-none focus:ring-1 focus:ring-primary";
