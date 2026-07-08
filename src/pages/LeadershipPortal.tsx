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
  Users,
  TrendingUp,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { toast } from "sonner";
import { motion } from "framer-motion";
import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell } from "@/components/ui/table";

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
  if (n === 0) return "bg-slate-100 dark:bg-zinc-900 text-muted-foreground/30";
  if (n <= 2) return "bg-rose-500/15 text-rose-600 dark:text-rose-400 border border-rose-500/20";
  if (n <= 5) return "bg-amber-500/15 text-amber-600 dark:text-amber-400";
  return "bg-emerald-500/15 text-emerald-600 dark:text-emerald-400";
};

function CircleGauge({ pct }: { pct: number }) {
  const r = 13;
  const circumference = 2 * Math.PI * r;
  const filled = (Math.min(pct, 100) / 100) * circumference;
  const stroke = pct >= 75 ? "#10b981" : pct >= 40 ? "#f59e0b" : "#f43f5e";
  return (
    <svg width="72" height="72" viewBox="0 0 36 36" className="shrink-0">
      <circle
        cx="18"
        cy="18"
        r={r}
        fill="none"
        className="stroke-slate-200 dark:stroke-zinc-800"
        strokeWidth="3"
      />
      <circle
        cx="18"
        cy="18"
        r={r}
        fill="none"
        stroke={stroke}
        strokeWidth="3"
        strokeDasharray={`${filled} ${circumference}`}
        strokeLinecap="round"
        transform="rotate(-90 18 18)"
        style={{ transition: "stroke-dasharray 0.7s ease" }}
      />
    </svg>
  );
}

function KPIStat({
  label,
  value,
  sub,
  icon: Icon,
  color,
}: {
  label: string;
  value: string;
  sub?: string;
  icon: typeof Gauge;
  color: "cyan" | "emerald" | "amber" | "rose";
}) {
  const cls = {
    cyan: {
      grad: "from-cyan-500 to-blue-600",
      text: "text-cyan-600 dark:text-cyan-400",
    },
    emerald: {
      grad: "from-emerald-500 to-teal-600",
      text: "text-emerald-600 dark:text-emerald-400",
    },
    amber: {
      grad: "from-amber-500 to-orange-500",
      text: "text-amber-600 dark:text-amber-400",
    },
    rose: {
      grad: "from-rose-500 to-red-600",
      text: "text-rose-600 dark:text-rose-400",
    },
  }[color];

  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.3 }}
      className="rounded-2xl border border-slate-200/60 dark:border-white/[0.04] bg-white/70 dark:bg-zinc-900/40 shadow-sm p-4 backdrop-blur-sm flex items-center gap-3"
    >
      <div
        className={cn(
          "h-10 w-10 rounded-xl bg-gradient-to-tr flex items-center justify-center shrink-0 shadow-sm",
          cls.grad,
        )}
      >
        <Icon className="h-5 w-5 text-white" />
      </div>
      <div className="min-w-0">
        <div className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground/60">
          {label}
        </div>
        <div className={cn("text-xl font-black tracking-tight mt-0.5", cls.text)}>{value}</div>
        {sub && <div className="text-[10px] text-muted-foreground mt-0.5">{sub}</div>}
      </div>
    </motion.div>
  );
}

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
      const res = await fetch(`/api/portal/leadership/capability-command`, {
        headers: authHeaders,
      });
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
      {/* Header */}
      <div className="px-4 sm:px-8 pt-5 sm:pt-6 pb-4 border-b border-slate-200/80 dark:border-white/[0.05] bg-white/40 dark:bg-zinc-950/20 backdrop-blur-md shrink-0 flex flex-wrap items-start justify-between gap-3 z-10">
        <div>
          <div className="flex items-center gap-2">
            <div className="h-7 w-7 rounded-lg bg-gradient-to-tr from-cyan-500 to-blue-600 flex items-center justify-center shadow-lg">
              <Gauge className="h-4 w-4 text-white" />
            </div>
            <span className="text-[10px] font-extrabold uppercase tracking-[0.2em] bg-gradient-to-r from-cyan-500 to-blue-500 bg-clip-text text-transparent">
              Leadership
            </span>
          </div>
          <p className="text-[13px] text-muted-foreground mt-0.5 max-w-2xl leading-relaxed">
            Org-wide workforce intelligence — capability, pipeline readiness, single-point-of-failure
            risk, and bench cost.
          </p>
        </div>
        <button
          onClick={fetch_}
          className="flex items-center gap-1.5 text-[12px] font-semibold text-muted-foreground hover:text-foreground bg-white dark:bg-zinc-900 border border-slate-200/80 dark:border-zinc-800 px-3 py-1.5 rounded-lg transition-colors shadow-sm cursor-pointer shrink-0"
        >
          <RefreshCw className="h-3 w-3" />
          Refresh
        </button>
      </div>

      <div className="flex-1 overflow-auto px-4 sm:px-8 py-5 sm:py-6 relative z-10">
        {loading ? (
          <div className="flex flex-col h-60 items-center justify-center gap-3">
            <div className="w-12 h-12 rounded-2xl bg-cyan-500/10 flex items-center justify-center">
              <Loader2 className="h-6 w-6 animate-spin text-cyan-500" />
            </div>
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
          <>
            {/* KPI summary row */}
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3 mb-6">
              <KPIStat
                label="People in Scope"
                value={data.headcount?.toLocaleString() ?? "—"}
                icon={Users}
                color="cyan"
              />
              <KPIStat
                label="Pipeline Ready"
                value={`${Math.round(pr?.overall_readiness_pct ?? 0)}%`}
                icon={TrendingUp}
                color={
                  (pr?.overall_readiness_pct ?? 0) >= 75
                    ? "emerald"
                    : (pr?.overall_readiness_pct ?? 0) >= 40
                      ? "amber"
                      : "rose"
                }
              />
              <KPIStat
                label="On Bench"
                value={String(bc?.bench_headcount ?? 0)}
                sub={bc ? money(bc.monthly_bench_cost, bc.currency) + "/mo" : undefined}
                icon={Wallet}
                color="amber"
              />
              <KPIStat
                label="SPOF Risks"
                value={String(spof?.count ?? 0)}
                icon={ShieldAlert}
                color={(spof?.count ?? 0) === 0 ? "emerald" : (spof?.count ?? 0) > 5 ? "rose" : "amber"}
              />
            </div>

            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
              {/* Pipeline Readiness */}
              <Panel title="Pipeline Readiness" icon={Gauge} accent="cyan">
                <div className="flex flex-wrap items-center gap-4 mb-5">
                  <CircleGauge pct={pr?.overall_readiness_pct ?? 0} />
                  <div>
                    <div
                      className={cn(
                        "text-3xl font-black",
                        readinessColor(pr?.overall_readiness_pct ?? 0),
                      )}
                    >
                      {Math.round(pr?.overall_readiness_pct ?? 0)}%
                    </div>
                    <div className="text-[11px] text-muted-foreground leading-relaxed mt-0.5 max-w-[180px]">
                      staffable from current free capacity
                      {pr?.next_snapshot ? ` · demand as of ${pr.next_snapshot}` : ""}
                    </div>
                  </div>
                </div>
                <div className="space-y-2.5 max-h-56 overflow-auto pr-1">
                  {(pr?.rows ?? []).map((r) => (
                    <div key={r.function}>
                      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 mb-1">
                        <span
                          className="text-xs font-medium text-foreground/90 truncate max-w-[160px]"
                          title={r.function}
                        >
                          {r.function}
                        </span>
                        <span className="text-[10px] font-mono text-muted-foreground shrink-0 ml-2">
                          {r.free_supply}/{r.planned_demand}
                          {r.gap > 0 && <span className="text-rose-500"> -{r.gap}</span>}
                        </span>
                      </div>
                      <div className="h-1.5 bg-slate-200 dark:bg-zinc-800 rounded-full overflow-hidden">
                        <motion.div
                          className={cn(
                            "h-full rounded-full",
                            r.readiness_pct >= 75
                              ? "bg-emerald-500"
                              : r.readiness_pct >= 40
                                ? "bg-amber-500"
                                : "bg-rose-500",
                          )}
                          initial={{ width: 0 }}
                          animate={{ width: `${Math.min(r.readiness_pct, 100)}%` }}
                          transition={{ duration: 0.6, ease: "easeOut" }}
                        />
                      </div>
                    </div>
                  ))}
                  {(pr?.rows ?? []).length === 0 && (
                    <p className="text-xs text-muted-foreground/70">
                      No forward-planned demand found.
                    </p>
                  )}
                </div>
              </Panel>

              {/* Bench Cost & Opportunity */}
              <Panel title="Bench Cost & Opportunity" icon={Wallet} accent="amber">
                <div className="rounded-2xl bg-gradient-to-br from-amber-500/10 to-orange-500/5 border border-amber-500/20 p-4 mb-4 flex flex-wrap items-center justify-between gap-3">
                  <div>
                    <div className="text-[10px] font-bold uppercase tracking-wider text-amber-600/70 dark:text-amber-500/60 mb-1">
                      Monthly Bench Cost
                    </div>
                    <div className="text-[28px] font-black leading-none text-amber-600 dark:text-amber-400">
                      {bc ? money(bc.monthly_bench_cost, bc.currency) : "—"}
                    </div>
                  </div>
                  <div className="text-right space-y-2">
                    <div>
                      <div className="text-[10px] text-muted-foreground/60 uppercase tracking-wide font-semibold">
                        On Bench
                      </div>
                      <div className="text-lg font-black text-foreground">
                        {bc?.bench_headcount ?? 0}
                      </div>
                    </div>
                    <div>
                      <div className="text-[10px] text-muted-foreground/60 uppercase tracking-wide font-semibold">
                        Idle hrs/mo
                      </div>
                      <div className="text-lg font-black text-foreground">
                        {Math.round(bc?.idle_hours_per_month ?? 0).toLocaleString()}
                      </div>
                    </div>
                  </div>
                </div>
                <div className="text-[10px] font-bold text-muted-foreground/60 uppercase tracking-wider mb-2">
                  Top training opportunities
                </div>
                <div className="space-y-1.5">
                  {(bc?.opportunities ?? []).map((o) => (
                    <div
                      key={o.training}
                      className="flex flex-col md:flex-row md:items-center justify-between gap-4 gap-2 text-xs bg-slate-50/60 dark:bg-zinc-950/20 rounded-xl px-3 py-2.5 border border-slate-100 dark:border-zinc-800/40 hover:border-amber-400/40 transition-colors"
                    >
                      <span className="flex items-center gap-1.5 font-medium text-foreground truncate">
                        <GraduationCap className="h-3.5 w-3.5 text-amber-500 shrink-0" />
                        {o.training}
                      </span>
                      <span className="text-[10px] font-bold text-amber-600 dark:text-amber-400 whitespace-nowrap bg-amber-500/10 px-1.5 py-0.5 rounded-md shrink-0">
                        +{o.would_help}
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

              {/* Capability Heat Map — full width */}
              <div className="lg:col-span-2">
                <Panel title="Capability Heat Map" icon={Grid3x3} accent="indigo">
                  {hm && hm.matrix.length > 0 ? (
                    <>
                      <div className="overflow-auto max-h-80 rounded-xl border border-slate-200/50 dark:border-zinc-800/50">
                        <Table paginate itemsPerPage={10} className="w-full border-collapse text-[11px]">
                          <TableHeader className="sticky top-0 z-10">
                            <TableRow className="bg-gradient-to-r from-indigo-500/5 to-violet-500/5 border-b border-slate-200/60 dark:border-zinc-800/60">
                              <TableHead className="text-left py-2 px-3 text-muted-foreground/70 font-bold sticky left-0 bg-white dark:bg-zinc-950 z-20 border-r border-slate-100 dark:border-zinc-800/40">
                                Skill
                              </TableHead>
                              {hm.functions.map((f) => (
                                <TableHead
                                  key={f}
                                  className="py-2 px-2 text-muted-foreground/70 font-semibold text-center"
                                  title={f}
                                >
                                  <span className="block truncate max-w-[72px] mx-auto">{f}</span>
                                </TableHead>
                              ))}
                            </TableRow>
                          </TableHeader>
                          <TableBody>
                            {hm.matrix.map((row, ri) => (
                              <TableRow
                                key={row.skill}
                                className={cn(
                                  ri % 2 === 1 && "bg-slate-50/50 dark:bg-zinc-900/20",
                                )}
                              >
                                <TableCell className="py-1.5 px-3 font-semibold text-foreground/90 sticky left-0 bg-white dark:bg-zinc-950 truncate max-w-[140px] border-r border-slate-100 dark:border-zinc-800/40">
                                  {row.skill}
                                </TableCell>
                                {row.cells.map((c) => (
                                  <TableCell key={c.function} className="py-1 px-1 text-center">
                                    <span
                                      className={cn(
                                        "inline-flex items-center justify-center h-6 w-8 rounded-lg font-bold",
                                        heatColor(c.count),
                                      )}
                                    >
                                      {c.count || "·"}
                                    </span>
                                  </TableCell>
                                ))}
                              </TableRow>
                            ))}
                          </TableBody>
                        </Table>
                      </div>
                      {/* Legend */}
                      <div className="flex items-center gap-4 mt-3 flex-wrap">
                        <span className="text-[10px] text-muted-foreground/60 font-semibold uppercase tracking-wide">
                          Legend:
                        </span>
                        {[
                          {
                            label: "0",
                            cls: "bg-slate-100 dark:bg-zinc-900 text-muted-foreground/40",
                          },
                          {
                            label: "1–2 risk",
                            cls: "bg-rose-500/15 text-rose-600 dark:text-rose-400",
                          },
                          {
                            label: "3–5",
                            cls: "bg-amber-500/15 text-amber-600 dark:text-amber-400",
                          },
                          {
                            label: "6+ healthy",
                            cls: "bg-emerald-500/15 text-emerald-600 dark:text-emerald-400",
                          },
                        ].map((l) => (
                          <span
                            key={l.label}
                            className="inline-flex items-center gap-1.5 text-[10px] font-medium text-muted-foreground"
                          >
                            <span
                              className={cn(
                                "h-4 w-6 rounded-md inline-block",
                                l.cls,
                              )}
                            />
                            {l.label}
                          </span>
                        ))}
                      </div>
                    </>
                  ) : (
                    <p className="text-xs text-muted-foreground/70">
                      Capability matrix populates once skill profiles are synced.
                    </p>
                  )}
                </Panel>
              </div>

              {/* Single Point of Failure — full width */}
              <div className="lg:col-span-2">
                <Panel title="Single-Point-of-Failure Risk" icon={ShieldAlert} accent="rose">
                  <div className="flex items-center gap-3 mb-4">
                    <p className="text-[12px] text-muted-foreground">
                      {spof?.count ?? 0} skill(s) held by 2 people or fewer — delivery & retention
                      risk.
                    </p>
                    {(spof?.count ?? 0) > 0 && (
                      <span
                        className={cn(
                          "text-[10px] font-bold px-2 py-0.5 rounded-full uppercase tracking-wide shrink-0",
                          (spof?.count ?? 0) > 5
                            ? "bg-rose-500/15 text-rose-600 dark:text-rose-400"
                            : "bg-amber-500/15 text-amber-600 dark:text-amber-400",
                        )}
                      >
                        {(spof?.count ?? 0) > 5 ? "Critical" : "High"} Risk
                      </span>
                    )}
                  </div>
                  <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2">
                    {(spof?.rows ?? []).map((r) => (
                      <div
                        key={r.skill}
                        className="flex items-start gap-3 bg-rose-500/[0.04] rounded-xl px-3 py-2.5 border border-rose-500/10 hover:border-rose-500/25 transition-colors"
                      >
                        <div className="flex-1 min-w-0">
                          <div className="font-semibold text-xs text-foreground truncate">
                            {r.skill}
                          </div>
                          <div className="text-[10px] text-muted-foreground mt-0.5 truncate">
                            {r.holders.join(", ") || `${r.holder_count} holder(s)`}
                          </div>
                        </div>
                        <span className="shrink-0 text-[10px] font-bold bg-rose-500/15 text-rose-600 dark:text-rose-400 rounded-lg px-1.5 py-0.5 mt-0.5">
                          {r.holder_count}
                        </span>
                      </div>
                    ))}
                    {(spof?.rows ?? []).length === 0 && (
                      <div className="col-span-full text-xs text-muted-foreground/70 flex items-center gap-2">
                        <span className="h-1.5 w-1.5 rounded-full bg-emerald-500 shrink-0" />
                        No concentration risks detected.
                      </div>
                    )}
                  </div>
                </Panel>
              </div>
            </div>
          </>
        )}
        {data?.generated_on && (
          <div className="mt-6 flex items-center gap-2 text-[11px] text-muted-foreground/60">
            <span className="h-1.5 w-1.5 rounded-full bg-slate-400 shrink-0" />
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
        <div
          className={cn(
            "h-7 w-7 rounded-lg bg-gradient-to-tr flex items-center justify-center shadow-sm",
            accentCls,
          )}
        >
          <Icon className="h-4 w-4 text-white" />
        </div>
        <h2 className="text-sm font-bold text-foreground">{title}</h2>
      </div>
      {children}
    </motion.div>
  );
}
