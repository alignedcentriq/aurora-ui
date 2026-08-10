import { useCallback, useEffect, useState } from "react";
import { Plus, Trash2, Loader2, Users, UserCircle, Search, BookOpen } from "lucide-react";
import { Spinner, Modal } from "@/pages/TechElevateLocalPortal";

const API = "/api/portal/techelevate";

interface RealGroup {
  id: number;
  group_id: number;
  name: string;
  project_name: string;
  description?: string | null;
  member_count: number;
  created_by: string;
  creator_name?: string | null;
}

interface UserOption {
  email: string;
  first_name?: string;
  last_name?: string;
}

export function GroupsPanel({ authHeaders }: { authHeaders: Record<string, string> }) {
  const [groups, setGroups] = useState<RealGroup[]>([]);
  const [stats, setStats] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [assigningGroup, setAssigningGroup] = useState<RealGroup | null>(null);
  const [busyId, setBusyId] = useState<number | null>(null);

  const load = useCallback(() => {
    setLoading(true);
    setError(null);
    Promise.all([
      fetch(`${API}/employee-groups?limit=200`, { headers: authHeaders }).then(async (r) => {
        if (!r.ok) throw new Error((await r.json().catch(() => ({}))).detail || "Couldn't load groups.");
        return r.json();
      }),
      fetch(`${API}/employee-groups/stats`, { headers: authHeaders }).then((r) => (r.ok ? r.json() : null)),
    ])
      .then(([g, s]) => {
        setGroups(g.items || g.results || []);
        setStats(s);
      })
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false));
  }, [authHeaders]);

  useEffect(() => {
    load();
  }, [load]);

  const remove = async (id: number) => {
    setBusyId(id);
    try {
      const resp = await fetch(`${API}/employee-groups/${id}`, { method: "DELETE", headers: authHeaders });
      if (resp.ok) load();
    } finally {
      setBusyId(null);
    }
  };

  if (loading) return <Spinner label="Loading groups from TechElevate…" />;

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
        <div className="grid grid-cols-2 gap-2.5">
          <div className="rounded-2xl border border-slate-200/50 dark:border-zinc-800 bg-white/70 dark:bg-zinc-900/40 p-3">
            <p className="text-[9px] font-bold uppercase tracking-wider text-slate-400 dark:text-zinc-500">Total Groups</p>
            <p className="text-lg font-extrabold text-slate-800 dark:text-zinc-100">{stats.total_groups ?? groups.length}</p>
          </div>
          <div className="rounded-2xl border border-slate-200/50 dark:border-zinc-800 bg-white/70 dark:bg-zinc-900/40 p-3">
            <p className="text-[9px] font-bold uppercase tracking-wider text-slate-400 dark:text-zinc-500">Unique Members</p>
            <p className="text-lg font-extrabold text-slate-800 dark:text-zinc-100">{stats.unique_employees ?? "—"}</p>
          </div>
        </div>
      )}

      <div className="flex items-center justify-between">
        <p className="text-xs font-semibold text-slate-500 dark:text-zinc-400">
          {groups.length} group{groups.length === 1 ? "" : "s"} — live from TechElevate
        </p>
        <button
          onClick={() => setCreating(true)}
          className="inline-flex items-center gap-1.5 px-3 py-2 rounded-xl bg-gradient-to-r from-violet-600 to-indigo-600 hover:from-violet-500 hover:to-indigo-500 text-white text-xs font-bold shadow-xs transition-all"
        >
          <Plus className="w-3.5 h-3.5" /> New Group
        </button>
      </div>

      {!groups.length ? (
        <div className="text-center py-20 text-slate-400 dark:text-zinc-500 text-xs font-semibold uppercase tracking-wider flex flex-col items-center gap-3">
          <div className="p-4 rounded-full bg-slate-100 dark:bg-zinc-800/80 border border-slate-200/50 dark:border-zinc-800/50">
            <Users className="w-8 h-8" />
          </div>
          <span>No employee groups yet.</span>
        </div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
          {groups.map((g) => (
            <div
              key={g.id}
              className="rounded-2xl border border-slate-200/50 dark:border-zinc-800 bg-white/70 dark:bg-zinc-900/40 p-4 flex flex-col gap-2"
            >
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <p className="text-sm font-extrabold text-slate-800 dark:text-zinc-200 truncate">{g.name}</p>
                  <p className="text-[10px] font-bold text-slate-400 dark:text-zinc-500 uppercase tracking-wider">
                    {g.project_name}
                  </p>
                </div>
                <button
                  onClick={() => remove(g.id)}
                  disabled={busyId === g.id}
                  className="p-1.5 rounded-lg text-slate-400 hover:text-rose-500 hover:bg-rose-500/10 transition-colors shrink-0"
                >
                  {busyId === g.id ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Trash2 className="w-3.5 h-3.5" />}
                </button>
              </div>
              {g.description && <p className="text-xs text-slate-500 dark:text-zinc-400">{g.description}</p>}
              <div className="flex items-center justify-between mt-1">
                <span className="text-[10px] font-bold text-slate-400 dark:text-zinc-500 inline-flex items-center gap-1">
                  <UserCircle className="w-3.5 h-3.5" /> {g.member_count} member{g.member_count === 1 ? "" : "s"}
                </span>
                <button
                  onClick={() => setAssigningGroup(g)}
                  className="inline-flex items-center gap-1 text-[11px] font-bold text-indigo-600 dark:text-indigo-400"
                >
                  <BookOpen className="w-3 h-3" /> Assign Training
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      {creating && (
        <CreateGroupModal
          authHeaders={authHeaders}
          onClose={() => setCreating(false)}
          onCreated={() => {
            setCreating(false);
            load();
          }}
        />
      )}
      {assigningGroup && (
        <AssignGroupTrainingModal
          authHeaders={authHeaders}
          group={assigningGroup}
          onClose={() => setAssigningGroup(null)}
        />
      )}
    </div>
  );
}

function CreateGroupModal({
  authHeaders,
  onClose,
  onCreated,
}: {
  authHeaders: Record<string, string>;
  onClose: () => void;
  onCreated: () => void;
}) {
  const [name, setName] = useState("");
  const [projectName, setProjectName] = useState("");
  const [description, setDescription] = useState("");
  const [search, setSearch] = useState("");
  const [options, setOptions] = useState<UserOption[]>([]);
  const [selected, setSelected] = useState<UserOption[]>([]);
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState("");

  useEffect(() => {
    if (!search.trim()) {
      setOptions([]);
      return;
    }
    const handle = setTimeout(() => {
      fetch(`${API}/users?search=${encodeURIComponent(search)}&limit=10`, { headers: authHeaders })
        .then((r) => (r.ok ? r.json() : { items: [] }))
        .then((d) => setOptions(d.items || []))
        .catch(() => setOptions([]));
    }, 300);
    return () => clearTimeout(handle);
  }, [search, authHeaders]);

  const toggle = (u: UserOption) =>
    setSelected((s) => (s.find((x) => x.email === u.email) ? s.filter((x) => x.email !== u.email) : [...s, u]));

  const save = async () => {
    if (!name.trim() || !projectName.trim()) {
      setErr("Name and project name are required.");
      return;
    }
    setSaving(true);
    setErr("");
    try {
      const resp = await fetch(`${API}/employee-groups`, {
        method: "POST",
        headers: authHeaders,
        body: JSON.stringify({
          name,
          project_name: projectName,
          description,
          employee_ids: selected.map((s) => s.email),
        }),
      });
      if (!resp.ok) {
        const body = await resp.json().catch(() => ({}));
        throw new Error(body.detail || "Failed to create group.");
      }
      onCreated();
    } catch (e: any) {
      setErr(e.message || "Failed to create group.");
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal title="New Employee Group" onClose={onClose}>
      <div className="p-5 flex flex-col gap-3">
        <input
          className="w-full px-3 py-2.5 rounded-xl border border-slate-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 text-sm"
          placeholder="Group name"
          value={name}
          onChange={(e) => setName(e.target.value)}
        />
        <input
          className="w-full px-3 py-2.5 rounded-xl border border-slate-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 text-sm"
          placeholder="Project name"
          value={projectName}
          onChange={(e) => setProjectName(e.target.value)}
        />
        <textarea
          className="w-full px-3 py-2.5 rounded-xl border border-slate-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 text-sm"
          placeholder="Description"
          rows={2}
          value={description}
          onChange={(e) => setDescription(e.target.value)}
        />

        {selected.length > 0 && (
          <div className="flex flex-wrap gap-1.5">
            {selected.map((u) => (
              <span
                key={u.email}
                onClick={() => toggle(u)}
                className="cursor-pointer text-[10px] font-bold px-2 py-1 rounded-full bg-indigo-500/10 text-indigo-600 dark:text-indigo-400 border border-indigo-500/15"
              >
                {u.first_name || u.email} ×
              </span>
            ))}
          </div>
        )}

        <div className="relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-slate-400" />
          <input
            className="w-full pl-9 pr-3 py-2.5 rounded-xl border border-slate-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 text-sm"
            placeholder="Search employees to add…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>
        {options.length > 0 && (
          <div className="rounded-xl border border-slate-200 dark:border-zinc-800 overflow-hidden max-h-40 overflow-y-auto">
            {options.map((u) => (
              <button
                key={u.email}
                onClick={() => toggle(u)}
                className="w-full text-left px-3 py-2 text-xs hover:bg-slate-100 dark:hover:bg-zinc-800"
              >
                {u.first_name} {u.last_name} <span className="text-slate-400">· {u.email}</span>
              </button>
            ))}
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

function AssignGroupTrainingModal({
  authHeaders,
  group,
  onClose,
}: {
  authHeaders: Record<string, string>;
  group: RealGroup;
  onClose: () => void;
}) {
  const [trainings, setTrainings] = useState<{ id: number; title: string }[]>([]);
  const [trainingId, setTrainingId] = useState<number | "">("");
  const [saving, setSaving] = useState(false);
  const [result, setResult] = useState<string | null>(null);
  const [err, setErr] = useState("");

  useEffect(() => {
    fetch(`${API}/trainings?limit=200`, { headers: authHeaders })
      .then((r) => r.json())
      .then((d) => setTrainings(d.items || d.results || []));
  }, [authHeaders]);

  const assign = async () => {
    if (!trainingId) {
      setErr("Pick a training.");
      return;
    }
    setSaving(true);
    setErr("");
    try {
      const resp = await fetch(`${API}/group-trainings/assign`, {
        method: "POST",
        headers: authHeaders,
        body: JSON.stringify({ group_id: group.id, training_id: trainingId }),
      });
      const body = await resp.json().catch(() => ({}));
      if (!resp.ok) throw new Error(body.detail || "Failed to assign training.");
      setResult(`Assigned to ${body.assigned_count ?? group.member_count} member(s).`);
    } catch (e: any) {
      setErr(e.message || "Failed to assign training.");
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal title={`Assign Training · ${group.name}`} onClose={onClose}>
      <div className="p-5 flex flex-col gap-3">
        {result ? (
          <p className="text-sm font-semibold text-emerald-600 dark:text-emerald-400">{result}</p>
        ) : (
          <>
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
            {err && <p className="text-[11px] font-semibold text-rose-500">{err}</p>}
          </>
        )}
        <div className="flex justify-end gap-2 pt-2">
          <button onClick={onClose} className="px-4 py-2 text-xs font-bold rounded-xl text-slate-500 dark:text-zinc-400">
            {result ? "Close" : "Cancel"}
          </button>
          {!result && (
            <button
              onClick={assign}
              disabled={saving}
              className="px-4 py-2 text-xs font-bold rounded-xl bg-gradient-to-r from-violet-600 to-indigo-600 text-white inline-flex items-center gap-1.5 disabled:opacity-50"
            >
              {saving && <Loader2 className="w-3.5 h-3.5 animate-spin" />} Assign
            </button>
          )}
        </div>
      </div>
    </Modal>
  );
}
