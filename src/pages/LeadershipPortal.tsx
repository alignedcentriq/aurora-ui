import { useAuth } from "@/lib/auth-store";
import { useState, useEffect, useCallback, useMemo } from "react";
import {
  Loader2,
  RefreshCw,
  AlertTriangle,
  XCircle,
  Gauge,
  Wallet,
  Grid3x3,
  ShieldAlert,
  GraduationCap,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { toast } from "sonner";
import { motion } from "framer-motion";

interface ReadinessRow {
  function: string;
  planned_demand: number;
  free_supply: number;
  gap: number;
  readiness_pct: number;
}
interface HeatCell {
  function: string;
  count: number;
  thin: boolean;
}
interface HeatRow {
  skill: string;
  total: number;
  cells: HeatCell[];
}
interface SpofRow {
  skill: string;
  holder_count: number;
  holders: string[];
}
interface Opportunity {
  training: string;
  would_help: number;
  skills: string[];
}
interface Overview {
  ok: boolean;
  generated_on?: string;
  headcount?: number;
  heatmap?: { functions: string[]; skills: string[]; matrix: HeatRow[] };
  pipeline_readiness?: {
    overall_readiness_pct: number;
    next_snapshot: string | null;
    rows: ReadinessRow[];
  };
  spof?: { count: number; rows: SpofRow[] };
  bench_cost?: {
    currency: string;
    bench_headcount: number;
    idle_hours_per_month: number;
    monthly_bench_cost: number;
    opportunities: Opportunity[];
  };
}

const money = (v: number, cur: string) =>
  `${cur === "INR" ? "₹" : "$"}${Math.round(v).toLocaleString()}`;

const readinessColor = (p: number) =>
  p >= 75
    ? "text-emerald-600 dark:text-emerald-400"
    : p >= 40
      ? "text-amber-600 dark:text-amber-400"
      : "text-rose-600 dark:text-rose-400";

const heatColor = (n: number) => {
  if (n === 0) return "bg-slate-100 dark:bg-zinc-900 text-muted-foreground/40";
  if (n <= 2) return "bg-rose-500/15 text-rose-600 dark:text-rose-400 border border-rose-500/20";
  if (n <= 5) return "bg-amber-500/15 text-amber-600 dark:text-amber-400";
  return "bg-emerald-500/15 text-emerald-600 dark:text-emerald-400";
};

export function LeadershipPortal() {
  const { user } = useAuth();
  const [data, setData] = useState<Overview | null>(null);
  const [loading, setLoading] = useState(true);

  const authHeaders = useMemo(
    () => ({
      "Content-Type": "application/json",
      ...(user?.email ? { "x-user-email": user.email } : {}),
      ...(user?.role ? { "x-user-role": user.role.toLowerCase() } : {}),
    }),
    [user],
  );

  const fetch_ = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch(`/api/portal/leadership/capability-command`, { headers: authHeaders });
      setData(await res.json());
    } catch {
      toast.error("Failed to load capability command");
      setData({ ok: false });
    } finally {
      setLoading(false);
    }
  }, [authHeaders]);

  useEffect(() => {
    Promise.resolve().then(() => fetch_());
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  if (user?.role !== "PMO" && user?.role !== "Admin") {
    return (
      <div className="flex h-full items-center justify-center px-6 text-center">
        <div className="max-w-md p-8 rounded-3xl border border-slate-200/60 dark:border-white/[0.06] bg-white/60 dark:bg-zinc-950/40 backdrop-blur-2xl shadow-elevated">
          <div className="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-2xl bg-destructive/10 text-destructive border border-destructive/20">
            <XCircle className="h-6 w-6" />
          </div>
          <h2 className="text-xl font-bold tracking-tight text-foreground">Access Restricted</h2>
          <p className="text-sm text-muted-foreground mt-2 leading-relaxed">
            The Leadership Capability Command is restricted to PMO and Administrator profiles.
          </p>
        </div>
      </div>
    );
  }

  const pr = data?.pipeline_readiness;
  const bc = data?.bench_cost;
  const hm = data?.heatmap;
  const spof = data?.spof;

  return (
    <div className="flex flex-col h-full overflow-hidden bg-gradient-to-br from-[#f8fafc] to-[#f1f5f9] dark:from-[#030712] dark:to-[#091120] relative">
      <div className="px-8 pt-6 pb-4 border-b border-slate-200/80 dark:border-white/[0.05] bg-white/40 dark:bg-zinc-950/20 backdrop-blur-md shrink-0 flex items-center justify-between gap-4 z-10">
        <div>
          <div className="flex items-center gap-2">
            <div className="h-7 w-7 rounded-lg bg-gradient-to-tr from-cyan-500 to-blue-600 flex items-center justify-center shadow-lg">
              <Gauge className="h-4 w-4 text-white" />
            </div>
            <span className="text-[10px] font-extrabold uppercase tracking-[0.2em] bg-gradient-to-r from-cyan-500 to-blue-500 bg-clip-text text-transparent">
              Leadership
            </span>
          </div>
          <h1 className="text-[24px] font-black tracking-tight text-foreground mt-1">
            Capability Command
          </h1>
          <p className="text-[13px] text-muted-foreground mt-0.5 max-w-2xl leading-relaxed">
            Org-wide workforce intelligence — capability, pipeline readiness, single-point-of-failure
            risk, and bench cost. {data?.headcount ? `${data.headcount} people in scope.` : ""}
          </p>
        </div>
        <button
          onClick={fetch_}
          className="flex items-center gap-1.5 text-[12px] font-semibold text-muted-foreground hover:text-foreground bg-white dark:bg-zinc-900 border border-slate-200/80 dark:border-zinc-800 px-3 py-1.5 rounded-lg transition-colors shadow-sm cursor-pointer"
        >
          <RefreshCw className="h-3 w-3" />
          Refresh
        </button>
      </div>

      <div className="flex-1 overflow-auto px-8 py-6 relative z-10">
        {loading ? (
          <div className="flex flex-col h-60 items-center justify-center gap-3">
            <Loader2 className="h-7 w-7 animate-spin text-blue-500" />
            <span className="text-xs text-muted-foreground/80 font-medium">
              Computing workforce intelligence...
            </span>
          </div>
        ) : !data?.ok ? (
          <div className="flex flex-col h-60 items-center justify-center text-center gap-3">
            <AlertTriangle className="h-6 w-6 text-amber-500/60" />
            <p className="text-xs text-muted-foreground">No data available.</p>
          </div>
        ) : (
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            {/* Pipeline Readiness */}
            <Panel title="Pipeline Readiness" icon={Gauge} accent="cyan">
              <div className="flex items-baseline gap-2 mb-4">
                <span className={cn("text-4xl font-black", readinessColor(pr?.overall_readiness_pct ?? 0))}>
                  {Math.round(pr?.overall_readiness_pct ?? 0)}%
                </span>
                <span className="text-[11px] text-muted-foreground">
                  staffable from current free capacity
                  {pr?.next_snapshot ? ` · demand as of ${pr.next_snapshot}` : ""}
                </span>
              </div>
              <div className="space-y-1.5 max-h-64 overflow-auto pr-1">
                {(pr?.rows ?? []).map((r) => (
                  <div key={r.function} className="flex items-center gap-3 text-xs">
                    <span className="w-40 truncate text-foreground/90" title={r.function}>
                      {r.function}
                    </span>
                    <div className="flex-1 h-2 bg-slate-200 dark:bg-zinc-800 rounded-full overflow-hidden">
                      <div
                        className={cn(
                          "h-full rounded-full",
                          r.readiness_pct >= 75
                            ? "bg-emerald-500"
                            : r.readiness_pct >= 40
                              ? "bg-amber-500"
                              : "bg-rose-500",
                        )}
                        style={{ width: `${Math.min(r.readiness_pct, 100)}%` }}
                      />
                    </div>
                    <span className="w-24 text-right text-muted-foreground font-mono text-[11px]">
                      {r.free_supply}/{r.planned_demand}
                      {r.gap > 0 ? ` (-${r.gap})` : ""}
                    </span>
                  </div>
                ))}
                {(pr?.rows ?? []).length === 0 && (
                  <p className="text-xs text-muted-foreground/70">No forward-planned demand found.</p>
                )}
              </div>
            </Panel>

            {/* Bench Cost & Opportunity */}
            <Panel title="Bench Cost & Opportunity" icon={Wallet} accent="amber">
              <div className="grid grid-cols-3 gap-3 mb-4">
                <Stat label="On Bench" value={`${bc?.bench_headcount ?? 0}`} />
                <Stat label="Idle hrs/mo" value={`${Math.round(bc?.idle_hours_per_month ?? 0).toLocaleString()}`} />
                <Stat
                  label="Monthly cost"
                  value={bc ? money(bc.monthly_bench_cost, bc.currency) : "—"}
                  emphasis
                />
              </div>
              <div className="text-[10px] font-bold text-muted-foreground/60 uppercase tracking-wider mb-2">
                Top training opportunities
              </div>
              <div className="space-y-1.5">
                {(bc?.opportunities ?? []).map((o) => (
                  <div
                    key={o.training}
                    className="flex items-center justify-between gap-2 text-xs bg-slate-50/60 dark:bg-zinc-950/20 rounded-lg px-3 py-2 border border-slate-100 dark:border-zinc-800/40"
                  >
                    <span className="flex items-center gap-1.5 font-medium text-foreground truncate">
                      <GraduationCap className="h-3.5 w-3.5 text-amber-500 shrink-0" />
                      {o.training}
                    </span>
                    <span className="text-[11px] text-muted-foreground whitespace-nowrap">
                      unlocks {o.would_help}
                    </span>
                  </div>
                ))}
                {(bc?.opportunities ?? []).length === 0 && (
                  <p className="text-xs text-muted-foreground/70">
                    No course opportunities (needs synced skill profiles).
                  </p>
                )}
              </div>
            </Panel>

            {/* Capability Heat Map */}
            <Panel title="Capability Heat Map" icon={Grid3x3} accent="indigo">
              {hm && hm.matrix.length > 0 ? (
                <div className="overflow-auto max-h-72">
                  <table className="w-full border-collapse text-[11px]">
                    <thead>
                      <tr>
                        <th className="text-left py-1.5 px-2 text-muted-foreground/70 font-bold sticky left-0 bg-white dark:bg-zinc-950">
                          Skill
                        </th>
                        {hm.functions.map((f) => (
                          <th
                            key={f}
                            className="py-1.5 px-1.5 text-muted-foreground/70 font-semibold text-center max-w-[70px] truncate"
                            title={f}
                          >
                            {f}
                          </th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {hm.matrix.map((row) => (
                        <tr key={row.skill}>
                          <td className="py-1 px-2 font-semibold text-foreground sticky left-0 bg-white dark:bg-zinc-950 truncate max-w-[120px]">
                            {row.skill}
                          </td>
                          {row.cells.map((c) => (
                            <td key={c.function} className="py-1 px-1 text-center">
                              <span
                                className={cn(
                                  "inline-flex items-center justify-center h-6 w-7 rounded-md font-bold",
                                  heatColor(c.count),
                                )}
                              >
                                {c.count || ""}
                              </span>
                            </td>
                          ))}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              ) : (
                <p className="text-xs text-muted-foreground/70">
                  Capability matrix populates once skill profiles are synced.
                </p>
              )}
            </Panel>

            {/* Single Point of Failure */}
            <Panel title="Single-Point-of-Failure Risk" icon={ShieldAlert} accent="rose">
              <p className="text-[11px] text-muted-foreground mb-3">
                {spof?.count ?? 0} skill(s) held by 2 people or fewer — delivery & retention risk.
              </p>
              <div className="space-y-1.5 max-h-64 overflow-auto pr-1">
                {(spof?.rows ?? []).map((r) => (
                  <div
                    key={r.skill}
                    className="flex items-center justify-between gap-2 text-xs bg-rose-500/[0.04] rounded-lg px-3 py-2 border border-rose-500/10"
                  >
                    <span className="font-semibold text-foreground truncate">{r.skill}</span>
                    <span className="text-[10px] text-muted-foreground truncate max-w-[55%]">
                      {r.holders.join(", ") || `${r.holder_count} holder(s)`}
                    </span>
                  </div>
                ))}
                {(spof?.rows ?? []).length === 0 && (
                  <p className="text-xs text-muted-foreground/70">No concentration risks detected.</p>
                )}
              </div>
            </Panel>
          </div>
        )}
        {data?.generated_on && (
          <div className="mt-6 flex items-center gap-2 text-[11px] text-muted-foreground/60">
            <span className="h-1.5 w-1.5 rounded-full bg-slate-400" />
            All figures computed from live allocation, skills, and the ROI cost model · Generated{" "}
            {data.generated_on}
          </div>
        )}
      </div>
    </div>
  );
}

function Panel({
  title,
  icon: Icon,
  accent,
  children,
}: {
  title: string;
  icon: typeof Gauge;
  accent: "cyan" | "amber" | "indigo" | "rose";
  children: React.ReactNode;
}) {
  const accentCls = {
    cyan: "from-cyan-500 to-blue-600",
    amber: "from-amber-500 to-orange-600",
    indigo: "from-indigo-500 to-violet-600",
    rose: "from-rose-500 to-red-600",
  }[accent];
  return (
    <motion.div
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.3 }}
      className="rounded-2xl border border-slate-200/60 dark:border-white/[0.04] bg-white/60 dark:bg-zinc-900/35 shadow-sm p-5 backdrop-blur-sm"
    >
      <div className="flex items-center gap-2 mb-4">
        <div className={cn("h-7 w-7 rounded-lg bg-gradient-to-tr flex items-center justify-center", accentCls)}>
          <Icon className="h-4 w-4 text-white" />
        </div>
        <h2 className="text-sm font-bold text-foreground">{title}</h2>
      </div>
      {children}
    </motion.div>
  );
}

function Stat({ label, value, emphasis }: { label: string; value: string; emphasis?: boolean }) {
  return (
    <div className="rounded-xl bg-slate-50/60 dark:bg-zinc-950/20 border border-slate-100 dark:border-zinc-800/40 p-3">
      <div className="text-[10px] font-bold text-muted-foreground/60 uppercase tracking-wider">
        {label}
      </div>
      <div className={cn("mt-1 font-black tracking-tight", emphasis ? "text-lg text-rose-600 dark:text-rose-400" : "text-lg text-foreground")}>
        {value}
      </div>
    </div>
  );
}
