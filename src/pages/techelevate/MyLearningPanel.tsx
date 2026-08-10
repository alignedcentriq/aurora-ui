import { useCallback, useEffect, useState } from "react";
import { GraduationCap, RefreshCw, AlertCircle, Check, ExternalLink } from "lucide-react";
import { motion } from "framer-motion";
import { cn } from "@/lib/utils";
import { Spinner } from "@/pages/TechElevateLocalPortal";

const API = "/api/portal/techelevate";

// Real TechElevate assignment shape (AssignmentOut from the real API).
interface RealAssignment {
  id: number;
  training_id: number;
  training_title?: string | null;
  current_level_id: number;
  current_level_name?: string | null;
  status: string; // "assigned" | "in_progress" | "completed" | "failed"
  training_start_date?: string | null;
  training_end_date?: string | null;
  exam_questions_count?: number | null;
  exam_duration_minutes?: number | null;
}

const REAL_STATUS_STYLES: Record<string, string> = {
  completed: "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border border-emerald-500/20",
  in_progress: "bg-amber-500/10 text-amber-600 dark:text-amber-400 border border-amber-500/20",
  assigned: "bg-slate-500/10 text-slate-500 dark:text-zinc-400 border border-slate-500/20",
  failed: "bg-rose-500/10 text-rose-600 dark:text-rose-400 border border-rose-500/20",
};

export function MyLearningPanel({
  authHeaders,
  portalUrl,
}: {
  authHeaders: Record<string, string>;
  portalUrl?: string;
}) {
  const [rows, setRows] = useState<RealAssignment[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(() => {
    setLoading(true);
    setError(null);
    fetch(`${API}/assignments/my`, { headers: authHeaders })
      .then(async (r) => {
        if (!r.ok) {
          const body = await r.json().catch(() => ({}));
          throw new Error(body.detail || "Couldn't load your TechElevate assignments.");
        }
        return r.json();
      })
      .then((d) => setRows(d.results || d.items || []))
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false));
  }, [authHeaders]);

  useEffect(() => {
    load();
  }, [load]);

  const examUrl = portalUrl ? `${portalUrl.replace(/\/$/, "")}/app/my-learning` : undefined;

  if (loading) return <Spinner label="Loading your trainings from TechElevate…" />;

  if (error) {
    return (
      <div className="text-center py-16 flex flex-col items-center gap-3">
        <div className="p-4 rounded-full bg-amber-500/10 text-amber-500 border border-amber-500/20">
          <AlertCircle className="w-8 h-8" />
        </div>
        <p className="text-xs font-semibold text-slate-500 dark:text-zinc-400 max-w-sm">{error}</p>
        <button
          onClick={load}
          className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-slate-100 dark:bg-zinc-800 text-slate-600 dark:text-zinc-300 text-[11px] font-bold hover:bg-slate-200 dark:hover:bg-zinc-700 transition-colors"
        >
          <RefreshCw className="w-3.5 h-3.5" /> Retry
        </button>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-3.5">
      {examUrl && (
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 gap-3 rounded-2xl border border-violet-500/20 bg-violet-500/[0.05] dark:bg-violet-500/[0.07] px-4 py-3">
          <p className="text-xs font-semibold text-slate-600 dark:text-zinc-300">
            Live from the TechElevate portal. Exams are sat and proctored there, not here.
          </p>
          <a
            href={examUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="shrink-0 inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-gradient-to-r from-violet-600 to-indigo-600 hover:from-violet-500 hover:to-indigo-500 text-white text-[11px] font-bold shadow-xs transition-all"
          >
            <ExternalLink className="w-3.5 h-3.5" /> Open TechElevate
          </a>
        </div>
      )}
      {!rows.length ? (
        <div className="text-center py-20 text-slate-400 dark:text-zinc-500 text-xs font-semibold uppercase tracking-wider flex flex-col items-center gap-3">
          <div className="p-4 rounded-full bg-slate-100 dark:bg-zinc-800/80 text-slate-400 dark:text-zinc-500 border border-slate-200/50 dark:border-zinc-800/50">
            <GraduationCap className="w-8 h-8" />
          </div>
          <span>No courses assigned to your study plan.</span>
        </div>
      ) : (
        rows.map((a) => (
          <motion.div
            key={a.id}
            whileHover={{ x: 3, transition: { duration: 0.15 } }}
            className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 rounded-2xl border border-slate-200/50 dark:border-zinc-800 bg-white/70 dark:bg-zinc-900/40 p-4 shadow-xs backdrop-blur-md transition-all group"
          >
            <div className="min-w-0 w-full sm:w-auto">
              <p className="text-sm font-extrabold text-slate-800 dark:text-zinc-200 group-hover:text-indigo-600 dark:group-hover:text-indigo-400 transition-colors truncate">
                {a.training_title || `Training #${a.training_id}`}
              </p>
              <div className="flex flex-wrap items-center gap-2.5 mt-1.5">
                <span
                  className={cn(
                    "text-[9px] font-bold px-2 py-0.5 rounded-full uppercase tracking-wider",
                    REAL_STATUS_STYLES[a.status] || "bg-muted",
                  )}
                >
                  {a.status.replace("_", " ")}
                </span>
                {a.current_level_name && (
                  <span className="text-[10px] font-bold text-slate-400 dark:text-zinc-500">
                    Level: <span className="text-slate-600 dark:text-zinc-300 font-extrabold">{a.current_level_name}</span>
                  </span>
                )}
                {a.training_end_date && (
                  <span className="text-[10px] font-bold text-slate-400 dark:text-zinc-500">
                    Due {new Date(a.training_end_date).toLocaleDateString()}
                  </span>
                )}
              </div>
            </div>
            {a.status === "completed" ? (
              <div className="self-end sm:self-auto flex items-center justify-center w-7 h-7 rounded-full bg-emerald-500/10 text-emerald-500 border border-emerald-500/20 shadow-xs shrink-0 select-none">
                <Check className="w-4 h-4" />
              </div>
            ) : examUrl ? (
              <a
                href={examUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="w-full sm:w-auto text-center shrink-0 px-4 py-2.5 text-xs font-bold rounded-xl bg-gradient-to-r from-violet-600 to-indigo-600 hover:from-violet-500 hover:to-indigo-500 text-white shadow-xs transition-all duration-200 hover:scale-[1.02] active:scale-95 cursor-pointer"
              >
                Take Exam
              </a>
            ) : null}
          </motion.div>
        ))
      )}
    </div>
  );
}
