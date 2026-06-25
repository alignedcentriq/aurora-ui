import { useAuth } from "@/lib/auth-store";
import { useState, useEffect, useCallback, useMemo } from "react";
import {
  Check,
  X,
  Loader2,
  RefreshCw,
  Clock,
  CheckCircle2,
  XCircle,
  Calendar,
  GraduationCap,
  TrendingUp,
  ShoppingBag,
  UserCheck,
  BookOpen,
  Layers,
  AlertTriangle,
  HelpCircle,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { toast } from "sonner";
import { flyBanner } from "@/lib/fly-banner";
import { motion, AnimatePresence } from "framer-motion";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";

const STATUS_BADGE: Record<string, string> = {
  Pending: "bg-amber-500/10 text-amber-500 border border-amber-500/20 dark:bg-amber-500/5",
  Approved: "bg-emerald-500/10 text-emerald-500 border border-emerald-500/20 dark:bg-emerald-500/5",
  Rejected: "bg-rose-500/10 text-rose-500 border border-rose-500/20 dark:bg-rose-500/5",
};

const ACTION_BADGE: Record<string, string> = {
  BUY: "bg-rose-500/10 text-rose-600 dark:text-rose-400 border border-rose-500/20 shadow-sm shadow-rose-500/5",
  TRAIN:
    "bg-amber-500/10 text-amber-600 dark:text-amber-400 border border-amber-500/20 shadow-sm shadow-amber-500/5",
  REDEPLOY:
    "bg-indigo-500/10 text-indigo-600 dark:text-indigo-400 border border-indigo-500/20 shadow-sm shadow-indigo-500/5",
  STAFFABLE:
    "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border border-emerald-500/20 shadow-sm shadow-emerald-500/5",
};

// Generates beautiful gradients based on unique employee names
const getAvatarGradient = (name: string) => {
  const hash = name.split("").reduce((acc, char) => acc + char.charCodeAt(0), 0);
  const gradients = [
    "from-pink-500 to-violet-600",
    "from-blue-500 to-cyan-500",
    "from-emerald-500 to-teal-600",
    "from-amber-500 to-orange-600",
    "from-indigo-500 to-purple-600",
    "from-rose-500 to-red-600",
  ];
  return gradients[hash % gradients.length];
};

interface SkillSupplyRow {
  skill_id: number;
  skill_name: string;
  demand: number;
  coverage_count: number;
  deployable_count: number;
  locked_count: number;
  deployable_names: string[];
  rolling_off: { name: string; date: string }[];
  action: string;
  rationale: string;
}

interface SkillSupplyResult {
  ok: boolean;
  message?: string;
  note?: string;
  generated_on?: string;
  summary?: Record<string, number>;
  rows?: SkillSupplyRow[];
}

interface UdemyRequest {
  id: number;
  employee_name: string;
  employee_email: string;
  platform: string;
  course_name: string;
  justification: string;
  status: string;
  decided_by: string;
  decision_reason: string;
  created_at: string | null;
}

const TABS = [
  { key: "skill-supply", label: "Skill Supply" },
  { key: "bench-upskill", label: "Bench → Upskill" },
  { key: "udemy", label: "License Requests" },
] as const;
type TabKey = (typeof TABS)[number]["key"];

const TAB_SUBTITLE: Record<TabKey, string> = {
  "skill-supply":
    "In-demand skills we can't staff — market demand crossed with live capacity & availability.",
  "bench-upskill":
    "Turn idle bench time into capability — each person matched to a course teaching an in-demand skill they lack.",
  udemy: "Review, approve or decline training-program license requests (Udemy, Coursera).",
};

const TAB_ICON: Record<TabKey, typeof TrendingUp> = {
  "skill-supply": TrendingUp,
  "bench-upskill": GraduationCap,
  udemy: BookOpen,
};

export function PMOPortal() {
  const { user } = useAuth();
  const [tab, setTab] = useState<TabKey>("skill-supply");

  const authHeaders = useMemo(
    () => ({
      "Content-Type": "application/json",
      ...(user?.email ? { "x-user-email": user.email } : {}),
      ...(user?.role ? { "x-user-role": user.role.toLowerCase() } : {}),
    }),
    [user],
  );

  if (user?.role !== "PMO" && user?.role !== "Admin") {
    return (
      <div className="flex h-full items-center justify-center bg-gradient-to-br from-[#f5f7fa] to-[#e8eef8] dark:from-[#020d1a] dark:to-[#071428] px-6 text-center">
        <motion.div
          initial={{ opacity: 0, scale: 0.95 }}
          animate={{ opacity: 1, scale: 1 }}
          className="max-w-md p-8 rounded-3xl border border-slate-200/60 dark:border-white/[0.06] bg-white/60 dark:bg-zinc-950/40 backdrop-blur-2xl shadow-elevated"
        >
          <div className="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-2xl bg-destructive/10 text-destructive border border-destructive/20 shadow-[0_0_15px_rgba(239,68,68,0.1)]">
            <XCircle className="h-6 w-6" />
          </div>
          <h2 className="text-xl font-bold tracking-tight text-foreground">Access Restricted</h2>
          <p className="text-sm text-muted-foreground mt-2 leading-relaxed">
            This operational dashboard is restricted to the Program Management Office (PMO) team.
            Please log in with a PMO or Administrator profile to gain access.
          </p>
        </motion.div>
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full overflow-hidden bg-gradient-to-br from-[#f8fafc] to-[#f1f5f9] dark:from-[#030712] dark:to-[#091120] relative">
      {/* Visual background lights */}
      <div className="absolute top-0 right-0 w-[450px] h-[350px] bg-gradient-to-br from-violet-500/5 to-indigo-500/5 rounded-full blur-[110px] pointer-events-none" />
      <div className="absolute bottom-0 left-0 w-[350px] h-[350px] bg-gradient-to-tr from-cyan-500/3 to-primary/3 rounded-full blur-[90px] pointer-events-none" />

      {/* Modern Header */}
      <div className="px-8 pt-6 pb-2 border-b border-slate-200/80 dark:border-white/[0.05] bg-white/40 dark:bg-zinc-950/20 backdrop-blur-md shrink-0 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 z-10">
        <div>
          <div className="flex items-center gap-2">
            <div className="h-7 w-7 rounded-lg bg-gradient-to-tr from-violet-500 to-indigo-600 flex items-center justify-center shadow-lg shadow-indigo-500/10">
              <Layers className="h-4 w-4 text-white" />
            </div>
            <span className="text-[10px] font-extrabold uppercase tracking-[0.2em] bg-gradient-to-r from-violet-500 to-indigo-500 bg-clip-text text-transparent">
              Program Management Office
            </span>
          </div>
          <h1 className="text-[24px] font-black tracking-tight text-foreground mt-1 bg-gradient-to-r from-foreground via-foreground/90 to-foreground/75 bg-clip-text">
            PMO Portal
          </h1>
          <p className="text-[13px] text-muted-foreground mt-0.5 max-w-2xl leading-relaxed">
            {TAB_SUBTITLE[tab]}
          </p>
        </div>

        {/* Tab Selector pills with Framer Motion backdrop slider */}
        <div className="bg-slate-100 dark:bg-zinc-900 border border-slate-200/60 dark:border-zinc-800 p-1 rounded-xl flex gap-1 self-start sm:self-center relative shadow-inner">
          {TABS.map((t) => {
            const isActive = tab === t.key;
            return (
              <button
                key={t.key}
                onClick={() => setTab(t.key)}
                className={cn(
                  "relative px-4.5 py-2 text-[12px] font-bold transition-all duration-200 rounded-lg select-none z-10 cursor-pointer",
                  isActive
                    ? "text-foreground dark:text-white"
                    : "text-muted-foreground hover:text-foreground",
                )}
              >
                {isActive && (
                  <motion.span
                    layoutId="pmoTabActive"
                    className="absolute inset-0 bg-white dark:bg-zinc-800 rounded-lg shadow-sm border border-slate-200/50 dark:border-zinc-700/50"
                    transition={{ type: "spring", stiffness: 380, damping: 30 }}
                  />
                )}
                <span className="relative z-20 flex items-center gap-1.5">
                  {(() => {
                    const Icon = TAB_ICON[t.key];
                    return <Icon className="h-3.5 w-3.5" />;
                  })()}
                  {t.label}
                </span>
              </button>
            );
          })}
        </div>
      </div>

      {/* Main Content Pane */}
      <div className="flex-1 overflow-auto px-8 py-6 relative z-10">
        <AnimatePresence mode="wait">
          <motion.div
            key={tab}
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -12 }}
            transition={{ duration: 0.22, ease: "easeOut" }}
            className="h-full"
          >
            {tab === "skill-supply" ? (
              <SkillSupplyTab authHeaders={authHeaders} />
            ) : tab === "bench-upskill" ? (
              <BenchUpskillTab authHeaders={authHeaders} />
            ) : (
              <UdemyTab authHeaders={authHeaders} />
            )}
          </motion.div>
        </AnimatePresence>
      </div>
    </div>
  );
}

// ── Skill Supply Subtab Component ───────────────────────────────────────────
function SkillSupplyTab({ authHeaders }: { authHeaders: Record<string, string> }) {
  const [data, setData] = useState<SkillSupplyResult | null>(null);
  const [loading, setLoading] = useState(true);

  const fetch_ = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch(`/api/portal/pmo/skill-supply?top_n=12`, { headers: authHeaders });
      setData(await res.json());
    } catch {
      toast.error("Failed to load skill-supply analysis");
      setData({ ok: false, message: "Failed to load skill-supply analysis." });
    } finally {
      setLoading(false);
    }
  }, [authHeaders]);

  useEffect(() => {
    Promise.resolve().then(() => fetch_());
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  if (loading) {
    return (
      <div className="flex flex-col h-60 items-center justify-center gap-3">
        <Loader2 className="h-7 w-7 animate-spin text-indigo-500" />
        <span className="text-xs text-muted-foreground/80 font-medium">
          Analyzing demand indexes...
        </span>
      </div>
    );
  }
  if (!data?.ok) {
    return (
      <div className="flex flex-col h-60 items-center justify-center text-center max-w-md mx-auto gap-3">
        <AlertTriangle className="h-6 w-6 text-amber-500/60" />
        <p className="text-xs text-muted-foreground leading-relaxed">
          {data?.message || "No data available."}
        </p>
      </div>
    );
  }

  const rows = data.rows ?? [];
  const s = data.summary ?? {};

  // Custom styled cards for summary metrics
  const cards = [
    {
      label: "Buy Actions",
      n: s.buy ?? 0,
      desc: "Resource acquisition required",
      icon: ShoppingBag,
      glow: "from-rose-500/10 to-transparent",
      iconCls: "bg-rose-500/10 text-rose-500 dark:text-rose-400 border border-rose-500/15",
    },
    {
      label: "Train Path",
      n: s.train ?? 0,
      desc: "Requires candidate upskilling",
      icon: GraduationCap,
      glow: "from-amber-500/10 to-transparent",
      iconCls: "bg-amber-500/10 text-amber-500 dark:text-amber-400 border border-amber-500/15",
    },
    {
      label: "Redeployments",
      n: s.redeploy ?? 0,
      desc: "Resources roll off dates soon",
      icon: RefreshCw,
      glow: "from-indigo-500/10 to-transparent",
      iconCls: "bg-indigo-500/10 text-indigo-500 dark:text-indigo-400 border border-indigo-500/15",
    },
    {
      label: "Staffable Gaps",
      n: s.staffable ?? 0,
      desc: "Direct bench allocation ready",
      icon: UserCheck,
      glow: "from-emerald-500/10 to-transparent",
      iconCls:
        "bg-emerald-500/10 text-emerald-500 dark:text-emerald-400 border border-emerald-500/15",
    },
  ];

  return (
    <div className="space-y-6">
      {/* Statistics Cards Grid */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-5">
        {cards.map((c, idx) => {
          const CardIcon = c.icon;
          return (
            <motion.div
              initial={{ opacity: 0, y: 12 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: idx * 0.04, duration: 0.3 }}
              key={c.label}
              className="relative overflow-hidden rounded-2xl border p-5 bg-white/60 dark:bg-zinc-900/35 border-slate-200/60 dark:border-white/[0.04] shadow-sm hover:shadow-md hover:border-slate-300 dark:hover:border-white/[0.08] transition-all duration-300 group"
            >
              {/* Glow accent */}
              <div
                className={cn(
                  "absolute -right-10 -top-10 w-28 h-28 bg-gradient-radial blur-2xl opacity-20 pointer-events-none",
                  c.glow,
                )}
              />

              <div className="flex items-center justify-between">
                <span className="text-[11px] font-bold text-muted-foreground uppercase tracking-wider">
                  {c.label}
                </span>
                <div
                  className={cn(
                    "p-2 rounded-xl transition-transform duration-300 group-hover:scale-105",
                    c.iconCls,
                  )}
                >
                  <CardIcon className="h-4 w-4" />
                </div>
              </div>

              <div className="mt-4 flex items-baseline gap-1.5">
                <span className="text-3xl font-black tracking-tight text-foreground">{c.n}</span>
                <span className="text-[11px] font-medium text-muted-foreground">skills</span>
              </div>

              <p className="mt-1 text-[11px] text-muted-foreground/80 leading-snug">{c.desc}</p>
            </motion.div>
          );
        })}
      </div>

      {/* Main Table Title / Actions */}
      <div className="flex items-center justify-between">
        <h2 className="text-xs font-bold uppercase tracking-wider text-muted-foreground flex items-center gap-1.5">
          <span className="h-2 w-2 rounded-full bg-indigo-500 animate-pulse" />
          Skill Availability Gaps Analysis
        </h2>
        <button
          onClick={fetch_}
          className="flex items-center gap-1.5 text-[12px] font-semibold text-muted-foreground hover:text-foreground bg-white dark:bg-zinc-900 border border-slate-200/80 dark:border-zinc-800 px-3 py-1.5 rounded-lg transition-colors shadow-sm cursor-pointer"
        >
          <RefreshCw className="h-3 w-3" />
          Sync Analysis
        </button>
      </div>

      {/* Skill Supply Table Redesign */}
      {rows.length === 0 ? (
        <div className="flex h-40 items-center justify-center text-xs text-muted-foreground bg-white/30 dark:bg-zinc-950/10 rounded-2xl border border-slate-200/50 dark:border-zinc-800/40">
          No skill gaps reported in system telemetry.
        </div>
      ) : (
        <div className="bg-white/60 dark:bg-zinc-950/20 backdrop-blur-lg border border-slate-200/60 dark:border-white/[0.04] rounded-2xl overflow-hidden shadow-elevated">
          <div className="overflow-x-auto">
            <table className="w-full min-w-[860px] border-collapse text-left text-xs">
              <thead>
                <tr className="border-b border-slate-200/60 dark:border-white/[0.05] bg-slate-50/[0.3] dark:bg-zinc-900/[0.2] select-none">
                  <th className="py-4 px-6 text-[10px] font-extrabold uppercase tracking-[0.1em] text-muted-foreground/80">
                    Skill
                  </th>
                  <th className="py-4 px-6 text-[10px] font-extrabold uppercase tracking-[0.1em] text-muted-foreground/80">
                    Action Required
                  </th>
                  <th className="py-4 px-6 text-[10px] font-extrabold uppercase tracking-[0.1em] text-muted-foreground/80">
                    Market Demand
                  </th>
                  <th className="py-4 px-6 text-[10px] font-extrabold uppercase tracking-[0.1em] text-muted-foreground/80 text-center">
                    Known Capacity
                  </th>
                  <th className="py-4 px-6 text-[10px] font-extrabold uppercase tracking-[0.1em] text-muted-foreground/80">
                    Free Now
                  </th>
                  <th className="py-4 px-6 text-[10px] font-extrabold uppercase tracking-[0.1em] text-muted-foreground/80">
                    Rolling Off
                  </th>
                  <th className="py-4 px-6 text-[10px] font-extrabold uppercase tracking-[0.1em] text-muted-foreground/80">
                    Strategic Rationale
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-200/40 dark:divide-white/[0.03]">
                {rows.map((r) => {
                  const actionClass =
                    ACTION_BADGE[r.action] ??
                    "bg-zinc-500/10 text-zinc-400 border border-zinc-500/20";

                  let ActionIcon = HelpCircle;
                  if (r.action === "BUY") ActionIcon = ShoppingBag;
                  else if (r.action === "TRAIN") ActionIcon = GraduationCap;
                  else if (r.action === "REDEPLOY") ActionIcon = RefreshCw;
                  else if (r.action === "STAFFABLE") ActionIcon = UserCheck;

                  return (
                    <tr
                      key={r.skill_id}
                      className="hover:bg-slate-500/[0.015] dark:hover:bg-white/[0.01] transition-colors duration-150 align-middle"
                    >
                      {/* Skill */}
                      <td className="py-4 px-6">
                        <div className="font-bold text-sm text-foreground tracking-tight flex items-center gap-2">
                          <span className="w-1.5 h-1.5 rounded-full bg-indigo-500 shadow-sm shadow-indigo-500/50" />
                          {r.skill_name}
                        </div>
                      </td>

                      {/* Action */}
                      <td className="py-4 px-6">
                        <span
                          className={cn(
                            "inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-[10px] font-extrabold uppercase tracking-wider select-none",
                            actionClass,
                          )}
                        >
                          <ActionIcon className="h-3 w-3" />
                          {r.action}
                        </span>
                      </td>

                      {/* Market Demand Index with progress meter */}
                      <td className="py-4 px-6">
                        <div className="flex flex-col gap-1 max-w-[130px]">
                          <div className="flex justify-between items-center text-xs font-bold text-foreground">
                            <span>{Math.round(r.demand)}</span>
                            <span className="text-[9px] text-muted-foreground/70 uppercase font-semibold">
                              Score
                            </span>
                          </div>
                          <div className="w-full h-1.5 bg-slate-200 dark:bg-zinc-800 rounded-full overflow-hidden shadow-inner">
                            <div
                              className="h-full bg-gradient-to-r from-violet-500 to-indigo-500 rounded-full transition-all duration-500"
                              style={{ width: `${Math.min(Math.round(r.demand), 100)}%` }}
                            />
                          </div>
                        </div>
                      </td>

                      {/* Known capacity count */}
                      <td className="py-4 px-6 text-center">
                        <span className="inline-flex items-center justify-center px-2 py-0.5 text-xs font-extrabold text-slate-700 dark:text-zinc-300 bg-slate-100 dark:bg-zinc-800/80 border border-slate-200/50 dark:border-zinc-700/50 rounded-md min-w-8 shadow-sm">
                          {r.coverage_count}
                        </span>
                      </td>

                      {/* Free Now with mini Avatars */}
                      <td className="py-4 px-6">
                        <div className="flex items-center gap-2">
                          <span
                            className={cn(
                              "text-xs font-extrabold px-2 py-0.5 rounded-md min-w-[28px] text-center border shadow-sm",
                              r.deployable_count > 0
                                ? "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border-emerald-500/20"
                                : "bg-slate-50 dark:bg-zinc-900 text-muted-foreground border-slate-200/40 dark:border-zinc-800/40",
                            )}
                          >
                            {r.deployable_count}
                          </span>

                          {r.deployable_count > 0 && r.deployable_names && (
                            <div className="flex -space-x-1.5 overflow-visible">
                              {r.deployable_names.slice(0, 3).map((name, i) => {
                                const initials = name
                                  .split(" ")
                                  .map((w) => w[0])
                                  .join("")
                                  .toUpperCase()
                                  .slice(0, 2);
                                return (
                                  <div
                                    key={i}
                                    className="group relative inline-flex items-center justify-center h-5 w-5 rounded-full ring-2 ring-white dark:ring-zinc-950 text-[9px] font-black text-white bg-gradient-to-br cursor-pointer select-none"
                                    style={{
                                      background:
                                        getAvatarGradient(name) === "from-pink-500 to-violet-600"
                                          ? "linear-gradient(135deg, #ec4899, #8b5cf6)"
                                          : getAvatarGradient(name) === "from-blue-500 to-cyan-500"
                                            ? "linear-gradient(135deg, #3b82f6, #06b6d4)"
                                            : getAvatarGradient(name) ===
                                                "from-emerald-500 to-teal-600"
                                              ? "linear-gradient(135deg, #10b981, #059669)"
                                              : getAvatarGradient(name) ===
                                                  "from-amber-500 to-orange-600"
                                                ? "linear-gradient(135deg, #f59e0b, #d97706)"
                                                : getAvatarGradient(name) ===
                                                    "from-indigo-500 to-purple-600"
                                                  ? "linear-gradient(135deg, #6366f1, #a855f7)"
                                                  : "linear-gradient(135deg, #ec4899, #f43f5e)",
                                    }}
                                  >
                                    {initials}
                                    {/* Visual Tooltip */}
                                    <span className="absolute bottom-full left-1/2 -translate-x-1/2 mb-1.5 scale-0 group-hover:scale-100 transition-all duration-150 origin-bottom bg-slate-900 dark:bg-zinc-800 text-white text-[9px] px-2 py-0.5 rounded shadow-lg whitespace-nowrap z-30 font-semibold pointer-events-none border border-slate-700/50 dark:border-zinc-700/50">
                                      {name}
                                    </span>
                                  </div>
                                );
                              })}
                              {r.deployable_names.length > 3 && (
                                <div className="inline-flex items-center justify-center h-5 w-5 rounded-full ring-2 ring-white dark:ring-zinc-950 text-[8px] font-bold text-muted-foreground bg-slate-100 dark:bg-zinc-850">
                                  +{r.deployable_names.length - 3}
                                </div>
                              )}
                            </div>
                          )}
                        </div>
                      </td>

                      {/* Rolling Off info list */}
                      <td className="py-4 px-6">
                        {r.rolling_off.length === 0 ? (
                          <span className="text-muted-foreground/30 text-xs">—</span>
                        ) : (
                          <div className="group relative inline-flex items-center gap-1 px-2 py-0.5 rounded bg-amber-500/10 text-amber-600 dark:text-amber-400 border border-amber-500/15 cursor-pointer font-bold shadow-sm select-none">
                            <Calendar className="h-3 w-3 text-amber-500" />
                            <span>{r.rolling_off.length} Roll-off</span>

                            {/* Hover tooltip for list */}
                            <div className="absolute bottom-full left-1/2 -translate-x-1/2 mb-1.5 scale-0 group-hover:scale-100 transition-all duration-150 origin-bottom bg-slate-900 dark:bg-zinc-900 text-white text-[10px] p-2.5 rounded-lg shadow-xl min-w-[170px] z-30 font-medium pointer-events-none border border-slate-700 dark:border-zinc-800">
                              <div className="font-bold border-b border-white/10 pb-1 mb-1.5 uppercase text-[8px] tracking-wider text-amber-400">
                                Roll-Off Projects
                              </div>
                              {r.rolling_off.map((x, k) => (
                                <div
                                  key={k}
                                  className="flex justify-between gap-2 py-0.5 text-white/90"
                                >
                                  <span className="truncate max-w-[100px]">{x.name}</span>
                                  <span className="font-mono text-white/55">{x.date}</span>
                                </div>
                              ))}
                            </div>
                          </div>
                        )}
                      </td>

                      {/* Rationale */}
                      <td className="py-4 px-6">
                        <p
                          className="text-xs text-muted-foreground/90 leading-relaxed max-w-[280px]"
                          title={r.rationale}
                        >
                          {r.rationale}
                        </p>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Footer Info */}
      <div className="flex items-center gap-2 text-[11px] text-muted-foreground/60 select-none">
        <span className="h-1.5 w-1.5 rounded-full bg-slate-400" />
        <span>
          Market demand calculated from Alchemy external job listings. Bench availability live from
          active client allocations.
        </span>
        {data.note ? ` • ${data.note}` : ""}
        {data.generated_on ? ` • Sync generated: ${data.generated_on}` : ""}
      </div>
    </div>
  );
}

// ── Bench → Upskill Tab Component ────────────────────────────────────────────
interface BenchSuggestion {
  employee_id: number | null;
  employee_name: string;
  employee_email: string | null;
  department: string | null;
  free_pct: number;
  reason: string;
  rolloff_date: string | null;
  current_projects: string[];
  recommended_training_id: number;
  recommended_training: string;
  teaches_skills: string[];
  demand_score: number;
  suggested_due_date: string;
}

interface BenchResult {
  ok: boolean;
  generated_on?: string;
  count?: number;
  rows?: BenchSuggestion[];
  summary?: { bench: number; rolling_off: number };
}

function BenchUpskillTab({ authHeaders }: { authHeaders: Record<string, string> }) {
  const [data, setData] = useState<BenchResult | null>(null);
  const [loading, setLoading] = useState(true);
  const [acting, setActing] = useState<string | null>(null);
  const [assigned, setAssigned] = useState<Set<string>>(new Set());

  const rowKey = (r: BenchSuggestion) => r.employee_email || r.employee_name;

  const fetch_ = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch(`/api/portal/pmo/bench-upskill?limit=50`, { headers: authHeaders });
      setData(await res.json());
    } catch {
      toast.error("Failed to load bench-upskill suggestions");
      setData({ ok: false });
    } finally {
      setLoading(false);
    }
  }, [authHeaders]);

  useEffect(() => {
    Promise.resolve().then(() => fetch_());
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const assign = async (r: BenchSuggestion) => {
    const key = rowKey(r);
    setActing(key);
    try {
      const res = await fetch(`/api/portal/pmo/bench-upskill/assign`, {
        method: "POST",
        headers: authHeaders,
        body: JSON.stringify({
          employee_id: r.employee_id,
          email: r.employee_email,
          training_id: r.recommended_training_id,
          due_date: r.suggested_due_date,
        }),
      });
      if (!res.ok) throw new Error((await res.json().catch(() => ({}))).detail || "Failed");
      flyBanner(`Assigned ${r.recommended_training} to ${r.employee_name}`);
      setAssigned((prev) => new Set(prev).add(key));
    } catch (e: unknown) {
      toast.error(e instanceof Error ? e.message : "Failed to assign training");
    } finally {
      setActing(null);
    }
  };

  if (loading) {
    return (
      <div className="flex flex-col h-60 items-center justify-center gap-3">
        <Loader2 className="h-7 w-7 animate-spin text-indigo-500" />
        <span className="text-xs text-muted-foreground/80 font-medium">
          Matching bench capacity to in-demand skills...
        </span>
      </div>
    );
  }

  const rows = data?.rows ?? [];
  const s = data?.summary ?? { bench: 0, rolling_off: 0 };

  const cards = [
    {
      label: "On Bench",
      n: s.bench ?? 0,
      desc: "Free capacity now — ready to upskill",
      icon: UserCheck,
      iconCls: "bg-emerald-500/10 text-emerald-500 dark:text-emerald-400 border border-emerald-500/15",
    },
    {
      label: "Rolling Off Soon",
      n: s.rolling_off ?? 0,
      desc: "Capacity arriving within 45 days",
      icon: RefreshCw,
      iconCls: "bg-indigo-500/10 text-indigo-500 dark:text-indigo-400 border border-indigo-500/15",
    },
    {
      label: "Suggestions",
      n: rows.length,
      desc: "Manager-approved before any enrollment",
      icon: GraduationCap,
      iconCls: "bg-amber-500/10 text-amber-500 dark:text-amber-400 border border-amber-500/15",
    },
  ];

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-5">
        {cards.map((c, idx) => {
          const CardIcon = c.icon;
          return (
            <motion.div
              initial={{ opacity: 0, y: 12 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: idx * 0.04, duration: 0.3 }}
              key={c.label}
              className="relative overflow-hidden rounded-2xl border p-5 bg-white/60 dark:bg-zinc-900/35 border-slate-200/60 dark:border-white/[0.04] shadow-sm"
            >
              <div className="flex items-center justify-between">
                <span className="text-[11px] font-bold text-muted-foreground uppercase tracking-wider">
                  {c.label}
                </span>
                <div className={cn("p-2 rounded-xl", c.iconCls)}>
                  <CardIcon className="h-4 w-4" />
                </div>
              </div>
              <div className="mt-4 flex items-baseline gap-1.5">
                <span className="text-3xl font-black tracking-tight text-foreground">{c.n}</span>
                <span className="text-[11px] font-medium text-muted-foreground">people</span>
              </div>
              <p className="mt-1 text-[11px] text-muted-foreground/80 leading-snug">{c.desc}</p>
            </motion.div>
          );
        })}
      </div>

      <div className="flex items-center justify-between">
        <h2 className="text-xs font-bold uppercase tracking-wider text-muted-foreground flex items-center gap-1.5">
          <span className="h-2 w-2 rounded-full bg-indigo-500 animate-pulse" />
          Bench-to-Upskill Suggestions
        </h2>
        <button
          onClick={fetch_}
          className="flex items-center gap-1.5 text-[12px] font-semibold text-muted-foreground hover:text-foreground bg-white dark:bg-zinc-900 border border-slate-200/80 dark:border-zinc-800 px-3 py-1.5 rounded-lg transition-colors shadow-sm cursor-pointer"
        >
          <RefreshCw className="h-3 w-3" />
          Refresh
        </button>
      </div>

      {rows.length === 0 ? (
        <div className="flex flex-col h-56 items-center justify-center text-center p-8 rounded-2xl border border-dashed border-slate-200/80 dark:border-zinc-800/40 bg-white/20 dark:bg-zinc-950/10 backdrop-blur-sm select-none">
          <div className="h-11 w-11 rounded-xl bg-slate-100 dark:bg-zinc-900 flex items-center justify-center mb-3">
            <UserCheck className="h-5 w-5 text-muted-foreground/50" />
          </div>
          <p className="text-sm font-semibold text-foreground">No bench suggestions right now</p>
          <p className="text-xs text-muted-foreground/80 mt-1 max-w-sm">
            Either no one is on the bench, or those who are already hold the in-demand skills.
            Suggestions appear once a synced directory and skill profiles are present.
          </p>
        </div>
      ) : (
        <div className="bg-white/60 dark:bg-zinc-950/20 backdrop-blur-lg border border-slate-200/60 dark:border-white/[0.04] rounded-2xl overflow-hidden shadow-elevated">
          <div className="overflow-x-auto">
            <table className="w-full min-w-[860px] border-collapse text-left text-xs">
              <thead>
                <tr className="border-b border-slate-200/60 dark:border-white/[0.05] bg-slate-50/[0.3] dark:bg-zinc-900/[0.2] select-none">
                  <th className="py-4 px-6 text-[10px] font-extrabold uppercase tracking-[0.1em] text-muted-foreground/80">
                    Employee
                  </th>
                  <th className="py-4 px-6 text-[10px] font-extrabold uppercase tracking-[0.1em] text-muted-foreground/80">
                    Status
                  </th>
                  <th className="py-4 px-6 text-[10px] font-extrabold uppercase tracking-[0.1em] text-muted-foreground/80">
                    Recommended Course
                  </th>
                  <th className="py-4 px-6 text-[10px] font-extrabold uppercase tracking-[0.1em] text-muted-foreground/80">
                    Teaches
                  </th>
                  <th className="py-4 px-6 text-[10px] font-extrabold uppercase tracking-[0.1em] text-muted-foreground/80 text-center">
                    Due By
                  </th>
                  <th className="py-4 px-6 text-[10px] font-extrabold uppercase tracking-[0.1em] text-muted-foreground/80 text-right">
                    Action
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-200/40 dark:divide-white/[0.03]">
                {rows.map((r) => {
                  const initials = r.employee_name
                    .split(" ")
                    .map((w) => w[0])
                    .join("")
                    .toUpperCase()
                    .slice(0, 2);
                  const key = rowKey(r);
                  const isAssigned = assigned.has(key);
                  return (
                    <tr
                      key={key}
                      className="hover:bg-slate-500/[0.015] dark:hover:bg-white/[0.01] transition-colors duration-150 align-middle"
                    >
                      <td className="py-4 px-6">
                        <div className="flex items-center gap-3">
                          <div className="inline-flex items-center justify-center h-7 w-7 rounded-full text-[10px] font-black text-white bg-gradient-to-br from-indigo-500 to-violet-600 shadow-inner">
                            {initials}
                          </div>
                          <div className="min-w-0">
                            <div className="font-bold text-sm text-foreground truncate">
                              {r.employee_name}
                            </div>
                            <div className="text-[10px] text-muted-foreground truncate">
                              {r.department || r.employee_email}
                            </div>
                          </div>
                        </div>
                      </td>
                      <td className="py-4 px-6">
                        <span
                          className={cn(
                            "inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[10px] font-bold border",
                            r.reason === "On bench"
                              ? "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border-emerald-500/20"
                              : "bg-indigo-500/10 text-indigo-600 dark:text-indigo-400 border-indigo-500/20",
                          )}
                        >
                          {r.reason === "On bench" ? `${r.free_pct}% free` : `Off ${r.rolloff_date}`}
                        </span>
                      </td>
                      <td className="py-4 px-6">
                        <span className="font-semibold text-foreground">
                          {r.recommended_training}
                        </span>
                      </td>
                      <td className="py-4 px-6">
                        <div className="flex flex-wrap gap-1 max-w-[200px]">
                          {r.teaches_skills.slice(0, 3).map((sk) => (
                            <span
                              key={sk}
                              className="px-2 py-0.5 rounded-md text-[10px] font-semibold bg-violet-500/10 text-violet-600 dark:text-violet-400 border border-violet-500/15"
                            >
                              {sk}
                            </span>
                          ))}
                        </div>
                      </td>
                      <td className="py-4 px-6 text-center font-mono text-[11px] text-muted-foreground">
                        {r.suggested_due_date}
                      </td>
                      <td className="py-4 px-6 text-right">
                        <button
                          onClick={() => assign(r)}
                          disabled={acting === key || isAssigned}
                          className={cn(
                            "inline-flex items-center justify-center gap-1.5 rounded-xl py-1.5 px-3.5 text-xs font-bold transition-all duration-200 disabled:opacity-60 active:scale-95 cursor-pointer shadow-sm border",
                            isAssigned
                              ? "bg-slate-100 dark:bg-zinc-800 text-muted-foreground border-slate-200/50 dark:border-zinc-700/50 cursor-default"
                              : "bg-emerald-500/10 hover:bg-emerald-500/15 border-emerald-500/20 text-emerald-600 dark:text-emerald-400",
                          )}
                        >
                          {acting === key ? (
                            <Loader2 className="h-3.5 w-3.5 animate-spin" />
                          ) : isAssigned ? (
                            <Check className="h-3.5 w-3.5" />
                          ) : (
                            <GraduationCap className="h-3.5 w-3.5" />
                          )}
                          {isAssigned ? "Assigned" : "Approve & Assign"}
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}

      <div className="flex items-center gap-2 text-[11px] text-muted-foreground/60 select-none">
        <span className="h-1.5 w-1.5 rounded-full bg-slate-400" />
        <span>
          Demand computed in-house from skills held by people on billable work. Deadlines scale with
          free capacity. Nothing is enrolled until a manager approves.
        </span>
        {data?.generated_on ? ` • Generated: ${data.generated_on}` : ""}
      </div>
    </div>
  );
}

// ── Udemy/Coursera Tab Component ─────────────────────────────────────────────
function UdemyTab({ authHeaders }: { authHeaders: Record<string, string> }) {
  const [items, setItems] = useState<UdemyRequest[]>([]);
  const [loading, setLoading] = useState(true);
  const [acting, setActing] = useState<number | null>(null);
  const [filter, setFilter] = useState("Pending");

  const [rejectId, setRejectId] = useState<number | null>(null);
  const [rejectReason, setRejectReason] = useState("");
  const [rejectDialogOpen, setRejectDialogOpen] = useState(false);

  const fetch_ = useCallback(async () => {
    setLoading(true);
    try {
      const qs = filter !== "All" ? `?status=${filter}` : "";
      const res = await fetch(`/api/portal/pmo/udemy${qs}`, { headers: authHeaders });
      setItems(await res.json());
    } catch {
      toast.error("Failed to load learning requests");
    } finally {
      setLoading(false);
    }
  }, [filter, authHeaders]);

  useEffect(() => {
    Promise.resolve().then(() => fetch_());
  }, [fetch_]);

  const approve = async (id: number, platform: string) => {
    setActing(id);
    try {
      const res = await fetch(`/api/portal/pmo/udemy/${id}/approve`, {
        method: "PUT",
        headers: authHeaders,
      });
      if (!res.ok) throw new Error((await res.json().catch(() => ({}))).detail || "Failed");
      flyBanner(`${platform || "Udemy"} license approved`);
      fetch_();
    } catch (e: unknown) {
      toast.error(e instanceof Error ? e.message : "Failed to approve license");
    } finally {
      setActing(null);
    }
  };

  const reject = async (id: number, reason: string) => {
    setActing(id);
    try {
      const res = await fetch(`/api/portal/pmo/udemy/${id}/reject`, {
        method: "PUT",
        headers: authHeaders,
        body: JSON.stringify({ reason }),
      });
      if (!res.ok) throw new Error((await res.json().catch(() => ({}))).detail || "Failed");
      toast.success("Request declined successfully");
      setRejectDialogOpen(false);
      fetch_();
    } catch (e: unknown) {
      toast.error(e instanceof Error ? e.message : "Failed to reject request");
    } finally {
      setActing(null);
    }
  };

  // Modern segmented category selector
  const filterCards = [
    {
      key: "Pending",
      label: "Pending Queue",
      desc: "Requires active PMO review",
      icon: Clock,
      activeBg:
        "bg-amber-500/10 border-amber-500/30 text-amber-600 dark:text-amber-400 shadow-sm shadow-amber-500/5 dark:bg-amber-950/20 dark:border-amber-500/40",
      inactiveBg:
        "bg-white/60 dark:bg-zinc-900/35 border-slate-200/60 dark:border-white/[0.04] text-muted-foreground hover:border-amber-500/20 hover:text-amber-500",
      glowColor: "from-amber-500/10 to-transparent",
    },
    {
      key: "Approved",
      label: "Approved Licenses",
      desc: "Licenses ready for upskilling",
      icon: CheckCircle2,
      activeBg:
        "bg-emerald-500/10 border-emerald-500/30 text-emerald-600 dark:text-emerald-400 shadow-sm shadow-emerald-500/5 dark:bg-emerald-950/20 dark:border-emerald-500/40",
      inactiveBg:
        "bg-white/60 dark:bg-zinc-900/35 border-slate-200/60 dark:border-white/[0.04] text-muted-foreground hover:border-emerald-500/20 hover:text-emerald-500",
      glowColor: "from-emerald-500/10 to-transparent",
    },
    {
      key: "Rejected",
      label: "Declined Requests",
      desc: "Requests declined with reasons",
      icon: XCircle,
      activeBg:
        "bg-rose-500/10 border-rose-500/30 text-rose-600 dark:text-rose-400 shadow-sm shadow-rose-500/5 dark:bg-rose-950/20 dark:border-rose-500/40",
      inactiveBg:
        "bg-white/60 dark:bg-zinc-900/35 border-slate-200/60 dark:border-white/[0.04] text-muted-foreground hover:border-rose-500/20 hover:text-rose-500",
      glowColor: "from-rose-500/10 to-transparent",
    },
    {
      key: "All",
      label: "All Requests",
      desc: "Complete history overview",
      icon: Layers,
      activeBg:
        "bg-indigo-500/10 border-indigo-500/30 text-indigo-600 dark:text-indigo-400 shadow-sm shadow-indigo-500/5 dark:bg-indigo-950/20 dark:border-indigo-500/40",
      inactiveBg:
        "bg-white/60 dark:bg-zinc-900/35 border-slate-200/60 dark:border-white/[0.04] text-muted-foreground hover:border-indigo-500/20 hover:text-indigo-500",
      glowColor: "from-indigo-500/10 to-transparent",
    },
  ];

  return (
    <div className="space-y-6">
      {/* Category selector grid */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-5">
        {filterCards.map((c, idx) => {
          const CardIcon = c.icon;
          const isActive = filter === c.key;
          return (
            <motion.div
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: idx * 0.04, duration: 0.3 }}
              key={c.key}
              onClick={() => setFilter(c.key)}
              className={cn(
                "relative overflow-hidden rounded-2xl border p-5 transition-all duration-300 shadow-sm cursor-pointer select-none",
                isActive ? c.activeBg : c.inactiveBg,
              )}
            >
              {/* Radial glow background on hover/active */}
              <div
                className={cn(
                  "absolute -right-10 -top-10 w-28 h-28 bg-gradient-radial blur-2xl opacity-20 pointer-events-none",
                  c.glowColor,
                )}
              />

              <div className="flex items-center justify-between">
                <span className="text-[11px] font-bold uppercase tracking-wider">{c.label}</span>
                <div
                  className={cn(
                    "p-1.5 rounded-lg border",
                    isActive ? "border-current/25" : "border-slate-200/60 dark:border-zinc-800",
                  )}
                >
                  <CardIcon className="h-4 w-4" />
                </div>
              </div>

              <div className="mt-4 flex items-center justify-between">
                <span className="text-2xl font-black tracking-tight">
                  {isActive ? items.length : "—"}
                </span>
                <span className="text-[10px] font-semibold text-muted-foreground/80 uppercase">
                  Filter
                </span>
              </div>
              <p className="mt-1 text-[11px] text-muted-foreground/80 leading-snug">{c.desc}</p>
            </motion.div>
          );
        })}
      </div>

      {/* Sync bar */}
      <div className="flex items-center justify-between">
        <h2 className="text-xs font-bold uppercase tracking-wider text-muted-foreground flex items-center gap-1.5">
          <span className="h-2 w-2 rounded-full bg-indigo-500 animate-pulse" />
          Active Requests ({items.length})
        </h2>
        <button
          onClick={fetch_}
          className="flex items-center gap-1.5 text-[12px] font-semibold text-muted-foreground hover:text-foreground bg-white dark:bg-zinc-900 border border-slate-200/80 dark:border-zinc-800 px-3 py-1.5 rounded-lg transition-colors shadow-sm cursor-pointer"
        >
          <RefreshCw className="h-3 w-3" />
          Sync Inbox
        </button>
      </div>

      {/* Requests Card Grid */}
      {loading ? (
        <div className="flex flex-col h-40 items-center justify-center gap-3">
          <Loader2 className="h-7 w-7 animate-spin text-indigo-500" />
          <span className="text-xs text-muted-foreground/80 font-medium">
            Fetching request registry...
          </span>
        </div>
      ) : items.length === 0 ? (
        <div className="flex flex-col h-56 items-center justify-center text-center p-8 rounded-2xl border border-dashed border-slate-200/80 dark:border-zinc-800/40 bg-white/20 dark:bg-zinc-950/10 backdrop-blur-sm select-none">
          <div className="h-11 w-11 rounded-xl bg-slate-100 dark:bg-zinc-900 flex items-center justify-center mb-3">
            <CheckCircle2 className="h-5 w-5 text-muted-foreground/50" />
          </div>
          <p className="text-sm font-semibold text-foreground">No license requests found</p>
          <p className="text-xs text-muted-foreground/80 mt-1 max-w-xs">
            There are no {filter.toLowerCase()} learning license requests matching this filter.
          </p>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
          {items.map((r, cardIdx) => {
            const initials = r.employee_name
              .split(" ")
              .map((w) => w[0])
              .join("")
              .toUpperCase()
              .slice(0, 2);

            return (
              <motion.div
                initial={{ opacity: 0, y: 12 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: cardIdx * 0.03, duration: 0.3 }}
                key={r.id}
                className="relative overflow-hidden rounded-2xl border bg-white/60 dark:bg-zinc-900/35 border-slate-200/60 dark:border-white/[0.04] p-5 flex flex-col justify-between hover:shadow-md hover:border-slate-300 dark:hover:border-white/[0.08] transition-all duration-300 backdrop-blur-sm group"
              >
                {/* Visual platform accent tag */}
                <div
                  className={cn(
                    "absolute top-0 right-0 w-2 h-16 rounded-bl-lg pointer-events-none",
                    r.platform?.toLowerCase() === "coursera" ? "bg-blue-500" : "bg-violet-500",
                  )}
                />

                <div>
                  {/* User profile row */}
                  <div className="flex items-center gap-3">
                    <div
                      className="inline-flex items-center justify-center h-8 w-8 rounded-full text-xs font-black text-white bg-gradient-to-br shadow-inner"
                      style={{
                        background:
                          getAvatarGradient(r.employee_name) === "from-pink-500 to-violet-600"
                            ? "linear-gradient(135deg, #ec4899, #8b5cf6)"
                            : getAvatarGradient(r.employee_name) === "from-blue-500 to-cyan-500"
                              ? "linear-gradient(135deg, #3b82f6, #06b6d4)"
                              : getAvatarGradient(r.employee_name) ===
                                  "from-emerald-500 to-teal-600"
                                ? "linear-gradient(135deg, #10b981, #059669)"
                                : getAvatarGradient(r.employee_name) ===
                                    "from-amber-500 to-orange-600"
                                  ? "linear-gradient(135deg, #f59e0b, #d97706)"
                                  : getAvatarGradient(r.employee_name) ===
                                      "from-indigo-500 to-purple-600"
                                    ? "linear-gradient(135deg, #6366f1, #a855f7)"
                                    : "linear-gradient(135deg, #ec4899, #f43f5e)",
                      }}
                    >
                      {initials}
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="font-bold text-sm text-foreground truncate">
                        {r.employee_name}
                      </div>
                      <div className="text-[10px] text-muted-foreground truncate">
                        {r.employee_email}
                      </div>
                    </div>
                  </div>

                  {/* Course specs */}
                  <div className="mt-4">
                    <div className="flex items-center gap-1.5 select-none">
                      <span
                        className={cn(
                          "rounded-full px-2.5 py-0.5 text-[9px] font-extrabold uppercase tracking-wider border",
                          r.platform?.toLowerCase() === "coursera"
                            ? "bg-blue-500/10 text-blue-600 dark:text-blue-400 border-blue-500/20"
                            : "bg-violet-500/10 text-violet-600 dark:text-violet-400 border-violet-500/20",
                        )}
                      >
                        {r.platform || "Udemy"}
                      </span>
                      <span className="text-[9px] text-muted-foreground/70 font-semibold font-mono">
                        {r.created_at
                          ? new Date(r.created_at).toLocaleDateString("en-US", {
                              month: "short",
                              day: "numeric",
                              year: "numeric",
                            })
                          : "—"}
                      </span>
                    </div>

                    <h3
                      className="text-sm font-bold text-foreground mt-2.5 line-clamp-2 min-h-[38px] leading-snug group-hover:text-indigo-500 dark:group-hover:text-indigo-400 transition-colors"
                      title={r.course_name}
                    >
                      {r.course_name || "Untitled Learning Course"}
                    </h3>
                  </div>

                  {/* Justification block */}
                  <div className="mt-3.5 bg-slate-50/50 dark:bg-zinc-950/20 border border-slate-100 dark:border-zinc-800/40 rounded-xl p-3.5 relative">
                    <div className="text-[9px] font-bold text-muted-foreground/60 uppercase tracking-wider mb-1 select-none">
                      Rationale Justification
                    </div>
                    <p className="text-xs text-muted-foreground dark:text-zinc-400 italic line-clamp-3 leading-relaxed">
                      "{r.justification || "No justification provided."}"
                    </p>
                  </div>
                </div>

                {/* Footer and Actions */}
                <div>
                  {r.status === "Pending" ? (
                    <div className="mt-5 pt-4 border-t border-slate-200/50 dark:border-zinc-800/60 flex items-center gap-3">
                      <button
                        onClick={() => approve(r.id, r.platform)}
                        disabled={acting === r.id}
                        className="flex-1 flex items-center justify-center gap-1.5 rounded-xl py-2 px-3 text-xs font-bold bg-emerald-500/10 hover:bg-emerald-500/15 border border-emerald-500/20 text-emerald-600 dark:text-emerald-400 transition-all duration-200 disabled:opacity-50 active:scale-95 cursor-pointer shadow-sm shadow-emerald-500/5"
                      >
                        {acting === r.id ? (
                          <Loader2 className="h-3.5 w-3.5 animate-spin" />
                        ) : (
                          <Check className="h-3.5 w-3.5" />
                        )}
                        Approve
                      </button>
                      <button
                        onClick={() => {
                          setRejectId(r.id);
                          setRejectReason("");
                          setRejectDialogOpen(true);
                        }}
                        disabled={acting === r.id}
                        className="flex-1 flex items-center justify-center gap-1.5 rounded-xl py-2 px-3 text-xs font-bold bg-rose-500/10 hover:bg-rose-500/15 border border-rose-500/20 text-rose-600 dark:text-rose-400 transition-all duration-200 disabled:opacity-50 active:scale-95 cursor-pointer shadow-sm shadow-rose-500/5"
                      >
                        <X className="h-3.5 w-3.5" />
                        Decline
                      </button>
                    </div>
                  ) : (
                    <div className="mt-5 pt-4 border-t border-slate-200/50 dark:border-zinc-800/60 text-xs">
                      <div className="flex items-center justify-between text-muted-foreground/60 text-[9px] font-bold uppercase tracking-wider mb-1.5 select-none">
                        <span>Decision Registry</span>
                        <span
                          className={cn(
                            "px-2 py-0.5 rounded-md text-[8px] font-extrabold uppercase border",
                            STATUS_BADGE[r.status],
                          )}
                        >
                          {r.status}
                        </span>
                      </div>

                      <div className="flex items-center gap-1.5 text-foreground/80 font-semibold mb-1">
                        <span className="h-1.5 w-1.5 rounded-full bg-slate-400" />
                        <span>
                          Reviewed by{" "}
                          <span className="font-bold text-foreground">
                            {r.decided_by || "System Admin"}
                          </span>
                        </span>
                      </div>

                      {r.decision_reason && (
                        <p className="mt-1 text-[11px] text-muted-foreground bg-slate-50 dark:bg-zinc-950/20 p-2 rounded-lg border border-slate-100 dark:border-zinc-800/30 leading-snug">
                          Reason: {r.decision_reason}
                        </p>
                      )}
                    </div>
                  )}
                </div>
              </motion.div>
            );
          })}
        </div>
      )}

      {/* Decline modal redesign */}
      <Dialog open={rejectDialogOpen} onOpenChange={setRejectDialogOpen}>
        <DialogContent className="max-w-md bg-white dark:bg-zinc-950 border border-slate-200 dark:border-zinc-800 rounded-3xl shadow-xl">
          <DialogHeader>
            <DialogTitle className="text-base font-bold text-foreground flex items-center gap-2">
              <div className="h-8 w-8 rounded-lg bg-rose-500/10 text-rose-500 flex items-center justify-center">
                <AlertTriangle className="h-4.5 w-4.5" />
              </div>
              Decline License Request
            </DialogTitle>
          </DialogHeader>

          <div className="space-y-4 py-2">
            <div className="text-xs font-semibold text-muted-foreground/85 block">
              Reason for Declining (Sent to Employee) *
              <textarea
                value={rejectReason}
                onChange={(e) => setRejectReason(e.target.value)}
                rows={3}
                placeholder="Please state why this training license request is declined..."
                className="mt-1.5 w-full rounded-2xl border border-slate-200 dark:border-zinc-800 bg-slate-50 dark:bg-zinc-900/40 px-4 py-3 text-xs text-foreground resize-none focus:outline-none focus:ring-1 focus:ring-indigo-500 dark:focus:ring-indigo-500 focus:bg-white dark:focus:bg-zinc-900 transition-all leading-relaxed"
              />
            </div>
          </div>

          <DialogFooter className="flex gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={() => setRejectDialogOpen(false)}
              className="rounded-xl font-semibold border-slate-200 dark:border-zinc-800"
            >
              Cancel
            </Button>
            <Button
              size="sm"
              disabled={!rejectReason.trim() || acting === rejectId}
              onClick={() => {
                if (rejectId) {
                  reject(rejectId, rejectReason.trim());
                }
              }}
              className="rounded-xl font-semibold bg-rose-500 hover:bg-rose-600 text-white border-0 shadow-md shadow-rose-500/10"
            >
              {acting === rejectId && <Loader2 className="h-3.5 w-3.5 animate-spin mr-1.5" />}
              Decline Request
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
