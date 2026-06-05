import { createFileRoute, redirect } from "@tanstack/react-router";
import { useAuth } from "@/lib/auth-store";
import { useState, useEffect, useCallback, type ReactNode } from "react";
import { Check, X, Ticket, Package, Loader2, RefreshCw, ChevronDown, SlidersHorizontal, Power, RotateCcw, AlertTriangle, ShieldAlert, Cpu, Gauge, Zap } from "lucide-react";
import { cn } from "@/lib/utils";
import { toast } from "sonner";
import { flyBanner } from "@/lib/fly-banner";

export const Route = createFileRoute("/_layout/it-portal")({
  beforeLoad: () => {
    throw redirect({
      to: "/control-hub",
      search: { tab: "it-portal" },
    });
  },
  component: ITPortal,
});

type Tab = "tickets" | "software" | "controls";

const STATUS_BADGE: Record<string, string> = {
  Open: "bg-blue-500/15 text-blue-400 border border-blue-500/20",
  "Awaiting Approval": "bg-amber-500/15 text-amber-400 border border-amber-500/20",
  "In Progress": "bg-violet-500/15 text-violet-400 border border-violet-500/20",
  Resolved: "bg-emerald-500/15 text-emerald-400 border border-emerald-500/20",
  Closed: "bg-zinc-500/15 text-zinc-400 border border-zinc-500/20",
  Pending: "bg-amber-500/15 text-amber-400 border border-amber-500/20",
  Approved: "bg-emerald-500/15 text-emerald-400 border border-emerald-500/20",
  Rejected: "bg-rose-500/15 text-rose-400 border border-rose-500/20",
  Installed: "bg-emerald-500/15 text-emerald-400 border border-emerald-500/20",
};

const PRIORITY_COLOR: Record<string, string> = {
  Low: "text-zinc-400",
  Medium: "text-amber-400",
  High: "text-orange-400",
  Critical: "text-rose-400",
};

const TICKET_STATUSES = ["Open", "Awaiting Approval", "In Progress", "Resolved", "Closed"];

export function ITPortal() {
  const { user } = useAuth();
  const [tab, setTab] = useState<Tab>("tickets");

  const authHeaders = {
    "Content-Type": "application/json",
    ...(user?.email ? { "x-user-email": user.email } : {}),
    ...(user?.role ? { "x-user-role": user.role.toLowerCase() } : {}),
  };

  if (user?.role !== "IT" && user?.role !== "Admin") {
    return (
      <div className="flex h-full items-center justify-center text-muted-foreground">
        Access restricted to IT team.
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full overflow-hidden">
      {/* Header */}
      <div className="flex items-center justify-between px-8 py-6 border-b border-[var(--border)] shrink-0">
        <div>
          <h1 className="text-[20px] font-semibold text-foreground">IT Portal</h1>
          <p className="text-[13px] text-muted-foreground mt-0.5">Manage support tickets and software installation requests</p>
        </div>
      </div>

      {/* Tabs */}
      <div className="flex gap-1 px-8 py-3 border-b border-[var(--border)] shrink-0">
        {[
          { id: "tickets", label: "Support Tickets", icon: Ticket },
          { id: "software", label: "Software Requests", icon: Package },
          { id: "controls", label: "Model Controls", icon: SlidersHorizontal },
        ].map(({ id, label, icon: Icon }) => (
          <button
            key={id}
            onClick={() => setTab(id as Tab)}
            className={cn(
              "flex items-center gap-2 rounded-lg px-4 py-2 text-[13px] font-medium transition-colors",
              tab === id
                ? "bg-primary/10 text-primary"
                : "text-muted-foreground hover:bg-secondary hover:text-foreground"
            )}
          >
            <Icon className="h-3.5 w-3.5" />
            {label}
          </button>
        ))}
      </div>

      <div className="flex-1 overflow-auto px-8 py-6">
        {tab === "tickets" && <TicketsTab authHeaders={authHeaders} />}
        {tab === "software" && <SoftwareTab authHeaders={authHeaders} />}
        {tab === "controls" && <ModelControlsTab authHeaders={authHeaders} />}
      </div>
    </div>
  );
}

// ── Tickets Tab ───────────────────────────────────────────────────────────────

interface ITTicket {
  id: number;
  ticket_id: string;
  employee_name: string;
  employee_email: string;
  category: string;
  subject: string;
  description: string;
  priority: string;
  status: string;
  assigned_to: string | null;
  resolution_notes: string | null;
  created_at: string;
}

function TicketsTab({ authHeaders }: { authHeaders: Record<string, string> }) {
  const [items, setItems] = useState<ITTicket[]>([]);
  const [loading, setLoading] = useState(true);
  const [acting, setActing] = useState<string | null>(null);
  const [filter, setFilter] = useState("Open");
  const [openDropdown, setOpenDropdown] = useState<string | null>(null);

  const fetch_ = useCallback(async () => {
    setLoading(true);
    try {
      const qs = filter !== "All" ? `?status=${encodeURIComponent(filter)}` : "";
      const res = await fetch(`/api/it/portal/tickets${qs}`, { headers: authHeaders });
      setItems(await res.json());
    } catch { toast.error("Failed to load"); }
    finally { setLoading(false); }
  }, [filter]);

  useEffect(() => { fetch_(); }, [fetch_]);

  const updateStatus = async (ticketId: string, status: string) => {
    setActing(ticketId);
    setOpenDropdown(null);
    try {
      const res = await fetch(`/api/it/portal/tickets/${ticketId}`, {
        method: "PUT",
        headers: authHeaders,
        body: JSON.stringify({ status }),
      });
      if (!res.ok) throw new Error((await res.json().catch(() => ({}))).detail || "Failed");
      toast.success(`Ticket updated to ${status}`);
      fetch_();
    } catch (e: unknown) { toast.error(e instanceof Error ? e.message : "Failed"); }
    finally { setActing(null); }
  };

  return (
    <div>
      <FilterBar
        filter={filter}
        setFilter={setFilter}
        options={["Open", "In Progress", "Awaiting Approval", "Resolved", "All"]}
        onRefresh={fetch_}
      />
      {loading ? <TableLoader /> : items.length === 0 ? <TableEmpty label="tickets" /> : (
        <table className="w-full text-[13px]">
          <thead>
            <tr className="border-b border-[var(--border)]">
              {["Ticket ID", "Employee", "Category", "Subject", "Priority", "Status", "Raised On", "Update Status"].map((h) => (
                <th key={h} className="text-left py-3 pr-4 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground/60">{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {items.map((t) => (
              <tr key={t.id} className="border-b border-[var(--border)]/50 hover:bg-white/[0.02] transition-colors">
                <td className="py-3.5 pr-4 font-mono text-[12px] text-primary">{t.ticket_id}</td>
                <td className="py-3.5 pr-4">
                  <div className="font-medium text-foreground">{t.employee_name}</div>
                  <div className="text-[11px] text-muted-foreground">{t.employee_email}</div>
                </td>
                <td className="py-3.5 pr-4 text-foreground/80">{t.category}</td>
                <td className="py-3.5 pr-4 text-foreground/80 max-w-[180px] truncate" title={t.subject}>{t.subject}</td>
                <td className="py-3.5 pr-4">
                  <span className={cn("text-[12px] font-medium", PRIORITY_COLOR[t.priority] ?? "text-zinc-400")}>{t.priority}</span>
                </td>
                <td className="py-3.5 pr-4"><StatusBadge status={t.status} /></td>
                <td className="py-3.5 pr-4 text-foreground/50">{t.created_at.slice(0, 10)}</td>
                <td className="py-3.5 relative">
                  {acting === t.ticket_id ? (
                    <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
                  ) : (
                    <div className="relative inline-block">
                      <button
                        onClick={() => setOpenDropdown(openDropdown === t.ticket_id ? null : t.ticket_id)}
                        className="flex items-center gap-1.5 rounded-lg border border-[var(--border)] px-2.5 py-1.5 text-[12px] text-muted-foreground hover:bg-secondary hover:text-foreground transition-colors"
                      >
                        {t.status}
                        <ChevronDown className="h-3 w-3" />
                      </button>
                      {openDropdown === t.ticket_id && (
                        <div className="absolute right-0 top-8 z-10 w-44 rounded-xl border border-[var(--border)] bg-card shadow-2xl overflow-hidden">
                          {TICKET_STATUSES.filter((s) => s !== t.status).map((s) => (
                            <button
                              key={s}
                              onClick={() => updateStatus(t.ticket_id, s)}
                              className="block w-full px-3 py-2 text-left text-[13px] text-foreground/80 hover:bg-secondary transition-colors"
                            >
                              {s}
                            </button>
                          ))}
                        </div>
                      )}
                    </div>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}

// ── Software Requests Tab ─────────────────────────────────────────────────────

interface SoftwareRequest {
  id: number;
  employee_name: string;
  employee_email: string;
  software_name: string;
  version: string | null;
  justification: string;
  requires_admin: boolean;
  status: string;
  approved_by: string | null;
}

function SoftwareTab({ authHeaders }: { authHeaders: Record<string, string> }) {
  const [items, setItems] = useState<SoftwareRequest[]>([]);
  const [loading, setLoading] = useState(true);
  const [acting, setActing] = useState<number | null>(null);
  const [filter, setFilter] = useState("Pending");

  const fetch_ = useCallback(async () => {
    setLoading(true);
    try {
      const qs = filter !== "All" ? `?status=${filter}` : "";
      const res = await fetch(`/api/it/portal/software-requests${qs}`, { headers: authHeaders });
      setItems(await res.json());
    } catch { toast.error("Failed to load"); }
    finally { setLoading(false); }
  }, [filter]);

  useEffect(() => { fetch_(); }, [fetch_]);

  const act = async (id: number, type: "approve" | "reject") => {
    setActing(id);
    try {
      const res = await fetch(`/api/it/portal/software-requests/${id}/${type}`, { method: "PUT", headers: authHeaders });
      if (!res.ok) throw new Error((await res.json().catch(() => ({}))).detail || "Failed");
      if (type === "approve") flyBanner("Software request approved");
      else toast.success("Software request rejected");
      fetch_();
    } catch (e: unknown) { toast.error(e instanceof Error ? e.message : "Failed"); }
    finally { setActing(null); }
  };

  return (
    <div>
      <FilterBar filter={filter} setFilter={setFilter} options={["Pending", "Approved", "Rejected", "All"]} onRefresh={fetch_} />
      {loading ? <TableLoader /> : items.length === 0 ? <TableEmpty label="software requests" /> : (
        <table className="w-full text-[13px]">
          <thead>
            <tr className="border-b border-[var(--border)]">
              {["Employee", "Software", "Version", "Justification", "Admin Req.", "Status", "Actions"].map((h) => (
                <th key={h} className="text-left py-3 pr-4 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground/60">{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {items.map((sr) => (
              <tr key={sr.id} className="border-b border-[var(--border)]/50 hover:bg-white/[0.02] transition-colors">
                <td className="py-3.5 pr-4">
                  <div className="font-medium text-foreground">{sr.employee_name}</div>
                  <div className="text-[11px] text-muted-foreground">{sr.employee_email}</div>
                </td>
                <td className="py-3.5 pr-4 font-medium text-foreground">{sr.software_name}</td>
                <td className="py-3.5 pr-4 text-foreground/60 font-mono text-[12px]">{sr.version || "—"}</td>
                <td className="py-3.5 pr-4 text-foreground/60 max-w-[200px] truncate" title={sr.justification}>{sr.justification}</td>
                <td className="py-3.5 pr-4 text-center">
                  <span className={cn("text-[12px] font-medium", sr.requires_admin ? "text-amber-400" : "text-emerald-400")}>
                    {sr.requires_admin ? "Yes" : "No"}
                  </span>
                </td>
                <td className="py-3.5 pr-4"><StatusBadge status={sr.status} /></td>
                <td className="py-3.5">
                  {sr.status === "Pending" ? (
                    <div className="flex items-center gap-1.5">
                      <button
                        onClick={() => act(sr.id, "approve")}
                        disabled={acting === sr.id}
                        className="flex items-center gap-1 rounded-lg px-2.5 py-1.5 text-[12px] font-medium bg-emerald-500/10 text-emerald-400 hover:bg-emerald-500/20 transition-colors disabled:opacity-50"
                      >
                        {acting === sr.id ? <Loader2 className="h-3 w-3 animate-spin" /> : <Check className="h-3 w-3" />}
                        Approve
                      </button>
                      <button
                        onClick={() => act(sr.id, "reject")}
                        disabled={acting === sr.id}
                        className="flex items-center gap-1 rounded-lg px-2.5 py-1.5 text-[12px] font-medium bg-rose-500/10 text-rose-400 hover:bg-rose-500/20 transition-colors disabled:opacity-50"
                      >
                        <X className="h-3 w-3" />
                        Reject
                      </button>
                    </div>
                  ) : <span className="text-muted-foreground/40 text-[12px]">{sr.approved_by ? `by ${sr.approved_by}` : "—"}</span>}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}

// ── Shared helpers ────────────────────────────────────────────────────────────

function StatusBadge({ status }: { status: string }) {
  return (
    <span className={cn("rounded-full px-2.5 py-1 text-[11px] font-medium", STATUS_BADGE[status] ?? "bg-zinc-500/10 text-zinc-400")}>
      {status}
    </span>
  );
}

function FilterBar({ filter, setFilter, options, onRefresh }: { filter: string; setFilter: (s: string) => void; options: string[]; onRefresh: () => void }) {
  return (
    <div className="flex items-center justify-between mb-4">
      <div className="flex gap-1">
        {options.map((s) => (
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
      <button onClick={onRefresh} className="flex items-center gap-1.5 text-[13px] text-muted-foreground hover:text-foreground transition-colors">
        <RefreshCw className="h-3.5 w-3.5" />
        Refresh
      </button>
    </div>
  );
}

function TableLoader() {
  return <div className="flex h-40 items-center justify-center"><Loader2 className="h-5 w-5 animate-spin text-muted-foreground" /></div>;
}

function TableEmpty({ label }: { label: string }) {
  return <div className="flex h-40 items-center justify-center text-[13px] text-muted-foreground">No {label} found</div>;
}

// ── Model Controls Tab ──────────────────────────────────────────────────────────
// IT levers over the AI: kill switch, GPU load throttle, per-tier model params, and
// per-domain disable. Reads/writes /api/it/llm-controls; polls /api/chat/load live.

interface TierCfg { model: string; temperature: number; max_tokens: number | null; timeout: number | null; }
interface LlmCfg {
  chat_enabled: boolean;
  disabled_domains: string[];
  max_concurrency: number;
  max_queue: number;
  tiers: Record<string, TierCfg>;
}
interface LlmControlsResponse {
  effective: LlmCfg;
  defaults: LlmCfg;
  bounds: Record<string, [number, number]>;
  models: string[];
  models_live: boolean;
  domains: string[];
  tiers: string[];
  updated_by: string | null;
  updated_at: string | null;
}

const TIER_META: Record<string, { label: string; sub: string }> = {
  agent: { label: "Agent", sub: "Reasoning & tool calling — HR, MS365, deep-links" },
  service: { label: "Domain Service Agents", sub: "Tool calling — Admin, IT, PMO, Manager" },
  router: { label: "Router", sub: "Intent-router LLM fallback" },
  general: { label: "General", sub: "Greetings, announcements, policy Q&A" },
  summarizer: { label: "Summarizer", sub: "Context & tool-result summaries" },
};
// Tiers whose models MUST support tool-calling / structured output — swapping these
// to an incompatible model breaks routing or agent actions outright.
const TOOLCALL_TIERS = new Set(["agent", "service", "router"]);
const DOMAIN_LABELS: Record<string, string> = {
  hr: "HR", admin: "Admin Services", it_support: "IT Support",
  pmo: "PMO", ms365: "Microsoft 365", functional_manager: "Manager",
};

function ModelControlsTab({ authHeaders }: { authHeaders: Record<string, string> }) {
  const [data, setData] = useState<LlmControlsResponse | null>(null);
  const [cfg, setCfg] = useState<LlmCfg | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [confirmModels, setConfirmModels] = useState<string[] | null>(null);
  const [load, setLoad] = useState<{ active: number; waiting: number; max_concurrency: number } | null>(null);

  const fetch_ = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/it/llm-controls", { headers: authHeaders });
      if (!res.ok) throw new Error("Failed to load");
      const d: LlmControlsResponse = await res.json();
      setData(d);
      setCfg(d.effective);
    } catch { toast.error("Failed to load model controls"); }
    finally { setLoading(false); }
  }, []);

  useEffect(() => { fetch_(); }, [fetch_]);

  // Live load meter — poll the existing concurrency-gate stats endpoint.
  useEffect(() => {
    let active = true;
    const tick = async () => {
      try {
        const res = await fetch("/api/chat/load", { headers: authHeaders });
        if (res.ok && active) setLoad(await res.json());
      } catch { /* ignore transient */ }
    };
    tick();
    const id = setInterval(tick, 3000);
    return () => { active = false; clearInterval(id); };
  }, []);

  const applyResponse = (d: { effective: LlmCfg; updated_by: string | null; updated_at: string | null }) => {
    setCfg(d.effective);
    setData((prev) => prev ? { ...prev, effective: d.effective, updated_by: d.updated_by, updated_at: d.updated_at } : prev);
  };

  const saveNow = async () => {
    if (!cfg) return;
    setSaving(true);
    try {
      const res = await fetch("/api/it/llm-controls", {
        method: "PUT", headers: authHeaders, body: JSON.stringify(cfg),
      });
      if (!res.ok) throw new Error((await res.json().catch(() => ({}))).detail || "Save failed");
      applyResponse(await res.json());
      flyBanner("Model controls updated");
    } catch (e: unknown) { toast.error(e instanceof Error ? e.message : "Save failed"); }
    finally { setSaving(false); setConfirmModels(null); }
  };

  const reset = async () => {
    setSaving(true);
    try {
      const res = await fetch("/api/it/llm-controls/reset", { method: "POST", headers: authHeaders });
      if (!res.ok) throw new Error("Reset failed");
      applyResponse(await res.json());
      toast.success("Reverted to defaults");
    } catch (e: unknown) { toast.error(e instanceof Error ? e.message : "Reset failed"); }
    finally { setSaving(false); }
  };

  if (loading || !cfg || !data) return <TableLoader />;

  const baseline = data.effective;
  const dirty = JSON.stringify(cfg) !== JSON.stringify(baseline);
  const changedModelTiers = data.tiers.filter((t) => cfg.tiers[t]?.model !== baseline.tiers[t]?.model);

  const onSaveClick = () => {
    // Model swaps are the dangerous change — confirm them explicitly.
    if (changedModelTiers.length > 0) setConfirmModels(changedModelTiers);
    else saveNow();
  };

  const setTier = (tier: string, patch: Partial<TierCfg>) =>
    setCfg({ ...cfg, tiers: { ...cfg.tiers, [tier]: { ...cfg.tiers[tier], ...patch } } });
  const numOrNull = (v: string): number | null => (v.trim() === "" ? null : Number(v));
  const toggleDomain = (d: string) =>
    setCfg({
      ...cfg,
      disabled_domains: cfg.disabled_domains.includes(d)
        ? cfg.disabled_domains.filter((x) => x !== d)
        : [...cfg.disabled_domains, d],
    });

  const disabledCount = cfg.disabled_domains.length;
  const cap = load?.max_concurrency ?? cfg.max_concurrency;
  const fillPct = load ? Math.min(100, Math.round((load.active / Math.max(1, cap)) * 100)) : 0;

  return (
    <div className="mx-auto max-w-5xl pb-28">
      {/* ── Hero kill switch ── */}
      <section className={cn(
        "relative overflow-hidden rounded-3xl border p-6 mb-5 transition-colors",
        cfg.chat_enabled
          ? "border-emerald-500/20 bg-gradient-to-br from-emerald-500/[0.07] via-card to-card"
          : "border-rose-500/30 bg-gradient-to-br from-rose-500/[0.12] via-card to-card"
      )}>
        <div className="flex items-center justify-between gap-4">
          <div className="flex items-center gap-4">
            <div className={cn(
              "flex h-12 w-12 items-center justify-center rounded-2xl ring-1",
              cfg.chat_enabled ? "bg-emerald-500/15 ring-emerald-500/30" : "bg-rose-500/15 ring-rose-500/30"
            )}>
              <Power className={cn("h-6 w-6", cfg.chat_enabled ? "text-emerald-400" : "text-rose-400")} />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h2 className="text-[17px] font-semibold text-foreground">AI Chat</h2>
                <span className={cn(
                  "flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-[11px] font-medium",
                  cfg.chat_enabled ? "bg-emerald-500/15 text-emerald-400" : "bg-rose-500/15 text-rose-400"
                )}>
                  <span className={cn("h-1.5 w-1.5 rounded-full", cfg.chat_enabled ? "bg-emerald-400 animate-pulse" : "bg-rose-400")} />
                  {cfg.chat_enabled ? "Live" : "Paused"}
                </span>
              </div>
              <p className="text-[13px] text-muted-foreground mt-0.5 max-w-md">
                {cfg.chat_enabled
                  ? "Users can chat with Centriq. Toggle off to instantly pause every request."
                  : "Every request returns a maintenance notice — zero LLM calls until you resume."}
              </p>
            </div>
          </div>
          <Toggle on={cfg.chat_enabled} onChange={(v) => setCfg({ ...cfg, chat_enabled: v })} />
        </div>
      </section>

      {/* ── Load throttle + live capacity bar ── */}
      <Card icon={<Gauge className="h-4 w-4" />} title="GPU Load Throttle"
        desc="Caps simultaneous generations on the shared server; extras queue, then get a fast “busy” signal. Applies within ~5s — no restart.">
        <div className="flex flex-wrap items-end gap-6">
          <NumField label="Max concurrency" value={cfg.max_concurrency} bounds={data.bounds.max_concurrency}
            onChange={(v) => setCfg({ ...cfg, max_concurrency: Number(v) || 1 })} />
          <NumField label="Max queue" value={cfg.max_queue} bounds={data.bounds.max_queue}
            onChange={(v) => setCfg({ ...cfg, max_queue: Number(v) || 0 })} />
          <div className="ml-auto min-w-[220px]">
            <div className="mb-1.5 flex items-center justify-between text-[11px] uppercase tracking-wider text-muted-foreground/60">
              <span>Live load</span>
              {load && <span className="text-foreground/70 normal-case tracking-normal">
                {load.active}/{cap} active · {load.waiting} queued
              </span>}
            </div>
            <div className="h-2.5 w-full overflow-hidden rounded-full bg-secondary">
              <div className={cn("h-full rounded-full transition-all duration-500",
                fillPct >= 90 ? "bg-rose-500" : fillPct >= 60 ? "bg-amber-400" : "bg-emerald-500")}
                style={{ width: `${load ? Math.max(fillPct, load.active > 0 ? 6 : 0) : 0}%` }} />
            </div>
          </div>
        </div>
      </Card>

      {/* ── Per-tier model params ── */}
      <Card icon={<Cpu className="h-4 w-4" />} title="Model Parameters"
        desc="Temperature, max tokens, and timeout are safe to tune anytime. Changing a tier’s model is an advanced action — see the warning below.">
        {/* Danger note for model swaps */}
        <div className="mb-4 flex items-start gap-2.5 rounded-xl border border-amber-500/20 bg-amber-500/[0.06] px-3.5 py-2.5">
          <ShieldAlert className="mt-0.5 h-4 w-4 shrink-0 text-amber-400" />
          <p className="text-[12px] text-amber-200/90">
            <span className="font-medium text-amber-300">Model changes are risky.</span>{" "}
            The <span className="font-medium">Agent</span> and <span className="font-medium">Router</span> tiers need
            a tool-calling model — picking one without it breaks routing and actions. Only models currently
            {data.models_live ? " loaded on the server" : " in the known list"} are selectable, and a change asks for confirmation.
          </p>
        </div>
        <div className="space-y-3">
          {data.tiers.map((tier) => {
            const t = cfg.tiers[tier];
            if (!t) return null;
            const meta = TIER_META[tier] ?? { label: tier, sub: "" };
            const modelChanged = t.model !== baseline.tiers[tier]?.model;
            const modelMissing = !data.models.includes(t.model);
            return (
              <div key={tier} className={cn(
                "rounded-2xl border bg-secondary/20 p-4 transition-colors",
                modelChanged ? "border-amber-500/30" : "border-[var(--border)]/60"
              )}>
                <div className="mb-3 flex items-center gap-2">
                  <span className="text-[13px] font-semibold text-foreground">{meta.label}</span>
                  {TOOLCALL_TIERS.has(tier) && (
                    <span className="flex items-center gap-1 rounded-md bg-primary/10 px-1.5 py-0.5 text-[10px] font-medium text-primary">
                      <Zap className="h-2.5 w-2.5" /> tool-calling
                    </span>
                  )}
                  <span className="text-[12px] text-muted-foreground">— {meta.sub}</span>
                </div>
                <div className="flex flex-wrap items-start gap-x-5 gap-y-3">
                  <div className="flex flex-col gap-1">
                    <label className="text-[11px] uppercase tracking-wider text-muted-foreground/60">Model</label>
                    <select
                      value={t.model}
                      onChange={(e) => setTier(tier, { model: e.target.value })}
                      className={cn(
                        "min-w-[200px] rounded-lg border bg-card px-3 py-1.5 text-[13px] text-foreground outline-none focus:border-primary",
                        modelChanged ? "border-amber-500/50" : "border-[var(--border)]"
                      )}
                    >
                      {!data.models.includes(t.model) && <option value={t.model}>{t.model} (not on server)</option>}
                      {data.models.map((m) => <option key={m} value={m}>{m}</option>)}
                    </select>
                    {modelMissing && (
                      <span className="flex items-center gap-1 text-[11px] text-rose-400">
                        <AlertTriangle className="h-3 w-3" /> not loaded on the server
                      </span>
                    )}
                    {modelChanged && !modelMissing && (
                      <span className="text-[11px] text-amber-400">changed — confirm on save</span>
                    )}
                  </div>
                  <SliderField label="Temperature" value={t.temperature} min={data.bounds.temperature[0]}
                    max={data.bounds.temperature[1]} step={0.1}
                    onChange={(v) => setTier(tier, { temperature: v })} />
                  <NumField label="Max tokens" value={t.max_tokens ?? ""} placeholder="default" nullable
                    bounds={data.bounds.max_tokens}
                    onChange={(v) => setTier(tier, { max_tokens: numOrNull(v) })} />
                  <NumField label="Timeout (s)" value={t.timeout ?? ""} placeholder="default" nullable
                    bounds={data.bounds.timeout}
                    onChange={(v) => setTier(tier, { timeout: numOrNull(v) })} />
                </div>
              </div>
            );
          })}
        </div>
      </Card>

      {/* ── Per-domain disable ── */}
      <Card icon={<SlidersHorizontal className="h-4 w-4" />} title="Domain Assistants"
        desc="Switch off individual assistants while the rest keep running. Disabled domains return a “temporarily unavailable” notice instead of an LLM response."
        badge={disabledCount > 0 ? `${disabledCount} off` : undefined}>
        <div className="flex flex-wrap gap-2.5">
          {data.domains.map((d) => {
            const off = cfg.disabled_domains.includes(d);
            return (
              <button
                key={d}
                onClick={() => toggleDomain(d)}
                className={cn(
                  "flex items-center gap-2 rounded-xl border px-3.5 py-2 text-[13px] font-medium transition-all active:scale-95",
                  off
                    ? "border-rose-500/30 bg-rose-500/10 text-rose-400"
                    : "border-emerald-500/25 bg-emerald-500/10 text-emerald-400 hover:bg-emerald-500/15"
                )}
              >
                {off ? <X className="h-3.5 w-3.5" /> : <Check className="h-3.5 w-3.5" />}
                {DOMAIN_LABELS[d] ?? d}
                <span className="text-[11px] opacity-60">{off ? "off" : "on"}</span>
              </button>
            );
          })}
        </div>
      </Card>

      {/* ── Sticky action bar ── */}
      <div className="sticky bottom-3 mt-5 rounded-2xl border border-[var(--border)] bg-background/85 px-5 py-3.5 shadow-lg backdrop-blur-md">
        <div className="flex items-center justify-between gap-4">
          <div className="text-[12px] text-muted-foreground">
            {dirty
              ? <span className="flex items-center gap-1.5 text-amber-400">
                  <span className="h-1.5 w-1.5 rounded-full bg-amber-400" /> Unsaved changes
                </span>
              : data.updated_by
                ? <>Last changed by <span className="text-foreground/80">{data.updated_by}</span>
                    {data.updated_at && <> · {new Date(data.updated_at).toLocaleString()}</>}</>
                : "Using environment defaults — no overrides set."}
          </div>
          <div className="flex items-center gap-2.5">
            <button
              onClick={reset}
              disabled={saving}
              className="flex items-center gap-1.5 rounded-lg border border-[var(--border)] px-3.5 py-2 text-[13px] text-muted-foreground hover:bg-secondary hover:text-foreground transition-colors disabled:opacity-50"
            >
              <RotateCcw className="h-3.5 w-3.5" /> Reset to defaults
            </button>
            <button
              onClick={onSaveClick}
              disabled={saving || !dirty}
              className="flex items-center gap-1.5 rounded-lg bg-primary px-4 py-2 text-[13px] font-medium text-primary-foreground hover:opacity-90 transition-opacity disabled:opacity-40"
            >
              {saving ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Check className="h-3.5 w-3.5" />}
              Save changes
            </button>
          </div>
        </div>
      </div>

      {/* ── Model-change confirmation ── */}
      {confirmModels && (
        <Modal onClose={() => setConfirmModels(null)}>
          <div className="flex items-start gap-3">
            <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-amber-500/15">
              <ShieldAlert className="h-5 w-5 text-amber-400" />
            </div>
            <div>
              <h3 className="text-[15px] font-semibold text-foreground">Confirm model change</h3>
              <p className="mt-1 text-[13px] text-muted-foreground">
                You’re switching the model for {confirmModels.length} tier{confirmModels.length > 1 ? "s" : ""}.
                This affects live chat immediately.
              </p>
            </div>
          </div>
          <ul className="my-4 space-y-2">
            {confirmModels.map((tier) => (
              <li key={tier} className="flex items-center justify-between rounded-lg border border-[var(--border)] bg-secondary/30 px-3 py-2 text-[13px]">
                <span className="flex items-center gap-2 font-medium text-foreground">
                  {TIER_META[tier]?.label ?? tier}
                  {TOOLCALL_TIERS.has(tier) && (
                    <span className="flex items-center gap-1 rounded bg-primary/10 px-1.5 py-0.5 text-[10px] text-primary">
                      <Zap className="h-2.5 w-2.5" /> needs tool-calling
                    </span>
                  )}
                </span>
                <span className="font-mono text-[12px] text-muted-foreground">
                  {baseline.tiers[tier]?.model} <span className="text-foreground/40">→</span>{" "}
                  <span className="text-foreground">{cfg.tiers[tier]?.model}</span>
                </span>
              </li>
            ))}
          </ul>
          {confirmModels.some((t) => TOOLCALL_TIERS.has(t)) && (
            <p className="mb-4 rounded-lg border border-amber-500/20 bg-amber-500/[0.06] px-3 py-2 text-[12px] text-amber-200/90">
              A tool-calling tier is changing. If the new model can’t call tools, routing or agent actions will fail.
            </p>
          )}
          <div className="flex justify-end gap-2.5">
            <button
              onClick={() => setConfirmModels(null)}
              className="rounded-lg border border-[var(--border)] px-4 py-2 text-[13px] text-muted-foreground hover:bg-secondary hover:text-foreground transition-colors"
            >
              Cancel
            </button>
            <button
              onClick={saveNow}
              disabled={saving}
              className="flex items-center gap-1.5 rounded-lg bg-amber-500 px-4 py-2 text-[13px] font-medium text-black hover:opacity-90 transition-opacity disabled:opacity-50"
            >
              {saving ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Check className="h-3.5 w-3.5" />}
              Apply change
            </button>
          </div>
        </Modal>
      )}
    </div>
  );
}

function Card({ icon, title, desc, badge, children }: {
  icon: ReactNode; title: string; desc: string; badge?: string; children: ReactNode;
}) {
  return (
    <section className="rounded-2xl border border-[var(--border)] bg-card p-5 mb-5">
      <div className="mb-3 flex items-start justify-between gap-3">
        <div className="flex items-center gap-2.5">
          <div className="flex h-7 w-7 items-center justify-center rounded-lg bg-secondary text-muted-foreground">{icon}</div>
          <div>
            <h3 className="text-[14px] font-semibold text-foreground">{title}</h3>
          </div>
        </div>
        {badge && <span className="rounded-full bg-rose-500/15 px-2.5 py-0.5 text-[11px] font-medium text-rose-400">{badge}</span>}
      </div>
      <p className="text-[12px] text-muted-foreground mb-4 leading-relaxed">{desc}</p>
      {children}
    </section>
  );
}

function Toggle({ on, onChange }: { on: boolean; onChange: (v: boolean) => void }) {
  return (
    <button
      onClick={() => onChange(!on)}
      className={cn(
        "relative h-7 w-[52px] shrink-0 rounded-full transition-colors",
        on ? "bg-emerald-500" : "bg-zinc-600"
      )}
    >
      <span className={cn(
        "absolute top-0.5 h-6 w-6 rounded-full bg-white shadow-sm transition-transform",
        on ? "translate-x-[24px]" : "translate-x-0.5"
      )} />
    </button>
  );
}

function SliderField({ label, value, onChange, min, max, step }: {
  label: string; value: number; onChange: (v: number) => void; min: number; max: number; step: number;
}) {
  return (
    <div className="flex flex-col gap-1">
      <label className="flex items-center justify-between gap-3 text-[11px] uppercase tracking-wider text-muted-foreground/60">
        <span>{label}</span>
        <span className="text-foreground/80 tabular-nums normal-case">{value}</span>
      </label>
      <input
        type="range"
        min={min} max={max} step={step} value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        className="h-1.5 w-40 cursor-pointer appearance-none rounded-full bg-secondary accent-primary"
      />
    </div>
  );
}

function NumField({ label, value, onChange, bounds, step, placeholder, nullable }: {
  label: string;
  value: number | string;
  onChange: (v: string) => void;
  bounds?: [number, number];
  step?: number;
  placeholder?: string;
  nullable?: boolean;
}) {
  return (
    <div className="flex flex-col gap-1">
      <label className="text-[11px] uppercase tracking-wider text-muted-foreground/60">
        {label}{bounds && <span className="ml-1 opacity-50">({bounds[0]}–{bounds[1]}{nullable ? " / blank" : ""})</span>}
      </label>
      <input
        type="number"
        value={value}
        step={step}
        min={bounds?.[0]}
        max={bounds?.[1]}
        placeholder={placeholder}
        onChange={(e) => onChange(e.target.value)}
        className="w-28 rounded-lg border border-[var(--border)] bg-card px-3 py-1.5 text-[13px] text-foreground focus:border-primary outline-none"
      />
    </div>
  );
}

function Modal({ children, onClose }: { children: ReactNode; onClose: () => void }) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4 backdrop-blur-sm" onClick={onClose}>
      <div className="w-full max-w-md rounded-2xl border border-[var(--border)] bg-card p-5 shadow-2xl" onClick={(e) => e.stopPropagation()}>
        {children}
      </div>
    </div>
  );
}
