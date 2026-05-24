import { createFileRoute } from "@tanstack/react-router";
import { useAuth } from "@/lib/auth-store";
import { useState, useEffect, useMemo, useCallback } from "react";
import {
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip as RechartsTooltip,
  ResponsiveContainer,
  BarChart,
  Bar,
  PieChart,
  Pie,
  Cell,
  Legend,
  AreaChart,
  Area,
  LineChart,
  Line,
} from "recharts";
import {
  Activity,
  Search,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  Loader2,
  RefreshCw,
  Clock,
  Zap,
  Hash,
  AlertTriangle,
  CheckCircle2,
  XCircle,
  ExternalLink,
  Users,
  TrendingUp,
  TrendingDown,
  ArrowUpRight,
} from "lucide-react";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/_layout/observability")({
  component: ObservabilityDashboard,
});

// ── Colour palettes ──────────────────────────────────────────────────────────
const DOMAIN_COLORS: Record<string, string> = {
  hr: "#10b981",
  it_support: "#6366f1",
  admin: "#f59e0b",
  pmo: "#06b6d4",
  general: "#8b5cf6",
  functional_manager: "#ec4899",
};
const PIE_COLORS = ["#6366f1", "#10b981", "#f59e0b", "#06b6d4", "#8b5cf6", "#ef4444", "#ec4899"];

const DOMAIN_BADGE: Record<string, string> = {
  hr: "bg-emerald-500/15 text-emerald-400 border border-emerald-500/20",
  it_support: "bg-indigo-500/15 text-indigo-400 border border-indigo-500/20",
  admin: "bg-amber-500/15 text-amber-400 border border-amber-500/20",
  pmo: "bg-cyan-500/15 text-cyan-400 border border-cyan-500/20",
  general: "bg-violet-500/15 text-violet-400 border border-violet-500/20",
  functional_manager: "bg-pink-500/15 text-pink-400 border border-pink-500/20",
};

const tooltipStyle = {
  backgroundColor: "var(--card)",
  borderColor: "var(--border)",
  borderRadius: "12px",
  boxShadow: "0 8px 32px -8px rgba(0,0,0,0.12)",
  color: "var(--foreground)",
  fontSize: "12px",
  padding: "8px 12px",
};

// ── Types ────────────────────────────────────────────────────────────────────

interface LogEntry {
  id: number;
  created_at: string;
  session_id: string;
  user_email: string;
  domain: string;
  user_message: string;
  total_latency_ms: number;
  total_tokens: number;
  llm_call_count: number;
  error: string | null;
}

interface LogDetail {
  id: number;
  created_at: string;
  session_id: string;
  user_email: string;
  user_message: string;
  domain: string;
  sub_intent: string | null;
  route_method: string | null;
  response_text: string | null;
  response_length: number;
  total_latency_ms: number;
  total_prompt_tokens: number;
  total_completion_tokens: number;
  total_tokens: number;
  model_name: string | null;
  error: string | null;
  langfuse_trace_id: string | null;
  llm_calls: {
    id: number;
    node: string;
    model: string;
    duration_ms: number;
    prompt_tokens: number | null;
    completion_tokens: number | null;
    total_tokens: number | null;
    is_tool_call: boolean;
    tool_names: string | null;
    error: string | null;
  }[];
}

interface Summary {
  total_requests: number;
  unique_sessions: number;
  avg_latency_ms: number;
  p95_latency_ms: number;
  total_tokens: number;
  error_count: number;
  error_rate_pct: number;
  feedback_score_pct: number;
  feedback_total: number;
  prev_total_requests: number;
  trend_pct: number;
}

// ── Sub-components ───────────────────────────────────────────────────────────

function KpiCard({
  title,
  value,
  sub,
  icon: Icon,
  iconColor,
  loading,
}: {
  title: string;
  value: string | number;
  sub: string;
  icon: typeof Activity;
  iconColor: string;
  loading?: boolean;
}) {
  return (
    <div className="rounded-2xl border border-[var(--border)] bg-card p-6 hover:shadow-lg transition-all">
      <div className="flex items-start justify-between mb-4">
        <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-[var(--muted)]">
          <Icon className={cn("h-5 w-5", iconColor)} />
        </div>
      </div>
      {loading ? (
        <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
      ) : (
        <>
          <p className="text-3xl font-bold tracking-tight text-foreground">{value}</p>
          <p className="mt-1 text-[13px] text-muted-foreground">{title}</p>
          <p className="mt-0.5 text-[11px] text-muted-foreground/60">{sub}</p>
        </>
      )}
    </div>
  );
}

function LatencyBadge({ ms }: { ms: number }) {
  const secs = (ms / 1000).toFixed(1);
  const color = ms < 1000 ? "text-emerald-400" : ms < 3000 ? "text-amber-400" : "text-rose-400";
  return <span className={cn("text-[11px] font-mono font-medium", color)}>{secs}s</span>;
}

function DomainBadge({ domain }: { domain: string }) {
  const key = domain?.toLowerCase() || "general";
  return (
    <span
      className={cn(
        "rounded-full px-2.5 py-0.5 text-[10px] font-semibold uppercase tracking-wider",
        DOMAIN_BADGE[key] || "bg-zinc-500/15 text-zinc-400 border border-zinc-500/20"
      )}
    >
      {domain || "unknown"}
    </span>
  );
}

// ── Main Component ───────────────────────────────────────────────────────────

function ObservabilityDashboard() {
  const { user } = useAuth();
  const [activeTab, setActiveTab] = useState<"logs" | "charts">("logs");

  if (user?.role !== "IT" && user?.role !== "Admin") {
    return (
      <div className="flex h-[60vh] items-center justify-center text-muted-foreground">
        Access restricted to IT and Admin teams.
      </div>
    );
  }

  return (
    <div className="flex h-full flex-col overflow-y-auto bg-background">
      {/* Header */}
      <div className="sticky top-0 z-30 border-b border-[var(--border)] bg-background/80 backdrop-blur-xl px-6 py-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-indigo-500/10">
              <Activity className="h-5 w-5 text-indigo-400" />
            </div>
            <div>
              <h1 className="text-[20px] font-bold text-foreground">AI Observability</h1>
              <p className="text-[12px] text-muted-foreground">Activity logs, performance metrics & analytics</p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <div className="flex rounded-xl border border-[var(--border)] overflow-hidden">
              {(["logs", "charts"] as const).map((tab) => (
                <button
                  key={tab}
                  onClick={() => setActiveTab(tab)}
                  className={cn(
                    "px-4 py-2 text-[13px] font-medium transition-colors",
                    activeTab === tab
                      ? "bg-primary/10 text-primary"
                      : "text-muted-foreground hover:text-foreground"
                  )}
                >
                  {tab === "logs" ? "Activity Logs" : "Charts & Analytics"}
                </button>
              ))}
            </div>
          </div>
        </div>
      </div>

      <div className="p-6">
        {activeTab === "logs" ? <LogsTab /> : <ChartsTab />}
      </div>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════════
// TAB 1: Activity Logs (CloudTrail-style)
// ═══════════════════════════════════════════════════════════════════════════════

function LogsTab() {
  const { user } = useAuth();
  const authHeaders = useMemo(
    () => ({
      "Content-Type": "application/json",
      ...(user?.email ? { "x-user-email": user.email } : {}),
      ...(user?.role ? { "x-user-role": user.role.toLowerCase() } : {}),
    }),
    [user?.email, user?.role]
  );

  const [logs, setLogs] = useState<LogEntry[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [pages, setPages] = useState(1);
  const [loading, setLoading] = useState(true);

  // Filters
  const [search, setSearch] = useState("");
  const [domain, setDomain] = useState("All");
  const [status, setStatus] = useState("All");

  // Expanded row
  const [expandedId, setExpandedId] = useState<number | null>(null);
  const [detail, setDetail] = useState<LogDetail | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);

  const fetchLogs = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams({ page: String(page), limit: "50" });
      if (search) params.set("search", search);
      if (domain !== "All") params.set("domain", domain);
      if (status !== "All") params.set("status", status.toLowerCase());

      const res = await fetch(`/api/observability/logs?${params}`, { headers: authHeaders });
      const data = await res.json();
      setLogs(data.data || []);
      setTotal(data.total || 0);
      setPages(data.pages || 1);
    } catch {
      setLogs([]);
    } finally {
      setLoading(false);
    }
  }, [page, search, domain, status, authHeaders]);

  useEffect(() => {
    fetchLogs();
  }, [fetchLogs]);

  const handleExpand = async (id: number) => {
    if (expandedId === id) {
      setExpandedId(null);
      setDetail(null);
      return;
    }
    setExpandedId(id);
    setDetailLoading(true);
    try {
      const res = await fetch(`/api/observability/logs/${id}`, { headers: authHeaders });
      setDetail(await res.json());
    } catch {
      setDetail(null);
    } finally {
      setDetailLoading(false);
    }
  };

  const handleSearch = () => {
    setPage(1);
    fetchLogs();
  };

  return (
    <div className="space-y-4">
      {/* Filter bar */}
      <div className="flex flex-wrap items-center gap-3">
        <div className="relative flex-1 min-w-[200px] max-w-[400px]">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <input
            type="text"
            placeholder="Search messages..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && handleSearch()}
            className="w-full rounded-xl border border-[var(--border)] bg-card pl-10 pr-4 py-2.5 text-[13px] text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary/30"
          />
        </div>

        <select
          value={domain}
          onChange={(e) => { setDomain(e.target.value); setPage(1); }}
          className="rounded-xl border border-[var(--border)] bg-card px-3 py-2.5 text-[13px] text-foreground focus:outline-none focus:ring-2 focus:ring-primary/30"
        >
          <option value="All">All Domains</option>
          <option value="hr">HR</option>
          <option value="it_support">IT Support</option>
          <option value="admin">Admin</option>
          <option value="pmo">PMO</option>
          <option value="general">General</option>
          <option value="functional_manager">Manager</option>
        </select>

        <div className="flex rounded-xl border border-[var(--border)] overflow-hidden">
          {["All", "Success", "Error"].map((s) => (
            <button
              key={s}
              onClick={() => { setStatus(s); setPage(1); }}
              className={cn(
                "px-3.5 py-2 text-[12px] font-medium transition-colors",
                status === s ? "bg-primary/10 text-primary" : "text-muted-foreground hover:text-foreground"
              )}
            >
              {s}
            </button>
          ))}
        </div>

        <button
          onClick={fetchLogs}
          className="flex items-center gap-1.5 rounded-xl border border-[var(--border)] px-3.5 py-2.5 text-[12px] font-medium text-muted-foreground hover:text-foreground transition-colors"
        >
          <RefreshCw className="h-3.5 w-3.5" />
          Refresh
        </button>

        <span className="text-[11px] text-muted-foreground ml-auto">
          {total} total entries
        </span>
      </div>

      {/* Log table */}
      {loading ? (
        <div className="flex items-center justify-center py-20">
          <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
        </div>
      ) : logs.length === 0 ? (
        <div className="flex items-center justify-center py-20 text-muted-foreground text-[13px]">
          No log entries found.
        </div>
      ) : (
        <div className="space-y-2">
          {logs.map((log) => {
            const isExpanded = expandedId === log.id;
            return (
              <div key={log.id} className="rounded-2xl border border-[var(--border)] bg-card overflow-hidden">
                {/* Row header */}
                <div
                  className="flex items-center gap-3 px-5 py-3.5 cursor-pointer hover:bg-[var(--muted)]/30 transition-colors"
                  onClick={() => handleExpand(log.id)}
                >
                  {/* Status dot */}
                  <div className="shrink-0">
                    {log.error ? (
                      <XCircle className="h-4 w-4 text-rose-400" />
                    ) : (
                      <CheckCircle2 className="h-4 w-4 text-emerald-400" />
                    )}
                  </div>

                  {/* Timestamp */}
                  <span className="text-[11px] font-mono text-muted-foreground shrink-0 w-[130px]">
                    {log.created_at
                      ? new Date(log.created_at).toLocaleString("en-IN", {
                          month: "short",
                          day: "2-digit",
                          hour: "2-digit",
                          minute: "2-digit",
                          second: "2-digit",
                          hour12: false,
                        })
                      : "—"}
                  </span>

                  {/* User */}
                  <span className="text-[12px] text-foreground truncate w-[140px] shrink-0" title={log.user_email}>
                    {log.user_email?.split("@")[0] || "—"}
                  </span>

                  {/* Domain */}
                  <div className="shrink-0">
                    <DomainBadge domain={log.domain} />
                  </div>

                  {/* Message preview */}
                  <span className="text-[12px] text-muted-foreground truncate flex-1 min-w-0">
                    {log.user_message || "—"}
                  </span>

                  {/* Latency */}
                  <div className="shrink-0 w-[50px] text-right">
                    <LatencyBadge ms={log.total_latency_ms} />
                  </div>

                  {/* Tokens */}
                  <span className="text-[11px] font-mono text-muted-foreground shrink-0 w-[50px] text-right">
                    {log.total_tokens || 0}
                  </span>

                  {/* LLM calls count */}
                  <span className="shrink-0 rounded-full bg-[var(--muted)] px-2 py-0.5 text-[10px] font-medium text-muted-foreground">
                    {log.llm_call_count} LLM
                  </span>

                  {/* Chevron */}
                  <ChevronDown
                    className={cn(
                      "h-4 w-4 text-muted-foreground transition-transform duration-200 shrink-0",
                      isExpanded && "rotate-180"
                    )}
                  />
                </div>

                {/* Expanded detail */}
                {isExpanded && (
                  <div className="border-t border-[var(--border)] px-5 py-4 animate-in slide-in-from-top-1 duration-150 space-y-4 bg-[var(--muted)]/10">
                    {detailLoading ? (
                      <div className="flex items-center justify-center py-8">
                        <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
                      </div>
                    ) : detail ? (
                      <>
                        {/* Request info */}
                        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                          <InfoItem label="Session" value={detail.session_id} />
                          <InfoItem label="Route Method" value={detail.route_method || "—"} />
                          <InfoItem label="Total Latency" value={`${detail.total_latency_ms}ms`} />
                          <InfoItem label="Response Length" value={`${detail.response_length} chars`} />
                        </div>

                        {/* Full user message */}
                        <div>
                          <p className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground mb-1">User Message</p>
                          <p className="text-[13px] text-foreground bg-[var(--muted)]/30 rounded-xl px-4 py-3">
                            {detail.user_message}
                          </p>
                        </div>

                        {/* LLM Calls Timeline */}
                        {detail.llm_calls.length > 0 && (
                          <div>
                            <p className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground mb-2">
                              LLM Calls ({detail.llm_calls.length})
                            </p>
                            <div className="space-y-1.5">
                              {detail.llm_calls.map((call) => (
                                <div
                                  key={call.id}
                                  className="flex items-center gap-3 rounded-xl border border-[var(--border)] px-4 py-2.5 bg-card"
                                >
                                  <div className="flex h-7 w-7 items-center justify-center rounded-lg bg-indigo-500/10">
                                    <Zap className="h-3.5 w-3.5 text-indigo-400" />
                                  </div>
                                  <span className="text-[12px] font-medium text-foreground min-w-[120px]">
                                    {call.node}
                                  </span>
                                  <span className="text-[11px] text-muted-foreground min-w-[130px]">
                                    {call.model}
                                  </span>
                                  <LatencyBadge ms={call.duration_ms} />
                                  <span className="text-[11px] font-mono text-muted-foreground">
                                    {call.total_tokens ?? "—"} tok
                                  </span>
                                  {call.is_tool_call && (
                                    <span className="rounded-full bg-amber-500/15 text-amber-400 border border-amber-500/20 px-2 py-0.5 text-[10px] font-medium">
                                      {call.tool_names || "tool"}
                                    </span>
                                  )}
                                  {call.error && (
                                    <span className="rounded-full bg-rose-500/15 text-rose-400 border border-rose-500/20 px-2 py-0.5 text-[10px] font-medium">
                                      error
                                    </span>
                                  )}
                                </div>
                              ))}
                            </div>
                          </div>
                        )}

                        {/* Response text */}
                        {detail.response_text && (
                          <div>
                            <p className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground mb-1">AI Response</p>
                            <p className="text-[13px] text-foreground bg-[var(--muted)]/30 rounded-xl px-4 py-3 max-h-[200px] overflow-y-auto whitespace-pre-wrap">
                              {detail.response_text}
                            </p>
                          </div>
                        )}

                        {/* Error */}
                        {detail.error && (
                          <div className="rounded-xl border border-rose-500/20 bg-rose-500/5 px-4 py-3">
                            <p className="text-[11px] font-semibold uppercase tracking-wider text-rose-400 mb-1">Error</p>
                            <p className="text-[13px] text-rose-300">{detail.error}</p>
                          </div>
                        )}

                        {/* Langfuse link */}
                        {detail.langfuse_trace_id && (
                          <a
                            href={`/api/observability/langfuse-redirect/${detail.langfuse_trace_id}`}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="inline-flex items-center gap-1.5 text-[12px] text-primary hover:underline"
                          >
                            <ExternalLink className="h-3.5 w-3.5" />
                            Open in Langfuse
                          </a>
                        )}
                      </>
                    ) : (
                      <p className="text-[13px] text-muted-foreground">Failed to load details.</p>
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      {/* Pagination */}
      {pages > 1 && (
        <div className="flex items-center justify-center gap-3 pt-2">
          <button
            onClick={() => setPage((p) => Math.max(1, p - 1))}
            disabled={page <= 1}
            className="flex items-center gap-1 rounded-xl border border-[var(--border)] px-3 py-2 text-[12px] font-medium text-muted-foreground hover:text-foreground disabled:opacity-40 transition-colors"
          >
            <ChevronLeft className="h-3.5 w-3.5" />
            Previous
          </button>
          <span className="text-[12px] text-muted-foreground">
            Page {page} of {pages}
          </span>
          <button
            onClick={() => setPage((p) => Math.min(pages, p + 1))}
            disabled={page >= pages}
            className="flex items-center gap-1 rounded-xl border border-[var(--border)] px-3 py-2 text-[12px] font-medium text-muted-foreground hover:text-foreground disabled:opacity-40 transition-colors"
          >
            Next
            <ChevronRight className="h-3.5 w-3.5" />
          </button>
        </div>
      )}
    </div>
  );
}

function InfoItem({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <p className="text-[10px] uppercase tracking-wider text-muted-foreground/60">{label}</p>
      <p className="text-[13px] text-foreground font-mono truncate" title={value}>{value}</p>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════════
// TAB 2: Charts & Analytics
// ═══════════════════════════════════════════════════════════════════════════════

function ChartsTab() {
  const { user } = useAuth();
  const authHeaders = useMemo(
    () => ({
      "Content-Type": "application/json",
      ...(user?.email ? { "x-user-email": user.email } : {}),
      ...(user?.role ? { "x-user-role": user.role.toLowerCase() } : {}),
    }),
    [user?.email, user?.role]
  );

  const [period, setPeriod] = useState("24h");
  const [loading, setLoading] = useState(true);

  const [summary, setSummary] = useState<Summary | null>(null);
  const [volumeData, setVolumeData] = useState<any[]>([]);
  const [domainData, setDomainData] = useState<any[]>([]);
  const [modelData, setModelData] = useState<any[]>([]);
  const [nodeData, setNodeData] = useState<any[]>([]);

  const fetchAll = useCallback(async () => {
    setLoading(true);
    const qs = `?period=${period}`;
    try {
      const [sumRes, volRes, domRes, modRes, nodeRes] = await Promise.all([
        fetch(`/api/observability/summary${qs}`, { headers: authHeaders }),
        fetch(`/api/observability/charts/volume${qs}`, { headers: authHeaders }),
        fetch(`/api/observability/charts/domains${qs}`, { headers: authHeaders }),
        fetch(`/api/observability/charts/models${qs}`, { headers: authHeaders }),
        fetch(`/api/observability/charts/nodes${qs}`, { headers: authHeaders }),
      ]);
      setSummary(await sumRes.json());
      setVolumeData(await volRes.json());
      setDomainData(await domRes.json());
      setModelData(await modRes.json());
      setNodeData(await nodeRes.json());
    } catch {
      /* fail silently */
    } finally {
      setLoading(false);
    }
  }, [period, authHeaders]);

  useEffect(() => {
    fetchAll();
  }, [fetchAll]);

  return (
    <div className="space-y-6">
      {/* Period selector */}
      <div className="flex items-center justify-between">
        <div className="flex rounded-xl border border-[var(--border)] overflow-hidden">
          {["24h", "7d", "30d"].map((p) => (
            <button
              key={p}
              onClick={() => setPeriod(p)}
              className={cn(
                "px-4 py-2 text-[13px] font-medium transition-colors",
                period === p ? "bg-primary/10 text-primary" : "text-muted-foreground hover:text-foreground"
              )}
            >
              {p === "24h" ? "Last 24h" : p === "7d" ? "Last 7 days" : "Last 30 days"}
            </button>
          ))}
        </div>
        <button
          onClick={fetchAll}
          className="flex items-center gap-1.5 rounded-xl border border-[var(--border)] px-3.5 py-2.5 text-[12px] font-medium text-muted-foreground hover:text-foreground transition-colors"
        >
          <RefreshCw className="h-3.5 w-3.5" />
          Refresh
        </button>
      </div>

      {/* KPI Cards */}
      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-4">
        <KpiCard
          title="Total AI Requests"
          value={summary?.total_requests ?? "—"}
          sub={
            summary
              ? summary.trend_pct > 0
                ? `+${summary.trend_pct}% vs prev`
                : `${summary.trend_pct}% vs prev`
              : ""
          }
          icon={Activity}
          iconColor="text-indigo-400"
          loading={loading}
        />
        <KpiCard
          title="Unique Sessions"
          value={summary?.unique_sessions ?? "—"}
          sub="distinct conversations"
          icon={Users}
          iconColor="text-cyan-400"
          loading={loading}
        />
        <KpiCard
          title="Avg Response Time"
          value={summary ? `${(summary.avg_latency_ms / 1000).toFixed(1)}s` : "—"}
          sub={summary ? `P95: ${(summary.p95_latency_ms / 1000).toFixed(1)}s` : ""}
          icon={Clock}
          iconColor="text-amber-400"
          loading={loading}
        />
        <KpiCard
          title="P95 Latency"
          value={summary ? `${(summary.p95_latency_ms / 1000).toFixed(1)}s` : "—"}
          sub="95th percentile"
          icon={Zap}
          iconColor="text-orange-400"
          loading={loading}
        />
        <KpiCard
          title="Total Tokens"
          value={summary ? summary.total_tokens.toLocaleString() : "—"}
          sub="across all models"
          icon={Hash}
          iconColor="text-emerald-400"
          loading={loading}
        />
        <KpiCard
          title="Error Rate"
          value={summary ? `${summary.error_rate_pct}%` : "—"}
          sub={summary ? `${summary.error_count} errors` : ""}
          icon={AlertTriangle}
          iconColor={summary && summary.error_rate_pct > 5 ? "text-rose-400" : "text-emerald-400"}
          loading={loading}
        />
      </div>

      {/* Time Series Charts */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Request Volume */}
        <div className="rounded-2xl border border-[var(--border)] bg-card p-6">
          <h3 className="text-[15px] font-semibold text-foreground mb-4">Request Volume</h3>
          {loading ? (
            <div className="flex items-center justify-center h-[250px]">
              <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
            </div>
          ) : (
            <ResponsiveContainer width="100%" height={250}>
              <AreaChart data={volumeData}>
                <defs>
                  <linearGradient id="volGrad" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor="#6366f1" stopOpacity={0.3} />
                    <stop offset="95%" stopColor="#6366f1" stopOpacity={0} />
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" />
                <XAxis
                  dataKey="time"
                  tickFormatter={(v) => {
                    const d = new Date(v);
                    return period === "24h"
                      ? d.toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit", hour12: false })
                      : d.toLocaleDateString("en-IN", { month: "short", day: "2-digit" });
                  }}
                  tick={{ fontSize: 10, fill: "var(--muted-foreground)" }}
                />
                <YAxis tick={{ fontSize: 10, fill: "var(--muted-foreground)" }} />
                <RechartsTooltip contentStyle={tooltipStyle} />
                <Area type="monotone" dataKey="requests" stroke="#6366f1" fill="url(#volGrad)" strokeWidth={2} />
              </AreaChart>
            </ResponsiveContainer>
          )}
        </div>

        {/* Latency Over Time */}
        <div className="rounded-2xl border border-[var(--border)] bg-card p-6">
          <h3 className="text-[15px] font-semibold text-foreground mb-4">Response Latency</h3>
          {loading ? (
            <div className="flex items-center justify-center h-[250px]">
              <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
            </div>
          ) : (
            <ResponsiveContainer width="100%" height={250}>
              <LineChart data={volumeData}>
                <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" />
                <XAxis
                  dataKey="time"
                  tickFormatter={(v) => {
                    const d = new Date(v);
                    return period === "24h"
                      ? d.toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit", hour12: false })
                      : d.toLocaleDateString("en-IN", { month: "short", day: "2-digit" });
                  }}
                  tick={{ fontSize: 10, fill: "var(--muted-foreground)" }}
                />
                <YAxis
                  tick={{ fontSize: 10, fill: "var(--muted-foreground)" }}
                  tickFormatter={(v) => `${(v / 1000).toFixed(1)}s`}
                />
                <RechartsTooltip
                  contentStyle={tooltipStyle}
                  formatter={(value: number) => [`${(value / 1000).toFixed(2)}s`, "Avg Latency"]}
                />
                <Line type="monotone" dataKey="avg_latency" stroke="#f59e0b" strokeWidth={2} dot={false} />
              </LineChart>
            </ResponsiveContainer>
          )}
        </div>
      </div>

      {/* Distribution Charts */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Domain Distribution */}
        <div className="rounded-2xl border border-[var(--border)] bg-card p-6">
          <h3 className="text-[15px] font-semibold text-foreground mb-4">Domain Routing</h3>
          {loading ? (
            <div className="flex items-center justify-center h-[280px]">
              <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
            </div>
          ) : domainData.length === 0 ? (
            <div className="flex items-center justify-center h-[280px] text-muted-foreground text-[13px]">No data</div>
          ) : (
            <ResponsiveContainer width="100%" height={280}>
              <PieChart>
                <Pie
                  data={domainData}
                  dataKey="count"
                  nameKey="domain"
                  cx="50%"
                  cy="50%"
                  innerRadius={60}
                  outerRadius={100}
                  paddingAngle={2}
                  label={({ domain, percent }) => `${domain} (${(percent * 100).toFixed(0)}%)`}
                  labelLine={false}
                >
                  {domainData.map((_, i) => (
                    <Cell key={i} fill={PIE_COLORS[i % PIE_COLORS.length]} />
                  ))}
                </Pie>
                <RechartsTooltip contentStyle={tooltipStyle} />
              </PieChart>
            </ResponsiveContainer>
          )}
        </div>

        {/* Token Usage by Model */}
        <div className="rounded-2xl border border-[var(--border)] bg-card p-6">
          <h3 className="text-[15px] font-semibold text-foreground mb-4">Token Usage by Model</h3>
          {loading ? (
            <div className="flex items-center justify-center h-[280px]">
              <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
            </div>
          ) : modelData.length === 0 ? (
            <div className="flex items-center justify-center h-[280px] text-muted-foreground text-[13px]">No data</div>
          ) : (
            <ResponsiveContainer width="100%" height={280}>
              <BarChart data={modelData} layout="vertical">
                <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" />
                <XAxis type="number" tick={{ fontSize: 10, fill: "var(--muted-foreground)" }} />
                <YAxis
                  type="category"
                  dataKey="model"
                  width={120}
                  tick={{ fontSize: 10, fill: "var(--muted-foreground)" }}
                />
                <RechartsTooltip contentStyle={tooltipStyle} />
                <Bar dataKey="prompt_tokens" name="Prompt" stackId="tok" fill="#6366f1" radius={[0, 0, 0, 0]} />
                <Bar dataKey="completion_tokens" name="Completion" stackId="tok" fill="#10b981" radius={[0, 4, 4, 0]} />
                <Legend wrapperStyle={{ fontSize: 11 }} />
              </BarChart>
            </ResponsiveContainer>
          )}
        </div>
      </div>

      {/* Node Performance Table */}
      <div className="rounded-2xl border border-[var(--border)] bg-card p-6">
        <h3 className="text-[15px] font-semibold text-foreground mb-4">Node Performance</h3>
        {loading ? (
          <div className="flex items-center justify-center py-10">
            <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
          </div>
        ) : nodeData.length === 0 ? (
          <p className="text-[13px] text-muted-foreground text-center py-10">No data yet</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left">
              <thead>
                <tr className="border-b border-[var(--border)]">
                  {["Node", "Calls", "Avg Latency", "P95 Latency", "Avg Tokens", "Errors"].map((h) => (
                    <th key={h} className="px-4 py-3 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {nodeData.map((n: any) => (
                  <tr key={n.node} className="border-b border-[var(--border)] last:border-0 hover:bg-[var(--muted)]/30 transition-colors">
                    <td className="px-4 py-3 text-[13px] font-medium text-foreground">{n.node}</td>
                    <td className="px-4 py-3 text-[13px] text-muted-foreground">{n.calls}</td>
                    <td className="px-4 py-3"><LatencyBadge ms={n.avg_ms} /></td>
                    <td className="px-4 py-3"><LatencyBadge ms={n.p95_ms} /></td>
                    <td className="px-4 py-3 text-[13px] font-mono text-muted-foreground">{n.avg_tokens}</td>
                    <td className="px-4 py-3">
                      {n.errors > 0 ? (
                        <span className="rounded-full bg-rose-500/15 text-rose-400 border border-rose-500/20 px-2 py-0.5 text-[10px] font-medium">
                          {n.errors}
                        </span>
                      ) : (
                        <span className="text-[11px] text-muted-foreground/40">0</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
