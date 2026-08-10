import { useCallback, useEffect, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  BookOpen,
  Plus,
  Trash2,
  X,
  Layers,
  Clock,
  Award,
  ChevronRight,
  Loader2,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { Spinner, Modal } from "@/pages/TechElevateLocalPortal";

const API = "/api/portal/techelevate";

interface RealTrainingLevel {
  id: number;
  level_name: string;
  level_order: number;
  description?: string | null;
  duration_minutes?: number | null;
  pass_percentage: number;
  max_attempts: number;
  exam_questions_count: number;
  exam_duration_minutes: number;
}

interface RealTraining {
  id: number;
  title: string;
  description?: string | null;
  category: string;
  has_levels: boolean;
  created_by: string;
  creator_name?: string | null;
  created_at: string;
  levels: RealTrainingLevel[];
}

interface DraftLevel {
  level_name: string;
  level_order: number;
  duration_minutes: number;
  pass_percentage: number;
  max_attempts: number;
  exam_questions_count: number;
  exam_duration_minutes: number;
  description: string;
}

const blankLevel = (order: number): DraftLevel => ({
  level_name: `Level ${order}`,
  level_order: order,
  duration_minutes: 60,
  pass_percentage: 60,
  max_attempts: 3,
  exam_questions_count: 10,
  exam_duration_minutes: 25,
  description: "",
});

export function TrainingsPanel({
  authHeaders,
  canManage,
}: {
  authHeaders: Record<string, string>;
  canManage: boolean;
}) {
  const [trainings, setTrainings] = useState<RealTraining[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [expanded, setExpanded] = useState<number | null>(null);
  const [deletingId, setDeletingId] = useState<number | null>(null);

  const load = useCallback(() => {
    setLoading(true);
    setError(null);
    fetch(`${API}/trainings?limit=200`, { headers: authHeaders })
      .then(async (r) => {
        if (!r.ok) {
          const body = await r.json().catch(() => ({}));
          throw new Error(body.detail || "Couldn't load trainings from TechElevate.");
        }
        return r.json();
      })
      .then((d) => setTrainings(d.items || d.results || d.trainings || (Array.isArray(d) ? d : [])))
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false));
  }, [authHeaders]);

  useEffect(() => {
    load();
  }, [load]);

  const remove = async (id: number) => {
    setDeletingId(id);
    try {
      const resp = await fetch(`${API}/trainings/${id}`, { method: "DELETE", headers: authHeaders });
      if (resp.ok) load();
    } finally {
      setDeletingId(null);
    }
  };

  if (loading) return <Spinner label="Loading trainings from TechElevate…" />;

  if (error) {
    return (
      <div className="text-center py-16 flex flex-col items-center gap-3">
        <p className="text-xs font-semibold text-slate-500 dark:text-zinc-400 max-w-sm">{error}</p>
        <button
          onClick={load}
          className="px-3 py-1.5 rounded-xl bg-slate-100 dark:bg-zinc-800 text-slate-600 dark:text-zinc-300 text-[11px] font-bold hover:bg-slate-200 dark:hover:bg-zinc-700 transition-colors"
        >
          Retry
        </button>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center justify-between">
        <p className="text-xs font-semibold text-slate-500 dark:text-zinc-400">
          {trainings.length} training{trainings.length === 1 ? "" : "s"} — live from TechElevate
        </p>
        {canManage && (
          <button
            onClick={() => setCreating(true)}
            className="inline-flex items-center gap-1.5 px-3 py-2 rounded-xl bg-gradient-to-r from-violet-600 to-indigo-600 hover:from-violet-500 hover:to-indigo-500 text-white text-xs font-bold shadow-xs transition-all"
          >
            <Plus className="w-3.5 h-3.5" /> New Training
          </button>
        )}
      </div>

      {!trainings.length ? (
        <div className="text-center py-20 text-slate-400 dark:text-zinc-500 text-xs font-semibold uppercase tracking-wider flex flex-col items-center gap-3">
          <div className="p-4 rounded-full bg-slate-100 dark:bg-zinc-800/80 border border-slate-200/50 dark:border-zinc-800/50">
            <BookOpen className="w-8 h-8" />
          </div>
          <span>No trainings in the TechElevate catalog yet.</span>
        </div>
      ) : (
        <div className="flex flex-col gap-2.5">
          {trainings.map((t) => (
            <div
              key={t.id}
              className="rounded-2xl border border-slate-200/50 dark:border-zinc-800 bg-white/70 dark:bg-zinc-900/40 overflow-hidden"
            >
              <button
                onClick={() => setExpanded(expanded === t.id ? null : t.id)}
                className="w-full flex items-center justify-between gap-4 p-4 text-left"
              >
                <div className="min-w-0">
                  <p className="text-sm font-extrabold text-slate-800 dark:text-zinc-200 truncate">{t.title}</p>
                  <div className="flex items-center gap-2.5 mt-1">
                    <span className="text-[9px] font-bold px-2 py-0.5 rounded-full uppercase tracking-wider bg-indigo-500/10 text-indigo-600 dark:text-indigo-400 border border-indigo-500/15">
                      {t.category || "Uncategorized"}
                    </span>
                    <span className="text-[10px] font-bold text-slate-400 dark:text-zinc-500 inline-flex items-center gap-1">
                      <Layers className="w-3 h-3" /> {t.levels?.length || 0} level{(t.levels?.length || 0) === 1 ? "" : "s"}
                    </span>
                  </div>
                </div>
                <div className="flex items-center gap-2 shrink-0">
                  {canManage && (
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        remove(t.id);
                      }}
                      disabled={deletingId === t.id}
                      className="p-2 rounded-lg text-slate-400 hover:text-rose-500 hover:bg-rose-500/10 transition-colors"
                    >
                      {deletingId === t.id ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Trash2 className="w-3.5 h-3.5" />}
                    </button>
                  )}
                  <ChevronRight className={cn("w-4 h-4 text-slate-400 transition-transform", expanded === t.id && "rotate-90")} />
                </div>
              </button>
              <AnimatePresence>
                {expanded === t.id && (
                  <motion.div
                    initial={{ height: 0, opacity: 0 }}
                    animate={{ height: "auto", opacity: 1 }}
                    exit={{ height: 0, opacity: 0 }}
                    className="overflow-hidden border-t border-slate-100 dark:border-zinc-800/50"
                  >
                    <div className="p-4 flex flex-col gap-2">
                      {t.description && (
                        <p className="text-xs text-slate-500 dark:text-zinc-400 mb-1">{t.description}</p>
                      )}
                      {(t.levels || []).map((lv) => (
                        <div
                          key={lv.id}
                          className="flex flex-wrap items-center gap-3 rounded-xl bg-slate-50 dark:bg-zinc-800/40 px-3 py-2 text-[11px] font-semibold text-slate-600 dark:text-zinc-300"
                        >
                          <span className="font-bold text-slate-800 dark:text-zinc-100">{lv.level_name}</span>
                          <span className="inline-flex items-center gap-1 text-slate-400 dark:text-zinc-500">
                            <Clock className="w-3 h-3" /> {lv.duration_minutes ?? "—"}m
                          </span>
                          <span className="inline-flex items-center gap-1 text-slate-400 dark:text-zinc-500">
                            <Award className="w-3 h-3" /> Pass {lv.pass_percentage}%
                          </span>
                          <span className="text-slate-400 dark:text-zinc-500">
                            {lv.exam_questions_count} Qs · {lv.exam_duration_minutes}m exam · {lv.max_attempts} attempts
                          </span>
                        </div>
                      ))}
                    </div>
                  </motion.div>
                )}
              </AnimatePresence>
            </div>
          ))}
        </div>
      )}

      {creating && (
        <CreateTrainingModal
          authHeaders={authHeaders}
          onClose={() => setCreating(false)}
          onCreated={() => {
            setCreating(false);
            load();
          }}
        />
      )}
    </div>
  );
}

function CreateTrainingModal({
  authHeaders,
  onClose,
  onCreated,
}: {
  authHeaders: Record<string, string>;
  onClose: () => void;
  onCreated: () => void;
}) {
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [category, setCategory] = useState("Technical");
  const [multiLevel, setMultiLevel] = useState(false);
  const [levels, setLevels] = useState<DraftLevel[]>([blankLevel(1)]);
  const [single, setSingle] = useState<DraftLevel>(blankLevel(1));
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState("");

  const addLevel = () => setLevels((ls) => [...ls, blankLevel(ls.length + 1)]);
  const removeLevel = (i: number) => setLevels((ls) => ls.filter((_, idx) => idx !== i));
  const patchLevel = (i: number, patch: Partial<DraftLevel>) =>
    setLevels((ls) => ls.map((l, idx) => (idx === i ? { ...l, ...patch } : l)));

  const save = async () => {
    if (!title.trim()) {
      setErr("Title is required.");
      return;
    }
    setSaving(true);
    setErr("");
    try {
      const payload: any = { title, description, category };
      if (multiLevel) {
        payload.levels = levels.map((l) => ({
          level_name: l.level_name,
          level_order: l.level_order,
          duration_minutes: l.duration_minutes,
          pass_percentage: l.pass_percentage,
          max_attempts: l.max_attempts,
          exam_questions_count: l.exam_questions_count,
          exam_duration_minutes: l.exam_duration_minutes,
          description: l.description,
        }));
      } else {
        payload.training_details = {
          duration_minutes: single.duration_minutes,
          pass_percentage: single.pass_percentage,
          max_attempts: single.max_attempts,
        };
      }
      const resp = await fetch(`${API}/trainings`, {
        method: "POST",
        headers: authHeaders,
        body: JSON.stringify(payload),
      });
      if (!resp.ok) {
        const body = await resp.json().catch(() => ({}));
        throw new Error(body.detail || "Failed to create training.");
      }
      onCreated();
    } catch (e: any) {
      setErr(e.message || "Failed to create training.");
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal title="New TechElevate Training" onClose={onClose} wide>
      <div className="p-5 flex flex-col gap-3 overflow-y-auto">
        <input
          className="w-full px-3 py-2.5 rounded-xl border border-slate-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 text-sm"
          placeholder="Title"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
        />
        <textarea
          className="w-full px-3 py-2.5 rounded-xl border border-slate-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 text-sm"
          placeholder="Description"
          rows={2}
          value={description}
          onChange={(e) => setDescription(e.target.value)}
        />
        <select
          className="w-full px-3 py-2.5 rounded-xl border border-slate-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 text-sm"
          value={category}
          onChange={(e) => setCategory(e.target.value)}
        >
          <option>Technical</option>
          <option>Governance & Compliance</option>
          <option>Business</option>
        </select>

        <label className="flex items-center gap-2 text-xs font-semibold text-slate-600 dark:text-zinc-300">
          <input type="checkbox" checked={multiLevel} onChange={(e) => setMultiLevel(e.target.checked)} />
          Multi-level training
        </label>

        {multiLevel ? (
          <div className="flex flex-col gap-2">
            {levels.map((lv, i) => (
              <div key={i} className="rounded-xl border border-slate-200 dark:border-zinc-800 p-3 flex flex-col gap-2">
                <div className="flex items-center justify-between">
                  <input
                    className="flex-1 px-2 py-1.5 rounded-lg border border-slate-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 text-xs font-bold"
                    value={lv.level_name}
                    onChange={(e) => patchLevel(i, { level_name: e.target.value })}
                  />
                  {levels.length > 1 && (
                    <button onClick={() => removeLevel(i)} className="p-1.5 text-slate-400 hover:text-rose-500">
                      <X className="w-3.5 h-3.5" />
                    </button>
                  )}
                </div>
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 text-[10px]">
                  <LabeledNum label="Duration (min)" value={lv.duration_minutes} onChange={(v) => patchLevel(i, { duration_minutes: v })} />
                  <LabeledNum label="Pass %" value={lv.pass_percentage} onChange={(v) => patchLevel(i, { pass_percentage: v })} />
                  <LabeledNum label="Max attempts" value={lv.max_attempts} onChange={(v) => patchLevel(i, { max_attempts: v })} />
                  <LabeledNum label="Exam Qs" value={lv.exam_questions_count} onChange={(v) => patchLevel(i, { exam_questions_count: v })} />
                </div>
              </div>
            ))}
            <button
              onClick={addLevel}
              className="self-start inline-flex items-center gap-1 text-[11px] font-bold text-indigo-600 dark:text-indigo-400"
            >
              <Plus className="w-3 h-3" /> Add level
            </button>
          </div>
        ) : (
          <div className="grid grid-cols-3 gap-2 text-[10px]">
            <LabeledNum label="Duration (min)" value={single.duration_minutes} onChange={(v) => setSingle((s) => ({ ...s, duration_minutes: v }))} />
            <LabeledNum label="Pass %" value={single.pass_percentage} onChange={(v) => setSingle((s) => ({ ...s, pass_percentage: v }))} />
            <LabeledNum label="Max attempts" value={single.max_attempts} onChange={(v) => setSingle((s) => ({ ...s, max_attempts: v }))} />
          </div>
        )}

        {err && <p className="text-[11px] font-semibold text-rose-500">{err}</p>}

        <div className="flex justify-end gap-2 pt-2">
          <button onClick={onClose} className="px-4 py-2 text-xs font-bold rounded-xl text-slate-500 dark:text-zinc-400">
            Cancel
          </button>
          <button
            onClick={save}
            disabled={saving}
            className="px-4 py-2 text-xs font-bold rounded-xl bg-gradient-to-r from-violet-600 to-indigo-600 text-white inline-flex items-center gap-1.5 disabled:opacity-50"
          >
            {saving && <Loader2 className="w-3.5 h-3.5 animate-spin" />} Create
          </button>
        </div>
      </div>
    </Modal>
  );
}

function LabeledNum({
  label,
  value,
  onChange,
}: {
  label: string;
  value: number;
  onChange: (v: number) => void;
}) {
  return (
    <label className="flex flex-col gap-1">
      <span className="font-bold uppercase tracking-wide text-slate-400 dark:text-zinc-500">{label}</span>
      <input
        type="number"
        className="px-2 py-1.5 rounded-lg border border-slate-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 text-xs"
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
      />
    </label>
  );
}
