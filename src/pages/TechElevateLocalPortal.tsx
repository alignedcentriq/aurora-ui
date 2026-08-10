import { useAuth } from "@/lib/auth-store";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
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
  ExternalLink,
  FileText,
  Link2,
  Video,
  Upload,
  Wand2,
  ArrowRight,
  ArrowLeft,
  PlayCircle,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { motion, AnimatePresence } from "framer-motion";
import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell } from "@/components/ui/table";
import { ExportCsvButton } from "@/components/ui/ExportCsvButton";

type Tab = "trainings" | "assignments" | "groups" | "mine";

interface ContentItem {
  id: number;
  training_id: number;
  level_id: number | null;
  kind: "document" | "link" | "udemy" | "video";
  title: string;
  url?: string | null;
  description?: string | null;
  file_name?: string | null;
}

interface TrainingLevel {
  id: number;
  name: string;
  duration_minutes?: number;
  pass_percentage?: number;
  description?: string;
  content?: ContentItem[];
}

interface Training {
  id: number;
  title: string;
  description?: string;
  category?: string;
  type: string;
  duration_minutes: number;
  pass_percentage: number;
  skill_tags: string[];
  content_count?: number;
  levels: TrainingLevel[];
}

interface DraftQuestion {
  question: string;
  options: Record<string, string>;
  correct_answer: string;
  marks: number;
  explanation?: string | null;
  level_id?: number | null;
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
  has_questions?: boolean;
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
  const [canViewAdmin, setCanViewAdmin] = useState(false);
  const [portalUrl, setPortalUrl] = useState<string>("");

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
      .then((s) => {
        setCanManage(!!s.can_manage);
        setCanViewAdmin(!!s.can_view_admin || !!s.can_manage);
        setPortalUrl(s.portal_url || "");
      })
      .catch(() => { setCanManage(false); setCanViewAdmin(false); });
  }, [authHeaders]);

  const tabs: { id: Tab; label: string; subLabel: string; icon: typeof BookOpen; show: boolean }[] =
    [
      { id: "trainings", label: "Trainings", subLabel: "Catalog", icon: BookOpen, show: true },
      {
        id: "assignments",
        label: "Admin",
        subLabel: "Panel",
        icon: ClipboardList,
        show: canViewAdmin,
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

        <div className="flex items-center gap-2">
          {portalUrl && (
            <a
              href={portalUrl}
              target="_blank"
              rel="noopener noreferrer"
              title="Take exams on the real TechElevate portal"
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-gradient-to-r from-violet-600 to-indigo-600 hover:from-violet-500 hover:to-indigo-500 text-white text-xs font-bold shadow-md shadow-indigo-600/25 transition-all duration-200 hover:scale-[1.02] active:scale-95"
            >
              <ExternalLink className="w-3.5 h-3.5" /> Open TechElevate
            </a>
          )}

          {/* User Role Indicator inside Portal */}
          <div className="flex items-center gap-2 px-3 py-1.5 rounded-xl border border-slate-200/60 dark:border-zinc-800/80 bg-white/60 dark:bg-zinc-900/60 backdrop-blur-xs text-xs font-semibold text-slate-700 dark:text-zinc-300 shadow-xs">
            <span className="w-1.5 h-1.5 rounded-full bg-indigo-500 animate-ping" />
            Role:{" "}
            <span className="text-indigo-600 dark:text-indigo-400 font-bold capitalize">
              {user?.role || "Employee"}
            </span>
          </div>
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
            {tab === "assignments" && canViewAdmin && <AssignmentsTab authHeaders={authHeaders} canManage={canManage} />}
            {tab === "groups" && canManage && <GroupsTab authHeaders={authHeaders} />}
            {tab === "mine" && <MyLearningTab authHeaders={authHeaders} portalUrl={portalUrl} />}
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

              <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 border-t border-slate-100 dark:border-zinc-800/60 pt-3 mt-auto text-[10px] font-bold text-slate-400 dark:text-zinc-500">
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
  const [view, setView] = useState<"about" | "materials" | "questions" | "enrolled">("about");
  // Which section the admin editors target: -1 = course-level (single), else index into detail.levels.
  const [manageLevel, setManageLevel] = useState(-1);
  const [deleting, setDeleting] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [showAssign, setShowAssign] = useState(false);

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

  const isMulti = detail?.type === "levels" && (detail?.levels?.length || 0) > 0;
  // The section the admin editors currently operate on.
  const targetLevelId = !isMulti ? null : detail?.levels?.[Math.max(0, manageLevel)]?.id ?? null;

  const tabs = [
    { id: "about" as const, label: "Overview", icon: Info },
    { id: "materials" as const, label: `Materials (${detail?.content_count ?? 0})`, icon: BookOpen },
    { id: "questions" as const, label: `Assessment (${questions.length})`, icon: ListChecks },
    ...(canManage ? [{ id: "enrolled" as const, label: `Enrolled (${enrollments.length})`, icon: Users }] : []),
  ];

  // Read-only material rows for learners.
  const ContentList = ({ items }: { items: ContentItem[] }) =>
    items.length === 0 ? (
      <p className="text-[11px] text-slate-400 dark:text-zinc-500">No materials.</p>
    ) : (
      <div className="flex flex-col gap-1.5">
        {items.map((c) => {
          const meta = CONTENT_META[c.kind] || CONTENT_META.link;
          return (
            <a
              key={c.id}
              href={c.url || "#"}
              target="_blank"
              rel="noopener noreferrer"
              className="flex items-center gap-2.5 rounded-xl border border-slate-200/60 dark:border-zinc-800/80 bg-white/60 dark:bg-zinc-900/40 px-3 py-2 hover:border-indigo-400/50 transition-colors group"
            >
              <span className={cn("p-1.5 rounded-lg shrink-0", meta.color)}>
                <meta.icon className="w-3.5 h-3.5" />
              </span>
              <span className="text-xs font-bold text-slate-700 dark:text-zinc-300 truncate flex-1 group-hover:text-indigo-600">
                {c.title}
              </span>
              <ExternalLink className="w-3.5 h-3.5 text-slate-300 group-hover:text-indigo-500 shrink-0" />
            </a>
          );
        })}
      </div>
    );

  // Level selector reused by the Materials & Assessment admin editors.
  const LevelTabs = () =>
    isMulti ? (
      <div className="flex items-center gap-1 p-1 rounded-xl bg-slate-100/80 dark:bg-zinc-900/60 border border-slate-200/60 dark:border-zinc-800/80 overflow-x-auto no-scrollbar">
        {detail.levels.map((lv: any, i: number) => (
          <button
            key={lv.id}
            onClick={() => setManageLevel(i)}
            className={cn(
              "px-3 py-1.5 text-[11px] font-bold rounded-lg whitespace-nowrap transition-colors",
              Math.max(0, manageLevel) === i
                ? "bg-white dark:bg-zinc-800 text-indigo-600 dark:text-indigo-400 shadow-xs"
                : "text-slate-500 dark:text-zinc-400 hover:text-slate-700",
            )}
          >
            {lv.name}
          </button>
        ))}
      </div>
    ) : null;

  const handleDelete = async () => {
    setDeleting(true);
    try {
      const resp = await fetch(`/api/portal/te-local/trainings/${trainingId}`, {
        method: "DELETE",
        headers: authHeaders,
      });
      if (!resp.ok) throw new Error((await resp.json().catch(() => ({}))).detail || "Delete failed.");
      onChanged();
      onClose();
    } catch {
      setDeleting(false);
      setConfirmDelete(false);
    }
  };

  return (
    <Modal title={detail?.title || "Training"} onClose={onClose} wide>
      {loading ? (
        <Spinner label="Loading course…" />
      ) : (
        <div className="flex flex-col gap-4">
          {/* Admin actions */}
          {canManage && (
            <div className="flex items-center justify-end gap-2">
              <button
                onClick={() => setShowAssign(true)}
                className="px-3 py-1.5 text-[11px] font-bold rounded-xl bg-gradient-to-r from-violet-600 to-indigo-600 hover:from-violet-500 hover:to-indigo-500 text-white shadow-xs transition-all inline-flex items-center gap-1.5 cursor-pointer active:scale-95"
              >
                <Plus className="w-3.5 h-3.5" /> Assign to Employees
              </button>
              <button
                onClick={() => setConfirmDelete(true)}
                disabled={deleting}
                className="px-3 py-1.5 text-[11px] font-bold rounded-xl border border-red-500/30 text-red-600 dark:text-red-400 hover:bg-red-500/5 transition-all inline-flex items-center gap-1.5 cursor-pointer active:scale-95 disabled:opacity-50"
              >
                {deleting ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Trash2 className="w-3.5 h-3.5" />} Delete Course
              </button>
            </div>
          )}

          {/* Delete confirmation dialog */}
          {confirmDelete && (
            <div className="rounded-2xl border border-red-500/30 bg-red-500/5 dark:bg-red-500/[0.07] p-4 flex flex-col gap-3">
              <div className="flex items-start gap-3">
                <div className="p-2 rounded-xl bg-red-500/10 text-red-500 shrink-0">
                  <AlertTriangle className="w-5 h-5" />
                </div>
                <div>
                  <p className="text-sm font-bold text-slate-800 dark:text-zinc-200">Delete this course?</p>
                  <p className="text-xs text-slate-500 dark:text-zinc-400 mt-1 leading-relaxed">
                    This will permanently remove <span className="font-bold">"{detail?.title}"</span> along with all its materials, assessment questions, and enrollment records. This action cannot be undone.
                  </p>
                </div>
              </div>
              <div className="flex items-center justify-end gap-2">
                <button
                  onClick={() => setConfirmDelete(false)}
                  disabled={deleting}
                  className="px-4 py-2 text-xs font-bold rounded-xl border border-slate-200 dark:border-zinc-800/80 text-slate-600 dark:text-zinc-400 hover:bg-slate-50 dark:hover:bg-zinc-900 cursor-pointer transition-all"
                >
                  Cancel
                </button>
                <button
                  onClick={handleDelete}
                  disabled={deleting}
                  className="px-4 py-2 text-xs font-bold rounded-xl bg-red-600 hover:bg-red-500 text-white shadow-md shadow-red-600/25 inline-flex items-center gap-1.5 cursor-pointer transition-all active:scale-95 disabled:opacity-50"
                >
                  {deleting ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Trash2 className="w-3.5 h-3.5" />} Yes, Delete
                </button>
              </div>
            </div>
          )}

          <div className="flex items-center gap-1 p-1 rounded-xl bg-slate-100/80 dark:bg-zinc-900/60 border border-slate-200/60 dark:border-zinc-800/80 overflow-x-auto no-scrollbar">
            {tabs.map((t) => (
              <button
                key={t.id}
                onClick={() => setView(t.id)}
                className={cn(
                  "flex-1 px-3 py-1.5 text-[11px] font-bold rounded-lg inline-flex items-center justify-center gap-1.5 transition-colors whitespace-nowrap",
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
                <MiniStat label="Pass score" value={`${detail.pass_percentage}% correct`} />
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
                    <div key={lv.id} className="flex flex-col md:flex-row md:items-center justify-between gap-4 rounded-lg border border-slate-200/60 dark:border-zinc-800/80 px-3 py-2 text-xs">
                      <span className="font-bold text-slate-700 dark:text-zinc-300">{lv.name}</span>
                      <span className="text-slate-400 dark:text-zinc-500">
                        {fmtDuration(lv.duration_minutes)} · pass {lv.pass_percentage}% · {(lv.content?.length || 0)} materials
                      </span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}

          {view === "materials" && (
            <div className="flex flex-col gap-3">
              {canManage ? (
                <>
                  <LevelTabs />
                  <MaterialsEditor authHeaders={authHeaders} trainingId={trainingId} levelId={targetLevelId} />
                </>
              ) : isMulti ? (
                detail.levels.map((lv: any) => (
                  <div key={lv.id} className="flex flex-col gap-1.5">
                    <p className="text-[10px] font-extrabold text-slate-400 dark:text-zinc-500 uppercase tracking-wider">{lv.name}</p>
                    <ContentList items={lv.content || []} />
                  </div>
                ))
              ) : (
                <ContentList items={detail.content || []} />
              )}
            </div>
          )}

          {view === "questions" && (
            <div className="flex flex-col gap-3">
              {canManage ? (
                <>
                  <LevelTabs />
                  <AssessmentEditor authHeaders={authHeaders} trainingId={trainingId} levelId={targetLevelId} />
                </>
              ) : questions.length === 0 ? (
                <p className="text-center py-8 text-xs font-bold text-slate-400 dark:text-zinc-500 uppercase tracking-wider">
                  No questions yet.
                </p>
              ) : (
                questions.map((q, i) => (
                  <div key={q.id} className="rounded-xl border border-slate-200/60 dark:border-zinc-800/80 bg-slate-50/50 dark:bg-zinc-900/30 p-3">
                    <p className="text-sm font-bold text-slate-800 dark:text-zinc-200">
                      <span className="text-indigo-500">Q{i + 1}.</span> {q.question}
                    </p>
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-1 mt-2 pl-5">
                      {Object.entries(q.options || {}).map(([k, v]) => (
                        <span
                          key={k}
                          className="text-[11px] px-2 py-1 rounded-lg border border-slate-200/60 dark:border-zinc-800/80 text-slate-500 dark:text-zinc-400"
                        >
                          <span className="font-extrabold uppercase">{k}.</span> {String(v)}
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
                  <div key={a.id} className="flex flex-col md:flex-row md:items-center justify-between gap-4 gap-2 rounded-lg border border-slate-200/60 dark:border-zinc-800/80 px-3 py-2">
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

      {showAssign && detail && (
        <AssignTrainingFromDetailModal
          authHeaders={authHeaders}
          training={detail}
          onClose={() => setShowAssign(false)}
          onSaved={() => {
            setShowAssign(false);
            load();
          }}
        />
      )}
    </Modal>
  );
}

function AssignTrainingFromDetailModal({
  authHeaders,
  training,
  onClose,
  onSaved,
}: {
  authHeaders: Record<string, string>;
  training: any;
  onClose: () => void;
  onSaved: () => void;
}) {
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
    const emails = Object.values(selected).map((e: any) => e.email).filter(Boolean);
    if (emails.length === 0) {
      setErr("Select at least one employee.");
      return;
    }
    setSaving(true);
    setErr("");
    try {
      const resp = await fetch("/api/portal/te-local/assignments", {
        method: "POST",
        headers: authHeaders,
        body: JSON.stringify({ training_id: training.id, employees: emails }),
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
    <div
      className="fixed inset-0 z-[60] flex items-center justify-center bg-slate-900/40 dark:bg-black/60 backdrop-blur-xs p-4"
      onClick={onClose}
    >
      <motion.div
        initial={{ opacity: 0, scale: 0.95, y: 15 }}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        transition={{ duration: 0.2, ease: "easeOut" }}
        className="w-full max-w-lg max-h-[90vh] flex flex-col rounded-3xl border border-slate-200/60 dark:border-zinc-800 bg-white dark:bg-zinc-950 shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between shrink-0 p-5 border-b border-slate-100 dark:border-zinc-800/50">
          <h3 className="text-sm font-bold uppercase tracking-wider text-slate-800 dark:text-zinc-200">
            Assign: {training.title}
          </h3>
          <button onClick={onClose} className="p-1.5 rounded-lg text-slate-400 hover:text-slate-600 dark:text-zinc-500 dark:hover:text-zinc-300 hover:bg-slate-100 dark:hover:bg-zinc-800 transition-colors">
            <X className="w-4 h-4" />
          </button>
        </div>
        <div className="p-5 flex-1 overflow-y-auto flex flex-col gap-3">
          <Field label={`Select employees (${selectedCount} selected)`}>
            <div className="relative">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-slate-400" />
              <input
                className={cn(inputCls, "pl-9")}
                placeholder="Search by name, email, department…"
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
            <button onClick={submit} disabled={saving || selectedCount === 0} className="px-4 py-2.5 text-xs font-bold rounded-xl bg-gradient-to-r from-violet-600 to-indigo-600 text-white shadow-md disabled:opacity-50 inline-flex items-center gap-1.5 cursor-pointer">
              {saving && <Loader2 className="w-3.5 h-3.5 animate-spin" />} Assign ({selectedCount})
            </button>
          </div>
        </div>
      </motion.div>
    </div>
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

// ── Create wizard: Basics → Curriculum → Assessment → Done ───────────────────

interface WizardLevel {
  name: string;
  duration_minutes: number;
  pass_percentage: number;
  description: string;
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
  const [step, setStep] = useState(1); // 1 basics · 2 curriculum · 3 assessment · 4 done
  const [trainingId, setTrainingId] = useState<number | null>(null);
  const [createdLevels, setCreatedLevels] = useState<TrainingLevel[]>([]);

  const [form, setForm] = useState({
    title: "",
    description: "",
    category: "Technical",
    duration_minutes: 120,
    pass_percentage: 60,
    skills: "",
  });
  const [multiLevel, setMultiLevel] = useState(false);
  const [levels, setLevels] = useState<WizardLevel[]>([
    { name: "Basic", duration_minutes: 60, pass_percentage: 60, description: "" },
    { name: "Intermediate", duration_minutes: 60, pass_percentage: 65, description: "" },
    { name: "Advanced", duration_minutes: 60, pass_percentage: 70, description: "" },
  ]);
  // Per-section the active level tab (index into createdLevels); null = course-level (single).
  const [activeLevel, setActiveLevel] = useState(0);
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState("");

  // AI draft state
  const [aiDesc, setAiDesc] = useState("");
  const [drafting, setDrafting] = useState(false);

  const draftWithAi = async () => {
    const desc = aiDesc.trim();
    if (!desc) return;
    setDrafting(true);
    setErr("");
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 55_000);
    try {
      const res = await fetch("/api/portal/te-local/trainings/generate", {
        method: "POST",
        headers: authHeaders,
        body: JSON.stringify({ description: desc }),
        signal: controller.signal,
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.detail || "Couldn't draft the course");
      setForm({
        title: data.title || "",
        description: data.description || "",
        category: data.category || "Technical",
        duration_minutes: data.duration_minutes || 120,
        pass_percentage: data.pass_percentage || 60,
        skills: (data.skill_tags || []).join(", "),
      });
      if (data.multi_level && data.levels?.length) {
        setMultiLevel(true);
        setLevels(
          data.levels.map((lv: any) => ({
            name: lv.name || "",
            duration_minutes: lv.duration_minutes || 60,
            pass_percentage: lv.pass_percentage || 60,
            description: lv.description || "",
          })),
        );
      } else {
        setMultiLevel(false);
      }
    } catch (e: any) {
      if (e.name === "AbortError")
        setErr("The shared LLM is busy and timed out. Try again in a moment, or fill in the fields manually below.");
      else
        setErr(e.message);
    } finally {
      clearTimeout(timer);
      setDrafting(false);
    }
  };

  const STEPS = ["Basics", "Curriculum", "Assessment", "Done"];

  const createBasics = async () => {
    // Already created (admin navigated back to step 1) — just continue, don't duplicate.
    if (trainingId != null) {
      setStep(2);
      return;
    }
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
          skill_tags: form.skills.split(",").map((s) => s.trim()).filter(Boolean),
          levels: multiLevel
            ? levels.map((l) => ({
                name: l.name.trim() || "Level",
                duration_minutes: Number(l.duration_minutes),
                pass_percentage: Number(l.pass_percentage),
                description: l.description,
              }))
            : [],
        }),
      });
      const data = await resp.json().catch(() => ({}));
      if (!resp.ok) throw new Error(data.detail || "Failed to create.");
      setTrainingId(data.id);
      setCreatedLevels(data.levels || []);
      setActiveLevel(0);
      setStep(2);
    } catch (e: any) {
      setErr(e.message);
    } finally {
      setSaving(false);
    }
  };

  const updateLevel = (i: number, patch: Partial<WizardLevel>) =>
    setLevels((prev) => prev.map((l, idx) => (idx === i ? { ...l, ...patch } : l)));
  const addLevel = () =>
    setLevels((prev) => [
      ...prev,
      { name: `Level ${prev.length + 1}`, duration_minutes: 60, pass_percentage: 65, description: "" },
    ]);
  const removeLevel = (i: number) => setLevels((prev) => prev.filter((_, idx) => idx !== i));

  // The level the curriculum/assessment editors currently target.
  const targetLevelId =
    multiLevel && createdLevels.length ? (createdLevels[activeLevel]?.id ?? null) : null;

  return (
    <Modal title="Create Course" onClose={onClose} wide>
      {/* Stepper */}
      <div className="flex items-center gap-1.5 mb-5">
        {STEPS.map((s, i) => {
          const n = i + 1;
          const done = step > n;
          const active = step === n;
          return (
            <div key={s} className="flex items-center gap-1.5 flex-1">
              <div
                className={cn(
                  "flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-[11px] font-bold transition-colors w-full justify-center",
                  active
                    ? "bg-gradient-to-r from-violet-600 to-indigo-600 text-white shadow-xs"
                    : done
                      ? "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400"
                      : "bg-slate-100 dark:bg-zinc-900/60 text-slate-400 dark:text-zinc-500",
                )}
              >
                {done ? <Check className="w-3.5 h-3.5" /> : <span className="opacity-70">{n}</span>}
                <span className="hidden sm:inline">{s}</span>
              </div>
            </div>
          );
        })}
      </div>

      {/* Level tabs (curriculum + assessment steps, multi-level only) */}
      {(step === 2 || step === 3) && multiLevel && createdLevels.length > 0 && (
        <div className="flex items-center gap-1 p-1 mb-4 rounded-xl bg-slate-100/80 dark:bg-zinc-900/60 border border-slate-200/60 dark:border-zinc-800/80 overflow-x-auto no-scrollbar">
          {createdLevels.map((lv, i) => (
            <button
              key={lv.id}
              onClick={() => setActiveLevel(i)}
              className={cn(
                "px-3 py-1.5 text-[11px] font-bold rounded-lg whitespace-nowrap transition-colors",
                activeLevel === i
                  ? "bg-white dark:bg-zinc-800 text-indigo-600 dark:text-indigo-400 shadow-xs"
                  : "text-slate-500 dark:text-zinc-400 hover:text-slate-700",
              )}
            >
              {lv.name}
            </button>
          ))}
        </div>
      )}

      {/* Step 1 — Basics */}
      {step === 1 && (
        <div className="flex flex-col gap-3">
          {/* AI draft box */}
          {trainingId == null && (
            <div className="rounded-xl border border-violet-500/20 bg-violet-500/[0.04] dark:bg-violet-500/[0.06] p-3">
              <label className="flex items-center gap-1.5 text-[12px] font-semibold text-violet-600 dark:text-violet-300">
                <Sparkles className="h-3.5 w-3.5" />
                Describe it, let AI draft it
              </label>
              <p className="text-[10px] text-slate-500 dark:text-zinc-400 mt-0.5">
                Describe the training in a sentence — AI fills in the title, description, skills, duration, and levels for you to review.
              </p>
              <div className="flex items-start gap-2 mt-2">
                <textarea
                  value={aiDesc}
                  onChange={(e) => setAiDesc(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" && (e.metaKey || e.ctrlKey) && !drafting && aiDesc.trim()) {
                      e.preventDefault();
                      draftWithAi();
                    }
                  }}
                  placeholder='e.g. "Azure DevOps fundamentals for new joiners — beginner to intermediate, should cover CI/CD pipelines and repos"'
                  disabled={drafting}
                  className={cn(inputCls, "flex-1 min-h-[48px] max-h-[100px] resize-y")}
                />
                <button
                  type="button"
                  onClick={draftWithAi}
                  disabled={drafting || !aiDesc.trim()}
                  className="shrink-0 px-3 py-2 text-[11px] font-bold rounded-xl bg-violet-600 hover:bg-violet-500 text-white shadow-md shadow-violet-600/20 transition-all cursor-pointer active:scale-95 disabled:opacity-50 inline-flex items-center gap-1.5"
                >
                  {drafting ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Sparkles className="w-3.5 h-3.5" />}
                  {drafting ? "Drafting…" : "Draft"}
                </button>
              </div>
            </div>
          )}

          <Field label="Title *">
            <input className={inputCls} value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} />
          </Field>
          <Field label="Description">
            <textarea className={inputCls} rows={2} value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} />
          </Field>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Category">
              <select className={inputCls} value={form.category} onChange={(e) => setForm({ ...form, category: e.target.value })}>
                <option>Technical</option>
                <option>Governance & Compliance</option>
                <option>Business</option>
              </select>
            </Field>
            <Field label="Total duration (min)">
              <input type="number" className={inputCls} value={form.duration_minutes} onChange={(e) => setForm({ ...form, duration_minutes: +e.target.value })} />
            </Field>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Minimum passing score (%)">
              <input
                type="number"
                min={1}
                max={100}
                className={inputCls}
                value={form.pass_percentage}
                onChange={(e) => setForm({ ...form, pass_percentage: +e.target.value })}
              />
            </Field>
            <Field label="Skill tags (comma-sep)">
              <input className={inputCls} placeholder="Python, ML" value={form.skills} onChange={(e) => setForm({ ...form, skills: e.target.value })} />
            </Field>
          </div>

          {/* Explain pass score */}
          <div className="flex items-start gap-2 rounded-xl border border-blue-500/20 bg-blue-500/5 dark:bg-blue-500/[0.07] px-3 py-2.5">
            <HelpCircle className="w-4 h-4 text-blue-500 shrink-0 mt-0.5" />
            <p className="text-[11px] text-slate-600 dark:text-zinc-300 leading-relaxed">
              <span className="font-bold text-slate-700 dark:text-zinc-200">Minimum passing score</span> — a learner must correctly answer at least this % of MCQ questions in the assessment to
              pass and earn the course's verified skills. e.g. 60% means 6 out of 10 questions correct.
            </p>
          </div>

          <label className="flex items-center gap-2 cursor-pointer select-none mt-1">
            <input type="checkbox" checked={multiLevel} onChange={(e) => setMultiLevel(e.target.checked)} className="accent-violet-600 w-4 h-4" />
            <span className="text-[11px] font-bold text-slate-600 dark:text-zinc-300 inline-flex items-center gap-1.5">
              <Layers className="w-3.5 h-3.5 text-indigo-500" /> Multi-level track (e.g. Beginner · Intermediate · Advanced)
            </span>
          </label>

          {multiLevel && (
            <div className="flex flex-col gap-2 rounded-xl border border-slate-200/60 dark:border-zinc-800/80 p-3 bg-slate-50/40 dark:bg-zinc-900/30">
              {/* Column headers */}
              <div className="flex items-center gap-2 px-1">
                <span className="flex-[2] text-[9px] font-extrabold text-slate-400 dark:text-zinc-500 uppercase tracking-wider">Level name</span>
                <span className="flex-1 text-[9px] font-extrabold text-slate-400 dark:text-zinc-500 uppercase tracking-wider">Duration (min)</span>
                <span className="flex-1 text-[9px] font-extrabold text-slate-400 dark:text-zinc-500 uppercase tracking-wider">Min. pass score %</span>
                <span className="w-5 shrink-0" />
              </div>
              {levels.map((lv, i) => (
                <div key={i} className="flex items-center gap-2">
                  <input
                    className={cn(inputCls, "flex-[2]")}
                    placeholder="e.g. Beginner"
                    value={lv.name}
                    onChange={(e) => updateLevel(i, { name: e.target.value })}
                  />
                  <input
                    type="number"
                    className={cn(inputCls, "flex-1")}
                    placeholder="60"
                    title="Estimated study time for this level in minutes"
                    value={lv.duration_minutes}
                    onChange={(e) => updateLevel(i, { duration_minutes: +e.target.value })}
                  />
                  <input
                    type="number"
                    min={1}
                    max={100}
                    className={cn(inputCls, "flex-1")}
                    placeholder="60"
                    title="Learner must score at least this % on the MCQ assessment to pass this level"
                    value={lv.pass_percentage}
                    onChange={(e) => updateLevel(i, { pass_percentage: +e.target.value })}
                  />
                  <button
                    onClick={() => removeLevel(i)}
                    disabled={levels.length <= 1}
                    className="text-slate-400 hover:text-red-500 disabled:opacity-30 shrink-0"
                    title="Remove level"
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                </div>
              ))}
              <button onClick={addLevel} className="self-start text-[11px] font-bold text-indigo-600 dark:text-indigo-400 inline-flex items-center gap-1 hover:underline">
                <Plus className="w-3 h-3" /> Add level
              </button>
            </div>
          )}

          <p className="text-[10px] text-slate-400 dark:text-zinc-500 font-medium">
            Skill tags become <span className="font-bold text-slate-500 dark:text-zinc-400">verified skills</span> on the learner's profile when they pass.
            Next you'll add learning materials (docs, Udemy courses, videos) and AI-draft the MCQ assessment.
          </p>
        </div>
      )}

      {/* Step 2 — Curriculum / materials */}
      {step === 2 && trainingId != null && (
        <div className="flex flex-col gap-3">
          <p className="text-xs text-slate-500 dark:text-zinc-400">
            Add the learning materials {multiLevel ? "for this level" : "for this course"} — upload documents, or link
            Udemy courses, videos, and web resources. The AI uses these to draft the assessment.
          </p>
          <MaterialsEditor authHeaders={authHeaders} trainingId={trainingId} levelId={targetLevelId} />
        </div>
      )}

      {/* Step 3 — Assessment */}
      {step === 3 && trainingId != null && (
        <div className="flex flex-col gap-3">
          <p className="text-xs text-slate-500 dark:text-zinc-400">
            Generate MCQs with AI from the materials you added {multiLevel ? "to this level" : ""}, review/edit them, then
            save. Employees sit the actual exam on the TechElevate portal.
          </p>
          <AssessmentEditor authHeaders={authHeaders} trainingId={trainingId} levelId={targetLevelId} />
        </div>
      )}

      {/* Step 4 — Done */}
      {step === 4 && (
        <div className="flex flex-col items-center text-center gap-4 py-6">
          <motion.div
            initial={{ scale: 0.5, opacity: 0 }}
            animate={{ scale: 1, opacity: 1 }}
            transition={{ type: "spring", stiffness: 200, damping: 15 }}
            className="w-14 h-14 rounded-full bg-emerald-500/10 border border-emerald-500/20 text-emerald-500 flex items-center justify-center shadow-lg shadow-emerald-500/10"
          >
            <Check className="w-7 h-7" />
          </motion.div>
          <div>
            <h4 className="text-lg font-black text-slate-800 dark:text-zinc-100">Course published</h4>
            <p className="text-xs text-slate-400 dark:text-zinc-500 mt-1">
              "{form.title}" is now in the catalog with its materials and assessment. You can keep editing it from the course card.
            </p>
          </div>
          <button onClick={onSaved} className="mt-2 w-full py-2.5 text-xs font-bold rounded-xl bg-gradient-to-r from-violet-600 to-indigo-600 hover:from-violet-500 hover:to-indigo-500 text-white shadow-md shadow-indigo-600/25 transition-all cursor-pointer">
            Back to Catalog
          </button>
        </div>
      )}

      {err && <p className="text-xs font-bold text-red-500 dark:text-red-400 mt-3">{err}</p>}

      {/* Footer nav */}
      {step < 4 && (
        <div className="flex justify-between gap-2 pt-4 mt-4 border-t border-slate-100 dark:border-zinc-900">
          <button
            onClick={step === 1 ? onClose : () => setStep((s) => s - 1)}
            disabled={saving || (step > 1 && step <= 3 && false)}
            className="px-4 py-2.5 text-xs font-bold rounded-xl border border-slate-200 dark:border-zinc-800/80 text-slate-600 dark:text-zinc-400 hover:bg-slate-50 dark:hover:bg-zinc-900 transition-all cursor-pointer inline-flex items-center gap-1.5"
          >
            {step === 1 ? "Cancel" : (<><ArrowLeft className="w-3.5 h-3.5" /> Back</>)}
          </button>

          {step === 1 && (
            <button
              onClick={createBasics}
              disabled={saving}
              className="px-4 py-2.5 text-xs font-bold rounded-xl bg-gradient-to-r from-violet-600 to-indigo-600 hover:from-violet-500 hover:to-indigo-500 text-white shadow-md shadow-indigo-600/25 transition-all cursor-pointer active:scale-95 disabled:opacity-50 inline-flex items-center gap-1.5"
            >
              {saving && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
              {trainingId != null ? "Continue" : "Create & add content"} <ArrowRight className="w-3.5 h-3.5" />
            </button>
          )}
          {(step === 2 || step === 3) && (
            <button
              onClick={() => setStep((s) => s + 1)}
              className="px-4 py-2.5 text-xs font-bold rounded-xl bg-gradient-to-r from-violet-600 to-indigo-600 hover:from-violet-500 hover:to-indigo-500 text-white shadow-md shadow-indigo-600/25 transition-all cursor-pointer active:scale-95 inline-flex items-center gap-1.5"
            >
              {step === 3 ? "Finish" : "Next"} <ArrowRight className="w-3.5 h-3.5" />
            </button>
          )}
        </div>
      )}
    </Modal>
  );
}

// ── Reusable: learning materials editor (used by wizard + course detail) ──────

// ── Udemy course card with expandable detail + org enrollment stats ───────────

// Level → accent colour used in placeholder thumbnail and level badge.
const LEVEL_COLORS: Record<string, { bg: string; text: string; border: string; gradient: string }> = {
  Beginner:     { bg: "bg-emerald-500/15", text: "text-emerald-600 dark:text-emerald-400", border: "border-emerald-500/30", gradient: "from-emerald-600 to-teal-500" },
  Intermediate: { bg: "bg-amber-500/15",   text: "text-amber-600 dark:text-amber-400",   border: "border-amber-500/30",   gradient: "from-amber-500 to-orange-500" },
  Expert:       { bg: "bg-rose-500/15",    text: "text-rose-600 dark:text-rose-400",    border: "border-rose-500/30",    gradient: "from-rose-600 to-pink-500" },
  "All Levels": { bg: "bg-violet-500/15",  text: "text-violet-600 dark:text-violet-400",  border: "border-violet-500/30",  gradient: "from-violet-600 to-indigo-500" },
};
const DEFAULT_LEVEL_COLOR = { bg: "bg-slate-500/10", text: "text-slate-500 dark:text-zinc-400", border: "border-slate-400/20", gradient: "from-slate-600 to-slate-500" };

function UdemyCourseCard({
  course,
  authHeaders,
  onAdd,
  busy,
}: {
  course: any;
  authHeaders: Record<string, string>;
  onAdd: (c: any) => void;
  busy: boolean;
}) {
  const [expanded, setExpanded] = useState(false);
  const [detail, setDetail] = useState<any>(null);
  const [loading, setLoading] = useState(false);

  const expand = async () => {
    if (expanded) { setExpanded(false); return; }
    setExpanded(true);
    if (detail || !course.id) return;
    setLoading(true);
    try {
      const resp = await fetch(`/api/portal/udemy/courses/${course.id}`, { headers: authHeaders });
      if (resp.ok) setDetail(await resp.json());
    } catch { /* non-fatal */ }
    finally { setLoading(false); }
  };

  const d = detail || course;
  const instructors: string[] = d.instructors || [];
  const level: string = d.level || "";
  const lc = LEVEL_COLORS[level] || DEFAULT_LEVEL_COLOR;
  const contentInfo: string = d.content_info || "";
  const numLectures: number | null = d.num_lectures ?? null;
  const orgEnrolled: number = d.org_enrolled ?? 0;
  const orgCompleted: number = d.org_completed ?? 0;
  const avgCompletion: number = d.org_avg_completion_pct ?? 0;
  const lastUpdate: string = d.last_update_date ? d.last_update_date.slice(0, 7) : "";
  const category: string = d.category || d.subcategory || "";
  const completionRate = orgEnrolled > 0 ? Math.round((orgCompleted / orgEnrolled) * 100) : 0;

  return (
    <motion.div
      layout
      className={cn(
        "rounded-2xl border overflow-hidden transition-all duration-200",
        expanded
          ? "border-indigo-500/40 dark:border-indigo-500/30 shadow-md shadow-indigo-500/5"
          : "border-slate-200/60 dark:border-zinc-800/80",
      )}
    >
      {/* ── Card header ── */}
      <button
        onClick={expand}
        className="w-full flex items-stretch gap-0 text-left group"
      >
        {/* Left accent: image or gradient placeholder */}
        <div className="shrink-0 w-20 sm:w-24 relative overflow-hidden">
          {d.image ? (
            <img src={d.image} alt="" className="w-full h-full object-cover" />
          ) : (
            <div className={cn("w-full h-full min-h-[64px] flex flex-col items-center justify-center gap-1 bg-gradient-to-br text-white", lc.gradient)}>
              <PlayCircle className="w-5 h-5 opacity-80" />
              {level && <span className="text-[8px] font-black uppercase tracking-widest opacity-70 px-1 text-center">{level}</span>}
            </div>
          )}
        </div>

        {/* Main content */}
        <div className="flex-1 min-w-0 px-3 py-2.5 bg-white/60 dark:bg-zinc-900/40 group-hover:bg-slate-50/70 dark:group-hover:bg-zinc-800/30 transition-colors">
          <p className="text-xs font-bold text-slate-800 dark:text-zinc-200 line-clamp-2 leading-snug">{d.title}</p>
          <div className="flex flex-wrap items-center gap-1.5 mt-1.5">
            {level && (
              <span className={cn("text-[9px] font-extrabold px-2 py-0.5 rounded-full border", lc.bg, lc.text, lc.border)}>
                {level}
              </span>
            )}
            {category && (
              <span className="text-[9px] font-bold px-2 py-0.5 rounded-full bg-slate-100 dark:bg-zinc-800 text-slate-500 dark:text-zinc-400 border border-slate-200/60 dark:border-zinc-700/60">
                {category}
              </span>
            )}
            {contentInfo && (
              <span className="text-[9px] text-slate-400 dark:text-zinc-500 inline-flex items-center gap-0.5">
                <Clock className="w-2.5 h-2.5" /> {contentInfo}
              </span>
            )}
            {numLectures != null && (
              <span className="text-[9px] text-slate-400 dark:text-zinc-500">{numLectures} lectures</span>
            )}
          </div>
          {/* Instructor line — visible once detail loaded */}
          {instructors.length > 0 && (
            <p className="text-[10px] text-slate-400 dark:text-zinc-500 mt-1 truncate">
              {instructors.slice(0, 2).join(" · ")}
            </p>
          )}
        </div>

        {/* Right actions */}
        <div className="shrink-0 flex flex-col items-center justify-center gap-2 px-2.5 bg-white/60 dark:bg-zinc-900/40 group-hover:bg-slate-50/70 dark:group-hover:bg-zinc-800/30 transition-colors border-l border-slate-200/40 dark:border-zinc-800/60">
          <button
            type="button"
            onClick={(e) => { e.stopPropagation(); onAdd(course); }}
            disabled={busy}
            className="p-1.5 rounded-lg bg-indigo-600 hover:bg-indigo-500 text-white disabled:opacity-50 cursor-pointer"
            title="Add to course materials"
          >
            <Plus className="w-3.5 h-3.5" />
          </button>
          <ChevronRight className={cn("w-4 h-4 text-slate-400 transition-transform duration-200", expanded && "rotate-90")} />
        </div>
      </button>

      {/* ── Expanded detail panel ── */}
      {expanded && (
        <div className="border-t border-slate-200/60 dark:border-zinc-800/80 bg-slate-50/60 dark:bg-zinc-900/50">
          {loading ? (
            <div className="flex items-center justify-center gap-2 py-6 text-xs text-slate-400">
              <Loader2 className="w-4 h-4 animate-spin text-indigo-500" /> Loading course details…
            </div>
          ) : (
            <div className="p-4 flex flex-col gap-4">
              {/* Headline */}
              {d.headline && (
                <p className="text-xs text-slate-600 dark:text-zinc-300 leading-relaxed border-l-2 border-indigo-400 pl-3 italic">
                  {d.headline}
                </p>
              )}

              {/* Instructors */}
              {instructors.length > 0 && (
                <div className="flex flex-col gap-1.5">
                  <p className="text-[9px] font-extrabold text-slate-400 dark:text-zinc-500 uppercase tracking-wider">
                    {instructors.length > 1 ? "Instructors" : "Instructor"}
                  </p>
                  <div className="flex flex-wrap gap-1.5">
                    {instructors.map((name: string) => (
                      <span
                        key={name}
                        className="inline-flex items-center gap-1 text-[10px] font-bold px-2.5 py-1 rounded-full bg-violet-500/10 text-violet-700 dark:text-violet-300 border border-violet-500/20"
                      >
                        <UserCircle className="w-3 h-3" /> {name}
                      </span>
                    ))}
                  </div>
                </div>
              )}

              {/* Meta chips row */}
              <div className="flex flex-wrap gap-2">
                {[
                  level && { label: "Level", value: level },
                  contentInfo && { label: "Duration", value: contentInfo },
                  numLectures != null && { label: "Lectures", value: `${numLectures}` },
                  lastUpdate && { label: "Updated", value: lastUpdate },
                  category && { label: "Category", value: category },
                ].filter(Boolean).map((item: any) => (
                  <div key={item.label} className="flex flex-col rounded-xl border border-slate-200/60 dark:border-zinc-800/80 bg-white/70 dark:bg-zinc-900/40 px-3 py-2 min-w-[72px]">
                    <span className="text-[8px] font-extrabold text-slate-400 dark:text-zinc-500 uppercase tracking-wider">{item.label}</span>
                    <span className="text-[11px] font-bold text-slate-700 dark:text-zinc-300 mt-0.5">{item.value}</span>
                  </div>
                ))}
              </div>

              {/* Org stats */}
              <div className="rounded-xl border border-indigo-500/25 bg-gradient-to-br from-indigo-500/5 to-violet-500/5 dark:from-indigo-500/8 dark:to-violet-500/8 p-3">
                <p className="text-[10px] font-extrabold text-indigo-600 dark:text-indigo-400 uppercase tracking-wider mb-3 inline-flex items-center gap-1.5">
                  <Users className="w-3.5 h-3.5" /> Your org on this course
                </p>

                {detail ? (
                  <>
                    <div className="grid grid-cols-3 gap-3 mb-3">
                      <div className="rounded-xl bg-white/70 dark:bg-zinc-900/50 border border-slate-200/60 dark:border-zinc-800/60 p-2.5 text-center">
                        <p className="text-xl font-black text-slate-800 dark:text-zinc-100">{orgEnrolled}</p>
                        <p className="text-[9px] font-bold text-slate-400 uppercase tracking-wider mt-0.5">Enrolled</p>
                      </div>
                      <div className="rounded-xl bg-white/70 dark:bg-zinc-900/50 border border-slate-200/60 dark:border-zinc-800/60 p-2.5 text-center">
                        <p className={cn("text-xl font-black", orgCompleted > 0 ? "text-emerald-600 dark:text-emerald-400" : "text-slate-800 dark:text-zinc-100")}>
                          {orgCompleted}
                        </p>
                        <p className="text-[9px] font-bold text-slate-400 uppercase tracking-wider mt-0.5">Completed</p>
                      </div>
                      <div className="rounded-xl bg-white/70 dark:bg-zinc-900/50 border border-slate-200/60 dark:border-zinc-800/60 p-2.5 text-center">
                        <p className="text-xl font-black text-slate-800 dark:text-zinc-100">{avgCompletion}%</p>
                        <p className="text-[9px] font-bold text-slate-400 uppercase tracking-wider mt-0.5">Avg progress</p>
                      </div>
                    </div>

                    {orgEnrolled > 0 ? (
                      <div className="flex flex-col gap-1">
                        <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 text-[9px] font-bold text-slate-400 uppercase tracking-wider">
                          <span>Completion rate</span>
                          <span className="text-emerald-600 dark:text-emerald-400">{completionRate}%</span>
                        </div>
                        <div className="w-full bg-slate-200 dark:bg-zinc-800 rounded-full h-2">
                          <div
                            className="bg-gradient-to-r from-emerald-500 to-teal-500 h-2 rounded-full transition-all duration-500"
                            style={{ width: `${completionRate}%` }}
                          />
                        </div>
                        <p className="text-[9px] text-slate-400 dark:text-zinc-500">
                          {orgCompleted} of {orgEnrolled} people finished · {orgEnrolled - orgCompleted} still in progress
                        </p>
                      </div>
                    ) : (
                      <p className="text-[11px] text-slate-400 dark:text-zinc-500 text-center py-1">
                        No one in your org has taken this course yet — be the first!
                      </p>
                    )}
                  </>
                ) : (
                  <p className="text-[11px] text-slate-400 dark:text-zinc-500">Loading org data…</p>
                )}
              </div>

              {/* Footer actions */}
              <div className="flex flex-wrap items-center gap-2 pt-1 border-t border-slate-200/60 dark:border-zinc-800/80">
                {d.url && (
                  <a
                    href={d.url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-[11px] font-bold text-indigo-600 dark:text-indigo-400 inline-flex items-center gap-1.5 hover:underline"
                  >
                    <ExternalLink className="w-3.5 h-3.5" /> View on Udemy
                  </a>
                )}
                <button
                  onClick={() => onAdd(course)}
                  disabled={busy}
                  className="ml-auto px-4 py-2 text-xs font-bold rounded-xl bg-gradient-to-r from-indigo-600 to-violet-600 hover:from-indigo-500 hover:to-violet-500 text-white shadow-md shadow-indigo-500/20 inline-flex items-center gap-1.5 disabled:opacity-50 cursor-pointer transition-all active:scale-95"
                >
                  <Plus className="w-3.5 h-3.5" /> Add to course materials
                </button>
              </div>
            </div>
          )}
        </div>
      )}
    </motion.div>
  );
}

const CONTENT_META: Record<
  ContentItem["kind"],
  { label: string; icon: React.ComponentType<{ className?: string }>; color: string }
> = {
  document: { label: "Document", icon: FileText, color: "text-rose-500 bg-rose-500/10" },
  udemy: { label: "Udemy", icon: PlayCircle, color: "text-violet-500 bg-violet-500/10" },
  video: { label: "Video", icon: Video, color: "text-amber-500 bg-amber-500/10" },
  link: { label: "Link", icon: Link2, color: "text-blue-500 bg-blue-500/10" },
};

function MaterialsEditor({
  authHeaders,
  trainingId,
  levelId,
}: {
  authHeaders: Record<string, string>;
  trainingId: number;
  levelId: number | null;
}) {
  const [items, setItems] = useState<ContentItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState<"link" | "udemy" | "video" | "document">("link");
  const [draft, setDraft] = useState({ title: "", url: "" });
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const fileRef = useRef<HTMLInputElement>(null);

  // Udemy search state
  const [udemyQuery, setUdemyQuery] = useState("");
  const [udemyResults, setUdemyResults] = useState<any[]>([]);
  const [udemySearching, setUdemySearching] = useState(false);
  const [udemyErr, setUdemyErr] = useState("");
  const [udemyIndexing, setUdemyIndexing] = useState(false);

  // Warm the Udemy index as soon as the Udemy tab is opened.
  useEffect(() => {
    if (activeTab !== "udemy") return;
    fetch("/api/portal/udemy/status", { headers: authHeaders })
      .then((r) => r.json())
      .then((d) => setUdemyIndexing(!!d.index?.loading))
      .catch(() => {});
  }, [activeTab, authHeaders]);

  // FormData uploads must NOT carry the JSON Content-Type header.
  const uploadHeaders = useMemo(() => {
    const h: Record<string, string> = { ...authHeaders };
    delete h["Content-Type"];
    return h;
  }, [authHeaders]);

  const load = useCallback(() => {
    setLoading(true);
    fetch(`/api/portal/te-local/trainings/${trainingId}/content`, { headers: authHeaders })
      .then((r) => r.json())
      .then((d) =>
        setItems((d.results || []).filter((c: ContentItem) => (c.level_id ?? null) === levelId)),
      )
      .finally(() => setLoading(false));
  }, [authHeaders, trainingId, levelId]);

  useEffect(() => {
    load();
  }, [load]);

  const saveContent = async (kind: string, title: string, url: string) => {
    setBusy(true);
    setErr("");
    try {
      const resp = await fetch(`/api/portal/te-local/trainings/${trainingId}/content`, {
        method: "POST",
        headers: authHeaders,
        body: JSON.stringify({ kind, title, url, level_id: levelId }),
      });
      if (!resp.ok) throw new Error((await resp.json().catch(() => ({}))).detail || "Failed.");
      setDraft({ title: "", url: "" });
      load();
    } catch (e: any) {
      setErr(e.message);
    } finally {
      setBusy(false);
    }
  };

  const addManual = () => {
    if (!draft.url.trim() && !draft.title.trim()) { setErr("Add a title or URL."); return; }
    saveContent(activeTab, draft.title || draft.url, draft.url);
  };

  const addUdemyCourse = (course: any) => {
    const title = course.title || "Udemy course";
    const url = course.url || "";  // backend _full_url() already returns the absolute URL
    saveContent("udemy", title, url);
  };

  const searchUdemy = async () => {
    if (!udemyQuery.trim()) return;
    setUdemySearching(true);
    setUdemyErr("");
    setUdemyResults([]);
    try {
      const resp = await fetch(
        `/api/portal/udemy/courses?q=${encodeURIComponent(udemyQuery)}&page_size=10`,
        { headers: authHeaders },
      );
      const data = await resp.json().catch(() => ({}));
      if (!resp.ok) throw new Error(data.detail || "Udemy search failed. Check Udemy credentials in backend/.env.");
      // Index may still be building on first use — tell the user to retry.
      if (data.indexing) {
        setUdemyErr("Udemy catalog is still indexing (first load). Please wait a few seconds and search again.");
        return;
      }
      const results = (data.results || []).slice(0, 10);
      setUdemyResults(results);
      if (results.length === 0) setUdemyErr("No Udemy courses found for that keyword. Try something broader.");
    } catch (e: any) {
      setUdemyErr(e.message);
    } finally {
      setUdemySearching(false);
    }
  };

  const upload = async (file: File) => {
    setBusy(true);
    setErr("");
    try {
      const fd = new FormData();
      fd.append("file", file);
      fd.append("title", file.name);
      if (levelId != null) fd.append("level_id", String(levelId));
      const resp = await fetch(`/api/portal/te-local/trainings/${trainingId}/content/upload`, {
        method: "POST",
        headers: uploadHeaders,
        body: fd,
      });
      if (!resp.ok) throw new Error((await resp.json().catch(() => ({}))).detail || "Upload failed.");
      load();
    } catch (e: any) {
      setErr(e.message);
    } finally {
      setBusy(false);
      if (fileRef.current) fileRef.current.value = "";
    }
  };

  const remove = async (id: number) => {
    await fetch(`/api/portal/te-local/content/${id}`, { method: "DELETE", headers: authHeaders });
    load();
  };

  const KIND_TABS: { id: "link" | "udemy" | "video" | "document"; label: string; icon: React.ComponentType<{ className?: string }> }[] = [
    { id: "link", label: "Web link", icon: Link2 },
    { id: "udemy", label: "Udemy course", icon: PlayCircle },
    { id: "video", label: "Video", icon: Video },
    { id: "document", label: "Upload doc", icon: Upload },
  ];

  return (
    <div className="flex flex-col gap-3">
      {/* Existing materials */}
      {loading ? (
        <div className="flex items-center gap-2 text-xs text-slate-400 py-3">
          <Loader2 className="w-4 h-4 animate-spin" /> Loading materials…
        </div>
      ) : items.length === 0 ? (
        <p className="text-[11px] text-slate-400 dark:text-zinc-500 text-center py-3 border border-dashed border-slate-200 dark:border-zinc-800 rounded-xl">
          No materials yet — add below.
        </p>
      ) : (
        <div className="flex flex-col gap-1.5">
          {items.map((c) => {
            const meta = CONTENT_META[c.kind] || CONTENT_META.link;
            return (
              <div key={c.id} className="flex items-center gap-2.5 rounded-xl border border-slate-200/60 dark:border-zinc-800/80 bg-white/60 dark:bg-zinc-900/40 px-3 py-2">
                <span className={cn("p-1.5 rounded-lg shrink-0", meta.color)}>
                  <meta.icon className="w-3.5 h-3.5" />
                </span>
                <div className="min-w-0 flex-1">
                  <p className="text-xs font-bold text-slate-700 dark:text-zinc-300 truncate">{c.title}</p>
                  {c.url && (
                    <a href={c.url} target="_blank" rel="noopener noreferrer" className="text-[10px] text-indigo-500 hover:underline truncate block">
                      {c.kind === "document" ? c.file_name || "Open document" : c.url}
                    </a>
                  )}
                </div>
                <span className="text-[9px] font-bold uppercase tracking-wider text-slate-400 dark:text-zinc-500 shrink-0">{meta.label}</span>
                <button onClick={() => remove(c.id)} className="text-slate-400 hover:text-red-500 shrink-0">
                  <Trash2 className="w-3.5 h-3.5" />
                </button>
              </div>
            );
          })}
        </div>
      )}

      {/* Add material — tabbed by kind */}
      <div className="rounded-xl border border-slate-200/60 dark:border-zinc-800/80 bg-slate-50/40 dark:bg-zinc-900/30 overflow-hidden">
        {/* Kind selector tabs */}
        <div className="flex border-b border-slate-200/60 dark:border-zinc-800/80">
          {KIND_TABS.map((t) => (
            <button
              key={t.id}
              onClick={() => { setActiveTab(t.id); setErr(""); setUdemyErr(""); }}
              className={cn(
                "flex-1 inline-flex items-center justify-center gap-1.5 py-2 text-[10px] font-bold transition-colors border-b-2",
                activeTab === t.id
                  ? "border-indigo-500 text-indigo-600 dark:text-indigo-400 bg-white/60 dark:bg-zinc-900/40"
                  : "border-transparent text-slate-400 dark:text-zinc-500 hover:text-slate-600 dark:hover:text-zinc-300",
              )}
            >
              <t.icon className="w-3.5 h-3.5" />
              <span className="hidden sm:inline">{t.label}</span>
            </button>
          ))}
        </div>

        <div className="p-3 flex flex-col gap-2">
          {/* Web link / Video — manual URL entry */}
          {(activeTab === "link" || activeTab === "video") && (
            <>
              <input
                className={inputCls}
                placeholder="Title (optional)"
                value={draft.title}
                onChange={(e) => setDraft({ ...draft, title: e.target.value })}
              />
              <div className="flex gap-2">
                <input
                  className={inputCls}
                  placeholder={activeTab === "video" ? "https://youtube.com/… or any video URL" : "https://…"}
                  value={draft.url}
                  onChange={(e) => setDraft({ ...draft, url: e.target.value })}
                />
                <button
                  onClick={addManual}
                  disabled={busy}
                  className="px-3 py-2 shrink-0 text-[11px] font-bold rounded-xl bg-indigo-600 hover:bg-indigo-500 text-white inline-flex items-center gap-1.5 disabled:opacity-50 cursor-pointer"
                >
                  {busy ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Plus className="w-3.5 h-3.5" />} Add
                </button>
              </div>
            </>
          )}

          {/* Udemy — search from Udemy catalog */}
          {activeTab === "udemy" && (
            <div className="flex flex-col gap-2">
              {udemyIndexing && (
                <p className="text-[11px] text-slate-400 dark:text-zinc-500 inline-flex items-center gap-1.5">
                  <Loader2 className="w-3.5 h-3.5 animate-spin text-violet-500" />
                  Building Udemy catalog index for the first time — search will be ready in ~10 seconds.
                </p>
              )}
              <div className="flex gap-2">
                <input
                  className={inputCls}
                  placeholder="Search Udemy courses… e.g. Python, Machine Learning"
                  value={udemyQuery}
                  onChange={(e) => setUdemyQuery(e.target.value)}
                  onKeyDown={(e) => e.key === "Enter" && searchUdemy()}
                />
                <button
                  onClick={searchUdemy}
                  disabled={udemySearching || !udemyQuery.trim()}
                  className="px-3 py-2 shrink-0 text-[11px] font-bold rounded-xl bg-violet-600 hover:bg-violet-500 text-white inline-flex items-center gap-1.5 disabled:opacity-50 cursor-pointer"
                >
                  {udemySearching ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Search className="w-3.5 h-3.5" />} Search
                </button>
              </div>
              {udemyErr && <p className="text-[11px] text-amber-600 dark:text-amber-400">{udemyErr}</p>}
              {udemyResults.length > 0 && (
                <div className="flex flex-col gap-2">
                  <p className="text-[10px] font-extrabold text-slate-400 dark:text-zinc-500 uppercase tracking-wider">
                    {udemyResults.length} course{udemyResults.length !== 1 ? "s" : ""} found — click a card for details + org stats
                  </p>
                  <div className="flex flex-col gap-2 pr-0.5">
                    {udemyResults.map((c: any, i: number) => (
                      <UdemyCourseCard
                        key={c.id ?? i}
                        course={c}
                        authHeaders={authHeaders}
                        onAdd={addUdemyCourse}
                        busy={busy}
                      />
                    ))}
                  </div>
                </div>
              )}
              <p className="text-[10px] text-slate-400 dark:text-zinc-500">
                Or paste a Udemy URL directly:
              </p>
              <div className="flex gap-2">
                <input
                  className={inputCls}
                  placeholder="https://www.udemy.com/course/…"
                  value={draft.url}
                  onChange={(e) => setDraft({ ...draft, url: e.target.value, title: draft.title })}
                />
                <input
                  className={cn(inputCls, "w-32 shrink-0")}
                  placeholder="Title"
                  value={draft.title}
                  onChange={(e) => setDraft({ ...draft, title: e.target.value })}
                />
                <button
                  onClick={addManual}
                  disabled={busy || !draft.url.trim()}
                  className="px-3 py-2 shrink-0 text-[11px] font-bold rounded-xl bg-indigo-600 hover:bg-indigo-500 text-white inline-flex items-center gap-1.5 disabled:opacity-50 cursor-pointer"
                >
                  {busy ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Plus className="w-3.5 h-3.5" />} Add
                </button>
              </div>
            </div>
          )}

          {/* Document upload */}
          {activeTab === "document" && (
            <div className="flex flex-col gap-2">
              <input
                ref={fileRef}
                type="file"
                className="hidden"
                onChange={(e) => e.target.files?.[0] && upload(e.target.files[0])}
              />
              <button
                onClick={() => fileRef.current?.click()}
                disabled={busy}
                className="w-full py-6 text-[11px] font-bold rounded-xl border-2 border-dashed border-slate-300 dark:border-zinc-700 text-slate-500 dark:text-zinc-400 hover:border-indigo-400 hover:text-indigo-600 dark:hover:text-indigo-400 inline-flex flex-col items-center justify-center gap-2 disabled:opacity-50 cursor-pointer transition-colors"
              >
                {busy ? <Loader2 className="w-6 h-6 animate-spin" /> : <Upload className="w-6 h-6" />}
                {busy ? "Uploading…" : "Click to upload a document"}
              </button>
              <p className="text-[10px] text-slate-400 dark:text-zinc-500 text-center">
                PDF, DOCX, PPTX, XLSX, TXT · max 50 MB · text will be extracted to ground AI question generation
              </p>
            </div>
          )}

          {err && <p className="text-[11px] font-bold text-red-500">{err}</p>}
        </div>
      </div>
    </div>
  );
}

// ── Reusable: assessment (AI-draft + manual MCQ authoring) ───────────────────

function AssessmentEditor({
  authHeaders,
  trainingId,
  levelId,
}: {
  authHeaders: Record<string, string>;
  trainingId: number;
  levelId: number | null;
}) {
  const [saved, setSaved] = useState<any[]>([]);
  const [drafts, setDrafts] = useState<DraftQuestion[]>([]);
  const [loading, setLoading] = useState(true);
  const [hasMaterials, setHasMaterials] = useState<boolean | null>(null);
  const [count, setCount] = useState(5);
  const [difficulty, setDifficulty] = useState("mixed");
  const [generating, setGenerating] = useState(false);
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState("");

  const load = useCallback(() => {
    setLoading(true);
    Promise.all([
      fetch(`/api/portal/te-local/trainings/${trainingId}/questions?manage=true`, { headers: authHeaders })
        .then((r) => r.json()),
      fetch(`/api/portal/te-local/trainings/${trainingId}/content`, { headers: authHeaders })
        .then((r) => r.json()),
    ])
      .then(([q, c]) => {
        setSaved((q.results || []).filter((q: any) => (q.level_id ?? null) === levelId));
        const mats = (c.results || []).filter((m: any) => (m.level_id ?? null) === levelId);
        setHasMaterials(mats.length > 0);
      })
      .finally(() => setLoading(false));
  }, [authHeaders, trainingId, levelId]);

  useEffect(() => {
    load();
  }, [load]);

  const generate = async () => {
    setGenerating(true);
    setErr("");
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 90_000);
    try {
      const resp = await fetch(`/api/portal/te-local/trainings/${trainingId}/questions/generate`, {
        method: "POST",
        headers: authHeaders,
        body: JSON.stringify({ level_id: levelId, count, difficulty }),
        signal: controller.signal,
      });
      const data = await resp.json().catch(() => ({}));
      if (!resp.ok) throw new Error(data.detail || "Generation failed.");
      setDrafts((prev) => [...prev, ...(data.questions || [])]);
      if (data.grounded === false)
        setErr("Questions generated without course materials — they are based only on the title and skills. Add materials in the Materials tab for better, grounded questions.");
    } catch (e: any) {
      if (e.name === "AbortError")
        setErr("Generation timed out — the shared LLM is busy. Try again with a smaller count, or add materials first.");
      else
        setErr(e.message);
    } finally {
      clearTimeout(timer);
      setGenerating(false);
    }
  };

  const addBlank = () =>
    setDrafts((prev) => [
      ...prev,
      { question: "", options: { A: "", B: "", C: "", D: "" }, correct_answer: "A", marks: 1, explanation: "", level_id: levelId },
    ]);

  const updateDraft = (i: number, patch: Partial<DraftQuestion>) =>
    setDrafts((prev) => prev.map((d, idx) => (idx === i ? { ...d, ...patch } : d)));
  const updateOption = (i: number, key: string, val: string) =>
    setDrafts((prev) => prev.map((d, idx) => (idx === i ? { ...d, options: { ...d.options, [key]: val } } : d)));
  const removeDraft = (i: number) => setDrafts((prev) => prev.filter((_, idx) => idx !== i));

  const saveDrafts = async () => {
    const valid = drafts.filter(
      (d) => d.question.trim() && Object.values(d.options).filter((v) => v.trim()).length >= 2,
    );
    if (!valid.length) {
      setErr("Add at least one complete question (text + 2 options).");
      return;
    }
    setSaving(true);
    setErr("");
    try {
      const resp = await fetch(`/api/portal/te-local/trainings/${trainingId}/questions/bulk`, {
        method: "POST",
        headers: authHeaders,
        body: JSON.stringify({ level_id: levelId, questions: valid }),
      });
      if (!resp.ok) throw new Error((await resp.json().catch(() => ({}))).detail || "Save failed.");
      setDrafts([]);
      load();
    } catch (e: any) {
      setErr(e.message);
    } finally {
      setSaving(false);
    }
  };

  const removeSaved = async (qid: number) => {
    await fetch(`/api/portal/te-local/questions/${qid}`, { method: "DELETE", headers: authHeaders });
    load();
  };

  return (
    <div className="flex flex-col gap-3">
      {/* Saved questions */}
      {loading ? (
        <div className="flex items-center gap-2 text-xs text-slate-400 py-2">
          <Loader2 className="w-4 h-4 animate-spin" /> Loading questions…
        </div>
      ) : saved.length > 0 ? (
        <div className="flex flex-col gap-1.5">
          <p className="text-[10px] font-extrabold text-slate-400 dark:text-zinc-500 uppercase tracking-wider">
            Saved questions ({saved.length})
          </p>
          {saved.map((q, i) => (
            <div key={q.id} className="flex items-start justify-between gap-2 rounded-lg border border-emerald-500/20 bg-emerald-500/5 px-3 py-2">
              <p className="text-xs font-semibold text-slate-700 dark:text-zinc-300">
                <span className="text-emerald-600 font-bold">Q{i + 1}.</span> {q.question}
                <span className="ml-1.5 text-[10px] text-emerald-600/80">(ans {q.correct_answer})</span>
              </p>
              <button onClick={() => removeSaved(q.id)} className="text-slate-400 hover:text-red-500 shrink-0">
                <Trash2 className="w-3.5 h-3.5" />
              </button>
            </div>
          ))}
        </div>
      ) : null}

      {/* No-materials pre-flight warning */}
      {hasMaterials === false && (
        <div className="flex items-start gap-2.5 rounded-xl border border-amber-500/30 bg-amber-500/[0.06] dark:bg-amber-500/[0.08] px-3 py-2.5">
          <AlertTriangle className="w-4 h-4 text-amber-500 shrink-0 mt-0.5" />
          <p className="text-[11px] text-amber-700 dark:text-amber-300 leading-relaxed">
            <span className="font-bold">No materials yet.</span> Switch to the <span className="font-bold">Materials</span> tab and upload a document or add a link first — the AI generates much better questions when it can read the actual course content. You can still generate now, but questions will be based only on the course title and skills.
          </p>
        </div>
      )}

      {/* AI generation controls */}
      <div className="rounded-xl border border-violet-500/20 bg-violet-500/[0.04] dark:bg-violet-500/[0.06] p-3 flex flex-col gap-2.5">
        <div className="flex items-center gap-2 text-xs font-bold text-violet-700 dark:text-violet-300">
          <Wand2 className="w-4 h-4" /> Generate with AI from course materials
        </div>
        <div className="flex flex-wrap items-end gap-2">
          <label className="flex flex-col gap-1">
            <span className="text-[9px] font-extrabold text-slate-400 uppercase tracking-wider">Count</span>
            <input type="number" min={1} max={15} className={cn(inputCls, "w-20")} value={count} onChange={(e) => setCount(Math.max(1, Math.min(15, +e.target.value)))} />
          </label>
          <label className="flex flex-col gap-1">
            <span className="text-[9px] font-extrabold text-slate-400 uppercase tracking-wider">Difficulty</span>
            <select className={cn(inputCls, "w-36")} value={difficulty} onChange={(e) => setDifficulty(e.target.value)}>
              <option value="easy">Easy</option>
              <option value="mixed">Mixed</option>
              <option value="hard">Hard</option>
            </select>
          </label>
          <button
            onClick={generate}
            disabled={generating}
            className="px-4 py-2.5 text-xs font-bold rounded-xl bg-gradient-to-r from-violet-600 to-indigo-600 hover:from-violet-500 hover:to-indigo-500 text-white shadow-md disabled:opacity-50 inline-flex items-center gap-1.5 cursor-pointer"
          >
            {generating ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Sparkles className="w-3.5 h-3.5" />}
            {generating ? "Drafting… (may take ~30s)" : "Generate"}
          </button>
          <button
            onClick={addBlank}
            className="px-3 py-2.5 text-xs font-bold rounded-xl border border-slate-200 dark:border-zinc-800 text-slate-600 dark:text-zinc-300 hover:bg-white dark:hover:bg-zinc-800/60 inline-flex items-center gap-1.5 cursor-pointer"
          >
            <Plus className="w-3.5 h-3.5" /> Add manually
          </button>
        </div>
        {generating && (
          <p className="text-[10px] text-slate-400 dark:text-zinc-500">
            The shared LLM is generating your questions. This typically takes 20–60 seconds. Please wait…
          </p>
        )}
      </div>

      {/* Draft review */}
      {drafts.length > 0 && (
        <div className="flex flex-col gap-3">
          <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
            <p className="text-[10px] font-extrabold text-slate-400 dark:text-zinc-500 uppercase tracking-wider">
              Review drafts ({drafts.length}) — edit before saving
            </p>
            <button
              onClick={saveDrafts}
              disabled={saving}
              className="px-3 py-1.5 text-[11px] font-bold rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white inline-flex items-center gap-1.5 disabled:opacity-50 cursor-pointer"
            >
              {saving ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Check className="w-3.5 h-3.5" />} Save to course
            </button>
          </div>
          {drafts.map((d, i) => (
            <div key={i} className="rounded-xl border border-slate-200/60 dark:border-zinc-800/80 bg-slate-50/50 dark:bg-zinc-900/30 p-3 flex flex-col gap-2">
              <div className="flex items-start gap-2">
                <span className="text-[11px] font-black text-indigo-500 mt-2 shrink-0">Q{i + 1}</span>
                <textarea
                  className={inputCls}
                  rows={2}
                  placeholder="Question"
                  value={d.question}
                  onChange={(e) => updateDraft(i, { question: e.target.value })}
                />
                <button onClick={() => removeDraft(i)} className="text-slate-400 hover:text-red-500 mt-2 shrink-0">
                  <Trash2 className="w-3.5 h-3.5" />
                </button>
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-1.5 pl-6">
                {(["A", "B", "C", "D"] as const).map((k) => (
                  <div key={k} className="flex items-center gap-1.5">
                    <button
                      type="button"
                      onClick={() => updateDraft(i, { correct_answer: k })}
                      className={cn(
                        "w-6 h-6 shrink-0 rounded-md text-[10px] font-black border transition-colors",
                        d.correct_answer === k
                          ? "bg-emerald-500 text-white border-emerald-500"
                          : "border-slate-200 dark:border-zinc-800 text-slate-400 hover:border-emerald-400",
                      )}
                      title="Mark correct"
                    >
                      {k}
                    </button>
                    <input
                      className={cn(inputCls, "py-1.5")}
                      placeholder={`Option ${k}`}
                      value={d.options[k] || ""}
                      onChange={(e) => updateOption(i, k, e.target.value)}
                    />
                  </div>
                ))}
              </div>
              <input
                className={cn(inputCls, "py-1.5 ml-6 w-[calc(100%-1.5rem)]")}
                placeholder="Explanation (optional)"
                value={d.explanation || ""}
                onChange={(e) => updateDraft(i, { explanation: e.target.value })}
              />
            </div>
          ))}
        </div>
      )}

      {err && <p className="text-[11px] font-bold text-amber-600 dark:text-amber-400">{err}</p>}
    </div>
  );
}

// ── Assignments (admin) ──────────────────────────────────────────────────────

function AssignmentsTab({ authHeaders, canManage }: { authHeaders: Record<string, string>; canManage: boolean }) {
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

      <div className="flex justify-end gap-2">
        <ExportCsvButton
          rows={rows.map((a) => ({
            Employee: a.employee_name || a.employee_email,
            "Employee Email": a.employee_email,
            Department: a.department || "",
            "Assigned Course": a.training_title,
            Status: a.status,
            "Exam Score": a.score != null ? a.score : "",
          }))}
          filename="techelevate-assignments-ledger.csv"
        />
        {canManage && (
          <button
            onClick={() => setAssigning(true)}
            className="px-4 py-2.5 rounded-xl bg-gradient-to-r from-violet-600 to-indigo-600 hover:from-violet-500 hover:to-indigo-500 text-white text-xs font-bold shadow-md shadow-indigo-600/25 transition-all duration-200 hover:scale-[1.02] active:scale-95 inline-flex items-center gap-2 cursor-pointer"
          >
            <Plus className="w-4 h-4" /> Assign Course
          </button>
        )}
      </div>

      <div className="rounded-2xl border border-slate-200/50 dark:border-zinc-800/80 bg-white/70 dark:bg-zinc-900/40 shadow-xs backdrop-blur-md overflow-hidden">
        <div className="overflow-x-auto">
          <Table paginate itemsPerPage={10} className="w-full text-sm">
            <TableHeader className="bg-slate-50/50 dark:bg-zinc-900/50 border-b border-slate-100 dark:border-zinc-800/60">
              <TableRow>
                {["Employee", "Department", "Assigned Course", "Status", "Exam Score"].map((c) => (
                  <TableHead
                    key={c}
                    className="text-left px-4 py-3.5 text-[10px] font-extrabold text-slate-400 dark:text-zinc-500 uppercase tracking-wider whitespace-nowrap"
                  >
                    {c}
                  </TableHead>
                ))}
              </TableRow>
            </TableHeader>
            <TableBody className="divide-y divide-slate-100 dark:divide-zinc-800/60">
              {rows.map((a) => {
                const initial = (a.employee_name || a.employee_email || "?")[0].toUpperCase();
                return (
                  <TableRow
                    key={a.id}
                    className="hover:bg-slate-50/50 dark:hover:bg-zinc-800/35 transition-colors duration-200"
                  >
                    <TableCell className="px-4 py-3.5 whitespace-nowrap">
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
                    </TableCell>
                    <TableCell className="px-4 py-3.5 whitespace-nowrap text-xs font-semibold text-slate-500 dark:text-zinc-400">
                      {a.department || "—"}
                    </TableCell>
                    <TableCell className="px-4 py-3.5 whitespace-nowrap text-xs font-bold text-slate-700 dark:text-zinc-300">
                      {a.training_title}
                    </TableCell>
                    <TableCell className="px-4 py-3.5 whitespace-nowrap">
                      <span
                        className={cn(
                          "text-[10px] px-2 py-0.5 rounded-full font-bold uppercase tracking-wider",
                          STATUS_STYLES[a.status] || "bg-muted",
                        )}
                      >
                        {a.status}
                      </span>
                    </TableCell>
                    <TableCell className="px-4 py-3.5 whitespace-nowrap text-xs font-black">
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
                    </TableCell>
                  </TableRow>
                );
              })}
              {rows.length === 0 && (
                <TableRow>
                  <TableCell
                    colSpan={5}
                    className="px-4 py-12 text-center text-slate-400 dark:text-zinc-500 text-xs font-medium"
                  >
                    No learning assignments found on the platform ledger.
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
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

function MyLearningTab({
  authHeaders,
  portalUrl,
}: {
  authHeaders: Record<string, string>;
  portalUrl?: string;
}) {
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
      {portalUrl && (
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 gap-3 rounded-2xl border border-violet-500/20 bg-violet-500/[0.05] dark:bg-violet-500/[0.07] px-4 py-3">
          <p className="text-xs font-semibold text-slate-600 dark:text-zinc-300">
            Practise here, then sit the official, proctored exam on the TechElevate portal.
          </p>
          <a
            href={portalUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="shrink-0 inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-gradient-to-r from-violet-600 to-indigo-600 hover:from-violet-500 hover:to-indigo-500 text-white text-[11px] font-bold shadow-xs transition-all"
          >
            <ExternalLink className="w-3.5 h-3.5" /> Open TechElevate
          </a>
        </div>
      )}
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
          {a.status !== "Completed" && a.has_questions && (
            <button
              onClick={() => setActive(a)}
              className="w-full sm:w-auto text-center shrink-0 px-4 py-2.5 text-xs font-bold rounded-xl bg-gradient-to-r from-violet-600 to-indigo-600 hover:from-violet-500 hover:to-indigo-500 text-white shadow-xs transition-all duration-200 hover:scale-[1.02] active:scale-95 cursor-pointer"
            >
              Take Assessment
            </button>
          )}
          {a.status !== "Completed" && !a.has_questions && (
            <span className="text-[11px] font-semibold text-slate-400 dark:text-zinc-500 shrink-0 text-center sm:text-right">
              Assessment not ready yet
            </span>
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
  wide = false,
}: {
  title: string;
  children: React.ReactNode;
  onClose: () => void;
  wide?: boolean;
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
        className={cn(
          "w-full max-h-[90vh] flex flex-col rounded-3xl border border-slate-200/60 dark:border-zinc-800 bg-white dark:bg-zinc-950 shadow-2xl",
          wide ? "max-w-3xl" : "max-w-lg",
        )}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 shrink-0 p-5 border-b border-slate-100 dark:border-zinc-800/50">
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
        <div className="p-5 flex-1 overflow-y-auto">
          {children}
        </div>
      </motion.div>
    </div>
  );
}
