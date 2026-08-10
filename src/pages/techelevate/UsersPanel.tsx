import { useCallback, useEffect, useState } from "react";
import { Search, Power, Loader2, Trash2, Plus, ShieldCheck } from "lucide-react";
import { cn } from "@/lib/utils";
import { Spinner, Modal } from "@/pages/TechElevateLocalPortal";
import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell } from "@/components/ui/table";

const API = "/api/portal/techelevate";

interface RealUser {
  email: string;
  first_name: string;
  last_name: string;
  department: string;
  designation?: string | null;
  role: string;
  is_active: boolean;
}

interface RoleMapping {
  id: number;
  email: string;
  role: string;
  updated_at: string;
}

export function UsersPanel({ authHeaders }: { authHeaders: Record<string, string> }) {
  const [users, setUsers] = useState<RealUser[]>([]);
  const [stats, setStats] = useState<any>(null);
  const [search, setSearch] = useState("");
  const [mappings, setMappings] = useState<RoleMapping[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [addingMapping, setAddingMapping] = useState(false);

  const load = useCallback(() => {
    setLoading(true);
    setError(null);
    Promise.all([
      fetch(`${API}/users?limit=50${search ? `&search=${encodeURIComponent(search)}` : ""}`, { headers: authHeaders }).then(
        async (r) => {
          if (!r.ok) throw new Error((await r.json().catch(() => ({}))).detail || "Couldn't load users.");
          return r.json();
        },
      ),
      fetch(`${API}/users/stats`, { headers: authHeaders }).then((r) => (r.ok ? r.json() : null)),
      fetch(`${API}/role-mappings`, { headers: authHeaders }).then((r) => (r.ok ? r.json() : [])),
    ])
      .then(([u, s, rm]) => {
        setUsers(u.items || u.results || []);
        setStats(s);
        setMappings(Array.isArray(rm) ? rm : []);
      })
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false));
  }, [authHeaders, search]);

  useEffect(() => {
    const handle = setTimeout(load, 300);
    return () => clearTimeout(handle);
  }, [load]);

  const toggleActive = async (email: string) => {
    setBusy(email);
    try {
      const resp = await fetch(`${API}/users/${encodeURIComponent(email)}/toggle-active`, {
        method: "PUT",
        headers: authHeaders,
      });
      if (resp.ok) load();
    } finally {
      setBusy(null);
    }
  };

  const removeMapping = async (id: number) => {
    setBusy(`mapping-${id}`);
    try {
      const resp = await fetch(`${API}/role-mappings/${id}`, { method: "DELETE", headers: authHeaders });
      if (resp.ok) load();
    } finally {
      setBusy(null);
    }
  };

  if (loading && !users.length) return <Spinner label="Loading users from TechElevate…" />;

  if (error) {
    return (
      <div className="text-center py-16 flex flex-col items-center gap-3">
        <p className="text-xs font-semibold text-slate-500 dark:text-zinc-400 max-w-sm">{error}</p>
        <button onClick={load} className="px-3 py-1.5 rounded-xl bg-slate-100 dark:bg-zinc-800 text-slate-600 dark:text-zinc-300 text-[11px] font-bold">
          Retry
        </button>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-6">
      {stats && (
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5">
          {[
            ["Total Users", stats.total_users],
            ["Active", stats.active_users],
            ["Inactive", stats.inactive_users],
            ["Departments", stats.total_departments],
          ].map(([label, value]) => (
            <div key={label as string} className="rounded-2xl border border-slate-200/50 dark:border-zinc-800 bg-white/70 dark:bg-zinc-900/40 p-3">
              <p className="text-[9px] font-bold uppercase tracking-wider text-slate-400 dark:text-zinc-500">{label}</p>
              <p className="text-lg font-extrabold text-slate-800 dark:text-zinc-100">{value}</p>
            </div>
          ))}
        </div>
      )}

      <div className="flex flex-col gap-2.5">
        <div className="relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-slate-400" />
          <input
            className="w-full pl-9 pr-3 py-2.5 rounded-xl border border-slate-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 text-sm"
            placeholder="Search users by name, email, department…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>
        <div className="rounded-2xl border border-slate-200/50 dark:border-zinc-800 overflow-hidden">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Name</TableHead>
                <TableHead>Department</TableHead>
                <TableHead>Role</TableHead>
                <TableHead>Status</TableHead>
                <TableHead />
              </TableRow>
            </TableHeader>
            <TableBody>
              {users.map((u) => (
                <TableRow key={u.email}>
                  <TableCell>
                    <p className="font-semibold">{u.first_name} {u.last_name}</p>
                    <p className="text-[10px] text-slate-400 dark:text-zinc-500">{u.email}</p>
                  </TableCell>
                  <TableCell className="text-slate-500 dark:text-zinc-400">{u.department}</TableCell>
                  <TableCell>
                    <span className="text-[9px] font-bold px-2 py-0.5 rounded-full uppercase tracking-wider bg-indigo-500/10 text-indigo-600 dark:text-indigo-400 border border-indigo-500/15">
                      {u.role}
                    </span>
                  </TableCell>
                  <TableCell>
                    <span
                      className={cn(
                        "text-[9px] font-bold px-2 py-0.5 rounded-full uppercase tracking-wider",
                        u.is_active
                          ? "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border border-emerald-500/20"
                          : "bg-slate-500/10 text-slate-500 border border-slate-500/20",
                      )}
                    >
                      {u.is_active ? "Active" : "Inactive"}
                    </span>
                  </TableCell>
                  <TableCell>
                    <button
                      onClick={() => toggleActive(u.email)}
                      disabled={busy === u.email}
                      className="p-1.5 rounded-lg text-slate-400 hover:text-indigo-500 hover:bg-indigo-500/10 transition-colors"
                    >
                      {busy === u.email ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Power className="w-3.5 h-3.5" />}
                    </button>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      </div>

      <div className="flex flex-col gap-2.5">
        <div className="flex items-center justify-between">
          <h4 className="text-[10px] font-extrabold uppercase tracking-wider text-slate-400 dark:text-zinc-500 inline-flex items-center gap-1.5">
            <ShieldCheck className="w-3.5 h-3.5" /> Role Mappings
          </h4>
          <button
            onClick={() => setAddingMapping(true)}
            className="inline-flex items-center gap-1 text-[11px] font-bold text-indigo-600 dark:text-indigo-400"
          >
            <Plus className="w-3 h-3" /> Add
          </button>
        </div>
        {!mappings.length ? (
          <p className="text-xs text-slate-400 dark:text-zinc-500 italic">No explicit role mappings.</p>
        ) : (
          <div className="rounded-2xl border border-slate-200/50 dark:border-zinc-800 divide-y divide-slate-100 dark:divide-zinc-800/60 overflow-hidden">
            {mappings.map((m) => (
              <div key={m.id} className="flex items-center justify-between gap-3 px-4 py-2.5 bg-white/70 dark:bg-zinc-900/40">
                <span className="text-xs font-semibold text-slate-700 dark:text-zinc-300">{m.email}</span>
                <div className="flex items-center gap-2">
                  <span className="text-[9px] font-bold px-2 py-0.5 rounded-full uppercase tracking-wider bg-indigo-500/10 text-indigo-600 dark:text-indigo-400 border border-indigo-500/15">
                    {m.role}
                  </span>
                  <button
                    onClick={() => removeMapping(m.id)}
                    disabled={busy === `mapping-${m.id}`}
                    className="p-1.5 rounded-lg text-slate-400 hover:text-rose-500 hover:bg-rose-500/10 transition-colors"
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {addingMapping && (
        <AddRoleMappingModal
          authHeaders={authHeaders}
          onClose={() => setAddingMapping(false)}
          onCreated={() => {
            setAddingMapping(false);
            load();
          }}
        />
      )}
    </div>
  );
}

function AddRoleMappingModal({
  authHeaders,
  onClose,
  onCreated,
}: {
  authHeaders: Record<string, string>;
  onClose: () => void;
  onCreated: () => void;
}) {
  const [email, setEmail] = useState("");
  const [role, setRole] = useState("employee");
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState("");

  const save = async () => {
    if (!email.trim()) {
      setErr("Email is required.");
      return;
    }
    setSaving(true);
    setErr("");
    try {
      const resp = await fetch(`${API}/role-mappings`, {
        method: "POST",
        headers: authHeaders,
        body: JSON.stringify({ email, role }),
      });
      if (!resp.ok) {
        const body = await resp.json().catch(() => ({}));
        throw new Error(body.detail || "Failed to create role mapping.");
      }
      onCreated();
    } catch (e: any) {
      setErr(e.message || "Failed to create role mapping.");
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal title="New Role Mapping" onClose={onClose}>
      <div className="p-5 flex flex-col gap-3">
        <input
          className="w-full px-3 py-2.5 rounded-xl border border-slate-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 text-sm"
          placeholder="Email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
        />
        <select
          className="w-full px-3 py-2.5 rounded-xl border border-slate-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 text-sm"
          value={role}
          onChange={(e) => setRole(e.target.value)}
        >
          <option value="employee">Employee</option>
          <option value="instructor">Instructor</option>
          <option value="admin">Admin</option>
        </select>
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
