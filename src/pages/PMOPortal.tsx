import { useAuth } from "@/lib/auth-store";
import { useState, useEffect, useCallback } from "react";
import { Check, X, Loader2, RefreshCw, GraduationCap, ClipboardList, Send, Power, Plus } from "lucide-react";
import { cn } from "@/lib/utils";
import { toast } from "sonner";
import { flyBanner } from "@/lib/fly-banner";

type Tab = "udemy" | "project-update";

const STATUS_BADGE: Record<string, string> = {
  Pending: "bg-amber-500/15 text-amber-400 border border-amber-500/20",
  Approved: "bg-emerald-500/15 text-emerald-400 border border-emerald-500/20",
  Rejected: "bg-rose-500/15 text-rose-400 border border-rose-500/20",
};

interface UdemyRequest {
  id: number;
  employee_name: string;
  employee_email: string;
  platform: string;
  course_name: string;
  justification: string;
  status: string;
  decided_by: string;
  decision_reason: string;
  created_at: string | null;
}

export function PMOPortal() {
  const { user } = useAuth();
  const [tab, setTab] = useState<Tab>("udemy");

  const authHeaders = {
    "Content-Type": "application/json",
    ...(user?.email ? { "x-user-email": user.email } : {}),
    ...(user?.role ? { "x-user-role": user.role.toLowerCase() } : {}),
  };

  if (user?.role !== "PMO" && user?.role !== "Admin") {
    return (
      <div className="flex h-full items-center justify-center text-muted-foreground">
        Access restricted to the PMO team.
      </div>
    );
  }

  const tabs: { id: Tab; label: string; icon: typeof GraduationCap }[] = [
    { id: "udemy", label: "Course Licenses", icon: GraduationCap },
    { id: "project-update", label: "Project Updates", icon: ClipboardList },
  ];

  return (
    <div className="flex flex-col h-full overflow-hidden">
      <div className="flex items-center justify-between px-8 py-6 border-b border-[var(--border)] shrink-0">
        <div>
          <h1 className="text-[20px] font-semibold text-foreground">PMO Portal</h1>
          <p className="text-[13px] text-muted-foreground mt-0.5">
            {tab === "udemy"
              ? "Review and action training-license requests (Udemy, Coursera)"
              : "Configure the biweekly project-update form and review submissions"}
          </p>
        </div>
      </div>
      <div className="flex gap-1 px-8 py-3 border-b border-[var(--border)] shrink-0">
        {tabs.map((t) => (
          <button
            key={t.id}
            onClick={() => setTab(t.id)}
            className={cn(
              "flex items-center gap-2 rounded-lg px-4 py-2 text-[13px] font-medium transition-colors",
              tab === t.id ? "bg-primary/10 text-primary" : "text-muted-foreground hover:bg-secondary hover:text-foreground"
            )}
          >
            <t.icon className="h-3.5 w-3.5" />
            {t.label}
          </button>
        ))}
      </div>
      <div className="flex-1 overflow-auto px-8 py-6">
        {tab === "udemy" ? <UdemyTab authHeaders={authHeaders} /> : <ProjectUpdateTab authHeaders={authHeaders} />}
      </div>
    </div>
  );
}

function UdemyTab({ authHeaders }: { authHeaders: Record<string, string> }) {
  const [items, setItems] = useState<UdemyRequest[]>([]);
  const [loading, setLoading] = useState(true);
  const [acting, setActing] = useState<number | null>(null);
  const [filter, setFilter] = useState("Pending");

  const fetch_ = useCallback(async () => {
    setLoading(true);
    try {
      const qs = filter !== "All" ? `?status=${filter}` : "";
      const res = await fetch(`/api/portal/pmo/udemy${qs}`, { headers: authHeaders });
      setItems(await res.json());
    } catch { toast.error("Failed to load"); }
    finally { setLoading(false); }
  }, [filter]);

  useEffect(() => { fetch_(); }, [fetch_]);

  const approve = async (id: number, platform: string) => {
    setActing(id);
    try {
      const res = await fetch(`/api/portal/pmo/udemy/${id}/approve`, { method: "PUT", headers: authHeaders });
      if (!res.ok) throw new Error((await res.json().catch(() => ({}))).detail || "Failed");
      flyBanner(`${platform || "Udemy"} license approved`);
      fetch_();
    } catch (e: unknown) { toast.error(e instanceof Error ? e.message : "Failed"); }
    finally { setActing(null); }
  };

  const reject = async (id: number) => {
    const reason = window.prompt("Reason for declining (shown to the employee):")?.trim();
    if (!reason) return;
    setActing(id);
    try {
      const res = await fetch(`/api/portal/pmo/udemy/${id}/reject`, {
        method: "PUT", headers: authHeaders, body: JSON.stringify({ reason }),
      });
      if (!res.ok) throw new Error((await res.json().catch(() => ({}))).detail || "Failed");
      toast.success("Request declined");
      fetch_();
    } catch (e: unknown) { toast.error(e instanceof Error ? e.message : "Failed"); }
    finally { setActing(null); }
  };

  return (
    <div>
      <div className="flex items-center justify-between mb-4">
        <div className="flex gap-1">
          {["Pending", "Approved", "Rejected", "All"].map((s) => (
            <button
              key={s}
              onClick={() => setFilter(s)}
              className={cn(
                "rounded-lg px-3.5 py-1.5 text-[13px] font-medium transition-colors",
                filter === s ? "bg-primary/10 text-primary" : "text-muted-foreground hover:bg-secondary hover:text-foreground"
              )}
            >
              {s}
            </button>
          ))}
        </div>
        <button onClick={fetch_} className="flex items-center gap-1.5 text-[13px] text-muted-foreground hover:text-foreground transition-colors">
          <RefreshCw className="h-3.5 w-3.5" />
          Refresh
        </button>
      </div>

      {loading ? (
        <div className="flex h-40 items-center justify-center"><Loader2 className="h-5 w-5 animate-spin text-muted-foreground" /></div>
      ) : items.length === 0 ? (
        <div className="flex h-40 items-center justify-center text-[13px] text-muted-foreground">No license requests found</div>
      ) : (
        <table className="w-full text-[13px]">
          <thead>
            <tr className="border-b border-[var(--border)]">
              {["Employee", "Platform", "Course", "Justification", "Status", "Actions"].map((h) => (
                <th key={h} className="text-left py-3 pr-4 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground/60">{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {items.map((r) => (
              <tr key={r.id} className="border-b border-[var(--border)]/50 hover:bg-white/[0.02] transition-colors">
                <td className="py-3.5 pr-4">
                  <div className="font-medium text-foreground">{r.employee_name}</div>
                  <div className="text-[11px] text-muted-foreground">{r.employee_email}</div>
                </td>
                <td className="py-3.5 pr-4">
                  <span className="rounded-full px-2.5 py-1 text-[11px] font-medium bg-indigo-500/15 text-indigo-400 border border-indigo-500/20">
                    {r.platform || "Udemy"}
                  </span>
                </td>
                <td className="py-3.5 pr-4 text-foreground/90">{r.course_name || "—"}</td>
                <td className="py-3.5 pr-4 text-foreground/70 max-w-[300px]">{r.justification || r.decision_reason || "—"}</td>
                <td className="py-3.5 pr-4">
                  <span className={cn("rounded-full px-2.5 py-1 text-[11px] font-medium", STATUS_BADGE[r.status] ?? "bg-zinc-500/10 text-zinc-400")}>
                    {r.status}
                  </span>
                </td>
                <td className="py-3.5">
                  {r.status === "Pending" ? (
                    <div className="flex items-center gap-1.5">
                      <button onClick={() => approve(r.id, r.platform)} disabled={acting === r.id}
                        className="flex items-center gap-1 rounded-lg px-2.5 py-1.5 text-[12px] font-medium bg-emerald-500/10 text-emerald-400 hover:bg-emerald-500/20 transition-colors disabled:opacity-50">
                        {acting === r.id ? <Loader2 className="h-3 w-3 animate-spin" /> : <Check className="h-3 w-3" />}
                        Approve
                      </button>
                      <button onClick={() => reject(r.id)} disabled={acting === r.id}
                        className="flex items-center gap-1 rounded-lg px-2.5 py-1.5 text-[12px] font-medium bg-rose-500/10 text-rose-400 hover:bg-rose-500/20 transition-colors disabled:opacity-50">
                        <X className="h-3 w-3" />
                        Decline
                      </button>
                    </div>
                  ) : <span className="text-muted-foreground/40 text-[12px]">—</span>}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}

interface ProjectUpdateConfig {
  active: boolean;
  cadence_days: number;
  hour: number;
  activity_options: string[];
  last_run: string | null;
}

interface ProjectSubmission {
  id: number;
  employee_name: string;
  employee_email: string;
  activity_type: string;
  project_name: string | null;
  expected_end_date: string | null;
  status: string;
  filled_by_email: string;
  filled_at: string | null;
  approved_by_email: string | null;
  approved_at: string | null;
}

function ProjectUpdateTab({ authHeaders }: { authHeaders: Record<string, string> }) {
  const [cfg, setCfg] = useState<ProjectUpdateConfig | null>(null);
  const [savingCfg, setSavingCfg] = useState(false);
  const [running, setRunning] = useState(false);
  const [newOption, setNewOption] = useState("");
  const [items, setItems] = useState<ProjectSubmission[]>([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState("submitted");

  const loadCfg = useCallback(async () => {
    try {
      const res = await fetch("/api/portal/pmo/project-update/config", { headers: authHeaders });
      setCfg(await res.json());
    } catch { toast.error("Failed to load config"); }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const loadSubs = useCallback(async () => {
    setLoading(true);
    try {
      const qs = filter !== "all" ? `?status=${filter}` : "";
      const res = await fetch(`/api/portal/pmo/project-update/submissions${qs}`, { headers: authHeaders });
      setItems(await res.json());
    } catch { toast.error("Failed to load submissions"); }
    finally { setLoading(false); }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filter]);

  useEffect(() => { loadCfg(); }, [loadCfg]);
  useEffect(() => { loadSubs(); }, [loadSubs]);

  const saveCfg = async (patch: Partial<ProjectUpdateConfig>) => {
    if (!cfg) return;
    setSavingCfg(true);
    try {
      const res = await fetch("/api/portal/pmo/project-update/config", {
        method: "PUT", headers: authHeaders, body: JSON.stringify(patch),
      });
      if (!res.ok) throw new Error("Failed");
      setCfg(await res.json());
      toast.success("Saved");
    } catch { toast.error("Failed to save"); }
    finally { setSavingCfg(false); }
  };

  const runNow = async () => {
    setRunning(true);
    try {
      const res = await fetch("/api/portal/pmo/project-update/run-now", { method: "POST", headers: authHeaders });
      const data = await res.json();
      if (!res.ok) throw new Error(data.detail || "Failed");
      flyBanner(data.message || "Form sent");
    } catch (e: unknown) { toast.error(e instanceof Error ? e.message : "Failed"); }
    finally { setRunning(false); }
  };

  if (!cfg) {
    return <div className="flex h-40 items-center justify-center"><Loader2 className="h-5 w-5 animate-spin text-muted-foreground" /></div>;
  }

  return (
    <div className="space-y-6">
      {/* Config */}
      <div className="rounded-xl border border-[var(--border)] bg-white/[0.02] p-6 space-y-4 max-w-2xl">
        <div className="flex items-center justify-between">
          <div>
            <div className="text-[14px] font-semibold text-foreground">Biweekly form</div>
            <div className="text-[12px] text-muted-foreground">
              {cfg.active ? "Active — sent to employees without an active allocation" : "Disabled"}
              {cfg.last_run && ` · last run ${cfg.last_run}`}
            </div>
          </div>
          <button
            onClick={() => saveCfg({ active: !cfg.active })}
            disabled={savingCfg}
            className={cn(
              "flex items-center gap-2 rounded-lg px-3.5 py-2 text-[13px] font-medium transition-colors disabled:opacity-50",
              cfg.active ? "bg-emerald-500/10 text-emerald-400" : "bg-zinc-500/10 text-zinc-400"
            )}
          >
            <Power className="h-3.5 w-3.5" />
            {cfg.active ? "Enabled" : "Disabled"}
          </button>
        </div>

        <div className="flex gap-4">
          <div className="flex-1">
            <label className="block text-[12px] font-medium text-muted-foreground mb-1.5">Cadence (days)</label>
            <input
              type="number" min={1} defaultValue={cfg.cadence_days}
              onBlur={(e) => { const v = parseInt(e.target.value); if (v && v !== cfg.cadence_days) saveCfg({ cadence_days: v }); }}
              className="w-full rounded-lg border border-[var(--border)] bg-[var(--background)] px-3 py-2 text-[14px] text-foreground focus:outline-none focus:ring-1 focus:ring-primary"
            />
          </div>
          <div className="flex-1">
            <label className="block text-[12px] font-medium text-muted-foreground mb-1.5">Send hour (0–23)</label>
            <input
              type="number" min={0} max={23} defaultValue={cfg.hour}
              onBlur={(e) => { const v = parseInt(e.target.value); if (!isNaN(v) && v !== cfg.hour) saveCfg({ hour: v }); }}
              className="w-full rounded-lg border border-[var(--border)] bg-[var(--background)] px-3 py-2 text-[14px] text-foreground focus:outline-none focus:ring-1 focus:ring-primary"
            />
          </div>
        </div>

        <div>
          <label className="block text-[12px] font-medium text-muted-foreground mb-1.5">Activity options</label>
          <div className="flex flex-wrap gap-2 mb-2">
            {cfg.activity_options.map((o) => (
              <span key={o} className="flex items-center gap-1.5 rounded-full bg-primary/10 text-primary px-3 py-1 text-[12px] font-medium">
                {o}
                {cfg.activity_options.length > 1 && (
                  <button
                    onClick={() => saveCfg({ activity_options: cfg.activity_options.filter((x) => x !== o) })}
                    className="hover:text-rose-400"
                  ><X className="h-3 w-3" /></button>
                )}
              </span>
            ))}
          </div>
          <div className="flex gap-2">
            <input
              value={newOption}
              onChange={(e) => setNewOption(e.target.value)}
              placeholder="Add an option"
              className="flex-1 rounded-lg border border-[var(--border)] bg-[var(--background)] px-3 py-2 text-[13px] text-foreground focus:outline-none focus:ring-1 focus:ring-primary"
            />
            <button
              onClick={() => { const v = newOption.trim(); if (v && !cfg.activity_options.includes(v)) { saveCfg({ activity_options: [...cfg.activity_options, v] }); setNewOption(""); } }}
              className="flex items-center gap-1 rounded-lg px-3 py-2 text-[13px] font-medium bg-secondary text-foreground hover:bg-secondary/70 transition-colors"
            ><Plus className="h-3.5 w-3.5" /> Add</button>
          </div>
        </div>

        <div className="pt-1">
          <button
            onClick={runNow}
            disabled={running}
            className="flex items-center gap-2 rounded-lg px-4 py-2 text-[13px] font-medium bg-primary text-primary-foreground hover:opacity-90 transition-opacity disabled:opacity-50"
          >
            {running ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Send className="h-3.5 w-3.5" />}
            Send now to eligible employees
          </button>
        </div>
      </div>

      {/* Submissions */}
      <div>
        <div className="flex items-center justify-between mb-4">
          <div className="flex gap-1">
            {["submitted", "approved", "rejected", "all"].map((s) => (
              <button
                key={s}
                onClick={() => setFilter(s)}
                className={cn(
                  "rounded-lg px-3.5 py-1.5 text-[13px] font-medium capitalize transition-colors",
                  filter === s ? "bg-primary/10 text-primary" : "text-muted-foreground hover:bg-secondary hover:text-foreground"
                )}
              >{s}</button>
            ))}
          </div>
          <button onClick={loadSubs} className="flex items-center gap-1.5 text-[13px] text-muted-foreground hover:text-foreground transition-colors">
            <RefreshCw className="h-3.5 w-3.5" /> Refresh
          </button>
        </div>

        {loading ? (
          <div className="flex h-40 items-center justify-center"><Loader2 className="h-5 w-5 animate-spin text-muted-foreground" /></div>
        ) : items.length === 0 ? (
          <div className="flex h-40 items-center justify-center text-[13px] text-muted-foreground">No submissions found</div>
        ) : (
          <table className="w-full text-[13px]">
            <thead>
              <tr className="border-b border-[var(--border)]">
                {["Employee", "Activity", "Project", "Filled", "Status", "Approved by"].map((h) => (
                  <th key={h} className="text-left py-3 pr-4 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground/60">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {items.map((r) => (
                <tr key={r.id} className="border-b border-[var(--border)]/50 hover:bg-white/[0.02] transition-colors">
                  <td className="py-3.5 pr-4">
                    <div className="font-medium text-foreground">{r.employee_name}</div>
                    <div className="text-[11px] text-muted-foreground">{r.employee_email}</div>
                  </td>
                  <td className="py-3.5 pr-4 text-foreground/90">{r.activity_type}</td>
                  <td className="py-3.5 pr-4 text-foreground/70">{r.project_name || "—"}</td>
                  <td className="py-3.5 pr-4 text-foreground/70">{r.filled_at ? new Date(r.filled_at).toLocaleDateString() : "—"}</td>
                  <td className="py-3.5 pr-4">
                    <span className={cn("rounded-full px-2.5 py-1 text-[11px] font-medium capitalize", STATUS_BADGE[r.status[0].toUpperCase() + r.status.slice(1)] ?? "bg-zinc-500/10 text-zinc-400")}>
                      {r.status}
                    </span>
                  </td>
                  <td className="py-3.5 text-foreground/70 text-[12px]">
                    {r.approved_by_email || "—"}
                    {r.approved_at && <div className="text-[11px] text-muted-foreground">{new Date(r.approved_at).toLocaleDateString()}</div>}
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
