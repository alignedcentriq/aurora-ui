import { useAuth } from "@/lib/auth-store";
import { useState, useEffect, useCallback, type ReactNode } from "react";
import {
  Check,
  X,
  Ticket,
  Package,
  Loader2,
  RefreshCw,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  SlidersHorizontal,
  Power,
  RotateCcw,
  AlertTriangle,
  ShieldAlert,
  Cpu,
  Gauge,
  Zap,
  Briefcase,
  ShieldCheck,
  Wrench,
  Calendar,
  Users,
  MessageSquare,
  HelpCircle,
  Plus,
  Minus,
  Undo,
  Info,
  Mail,
  HardDrive,
  Server,
  Layers,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell } from "@/components/ui/table";
import { DropdownMenu, DropdownMenuTrigger, DropdownMenuContent, DropdownMenuItem } from "@/components/ui/dropdown-menu";
import { Button } from "@/components/ui/button";
import { toast } from "sonner";
import { flyBanner } from "@/lib/fly-banner";
import { motion, AnimatePresence } from "framer-motion";

type Tab = "tickets" | "software";

import { StatusBadge } from "@/components/ui/StatusBadge";
import { FilterBar } from "@/components/ui/FilterBar";
import { TableLoader } from "@/components/ui/TableLoader";
import { TableEmpty } from "@/components/ui/TableEmpty";
import { Toggle } from "@/components/ui/toggle";

const PRIORITY_COLOR: Record<string, string> = {
  Low: "text-zinc-400",
  Medium: "text-amber-400",
  High: "text-orange-400",
  Critical: "text-rose-400",
};

const TICKET_STATUSES = ["Open", "Awaiting Approval", "In Progress", "Resolved", "Closed"];

export function ITPortal() {
  const { user } = useAuth();
  const isSuperAdmin = user?.role === "Super Admin";
  const isIT = user?.role === "IT";
  const [tab, setTab] = useState<Tab>("tickets");

  const authHeaders = {
    "Content-Type": "application/json",
    ...(user?.email ? { "x-user-email": user.email } : {}),
    ...(user?.role ? { "x-user-role": user.role.toLowerCase() } : {}),
  };

  if (!isIT && !isSuperAdmin) {
    return (
      <div className="flex h-full items-center justify-center text-muted-foreground">
        Access restricted to IT team.
      </div>
    );
  }

  const allTabs = [
    { id: "tickets" as Tab, label: "Support Tickets", icon: Ticket, adminOnly: false },
    { id: "software" as Tab, label: "Software Requests", icon: Package, adminOnly: false },
  ];

  const visibleTabs = allTabs.filter((t) => !t.adminOnly || isSuperAdmin);

  return (
    <div className="flex flex-col h-full overflow-hidden">
      {/* Header */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 px-8 py-6 border-b border-[var(--border)] shrink-0">
        <div>
          <p className="text-[13px] text-muted-foreground mt-0.5">
            Manage support tickets and software installation requests
          </p>
        </div>
      </div>

      {/* Tabs */}
      <Tabs defaultValue="tickets" value={tab} onValueChange={(v) => setTab(v as Tab)} className="flex flex-col flex-1 h-full overflow-hidden">
        <TabsList className="w-full justify-start px-8 py-3 h-auto rounded-none border-b border-[var(--border)] bg-transparent gap-1">
          {visibleTabs.map(({ id, label, icon: Icon }) => (
            <TabsTrigger 
              key={id} 
              value={id} 
              className="flex items-center gap-2 rounded-lg px-4 py-2 text-[13px] font-medium data-[state=active]:bg-primary/10 data-[state=active]:text-primary data-[state=active]:shadow-none data-[state=inactive]:text-muted-foreground data-[state=inactive]:hover:bg-secondary transition-colors"
            >
              <Icon className="h-3.5 w-3.5" />
              {label}
            </TabsTrigger>
          ))}
        </TabsList>

        <div className="flex-1 overflow-auto px-8 py-6">
          <TabsContent value="tickets" className="m-0 h-full data-[state=inactive]:hidden"><TicketsTab authHeaders={authHeaders} /></TabsContent>
          <TabsContent value="software" className="m-0 h-full data-[state=inactive]:hidden"><SoftwareTab authHeaders={authHeaders} /></TabsContent>
        </div>
      </Tabs>
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
    } catch {
      toast.error("Failed to load");
    } finally {
      setLoading(false);
    }
  }, [filter]);

  useEffect(() => {
    fetch_();
  }, [fetch_]);

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
    } catch (e: unknown) {
      toast.error(e instanceof Error ? e.message : "Failed");
    } finally {
      setActing(null);
    }
  };

  return (
    <div>
      <FilterBar
        filter={filter}
        setFilter={setFilter}
        options={["Open", "In Progress", "Awaiting Approval", "Resolved", "All"]}
        onRefresh={fetch_}
        variant="tabs"
      />
      {loading ? (
        <TableLoader />
      ) : items.length === 0 ? (
        <TableEmpty label="tickets" />
      ) : (
        <Table paginate itemsPerPage={10}>
          <TableHeader>
            <TableRow>
              {[
                "Ticket ID",
                "Employee",
                "Category",
                "Subject",
                "Priority",
                "Status",
                "Raised On",
                "Update Status",
              ].map((h) => (
                <TableHead key={h}>{h}</TableHead>
              ))}
            </TableRow>
          </TableHeader>
          <TableBody>
            {items.map((t) => (
              <TableRow key={t.id}>
                <TableCell className="font-mono text-[12px] text-primary">{t.ticket_id}</TableCell>
                <TableCell>
                  <div className="font-medium text-foreground">{t.employee_name}</div>
                  <div className="text-[11px] text-muted-foreground">{t.employee_email}</div>
                </TableCell>
                <TableCell className="text-foreground/80">{t.category}</TableCell>
                <TableCell className="text-foreground/80 max-w-[180px] truncate" title={t.subject}>
                  {t.subject}
                </TableCell>
                <TableCell>
                  <span className={cn("text-[12px] font-medium", PRIORITY_COLOR[t.priority] ?? "text-zinc-400")}>
                    {t.priority}
                  </span>
                </TableCell>
                <TableCell>
                  <StatusBadge status={t.status} />
                </TableCell>
                <TableCell className="text-foreground/50">{t.created_at.slice(0, 10)}</TableCell>
                <TableCell>
                  {acting === t.ticket_id ? (
                    <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
                  ) : (
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild>
                        <Button variant="outline" size="sm" className="h-8 gap-1.5 text-[12px]">
                          {t.status}
                          <ChevronDown className="h-3 w-3" />
                        </Button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="end">
                        {TICKET_STATUSES.filter((s) => s !== t.status).map((s) => (
                          <DropdownMenuItem key={s} onClick={() => updateStatus(t.ticket_id, s)}>
                            {s}
                          </DropdownMenuItem>
                        ))}
                      </DropdownMenuContent>
                    </DropdownMenu>
                  )}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
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
    } catch {
      toast.error("Failed to load");
    } finally {
      setLoading(false);
    }
  }, [filter]);

  useEffect(() => {
    fetch_();
  }, [fetch_]);

  const act = async (id: number, type: "approve" | "reject") => {
    setActing(id);
    try {
      const res = await fetch(`/api/it/portal/software-requests/${id}/${type}`, {
        method: "PUT",
        headers: authHeaders,
      });
      if (!res.ok) throw new Error((await res.json().catch(() => ({}))).detail || "Failed");
      if (type === "approve") flyBanner("Software request approved");
      else toast.success("Software request rejected");
      fetch_();
    } catch (e: unknown) {
      toast.error(e instanceof Error ? e.message : "Failed");
    } finally {
      setActing(null);
    }
  };

  return (
    <div>
      <FilterBar
        filter={filter}
        setFilter={setFilter}
        options={["Pending", "Approved", "Rejected", "All"]}
        onRefresh={fetch_}
        variant="tabs"
      />
      {loading ? (
        <TableLoader />
      ) : items.length === 0 ? (
        <TableEmpty label="software requests" />
      ) : (
        <Table paginate itemsPerPage={10}>
          <TableHeader>
            <TableRow>
              {[
                "Employee",
                "Software",
                "Version",
                "Justification",
                "Admin Req.",
                "Status",
                "Actions",
              ].map((h) => (
                <TableHead key={h}>{h}</TableHead>
              ))}
            </TableRow>
          </TableHeader>
          <TableBody>
            {items.map((sr) => (
              <TableRow key={sr.id}>
                <TableCell>
                  <div className="font-medium text-foreground">{sr.employee_name}</div>
                  <div className="text-[11px] text-muted-foreground">{sr.employee_email}</div>
                </TableCell>
                <TableCell className="font-medium text-foreground">{sr.software_name}</TableCell>
                <TableCell className="text-foreground/60 font-mono text-[12px]">
                  {sr.version || "—"}
                </TableCell>
                <TableCell className="text-foreground/60 max-w-[200px] truncate" title={sr.justification}>
                  {sr.justification}
                </TableCell>
                <TableCell className="text-center">
                  <span className={cn("text-[12px] font-medium", sr.requires_admin ? "text-amber-400" : "text-emerald-400")}>
                    {sr.requires_admin ? "Yes" : "No"}
                  </span>
                </TableCell>
                <TableCell>
                  <StatusBadge status={sr.status} />
                </TableCell>
                <TableCell>
                  {sr.status === "Pending" ? (
                    <div className="flex items-center gap-1.5">
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => act(sr.id, "approve")}
                        disabled={acting === sr.id}
                        className="h-8 gap-1 border-emerald-500/20 bg-emerald-500/10 text-emerald-500 hover:bg-emerald-500/20 hover:text-emerald-600"
                      >
                        {acting === sr.id ? <Loader2 className="h-3 w-3 animate-spin" /> : <Check className="h-3 w-3" />}
                        Approve
                      </Button>
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => act(sr.id, "reject")}
                        disabled={acting === sr.id}
                        className="h-8 gap-1 border-rose-500/20 bg-rose-500/10 text-rose-500 hover:bg-rose-500/20 hover:text-rose-600"
                      >
                        <X className="h-3 w-3" />
                        Reject
                      </Button>
                    </div>
                  ) : (
                    <span className="text-muted-foreground/40 text-[12px]">
                      {sr.approved_by ? `by ${sr.approved_by}` : "—"}
                    </span>
                  )}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}
    </div>
  );
}

// ── Model Controls Tab ──────────────────────────────────────────────────────────
// IT levers over the AI: kill switch, GPU load throttle, per-tier model params, and
// per-domain disable. Reads/writes /api/it/llm-controls; polls /api/chat/load live.

interface TierCfg {
  model: string;
  temperature: number;
  max_tokens: number | null;
  timeout: number | null;
}
interface LlmCfg {
  chat_enabled: boolean;
  disabled_domains: string[];
  max_concurrency: number;
  max_queue: number;
  tiers: Record<string, TierCfg>;
}
interface TierCallDefaults {
  max_tokens: number | null;
  timeout: number | null;
}
interface LlmControlsResponse {
  effective: LlmCfg;
  defaults: LlmCfg;
  tier_call_defaults: Record<string, TierCallDefaults>;
  bounds: Record<string, [number, number]>;
  models: string[];
  models_live: boolean;
  domains: string[];
  tiers: string[];
  updated_by: string | null;
  updated_at: string | null;
}

const TIER_META: Record<
  string,
  { label: string; sub: string; icon: React.ComponentType<{ className?: string }> }
> = {
  agent: { label: "Agent", sub: "Reasoning & tool calling — HR, MS365, deep-links", icon: Zap },
  service: {
    label: "Domain Service Agents",
    sub: "Tool calling — Admin, IT, PMO, Manager",
    icon: Cpu,
  },
  router: { label: "Router", sub: "Intent-router LLM fallback", icon: SlidersHorizontal },
  general: { label: "General", sub: "Greetings, announcements, policy Q&A", icon: MessageSquare },
  summarizer: { label: "Summarizer", sub: "Context & tool-result summaries", icon: Package },
};

// Tiers whose models MUST support tool-calling / structured output
const TOOLCALL_TIERS = new Set(["agent", "service", "router"]);

// Per-tier capability requirements — mirrors backend TIER_REQUIREMENTS
const TIER_REQUIREMENTS: Record<string, { caps: string[]; hint: string }> = {
  agent: { caps: ["tools"], hint: "tool-calling (HR & MS365 reasoning)" },
  service: { caps: ["tools"], hint: "tool-calling (Admin, IT, PMO, Manager)" },
  router: { caps: ["tools"], hint: "structured output for intent detection" },
  general: { caps: [], hint: "" },
  summarizer: { caps: [], hint: "" },
};

const DOMAIN_LABELS: Record<string, string> = {
  hr: "HR",
  admin: "Admin Services",
  it_support: "IT Support",
  pmo: "PMO",
  ms365: "Microsoft 365",
  functional_manager: "Manager",
};

const DOMAIN_ICONS: Record<string, React.ComponentType<{ className?: string }>> = {
  hr: Briefcase,
  admin: ShieldCheck,
  it_support: Wrench,
  pmo: Calendar,
  ms365: Mail,
  functional_manager: Users,
};

const DOMAIN_DESCS: Record<string, string> = {
  hr: "Handles employee requests, leave balances, policies, and benefits Q&A.",
  admin: "Assists with workplace amenities, visitors, parking, and logistics.",
  it_support: "Diagnoses tech issues, checks service status, and logs tickets.",
  pmo: "Tracks tasks, projects, schedules, and team progress.",
  ms365: "Integrates with outlook, emails, calendar events, and document search.",
  functional_manager: "Coordinates manager approvals, team workload, and feedback.",
};

interface CapCheck {
  checking: boolean;
  capabilities: string[] | null;
  error: string | null;
  model: string;
}

// Live capacity picture from GET /api/it/llm-controls/capacity.
interface OllamaModelResidency {
  name: string;
  size: number;
  size_vram: number;
  size_cpu: number;
  gpu_pct: number;
  placement: "gpu" | "partial" | "cpu";
  context_length: number | null;
  expires_at: string | null;
}
interface LiveRequest {
  email?: string;
  snippet?: string;
  since?: number;
  elapsed_s?: number;
  position?: number;
}
interface CapacityInfo {
  gate: {
    active: number;
    waiting: number;
    max_concurrency: number;
    max_queue: number;
    running?: LiveRequest[];
    waiting_list?: LiveRequest[];
  };
  ollama: { reachable: boolean; models: OllamaModelResidency[]; error: string | null };
  capacity: {
    max_concurrency: number;
    max_queue: number;
    loaded_models: number;
    ollama_parallel: {
      num_parallel: number | null;
      max_loaded_models: number | null;
      max_queue: number | null;
    };
    server_capacity: {
      recommended: number;
      hard: number | null;
      basis: string;
    };
  };
}

const fmtElapsed = (s?: number): string => {
  if (s == null || !Number.isFinite(s)) return "";
  if (s < 60) return `${Math.round(s)}s`;
  return `${Math.floor(s / 60)}m ${Math.round(s % 60)}s`;
};

const fmtGB = (bytes: number): string =>
  bytes >= 1e9 ? `${(bytes / 1e9).toFixed(1)} GB` : `${Math.round(bytes / 1e6)} MB`;

export function ModelControlsTab({ authHeaders }: { authHeaders: Record<string, string> }) {
  const [data, setData] = useState<LlmControlsResponse | null>(null);
  const [cfg, setCfg] = useState<LlmCfg | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [confirmModels, setConfirmModels] = useState<string[] | null>(null);
  const [load, setLoad] = useState<{
    active: number;
    waiting: number;
    max_concurrency: number;
    ml01_load_rejects?: { count: number; last_at: number | null; recent: boolean };
  } | null>(null);
  const [capacity, setCapacity] = useState<CapacityInfo | null>(null);
  const [capChecks, setCapChecks] = useState<Record<string, CapCheck>>({});

  const fetch_ = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/it/llm-controls", { headers: authHeaders });
      if (!res.ok) throw new Error("Failed to load");
      const d: LlmControlsResponse = await res.json();
      setData(d);
      setCfg(d.effective);
    } catch {
      toast.error("Failed to load model controls");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetch_();
  }, [fetch_]);

  const checkModelCaps = useCallback(
    async (tier: string, model: string) => {
      setCapChecks((prev) => ({
        ...prev,
        [tier]: { checking: true, capabilities: null, error: null, model },
      }));
      try {
        const res = await fetch(
          `/api/it/llm-controls/model-capabilities?model=${encodeURIComponent(model)}`,
          { headers: authHeaders },
        );
        const d = await res.json();
        setCapChecks((prev) => ({
          ...prev,
          [tier]: {
            checking: false,
            capabilities: d.capabilities ?? null,
            error: d.error ?? null,
            model,
          },
        }));
      } catch {
        setCapChecks((prev) => ({
          ...prev,
          [tier]: { checking: false, capabilities: null, error: "Could not reach server", model },
        }));
      }
    },
    [authHeaders],
  );

  // Live load meter — poll the existing concurrency-gate stats endpoint.
  useEffect(() => {
    let active = true;
    const tick = async () => {
      try {
        const res = await fetch("/api/chat/load", { headers: authHeaders });
        if (res.ok && active) setLoad(await res.json());
      } catch {
        /* ignore transient */
      }
    };
    tick();
    const id = setInterval(tick, 3000);
    return () => {
      active = false;
      clearInterval(id);
    };
  }, []);

  // Real capacity picture — app queue + Ollama GPU/CPU residency (cached ~3s server-side).
  useEffect(() => {
    let active = true;
    const tick = async () => {
      try {
        const res = await fetch("/api/it/llm-controls/capacity", { headers: authHeaders });
        if (res.ok && active) setCapacity(await res.json());
      } catch {
        /* ignore transient */
      }
    };
    tick();
    const id = setInterval(tick, 4000);
    return () => {
      active = false;
      clearInterval(id);
    };
  }, []);

  const applyResponse = (d: {
    effective: LlmCfg;
    updated_by: string | null;
    updated_at: string | null;
  }) => {
    setCfg(d.effective);
    setData((prev) =>
      prev
        ? { ...prev, effective: d.effective, updated_by: d.updated_by, updated_at: d.updated_at }
        : prev,
    );
  };

  const saveNow = async () => {
    if (!cfg) return;
    setSaving(true);
    try {
      const res = await fetch("/api/it/llm-controls", {
        method: "PUT",
        headers: authHeaders,
        body: JSON.stringify(cfg),
      });
      if (!res.ok) throw new Error((await res.json().catch(() => ({}))).detail || "Save failed");
      applyResponse(await res.json());
      flyBanner("Model controls updated");
    } catch (e: unknown) {
      toast.error(e instanceof Error ? e.message : "Save failed");
    } finally {
      setSaving(false);
      setConfirmModels(null);
    }
  };

  const reset = async () => {
    setSaving(true);
    try {
      const res = await fetch("/api/it/llm-controls/reset", {
        method: "POST",
        headers: authHeaders,
      });
      if (!res.ok) throw new Error("Reset failed");
      applyResponse(await res.json());
      toast.success("Reverted to defaults");
    } catch (e: unknown) {
      toast.error(e instanceof Error ? e.message : "Reset failed");
    } finally {
      setSaving(false);
    }
  };

  if (loading || !cfg || !data) return <TableLoader />;

  const baseline = data.effective;
  const dirty = JSON.stringify(cfg) !== JSON.stringify(baseline);
  const changedModelTiers = data.tiers.filter(
    (t) => cfg.tiers[t]?.model !== baseline.tiers[t]?.model,
  );

  const onSaveClick = () => {
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

  const discardEdits = () => {
    setCfg(JSON.parse(JSON.stringify(data.effective)));
    setCapChecks({});
    toast.success("Discarded unsaved changes");
  };

  const disabledCount = cfg.disabled_domains.length;
  const cap = load?.max_concurrency ?? cfg.max_concurrency;
  const fillPct = load ? Math.min(100, Math.round((load.active / Math.max(1, cap)) * 100)) : 0;

  // Capacity validation: max_concurrency must not exceed what the shared server can serve.
  const svrCap = capacity?.capacity.server_capacity ?? null;
  const overHardConc = svrCap?.hard != null && cfg.max_concurrency > svrCap.hard;
  const overRecommendedConc =
    svrCap != null && !overHardConc && cfg.max_concurrency > svrCap.recommended;

  // Compile list of unsaved changes
  const pendingChanges: { label: string; details: string }[] = [];
  if (cfg.chat_enabled !== baseline.chat_enabled) {
    pendingChanges.push({
      label: "AI Chat Status",
      details: cfg.chat_enabled ? "Paused → Live" : "Live → Paused",
    });
  }
  if (cfg.max_concurrency !== baseline.max_concurrency) {
    pendingChanges.push({
      label: "Max Concurrency",
      details: `${baseline.max_concurrency} → ${cfg.max_concurrency}`,
    });
  }
  if (cfg.max_queue !== baseline.max_queue) {
    pendingChanges.push({
      label: "Max Queue",
      details: `${baseline.max_queue} → ${cfg.max_queue}`,
    });
  }
  data.tiers.forEach((tier) => {
    const t = cfg.tiers[tier];
    const b = baseline.tiers[tier];
    if (t && b) {
      if (t.model !== b.model) {
        pendingChanges.push({
          label: `${TIER_META[tier]?.label ?? tier} Model`,
          details: `${b.model} → ${t.model}`,
        });
      }
      if (t.temperature !== b.temperature) {
        pendingChanges.push({
          label: `${TIER_META[tier]?.label ?? tier} Temp`,
          details: `${b.temperature} → ${t.temperature}`,
        });
      }
      if (t.max_tokens !== b.max_tokens) {
        const callDef = data?.tier_call_defaults?.[tier];
        const defTok =
          callDef?.max_tokens != null ? `default (${callDef.max_tokens})` : "default (no limit)";
        pendingChanges.push({
          label: `${TIER_META[tier]?.label ?? tier} Max Tokens`,
          details: `${b.max_tokens ?? defTok} → ${t.max_tokens ?? defTok}`,
        });
      }
      if (t.timeout !== b.timeout) {
        const callDef = data?.tier_call_defaults?.[tier];
        const defTimeout = callDef?.timeout != null ? `default (${callDef.timeout} s)` : "default";
        pendingChanges.push({
          label: `${TIER_META[tier]?.label ?? tier} Timeout`,
          details: `${b.timeout != null ? `${b.timeout} s` : defTimeout} → ${t.timeout != null ? `${t.timeout} s` : defTimeout}`,
        });
      }
    }
  });
  data.domains.forEach((d) => {
    const offCfg = cfg.disabled_domains.includes(d);
    const offBase = baseline.disabled_domains.includes(d);
    if (offCfg !== offBase) {
      pendingChanges.push({
        label: `${DOMAIN_LABELS[d] ?? d} Domain`,
        details: offCfg ? "Enabled → Disabled" : "Disabled → Enabled",
      });
    }
  });

  return (
    <div className="w-full pb-28">
      {/* ── Hero kill switch ── */}
      <motion.section
        initial={{ opacity: 0, y: 10 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.4 }}
        className={cn(
          "relative overflow-hidden rounded-3xl border p-6 mb-6 transition-all duration-500 shadow-md",
          cfg.chat_enabled
            ? "border-emerald-500/25 bg-gradient-to-br from-emerald-500/[0.08] via-card to-card"
            : "border-rose-500/30 bg-gradient-to-br from-rose-500/[0.12] via-card to-card",
        )}
      >
        {/* Futuristic glowing mesh underlay when active */}
        {cfg.chat_enabled && (
          <div className="absolute inset-0 bg-grid-white/[0.02] bg-[size:20px_20px] pointer-events-none opacity-40 animate-pulse-glow" />
        )}
        {!cfg.chat_enabled && (
          <div className="absolute inset-0 bg-grid-white/[0.01] bg-[size:20px_20px] pointer-events-none opacity-20" />
        )}

        <div className="relative z-10 flex flex-col sm:flex-row sm:items-center justify-between gap-6">
          <div className="flex items-start gap-4">
            <div
              className={cn(
                "flex h-14 w-14 shrink-0 items-center justify-center rounded-2xl ring-1 shadow-inner transition-all duration-500",
                cfg.chat_enabled
                  ? "bg-emerald-500/15 ring-emerald-500/30 text-emerald-400 shadow-[0_0_15px_rgba(16,185,129,0.2)]"
                  : "bg-rose-500/15 ring-rose-500/30 text-rose-400",
              )}
            >
              <Power
                className={cn(
                  "h-7 w-7 transition-transform duration-500",
                  cfg.chat_enabled ? "rotate-0 scale-110" : "rotate-45 scale-100",
                )}
              />
            </div>
            <div>
              <div className="flex flex-wrap items-center gap-2.5">
                <h2 className="text-[18px] font-bold text-foreground">AI Chat Engine</h2>
                <span
                  className={cn(
                    "flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-[11px] font-semibold border transition-all duration-500",
                    cfg.chat_enabled
                      ? "bg-emerald-500/15 text-emerald-400 border-emerald-500/20"
                      : "bg-rose-500/15 text-rose-400 border-rose-500/25",
                  )}
                >
                  <span
                    className={cn(
                      "h-1.5 w-1.5 rounded-full",
                      cfg.chat_enabled ? "bg-emerald-400 animate-ping" : "bg-rose-400",
                    )}
                  />
                  <span
                    className={cn(
                      "h-1.5 w-1.5 rounded-full absolute",
                      cfg.chat_enabled ? "bg-emerald-400" : "bg-rose-400",
                    )}
                  />
                  <span className="ml-1">
                    {cfg.chat_enabled ? "LIVE & OPERATIONAL" : "PAUSED & SHIELDED"}
                  </span>
                </span>
              </div>
              <p className="text-[13px] text-muted-foreground mt-1 max-w-xl leading-relaxed">
                {cfg.chat_enabled
                  ? "Global gate is active. Employees are actively generating answers, scheduling calendar events, and querying workspace documents."
                  : "All chat operations are halted. Users see a friendly maintenance message. No API calls or token consumption will occur."}
              </p>
            </div>
          </div>
          <div className="flex items-center self-end sm:self-center">
            <Toggle
              on={cfg.chat_enabled}
              onChange={(v) => setCfg({ ...cfg, chat_enabled: v })}
              activeColor="bg-emerald-500"
              inactiveColor="bg-zinc-600"
            />
          </div>
        </div>
      </motion.section>

      {/* ── Load throttle + live capacity bar ── */}
      <Card
        icon={<Gauge className="h-4 w-4 text-primary" />}
        title="GPU Load Throttle"
        desc="Adjust system-wide limits for parallel generations. Extra incoming requests enter a queue before receiving a busy signal. Applied instantly."
      >
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-center">
          <div className="lg:col-span-7">
            <div className="flex flex-wrap gap-6">
              <NumField
                label="Max concurrency"
                value={cfg.max_concurrency}
                bounds={data.bounds.max_concurrency}
                onChange={(v) => setCfg({ ...cfg, max_concurrency: Number(v) || 1 })}
                className="w-full sm:w-48"
              />
              <NumField
                label="Max queue size"
                value={cfg.max_queue}
                bounds={data.bounds.max_queue}
                onChange={(v) => setCfg({ ...cfg, max_queue: Number(v) || 0 })}
                className="w-full sm:w-48"
              />
            </div>
            {/* Server-capacity validation — can't admit more than ml01 can serve */}
            {svrCap && (overHardConc || overRecommendedConc) && (
              <div
                className={cn(
                  "mt-4 flex items-start gap-2 rounded-xl border p-3 text-[12px] leading-relaxed",
                  overHardConc
                    ? "border-rose-200 dark:border-rose-500/20 bg-rose-50 dark:bg-rose-500/[0.05] text-rose-700 dark:text-rose-300"
                    : "border-amber-200 dark:border-amber-500/20 bg-amber-50 dark:bg-amber-500/[0.05] text-amber-800 dark:text-amber-200/90",
                )}
              >
                <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
                <span>
                  {overHardConc ? (
                    <>
                      <span className="font-bold">Exceeds server capacity.</span> The shared server
                      can serve at most <span className="font-semibold">{svrCap.hard}</span>{" "}
                      concurrent generations. Requests above this pile onto the GPU and slow everyone
                      down — saving is blocked until you lower it.
                    </>
                  ) : (
                    <>
                      <span className="font-bold">Above the recommended ceiling of{" "}
                      {svrCap.recommended}.</span> ml01 is a shared server and likely can't serve
                      this many in parallel. Keep it at {svrCap.recommended} or below unless you know
                      capacity has increased.
                    </>
                  )}
                  <span className="mt-1 block text-[11px] opacity-70">Basis: {svrCap.basis}</span>
                </span>
              </div>
            )}
          </div>

          <div className="lg:col-span-5 border-t lg:border-t-0 lg:border-l border-[var(--border)]/50 pt-4 lg:pt-0 lg:pl-6">
            <div className="mb-2 flex items-center justify-between text-[11px] uppercase tracking-wider text-muted-foreground/60 font-semibold">
              <span className="flex items-center gap-1.5">
                <span
                  className={cn(
                    "h-1.5 w-1.5 rounded-full",
                    fillPct >= 90
                      ? "bg-rose-500 animate-pulse"
                      : fillPct >= 60
                        ? "bg-amber-400"
                        : "bg-emerald-500",
                  )}
                />
                Live GPU workload
              </span>
              {load && (
                <span className="text-foreground/80 font-mono normal-case tracking-normal text-[12px]">
                  {load.active}/{cap} Active · {load.waiting} Queued
                </span>
              )}
            </div>

            {/* Equalizer-like segmented glow bar graph */}
            <div className="flex gap-1.5 h-3 items-center">
              {Array.from({ length: 12 }).map((_, i) => {
                const stepPct = (i / 12) * 100;
                const active = fillPct >= stepPct;
                let colorClass = "bg-secondary dark:bg-secondary/40";

                if (active) {
                  if (fillPct >= 90)
                    colorClass = "bg-rose-500 shadow-[0_0_8px_rgba(239,68,68,0.6)]";
                  else if (fillPct >= 60)
                    colorClass = "bg-amber-400 shadow-[0_0_8px_rgba(251,191,36,0.6)]";
                  else colorClass = "bg-emerald-500 shadow-[0_0_8px_rgba(16,185,129,0.6)]";
                }

                return (
                  <div
                    key={i}
                    className={cn("h-3 flex-1 rounded-sm transition-all duration-300", colorClass)}
                  />
                );
              })}
            </div>

            <div className="mt-2 flex justify-between text-[9px] text-muted-foreground/45 font-mono">
              <span>0% LOAD</span>
              <span>100% THROTTLE</span>
            </div>
          </div>
        </div>
      </Card>

      {/* ── Real server capacity + live GPU/CPU queue ── */}
      <Card
        icon={<Server className="h-4 w-4 text-primary" />}
        title="Server Capacity & Live Queue"
        desc="What the shared LLM server (ml01) is actually doing right now — real GPU/CPU model placement, the live request queue, and how many requests it will serve at once. Distinct from the throttle above, which is our app-side admission cap."
      >
        {(() => {
          const c = capacity;
          const gate = c?.gate;
          const models = c?.ollama.models ?? [];
          const par = c?.capacity.ollama_parallel;
          const onCpu = models.filter((m) => m.placement !== "gpu");

          return (
            <div className="flex flex-col gap-6">
              {/* Capacity summary tiles */}
              <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
                {[
                  {
                    label: "Concurrent slots",
                    value: c ? String(c.capacity.max_concurrency) : "—",
                    sub: "served at once (app cap)",
                    icon: Layers,
                  },
                  {
                    label: "Queue depth",
                    value: c ? String(c.capacity.max_queue) : "—",
                    sub: "wait before busy signal",
                    icon: SlidersHorizontal,
                  },
                  {
                    label: "Models resident",
                    value: c ? String(c.capacity.loaded_models) : "—",
                    sub: "loaded on ml01 now",
                    icon: Cpu,
                  },
                  {
                    label: "Ollama parallel",
                    value: par?.num_parallel != null ? String(par.num_parallel) : "server-set",
                    sub: par?.num_parallel != null ? "per-model on ml01" : "not visible here",
                    icon: Server,
                  },
                ].map((t) => (
                  <div
                    key={t.label}
                    className="rounded-2xl border border-[var(--border)] bg-card/60 p-4"
                  >
                    <div className="flex items-center gap-1.5 text-[11px] uppercase tracking-wider text-muted-foreground/60 font-semibold">
                      <t.icon className="h-3.5 w-3.5" />
                      {t.label}
                    </div>
                    <div className="mt-1.5 text-2xl font-bold text-foreground tabular-nums">
                      {t.value}
                    </div>
                    <div className="text-[11px] text-muted-foreground/70 mt-0.5">{t.sub}</div>
                  </div>
                ))}
              </div>

              {/* Live request queue (real admission gate) */}
              <div className="rounded-2xl border border-[var(--border)] bg-card/60 p-4">
                <div className="flex items-center justify-between mb-3">
                  <span className="flex items-center gap-1.5 text-[13px] font-semibold text-foreground">
                    <Gauge className="h-4 w-4 text-primary" />
                    Request queue
                  </span>
                  {gate && (
                    <span className="font-mono text-[12px] text-foreground/80">
                      {gate.active}/{gate.max_concurrency} running
                      <span className="text-muted-foreground/60">
                        {" · "}
                        {gate.waiting} waiting
                      </span>
                    </span>
                  )}
                </div>
                {/* Running slots as filled/empty pills */}
                <div className="flex flex-wrap gap-1.5">
                  {gate
                    ? Array.from({ length: Math.min(gate.max_concurrency, 20) }).map((_, i) => (
                        <div
                          key={i}
                          className={cn(
                            "h-2.5 w-2.5 rounded-full transition-colors",
                            i < gate.active
                              ? "bg-emerald-500 shadow-[0_0_6px_rgba(16,185,129,0.5)]"
                              : "bg-secondary dark:bg-secondary/40",
                          )}
                        />
                      ))
                    : null}
                </div>
                {gate && gate.waiting > 0 && (
                  <div className="mt-3 flex items-center gap-2 text-[12px] text-amber-600 dark:text-amber-400">
                    <AlertTriangle className="h-3.5 w-3.5" />
                    {gate.waiting} request{gate.waiting === 1 ? "" : "s"} queued and waiting for a
                    free slot.
                  </div>
                )}
                {gate && gate.waiting === 0 && gate.active === 0 && (
                  <div className="mt-3 text-[12px] text-muted-foreground/70">
                    Idle — no requests running or queued right now.
                  </div>
                )}
                {/* Who exactly is running / waiting (from the gate's per-request identity) */}
                {gate && ((gate.running?.length ?? 0) > 0 || (gate.waiting_list?.length ?? 0) > 0) && (
                  <div className="mt-3 flex flex-col gap-1.5">
                    {(gate.running ?? []).map((r, i) => (
                      <div
                        key={`run-${i}`}
                        className="flex items-center gap-2 rounded-lg bg-secondary/40 dark:bg-secondary/20 px-2.5 py-1.5 text-[12px]"
                      >
                        <span className="h-2 w-2 shrink-0 rounded-full bg-emerald-500 shadow-[0_0_5px_rgba(16,185,129,0.5)]" />
                        <span className="shrink-0 font-mono font-medium text-foreground/90">
                          {r.email ?? "unknown"}
                        </span>
                        <span className="min-w-0 flex-1 truncate text-muted-foreground/70">
                          {r.snippet ?? ""}
                        </span>
                        <span className="shrink-0 font-mono text-[11px] text-muted-foreground/60">
                          {fmtElapsed(r.elapsed_s)}
                        </span>
                      </div>
                    ))}
                    {(gate.waiting_list ?? []).map((w, i) => (
                      <div
                        key={`wait-${i}`}
                        className="flex items-center gap-2 rounded-lg bg-secondary/40 dark:bg-secondary/20 px-2.5 py-1.5 text-[12px]"
                      >
                        <span className="shrink-0 font-mono text-[11px] font-semibold text-amber-600 dark:text-amber-400">
                          #{w.position ?? i + 1}
                        </span>
                        <span className="shrink-0 font-mono font-medium text-foreground/90">
                          {w.email ?? "unknown"}
                        </span>
                        <span className="min-w-0 flex-1 truncate text-muted-foreground/70">
                          {w.snippet ?? ""}
                        </span>
                        <span className="shrink-0 font-mono text-[11px] text-muted-foreground/60">
                          waiting {fmtElapsed(w.elapsed_s)}
                        </span>
                      </div>
                    ))}
                  </div>
                )}
              </div>

              {/* ml01 refusing to load models — the "server busy on an idle box" condition */}
              {load?.ml01_load_rejects?.recent && (
                <div className="rounded-2xl border border-rose-200 dark:border-rose-500/20 bg-rose-50 dark:bg-rose-500/[0.05] p-4 text-[12px] text-rose-700 dark:text-rose-300">
                  <div className="flex items-center gap-2 font-semibold">
                    <AlertTriangle className="h-3.5 w-3.5 shrink-0" />
                    ml01 is rejecting model loads
                  </div>
                  <p className="mt-1.5 leading-relaxed">
                    The Ollama server is refusing to load any model that isn&apos;t already in
                    memory (&ldquo;maximum pending requests exceeded&rdquo;) even when it is otherwise
                    idle — its load queue is wedged or misconfigured. Chats are being answered
                    by whichever model is still resident. Ask the ml01 admin to restart Ollama
                    and check OLLAMA_MAX_QUEUE / free GPU memory.{" "}
                    ({load.ml01_load_rejects.count} reject
                    {load.ml01_load_rejects.count === 1 ? "" : "s"} since backend start)
                  </p>
                </div>
              )}

              {/* Real GPU / CPU model placement */}
              <div>
                <div className="flex items-center justify-between mb-3">
                  <span className="flex items-center gap-1.5 text-[13px] font-semibold text-foreground">
                    <HardDrive className="h-4 w-4 text-primary" />
                    GPU / CPU placement
                  </span>
                  <span className="text-[11px] text-muted-foreground/60">
                    live from ml01 /api/ps
                  </span>
                </div>

                {!c ? (
                  <div className="rounded-2xl border border-[var(--border)] bg-card/60 p-4 text-[12px] text-muted-foreground/70">
                    Loading server state…
                  </div>
                ) : !c.ollama.reachable ? (
                  <div className="rounded-2xl border border-rose-200 dark:border-rose-500/20 bg-rose-50 dark:bg-rose-500/[0.05] p-4 text-[12px] text-rose-700 dark:text-rose-300">
                    Ollama server unreachable{c.ollama.error ? ` — ${c.ollama.error}` : ""}. VPN is
                    required from outside the office.
                  </div>
                ) : models.length === 0 ? (
                  <div className="rounded-2xl border border-[var(--border)] bg-card/60 p-4 text-[12px] text-muted-foreground/70">
                    No models resident. The first request will pay a cold load.
                  </div>
                ) : (
                  <div className="flex flex-col gap-2.5">
                    {models.map((m) => {
                      const gpuPct = m.gpu_pct;
                      const cpuPct = 100 - gpuPct;
                      const badge =
                        m.placement === "gpu"
                          ? {
                              label: "GPU",
                              cls: "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border-emerald-500/20",
                            }
                          : m.placement === "partial"
                            ? {
                                label: `${gpuPct}% GPU`,
                                cls: "bg-amber-500/10 text-amber-600 dark:text-amber-400 border-amber-500/20",
                              }
                            : {
                                label: "On CPU",
                                cls: "bg-rose-500/10 text-rose-600 dark:text-rose-400 border-rose-500/20",
                              };
                      return (
                        <div
                          key={m.name}
                          className="rounded-2xl border border-[var(--border)] bg-card/60 p-4"
                        >
                          <div className="flex items-center justify-between gap-3">
                            <span className="font-mono text-[13px] font-semibold text-foreground truncate">
                              {m.name}
                            </span>
                            <span
                              className={cn(
                                "shrink-0 rounded-full border px-2.5 py-0.5 text-[11px] font-semibold",
                                badge.cls,
                              )}
                            >
                              {badge.label}
                            </span>
                          </div>
                          {/* GPU vs CPU split bar */}
                          <div className="mt-3 flex h-2.5 w-full overflow-hidden rounded-full bg-secondary dark:bg-secondary/40">
                            <div
                              className="h-full bg-emerald-500 transition-all"
                              style={{ width: `${gpuPct}%` }}
                            />
                            <div
                              className="h-full bg-rose-500/80 transition-all"
                              style={{ width: `${cpuPct}%` }}
                            />
                          </div>
                          <div className="mt-1.5 flex justify-between text-[11px] text-muted-foreground/70 font-mono">
                            <span>
                              {fmtGB(m.size_vram)} VRAM
                              {cpuPct > 0 ? ` · ${fmtGB(m.size_cpu)} RAM` : ""}
                            </span>
                            <span>{fmtGB(m.size)} total</span>
                          </div>
                          {m.placement === "cpu" && (
                            <div className="mt-2.5 flex items-start gap-2 text-[12px] text-rose-600 dark:text-rose-400">
                              <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                              Evicted to CPU — this model has no GPU memory, so responses will be
                              very slow (this is the usual cause of requests that never finish).
                            </div>
                          )}
                        </div>
                      );
                    })}
                    {onCpu.length > 0 && (
                      <p className="text-[11px] text-muted-foreground/60 px-1">
                        A model runs on CPU when the GPU can't hold it alongside the resident set.
                        Freeing VRAM (fewer/smaller resident models) is the only fix — it's a shared
                        server, so this is a coordination issue, not an app bug.
                      </p>
                    )}
                  </div>
                )}
              </div>
            </div>
          );
        })()}
      </Card>

      {/* ── Per-tier model params ── */}
      <Card
        icon={<Cpu className="h-4 w-4 text-primary" />}
        title="Model Parameters"
        desc="Temperature, max tokens, and timeout configured for specific assistant tasks. Modify with care — router and agents require tool-calling compatibility."
      >
        {/* Warning callout for model swaps */}
        <div className="mb-5 flex items-start gap-3 rounded-2xl border border-amber-200 dark:border-amber-500/20 bg-amber-50 dark:bg-amber-500/[0.05] p-3.5 shadow-sm">
          <ShieldAlert className="mt-0.5 h-4 w-4 shrink-0 text-amber-600 dark:text-amber-400" />
          <p className="text-[12px] leading-relaxed text-amber-800 dark:text-amber-200/90">
            <span className="font-bold text-amber-900 dark:text-amber-300">
              Model Swap Warning:
            </span>{" "}
            The <span className="font-semibold text-foreground">Agent</span>,{" "}
            <span className="font-semibold text-foreground">Domain Service Agents</span>, and{" "}
            <span className="font-semibold text-foreground">Router</span> tiers rely heavily on tool
            execution. Deploying a model that lacks native tool calling (structured JSON output)
            will break workspace functions immediately.
          </p>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {data.tiers.map((tier) => {
            const t = cfg.tiers[tier];
            if (!t) return null;
            const meta = TIER_META[tier] ?? { label: tier, sub: "", icon: Cpu };
            const IconComponent = meta.icon;

            const modelChanged = t.model !== baseline.tiers[tier]?.model;
            const tempChanged = t.temperature !== baseline.tiers[tier]?.temperature;
            const tokensChanged = t.max_tokens !== baseline.tiers[tier]?.max_tokens;
            const timeoutChanged = t.timeout !== baseline.tiers[tier]?.timeout;

            const isModified = modelChanged || tempChanged || tokensChanged || timeoutChanged;
            const modelMissing = !data.models.includes(t.model);

            return (
              <motion.div
                key={tier}
                layoutId={`tier-card-${tier}`}
                className={cn(
                  "rounded-2xl border bg-secondary/10 p-4 transition-all duration-300 relative overflow-hidden",
                  isModified
                    ? "border-amber-500/30 shadow-[0_0_15px_rgba(245,158,11,0.03)] bg-amber-500/[0.01]"
                    : "border-[var(--border)]/60 hover:border-[var(--border)]",
                )}
              >
                {/* Visual indicator bar on modified card */}
                {isModified && (
                  <div className="absolute top-0 left-0 right-0 h-1 bg-gradient-to-r from-amber-500 to-amber-300" />
                )}

                <div className="mb-4 flex items-start justify-between gap-2">
                  <div className="flex items-center gap-2">
                    <div className="flex h-7 w-7 items-center justify-center rounded-lg bg-secondary text-foreground/80">
                      <IconComponent className="h-4 w-4" />
                    </div>
                    <div>
                      <h4 className="text-[14px] font-bold text-foreground leading-none">
                        {meta.label}
                      </h4>
                      <span
                        className="text-[10px] text-muted-foreground/80 mt-1 block max-w-[210px] truncate"
                        title={meta.sub}
                      >
                        {meta.sub}
                      </span>
                    </div>
                  </div>

                  {TOOLCALL_TIERS.has(tier) && (
                    <span className="inline-flex items-center gap-1 rounded-md bg-primary/10 border border-primary/20 px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wider text-primary">
                      <Zap className="h-2.5 w-2.5 fill-primary/20" /> Tool-Calling
                    </span>
                  )}
                </div>

                <div className="space-y-4">
                  {/* Model Select */}
                  <div className="flex flex-col gap-1.5">
                    <label className="text-[10px] uppercase tracking-wider text-muted-foreground/60 font-semibold">
                      LLM Engine
                    </label>
                    <ModelCoverflow
                      // A model configured but absent from the server still has to be
                      // selectable/centreable, so it leads the list rather than being dropped.
                      models={modelMissing ? [t.model, ...data.models] : data.models}
                      value={t.model}
                      onChange={(m) => {
                        setTier(tier, { model: m });
                        checkModelCaps(tier, m);
                      }}
                      changed={modelChanged}
                      missing={modelMissing}
                    />

                    {modelMissing && (
                      <span className="flex items-center gap-1 text-[11px] text-rose-400 font-medium mt-1">
                        <AlertTriangle className="h-3 w-3" /> Model not loaded on server
                      </span>
                    )}
                    {modelChanged && !modelMissing && (
                      <span className="text-[10px] text-amber-500 font-medium mt-0.5">
                        Changed: {baseline.tiers[tier]?.model} → {t.model}
                      </span>
                    )}

                    {/* Capability check result */}
                    {(() => {
                      const chk = capChecks[tier];
                      if (!chk || chk.model !== t.model) return null;
                      const req = TIER_REQUIREMENTS[tier]?.caps ?? [];
                      if (req.length === 0) return null;
                      if (chk.checking)
                        return (
                          <span className="flex items-center gap-1 text-[11px] text-muted-foreground mt-1">
                            <Loader2 className="h-3 w-3 animate-spin" /> Checking capabilities…
                          </span>
                        );
                      if (chk.error)
                        return (
                          <span className="flex items-center gap-1 text-[11px] text-amber-600 dark:text-amber-400 mt-1">
                            <AlertTriangle className="h-3 w-3" /> Could not verify capabilities
                          </span>
                        );
                      const missing = chk.capabilities
                        ? req.filter((c) => !chk.capabilities!.includes(c))
                        : req;
                      if (missing.length > 0)
                        return (
                          <span className="flex items-start gap-1 text-[11px] text-rose-600 dark:text-rose-400 font-medium mt-1 leading-snug">
                            <AlertTriangle className="h-3 w-3 mt-0.5 shrink-0" />
                            Not capable — <span className="font-semibold">
                              {t.model}
                            </span> lacks {missing.join(", ")}. This tier requires{" "}
                            {TIER_REQUIREMENTS[tier]?.hint}.
                          </span>
                        );
                      return (
                        <span className="flex items-center gap-1 text-[11px] text-emerald-600 dark:text-emerald-400 font-medium mt-1">
                          <Check className="h-3 w-3" /> Capable — supports {req.join(", ")}
                        </span>
                      );
                    })()}
                  </div>

                  {/* Temperature slider */}
                  <div className="pt-1">
                    <SliderField
                      label="Temperature"
                      value={t.temperature}
                      min={data.bounds.temperature[0]}
                      max={data.bounds.temperature[1]}
                      step={0.1}
                      onChange={(v) => setTier(tier, { temperature: v })}
                    />
                  </div>

                  {/* Limits */}
                  <div className="grid grid-cols-2 gap-3 pt-1 border-t border-[var(--border)]/30">
                    <NumField
                      label="Max tokens"
                      value={t.max_tokens ?? ""}
                      placeholder={
                        data.tier_call_defaults?.[tier]?.max_tokens != null
                          ? `Default (${data.tier_call_defaults[tier].max_tokens})`
                          : "Default (no limit)"
                      }
                      nullable
                      bounds={data.bounds.max_tokens}
                      onChange={(v) => setTier(tier, { max_tokens: numOrNull(v) })}
                    />
                    <NumField
                      label="Timeout (s)"
                      value={t.timeout ?? ""}
                      placeholder={
                        data.tier_call_defaults?.[tier]?.timeout != null
                          ? `Default (${data.tier_call_defaults[tier].timeout} s)`
                          : "Default"
                      }
                      nullable
                      bounds={data.bounds.timeout}
                      onChange={(v) => setTier(tier, { timeout: numOrNull(v) })}
                    />
                  </div>
                </div>
              </motion.div>
            );
          })}
        </div>
      </Card>

      {/* ── Domain Assistants ── */}
      <Card
        icon={<SlidersHorizontal className="h-4 w-4 text-primary" />}
        title="Domain Assistant Toggles"
        desc="Manage individual micro-agents globally. Disabling a domain redirects users querying those tools to a placeholder message, preventing service calls."
        badge={disabledCount > 0 ? `${disabledCount} micro-agents disabled` : undefined}
      >
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {data.domains.map((d) => {
            const off = cfg.disabled_domains.includes(d);
            const IconComp = DOMAIN_ICONS[d] ?? HelpCircle;
            const label = DOMAIN_LABELS[d] ?? d;
            const desc =
              DOMAIN_DESCS[d] ?? "Handles specialized enterprise workflows and assistant prompts.";

            // Check if domain status has been changed in the current edits session
            const wasOff = baseline.disabled_domains.includes(d);
            const isChanged = off !== wasOff;

            return (
              <motion.div
                key={d}
                whileHover={{ scale: 1.01 }}
                onClick={() => toggleDomain(d)}
                className={cn(
                  "group relative overflow-hidden rounded-2xl border p-4 cursor-pointer transition-all duration-300 select-none flex flex-col justify-between min-h-[160px]",
                  off
                    ? "border-rose-500/20 bg-rose-500/[0.02] hover:bg-rose-500/[0.04]"
                    : "border-[var(--border)]/75 bg-card hover:border-emerald-500/30 hover:bg-emerald-500/[0.01]",
                  isChanged && "border-amber-500/40 shadow-[0_0_10px_rgba(245,158,11,0.03)]",
                )}
              >
                {/* Subtle colored glow background indicator */}
                {!off && (
                  <div className="absolute -right-10 -top-10 h-20 w-20 rounded-full bg-emerald-500/5 blur-xl group-hover:bg-emerald-500/10 transition-colors" />
                )}
                {off && (
                  <div className="absolute -right-10 -top-10 h-20 w-20 rounded-full bg-rose-500/5 blur-xl" />
                )}

                <div>
                  <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 gap-3">
                    <div
                      className={cn(
                        "flex h-9 w-9 items-center justify-center rounded-xl transition-all duration-300",
                        off ? "bg-rose-500/10 text-rose-400" : "bg-emerald-500/10 text-emerald-400",
                      )}
                    >
                      <IconComp className="h-4.5 w-4.5" />
                    </div>

                    <div className="flex items-center gap-1.5">
                      <span
                        className={cn(
                          "h-1.5 w-1.5 rounded-full transition-all duration-300",
                          off ? "bg-rose-400" : "bg-emerald-400 animate-pulse",
                        )}
                      />
                      <span
                        className={cn(
                          "text-[10px] font-bold uppercase tracking-wider",
                          off ? "text-rose-400/90" : "text-emerald-400/90",
                        )}
                      >
                        {off ? "Suspended" : "Active"}
                      </span>
                    </div>
                  </div>

                  <div className="mt-3">
                    <h5 className="text-[13px] font-bold text-foreground">{label}</h5>
                    <p
                      className="mt-1 text-[11px] leading-relaxed text-muted-foreground line-clamp-2"
                      title={desc}
                    >
                      {desc}
                    </p>
                  </div>
                </div>

                {/* Bottom Toggle Visual State indicator */}
                <div className="mt-4 flex items-center justify-between border-t border-[var(--border)]/30 pt-3 text-[11px]">
                  <span className="text-muted-foreground/60 font-medium">
                    {isChanged && <span className="text-amber-500 font-bold">Unsaved edit · </span>}
                    {off ? "Suspended" : "Operational"}
                  </span>

                  {/* Miniature slider switch */}
                  <div
                    className={cn(
                      "relative h-4.5 w-8 rounded-full transition-colors",
                      off ? "bg-zinc-600" : "bg-emerald-500",
                    )}
                  >
                    <div
                      className={cn(
                        "absolute top-0.5 left-0.5 h-3.5 w-3.5 rounded-full bg-white shadow-sm transition-transform duration-300",
                        off ? "translate-x-0" : "translate-x-3.5",
                      )}
                    />
                  </div>
                </div>
              </motion.div>
            );
          })}
        </div>
      </Card>

      {/* ── Sticky action bar / control console ── */}
      <AnimatePresence>
        <motion.div
          initial={{ y: 20, opacity: 0 }}
          animate={{ y: 0, opacity: 1 }}
          transition={{ delay: 0.2 }}
          className="sticky bottom-4 mt-6 rounded-2xl border border-[var(--border)] bg-background/80 px-6 py-4 shadow-xl backdrop-blur-md z-40"
        >
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
            <div className="text-[12px] text-muted-foreground">
              {dirty ? (
                <div className="flex items-center gap-2 group relative cursor-pointer select-none">
                  <span className="flex items-center gap-1.5 text-amber-500 font-bold bg-amber-500/10 px-2.5 py-1 rounded-lg border border-amber-500/20">
                    <span className="h-1.5 w-1.5 rounded-full bg-amber-500 animate-ping" />
                    <span className="h-1.5 w-1.5 rounded-full bg-amber-500 absolute" />
                    {pendingChanges.length} Pending change{pendingChanges.length > 1 ? "s" : ""}
                  </span>

                  <span className="text-muted-foreground hover:text-foreground underline flex items-center gap-0.5 text-[11px] font-medium ml-1">
                    <Info className="h-3 w-3 inline" /> View summary
                  </span>

                  {/* Hover tooltip showing list of modified attributes */}
                  <div className="absolute bottom-full left-0 mb-3 w-72 scale-95 opacity-0 group-hover:scale-100 group-hover:opacity-100 pointer-events-none transition-all duration-300 z-50 rounded-2xl border border-[var(--border)] bg-card p-4 shadow-2xl">
                    <h6 className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground/80 mb-2 border-b border-[var(--border)]/30 pb-1.5">
                      Review Pending Edits
                    </h6>
                    <div className="max-h-48 overflow-y-auto space-y-2 pr-1 font-mono text-[11px] text-foreground/80 scrollbar-thin">
                      {pendingChanges.map((change, idx) => (
                        <div
                          key={idx}
                          className="flex flex-col gap-0.5 border-b border-[var(--border)]/20 pb-1.5 last:border-0 last:pb-0"
                        >
                          <span className="font-semibold text-muted-foreground text-[10px]">
                            {change.label}
                          </span>
                          <span className="text-amber-500 break-all">{change.details}</span>
                        </div>
                      ))}
                    </div>
                  </div>
                </div>
              ) : data.updated_by ? (
                <span className="flex items-center gap-1.5 text-muted-foreground/90 font-medium">
                  Last updated by{" "}
                  <span className="text-foreground font-semibold">{data.updated_by}</span>
                  {data.updated_at && <> on {new Date(data.updated_at).toLocaleString()}</>}
                </span>
              ) : (
                <span className="text-muted-foreground/60 font-medium">
                  Using default environment configuration.
                </span>
              )}
            </div>

            <div className="flex items-center gap-3">
              {dirty && (
                <button
                  onClick={discardEdits}
                  disabled={saving}
                  className="flex items-center gap-1.5 rounded-xl border border-[var(--border)] bg-card px-4 py-2 text-[13px] font-semibold text-muted-foreground hover:bg-secondary hover:text-foreground active:scale-95 transition-all disabled:opacity-50"
                >
                  <Undo className="h-4 w-4" /> Discard
                </button>
              )}

              <button
                onClick={reset}
                disabled={saving}
                className="flex items-center gap-1.5 rounded-xl border border-[var(--border)] px-4 py-2 text-[13px] font-semibold text-muted-foreground hover:bg-secondary hover:text-foreground active:scale-95 transition-all disabled:opacity-50"
              >
                <RotateCcw className="h-4 w-4" /> Reset defaults
              </button>

              <button
                onClick={onSaveClick}
                disabled={saving || !dirty || overHardConc}
                title={
                  overHardConc
                    ? `Max concurrency exceeds server capacity (${svrCap?.hard}). Lower it to apply.`
                    : undefined
                }
                className="flex items-center gap-1.5 rounded-xl bg-primary px-5 py-2.5 text-[13px] font-bold text-primary-foreground hover:opacity-90 active:scale-95 transition-all disabled:opacity-30 disabled:pointer-events-none shadow-[0_4px_12px_rgba(59,143,232,0.15)]"
              >
                {saving ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <Check className="h-4 w-4" />
                )}
                Apply changes
              </button>
            </div>
          </div>
        </motion.div>
      </AnimatePresence>

      {/* ── Model-change confirmation Modal ── */}
      <AnimatePresence>
        {confirmModels && (
          <Modal onClose={() => setConfirmModels(null)}>
            <div className="flex items-start gap-4">
              <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-xl bg-amber-500/10 text-amber-500 border border-amber-500/20 shadow-inner">
                <ShieldAlert className="h-6 w-6" />
              </div>
              <div>
                <h3 className="text-[16px] font-extrabold text-foreground">Confirm Model Swap</h3>
                <p className="mt-1 text-[13px] text-muted-foreground leading-relaxed">
                  You are changing the LLM engine overrides for {confirmModels.length} active
                  service tier{confirmModels.length > 1 ? "s" : ""}. This will take effect
                  immediately for all live conversations.
                </p>
              </div>
            </div>

            <ul className="my-5 space-y-2.5 max-h-48 overflow-y-auto pr-1">
              {confirmModels.map((tier) => (
                <li
                  key={tier}
                  className="flex flex-col gap-1 rounded-xl border border-[var(--border)] bg-secondary/20 p-3 text-[13px]"
                >
                  <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
                    <span className="font-bold text-foreground">
                      {TIER_META[tier]?.label ?? tier}
                    </span>
                    {TOOLCALL_TIERS.has(tier) && (
                      <span className="flex items-center gap-1 rounded bg-primary/10 border border-primary/20 px-1.5 py-0.5 text-[9px] font-semibold text-primary uppercase">
                        Requires Tool Calling
                      </span>
                    )}
                  </div>
                  <div className="flex items-center gap-2 font-mono text-[11px] text-muted-foreground/80 mt-1">
                    <span
                      className="bg-secondary px-2 py-0.5 rounded truncate max-w-[140px]"
                      title={baseline.tiers[tier]?.model}
                    >
                      {baseline.tiers[tier]?.model}
                    </span>
                    <span className="text-foreground/40 font-sans font-bold">→</span>
                    <span
                      className="bg-amber-500/10 text-amber-500 px-2 py-0.5 rounded border border-amber-500/20 truncate max-w-[140px]"
                      title={cfg.tiers[tier]?.model}
                    >
                      {cfg.tiers[tier]?.model}
                    </span>
                  </div>
                  {/* Capability result in confirm modal */}
                  {(() => {
                    const chk = capChecks[tier];
                    const req = TIER_REQUIREMENTS[tier]?.caps ?? [];
                    if (!chk || chk.model !== cfg.tiers[tier]?.model || req.length === 0)
                      return null;
                    if (chk.checking)
                      return (
                        <span className="flex items-center gap-1 text-[10px] text-muted-foreground mt-1">
                          <Loader2 className="h-2.5 w-2.5 animate-spin" /> Checking…
                        </span>
                      );
                    if (chk.error) return null;
                    const missing = chk.capabilities
                      ? req.filter((c) => !chk.capabilities!.includes(c))
                      : [];
                    if (missing.length > 0)
                      return (
                        <span className="flex items-center gap-1 text-[10px] text-rose-600 dark:text-rose-400 font-semibold mt-1">
                          <AlertTriangle className="h-2.5 w-2.5" /> Missing: {missing.join(", ")} —
                          will break at runtime
                        </span>
                      );
                    return (
                      <span className="flex items-center gap-1 text-[10px] text-emerald-600 dark:text-emerald-400 mt-1">
                        <Check className="h-2.5 w-2.5" /> Capability verified
                      </span>
                    );
                  })()}
                </li>
              ))}
            </ul>

            {/* Show a hard warning if any changed tier is incapable */}
            {confirmModels.some((t) => {
              const chk = capChecks[t];
              const req = TIER_REQUIREMENTS[t]?.caps ?? [];
              return (
                req.length > 0 &&
                chk &&
                !chk.checking &&
                !chk.error &&
                chk.model === cfg.tiers[t]?.model &&
                req.some((c) => !chk.capabilities?.includes(c))
              );
            }) && (
              <div className="mb-3 flex items-start gap-2.5 rounded-xl border border-rose-200 dark:border-rose-500/30 bg-rose-50 dark:bg-rose-500/[0.06] p-3 text-[12px] text-rose-800 dark:text-rose-200/90 leading-relaxed">
                <AlertTriangle className="h-4 w-4 shrink-0 text-rose-600 dark:text-rose-400 mt-0.5" />
                <p>
                  <span className="font-bold text-rose-900 dark:text-rose-300">
                    Capability mismatch:
                  </span>{" "}
                  One or more models above are missing required capabilities. Applying will break
                  those tiers immediately.
                </p>
              </div>
            )}

            {confirmModels.some((t) => TOOLCALL_TIERS.has(t)) && (
              <div className="mb-5 flex items-start gap-2.5 rounded-xl border border-amber-200 dark:border-amber-500/20 bg-amber-50 dark:bg-amber-500/[0.05] p-3 text-[12px] text-amber-800 dark:text-amber-200/90 leading-relaxed">
                <AlertTriangle className="h-4 w-4 shrink-0 text-amber-600 dark:text-amber-400 mt-0.5" />
                <p>
                  <span className="font-bold text-amber-900 dark:text-amber-300">Caution:</span> One
                  or more tool-calling tiers are changing. Verify that the new models natively
                  support structured output parsing to avoid router failures.
                </p>
              </div>
            )}

            <div className="flex justify-end gap-3 border-t border-[var(--border)]/30 pt-4">
              <button
                onClick={() => setConfirmModels(null)}
                className="rounded-xl border border-[var(--border)] px-4 py-2 text-[13px] font-semibold text-muted-foreground hover:bg-secondary hover:text-foreground transition-all active:scale-95"
              >
                Cancel
              </button>
              <button
                onClick={saveNow}
                disabled={saving}
                className="flex items-center gap-1.5 rounded-xl bg-amber-500 px-5 py-2 text-[13px] font-bold text-black hover:opacity-90 active:scale-95 transition-all disabled:opacity-50"
              >
                {saving ? (
                  <Loader2 className="h-4.5 w-4.5 animate-spin" />
                ) : (
                  <Check className="h-4.5 w-4.5" />
                )}
                Confirm swap
              </button>
            </div>
          </Modal>
        )}
      </AnimatePresence>
    </div>
  );
}

function Card({
  icon,
  title,
  desc,
  badge,
  children,
}: {
  icon: ReactNode;
  title: string;
  desc: string;
  badge?: string;
  children: ReactNode;
}) {
  return (
    <section className="rounded-3xl border border-[var(--border)] bg-card p-6 mb-6 shadow-sm hover:shadow transition-shadow duration-300">
      <div className="mb-4 flex items-start justify-between gap-3">
        <div className="flex items-center gap-3">
          <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-secondary text-foreground">
            {icon}
          </div>
          <div>
            <h3 className="text-[15px] font-bold text-foreground">{title}</h3>
          </div>
        </div>
        {badge && (
          <span className="rounded-full bg-rose-500/10 border border-rose-500/20 px-3 py-0.5 text-[11px] font-bold text-rose-400">
            {badge}
          </span>
        )}
      </div>
      <p className="text-[12px] text-muted-foreground mb-5 leading-relaxed">{desc}</p>
      {children}
    </section>
  );
}

/** Coverflow model picker — the selected model sits centred and full-size, its
 *  neighbours fan out behind it, and you step through them one at a time. Only the
 *  two cards either side of centre are mounted; a long Ollama model list would
 *  otherwise render dozens of off-screen cards on every tier card. */
function ModelCoverflow({
  models,
  value,
  onChange,
  changed,
  missing,
}: {
  models: string[];
  value: string;
  onChange: (model: string) => void;
  changed?: boolean;
  missing?: boolean;
}) {
  const index = Math.max(0, models.indexOf(value));

  const step = (delta: number) => {
    const next = models[index + delta];
    if (next) onChange(next);
  };

  return (
    <div
      className={cn(
        "relative rounded-xl border bg-card/60 py-3 select-none",
        changed ? "border-amber-500/50" : "border-[var(--border)]",
      )}
      role="listbox"
      aria-label="LLM engine"
      tabIndex={0}
      onKeyDown={(e) => {
        if (e.key === "ArrowLeft") {
          e.preventDefault();
          step(-1);
        } else if (e.key === "ArrowRight") {
          e.preventDefault();
          step(1);
        }
      }}
    >
      <div
        className="relative h-[74px] overflow-hidden"
        // Perspective on the viewport, not the cards — a per-card perspective gives
        // each one its own vanishing point, so the fan never converges.
        style={{ perspective: "700px" }}
      >
        <motion.div
          className="absolute inset-0"
          drag="x"
          dragConstraints={{ left: 0, right: 0 }}
          dragElastic={0.12}
          onDragEnd={(_, info) => {
            if (Math.abs(info.offset.x) > 40) step(info.offset.x < 0 ? 1 : -1);
          }}
        >
          {models.map((model, i) => {
            const offset = i - index;
            if (Math.abs(offset) > 2) return null;
            const isCurrent = offset === 0;
            return (
              <motion.button
                key={model}
                type="button"
                role="option"
                aria-selected={isCurrent}
                onClick={() => (isCurrent ? undefined : onChange(model))}
                className={cn(
                  // Opaque backgrounds are load-bearing, not cosmetic: a translucent centre
                  // card lets the fanned-out neighbours behind it show straight through,
                  // which destroys the depth the whole effect depends on.
                  "absolute left-1/2 top-1/2 flex h-[64px] w-[172px] flex-col items-center justify-center gap-1 overflow-hidden rounded-xl border bg-card px-3 text-center",
                  isCurrent
                    ? "border-primary/50 shadow-[0_4px_20px_-4px_rgba(0,0,0,0.35)]"
                    : "border-[var(--border)]/60 cursor-pointer",
                )}
                initial={false}
                animate={{
                  x: `calc(-50% + ${offset * 74}px)`,
                  y: "-50%",
                  scale: 1 - Math.abs(offset) * 0.16,
                  rotateY: offset * -34,
                  opacity: 1 - Math.abs(offset) * 0.38,
                }}
                transition={{ type: "spring", stiffness: 320, damping: 32 }}
                style={{ zIndex: 10 - Math.abs(offset) }}
              >
                {isCurrent && <span className="absolute inset-0 bg-primary/[0.07]" />}
                <span
                  className={cn(
                    "relative max-w-full truncate text-[13px] font-semibold",
                    isCurrent ? "text-foreground" : "text-muted-foreground",
                  )}
                >
                  {model}
                </span>
                {isCurrent && (
                  <span className="relative text-[9px] font-bold uppercase tracking-wider text-primary">
                    {missing ? "Not on server" : "Active"}
                  </span>
                )}
              </motion.button>
            );
          })}
        </motion.div>

        {/* Edge fades so the fanned-out neighbours dissolve instead of being clipped */}
        <div className="pointer-events-none absolute inset-y-0 left-0 z-20 w-10 bg-gradient-to-r from-card to-transparent" />
        <div className="pointer-events-none absolute inset-y-0 right-0 z-20 w-10 bg-gradient-to-l from-card to-transparent" />
      </div>

      <div className="mt-2 flex items-center justify-center gap-3">
        <button
          type="button"
          onClick={() => step(-1)}
          disabled={index === 0}
          aria-label="Previous model"
          className="flex h-6 w-6 items-center justify-center rounded-full border border-[var(--border)] text-muted-foreground transition-colors hover:text-foreground disabled:opacity-30"
        >
          <ChevronLeft className="h-3.5 w-3.5" />
        </button>
        <span className="font-mono text-[10px] tabular-nums text-muted-foreground/70">
          {index + 1} / {models.length}
        </span>
        <button
          type="button"
          onClick={() => step(1)}
          disabled={index === models.length - 1}
          aria-label="Next model"
          className="flex h-6 w-6 items-center justify-center rounded-full border border-[var(--border)] text-muted-foreground transition-colors hover:text-foreground disabled:opacity-30"
        >
          <ChevronRight className="h-3.5 w-3.5" />
        </button>
      </div>
    </div>
  );
}

function SliderField({
  label,
  value,
  onChange,
  min,
  max,
  step,
}: {
  label: string;
  value: number;
  onChange: (v: number) => void;
  min: number;
  max: number;
  step: number;
}) {
  const percentage = ((value - min) / (max - min)) * 100;
  return (
    <div className="flex flex-col gap-1.5 w-full">
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 text-[11px] uppercase tracking-wider text-muted-foreground/60 font-semibold">
        <span>{label}</span>
        <span className="font-mono text-[11px] font-bold text-primary bg-primary/10 border border-primary/20 px-2 py-0.5 rounded-lg">
          {value.toFixed(1)}
        </span>
      </div>
      <div className="relative flex items-center h-6 w-full">
        {/* Background track */}
        <div className="absolute h-1.5 w-full rounded-full bg-secondary" />
        {/* Active colored temperature gradient underlay */}
        <div
          className="absolute h-1.5 rounded-full bg-gradient-to-r from-clarity to-accent-amber"
          style={{ width: `${percentage}%` }}
        />
        <input
          type="range"
          min={min}
          max={max}
          step={step}
          value={value}
          onChange={(e) => onChange(Number(e.target.value))}
          className="relative z-10 h-6 w-full cursor-pointer appearance-none bg-transparent opacity-100 outline-none [&::-webkit-slider-runnable-track]:bg-transparent [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:h-4.5 [&::-webkit-slider-thumb]:w-4.5 [&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:bg-white [&::-webkit-slider-thumb]:border-2 [&::-webkit-slider-thumb]:border-primary [&::-webkit-slider-thumb]:shadow-md [&::-webkit-slider-thumb]:transition-transform [&::-webkit-slider-thumb]:hover:scale-110"
        />
      </div>
      <div className="flex justify-between text-[9px] text-muted-foreground/45 font-semibold px-0.5 uppercase tracking-wide">
        <span>Deterministic</span>
        <span>Creative</span>
      </div>
    </div>
  );
}

function NumField({
  label,
  value,
  onChange,
  bounds,
  step = 1,
  placeholder,
  nullable,
  className,
}: {
  label: string;
  value: number | string;
  onChange: (v: string) => void;
  bounds?: [number, number];
  step?: number;
  placeholder?: string;
  nullable?: boolean;
  className?: string;
}) {
  const currentVal = value === "" ? 0 : Number(value);
  const handleDecrement = () => {
    let newVal = currentVal - step;
    if (bounds) newVal = Math.max(bounds[0], newVal);
    onChange(String(newVal));
  };
  const handleIncrement = () => {
    let newVal = currentVal + step;
    if (bounds) newVal = Math.min(bounds[1], newVal);
    onChange(String(newVal));
  };

  return (
    <div className={cn("flex flex-col gap-1.5 w-full", className)}>
      <label className="text-[11px] uppercase tracking-wider text-muted-foreground/60 font-semibold">
        {label}
      </label>
      <div className="flex items-center rounded-xl border border-[var(--border)] bg-card overflow-hidden focus-within:border-primary focus-within:ring-1 focus-within:ring-primary/20 transition-all h-9 w-full">
        <button
          type="button"
          onClick={handleDecrement}
          disabled={bounds ? currentVal <= bounds[0] : false}
          className="flex h-full w-9 shrink-0 items-center justify-center border-r border-[var(--border)]/75 text-muted-foreground hover:bg-secondary hover:text-foreground active:scale-95 transition-all disabled:opacity-30 disabled:pointer-events-none"
        >
          <Minus className="h-3 w-3" />
        </button>
        <input
          type="number"
          value={value}
          step={step}
          min={bounds?.[0]}
          max={bounds?.[1]}
          placeholder={placeholder}
          onChange={(e) => onChange(e.target.value)}
          className="flex-1 min-w-0 bg-transparent py-1.5 text-center text-[13px] text-foreground focus:outline-none [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none font-bold font-mono px-1 placeholder:text-[9px] placeholder:font-normal placeholder:tracking-tight placeholder:text-muted-foreground/50"
        />
        <button
          type="button"
          onClick={handleIncrement}
          disabled={bounds ? currentVal >= bounds[1] : false}
          className="flex h-full w-9 shrink-0 items-center justify-center border-l border-[var(--border)]/75 text-muted-foreground hover:bg-secondary hover:text-foreground active:scale-95 transition-all disabled:opacity-30 disabled:pointer-events-none"
        >
          <Plus className="h-3 w-3" />
        </button>
      </div>
      {bounds && (
        <span className="text-[9px] text-muted-foreground/45 font-semibold text-center uppercase tracking-wider">
          Limit: {bounds[0]}–{bounds[1]} {nullable && "/ blank"}
        </span>
      )}
    </div>
  );
}

function Modal({ children, onClose }: { children: ReactNode; onClose: () => void }) {
  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4 backdrop-blur-sm"
      onClick={onClose}
    >
      <motion.div
        initial={{ opacity: 0, scale: 0.95, y: 15 }}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        exit={{ opacity: 0, scale: 0.95, y: 15 }}
        transition={{ type: "spring", duration: 0.35 }}
        className="w-full max-w-md rounded-3xl border border-[var(--border)] bg-card p-6 shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        {children}
      </motion.div>
    </div>
  );
}
