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
  key: string; title: string; status: string; category: string; auto: boolean;
}
interface DetailView {
  employee_name: string;
  progress_pct: number;
  status: string;
  steps: StepView[];
  documents: { name: string; submitted: boolean; status: string }[];
}

function Stat({ label, value, tone }: { label: string; value: number; tone?: string }) {
  return (
    <div className="rounded-2xl border border-slate-200/70 dark:border-white/[0.06] bg-white/60 dark:bg-zinc-950/40 backdrop-blur-xl px-4 py-3">
      <div className={cn("text-[22px] font-black tabular-nums", tone || "text-foreground")}>{value}</div>
      <div className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">{label}</div>
    </div>
  );
}

export function OnboardingTracker() {
  const { user } = useAuth();
  const [data, setData] = useState<Overview | null>(null);
  const [loading, setLoading] = useState(true);
  const [detail, setDetail] = useState<DetailView | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);

  const authHeaders = useMemo(() => ({
    "Content-Type": "application/json",
    ...(user?.email ? { "x-user-email": user.email } : {}),
    ...(user?.role ? { "x-user-role": user.role.toLowerCase() } : {}),
  }), [user?.email, user?.role]);

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

  useEffect(() => { load(); }, [load]);

  const openDetail = useCallback(async (email: string) => {
    setDetailLoading(true);
    setDetail(null);
    try {
      const res = await fetch(`/api/onboarding/overview/${encodeURIComponent(email)}`, { headers: authHeaders });
      if (!res.ok) throw new Error("Failed");
      setDetail(await res.json());
    } catch {
      toast.error("Couldn't load that journey.");
    } finally {
      setDetailLoading(false);
    }
  }, [authHeaders]);

  return (
    <div className="flex flex-col h-full overflow-hidden bg-gradient-to-br from-[#f8fafc] to-[#f1f5f9] dark:from-[#030712] dark:to-[#091120] relative">
      <div className="px-8 pt-6 pb-3 border-b border-slate-200/80 dark:border-white/[0.05] bg-white/40 dark:bg-zinc-950/20 backdrop-blur-md shrink-0">
        <div className="flex items-center justify-between gap-3">
          <div>
            <div className="flex items-center gap-2">
              <div className="h-7 w-7 rounded-lg bg-gradient-to-tr from-violet-500 to-indigo-600 flex items-center justify-center shadow-lg">
                <Rocket className="h-4 w-4 text-white" />
              </div>
              <span className="text-[10px] font-extrabold uppercase tracking-[0.2em] text-primary">HR Portal</span>
            </div>
            <h1 className="text-[22px] font-black tracking-tight text-foreground mt-1">Onboarding Tracker</h1>
            <p className="text-[13px] text-muted-foreground mt-0.5">Where every new joiner stands in their onboarding journey.</p>
          </div>
          <button
            onClick={load}
            className="flex items-center gap-1.5 rounded-lg px-3 py-2 text-[13px] text-muted-foreground hover:bg-muted/50 hover:text-foreground transition-colors"
          >
            <RefreshCw className="h-3.5 w-3.5" /> Refresh
          </button>
        </div>

        {data && (
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mt-4 max-w-2xl">
            <Stat label="New joiners" value={data.total} />
            <Stat label="In progress" value={data.active} tone="text-sky-500" />
            <Stat label="Completed" value={data.completed} tone="text-emerald-500" />
            <Stat label="Stalled" value={data.stalled} tone="text-amber-500" />
          </div>
        )}
      </div>

      <div className="flex-1 overflow-auto px-8 py-6">
        {loading ? (
          <div className="flex items-center justify-center py-20 text-muted-foreground"><Loader2 className="h-5 w-5 animate-spin mr-2" /> Loading…</div>
        ) : !data || data.journeys.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-20 text-muted-foreground text-[14px]">
            <Users className="h-8 w-8 mb-3 opacity-40" /> No onboarding journeys yet.
          </div>
        ) : (
          <div className="space-y-2.5 max-w-4xl">
            {data.journeys.map((j) => (
              <button
                key={j.employee_email}
                onClick={() => openDetail(j.employee_email)}
                className="w-full text-left rounded-2xl border border-slate-200/70 dark:border-white/[0.06] bg-white/60 dark:bg-zinc-950/40 backdrop-blur-xl p-4 hover:border-violet-400/50 transition-colors group"
              >
                <div className="flex items-center gap-4">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="text-[14px] font-bold text-foreground truncate">{j.employee_name}</span>
                      {j.department && <span className="text-[11px] text-muted-foreground">· {j.department}</span>}
                      {j.status === "completed" && (
                        <span className="inline-flex items-center gap-1 text-[10px] font-bold px-2 py-0.5 rounded-full bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border border-emerald-500/20">
                          <CheckCircle2 className="h-3 w-3" /> Complete
                        </span>
                      )}
                      {j.stalled && (
                        <span className="inline-flex items-center gap-1 text-[10px] font-bold px-2 py-0.5 rounded-full bg-amber-500/10 text-amber-600 dark:text-amber-400 border border-amber-500/20">
                          <AlertTriangle className="h-3 w-3" /> Stalled
                        </span>
                      )}
                    </div>
                    <div className="flex items-center gap-3 mt-2">
                      <div className="flex-1 h-2 rounded-full bg-slate-200/70 dark:bg-zinc-800 overflow-hidden max-w-md">
                        <div className="h-full rounded-full bg-gradient-to-r from-violet-500 to-indigo-600" style={{ width: `${j.progress_pct}%` }} />
                      </div>
                      <span className="text-[12px] font-bold text-foreground tabular-nums">{j.progress_pct}%</span>
                    </div>
                    <p className="text-[11.5px] text-muted-foreground mt-1.5">
                      Docs {j.docs_submitted}/{j.docs_required}
                      {j.joining_date && <> · Joined {new Date(j.joining_date).toLocaleDateString()}</>}
                      {j.next_step && j.status !== "completed" && <> · Next: {j.next_step.replace(/_/g, " ")}</>}
                    </p>
                  </div>
                  <ChevronRight className="h-4 w-4 text-muted-foreground group-hover:text-violet-500 transition-colors shrink-0" />
                </div>
              </button>
            ))}
          </div>
        )}
      </div>

      {/* Drill-in drawer */}
      <AnimatePresence>
        {(detail || detailLoading) && (
          <motion.div
            initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
            className="absolute inset-0 z-40 bg-black/30 backdrop-blur-sm flex justify-end"
            onClick={() => { setDetail(null); }}
          >
            <motion.div
              initial={{ x: 40, opacity: 0 }} animate={{ x: 0, opacity: 1 }} exit={{ x: 40, opacity: 0 }}
              transition={{ type: "spring", stiffness: 300, damping: 30 }}
              className="w-full max-w-md h-full bg-white dark:bg-zinc-950 border-l border-slate-200 dark:border-white/[0.06] overflow-auto p-6"
              onClick={(e) => e.stopPropagation()}
            >
              <div className="flex items-center justify-between mb-4">
                <h2 className="text-[16px] font-bold text-foreground">{detail?.employee_name || "Journey"}</h2>
                <button onClick={() => setDetail(null)} className="text-muted-foreground hover:text-foreground"><X className="h-4 w-4" /></button>
              </div>
              {detailLoading || !detail ? (
                <div className="flex items-center gap-2 text-muted-foreground"><Loader2 className="h-4 w-4 animate-spin" /> Loading…</div>
              ) : (
                <>
                  <div className="flex items-center gap-3 mb-5">
                    <div className="flex-1 h-2 rounded-full bg-slate-200/70 dark:bg-zinc-800 overflow-hidden">
                      <div className="h-full rounded-full bg-gradient-to-r from-violet-500 to-indigo-600" style={{ width: `${detail.progress_pct}%` }} />
                    </div>
                    <span className="text-[12px] font-bold tabular-nums">{detail.progress_pct}%</span>
                  </div>
                  <p className="text-[11px] font-bold uppercase tracking-wider text-muted-foreground mb-2">Steps</p>
                  <ul className="space-y-1.5 mb-5">
                    {detail.steps.map((s) => {
                      const done = s.status === "done" || s.status === "skipped";
                      return (
                        <li key={s.key} className="flex items-center gap-2 text-[13px]">
                          {done ? <CheckCircle2 className="h-4 w-4 text-emerald-500 shrink-0" /> : <div className="h-4 w-4 rounded-full border-2 border-slate-300 dark:border-zinc-700 shrink-0" />}
                          <span className={cn(done ? "text-foreground" : "text-muted-foreground")}>{s.title}</span>
                        </li>
                      );
                    })}
                  </ul>
                  <p className="text-[11px] font-bold uppercase tracking-wider text-muted-foreground mb-2">Documents</p>
                  <ul className="space-y-1.5">
                    {detail.documents.map((d, i) => (
                      <li key={i} className="flex items-center gap-2 text-[13px]">
                        {d.submitted ? <CheckCircle2 className="h-4 w-4 text-emerald-500 shrink-0" /> : <div className="h-4 w-4 rounded-full border-2 border-slate-300 dark:border-zinc-700 shrink-0" />}
                        <span className={cn(d.submitted ? "text-foreground" : "text-muted-foreground")}>{d.name}</span>
                        {d.status === "emailed" && <span className="text-[10px] text-emerald-500 ml-auto">Sent to HR</span>}
                      </li>
                    ))}
                  </ul>
                </>
              )}
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
