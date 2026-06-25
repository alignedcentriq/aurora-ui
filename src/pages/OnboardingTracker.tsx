import { useAuth } from "@/lib/auth-store";
import { useState, useEffect, useCallback, useMemo } from "react";
import {
  Loader2,
  RefreshCw,
  Rocket,
  CheckCircle2,
  AlertTriangle,
  Users,
  ChevronRight,
  X,
  Clock,
  FileText,
  Shield,
  TrendingUp,
  Calendar,
  Mail,
  Search,
  Filter,
  Lock,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { toast } from "sonner";
import { motion, AnimatePresence } from "framer-motion";

interface JourneyRow {
  employee_name: string;
  employee_email: string;
  department: string | null;
  designation: string | null;
  joining_date: string | null;
  status: "active" | "completed";
  progress_pct: number;
  next_step: string | null;
  docs_submitted: number;
  docs_required: number;
  stalled: boolean;
  started_at: string | null;
}
interface Overview {
  total: number;
  completed: number;
  active: number;
  stalled: number;
  journeys: JourneyRow[];
}
interface StepView {
  key: string;
  title: string;
  status: string;
  category: string;
  auto: boolean;
}
interface DetailView {
  employee_name: string;
  progress_pct: number;
  status: string;
  steps: StepView[];
  documents: { name: string; submitted: boolean; status: string }[];
}

function StatCard({
  label,
  value,
  icon: Icon,
  gradient,
  textColor,
  delay = 0,
}: {
  label: string;
  value: number;
  icon: typeof Users;
  gradient: string;
  textColor: string;
  delay?: number;
}) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.4, delay, ease: "easeOut" }}
      className="relative overflow-hidden rounded-2xl border border-white/20 dark:border-white/[0.06] bg-white/70 dark:bg-zinc-900/60 backdrop-blur-xl p-4 shadow-sm hover:shadow-md transition-shadow"
    >
      <div className={cn("absolute inset-0 opacity-[0.06]", gradient)} />
      <div className="relative flex items-start justify-between">
        <div>
          <div className={cn("text-[28px] font-black tabular-nums leading-none", textColor)}>
            {value}
          </div>
          <div className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground mt-1">
            {label}
          </div>
        </div>
        <div className={cn("rounded-xl p-2.5", gradient, "bg-opacity-10")}>
          <Icon className={cn("h-4 w-4", textColor)} />
        </div>
      </div>
    </motion.div>
  );
}

function ProgressRing({
  pct,
  size = 44,
  stroke = 4,
}: {
  pct: number;
  size?: number;
  stroke?: number;
}) {
  const r = (size - stroke) / 2;
  const circ = 2 * Math.PI * r;
  const offset = circ - (pct / 100) * circ;
  return (
    <svg width={size} height={size} className="shrink-0 -rotate-90">
      <circle
        cx={size / 2}
        cy={size / 2}
        r={r}
        fill="none"
        strokeWidth={stroke}
        className="stroke-slate-200 dark:stroke-zinc-800"
      />
      <circle
        cx={size / 2}
        cy={size / 2}
        r={r}
        fill="none"
        strokeWidth={stroke}
        strokeDasharray={circ}
        strokeDashoffset={offset}
        strokeLinecap="round"
        className="stroke-violet-500 transition-all duration-700"
      />
    </svg>
  );
}

export function OnboardingTracker() {
  const { user } = useAuth();
  const [data, setData] = useState<Overview | null>(null);
  const [loading, setLoading] = useState(true);
  const [detail, setDetail] = useState<DetailView | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [search, setSearch] = useState("");
  const [filter, setFilter] = useState<"all" | "active" | "completed" | "stalled">("all");

  // ── HR-only guard ──────────────────────────────────────────────
  if (user && user.role !== "HR") {
    return (
      <div className="flex h-full items-center justify-center bg-gradient-to-br from-[#f8fafc] to-[#f1f5f9] dark:from-[#030712] dark:to-[#091120]">
        <motion.div
          initial={{ opacity: 0, scale: 0.9 }}
          animate={{ opacity: 1, scale: 1 }}
          className="text-center max-w-xs px-6"
        >
          <div className="mx-auto mb-5 flex h-16 w-16 items-center justify-center rounded-2xl bg-violet-500/10 border border-violet-500/20 shadow-lg">
            <Lock className="h-7 w-7 text-violet-500" />
          </div>
          <h2 className="text-[18px] font-black text-foreground tracking-tight">HR Access Only</h2>
          <p className="text-[13px] text-muted-foreground mt-2 leading-relaxed">
            The Onboarding Tracker is restricted to HR personnel only.
          </p>
        </motion.div>
      </div>
    );
  }

  const authHeaders = useMemo(
    () => ({
      "Content-Type": "application/json",
      ...(user?.email ? { "x-user-email": user.email } : {}),
      ...(user?.role ? { "x-user-role": user.role.toLowerCase() } : {}),
    }),
    [user?.email, user?.role],
  );

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/onboarding/overview", { headers: authHeaders });
      if (!res.ok) throw new Error("Failed to load");
      setData(await res.json());
    } catch {
      toast.error("Couldn't load onboarding overview.");
    } finally {
      setLoading(false);
    }
  }, [authHeaders]);

  useEffect(() => {
    load();
  }, [load]);

  const openDetail = useCallback(
    async (email: string) => {
      setDetailLoading(true);
      setDetail(null);
      try {
        const res = await fetch(`/api/onboarding/overview/${encodeURIComponent(email)}`, {
          headers: authHeaders,
        });
        if (!res.ok) throw new Error("Failed");
        setDetail(await res.json());
      } catch {
        toast.error("Couldn't load that journey.");
      } finally {
        setDetailLoading(false);
      }
    },
    [authHeaders],
  );

  const filteredJourneys = useMemo(() => {
    if (!data) return [];
    return data.journeys.filter((j) => {
      const matchSearch =
        search === "" ||
        j.employee_name.toLowerCase().includes(search.toLowerCase()) ||
        j.employee_email.toLowerCase().includes(search.toLowerCase()) ||
        (j.department ?? "").toLowerCase().includes(search.toLowerCase());
      const matchFilter =
        filter === "all" ||
        (filter === "completed" && j.status === "completed") ||
        (filter === "active" && j.status === "active" && !j.stalled) ||
        (filter === "stalled" && j.stalled);
      return matchSearch && matchFilter;
    });
  }, [data, search, filter]);

  const getInitials = (name: string) =>
    name
      .split(" ")
      .slice(0, 2)
      .map((n) => n[0])
      .join("")
      .toUpperCase();

  const avatarColors = [
    "from-violet-500 to-indigo-600",
    "from-sky-500 to-blue-600",
    "from-emerald-500 to-teal-600",
    "from-pink-500 to-rose-600",
    "from-amber-500 to-orange-600",
  ];
  const getAvatarColor = (name: string) => avatarColors[name.charCodeAt(0) % avatarColors.length];

  return (
    <div className="flex flex-col h-full overflow-hidden bg-gradient-to-br from-[#f8fafc] via-[#f0f4ff] to-[#ede9ff] dark:from-[#030712] dark:via-[#06091a] dark:to-[#080516] relative">
      {/* Ambient glows */}
      <div className="pointer-events-none absolute top-0 right-0 w-80 h-80 bg-violet-400/10 dark:bg-violet-600/[0.07] rounded-full blur-[100px]" />
      <div className="pointer-events-none absolute bottom-20 left-0 w-60 h-60 bg-indigo-400/10 dark:bg-indigo-600/[0.06] rounded-full blur-[80px]" />

      {/* ── Header ── */}
      <div className="px-6 sm:px-8 pt-6 pb-4 border-b border-slate-200/60 dark:border-white/[0.05] bg-white/50 dark:bg-zinc-950/30 backdrop-blur-md shrink-0">
        <div className="flex items-start justify-between gap-3">
          <div>
            <div className="flex items-center gap-2 mb-1">
              <div className="h-7 w-7 rounded-lg bg-gradient-to-tr from-violet-500 to-indigo-600 flex items-center justify-center shadow-lg shadow-violet-500/30">
                <Rocket className="h-3.5 w-3.5 text-white" />
              </div>
              <span className="text-[10px] font-extrabold uppercase tracking-[0.2em] text-violet-600 dark:text-violet-400">
                HR Portal
              </span>
            </div>
            <h1 className="text-[24px] font-black tracking-tight text-foreground">
              Onboarding Tracker
            </h1>
            <p className="text-[13px] text-muted-foreground mt-0.5">
              Live progress for every new joiner — steps, documents & status at a glance.
            </p>
          </div>
          <button
            onClick={load}
            className="flex items-center gap-1.5 rounded-xl px-3 py-2 text-[12px] font-semibold text-muted-foreground hover:bg-violet-50 dark:hover:bg-violet-950/30 hover:text-violet-600 dark:hover:text-violet-400 border border-transparent hover:border-violet-200 dark:hover:border-violet-800/50 transition-all"
          >
            <RefreshCw className={cn("h-3.5 w-3.5", loading && "animate-spin")} />
            Refresh
          </button>
        </div>

        {/* Stats row */}
        {data && (
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mt-5">
            <StatCard
              label="Total Joiners"
              value={data.total}
              icon={Users}
              gradient="bg-slate-500"
              textColor="text-foreground"
              delay={0}
            />
            <StatCard
              label="In Progress"
              value={data.active}
              icon={TrendingUp}
              gradient="bg-sky-500"
              textColor="text-sky-600 dark:text-sky-400"
              delay={0.05}
            />
            <StatCard
              label="Completed"
              value={data.completed}
              icon={CheckCircle2}
              gradient="bg-emerald-500"
              textColor="text-emerald-600 dark:text-emerald-400"
              delay={0.1}
            />
            <StatCard
              label="Stalled"
              value={data.stalled}
              icon={AlertTriangle}
              gradient="bg-amber-500"
              textColor="text-amber-600 dark:text-amber-400"
              delay={0.15}
            />
          </div>
        )}
      </div>

      {/* ── Search & Filter bar ── */}
      {data && data.journeys.length > 0 && (
        <div className="flex items-center gap-3 px-6 sm:px-8 py-3 border-b border-slate-200/50 dark:border-white/[0.04] bg-white/30 dark:bg-zinc-950/20 backdrop-blur-sm shrink-0">
          <div className="relative flex-1 max-w-sm">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search by name, email, dept…"
              className="w-full h-8 pl-9 pr-3 rounded-lg border border-slate-200/80 dark:border-white/[0.08] bg-white/80 dark:bg-zinc-900/60 text-[12.5px] text-foreground placeholder:text-muted-foreground/60 focus:outline-none focus:ring-1 focus:ring-violet-500/50 focus:border-violet-400/60 transition-all"
            />
          </div>
          <div className="flex items-center gap-1.5">
            <Filter className="h-3.5 w-3.5 text-muted-foreground" />
            {(["all", "active", "completed", "stalled"] as const).map((f) => (
              <button
                key={f}
                onClick={() => setFilter(f)}
                className={cn(
                  "px-3 py-1 rounded-lg text-[11px] font-semibold capitalize transition-all",
                  filter === f
                    ? "bg-violet-600 text-white shadow-sm shadow-violet-600/30"
                    : "text-muted-foreground hover:text-foreground hover:bg-muted/50",
                )}
              >
                {f}
              </button>
            ))}
          </div>
        </div>
      )}

      {/* ── Journey List ── */}
      <div className="flex-1 overflow-auto px-6 sm:px-8 py-5">
        {loading ? (
          <div className="flex flex-col items-center justify-center py-24 text-muted-foreground gap-3">
            <Loader2 className="h-7 w-7 animate-spin text-violet-500" />
            <span className="text-[13px]">Loading journeys…</span>
          </div>
        ) : !data || data.journeys.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-24 text-muted-foreground gap-3">
            <div className="h-14 w-14 rounded-2xl bg-violet-500/10 flex items-center justify-center">
              <Users className="h-6 w-6 text-violet-400 opacity-70" />
            </div>
            <p className="text-[14px] font-medium">No onboarding journeys yet.</p>
            <p className="text-[12px] text-muted-foreground/60">
              New joiners will appear here once added.
            </p>
          </div>
        ) : filteredJourneys.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-16 text-muted-foreground gap-2">
            <Search className="h-6 w-6 opacity-40" />
            <p className="text-[13px]">No results matching your search.</p>
          </div>
        ) : (
          <div className="space-y-2.5 max-w-4xl">
            <AnimatePresence initial={false}>
              {filteredJourneys.map((j, idx) => (
                <motion.button
                  key={j.employee_email}
                  initial={{ opacity: 0, y: 8 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: -4 }}
                  transition={{ duration: 0.25, delay: idx * 0.03 }}
                  onClick={() => openDetail(j.employee_email)}
                  className="w-full text-left rounded-2xl border border-slate-200/70 dark:border-white/[0.06] bg-white/70 dark:bg-zinc-900/50 backdrop-blur-xl p-4 hover:border-violet-400/60 dark:hover:border-violet-500/30 hover:shadow-lg hover:shadow-violet-500/5 transition-all group"
                >
                  <div className="flex items-center gap-4">
                    {/* Avatar */}
                    <div
                      className={cn(
                        "h-10 w-10 rounded-xl bg-gradient-to-br flex items-center justify-center text-white text-[13px] font-black shrink-0 shadow-sm",
                        getAvatarColor(j.employee_name),
                      )}
                    >
                      {getInitials(j.employee_name)}
                    </div>

                    {/* Info */}
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="text-[14px] font-bold text-foreground truncate">
                          {j.employee_name}
                        </span>
                        {j.designation && (
                          <span className="text-[11px] text-muted-foreground truncate">
                            {j.designation}
                          </span>
                        )}
                        {j.department && (
                          <span className="inline-flex items-center gap-1 text-[10.5px] font-semibold px-2 py-0.5 rounded-full bg-slate-100 dark:bg-zinc-800/80 text-muted-foreground border border-slate-200/70 dark:border-white/[0.06]">
                            {j.department}
                          </span>
                        )}
                        {j.status === "completed" && (
                          <span className="inline-flex items-center gap-1 text-[10px] font-bold px-2 py-0.5 rounded-full bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border border-emerald-500/20">
                            <CheckCircle2 className="h-3 w-3" /> Completed
                          </span>
                        )}
                        {j.stalled && (
                          <span className="inline-flex items-center gap-1 text-[10px] font-bold px-2 py-0.5 rounded-full bg-amber-500/10 text-amber-600 dark:text-amber-400 border border-amber-500/20">
                            <AlertTriangle className="h-3 w-3" /> Stalled
                          </span>
                        )}
                      </div>

                      {/* Progress bar */}
                      <div className="flex items-center gap-2.5 mt-2.5">
                        <div className="flex-1 h-1.5 rounded-full bg-slate-200/80 dark:bg-zinc-800 overflow-hidden max-w-xs">
                          <motion.div
                            className="h-full rounded-full bg-gradient-to-r from-violet-500 to-indigo-500"
                            initial={{ width: 0 }}
                            animate={{ width: `${j.progress_pct}%` }}
                            transition={{ duration: 0.8, ease: "easeOut", delay: idx * 0.04 }}
                          />
                        </div>
                        <span className="text-[12px] font-bold text-foreground tabular-nums w-8 text-right">
                          {j.progress_pct}%
                        </span>
                      </div>

                      {/* Meta row */}
                      <div className="flex items-center gap-3 mt-1.5 flex-wrap">
                        <span className="flex items-center gap-1 text-[11px] text-muted-foreground">
                          <FileText className="h-3 w-3" />
                          {j.docs_submitted}/{j.docs_required} docs
                        </span>
                        {j.joining_date && (
                          <span className="flex items-center gap-1 text-[11px] text-muted-foreground">
                            <Calendar className="h-3 w-3" />
                            {new Date(j.joining_date).toLocaleDateString("en-IN", {
                              day: "numeric",
                              month: "short",
                            })}
                          </span>
                        )}
                        {j.next_step && j.status !== "completed" && (
                          <span className="flex items-center gap-1 text-[11px] text-muted-foreground">
                            <Clock className="h-3 w-3" />
                            {j.next_step.replace(/_/g, " ")}
                          </span>
                        )}
                      </div>
                    </div>

                    {/* Arrow */}
                    <ChevronRight className="h-4 w-4 text-muted-foreground/50 group-hover:text-violet-500 group-hover:translate-x-0.5 transition-all shrink-0" />
                  </div>
                </motion.button>
              ))}
            </AnimatePresence>
          </div>
        )}
      </div>

      {/* ── Detail Drawer ── */}
      <AnimatePresence>
        {(detail || detailLoading) && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.2 }}
            className="absolute inset-0 z-40 bg-black/40 backdrop-blur-sm flex justify-end"
            onClick={() => {
              setDetail(null);
            }}
          >
            <motion.div
              initial={{ x: "100%" }}
              animate={{ x: 0 }}
              exit={{ x: "100%" }}
              transition={{ type: "spring", stiffness: 280, damping: 30 }}
              className="w-full max-w-[420px] h-full bg-white dark:bg-zinc-950 border-l border-slate-200/80 dark:border-white/[0.06] flex flex-col shadow-2xl"
              onClick={(e) => e.stopPropagation()}
            >
              {/* Drawer header */}
              <div className="flex items-start justify-between px-6 pt-6 pb-4 border-b border-slate-100 dark:border-white/[0.05] shrink-0">
                <div className="flex items-center gap-3 min-w-0">
                  {detail && (
                    <div
                      className={cn(
                        "h-11 w-11 rounded-xl bg-gradient-to-br flex items-center justify-center text-white text-[14px] font-black shrink-0 shadow-md",
                        getAvatarColor(detail.employee_name),
                      )}
                    >
                      {getInitials(detail.employee_name)}
                    </div>
                  )}
                  <div className="min-w-0">
                    <h2 className="text-[16px] font-black text-foreground truncate">
                      {detail?.employee_name || "Loading…"}
                    </h2>
                    {detail && (
                      <span
                        className={cn(
                          "inline-flex items-center gap-1 text-[10px] font-bold px-2 py-0.5 rounded-full mt-0.5",
                          detail.status === "completed"
                            ? "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border border-emerald-500/20"
                            : "bg-violet-500/10 text-violet-600 dark:text-violet-400 border border-violet-500/20",
                        )}
                      >
                        {detail.status === "completed" ? (
                          <CheckCircle2 className="h-3 w-3" />
                        ) : (
                          <Clock className="h-3 w-3" />
                        )}
                        {detail.status}
                      </span>
                    )}
                  </div>
                </div>
                <button
                  onClick={() => setDetail(null)}
                  className="text-muted-foreground hover:text-foreground hover:bg-muted/50 rounded-lg p-1.5 transition-colors shrink-0"
                >
                  <X className="h-4 w-4" />
                </button>
              </div>

              {detailLoading || !detail ? (
                <div className="flex-1 flex items-center justify-center text-muted-foreground gap-2">
                  <Loader2 className="h-5 w-5 animate-spin text-violet-500" />
                  <span className="text-[13px]">Loading journey…</span>
                </div>
              ) : (
                <div className="flex-1 overflow-auto px-6 py-5 space-y-6">
                  {/* Progress */}
                  <div className="flex items-center gap-4 p-4 rounded-2xl bg-gradient-to-br from-violet-50 to-indigo-50 dark:from-violet-950/30 dark:to-indigo-950/30 border border-violet-100 dark:border-violet-900/30">
                    <ProgressRing pct={detail.progress_pct} size={52} stroke={5} />
                    <div>
                      <div className="text-[26px] font-black text-foreground tabular-nums leading-none">
                        {detail.progress_pct}%
                      </div>
                      <div className="text-[12px] text-muted-foreground mt-0.5">
                        Overall completion
                      </div>
                    </div>
                  </div>

                  {/* Steps */}
                  <div>
                    <div className="flex items-center gap-2 mb-3">
                      <div className="h-5 w-5 rounded-md bg-gradient-to-br from-violet-500 to-indigo-600 flex items-center justify-center">
                        <CheckCircle2 className="h-3 w-3 text-white" />
                      </div>
                      <p className="text-[11px] font-bold uppercase tracking-wider text-foreground">
                        Onboarding Steps
                      </p>
                      <span className="ml-auto text-[11px] text-muted-foreground">
                        {
                          detail.steps.filter((s) => s.status === "done" || s.status === "skipped")
                            .length
                        }
                        /{detail.steps.length}
                      </span>
                    </div>
                    <ul className="space-y-2">
                      {detail.steps.map((s, i) => {
                        const done = s.status === "done" || s.status === "skipped";
                        return (
                          <motion.li
                            key={s.key}
                            initial={{ opacity: 0, x: -6 }}
                            animate={{ opacity: 1, x: 0 }}
                            transition={{ delay: i * 0.04 }}
                            className={cn(
                              "flex items-center gap-3 text-[13px] rounded-xl px-3 py-2.5 transition-colors",
                              done
                                ? "bg-emerald-50/70 dark:bg-emerald-950/20 border border-emerald-100 dark:border-emerald-900/30"
                                : "bg-slate-50/70 dark:bg-zinc-900/40 border border-slate-100 dark:border-white/[0.04]",
                            )}
                          >
                            {done ? (
                              <CheckCircle2 className="h-4 w-4 text-emerald-500 shrink-0" />
                            ) : (
                              <div className="h-4 w-4 rounded-full border-2 border-slate-300 dark:border-zinc-700 shrink-0" />
                            )}
                            <span
                              className={cn(
                                "flex-1",
                                done ? "text-foreground" : "text-muted-foreground",
                              )}
                            >
                              {s.title}
                            </span>
                            {s.auto && (
                              <span className="text-[9px] font-bold px-1.5 py-0.5 rounded bg-violet-100 dark:bg-violet-900/30 text-violet-600 dark:text-violet-400">
                                AUTO
                              </span>
                            )}
                          </motion.li>
                        );
                      })}
                    </ul>
                  </div>

                  {/* Documents */}
                  <div>
                    <div className="flex items-center gap-2 mb-3">
                      <div className="h-5 w-5 rounded-md bg-gradient-to-br from-sky-500 to-blue-600 flex items-center justify-center">
                        <FileText className="h-3 w-3 text-white" />
                      </div>
                      <p className="text-[11px] font-bold uppercase tracking-wider text-foreground">
                        Documents
                      </p>
                      <span className="ml-auto text-[11px] text-muted-foreground">
                        {detail.documents.filter((d) => d.submitted).length}/
                        {detail.documents.length}
                      </span>
                    </div>
                    <ul className="space-y-2">
                      {detail.documents.map((d, i) => (
                        <motion.li
                          key={i}
                          initial={{ opacity: 0, x: -6 }}
                          animate={{ opacity: 1, x: 0 }}
                          transition={{ delay: 0.1 + i * 0.04 }}
                          className={cn(
                            "flex items-center gap-3 text-[13px] rounded-xl px-3 py-2.5 transition-colors",
                            d.submitted
                              ? "bg-sky-50/70 dark:bg-sky-950/20 border border-sky-100 dark:border-sky-900/30"
                              : "bg-slate-50/70 dark:bg-zinc-900/40 border border-slate-100 dark:border-white/[0.04]",
                          )}
                        >
                          {d.submitted ? (
                            <CheckCircle2 className="h-4 w-4 text-sky-500 shrink-0" />
                          ) : (
                            <div className="h-4 w-4 rounded-full border-2 border-slate-300 dark:border-zinc-700 shrink-0" />
                          )}
                          <span
                            className={cn(
                              "flex-1",
                              d.submitted ? "text-foreground" : "text-muted-foreground",
                            )}
                          >
                            {d.name}
                          </span>
                          {d.status === "emailed" && (
                            <span className="flex items-center gap-1 text-[10px] font-bold text-emerald-600 dark:text-emerald-400 bg-emerald-50 dark:bg-emerald-950/30 px-2 py-0.5 rounded-full border border-emerald-200/50 dark:border-emerald-800/40">
                              <Mail className="h-2.5 w-2.5" /> Sent to HR
                            </span>
                          )}
                        </motion.li>
                      ))}
                    </ul>
                  </div>
                </div>
              )}
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
