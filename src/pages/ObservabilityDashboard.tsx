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
  Eye,
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
  Lock,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { FeedbackTriageTab } from "./FeedbackTriageTab";
import { AdoptionTab } from "./AdoptionTab";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell } from "@/components/ui/table";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";

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
  user_label: string;
  domain: string;
  total_latency_ms: number;
  total_tokens: number;
  llm_call_count: number;
  error: string | null;
}

interface LogDetail {
  id: number;
  created_at: string;
  session_id: string;
  user_label: string;
  domain: string;
  sub_intent: string | null;
  route_method: string | null;
  response_length: number;
  total_latency_ms: number;
  total_prompt_tokens: number;
  total_completion_tokens: number;
  total_tokens: number;
  model_name: string | null;
  error: string | null;
  langfuse_trace_id: string | null;
  user_email: string | null;
  user_message: string | null;
  response_text: string | null;
  pii_redacted?: boolean;
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

interface TraceStep {
  id: string | null;
  type: string | null;
  name: string | null;
  model: string | null;
  duration_ms: number | null;
  level: string | null;
  status_message: string | null;
  input: string | null;
  output: string | null;
  usage: { input: number | null; output: number | null; total: number | null } | null;
}

interface TraceData {
  available: boolean;
  reason?: string;
  trace?: {
    id: string;
    name: string | null;
    input: string | null;
    output: string | null;
    latency_ms: number | null;
  };
  steps?: TraceStep[];
  pii_redacted?: boolean;
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
    <Card className="hover:shadow-lg transition-all">
      <CardContent className="p-6">
        <div className="flex items-start justify-between mb-4">
          <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-muted">
            <Icon className={cn("h-5 w-5", iconColor)} />
          </div>
        </div>
        {loading ? (
          <div className="space-y-2">
            <Skeleton className="h-9 w-24" />
            <Skeleton className="h-3.5 w-32" />
            <Skeleton className="h-3 w-24" />
          </div>
        ) : (
          <>
            <p className="text-3xl font-bold tracking-tight text-foreground">{value}</p>
            <p className="mt-1 text-[13px] text-muted-foreground">{title}</p>
            <p className="mt-0.5 text-[11px] text-muted-foreground/60">{sub}</p>
          </>
        )}
      </CardContent>
    </Card>
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
        DOMAIN_BADGE[key] || "bg-zinc-500/15 text-zinc-400 border border-zinc-500/20",
      )}
    >
      {domain || "unknown"}
    </span>
  );
}

// ── Main Component ───────────────────────────────────────────────────────────

export function ObservabilityDashboard() {
  const { user } = useAuth();
  const [activeTab, setActiveTab] = useState<"logs" | "charts" | "triage" | "adoption">("logs");

  if (user?.role !== "Super Admin") {
    return (
      <div className="flex h-[60vh] items-center justify-center text-muted-foreground">
        Access restricted to Super Admin.
      </div>
    );
  }

  return (
    <div className="flex h-full flex-col overflow-y-auto bg-background">
      {/* Header */}
      <div className="sticky top-0 z-30 border-b border-[var(--border)] bg-background/80 backdrop-blur-xl px-6 py-4">
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-indigo-500/10">
              <Activity className="h-5 w-5 text-indigo-400" />
            </div>
            <div>
              <p className="text-[12px] text-muted-foreground">
                Activity logs, performance metrics & analytics
              </p>
              <p className="flex items-center gap-1 text-[11px] text-muted-foreground/70">
                <Lock className="h-2.5 w-2.5 shrink-0" />
                My Workspace (personal) chats are private and never logged here.
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <div className="flex rounded-lg border border-border bg-muted/30 p-1">
              {(["logs", "charts", "triage", "adoption"] as const).map((tab) => (
                <Button
                  key={tab}
                  variant={activeTab === tab ? "secondary" : "ghost"}
                  size="sm"
                  onClick={() => setActiveTab(tab)}
                  className={cn(
                    "h-8 px-4 text-xs font-medium transition-all",
                    activeTab === tab
                      ? "shadow-sm bg-background text-foreground"
                      : "text-muted-foreground hover:text-foreground hover:bg-muted/50",
                  )}
                >
                  {tab === "logs"
                    ? "Activity Logs"
                    : tab === "charts"
                      ? "Charts & Analytics"
                      : tab === "triage"
                        ? "Feedback Triage"
                        : "Feature Adoption"}
                </Button>
              ))}
            </div>
          </div>
        </div>
      </div>

      <div className="p-6">
        {activeTab === "logs" ? (
          <LogsTab />
        ) : activeTab === "charts" ? (
          <ChartsTab />
        ) : activeTab === "triage" ? (
          <FeedbackTriageTab />
        ) : (
          <AdoptionTab />
        )}
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
    [user?.email, user?.role],
  );

  const [logs, setLogs] = useState<LogEntry[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [pages, setPages] = useState(1);
  const [loading, setLoading] = useState(true);

  // Filters
  const [domain, setDomain] = useState("All");
  const [status, setStatus] = useState("All");

  // Expanded row
  const [expandedId, setExpandedId] = useState<number | null>(null);
  const [detail, setDetail] = useState<LogDetail | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);

  // In-app trace view (fetched server-side via Langfuse API — no Langfuse login needed)
  const [trace, setTrace] = useState<TraceData | null>(null);
  const [traceLoading, setTraceLoading] = useState(false);

  const fetchLogs = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams({ page: String(page), limit: "50" });
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
  }, [page, domain, status, authHeaders]);

  useEffect(() => {
    fetchLogs();
  }, [fetchLogs]);

  const loadTrace = async (id: number) => {
    setTraceLoading(true);
    try {
      const res = await fetch(`/api/observability/logs/${id}/trace`, { headers: authHeaders });
      setTrace(await res.json());
    } catch {
      setTrace({ available: false, reason: "network_error" });
    } finally {
      setTraceLoading(false);
    }
  };

  const loadDetail = async (id: number) => {
    setDetailLoading(true);
    try {
      const res = await fetch(`/api/observability/logs/${id}`, { headers: authHeaders });
      const data = await res.json();
      setDetail(data);
      // Auto-load the enriched per-step trace when this request has one.
      if (data?.langfuse_trace_id) loadTrace(id);
    } catch {
      setDetail(null);
    } finally {
      setDetailLoading(false);
    }
  };

  const handleExpand = async (id: number) => {
    if (expandedId === id) {
      setExpandedId(null);
      setDetail(null);
      setTrace(null);
      return;
    }
    setExpandedId(id);
    setTrace(null);
    await loadDetail(id);
  };

  return (
    <div className="space-y-4">
      {/* Filter bar */}
      <div className="flex flex-wrap items-center gap-3">
        <span className="text-sm font-medium text-muted-foreground mr-1">Filter</span>

        <select
          value={domain}
          onChange={(e) => {
            setDomain(e.target.value);
            setPage(1);
          }}
          className="h-9 rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2"
        >
          <option value="All">All Domains</option>
          <option value="hr">HR</option>
          <option value="it_support">IT Support</option>
          <option value="admin">Admin</option>
          <option value="pmo">PMO</option>
          <option value="general">General</option>
          <option value="functional_manager">Manager</option>
        </select>

        <div className="flex rounded-lg border border-border bg-muted/30 p-1">
          {["All", "Success", "Error"].map((s) => (
            <Button
              key={s}
              variant={status === s ? "secondary" : "ghost"}
              size="sm"
              onClick={() => {
                setStatus(s);
                setPage(1);
              }}
              className={cn(
                "h-7 px-3 text-xs font-medium transition-all",
                status === s
                  ? "shadow-sm bg-background text-foreground"
                  : "text-muted-foreground hover:text-foreground hover:bg-muted/50",
              )}
            >
              {s}
            </Button>
          ))}
        </div>

        <Button
          variant="outline"
          size="sm"
          onClick={fetchLogs}
          className="h-9 gap-2"
        >
          <RefreshCw className="h-4 w-4" />
          Refresh
        </Button>

        <span className="text-sm font-medium text-muted-foreground ml-auto">{total} total entries</span>
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
              <div
                key={log.id}
                className="rounded-2xl border border-[var(--border)] bg-card overflow-hidden"
              >
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
                      ? new Date(log.created_at).toLocaleString(undefined, {
                          month: "short",
                          day: "2-digit",
                          hour: "2-digit",
                          minute: "2-digit",
                          second: "2-digit",
                          hour12: false,
                        })
                      : "—"}
                  </span>

                  {/* User (pseudonymized) */}
                  <span className="text-[12px] font-mono text-muted-foreground truncate w-[140px] shrink-0">
                    {log.user_label || "—"}
                  </span>

                  {/* Domain */}
                  <div className="shrink-0">
                    <DomainBadge domain={log.domain} />
                  </div>

                  {/* spacer — message content is hidden by default */}
                  <span className="flex-1 min-w-0" />

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
                      isExpanded && "rotate-180",
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
                          <InfoItem
                            label="Response Length"
                            value={`${detail.response_length} chars`}
                          />
                        </div>

                        {/* Conversation content — always shown (PII masked per policy) */}
                        <div className="space-y-3">
                          {(detail.user_message || detail.response_text) && (
                            <div className="flex items-center gap-2 text-[11px] text-muted-foreground">
                              <Eye className="h-3.5 w-3.5" />
                              <span>
                                IDs, contact details, and money amounts are masked.
                              </span>
                            </div>
                          )}
                          <div>
                            <p className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground mb-1">
                              User Message
                            </p>
                            <p className="text-[13px] text-foreground bg-[var(--muted)]/30 rounded-xl px-4 py-3 whitespace-pre-wrap">
                              {detail.user_message || "—"}
                            </p>
                          </div>
                          {detail.response_text && (
                            <div>
                              <p className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground mb-1">
                                AI Response
                              </p>
                              <p className="text-[13px] text-foreground bg-[var(--muted)]/30 rounded-xl px-4 py-3 max-h-[200px] overflow-y-auto whitespace-pre-wrap">
                                {detail.response_text}
                              </p>
                            </div>
                          )}
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

                        {/* Error */}
                        {detail.error && (
                          <div className="rounded-xl border border-rose-500/20 bg-rose-500/5 px-4 py-3">
                            <p className="text-[11px] font-semibold uppercase tracking-wider text-rose-400 mb-1">
                              Error
                            </p>
                            <p className="text-[13px] text-rose-300">{detail.error}</p>
                          </div>
                        )}

                        {/* In-app trace — per-step inputs/outputs pulled from Langfuse
                            server-side (no Langfuse login needed) */}
                        {detail.langfuse_trace_id && (
                          <div>
                            <p className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground mb-2">
                              Trace
                            </p>
                            {traceLoading ? (
                              <div className="flex items-center gap-2 text-[12px] text-muted-foreground">
                                <Loader2 className="h-3.5 w-3.5 animate-spin" />
                                Loading trace steps…
                              </div>
                            ) : trace?.available && trace.steps ? (
                              <div className="space-y-1.5">
                                {trace.steps.length === 0 && (
                                  <p className="text-[12px] text-muted-foreground">
                                    No steps recorded for this trace.
                                  </p>
                                )}
                                {trace.steps.map((step, i) => (
                                  <details
                                    key={step.id || i}
                                    className="rounded-xl border border-[var(--border)] bg-card overflow-hidden"
                                  >
                                    <summary className="flex items-center gap-3 px-4 py-2.5 cursor-pointer list-none">
                                      <span className="rounded-full bg-indigo-500/15 text-indigo-400 border border-indigo-500/20 px-2 py-0.5 text-[10px] font-semibold uppercase">
                                        {step.type || "step"}
                                      </span>
                                      <span className="text-[12px] font-medium text-foreground min-w-[120px]">
                                        {step.name || "—"}
                                      </span>
                                      {step.model && (
                                        <span className="text-[11px] text-muted-foreground min-w-[120px]">
                                          {step.model}
                                        </span>
                                      )}
                                      {step.duration_ms != null && <LatencyBadge ms={step.duration_ms} />}
                                      {step.usage?.total != null && (
                                        <span className="text-[11px] font-mono text-muted-foreground">
                                          {step.usage.total} tok
                                        </span>
                                      )}
                                      {step.level && step.level !== "DEFAULT" && (
                                        <span className="rounded-full bg-rose-500/15 text-rose-400 border border-rose-500/20 px-2 py-0.5 text-[10px] font-medium">
                                          {step.level}
                                        </span>
                                      )}
                                      <ChevronDown className="h-3.5 w-3.5 text-muted-foreground ml-auto" />
                                    </summary>
                                    <div className="border-t border-[var(--border)] px-4 py-3 space-y-3">
                                      {step.input && (
                                        <div>
                                          <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground/60 mb-1">
                                            Input
                                          </p>
                                          <pre className="text-[12px] text-foreground bg-[var(--muted)]/30 rounded-lg px-3 py-2 max-h-[220px] overflow-auto whitespace-pre-wrap break-words">
                                            {step.input}
                                          </pre>
                                        </div>
                                      )}
                                      {step.output && (
                                        <div>
                                          <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground/60 mb-1">
                                            Output
                                          </p>
                                          <pre className="text-[12px] text-foreground bg-[var(--muted)]/30 rounded-lg px-3 py-2 max-h-[220px] overflow-auto whitespace-pre-wrap break-words">
                                            {step.output}
                                          </pre>
                                        </div>
                                      )}
                                      {step.status_message && (
                                        <p className="text-[11px] text-rose-300">{step.status_message}</p>
                                      )}
                                      {!step.input && !step.output && (
                                        <p className="text-[11px] text-muted-foreground">No input/output captured.</p>
                                      )}
                                    </div>
                                  </details>
                                ))}
                              </div>
                            ) : (
                              <p className="text-[12px] text-muted-foreground">
                                {trace?.reason === "not_found_or_unreachable"
                                  ? "This trace isn't in Langfuse (it predates tracing, or Langfuse is unreachable)."
                                  : trace?.reason === "langfuse_not_configured"
                                    ? "Langfuse isn't configured on this environment."
                                    : "Trace steps unavailable."}
                              </p>
                            )}
                          </div>
                        )}

                        {/* Direct Langfuse UI — disabled until SSO is configured */}
                        {detail.langfuse_trace_id && (
                          <div className="flex items-center gap-2 flex-wrap pt-1">
                            <span
                              className="inline-flex items-center gap-1.5 text-[12px] text-muted-foreground/50 cursor-not-allowed"
                              title="Opening the Langfuse UI directly requires SSO setup"
                            >
                              <ExternalLink className="h-3.5 w-3.5" />
                              Open in Langfuse
                            </span>
                            <span className="text-[11px] text-amber-400">
                              Needs SSO setup — use the trace above for now.
                            </span>
                          </div>
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
          <Button
            variant="outline"
            size="sm"
            onClick={() => setPage((p) => Math.max(1, p - 1))}
            disabled={page <= 1}
            className="gap-2 h-9"
          >
            <ChevronLeft className="h-4 w-4" />
            Previous
          </Button>
          <span className="text-sm font-medium text-muted-foreground">
            Page {page} of {pages}
          </span>
          <Button
            variant="outline"
            size="sm"
            onClick={() => setPage((p) => Math.min(pages, p + 1))}
            disabled={page >= pages}
            className="gap-2 h-9"
          >
            Next
            <ChevronRight className="h-4 w-4" />
          </Button>
        </div>
      )}
    </div>
  );
}

function InfoItem({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <p className="text-[10px] uppercase tracking-wider text-muted-foreground/60">{label}</p>
      <p className="text-[13px] text-foreground font-mono truncate" title={value}>
        {value}
      </p>
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
    [user?.email, user?.role],
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
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div className="flex rounded-lg border border-border bg-muted/30 p-1">
          {["24h", "7d", "30d"].map((p) => (
            <Button
              key={p}
              variant={period === p ? "secondary" : "ghost"}
              size="sm"
              onClick={() => setPeriod(p)}
              className={cn(
                "h-8 px-4 text-xs font-medium transition-all",
                period === p
                  ? "shadow-sm bg-background text-foreground"
                  : "text-muted-foreground hover:text-foreground hover:bg-muted/50",
              )}
            >
              {p === "24h" ? "Last 24h" : p === "7d" ? "Last 7 days" : "Last 30 days"}
            </Button>
          ))}
        </div>
        <Button
          variant="outline"
          size="sm"
          onClick={fetchAll}
          className="h-10 gap-2 font-medium"
        >
          <RefreshCw className="h-4 w-4" />
          Refresh
        </Button>
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
                      ? d.toLocaleTimeString(undefined, {
                          hour: "2-digit",
                          minute: "2-digit",
                          hour12: false,
                        })
                      : d.toLocaleDateString(undefined, { month: "short", day: "2-digit" });
                  }}
                  tick={{ fontSize: 10, fill: "var(--muted-foreground)" }}
                />
                <YAxis tick={{ fontSize: 10, fill: "var(--muted-foreground)" }} />
                <RechartsTooltip contentStyle={tooltipStyle} />
                <Area
                  type="monotone"
                  dataKey="requests"
                  stroke="#6366f1"
                  fill="url(#volGrad)"
                  strokeWidth={2}
                />
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
                      ? d.toLocaleTimeString(undefined, {
                          hour: "2-digit",
                          minute: "2-digit",
                          hour12: false,
                        })
                      : d.toLocaleDateString(undefined, { month: "short", day: "2-digit" });
                  }}
                  tick={{ fontSize: 10, fill: "var(--muted-foreground)" }}
                />
                <YAxis
                  tick={{ fontSize: 10, fill: "var(--muted-foreground)" }}
                  tickFormatter={(v) => `${(v / 1000).toFixed(1)}s`}
                />
                <RechartsTooltip
                  contentStyle={tooltipStyle}
                  formatter={(value) => [`${(Number(value) / 1000).toFixed(2)}s`, "Avg Latency"]}
                />
                <Line
                  type="monotone"
                  dataKey="avg_latency"
                  stroke="#f59e0b"
                  strokeWidth={2}
                  dot={false}
                />
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
            <div className="flex items-center justify-center h-[280px] text-muted-foreground text-[13px]">
              No data
            </div>
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
                  label={({ name, percent }) => `${name} (${((percent ?? 0) * 100).toFixed(0)}%)`}
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
            <div className="flex items-center justify-center h-[280px] text-muted-foreground text-[13px]">
              No data
            </div>
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
                <Bar
                  dataKey="prompt_tokens"
                  name="Prompt"
                  stackId="tok"
                  fill="#6366f1"
                  radius={[0, 0, 0, 0]}
                />
                <Bar
                  dataKey="completion_tokens"
                  name="Completion"
                  stackId="tok"
                  fill="#10b981"
                  radius={[0, 4, 4, 0]}
                />
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
            <Table paginate itemsPerPage={10} className="w-full text-left">
              <TableHeader>
                <TableRow className="border-b border-[var(--border)]">
                  {["Node", "Calls", "Avg Latency", "P95 Latency", "Avg Tokens", "Errors"].map(
                    (h) => (
                      <TableHead
                        key={h}
                        className="px-4 py-3 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground"
                      >
                        {h}
                      </TableHead>
                    ),
                  )}
                </TableRow>
              </TableHeader>
              <TableBody>
                {nodeData.map((n: any) => (
                  <TableRow
                    key={n.node}
                    className="border-b border-[var(--border)] last:border-0 hover:bg-[var(--muted)]/30 transition-colors"
                  >
                    <TableCell className="px-4 py-3 text-[13px] font-medium text-foreground">{n.node}</TableCell>
                    <TableCell className="px-4 py-3 text-[13px] text-muted-foreground">{n.calls}</TableCell>
                    <TableCell className="px-4 py-3">
                      <LatencyBadge ms={n.avg_ms} />
                    </TableCell>
                    <TableCell className="px-4 py-3">
                      <LatencyBadge ms={n.p95_ms} />
                    </TableCell>
                    <TableCell className="px-4 py-3 text-[13px] font-mono text-muted-foreground">
                      {n.avg_tokens}
                    </TableCell>
                    <TableCell className="px-4 py-3">
                      {n.errors > 0 ? (
                        <span className="rounded-full bg-rose-500/15 text-rose-400 border border-rose-500/20 px-2 py-0.5 text-[10px] font-medium">
                          {n.errors}
                        </span>
                      ) : (
                        <span className="text-[11px] text-muted-foreground/40">0</span>
                      )}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )}
      </div>
    </div>
  );
}
