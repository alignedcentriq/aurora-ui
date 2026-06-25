import { useAuth } from "@/lib/auth-store";
import { useCallback, useEffect, useMemo, useState } from "react";
import {
  GraduationCap,
  BookOpen,
  ClipboardList,
  UserCircle,
  Loader2,
  Plus,
  Layers,
  Clock,
  Award,
  CheckCircle2,
  XCircle,
  Sparkles,
  RefreshCw,
  X,
  Calendar,
  Star,
  ChevronRight,
  Check,
  Trophy,
  AlertTriangle,
  AlertCircle,
  HelpCircle,
  Users,
  Trash2,
  Search,
  Info,
  ListChecks,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { motion, AnimatePresence } from "framer-motion";

type Tab = "trainings" | "assignments" | "groups" | "mine";

interface Training {
  id: number;
  title: string;
  description?: string;
  category?: string;
  type: string;
  duration_minutes: number;
  pass_percentage: number;
  skill_tags: string[];
  levels: { id: number; name: string }[];
}

interface Assignment {
  id: number;
  training_id: number;
  training_title: string;
  category?: string;
  employee_name?: string;
  employee_email?: string;
  department?: string;
  status: string;
  score?: number | null;
  due_date?: string | null;
  skill_tags: string[];
}

interface Question {
  id: number;
  question: string;
  options: Record<string, string>;
  marks: number;
}

const fmtDuration = (m: number) =>
  m >= 60 ? `${Math.floor(m / 60)}h ${m % 60 ? `${m % 60}m` : ""}`.trim() : `${m}m`;

const STATUS_STYLES: Record<string, string> = {
  Completed:
    "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border border-emerald-500/20 dark:border-emerald-500/30 shadow-xs shadow-emerald-500/5",
  "In Progress":
    "bg-blue-500/10 text-blue-600 dark:text-blue-400 border border-blue-500/20 dark:border-blue-500/30 shadow-xs shadow-blue-500/5",
  Assigned:
    "bg-amber-500/10 text-amber-600 dark:text-amber-400 border border-amber-500/20 dark:border-amber-500/30 shadow-xs shadow-amber-500/5",
  Failed:
    "bg-red-500/10 text-red-600 dark:text-red-400 border border-red-500/20 dark:border-red-500/30 shadow-xs shadow-red-500/5",
};

export function TechElevateLocalPortal() {
  const { user } = useAuth();
  const [tab, setTab] = useState<Tab>("trainings");
  const [canManage, setCanManage] = useState(false);

  const authHeaders = useMemo(
    () => ({
      "Content-Type": "application/json",
      ...(user?.email ? { "x-user-email": user.email } : {}),
      ...(user?.role ? { "x-user-role": user.role.toLowerCase() } : {}),
    }),
    [user?.email, user?.role],
  );

  useEffect(() => {
    fetch("/api/portal/te-local/status", { headers: authHeaders })
      .then((r) => r.json())
      .then((s) => setCanManage(!!s.can_manage))
      .catch(() => setCanManage(false));
  }, [authHeaders]);

  const tabs: { id: Tab; label: string; subLabel: string; icon: typeof BookOpen; show: boolean }[] =
    [
      { id: "trainings", label: "Trainings", subLabel: "Catalog", icon: BookOpen, show: true },
      {
        id: "assignments",
        label: "Admin",
        subLabel: "Panel",
        icon: ClipboardList,
        show: canManage,
      },
      { id: "groups", label: "Groups", subLabel: "Cohorts", icon: Users, show: canManage },
      { id: "mine", label: "My Learning", subLabel: "Plan", icon: UserCircle, show: true },
    ];

  return (
    <div className="flex-1 h-full overflow-y-auto relative bg-gradient-to-b from-slate-50/50 to-slate-100/50 dark:from-zinc-950 dark:to-zinc-900/95 p-4 sm:p-6 transition-colors duration-300">
      {/* Visual Ambient Background Orbs */}
      <div className="absolute top-0 right-0 w-[400px] h-[400px] bg-gradient-to-tr from-violet-500/10 to-indigo-500/10 dark:from-violet-500/5 dark:to-indigo-500/5 rounded-full blur-[120px] pointer-events-none" />
      <div className="absolute bottom-20 left-10 w-[300px] h-[300px] bg-gradient-to-tr from-emerald-500/5 to-cyan-500/5 dark:from-emerald-500/2 dark:to-cyan-500/2 rounded-full blur-[100px] pointer-events-none" />

      {/* Modern Premium Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 mb-6 relative z-10">
        <div className="flex items-center gap-4">
          <div className="relative flex items-center justify-center p-3 rounded-2xl bg-gradient-to-br from-violet-500 to-indigo-600 text-white shadow-lg shadow-indigo-500/25 dark:shadow-indigo-500/10">
            <GraduationCap className="w-6 h-6 animate-pulse" />
            <div className="absolute -inset-1 rounded-2xl bg-gradient-to-br from-violet-500 to-indigo-600 opacity-20 blur-sm -z-10" />
          </div>
          <div>
            <div className="flex items-center gap-2">
              <h1 className="text-xl font-extrabold tracking-tight bg-gradient-to-r from-slate-900 to-slate-700 dark:from-white dark:to-zinc-300 bg-clip-text text-transparent">
                TechElevate LMS
              </h1>
              <span className="text-[10px] px-2 py-0.5 rounded-full font-bold uppercase tracking-wider bg-violet-500/15 text-violet-600 dark:text-violet-400 border border-violet-500/20">
                Local Simulator
              </span>
            </div>
            <p className="text-xs text-slate-500 dark:text-zinc-400 mt-1 max-w-xl">
              In-house learning portal. Complete standard/multi-level course assessments to earn
              verified skills.
            </p>
          </div>
        </div>

        {/* User Role Indicator inside Portal */}
        <div className="flex items-center gap-2 px-3 py-1.5 rounded-xl border border-slate-200/60 dark:border-zinc-800/80 bg-white/60 dark:bg-zinc-900/60 backdrop-blur-xs text-xs font-semibold text-slate-700 dark:text-zinc-300 shadow-xs">
          <span className="w-1.5 h-1.5 rounded-full bg-indigo-500 animate-ping" />
          Role:{" "}
          <span className="text-indigo-600 dark:text-indigo-400 font-bold capitalize">
            {user?.role || "Employee"}
          </span>
        </div>
      </div>

      {/* Premium Sliding Underlying Tab Bar */}
      <div className="relative z-10 flex items-center gap-1.5 p-1 rounded-2xl border border-slate-200/60 dark:border-zinc-800/80 bg-slate-100/80 dark:bg-zinc-900/60 backdrop-blur-md max-w-full overflow-x-auto no-scrollbar mb-6 shadow-xs shrink-0">
        {tabs
          .filter((t) => t.show)
          .map((t) => (
            <button
              key={t.id}
              onClick={() => setTab(t.id)}
              className={cn(
                "relative px-4 py-2.5 text-xs font-bold rounded-xl transition-all duration-200 inline-flex items-center gap-2 cursor-pointer select-none z-10 whitespace-nowrap",
                tab === t.id
                  ? "text-white"
                  : "text-slate-600 dark:text-zinc-400 hover:text-slate-800 dark:hover:text-zinc-200 hover:bg-slate-200/50 dark:hover:bg-zinc-800/40",
              )}
            >
              {tab === t.id && (
                <motion.div
                  layoutId="active-lms-tab"
                  className="absolute inset-0 bg-gradient-to-r from-violet-600 to-indigo-600 rounded-xl -z-10 shadow-md shadow-indigo-600/25"
                  transition={{ type: "spring", stiffness: 380, damping: 30 }}
                />
              )}
              <t.icon
                className={cn(
                  "w-4 h-4 transition-transform duration-200",
                  tab === t.id ? "scale-110" : "",
                )}
              />
              <span>
                {t.label}
                <span className="hidden sm:inline"> {t.subLabel}</span>
              </span>
            </button>
          ))}
      </div>

      {/* Tab Panels with AnimatePresence */}
      <div className="relative z-10">
        <AnimatePresence mode="wait">
          <motion.div
            key={tab}
            initial={{ opacity: 0, y: 15 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -15 }}
            transition={{ duration: 0.22, ease: "easeOut" }}
          >
            {tab === "trainings" && (
              <TrainingsTab authHeaders={authHeaders} canManage={canManage} />
            )}
            {tab === "assignments" && canManage && <AssignmentsTab authHeaders={authHeaders} />}
            {tab === "groups" && canManage && <GroupsTab authHeaders={authHeaders} />}
            {tab === "mine" && <MyLearningTab authHeaders={authHeaders} />}
          </motion.div>
        </AnimatePresence>
      </div>
    </div>
  );
}

// ── Trainings ────────────────────────────────────────────────────────────────

function TrainingsTab({
  authHeaders,
  canManage,
}: {
  authHeaders: Record<string, string>;
  canManage: boolean;
}) {
  const [trainings, setTrainings] = useState<Training[]>([]);
  const [stats, setStats] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(false);
  const [detailId, setDetailId] = useState<number | null>(null);

  const load = useCallback(() => {
    setLoading(true);
    Promise.all([
      fetch("/api/portal/te-local/trainings", { headers: authHeaders }).then((r) => r.json()),
      fetch("/api/portal/te-local/trainings/stats", { headers: authHeaders }).then((r) => r.json()),
    ])
      .then(([t, s]) => {
        setTrainings(t.results || []);
        setStats(s);
      })
      .finally(() => setLoading(false));
  }, [authHeaders]);

  useEffect(() => {
    load();
  }, [load]);

  if (loading) return <Spinner label="Loading training catalog…" />;

  const getCategoryColors = (cat?: string) => {
    if (cat === "Technical")
      return {
        border:
          "hover:border-violet-500/50 border-t-4 border-t-violet-500 dark:border-t-violet-500",
        badge: "bg-violet-500/10 text-violet-600 dark:text-violet-400 border border-violet-500/20",
        glow: "hover:shadow-violet-500/5",
      };
    if (cat === "Governance & Compliance")
      return {
        border:
          "hover:border-emerald-500/50 border-t-4 border-t-emerald-500 dark:border-t-emerald-500",
        badge:
          "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border border-emerald-500/20",
        glow: "hover:shadow-emerald-500/5",
      };
    if (cat === "Business")
      return {
        border: "hover:border-amber-500/50 border-t-4 border-t-amber-500 dark:border-t-amber-500",
        badge: "bg-amber-500/10 text-amber-600 dark:text-amber-400 border border-amber-500/20",
        glow: "hover:shadow-amber-500/5",
      };
    return {
      border: "hover:border-indigo-500/50 border-t-4 border-t-indigo-500 dark:border-t-indigo-500",
      badge: "bg-indigo-500/10 text-indigo-600 dark:text-indigo-400 border border-indigo-500/20",
      glow: "hover:shadow-indigo-500/5",
    };
  };

  return (
    <div className="flex flex-col gap-5">
      {stats && (
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
          <KpiCard
            label="Total Courses"
            value={stats.total_trainings}
            icon={BookOpen}
            colorClass="text-blue-500 bg-blue-500/10"
          />
          <KpiCard
            label="Multi-level Tracks"
            value={stats.with_levels}
            icon={Layers}
            colorClass="text-violet-500 bg-violet-500/10"
          />
          <KpiCard
            label="Single-level Courses"
            value={stats.single_level}
            icon={Award}
            colorClass="text-amber-500 bg-amber-500/10"
          />
          <KpiCard
            label="Est. Learning Hours"
            value={fmtDuration(stats.total_duration_minutes)}
            icon={Clock}
            colorClass="text-emerald-500 bg-emerald-500/10"
          />
        </div>
      )}

      {canManage && (
        <div className="flex justify-end">
          <button
            onClick={() => setCreating(true)}
            className="px-4 py-2.5 rounded-xl bg-gradient-to-r from-violet-600 to-indigo-600 hover:from-violet-500 hover:to-indigo-500 text-white text-xs font-bold shadow-md shadow-indigo-600/25 transition-all duration-200 hover:scale-[1.02] active:scale-95 inline-flex items-center gap-2 cursor-pointer"
          >
            <Plus className="w-4 h-4" /> Create Course
          </button>
        </div>
      )}

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-5">
        {trainings.map((t) => {
          const colors = getCategoryColors(t.category);
          return (
            <motion.div
              key={t.id}
              whileHover={{ y: -4, transition: { duration: 0.15 } }}
              onClick={() => setDetailId(t.id)}
              className={cn(
                "flex flex-col rounded-2xl border border-slate-200/60 dark:border-zinc-800/80 bg-white/70 dark:bg-zinc-900/40 p-5 shadow-xs backdrop-blur-md transition-all duration-300 group hover:shadow-md cursor-pointer",
                colors.border,
                colors.glow,
              )}
            >
              <div className="flex items-start justify-between gap-3 mb-2">
                <h3 className="text-sm font-bold text-slate-800 dark:text-zinc-200 group-hover:text-indigo-600 dark:group-hover:text-indigo-400 transition-colors leading-snug">
                  {t.title}
                </h3>
                {t.type === "levels" ? (
                  <span className="shrink-0 inline-flex items-center gap-1 text-[10px] font-extrabold px-2 py-0.5 rounded-full bg-indigo-500/10 text-indigo-600 dark:text-indigo-400 border border-indigo-500/20">
                    <Layers className="w-3 h-3" /> {t.levels.length} Levels
                  </span>
                ) : (
                  <span className="shrink-0 inline-flex items-center gap-1 text-[10px] font-extrabold px-2 py-0.5 rounded-full bg-slate-500/10 text-slate-600 dark:text-zinc-400 border border-slate-200">
                    Single Level
                  </span>
                )}
              </div>

              {t.description && (
                <p className="text-xs text-slate-500 dark:text-zinc-400 mt-1 line-clamp-3 leading-relaxed mb-4">
                  {t.description}
                </p>
              )}

              {/* Skill tags */}
              {t.skill_tags && t.skill_tags.length > 0 && (
                <div className="flex flex-wrap gap-1 mt-auto mb-4">
                  {t.skill_tags.map((s) => (
                    <span
                      key={s}
                      className="text-[9px] font-bold px-2 py-0.5 rounded-full bg-slate-100 dark:bg-zinc-800 text-slate-600 dark:text-zinc-400 border border-slate-200/50 dark:border-zinc-800/50"
                    >
                      {s}
                    </span>
                  ))}
                </div>
              )}

              <div className="flex items-center justify-between border-t border-slate-100 dark:border-zinc-800/60 pt-3 mt-auto text-[10px] font-bold text-slate-400 dark:text-zinc-500">
                <span
                  className={cn(
                    "px-2 py-0.5 rounded-full uppercase tracking-wider text-[9px]",
                    colors.badge,
                  )}
                >
                  {t.category || "General"}
                </span>
                <div className="flex items-center gap-3">
                  <span className="inline-flex items-center gap-0.5">
                    <Clock className="w-3.5 h-3.5 text-slate-400 dark:text-zinc-500" />{" "}
                    {fmtDuration(t.duration_minutes)}
                  </span>
                  <span className="inline-flex items-center gap-0.5">
                    <Award className="w-3.5 h-3.5 text-amber-500" /> {t.pass_percentage}%
                  </span>
                </div>
              </div>
            </motion.div>
          );
        })}
      </div>

      {creating && (
        <CreateTrainingModal
          authHeaders={authHeaders}
          onClose={() => setCreating(false)}
          onSaved={() => {
            setCreating(false);
            load();
          }}
        />
      )}

      {detailId != null && (
        <TrainingDetailModal
          authHeaders={authHeaders}
          trainingId={detailId}
          canManage={canManage}
          onClose={() => setDetailId(null)}
          onChanged={load}
        />
      )}
    </div>
  );
}

// ── Training detail: about · levels · MCQ authoring · who's enrolled ───────────

function TrainingDetailModal({
  authHeaders,
  trainingId,
  canManage,
  onClose,
  onChanged,
}: {
  authHeaders: Record<string, string>;
  trainingId: number;
  canManage: boolean;
  onClose: () => void;
  onChanged: () => void;
}) {
  const [detail, setDetail] = useState<any>(null);
  const [questions, setQuestions] = useState<any[]>([]);
  const [enrollments, setEnrollments] = useState<Assignment[]>([]);
  const [loading, setLoading] = useState(true);
  const [view, setView] = useState<"about" | "questions" | "enrolled">("about");
  const [adding, setAdding] = useState(false);

  const load = useCallback(() => {
    Promise.all([
      fetch(`/api/portal/te-local/trainings/${trainingId}`, { headers: authHeaders }).then((r) => r.json()),
      fetch(`/api/portal/te-local/trainings/${trainingId}/questions${canManage ? "?manage=true" : ""}`, {
        headers: authHeaders,
      }).then((r) => r.json()),
      canManage
        ? fetch(`/api/portal/te-local/trainings/${trainingId}/enrollments`, { headers: authHeaders }).then((r) => r.json())
        : Promise.resolve({ results: [] }),
    ])
      .then(([d, q, e]) => {
        setDetail(d);
        setQuestions(q.results || []);
        setEnrollments(e.results || []);
      })
      .finally(() => setLoading(false));
  }, [authHeaders, trainingId, canManage]);

  useEffect(() => {
    load();
  }, [load]);

  const removeQuestion = async (qid: number) => {
    await fetch(`/api/portal/te-local/questions/${qid}`, { method: "DELETE", headers: authHeaders });
    load();
  };

  const tabs = [
    { id: "about" as const, label: "Overview", icon: Info },
    { id: "questions" as const, label: `Assessment (${questions.length})`, icon: ListChecks },
    ...(canManage ? [{ id: "enrolled" as const, label: `Enrolled (${enrollments.length})`, icon: Users }] : []),
  ];

  return (
    <Modal title={detail?.title || "Training"} onClose={onClose}>
      {loading ? (
        <Spinner label="Loading course…" />
      ) : (
        <div className="flex flex-col gap-4">
          <div className="flex items-center gap-1 p-1 rounded-xl bg-slate-100/80 dark:bg-zinc-900/60 border border-slate-200/60 dark:border-zinc-800/80">
            {tabs.map((t) => (
              <button
                key={t.id}
                onClick={() => setView(t.id)}
                className={cn(
                  "flex-1 px-3 py-1.5 text-[11px] font-bold rounded-lg inline-flex items-center justify-center gap-1.5 transition-colors",
                  view === t.id
                    ? "bg-white dark:bg-zinc-800 text-indigo-600 dark:text-indigo-400 shadow-xs"
                    : "text-slate-500 dark:text-zinc-400 hover:text-slate-700",
                )}
              >
                <t.icon className="w-3.5 h-3.5" /> {t.label}
              </button>
            ))}
          </div>

          {view === "about" && (
            <div className="flex flex-col gap-3">
              {detail.description && (
                <p className="text-sm text-slate-600 dark:text-zinc-300 leading-relaxed">{detail.description}</p>
              )}
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                <MiniStat label="Category" value={detail.category || "—"} />
                <MiniStat label="Duration" value={fmtDuration(detail.duration_minutes)} />
                <MiniStat label="Pass mark" value={`${detail.pass_percentage}%`} />
                <MiniStat label="Type" value={detail.type === "levels" ? `${detail.levels.length} levels` : "Single"} />
              </div>
              {detail.skill_tags?.length > 0 && (
                <div>
                  <p className="text-[10px] font-extrabold text-slate-400 dark:text-zinc-500 uppercase tracking-wider mb-1.5">
                    Skills earned on completion
                  </p>
                  <div className="flex flex-wrap gap-1.5">
                    {detail.skill_tags.map((s: string) => (
                      <span key={s} className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border border-emerald-500/20">
                        {s}
                      </span>
                    ))}
                  </div>
                </div>
              )}
              {detail.levels?.length > 0 && (
                <div className="flex flex-col gap-1.5">
                  <p className="text-[10px] font-extrabold text-slate-400 dark:text-zinc-500 uppercase tracking-wider">Levels</p>
                  {detail.levels.map((lv: any) => (
                    <div key={lv.id} className="flex items-center justify-between rounded-lg border border-slate-200/60 dark:border-zinc-800/80 px-3 py-2 text-xs">
                      <span className="font-bold text-slate-700 dark:text-zinc-300">{lv.name}</span>
                      <span className="text-slate-400 dark:text-zinc-500">
                        {fmtDuration(lv.duration_minutes)} · pass {lv.pass_percentage}%
                      </span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}

          {view === "questions" && (
            <div className="flex flex-col gap-3">
              {canManage && (
                <button
                  onClick={() => setAdding(true)}
                  className="self-end px-3 py-1.5 rounded-lg bg-gradient-to-r from-violet-600 to-indigo-600 text-white text-[11px] font-bold inline-flex items-center gap-1.5 cursor-pointer"
                >
                  <Plus className="w-3.5 h-3.5" /> Add Question
                </button>
              )}
              {questions.length === 0 ? (
                <p className="text-center py-8 text-xs font-bold text-slate-400 dark:text-zinc-500 uppercase tracking-wider">
                  No questions yet.
                </p>
              ) : (
                questions.map((q, i) => (
                  <div key={q.id} className="rounded-xl border border-slate-200/60 dark:border-zinc-800/80 bg-slate-50/50 dark:bg-zinc-900/30 p-3">
                    <div className="flex items-start justify-between gap-2">
                      <p className="text-sm font-bold text-slate-800 dark:text-zinc-200">
                        <span className="text-indigo-500">Q{i + 1}.</span> {q.question}
                      </p>
                      {canManage && (
                        <button onClick={() => removeQuestion(q.id)} className="text-slate-400 hover:text-red-500 shrink-0">
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      )}
                    </div>
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-1 mt-2 pl-5">
                      {Object.entries(q.options || {}).map(([k, v]) => (
                        <span
                          key={k}
                          className={cn(
                            "text-[11px] px-2 py-1 rounded-lg border",
                            q.correct_answer === k
                              ? "border-emerald-500/40 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300 font-bold"
                              : "border-slate-200/60 dark:border-zinc-800/80 text-slate-500 dark:text-zinc-400",
                          )}
                        >
                          <span className="font-extrabold uppercase">{k}.</span> {String(v)}
                          {q.correct_answer === k && <Check className="w-3 h-3 inline ml-1" />}
                        </span>
                      ))}
                    </div>
                  </div>
                ))
              )}
            </div>
          )}

          {view === "enrolled" && canManage && (
            <div className="flex flex-col gap-2 max-h-[55vh] overflow-y-auto">
              {enrollments.length === 0 ? (
                <p className="text-center py-8 text-xs font-bold text-slate-400 dark:text-zinc-500 uppercase tracking-wider">
                  Nobody enrolled yet.
                </p>
              ) : (
                enrollments.map((a) => (
                  <div key={a.id} className="flex items-center justify-between gap-2 rounded-lg border border-slate-200/60 dark:border-zinc-800/80 px-3 py-2">
                    <div className="min-w-0">
                      <p className="text-xs font-bold text-slate-800 dark:text-zinc-200 truncate">{a.employee_name || a.employee_email}</p>
                      <p className="text-[10px] text-slate-400 dark:text-zinc-500 truncate">{a.department || a.employee_email}</p>
                    </div>
                    <div className="flex items-center gap-2 shrink-0">
                      {a.score != null && <span className="text-[11px] font-black text-slate-600 dark:text-zinc-300">{a.score}%</span>}
                      <span className={cn("text-[9px] px-2 py-0.5 rounded-full font-bold uppercase tracking-wider", STATUS_STYLES[a.status] || "bg-muted")}>
                        {a.status}
                      </span>
                    </div>
                  </div>
                ))
              )}
            </div>
          )}
        </div>
      )}

      {adding && (
        <AddQuestionModal
          authHeaders={authHeaders}
          trainingId={trainingId}
          onClose={() => setAdding(false)}
          onSaved={() => {
            setAdding(false);
            load();
            onChanged();
          }}
        />
      )}
    </Modal>
  );
}

function AddQuestionModal({
  authHeaders,
  trainingId,
  onClose,
  onSaved,
}: {
  authHeaders: Record<string, string>;
  trainingId: number;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [q, setQ] = useState({ question: "", A: "", B: "", C: "", D: "", correct: "A", marks: 1, explanation: "" });
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState("");

  const submit = async () => {
    if (!q.question.trim() || !q.A.trim() || !q.B.trim()) {
      setErr("Question and at least options A & B are required.");
      return;
    }
    setSaving(true);
    setErr("");
    try {
      const options: Record<string, string> = { A: q.A, B: q.B };
      if (q.C.trim()) options.C = q.C;
      if (q.D.trim()) options.D = q.D;
      const resp = await fetch(`/api/portal/te-local/trainings/${trainingId}/questions`, {
        method: "POST",
        headers: authHeaders,
        body: JSON.stringify({
          question: q.question,
          options,
          correct_answer: q.correct,
          marks: Number(q.marks),
          explanation: q.explanation,
        }),
      });
      if (!resp.ok) throw new Error((await resp.json().catch(() => ({}))).detail || "Failed.");
      onSaved();
    } catch (e: any) {
      setErr(e.message);
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal title="Add MCQ Question" onClose={onClose}>
      <div className="flex flex-col gap-3">
        <Field label="Question *">
          <textarea className={inputCls} rows={2} value={q.question} onChange={(e) => setQ({ ...q, question: e.target.value })} />
        </Field>
        {(["A", "B", "C", "D"] as const).map((opt) => (
          <div key={opt} className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => setQ({ ...q, correct: opt })}
              className={cn(
                "w-7 h-7 shrink-0 rounded-lg text-xs font-black border transition-colors",
                q.correct === opt
                  ? "bg-emerald-500 text-white border-emerald-500"
                  : "border-slate-200 dark:border-zinc-800 text-slate-400 hover:border-emerald-400",
              )}
              title="Mark as correct answer"
            >
              {opt}
            </button>
            <input
              className={inputCls}
              placeholder={`Option ${opt}${opt === "C" || opt === "D" ? " (optional)" : ""}`}
              value={q[opt]}
              onChange={(e) => setQ({ ...q, [opt]: e.target.value })}
            />
          </div>
        ))}
        <p className="text-[10px] text-slate-400 dark:text-zinc-500 font-medium">
          Tap a letter to mark the <span className="font-bold text-emerald-500">correct answer</span> (currently {q.correct}).
        </p>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Marks">
            <input type="number" className={inputCls} value={q.marks} onChange={(e) => setQ({ ...q, marks: +e.target.value })} />
          </Field>
        </div>
        <Field label="Explanation (optional)">
          <input className={inputCls} value={q.explanation} onChange={(e) => setQ({ ...q, explanation: e.target.value })} />
        </Field>
        {err && <p className="text-xs font-bold text-red-500">{err}</p>}
        <div className="flex justify-end gap-2 pt-2 border-t border-slate-100 dark:border-zinc-900">
          <button onClick={onClose} className="px-4 py-2.5 text-xs font-bold rounded-xl border border-slate-200 dark:border-zinc-800/80 text-slate-600 dark:text-zinc-400 hover:bg-slate-50 dark:hover:bg-zinc-900 cursor-pointer">
            Cancel
          </button>
          <button onClick={submit} disabled={saving} className="px-4 py-2.5 text-xs font-bold rounded-xl bg-gradient-to-r from-violet-600 to-indigo-600 text-white shadow-md disabled:opacity-50 inline-flex items-center gap-1.5 cursor-pointer">
            {saving && <Loader2 className="w-3.5 h-3.5 animate-spin" />} Add Question
          </button>
        </div>
      </div>
    </Modal>
  );
}

function MiniStat({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="rounded-lg border border-slate-200/60 dark:border-zinc-800/80 bg-slate-50/50 dark:bg-zinc-900/30 px-3 py-2">
      <p className="text-[9px] font-extrabold text-slate-400 dark:text-zinc-500 uppercase tracking-wider">{label}</p>
      <p className="text-xs font-bold text-slate-700 dark:text-zinc-300 mt-0.5">{value}</p>
    </div>
  );
}

function CreateTrainingModal({
  authHeaders,
  onClose,
  onSaved,
}: {
  authHeaders: Record<string, string>;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [form, setForm] = useState({
    title: "",
    description: "",
    category: "Technical",
    duration_minutes: 120,
    pass_percentage: 60,
    skills: "",
  });
  const [multiLevel, setMultiLevel] = useState(false);
  const [levels, setLevels] = useState([
    { name: "Basic", duration_minutes: 60, pass_percentage: 60, description: "" },
    { name: "Intermediate", duration_minutes: 60, pass_percentage: 65, description: "" },
    { name: "Advanced", duration_minutes: 60, pass_percentage: 70, description: "" },
  ]);
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState("");

  const submit = async () => {
    if (!form.title.trim()) {
      setErr("Title is required.");
      return;
    }
    setSaving(true);
    setErr("");
    try {
      const resp = await fetch("/api/portal/te-local/trainings", {
        method: "POST",
        headers: authHeaders,
        body: JSON.stringify({
          title: form.title,
          description: form.description,
          category: form.category,
          duration_minutes: Number(form.duration_minutes),
          pass_percentage: Number(form.pass_percentage),
          skill_tags: form.skills
            .split(",")
            .map((s) => s.trim())
            .filter(Boolean),
          levels: multiLevel
            ? levels.map((l) => ({
                name: l.name,
                duration_minutes: Number(l.duration_minutes),
                pass_percentage: Number(l.pass_percentage),
                description: l.description,
              }))
            : [],
        }),
      });
      if (!resp.ok)
        throw new Error((await resp.json().catch(() => ({}))).detail || "Failed to create.");
      onSaved();
    } catch (e: any) {
      setErr(e.message);
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal title="New Training" onClose={onClose}>
      <div className="flex flex-col gap-3">
        <Field label="Title *">
          <input
            className={inputCls}
            value={form.title}
            onChange={(e) => setForm({ ...form, title: e.target.value })}
          />
        </Field>
        <Field label="Description">
          <textarea
            className={inputCls}
            rows={2}
            value={form.description}
            onChange={(e) => setForm({ ...form, description: e.target.value })}
          />
        </Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Category">
            <select
              className={inputCls}
              value={form.category}
              onChange={(e) => setForm({ ...form, category: e.target.value })}
            >
              <option>Technical</option>
              <option>Governance & Compliance</option>
              <option>Business</option>
            </select>
          </Field>
          <Field label="Duration (min)">
            <input
              type="number"
              className={inputCls}
              value={form.duration_minutes}
              onChange={(e) => setForm({ ...form, duration_minutes: +e.target.value })}
            />
          </Field>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Pass %">
            <input
              type="number"
              className={inputCls}
              value={form.pass_percentage}
              onChange={(e) => setForm({ ...form, pass_percentage: +e.target.value })}
            />
          </Field>
          <Field label="Skill tags (comma-sep)">
            <input
              className={inputCls}
              placeholder="Python, ML"
              value={form.skills}
              onChange={(e) => setForm({ ...form, skills: e.target.value })}
            />
          </Field>
        </div>
        <label className="flex items-center gap-2 cursor-pointer select-none">
          <input
            type="checkbox"
            checked={multiLevel}
            onChange={(e) => setMultiLevel(e.target.checked)}
            className="accent-violet-600 w-4 h-4"
          />
          <span className="text-[11px] font-bold text-slate-600 dark:text-zinc-300 inline-flex items-center gap-1.5">
            <Layers className="w-3.5 h-3.5 text-indigo-500" /> Multi-level course (Basic · Intermediate · Advanced)
          </span>
        </label>
        {multiLevel && (
          <div className="flex flex-col gap-2 rounded-xl border border-slate-200/60 dark:border-zinc-800/80 p-3 bg-slate-50/40 dark:bg-zinc-900/30">
            {levels.map((lv, i) => (
              <div key={lv.name} className="flex items-center gap-2">
                <span className="text-[10px] font-extrabold w-20 shrink-0 text-slate-500 dark:text-zinc-400 uppercase tracking-wider">
                  {lv.name}
                </span>
                <input
                  type="number"
                  className={inputCls}
                  placeholder="min"
                  value={lv.duration_minutes}
                  onChange={(e) => {
                    const next = [...levels];
                    next[i] = { ...lv, duration_minutes: +e.target.value };
                    setLevels(next);
                  }}
                />
                <input
                  type="number"
                  className={inputCls}
                  placeholder="pass %"
                  value={lv.pass_percentage}
                  onChange={(e) => {
                    const next = [...levels];
                    next[i] = { ...lv, pass_percentage: +e.target.value };
                    setLevels(next);
                  }}
                />
              </div>
            ))}
          </div>
        )}
        <p className="text-[10px] text-slate-400 dark:text-zinc-500 font-medium">
          Skill tags are written back as{" "}
          <span className="font-bold text-slate-500 dark:text-zinc-400">verified skills</span> when
          a learner passes this training. Add assessment questions from the course detail view after creating.
        </p>
        {err && <p className="text-xs font-bold text-red-500 dark:text-red-400">{err}</p>}
        <div className="flex justify-end gap-2 pt-2 border-t border-slate-100 dark:border-zinc-900">
          <button
            onClick={onClose}
            className="px-4 py-2.5 text-xs font-bold rounded-xl border border-slate-200 dark:border-zinc-800/80 text-slate-600 dark:text-zinc-400 hover:bg-slate-50 dark:hover:bg-zinc-900 transition-all duration-200 cursor-pointer"
          >
            Cancel
          </button>
          <button
            onClick={submit}
            disabled={saving}
            className="px-4 py-2.5 text-xs font-bold rounded-xl bg-gradient-to-r from-violet-600 to-indigo-600 hover:from-violet-500 hover:to-indigo-500 text-white shadow-md shadow-indigo-600/25 dark:shadow-indigo-500/10 hover:shadow-lg transition-all duration-200 cursor-pointer active:scale-95 disabled:opacity-50 inline-flex items-center gap-1.5"
          >
            {saving && <Loader2 className="w-3.5 h-3.5 animate-spin" />} Create Training
          </button>
        </div>
      </div>
    </Modal>
  );
}

// ── Assignments (admin) ──────────────────────────────────────────────────────

function AssignmentsTab({ authHeaders }: { authHeaders: Record<string, string> }) {
  const [rows, setRows] = useState<Assignment[]>([]);
  const [stats, setStats] = useState<any>(null);
  const [trainings, setTrainings] = useState<Training[]>([]);
  const [loading, setLoading] = useState(true);
  const [assigning, setAssigning] = useState(false);

  const load = useCallback(() => {
    setLoading(true);
    Promise.all([
      fetch("/api/portal/te-local/assignments", { headers: authHeaders }).then((r) => r.json()),
      fetch("/api/portal/te-local/assignments/stats", { headers: authHeaders }).then((r) =>
        r.json(),
      ),
      fetch("/api/portal/te-local/trainings", { headers: authHeaders }).then((r) => r.json()),
    ])
      .then(([a, s, t]) => {
        setRows(a.results || []);
        setStats(s);
        setTrainings(t.results || []);
      })
      .finally(() => setLoading(false));
  }, [authHeaders]);

  useEffect(() => {
    load();
  }, [load]);

  if (loading) return <Spinner label="Loading assignments ledger…" />;

  return (
    <div className="flex flex-col gap-5">
      {stats && (
        <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-4">
          <KpiCard
            label="Total Learners"
            value={stats.total_users}
            icon={UserCircle}
            colorClass="text-blue-500 bg-blue-500/10"
          />
          <KpiCard
            label="Assignments"
            value={stats.total_assignments}
            icon={ClipboardList}
            colorClass="text-violet-500 bg-violet-500/10"
          />
          <KpiCard
            label="Completed"
            value={stats.completed}
            icon={CheckCircle2}
            colorClass="text-emerald-500 bg-emerald-500/10"
          />
          <KpiCard
            label="In Progress"
            value={stats.in_progress}
            icon={Loader2}
            colorClass="text-amber-500 bg-amber-500/10"
          />
          <KpiCard
            label="Completion Rate"
            value={`${stats.completion_rate}%`}
            icon={Award}
            colorClass="text-cyan-500 bg-cyan-500/10"
          />
          <KpiCard
            label="Average Score"
            value={`${stats.average_score}%`}
            icon={Sparkles}
            colorClass="text-amber-500 bg-amber-500/10"
          />
        </div>
      )}

      <div className="flex justify-end">
        <button
          onClick={() => setAssigning(true)}
          className="px-4 py-2.5 rounded-xl bg-gradient-to-r from-violet-600 to-indigo-600 hover:from-violet-500 hover:to-indigo-500 text-white text-xs font-bold shadow-md shadow-indigo-600/25 transition-all duration-200 hover:scale-[1.02] active:scale-95 inline-flex items-center gap-2 cursor-pointer"
        >
          <Plus className="w-4 h-4" /> Assign Course
        </button>
      </div>

      <div className="rounded-2xl border border-slate-200/50 dark:border-zinc-800/80 bg-white/70 dark:bg-zinc-900/40 shadow-xs backdrop-blur-md overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-slate-50/50 dark:bg-zinc-900/50 border-b border-slate-100 dark:border-zinc-800/60">
              <tr>
                {["Employee", "Department", "Assigned Course", "Status", "Exam Score"].map((c) => (
                  <th
                    key={c}
                    className="text-left px-4 py-3.5 text-[10px] font-extrabold text-slate-400 dark:text-zinc-500 uppercase tracking-wider whitespace-nowrap"
                  >
                    {c}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 dark:divide-zinc-800/60">
              {rows.map((a) => {
                const initial = (a.employee_name || a.employee_email || "?")[0].toUpperCase();
                return (
                  <tr
                    key={a.id}
                    className="hover:bg-slate-50/50 dark:hover:bg-zinc-800/35 transition-colors duration-200"
                  >
                    <td className="px-4 py-3.5 whitespace-nowrap">
                      <div className="flex items-center gap-3">
                        <div className="w-7 h-7 rounded-full flex items-center justify-center text-[10px] font-black text-white bg-gradient-to-tr from-violet-500 to-indigo-500 shadow-xs shrink-0 select-none">
                          {initial}
                        </div>
                        <div className="min-w-0">
                          <p className="font-bold text-slate-800 dark:text-zinc-200 text-xs sm:text-sm truncate">
                            {a.employee_name || a.employee_email}
                          </p>
                          {a.employee_name && a.employee_email && (
                            <p className="text-[10px] text-slate-400 dark:text-zinc-500 truncate leading-none">
                              {a.employee_email}
                            </p>
                          )}
                        </div>
                      </div>
                    </td>
                    <td className="px-4 py-3.5 whitespace-nowrap text-xs font-semibold text-slate-500 dark:text-zinc-400">
                      {a.department || "—"}
                    </td>
                    <td className="px-4 py-3.5 whitespace-nowrap text-xs font-bold text-slate-700 dark:text-zinc-300">
                      {a.training_title}
                    </td>
                    <td className="px-4 py-3.5 whitespace-nowrap">
                      <span
                        className={cn(
                          "text-[10px] px-2 py-0.5 rounded-full font-bold uppercase tracking-wider",
                          STATUS_STYLES[a.status] || "bg-muted",
                        )}
                      >
                        {a.status}
                      </span>
                    </td>
                    <td className="px-4 py-3.5 whitespace-nowrap text-xs font-black">
                      {a.score != null ? (
                        <span
                          className={cn(
                            a.status === "Completed"
                              ? "text-emerald-600 dark:text-emerald-400"
                              : a.status === "Failed"
                                ? "text-red-500"
                                : "text-slate-700 dark:text-zinc-300",
                          )}
                        >
                          {a.score}%
                        </span>
                      ) : (
                        <span className="text-slate-400 dark:text-zinc-600 font-normal">—</span>
                      )}
                    </td>
                  </tr>
                );
              })}
              {rows.length === 0 && (
                <tr>
                  <td
                    colSpan={5}
                    className="px-4 py-12 text-center text-slate-400 dark:text-zinc-500 text-xs font-medium"
                  >
                    No learning assignments found on the platform ledger.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      {assigning && (
        <AssignModal
          authHeaders={authHeaders}
          trainings={trainings}
          onClose={() => setAssigning(false)}
          onSaved={() => {
            setAssigning(false);
            load();
          }}
        />
      )}
    </div>
  );
}

function AssignModal({
  authHeaders,
  trainings,
  onClose,
  onSaved,
}: {
  authHeaders: Record<string, string>;
  trainings: Training[];
  onClose: () => void;
  onSaved: () => void;
}) {
  const [trainingId, setTrainingId] = useState<number | "">(trainings[0]?.id ?? "");
  const [emails, setEmails] = useState("");
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState("");

  const submit = async () => {
    const list = emails
      .split(/[\n,]/)
      .map((s) => s.trim())
      .filter(Boolean);
    if (!trainingId || list.length === 0) {
      setErr("Pick a training and at least one employee email.");
      return;
    }
    setSaving(true);
    setErr("");
    try {
      const resp = await fetch("/api/portal/te-local/assignments", {
        method: "POST",
        headers: authHeaders,
        body: JSON.stringify({ training_id: trainingId, employees: list }),
      });
      if (!resp.ok)
        throw new Error((await resp.json().catch(() => ({}))).detail || "Failed to assign.");
      onSaved();
    } catch (e: any) {
      setErr(e.message);
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal title="Assign Training Course" onClose={onClose}>
      <div className="flex flex-col gap-4">
        <Field label="Select Course">
          <select
            className={inputCls}
            value={trainingId}
            onChange={(e) => setTrainingId(e.target.value ? +e.target.value : "")}
          >
            {trainings.map((t) => (
              <option key={t.id} value={t.id}>
                {t.title}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Learners emails (comma or newline separated)">
          <textarea
            className={inputCls}
            rows={3}
            placeholder="asha@x.com, vik@x.com"
            value={emails}
            onChange={(e) => setEmails(e.target.value)}
          />
        </Field>
        {err && <p className="text-xs font-bold text-red-500 dark:text-red-400">{err}</p>}
        <div className="flex justify-end gap-2 pt-2 border-t border-slate-100 dark:border-zinc-900">
          <button
            onClick={onClose}
            className="px-4 py-2.5 text-xs font-bold rounded-xl border border-slate-200 dark:border-zinc-800/80 text-slate-600 dark:text-zinc-400 hover:bg-slate-50 dark:hover:bg-zinc-900 transition-all duration-200 cursor-pointer"
          >
            Cancel
          </button>
          <button
            onClick={submit}
            disabled={saving}
            className="px-4 py-2.5 text-xs font-bold rounded-xl bg-gradient-to-r from-violet-600 to-indigo-600 hover:from-violet-500 hover:to-indigo-500 text-white shadow-md shadow-indigo-600/25 dark:shadow-indigo-500/10 hover:shadow-lg transition-all duration-200 cursor-pointer active:scale-95 disabled:opacity-50 inline-flex items-center gap-1.5"
          >
            {saving && <Loader2 className="w-3.5 h-3.5 animate-spin" />} Assign Course
          </button>
        </div>
      </div>
    </Modal>
  );
}

// ── My Learning + assessment (the flywheel moment) ───────────────────────────

function MyLearningTab({ authHeaders }: { authHeaders: Record<string, string> }) {
  const [rows, setRows] = useState<Assignment[]>([]);
  const [loading, setLoading] = useState(true);
  const [active, setActive] = useState<Assignment | null>(null);

  const load = useCallback(() => {
    setLoading(true);
    fetch("/api/portal/te-local/assignments/my", { headers: authHeaders })
      .then((r) => r.json())
      .then((d) => setRows(d.results || []))
      .finally(() => setLoading(false));
  }, [authHeaders]);

  useEffect(() => {
    load();
  }, [load]);

  if (loading) return <Spinner label="Loading your trainings…" />;
  if (!rows.length) {
    return (
      <div className="text-center py-20 text-slate-400 dark:text-zinc-500 text-xs font-semibold uppercase tracking-wider flex flex-col items-center gap-3">
        <div className="p-4 rounded-full bg-slate-100 dark:bg-zinc-800/80 text-slate-400 dark:text-zinc-500 border border-slate-200/50 dark:border-zinc-800/50">
          <GraduationCap className="w-8 h-8" />
        </div>
        <span>No courses assigned to your study plan.</span>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-3.5">
      {rows.map((a) => (
        <motion.div
          key={a.id}
          whileHover={{ x: 3, transition: { duration: 0.15 } }}
          className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 rounded-2xl border border-slate-200/50 dark:border-zinc-800 bg-white/70 dark:bg-zinc-900/40 p-4 shadow-xs backdrop-blur-md transition-all group"
        >
          <div className="min-w-0 w-full sm:w-auto">
            <p className="text-sm font-extrabold text-slate-800 dark:text-zinc-200 group-hover:text-indigo-600 dark:group-hover:text-indigo-400 transition-colors truncate">
              {a.training_title}
            </p>
            <div className="flex flex-wrap items-center gap-2.5 mt-1.5">
              <span
                className={cn(
                  "text-[9px] font-bold px-2 py-0.5 rounded-full uppercase tracking-wider",
                  STATUS_STYLES[a.status] || "bg-muted",
                )}
              >
                {a.status}
              </span>
              {a.score != null && (
                <span className="text-[10px] font-bold text-slate-400 dark:text-zinc-500">
                  Score:{" "}
                  <span className="text-slate-600 dark:text-zinc-300 font-extrabold">
                    {a.score}%
                  </span>
                </span>
              )}
              {a.skill_tags?.map((s) => (
                <span
                  key={s}
                  className="text-[9px] font-bold px-2 py-0.5 rounded-full bg-indigo-500/10 text-indigo-600 dark:text-indigo-400 border border-indigo-500/15"
                >
                  {s}
                </span>
              ))}
            </div>
          </div>
          {a.status !== "Completed" && (
            <button
              onClick={() => setActive(a)}
              className="w-full sm:w-auto text-center shrink-0 px-4 py-2.5 text-xs font-bold rounded-xl bg-gradient-to-r from-violet-600 to-indigo-600 hover:from-violet-500 hover:to-indigo-500 text-white shadow-xs transition-all duration-200 hover:scale-[1.02] active:scale-95 cursor-pointer"
            >
              Take Quiz
            </button>
          )}
          {a.status === "Completed" && (
            <div className="self-end sm:self-auto flex items-center justify-center w-7 h-7 rounded-full bg-emerald-500/10 text-emerald-500 border border-emerald-500/20 shadow-xs shrink-0 select-none">
              <Check className="w-4 h-4" />
            </div>
          )}
        </motion.div>
      ))}
      {active && (
        <AssessmentModal
          authHeaders={authHeaders}
          assignment={active}
          onClose={() => setActive(null)}
          onDone={() => {
            setActive(null);
            load();
          }}
        />
      )}
    </div>
  );
}

function AssessmentModal({
  authHeaders,
  assignment,
  onClose,
  onDone,
}: {
  authHeaders: Record<string, string>;
  assignment: Assignment;
  onClose: () => void;
  onDone: () => void;
}) {
  const [questions, setQuestions] = useState<Question[]>([]);
  const [answers, setAnswers] = useState<Record<number, string>>({});
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [result, setResult] = useState<any>(null);

  useEffect(() => {
    fetch(`/api/portal/te-local/trainings/${assignment.training_id}/questions`, {
      headers: authHeaders,
    })
      .then((r) => r.json())
      .then((d) => setQuestions(d.results || []))
      .finally(() => setLoading(false));
  }, [authHeaders, assignment.training_id]);

  const submit = async () => {
    setSubmitting(true);
    try {
      const resp = await fetch(`/api/portal/te-local/assignments/${assignment.id}/evaluate`, {
        method: "POST",
        headers: authHeaders,
        body: JSON.stringify({ answers }),
      });
      setResult(await resp.json());
    } finally {
      setSubmitting(false);
    }
  };

  const allAnswered = Object.keys(answers).length === questions.length;

  return (
    <Modal title={assignment.training_title} onClose={onClose}>
      {loading ? (
        <Spinner label="Assembling questions…" />
      ) : result ? (
        <div className="flex flex-col items-center text-center gap-4 py-4">
          {result.passed ? (
            <motion.div
              initial={{ scale: 0.5, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              transition={{ type: "spring", stiffness: 200, damping: 15 }}
              className="w-14 h-14 rounded-full bg-emerald-500/10 border border-emerald-500/20 text-emerald-500 flex items-center justify-center shadow-lg shadow-emerald-500/10"
            >
              <Trophy className="w-7 h-7" />
            </motion.div>
          ) : (
            <motion.div
              initial={{ scale: 0.5, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              transition={{ type: "spring", stiffness: 200, damping: 15 }}
              className="w-14 h-14 rounded-full bg-red-500/10 border border-red-500/20 text-red-500 flex items-center justify-center shadow-lg shadow-red-500/10"
            >
              <AlertCircle className="w-7 h-7" />
            </motion.div>
          )}

          <div>
            <h4 className="text-lg font-black text-slate-800 dark:text-zinc-100">
              {result.passed ? "Assessment Passed!" : "Did Not Pass"}
            </h4>
            <p className="text-xs text-slate-400 dark:text-zinc-500 mt-1">
              Score:{" "}
              <span
                className={cn("font-bold", result.passed ? "text-emerald-500" : "text-red-500")}
              >
                {result.score}%
              </span>{" "}
              · Earned marks:{" "}
              <span className="font-semibold text-slate-700 dark:text-zinc-300">
                {result.earned_marks}/{result.total_marks}
              </span>
            </p>
          </div>

          {result.skills_verified?.length > 0 && (
            <div className="w-full rounded-2xl border border-emerald-500/20 bg-emerald-500/5 p-4 mt-2">
              <p className="text-xs font-bold text-emerald-600 dark:text-emerald-400 inline-flex items-center gap-1.5">
                <Sparkles className="w-4 h-4 text-emerald-500 animate-bounce" /> Verified skills
                added to profile
              </p>
              <div className="flex flex-wrap gap-1.5 mt-3 justify-center">
                {result.skills_verified.map((s: string) => (
                  <span
                    key={s}
                    className="text-[10px] font-black px-2.5 py-1 rounded-full bg-emerald-500/10 text-emerald-700 dark:text-emerald-300 border border-emerald-500/20"
                  >
                    {s}
                  </span>
                ))}
              </div>
            </div>
          )}

          <button
            onClick={onDone}
            className="mt-4 w-full py-2.5 text-xs font-bold rounded-xl bg-gradient-to-r from-violet-600 to-indigo-600 hover:from-violet-500 hover:to-indigo-500 text-white shadow-md shadow-indigo-600/25 transition-all cursor-pointer"
          >
            Return to Learning Plan
          </button>
        </div>
      ) : questions.length === 0 ? (
        <div className="text-center py-10 text-xs font-bold text-slate-400 dark:text-zinc-500 uppercase tracking-wider">
          No questions set for this course assessment.
        </div>
      ) : (
        <div className="flex flex-col gap-5 max-h-[60vh] overflow-y-auto pr-1">
          {questions.map((q, i) => (
            <div
              key={q.id}
              className="p-4 sm:p-5 rounded-2xl border border-slate-200/50 dark:border-zinc-800/80 bg-slate-50/50 dark:bg-zinc-900/30 flex flex-col gap-3"
            >
              <div className="flex gap-2">
                <span className="text-xs font-black text-indigo-500 shrink-0">Q{i + 1}.</span>
                <p className="text-sm font-bold text-slate-800 dark:text-zinc-200 leading-relaxed">
                  {q.question}
                </p>
              </div>
              <div className="flex flex-col gap-2 pl-6 mt-1">
                {Object.entries(q.options).map(([k, v]) => {
                  const isSelected = answers[q.id] === k;
                  return (
                    <label
                      key={k}
                      className={cn(
                        "flex items-center gap-3 text-xs font-semibold px-4 py-3 rounded-xl border cursor-pointer transition-all duration-200 select-none",
                        isSelected
                          ? "border-indigo-500 bg-indigo-500/5 text-indigo-600 dark:text-indigo-400 font-bold shadow-xs"
                          : "border-slate-200/70 dark:border-zinc-800/80 hover:bg-slate-100/50 dark:hover:bg-zinc-800/50 text-slate-600 dark:text-zinc-400",
                      )}
                    >
                      <input
                        type="radio"
                        name={`q-${q.id}`}
                        checked={isSelected}
                        onChange={() => setAnswers({ ...answers, [q.id]: k })}
                        className="hidden"
                      />
                      <div
                        className={cn(
                          "w-4 h-4 rounded-full border flex items-center justify-center shrink-0 transition-all duration-200",
                          isSelected
                            ? "border-indigo-500 bg-indigo-500"
                            : "border-slate-300 dark:border-zinc-700",
                        )}
                      >
                        {isSelected && <div className="w-1.5 h-1.5 rounded-full bg-white" />}
                      </div>
                      <span className="font-extrabold text-slate-400 dark:text-zinc-500 uppercase">
                        {k}.
                      </span>
                      <span className="flex-1 leading-snug">{v}</span>
                    </label>
                  );
                })}
              </div>
            </div>
          ))}

          <div className="flex justify-end gap-2 pt-3 border-t border-slate-100 dark:border-zinc-900 mt-2">
            <button
              onClick={onClose}
              className="px-4 py-2.5 text-xs font-bold rounded-xl border border-slate-200 dark:border-zinc-800/80 text-slate-600 dark:text-zinc-400 hover:bg-slate-50 dark:hover:bg-zinc-900 transition-all duration-200 cursor-pointer"
            >
              Cancel
            </button>
            <button
              onClick={submit}
              disabled={submitting || !allAnswered}
              className="px-4 py-2.5 text-xs font-bold rounded-xl bg-gradient-to-r from-violet-600 to-indigo-600 hover:from-violet-500 hover:to-indigo-500 text-white shadow-md shadow-indigo-600/25 dark:shadow-indigo-500/10 hover:shadow-lg transition-all duration-200 cursor-pointer active:scale-95 disabled:opacity-50 inline-flex items-center gap-1.5"
            >
              {submitting && <Loader2 className="w-3.5 h-3.5 animate-spin" />} Submit Quiz
            </button>
          </div>
        </div>
      )}
    </Modal>
  );
}

// ── Groups (admin) — cohorts for bulk assignment ─────────────────────────────

interface Group {
  id: number;
  name: string;
  project_name?: string;
  description?: string;
  member_count: number;
  members: { employee_id: number; name?: string; email?: string; department?: string }[];
}

function GroupsTab({ authHeaders }: { authHeaders: Record<string, string> }) {
  const [groups, setGroups] = useState<Group[]>([]);
  const [stats, setStats] = useState<any>(null);
  const [trainings, setTrainings] = useState<Training[]>([]);
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(false);
  const [assignGroup, setAssignGroup] = useState<Group | null>(null);

  const load = useCallback(() => {
    setLoading(true);
    Promise.all([
      fetch("/api/portal/te-local/groups", { headers: authHeaders }).then((r) => r.json()),
      fetch("/api/portal/te-local/trainings", { headers: authHeaders }).then((r) => r.json()),
    ])
      .then(([g, t]) => {
        setGroups(g.results || []);
        setStats(g.stats);
        setTrainings(t.results || []);
      })
      .finally(() => setLoading(false));
  }, [authHeaders]);

  useEffect(() => {
    load();
  }, [load]);

  const removeGroup = async (id: number) => {
    await fetch(`/api/portal/te-local/groups/${id}`, { method: "DELETE", headers: authHeaders });
    load();
  };

  if (loading) return <Spinner label="Loading cohorts…" />;

  return (
    <div className="flex flex-col gap-5">
      {stats && (
        <div className="grid grid-cols-2 gap-4 max-w-md">
          <KpiCard label="Total Groups" value={stats.total_groups} icon={Users} colorClass="text-violet-500 bg-violet-500/10" />
          <KpiCard label="Unique Members" value={stats.unique_employees} icon={UserCircle} colorClass="text-blue-500 bg-blue-500/10" />
        </div>
      )}

      <div className="flex justify-end">
        <button
          onClick={() => setCreating(true)}
          className="px-4 py-2.5 rounded-xl bg-gradient-to-r from-violet-600 to-indigo-600 hover:from-violet-500 hover:to-indigo-500 text-white text-xs font-bold shadow-md shadow-indigo-600/25 transition-all duration-200 hover:scale-[1.02] active:scale-95 inline-flex items-center gap-2 cursor-pointer"
        >
          <Plus className="w-4 h-4" /> New Group
        </button>
      </div>

      {groups.length === 0 ? (
        <div className="text-center py-16 text-slate-400 dark:text-zinc-500 text-xs font-semibold uppercase tracking-wider flex flex-col items-center gap-3">
          <div className="p-4 rounded-full bg-slate-100 dark:bg-zinc-800/80 border border-slate-200/50 dark:border-zinc-800/50">
            <Users className="w-8 h-8" />
          </div>
          No employee groups yet.
        </div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {groups.map((g) => (
            <div key={g.id} className="flex flex-col rounded-2xl border border-slate-200/60 dark:border-zinc-800/80 bg-white/70 dark:bg-zinc-900/40 p-5 shadow-xs backdrop-blur-md">
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <h3 className="text-sm font-bold text-slate-800 dark:text-zinc-200 truncate">{g.name}</h3>
                  {g.project_name && <p className="text-[11px] text-slate-400 dark:text-zinc-500 truncate">{g.project_name}</p>}
                </div>
                <button onClick={() => removeGroup(g.id)} className="text-slate-400 hover:text-red-500 shrink-0">
                  <Trash2 className="w-3.5 h-3.5" />
                </button>
              </div>
              {g.description && <p className="text-xs text-slate-500 dark:text-zinc-400 mt-2 line-clamp-2">{g.description}</p>}
              <div className="flex items-center gap-1.5 mt-3 text-[11px] font-bold text-slate-500 dark:text-zinc-400">
                <Users className="w-3.5 h-3.5 text-indigo-500" /> {g.member_count} member{g.member_count === 1 ? "" : "s"}
              </div>
              <button
                onClick={() => setAssignGroup(g)}
                className="mt-4 w-full py-2 text-[11px] font-bold rounded-xl border border-indigo-500/30 text-indigo-600 dark:text-indigo-400 hover:bg-indigo-500/5 transition-colors inline-flex items-center justify-center gap-1.5 cursor-pointer"
              >
                <ClipboardList className="w-3.5 h-3.5" /> Assign Training
              </button>
            </div>
          ))}
        </div>
      )}

      {creating && (
        <CreateGroupModal authHeaders={authHeaders} onClose={() => setCreating(false)} onSaved={() => { setCreating(false); load(); }} />
      )}
      {assignGroup && (
        <AssignGroupModal
          authHeaders={authHeaders}
          group={assignGroup}
          trainings={trainings}
          onClose={() => setAssignGroup(null)}
          onSaved={() => setAssignGroup(null)}
        />
      )}
    </div>
  );
}

function CreateGroupModal({
  authHeaders,
  onClose,
  onSaved,
}: {
  authHeaders: Record<string, string>;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [form, setForm] = useState({ name: "", project_name: "", description: "" });
  const [search, setSearch] = useState("");
  const [results, setResults] = useState<any[]>([]);
  const [selected, setSelected] = useState<Record<number, any>>({});
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState("");

  useEffect(() => {
    const handle = setTimeout(() => {
      fetch(`/api/portal/te-local/employees?search=${encodeURIComponent(search)}`, { headers: authHeaders })
        .then((r) => r.json())
        .then((d) => setResults(d.results || []))
        .catch(() => setResults([]));
    }, 250);
    return () => clearTimeout(handle);
  }, [search, authHeaders]);

  const toggle = (emp: any) => {
    setSelected((prev) => {
      const next = { ...prev };
      if (next[emp.employee_id]) delete next[emp.employee_id];
      else next[emp.employee_id] = emp;
      return next;
    });
  };

  const submit = async () => {
    if (!form.name.trim()) {
      setErr("Group name is required.");
      return;
    }
    setSaving(true);
    setErr("");
    try {
      const resp = await fetch("/api/portal/te-local/groups", {
        method: "POST",
        headers: authHeaders,
        body: JSON.stringify({
          ...form,
          members: Object.values(selected).map((e: any) => ({ employee_id: e.employee_id })),
        }),
      });
      if (!resp.ok) throw new Error((await resp.json().catch(() => ({}))).detail || "Failed.");
      onSaved();
    } catch (e: any) {
      setErr(e.message);
    } finally {
      setSaving(false);
    }
  };

  const selectedCount = Object.keys(selected).length;

  return (
    <Modal title="Create Employee Group" onClose={onClose}>
      <div className="flex flex-col gap-3">
        <Field label="Group Name *">
          <input className={inputCls} value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
        </Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Project Name">
            <input className={inputCls} value={form.project_name} onChange={(e) => setForm({ ...form, project_name: e.target.value })} />
          </Field>
          <Field label="Description">
            <input className={inputCls} value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} />
          </Field>
        </div>

        <Field label={`Members (${selectedCount} selected)`}>
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-slate-400" />
            <input
              className={cn(inputCls, "pl-9")}
              placeholder="Search by name, code, email, or department…"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
          </div>
        </Field>

        {selectedCount > 0 && (
          <div className="flex flex-wrap gap-1.5">
            {Object.values(selected).map((e: any) => (
              <span key={e.employee_id} className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-indigo-500/10 text-indigo-600 dark:text-indigo-400 border border-indigo-500/20 inline-flex items-center gap-1">
                {e.name}
                <button onClick={() => toggle(e)} className="hover:text-red-500">
                  <X className="w-2.5 h-2.5" />
                </button>
              </span>
            ))}
          </div>
        )}

        <div className="max-h-48 overflow-y-auto rounded-xl border border-slate-200/60 dark:border-zinc-800/80 divide-y divide-slate-100 dark:divide-zinc-800/60">
          {results.length === 0 ? (
            <p className="text-[11px] text-slate-400 dark:text-zinc-500 text-center py-4">No employees found.</p>
          ) : (
            results.map((e) => {
              const on = !!selected[e.employee_id];
              return (
                <button
                  key={e.employee_id}
                  onClick={() => toggle(e)}
                  className={cn(
                    "w-full flex items-center justify-between gap-2 px-3 py-2 text-left transition-colors",
                    on ? "bg-indigo-500/5" : "hover:bg-slate-50 dark:hover:bg-zinc-800/40",
                  )}
                >
                  <div className="min-w-0">
                    <p className="text-xs font-bold text-slate-700 dark:text-zinc-300 truncate">{e.name}</p>
                    <p className="text-[10px] text-slate-400 dark:text-zinc-500 truncate">
                      {e.code} · {e.department || "—"}
                    </p>
                  </div>
                  <div className={cn("w-4 h-4 rounded border flex items-center justify-center shrink-0", on ? "bg-indigo-500 border-indigo-500" : "border-slate-300 dark:border-zinc-700")}>
                    {on && <Check className="w-3 h-3 text-white" />}
                  </div>
                </button>
              );
            })
          )}
        </div>

        {err && <p className="text-xs font-bold text-red-500">{err}</p>}
        <div className="flex justify-end gap-2 pt-2 border-t border-slate-100 dark:border-zinc-900">
          <button onClick={onClose} className="px-4 py-2.5 text-xs font-bold rounded-xl border border-slate-200 dark:border-zinc-800/80 text-slate-600 dark:text-zinc-400 hover:bg-slate-50 dark:hover:bg-zinc-900 cursor-pointer">
            Cancel
          </button>
          <button onClick={submit} disabled={saving} className="px-4 py-2.5 text-xs font-bold rounded-xl bg-gradient-to-r from-violet-600 to-indigo-600 text-white shadow-md disabled:opacity-50 inline-flex items-center gap-1.5 cursor-pointer">
            {saving && <Loader2 className="w-3.5 h-3.5 animate-spin" />} Create Group
          </button>
        </div>
      </div>
    </Modal>
  );
}

function AssignGroupModal({
  authHeaders,
  group,
  trainings,
  onClose,
  onSaved,
}: {
  authHeaders: Record<string, string>;
  group: Group;
  trainings: Training[];
  onClose: () => void;
  onSaved: () => void;
}) {
  const [trainingId, setTrainingId] = useState<number | "">(trainings[0]?.id ?? "");
  const [saving, setSaving] = useState(false);
  const [done, setDone] = useState<number | null>(null);
  const [err, setErr] = useState("");

  const submit = async () => {
    if (!trainingId) {
      setErr("Pick a training.");
      return;
    }
    setSaving(true);
    setErr("");
    try {
      const resp = await fetch(`/api/portal/te-local/groups/${group.id}/assign`, {
        method: "POST",
        headers: authHeaders,
        body: JSON.stringify({ training_id: trainingId }),
      });
      const data = await resp.json();
      if (!resp.ok) throw new Error(data.detail || "Failed.");
      setDone(data.count ?? 0);
    } catch (e: any) {
      setErr(e.message);
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal title={`Assign Training · ${group.name}`} onClose={onClose}>
      {done != null ? (
        <div className="flex flex-col items-center text-center gap-3 py-4">
          <CheckCircle2 className="w-12 h-12 text-emerald-500" />
          <p className="text-sm font-bold text-slate-800 dark:text-zinc-200">Assigned to {done} member{done === 1 ? "" : "s"}.</p>
          <button onClick={onSaved} className="px-4 py-2 text-xs font-bold rounded-xl bg-gradient-to-r from-violet-600 to-indigo-600 text-white cursor-pointer">
            Done
          </button>
        </div>
      ) : (
        <div className="flex flex-col gap-4">
          <p className="text-xs text-slate-500 dark:text-zinc-400">
            Assigns the selected course to all <span className="font-bold">{group.member_count}</span> members of this group.
          </p>
          <Field label="Select Course">
            <select className={inputCls} value={trainingId} onChange={(e) => setTrainingId(e.target.value ? +e.target.value : "")}>
              {trainings.map((t) => (
                <option key={t.id} value={t.id}>{t.title}</option>
              ))}
            </select>
          </Field>
          {err && <p className="text-xs font-bold text-red-500">{err}</p>}
          <div className="flex justify-end gap-2 pt-2 border-t border-slate-100 dark:border-zinc-900">
            <button onClick={onClose} className="px-4 py-2.5 text-xs font-bold rounded-xl border border-slate-200 dark:border-zinc-800/80 text-slate-600 dark:text-zinc-400 hover:bg-slate-50 dark:hover:bg-zinc-900 cursor-pointer">
              Cancel
            </button>
            <button onClick={submit} disabled={saving} className="px-4 py-2.5 text-xs font-bold rounded-xl bg-gradient-to-r from-violet-600 to-indigo-600 text-white shadow-md disabled:opacity-50 inline-flex items-center gap-1.5 cursor-pointer">
              {saving && <Loader2 className="w-3.5 h-3.5 animate-spin" />} Assign to Group
            </button>
          </div>
        </div>
      )}
    </Modal>
  );
}

// ── Shared bits ──────────────────────────────────────────────────────────────

const inputCls =
  "w-full px-3.5 py-2.5 rounded-xl border border-slate-200 dark:border-zinc-800/80 bg-slate-50/50 dark:bg-zinc-900/50 text-sm text-slate-800 dark:text-zinc-100 focus:outline-hidden focus:ring-2 focus:ring-violet-500/20 focus:border-violet-500 dark:focus:border-violet-500/80 transition-all placeholder-slate-400 dark:placeholder-zinc-500";

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="flex flex-col gap-1.5">
      <span className="text-[10px] font-extrabold text-slate-500 dark:text-zinc-400 uppercase tracking-wider">
        {label}
      </span>
      {children}
    </label>
  );
}

function KpiCard({
  label,
  value,
  icon: Icon,
  colorClass = "text-violet-500 bg-violet-500/10",
}: {
  label: string;
  value: React.ReactNode;
  icon: React.ComponentType<{ className?: string }>;
  colorClass?: string;
}) {
  return (
    <motion.div
      whileHover={{ y: -3, transition: { duration: 0.15 } }}
      className="relative overflow-hidden rounded-2xl border border-slate-200/50 dark:border-zinc-800/80 bg-white/60 dark:bg-zinc-900/40 p-4 shadow-xs backdrop-blur-md flex items-center justify-between gap-3 group"
    >
      <div className="min-w-0">
        <span className="text-[10px] font-extrabold text-slate-400 dark:text-zinc-500 uppercase tracking-wider block">
          {label}
        </span>
        <p className="text-xl sm:text-2xl font-black mt-1 bg-gradient-to-r from-slate-900 to-slate-700 dark:from-white dark:to-zinc-200 bg-clip-text text-transparent group-hover:from-violet-600 group-hover:to-indigo-600 dark:group-hover:from-violet-400 dark:group-hover:to-indigo-400 transition-all duration-300">
          {value}
        </p>
      </div>
      <div
        className={cn(
          "p-3 rounded-xl shrink-0 transition-transform duration-300 group-hover:scale-110 shadow-xs",
          colorClass,
        )}
      >
        <Icon className="w-5 h-5" />
      </div>
      <div className="absolute -inset-px rounded-2xl bg-gradient-to-br from-violet-500/0 to-indigo-500/0 group-hover:from-violet-500/5 group-hover:to-indigo-500/5 transition-all duration-300 pointer-events-none -z-10" />
    </motion.div>
  );
}

function Spinner({ label }: { label: string }) {
  return (
    <div className="flex flex-col items-center justify-center py-20 text-slate-400 dark:text-zinc-500 gap-3">
      <Loader2 className="w-8 h-8 animate-spin text-indigo-500" />
      <span className="text-xs font-semibold tracking-wider uppercase">{label}</span>
    </div>
  );
}

function Modal({
  title,
  children,
  onClose,
}: {
  title: string;
  children: React.ReactNode;
  onClose: () => void;
}) {
  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 dark:bg-black/60 backdrop-blur-xs p-4"
      onClick={onClose}
    >
      <motion.div
        initial={{ opacity: 0, scale: 0.95, y: 15 }}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        transition={{ duration: 0.2, ease: "easeOut" }}
        className="w-full max-w-lg max-h-[85vh] overflow-y-auto rounded-3xl border border-slate-200/60 dark:border-zinc-800 bg-white dark:bg-zinc-950 p-6 shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-sm font-bold uppercase tracking-wider text-slate-800 dark:text-zinc-200">
            {title}
          </h3>
          <button
            onClick={onClose}
            className="p-1.5 rounded-lg text-slate-400 hover:text-slate-600 dark:text-zinc-500 dark:hover:text-zinc-300 hover:bg-slate-100 dark:hover:bg-zinc-800 transition-colors"
          >
            <X className="w-4 h-4" />
          </button>
        </div>
        {children}
      </motion.div>
    </div>
  );
}
