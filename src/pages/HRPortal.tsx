import { useAuth } from "@/lib/auth-store";
import { useState, useEffect, useCallback } from "react";
import {
  X,
  Clock,
  Loader2,
  RefreshCw,
  Gift,
  Settings2,
  Plus,
  Pencil,
  Trash2,
  Send,
  RotateCcw,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { toast } from "sonner";

// ── Types ─────────────────────────────────────────────────────────────────────

type PortalTab = "welcome-logs" | "welcome-config";

interface WelcomeLog {
  id: number;
  employee_name: string;
  employee_email: string;
  status: "pending_hr" | "welcome_sent" | "skipped";
  created_at: string;
  acted_at: string | null;
  acted_by: string | null;
}

interface WelcomeResource {
  id: number;
  name: string;
  url: string | null;
  description: string | null;
  category: string | null;
  icon: string | null;
  is_active: boolean;
  sort_order: number;
}

// ── Constants ────────────────────────────────────────────────────────────────

const WELCOME_STATUS_BADGE: Record<string, string> = {
  pending_hr: "bg-amber-500/15 text-amber-400 border border-amber-500/20",
  welcome_sent: "bg-emerald-500/15 text-emerald-400 border border-emerald-500/20",
  skipped: "bg-zinc-500/15 text-zinc-400 border border-zinc-500/20",
};

const WELCOME_STATUS_LABEL: Record<string, string> = {
  pending_hr: "Pending HR",
  welcome_sent: "Sent",
  skipped: "Skipped",
};

const CATEGORY_OPTIONS = ["App Guide", "HR", "Policy", "IT", "Admin", "Facilities", "General"];

// ── Main component ────────────────────────────────────────────────────────────

export function HRPortal() {
  const { user } = useAuth();
  const [tab, setTab] = useState<PortalTab>("welcome-logs");

  const authHeaders = {
    "Content-Type": "application/json",
    ...(user?.email ? { "x-user-email": user.email } : {}),
    ...(user?.role ? { "x-user-role": user.role.toLowerCase() } : {}),
  };

  if (user?.role !== "HR" && user?.role !== "Admin") {
    return (
      <div className="flex h-full items-center justify-center text-muted-foreground">
        Access restricted to HR team.
      </div>
    );
  }

  const TABS: { id: PortalTab; label: string; icon: React.ElementType }[] = [
    { id: "welcome-logs", label: "Welcome Logs", icon: Gift },
    { id: "welcome-config", label: "Welcome Resources", icon: Settings2 },
  ];

  return (
    <div className="flex flex-col h-full overflow-hidden">
      {/* Header */}
      <div className="flex items-center justify-between px-8 py-6 border-b border-[var(--border)] shrink-0">
        <div>
          <h1 className="text-[20px] font-semibold text-foreground">HR Portal</h1>
          <p className="text-[13px] text-muted-foreground mt-0.5">
            Manage leave requests and new employee onboarding
          </p>
        </div>
      </div>

      {/* Top tabs */}
      <div className="flex gap-1 px-8 pt-4 pb-0 border-b border-[var(--border)] shrink-0">
        {TABS.map(({ id, label, icon: Icon }) => (
          <button
            key={id}
            onClick={() => setTab(id)}
            className={cn(
              "flex items-center gap-1.5 px-4 py-2 text-[13px] font-medium rounded-t-lg border-b-2 transition-colors -mb-px",
              tab === id
                ? "border-primary text-primary bg-primary/5"
                : "border-transparent text-muted-foreground hover:text-foreground hover:bg-secondary/50"
            )}
          >
            <Icon className="h-3.5 w-3.5" />
            {label}
          </button>
        ))}
      </div>

      {/* Tab content */}
      <div className="flex-1 overflow-hidden">
        {tab === "welcome-logs" && <WelcomeLogsTab authHeaders={authHeaders} />}
        {tab === "welcome-config" && <WelcomeConfigTab authHeaders={authHeaders} />}
      </div>
    </div>
  );
}

// ── Welcome Logs Tab ──────────────────────────────────────────────────────────

function WelcomeLogsTab({ authHeaders }: { authHeaders: Record<string, string> }) {
  const [logs, setLogs] = useState<WelcomeLog[]>([]);
  const [loading, setLoading] = useState(true);
  const [resending, setResending] = useState<number | null>(null);

  const fetchLogs = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/portal/hr/welcome/logs", { headers: authHeaders });
      if (!res.ok) throw new Error("Failed");
      setLogs(await res.json());
    } catch {
      toast.error("Failed to load welcome logs");
    } finally {
      setLoading(false);
    }
  }, [authHeaders]);

  useEffect(() => { fetchLogs(); }, [fetchLogs]);

  const handleResend = async (logId: number, name: string) => {
    setResending(logId);
    try {
      const res = await fetch(`/api/portal/hr/welcome/resend/${logId}`, {
        method: "POST",
        headers: authHeaders,
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.detail || "Failed");
      }
      toast.success(`Welcome email sent to ${name}`);
      fetchLogs();
    } catch (e: unknown) {
      toast.error((e as Error).message);
    } finally {
      setResending(null);
    }
  };

  const stats = {
    pending: logs.filter((l) => l.status === "pending_hr").length,
    sent: logs.filter((l) => l.status === "welcome_sent").length,
    skipped: logs.filter((l) => l.status === "skipped").length,
  };

  return (
    <div className="flex flex-col h-full overflow-hidden">
      {/* Stats */}
      <div className="grid grid-cols-3 gap-4 px-8 py-4 shrink-0">
        {[
          { label: "Pending HR Action", value: stats.pending, color: "text-amber-400", icon: Clock },
          { label: "Welcome Sent", value: stats.sent, color: "text-emerald-400", icon: Send },
          { label: "Skipped", value: stats.skipped, color: "text-zinc-400", icon: X },
        ].map(({ label, value, color, icon: Icon }) => (
          <div key={label} className="rounded-xl border border-[var(--border)] bg-card/40 px-5 py-4 flex items-center gap-4">
            <div className={cn("rounded-lg bg-white/5 p-2.5", color)}>
              <Icon className="h-4 w-4" />
            </div>
            <div>
              <p className="text-[22px] font-bold text-foreground">{value}</p>
              <p className="text-[12px] text-muted-foreground">{label}</p>
            </div>
          </div>
        ))}
      </div>

      <div className="flex items-center justify-between px-8 pb-3 shrink-0">
        <p className="text-[12px] text-muted-foreground">
          HR receives an email when a new employee is detected. Click Yes in that email to send them the welcome package.
        </p>
        <button
          onClick={fetchLogs}
          className="flex items-center gap-2 rounded-lg px-3 py-2 text-[13px] text-muted-foreground hover:bg-secondary transition-colors shrink-0"
        >
          <RefreshCw className="h-3.5 w-3.5" />
          Refresh
        </button>
      </div>

      <div className="flex-1 overflow-auto px-8 pb-8">
        {loading ? (
          <div className="flex h-40 items-center justify-center">
            <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
          </div>
        ) : logs.length === 0 ? (
          <div className="flex h-40 items-center justify-center gap-2 text-muted-foreground">
            <Gift className="h-4 w-4" />
            <span className="text-[13px]">No welcome logs yet — they appear when new employees are detected</span>
          </div>
        ) : (
          <table className="w-full text-[13px]">
            <thead>
              <tr className="border-b border-[var(--border)]">
                {["Employee", "Detected On", "Status", "Acted", "Actions"].map((h) => (
                  <th key={h} className="text-left py-3 pr-4 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground/60">
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {logs.map((l) => (
                <tr key={l.id} className="border-b border-[var(--border)]/50 hover:bg-white/[0.02] transition-colors">
                  <td className="py-3.5 pr-4">
                    <div className="font-medium text-foreground">{l.employee_name}</div>
                    <div className="text-[11px] text-muted-foreground">{l.employee_email}</div>
                  </td>
                  <td className="py-3.5 pr-4 text-foreground/60">{l.created_at.slice(0, 10)}</td>
                  <td className="py-3.5 pr-4">
                    <span className={cn("rounded-full px-2.5 py-1 text-[11px] font-medium", WELCOME_STATUS_BADGE[l.status] ?? "bg-zinc-500/10 text-zinc-400")}>
                      {WELCOME_STATUS_LABEL[l.status] ?? l.status}
                    </span>
                  </td>
                  <td className="py-3.5 pr-4 text-foreground/50 text-[12px]">
                    {l.acted_at ? (
                      <span title={l.acted_by ?? ""}>{l.acted_at.slice(0, 10)}</span>
                    ) : "—"}
                  </td>
                  <td className="py-3.5 pr-4">
                    <button
                      onClick={() => handleResend(l.id, l.employee_name)}
                      disabled={resending === l.id}
                      className="flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-[12px] font-medium bg-primary/10 text-primary hover:bg-primary/20 transition-colors disabled:opacity-50"
                    >
                      {resending === l.id ? (
                        <Loader2 className="h-3 w-3 animate-spin" />
                      ) : (
                        <RotateCcw className="h-3 w-3" />
                      )}
                      {l.status === "welcome_sent" ? "Resend" : "Send Now"}
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}

// ── Welcome Config Tab ────────────────────────────────────────────────────────

function WelcomeConfigTab({ authHeaders }: { authHeaders: Record<string, string> }) {
  const [resources, setResources] = useState<WelcomeResource[]>([]);
  const [loading, setLoading] = useState(true);
  const [editingId, setEditingId] = useState<number | "new" | null>(null);
  const [form, setForm] = useState<Partial<WelcomeResource>>({});
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState<number | null>(null);

  const fetchResources = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/portal/hr/welcome/config", { headers: authHeaders });
      if (!res.ok) throw new Error("Failed");
      setResources(await res.json());
    } catch {
      toast.error("Failed to load resources");
    } finally {
      setLoading(false);
    }
  }, [authHeaders]);

  useEffect(() => { fetchResources(); }, [fetchResources]);

  const startEdit = (r: WelcomeResource) => {
    setEditingId(r.id);
    setForm({ ...r });
  };

  const startNew = () => {
    setEditingId("new");
    setForm({ name: "", url: "", description: "", category: "App Guide", icon: "📌", is_active: true, sort_order: resources.length });
  };

  const cancelEdit = () => { setEditingId(null); setForm({}); };

  const saveResource = async () => {
    if (!form.name?.trim()) { toast.error("Name is required"); return; }
    setSaving(true);
    try {
      const isNew = editingId === "new";
      const url = isNew ? "/api/portal/hr/welcome/config" : `/api/portal/hr/welcome/config/${editingId}`;
      const res = await fetch(url, {
        method: isNew ? "POST" : "PUT",
        headers: authHeaders,
        body: JSON.stringify(form),
      });
      if (!res.ok) throw new Error("Save failed");
      toast.success(isNew ? "Resource added" : "Resource updated");
      setEditingId(null);
      setForm({});
      fetchResources();
    } catch {
      toast.error("Failed to save resource");
    } finally {
      setSaving(false);
    }
  };

  const deleteResource = async (id: number, name: string) => {
    if (!confirm(`Delete "${name}"?`)) return;
    setDeleting(id);
    try {
      const res = await fetch(`/api/portal/hr/welcome/config/${id}`, {
        method: "DELETE",
        headers: authHeaders,
      });
      if (!res.ok) throw new Error("Delete failed");
      toast.success("Resource deleted");
      fetchResources();
    } catch {
      toast.error("Failed to delete resource");
    } finally {
      setDeleting(null);
    }
  };

  const toggleActive = async (r: WelcomeResource) => {
    try {
      const res = await fetch(`/api/portal/hr/welcome/config/${r.id}`, {
        method: "PUT",
        headers: authHeaders,
        body: JSON.stringify({ ...r, is_active: !r.is_active }),
      });
      if (!res.ok) throw new Error();
      fetchResources();
    } catch {
      toast.error("Failed to update");
    }
  };

  return (
    <div className="flex flex-col h-full overflow-hidden">
      <div className="flex items-center justify-between px-8 py-4 shrink-0">
        <p className="text-[13px] text-muted-foreground">
          These resources appear in the welcome email sent to new employees. Toggle items on/off, reorder, or add custom links.
        </p>
        <button
          onClick={startNew}
          className="flex items-center gap-1.5 rounded-lg px-3 py-2 text-[13px] font-medium bg-primary/10 text-primary hover:bg-primary/20 transition-colors shrink-0"
        >
          <Plus className="h-3.5 w-3.5" />
          Add Resource
        </button>
      </div>

      {/* Inline editor */}
      {editingId !== null && (
        <div className="mx-8 mb-4 rounded-xl border border-primary/20 bg-primary/5 p-5 shrink-0">
          <p className="text-[13px] font-semibold text-foreground mb-4">
            {editingId === "new" ? "New Resource" : "Edit Resource"}
          </p>
          <div className="grid grid-cols-2 gap-3">
            <div className="col-span-2 flex gap-3">
              <div className="flex-1">
                <label className="block text-[11px] text-muted-foreground mb-1 uppercase tracking-wide">Name *</label>
                <input
                  className="w-full rounded-lg border border-[var(--border)] bg-background px-3 py-2 text-[13px] focus:outline-none focus:ring-1 focus:ring-primary"
                  value={form.name ?? ""}
                  onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
                  placeholder="e.g. Leave Management"
                />
              </div>
              <div className="w-24">
                <label className="block text-[11px] text-muted-foreground mb-1 uppercase tracking-wide">Icon</label>
                <input
                  className="w-full rounded-lg border border-[var(--border)] bg-background px-3 py-2 text-[13px] focus:outline-none focus:ring-1 focus:ring-primary"
                  value={form.icon ?? ""}
                  onChange={(e) => setForm((f) => ({ ...f, icon: e.target.value }))}
                  placeholder="🎯"
                />
              </div>
            </div>
            <div>
              <label className="block text-[11px] text-muted-foreground mb-1 uppercase tracking-wide">Category</label>
              <select
                className="w-full rounded-lg border border-[var(--border)] bg-background px-3 py-2 text-[13px] focus:outline-none focus:ring-1 focus:ring-primary"
                value={form.category ?? "App Guide"}
                onChange={(e) => setForm((f) => ({ ...f, category: e.target.value }))}
              >
                {CATEGORY_OPTIONS.map((c) => <option key={c}>{c}</option>)}
              </select>
            </div>
            <div>
              <label className="block text-[11px] text-muted-foreground mb-1 uppercase tracking-wide">URL (optional)</label>
              <input
                className="w-full rounded-lg border border-[var(--border)] bg-background px-3 py-2 text-[13px] focus:outline-none focus:ring-1 focus:ring-primary"
                value={form.url ?? ""}
                onChange={(e) => setForm((f) => ({ ...f, url: e.target.value }))}
                placeholder="https://..."
              />
            </div>
            <div className="col-span-2">
              <label className="block text-[11px] text-muted-foreground mb-1 uppercase tracking-wide">Description</label>
              <input
                className="w-full rounded-lg border border-[var(--border)] bg-background px-3 py-2 text-[13px] focus:outline-none focus:ring-1 focus:ring-primary"
                value={form.description ?? ""}
                onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))}
                placeholder="Brief description shown in the email"
              />
            </div>
          </div>
          <div className="flex justify-end gap-2 mt-4">
            <button onClick={cancelEdit} className="rounded-lg px-4 py-2 text-[13px] text-muted-foreground hover:bg-secondary transition-colors">
              Cancel
            </button>
            <button
              onClick={saveResource}
              disabled={saving}
              className="flex items-center gap-1.5 rounded-lg px-4 py-2 text-[13px] font-medium bg-primary text-primary-foreground hover:bg-primary/90 transition-colors disabled:opacity-50"
            >
              {saving && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
              Save
            </button>
          </div>
        </div>
      )}

      <div className="flex-1 overflow-auto px-8 pb-8">
        {loading ? (
          <div className="flex h-40 items-center justify-center">
            <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
          </div>
        ) : resources.length === 0 ? (
          <div className="flex h-40 items-center justify-center gap-2 text-muted-foreground">
            <Gift className="h-4 w-4" />
            <span className="text-[13px]">No resources yet — add some above</span>
          </div>
        ) : (
          <div className="space-y-2">
            {resources.map((r) => (
              <div
                key={r.id}
                className={cn(
                  "flex items-center gap-4 rounded-xl border px-5 py-3.5 transition-all",
                  r.is_active
                    ? "border-[var(--border)] bg-card/40"
                    : "border-[var(--border)]/40 bg-card/20 opacity-50"
                )}
              >
                <span className="text-[22px] w-8 text-center shrink-0">{r.icon || "•"}</span>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="font-medium text-[13px] text-foreground">{r.name}</span>
                    {r.category && (
                      <span className="text-[10px] bg-primary/10 text-primary rounded-full px-2 py-0.5 font-medium">
                        {r.category}
                      </span>
                    )}
                    {r.url && (
                      <a
                        href={r.url}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-[10px] text-muted-foreground hover:text-primary transition-colors truncate max-w-[180px]"
                      >
                        {r.url}
                      </a>
                    )}
                  </div>
                  {r.description && (
                    <p className="text-[12px] text-muted-foreground mt-0.5 truncate">{r.description}</p>
                  )}
                </div>

                {/* Toggle */}
                <button
                  onClick={() => toggleActive(r)}
                  className={cn(
                    "text-[11px] font-medium rounded-full px-3 py-1 transition-colors shrink-0",
                    r.is_active
                      ? "bg-emerald-500/10 text-emerald-400 hover:bg-emerald-500/20"
                      : "bg-zinc-500/10 text-zinc-400 hover:bg-zinc-500/20"
                  )}
                >
                  {r.is_active ? "Active" : "Inactive"}
                </button>

                <button
                  onClick={() => startEdit(r)}
                  className="rounded-lg p-1.5 text-muted-foreground hover:bg-secondary hover:text-foreground transition-colors shrink-0"
                >
                  <Pencil className="h-3.5 w-3.5" />
                </button>
                <button
                  onClick={() => deleteResource(r.id, r.name)}
                  disabled={deleting === r.id}
                  className="rounded-lg p-1.5 text-muted-foreground hover:bg-rose-500/10 hover:text-rose-400 transition-colors shrink-0"
                >
                  {deleting === r.id ? (
                    <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  ) : (
                    <Trash2 className="h-3.5 w-3.5" />
                  )}
                </button>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
