import { useCallback, useEffect, useState } from "react";
import { Plus, Trash2, Loader2, ClipboardList, Search } from "lucide-react";
import { cn } from "@/lib/utils";
import { Spinner, Modal } from "@/pages/TechElevateLocalPortal";
import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell } from "@/components/ui/table";

const API = "/api/portal/techelevate";

interface RealAssignmentRow {
  id: number;
  user_id: string;
  user_name?: string | null;
  training_id: number;
  training_title?: string | null;
  current_level_id: number;
  current_level_name?: string | null;
  status: string;
  training_start_date?: string | null;
  training_end_date?: string | null;
}

interface TrainingOption {
  id: number;
  title: string;
  levels: { id: number; level_name: string }[];
}

const STATUS_OPTIONS = ["assigned", "in_progress", "completed", "failed"];

const STATUS_STYLES: Record<string, string> = {
  completed: "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border border-emerald-500/20",
  in_progress: "bg-amber-500/10 text-amber-600 dark:text-amber-400 border border-amber-500/20",
  assigned: "bg-slate-500/10 text-slate-500 dark:text-zinc-400 border border-slate-500/20",
  failed: "bg-rose-500/10 text-rose-600 dark:text-rose-400 border border-rose-500/20",
};

export function AssignmentsPanel({
  authHeaders,
  canManage,
}: {
  authHeaders: Record<string, string>;
  canManage: boolean;
}) {
  const [rows, setRows] = useState<RealAssignmentRow[]>([]);
  const [stats, setStats] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [busyId, setBusyId] = useState<number | null>(null);

  const load = useCallback(() => {
    setLoading(true);
    setError(null);
    Promise.all([
      fetch(`${API}/assignments?limit=200`, { headers: authHeaders }).then(async (r) => {
        if (!r.ok) throw new Error((await r.json().catch(() => ({}))).detail || "Couldn't load assignments.");
        return r.json();
      }),
      canManage
        ? fetch(`${API}/assignments/stats`, { headers: authHeaders }).then((r) => (r.ok ? r.json() : null))
        : Promise.resolve(null),
    ])
      .then(([list, s]) => {
        setRows(list.items || list.results || []);
        setStats(s);
      })
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false));
  }, [authHeaders, canManage]);

  useEffect(() => {
    load();
  }, [load]);

  const setStatus = async (id: number, status: string) => {
    setBusyId(id);
    try {
      const resp = await fetch(`${API}/assignments/${id}`, {
        method: "PUT",
        headers: authHeaders,
        body: JSON.stringify({ status }),
      });
      if (resp.ok) load();
    } finally {
      setBusyId(null);
    }
  };

  const remove = async (id: number) => {
    setBusyId(id);
    try {
      const resp = await fetch(`${API}/assignments/${id}`, { method: "DELETE", headers: authHeaders });
      if (resp.ok) load();
    } finally {
      setBusyId(null);
    }
  };

  if (loading) return <Spinner label="Loading assignments from TechElevate…" />;

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
      {stats && (
        <div className="grid grid-cols-2 sm:grid-cols-5 gap-2.5">
          {[
            ["Total", stats.total],
            ["Completed", stats.completed],
            ["In Progress", stats.in_progress],
            ["Pending", stats.pending],
            ["Avg Score", `${stats.average_score ?? 0}%`],
          ].map(([label, value]) => (
            <div
              key={label as string}
              className="rounded-2xl border border-slate-200/50 dark:border-zinc-800 bg-white/70 dark:bg-zinc-900/40 p-3"
            >
              <p className="text-[9px] font-bold uppercase tracking-wider text-slate-400 dark:text-zinc-500">{label}</p>
              <p className="text-lg font-extrabold text-slate-800 dark:text-zinc-100">{value}</p>
            </div>
          ))}
        </div>
      )}

      <div className="flex items-center justify-between">
        <p className="text-xs font-semibold text-slate-500 dark:text-zinc-400">
          {rows.length} assignment{rows.length === 1 ? "" : "s"} — live from TechElevate
        </p>
        {canManage && (
          <button
            onClick={() => setCreating(true)}
            className="inline-flex items-center gap-1.5 px-3 py-2 rounded-xl bg-gradient-to-r from-violet-600 to-indigo-600 hover:from-violet-500 hover:to-indigo-500 text-white text-xs font-bold shadow-xs transition-all"
          >
            <Plus className="w-3.5 h-3.5" /> Assign Training
          </button>
        )}
      </div>

      {!rows.length ? (
        <div className="text-center py-20 text-slate-400 dark:text-zinc-500 text-xs font-semibold uppercase tracking-wider flex flex-col items-center gap-3">
          <div className="p-4 rounded-full bg-slate-100 dark:bg-zinc-800/80 border border-slate-200/50 dark:border-zinc-800/50">
            <ClipboardList className="w-8 h-8" />
          </div>
          <span>No assignments yet.</span>
        </div>
      ) : (
        <div className="rounded-2xl border border-slate-200/50 dark:border-zinc-800 overflow-hidden">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Employee</TableHead>
                <TableHead>Training</TableHead>
                <TableHead>Level</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Due</TableHead>
                {canManage && <TableHead />}
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((a) => (
                <TableRow key={a.id}>
                  <TableCell className="font-semibold">{a.user_name || a.user_id}</TableCell>
                  <TableCell>{a.training_title || `#${a.training_id}`}</TableCell>
                  <TableCell className="text-slate-500 dark:text-zinc-400">{a.current_level_name || "—"}</TableCell>
                  <TableCell>
                    {canManage ? (
                      <select
                        value={a.status}
                        disabled={busyId === a.id}
                        onChange={(e) => setStatus(a.id, e.target.value)}
                        className={cn(
                          "text-[10px] font-bold px-2 py-1 rounded-full uppercase tracking-wider border cursor-pointer",
                          STATUS_STYLES[a.status] || "bg-muted",
                        )}
                      >
                        {STATUS_OPTIONS.map((s) => (
                          <option key={s} value={s}>
                            {s.replace("_", " ")}
                          </option>
                        ))}
                      </select>
                    ) : (
                      <span
                        className={cn(
                          "text-[9px] font-bold px-2 py-0.5 rounded-full uppercase tracking-wider",
                          STATUS_STYLES[a.status] || "bg-muted",
                        )}
                      >
                        {a.status.replace("_", " ")}
                      </span>
                    )}
                  </TableCell>
                  <TableCell className="text-slate-400 dark:text-zinc-500 text-xs">
                    {a.training_end_date ? new Date(a.training_end_date).toLocaleDateString() : "—"}
                  </TableCell>
                  {canManage && (
                    <TableCell>
                      <button
                        onClick={() => remove(a.id)}
                        disabled={busyId === a.id}
                        className="p-1.5 rounded-lg text-slate-400 hover:text-rose-500 hover:bg-rose-500/10 transition-colors"
                      >
                        {busyId === a.id ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Trash2 className="w-3.5 h-3.5" />}
                      </button>
                    </TableCell>
                  )}
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}

      {creating && (
        <CreateAssignmentModal
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

function CreateAssignmentModal({
  authHeaders,
  onClose,
  onCreated,
}: {
  authHeaders: Record<string, string>;
  onClose: () => void;
  onCreated: () => void;
}) {
  const [trainings, setTrainings] = useState<TrainingOption[]>([]);
  const [trainingId, setTrainingId] = useState<number | "">("");
  const [levelId, setLevelId] = useState<number | "">("");
  const [userSearch, setUserSearch] = useState("");
  const [userOptions, setUserOptions] = useState<{ email: string; first_name?: string; last_name?: string }[]>([]);
  const [userId, setUserId] = useState("");
  const [dueDate, setDueDate] = useState("");
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState("");

  useEffect(() => {
    fetch(`${API}/trainings?limit=200`, { headers: authHeaders })
      .then((r) => r.json())
      .then((d) => setTrainings(d.items || d.results || []));
  }, [authHeaders]);

  useEffect(() => {
    const t = trainings.find((tr) => tr.id === trainingId);
    setLevelId(t?.levels?.[0]?.id || "");
  }, [trainingId, trainings]);

  useEffect(() => {
    if (!userSearch.trim()) {
      setUserOptions([]);
      return;
    }
    const handle = setTimeout(() => {
      fetch(`${API}/users?search=${encodeURIComponent(userSearch)}&limit=10`, { headers: authHeaders })
        .then((r) => (r.ok ? r.json() : { items: [] }))
        .then((d) => setUserOptions(d.items || []))
        .catch(() => setUserOptions([]));
    }, 300);
    return () => clearTimeout(handle);
  }, [userSearch, authHeaders]);

  const save = async () => {
    if (!trainingId || !levelId || !userId) {
      setErr("Pick a training and an employee.");
      return;
    }
    setSaving(true);
    setErr("");
    try {
      const resp = await fetch(`${API}/assignments`, {
        method: "POST",
        headers: authHeaders,
        body: JSON.stringify({
          training_id: trainingId,
          current_level_id: levelId,
          user_id: userId,
          training_end_date: dueDate || undefined,
        }),
      });
      if (!resp.ok) {
        const body = await resp.json().catch(() => ({}));
        throw new Error(body.detail || "Failed to assign training.");
      }
      onCreated();
    } catch (e: any) {
      setErr(e.message || "Failed to assign training.");
    } finally {
      setSaving(false);
    }
  };

  const selectedTraining = trainings.find((t) => t.id === trainingId);

  return (
    <Modal title="Assign Training" onClose={onClose}>
      <div className="p-5 flex flex-col gap-3">
        <select
          className="w-full px-3 py-2.5 rounded-xl border border-slate-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 text-sm"
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
            className="w-full px-3 py-2.5 rounded-xl border border-slate-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 text-sm"
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

        <div className="relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-slate-400" />
          <input
            className="w-full pl-9 pr-3 py-2.5 rounded-xl border border-slate-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 text-sm"
            placeholder="Search employee by name or email…"
            value={userId || userSearch}
            onChange={(e) => {
              setUserId("");
              setUserSearch(e.target.value);
            }}
          />
        </div>
        {userOptions.length > 0 && !userId && (
          <div className="rounded-xl border border-slate-200 dark:border-zinc-800 overflow-hidden max-h-40 overflow-y-auto">
            {userOptions.map((u) => (
              <button
                key={u.email}
                onClick={() => {
                  setUserId(u.email);
                  setUserSearch(`${u.first_name || ""} ${u.last_name || ""}`.trim() || u.email);
                  setUserOptions([]);
                }}
                className="w-full text-left px-3 py-2 text-xs hover:bg-slate-100 dark:hover:bg-zinc-800"
              >
                {u.first_name} {u.last_name} <span className="text-slate-400">· {u.email}</span>
              </button>
            ))}
          </div>
        )}

        <input
          type="date"
          className="w-full px-3 py-2.5 rounded-xl border border-slate-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 text-sm"
          value={dueDate}
          onChange={(e) => setDueDate(e.target.value)}
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
            {saving && <Loader2 className="w-3.5 h-3.5 animate-spin" />} Assign
          </button>
        </div>
      </div>
    </Modal>
  );
}
