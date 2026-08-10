import { useCallback, useEffect, useState } from "react";
import { Plus, Trash2, Loader2, HelpCircle, Power } from "lucide-react";
import { cn } from "@/lib/utils";
import { Spinner, Modal } from "@/pages/TechElevateLocalPortal";

const API = "/api/portal/techelevate";

interface TrainingOption {
  id: number;
  title: string;
  levels: { id: number; level_name: string }[];
}

interface RealMCQQuestion {
  id: number;
  training_level_id: number;
  question_text: string;
  option_a: string;
  option_b: string;
  option_c: string;
  option_d: string;
  correct_option: string;
  explanation?: string | null;
  marks: number;
  is_active: boolean;
}

const blankDraft = () => ({
  question_text: "",
  option_a: "",
  option_b: "",
  option_c: "",
  option_d: "",
  correct_option: "A",
  explanation: "",
  marks: 1,
});

export function MCQPanel({
  authHeaders,
  canManage,
}: {
  authHeaders: Record<string, string>;
  canManage: boolean;
}) {
  const [trainings, setTrainings] = useState<TrainingOption[]>([]);
  const [trainingId, setTrainingId] = useState<number | "">("");
  const [levelId, setLevelId] = useState<number | "">("");
  const [questions, setQuestions] = useState<RealMCQQuestion[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [busyId, setBusyId] = useState<number | null>(null);

  useEffect(() => {
    fetch(`${API}/trainings?limit=200`, { headers: authHeaders })
      .then((r) => r.json())
      .then((d) => setTrainings(d.items || d.results || []));
  }, [authHeaders]);

  useEffect(() => {
    const t = trainings.find((tr) => tr.id === trainingId);
    setLevelId(t?.levels?.[0]?.id || "");
  }, [trainingId, trainings]);

  const load = useCallback(() => {
    if (!levelId) {
      setQuestions([]);
      return;
    }
    setLoading(true);
    setError(null);
    fetch(`${API}/mcq-questions?training_level_id=${levelId}&limit=200`, { headers: authHeaders })
      .then(async (r) => {
        if (!r.ok) throw new Error((await r.json().catch(() => ({}))).detail || "Couldn't load questions.");
        return r.json();
      })
      .then((d) => setQuestions(d.items || d.results || []))
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false));
  }, [levelId, authHeaders]);

  useEffect(() => {
    load();
  }, [load]);

  const toggle = async (id: number) => {
    setBusyId(id);
    try {
      const resp = await fetch(`${API}/mcq-questions/${id}/toggle`, { method: "PUT", headers: authHeaders });
      if (resp.ok) load();
    } finally {
      setBusyId(null);
    }
  };

  const remove = async (id: number) => {
    setBusyId(id);
    try {
      const resp = await fetch(`${API}/mcq-questions/${id}`, { method: "DELETE", headers: authHeaders });
      if (resp.ok) load();
    } finally {
      setBusyId(null);
    }
  };

  const selectedTraining = trainings.find((t) => t.id === trainingId);

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-col sm:flex-row gap-2.5">
        <select
          className="flex-1 px-3 py-2.5 rounded-xl border border-slate-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 text-sm"
          value={trainingId}
          onChange={(e) => setTrainingId(Number(e.target.value))}
        >
          <option value="">Select a training…</option>
          {trainings.map((t) => (
            <option key={t.id} value={t.id}>
              {t.title}
            </option>
          ))}
        </select>
        {selectedTraining && selectedTraining.levels.length > 1 && (
          <select
            className="flex-1 px-3 py-2.5 rounded-xl border border-slate-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 text-sm"
            value={levelId}
            onChange={(e) => setLevelId(Number(e.target.value))}
          >
            {selectedTraining.levels.map((lv) => (
              <option key={lv.id} value={lv.id}>
                {lv.level_name}
              </option>
            ))}
          </select>
        )}
      </div>

      {!levelId ? (
        <div className="text-center py-16 text-slate-400 dark:text-zinc-500 text-xs font-semibold uppercase tracking-wider flex flex-col items-center gap-3">
          <div className="p-4 rounded-full bg-slate-100 dark:bg-zinc-800/80 border border-slate-200/50 dark:border-zinc-800/50">
            <HelpCircle className="w-8 h-8" />
          </div>
          <span>Pick a training to manage its question bank.</span>
        </div>
      ) : loading ? (
        <Spinner label="Loading questions from TechElevate…" />
      ) : error ? (
        <div className="text-center py-16 flex flex-col items-center gap-3">
          <p className="text-xs font-semibold text-slate-500 dark:text-zinc-400 max-w-sm">{error}</p>
          <button onClick={load} className="px-3 py-1.5 rounded-xl bg-slate-100 dark:bg-zinc-800 text-slate-600 dark:text-zinc-300 text-[11px] font-bold">
            Retry
          </button>
        </div>
      ) : (
        <>
          <div className="flex items-center justify-between">
            <p className="text-xs font-semibold text-slate-500 dark:text-zinc-400">
              {questions.length} question{questions.length === 1 ? "" : "s"} — live from TechElevate
            </p>
            {canManage && (
              <button
                onClick={() => setCreating(true)}
                className="inline-flex items-center gap-1.5 px-3 py-2 rounded-xl bg-gradient-to-r from-violet-600 to-indigo-600 hover:from-violet-500 hover:to-indigo-500 text-white text-xs font-bold shadow-xs transition-all"
              >
                <Plus className="w-3.5 h-3.5" /> New Question
              </button>
            )}
          </div>

          {!questions.length ? (
            <div className="text-center py-16 text-slate-400 dark:text-zinc-500 text-xs font-semibold uppercase tracking-wider">
              No questions in this level's bank yet.
            </div>
          ) : (
            <div className="flex flex-col gap-2.5">
              {questions.map((q) => (
                <div
                  key={q.id}
                  className={cn(
                    "rounded-2xl border border-slate-200/50 dark:border-zinc-800 bg-white/70 dark:bg-zinc-900/40 p-4",
                    !q.is_active && "opacity-50",
                  )}
                >
                  <div className="flex items-start justify-between gap-3">
                    <p className="text-sm font-bold text-slate-800 dark:text-zinc-200">{q.question_text}</p>
                    {canManage && (
                      <div className="flex items-center gap-1 shrink-0">
                        <button
                          onClick={() => toggle(q.id)}
                          disabled={busyId === q.id}
                          title={q.is_active ? "Deactivate" : "Activate"}
                          className="p-1.5 rounded-lg text-slate-400 hover:text-indigo-500 hover:bg-indigo-500/10 transition-colors"
                        >
                          <Power className="w-3.5 h-3.5" />
                        </button>
                        <button
                          onClick={() => remove(q.id)}
                          disabled={busyId === q.id}
                          className="p-1.5 rounded-lg text-slate-400 hover:text-rose-500 hover:bg-rose-500/10 transition-colors"
                        >
                          {busyId === q.id ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Trash2 className="w-3.5 h-3.5" />}
                        </button>
                      </div>
                    )}
                  </div>
                  <div className="grid grid-cols-2 gap-1.5 mt-2 text-xs">
                    {(["A", "B", "C", "D"] as const).map((letter) => (
                      <span
                        key={letter}
                        className={cn(
                          "px-2 py-1 rounded-lg",
                          q.correct_option === letter
                            ? "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 font-bold"
                            : "text-slate-500 dark:text-zinc-400",
                        )}
                      >
                        {letter}. {(q as any)[`option_${letter.toLowerCase()}`]}
                      </span>
                    ))}
                  </div>
                  {q.explanation && (
                    <p className="text-[11px] text-slate-400 dark:text-zinc-500 mt-2">{q.explanation}</p>
                  )}
                </div>
              ))}
            </div>
          )}
        </>
      )}

      {creating && levelId && (
        <CreateQuestionModal
          authHeaders={authHeaders}
          levelId={levelId}
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

function CreateQuestionModal({
  authHeaders,
  levelId,
  onClose,
  onCreated,
}: {
  authHeaders: Record<string, string>;
  levelId: number;
  onClose: () => void;
  onCreated: () => void;
}) {
  const [draft, setDraft] = useState(blankDraft());
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState("");

  const save = async () => {
    if (!draft.question_text.trim() || !draft.option_a.trim() || !draft.option_b.trim()) {
      setErr("Question text and at least options A/B are required.");
      return;
    }
    setSaving(true);
    setErr("");
    try {
      const resp = await fetch(`${API}/mcq-questions`, {
        method: "POST",
        headers: authHeaders,
        body: JSON.stringify({ ...draft, training_level_id: levelId }),
      });
      if (!resp.ok) {
        const body = await resp.json().catch(() => ({}));
        throw new Error(body.detail || "Failed to create question.");
      }
      onCreated();
    } catch (e: any) {
      setErr(e.message || "Failed to create question.");
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal title="New MCQ Question" onClose={onClose} wide>
      <div className="p-5 flex flex-col gap-3 overflow-y-auto">
        <textarea
          className="w-full px-3 py-2.5 rounded-xl border border-slate-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 text-sm"
          placeholder="Question text"
          rows={2}
          value={draft.question_text}
          onChange={(e) => setDraft((d) => ({ ...d, question_text: e.target.value }))}
        />
        {(["a", "b", "c", "d"] as const).map((letter) => (
          <div key={letter} className="flex items-center gap-2">
            <input
              type="radio"
              checked={draft.correct_option === letter.toUpperCase()}
              onChange={() => setDraft((d) => ({ ...d, correct_option: letter.toUpperCase() }))}
            />
            <input
              className="flex-1 px-3 py-2 rounded-xl border border-slate-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 text-sm"
              placeholder={`Option ${letter.toUpperCase()}`}
              value={(draft as any)[`option_${letter}`]}
              onChange={(e) => setDraft((d) => ({ ...d, [`option_${letter}`]: e.target.value }))}
            />
          </div>
        ))}
        <textarea
          className="w-full px-3 py-2.5 rounded-xl border border-slate-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 text-sm"
          placeholder="Explanation (optional)"
          rows={2}
          value={draft.explanation}
          onChange={(e) => setDraft((d) => ({ ...d, explanation: e.target.value }))}
        />
        <input
          type="number"
          className="w-24 px-3 py-2 rounded-xl border border-slate-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 text-sm"
          value={draft.marks}
          onChange={(e) => setDraft((d) => ({ ...d, marks: Number(e.target.value) }))}
        />

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
            {saving && <Loader2 className="w-3.5 h-3.5 animate-spin" />} Save
          </button>
        </div>
      </div>
    </Modal>
  );
}
