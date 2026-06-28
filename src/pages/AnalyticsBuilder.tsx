import { useAuth } from "@/lib/auth-store";
import { useCallback, useMemo, useRef, useState } from "react";
import {
  BarChart2,
  Send,
  Sparkles,
  Loader2,
  Download,
  Save,
  Plus,
  RotateCcw,
  ChevronRight,
  TrendingUp,
  PieChart,
  Activity,
  Layers,
  ScatterChart,
  Target,
  Triangle,
  GitMerge,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { toast } from "sonner";
import { ChartCanvas, type ChartSpec } from "@/components/analytics/ChartCanvas";

// ── Types ─────────────────────────────────────────────────────────────────────

interface ChatTurn {
  role: "user" | "assistant";
  content: string;
  chart?: ChartSpec;
  suggestions?: string[];
}

function useAuthHeaders() {
  const { user } = useAuth();
  return useMemo(
    () => ({
      "Content-Type": "application/json",
      ...(user?.email ? { "x-user-email": user.email } : {}),
      ...(user?.role ? { "x-user-role": user.role.toLowerCase() } : {}),
    }),
    [user?.email, user?.role],
  );
}

// ── Chart type config ─────────────────────────────────────────────────────────

const CHART_TYPES: { type: ChartSpec["type"]; label: string; icon: any; tip: string }[] = [
  { type: "bar", label: "Bar", icon: BarChart2, tip: "Categorical comparisons" },
  { type: "line", label: "Line", icon: Activity, tip: "Trends over time" },
  { type: "area", label: "Area", icon: TrendingUp, tip: "Volume / cumulative trends" },
  { type: "pie", label: "Pie", icon: PieChart, tip: "Part-of-whole proportions" },
  { type: "scatter", label: "Scatter", icon: ScatterChart, tip: "Correlation between two measures" },
  { type: "radar", label: "Radar", icon: Target, tip: "Multi-metric comparison" },
  { type: "treemap", label: "Treemap", icon: Layers, tip: "Proportional area breakdown" },
  { type: "funnel", label: "Funnel", icon: Triangle, tip: "Sequential stage breakdown" },
  { type: "composed", label: "Composed", icon: GitMerge, tip: "Bar + line on one chart" },
];

// ── Starter prompts ───────────────────────────────────────────────────────────

const STARTERS = [
  { label: "Headcount by function", prompt: "Show headcount by function as a bar chart" },
  { label: "Leave by type", prompt: "Show leave requests by type last 6 months" },
  { label: "Bench vs allocated", prompt: "Compare bench vs allocated headcount by function" },
  { label: "Utilization trend", prompt: "Show avg utilization % trend over the last 6 months as line" },
  { label: "AI usage by domain", prompt: "AI requests by domain as a pie chart" },
  { label: "Token usage by model", prompt: "Show token usage by model as a treemap" },
  { label: "Joining trend", prompt: "New joiners per month last 12 months" },
  { label: "Gender breakdown", prompt: "Headcount by gender as a pie chart" },
  { label: "Grade distribution", prompt: "Headcount by grade as a bar chart" },
  { label: "Billable split", prompt: "Show billable vs non-billable headcount breakdown" },
];

// ── PNG export helper ─────────────────────────────────────────────────────────

function exportChartPng(containerRef: React.RefObject<HTMLDivElement | null>, title: string) {
  const svg = containerRef.current?.querySelector("svg");
  if (!svg) return;
  const serializer = new XMLSerializer();
  const svgStr = serializer.serializeToString(svg);
  const canvas = document.createElement("canvas");
  const bbox = svg.getBoundingClientRect();
  canvas.width = bbox.width * 2;
  canvas.height = bbox.height * 2;
  const ctx = canvas.getContext("2d")!;
  ctx.scale(2, 2);
  const img = new Image();
  const svgBlob = new Blob([svgStr], { type: "image/svg+xml;charset=utf-8" });
  const url = URL.createObjectURL(svgBlob);
  img.onload = () => {
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(0, 0, bbox.width, bbox.height);
    ctx.drawImage(img, 0, 0);
    URL.revokeObjectURL(url);
    const a = document.createElement("a");
    a.download = `${title.replace(/\s+/g, "_")}.png`;
    a.href = canvas.toDataURL("image/png");
    a.click();
  };
  img.src = url;
}

// ── CSV export helper ─────────────────────────────────────────────────────────

function exportChartCsv(spec: ChartSpec) {
  const headers = [spec.x_key, ...spec.y_keys];
  const rows = spec.data.map((d) => headers.map((h) => d[h] ?? "").join(","));
  const csv = [headers.join(","), ...rows].join("\n");
  const blob = new Blob([csv], { type: "text/csv" });
  const a = document.createElement("a");
  a.download = `${spec.title.replace(/\s+/g, "_")}.csv`;
  a.href = URL.createObjectURL(blob);
  a.click();
  URL.revokeObjectURL(a.href);
}

// ── Server export helper (PDF / PPTX) ──────────────────────────────────────────
// The backend renders a real vector chart (PDF) or a native editable chart (PPTX)
// from the same ChartSpec we're displaying — see analytics_export_service.py.

async function exportChartServer(
  spec: ChartSpec,
  format: "pdf" | "pptx",
  authHeaders: Record<string, string>,
): Promise<boolean> {
  try {
    const res = await fetch(`/api/analytics/export/${format}`, {
      method: "POST",
      headers: authHeaders,
      body: JSON.stringify(spec),
    });
    if (!res.ok) return false;
    const blob = await res.blob();
    const a = document.createElement("a");
    a.download = `${spec.title.replace(/\s+/g, "_") || "analytics_chart"}.${format}`;
    a.href = URL.createObjectURL(blob);
    a.click();
    URL.revokeObjectURL(a.href);
    return true;
  } catch {
    return false;
  }
}

// ── Save to board helper ──────────────────────────────────────────────────────

async function saveToBoard(
  spec: ChartSpec,
  authHeaders: Record<string, string>,
): Promise<boolean> {
  const widget = {
    title: spec.title,
    metric: spec.type,
    dimension: spec.x_key,
    period: "custom",
    chart_type: spec.type,
    layout: { w: 2 },
    builder_spec: spec,  // store full spec for builder widgets
  };
  try {
    const listRes = await fetch("/api/analytics/dashboards", { headers: authHeaders });
    if (!listRes.ok) return false;
    const boards: any[] = await listRes.json();
    const myBoard = boards.find((b) => b.is_owner);
    if (myBoard) {
      const updated = [...(myBoard.widgets || []), widget];
      const r = await fetch(`/api/analytics/dashboards/${myBoard.id}`, {
        method: "PUT",
        headers: authHeaders,
        body: JSON.stringify({ name: myBoard.name, widgets: updated }),
      });
      return r.ok;
    } else {
      const r = await fetch("/api/analytics/dashboards", {
        method: "POST",
        headers: authHeaders,
        body: JSON.stringify({ name: "My Analytics Board", widgets: [widget] }),
      });
      return r.ok;
    }
  } catch {
    return false;
  }
}

// ── Main component ────────────────────────────────────────────────────────────

export function AnalyticsBuilder() {
  const authHeaders = useAuthHeaders();
  const [turns, setTurns] = useState<ChatTurn[]>([]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [activeChart, setActiveChart] = useState<ChartSpec | null>(null);
  const [activeTitle, setActiveTitle] = useState<string>("");
  const [saveStatus, setSaveStatus] = useState<"idle" | "saving" | "saved">("idle");
  const chartRef = useRef<HTMLDivElement>(null);
  const chatEndRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  const scrollChat = useCallback(() => {
    setTimeout(() => chatEndRef.current?.scrollIntoView({ behavior: "smooth" }), 50);
  }, []);

  const sendMessage = useCallback(
    async (text: string) => {
      if (!text.trim() || loading) return;
      setInput("");
      const userTurn: ChatTurn = { role: "user", content: text };
      setTurns((prev) => [...prev, userTurn]);
      setLoading(true);
      scrollChat();

      try {
        const history = turns.slice(-6).map((t) => ({
          role: t.role,
          content: t.chart ? `[Showed chart: ${t.chart.title}] ${t.content}` : t.content,
        }));

        const res = await fetch("/api/analytics/builder/chat", {
          method: "POST",
          headers: authHeaders,
          body: JSON.stringify({ message: text, history }),
        });
        const data = await res.json();

        const assistantTurn: ChatTurn = {
          role: "assistant",
          content: data.explanation || "Here's the chart.",
          chart: data.ok ? data.chart : undefined,
          suggestions: data.suggestions ?? [],
        };
        setTurns((prev) => [...prev, assistantTurn]);
        if (data.ok && data.chart) {
          setActiveChart(data.chart);
          setActiveTitle(data.chart.title);
        }
      } catch {
        setTurns((prev) => [
          ...prev,
          {
            role: "assistant",
            content: "Something went wrong — please try again.",
            suggestions: [],
          },
        ]);
      } finally {
        setLoading(false);
        scrollChat();
      }
    },
    [authHeaders, loading, turns, scrollChat],
  );

  const switchChartType = (type: ChartSpec["type"]) => {
    if (!activeChart) return;
    setActiveChart({ ...activeChart, type });
  };

  const handleSave = async () => {
    if (!activeChart) return;
    setSaveStatus("saving");
    const ok = await saveToBoard(activeChart, authHeaders);
    setSaveStatus(ok ? "saved" : "idle");
    if (ok) setTimeout(() => setSaveStatus("idle"), 2500);
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      sendMessage(input);
    }
  };

  const isEmpty = turns.length === 0;

  return (
    <div className="flex h-full bg-background overflow-hidden">
      {/* ── LEFT: Chat Panel ─────────────────────────────────────────────────── */}
      <div className="flex flex-col w-full lg:w-[400px] xl:w-[440px] shrink-0 border-r border-[var(--border)] bg-card/40">
        {/* Header */}
        <div className="px-5 py-4 border-b border-[var(--border)] shrink-0">
          <div className="flex items-center gap-3">
            <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-indigo-500/10 shrink-0">
              <Sparkles className="h-4.5 w-4.5 text-indigo-400" />
            </div>
            <div>
              <h1 className="text-[16px] font-bold text-foreground leading-tight">Analytics Builder</h1>
              <p className="text-[11px] text-muted-foreground">
                Describe any chart in plain English
              </p>
            </div>
          </div>
        </div>

        {/* Messages */}
        <div className="flex-1 overflow-y-auto p-4 space-y-4 no-scrollbar">
          {isEmpty ? (
            <div className="space-y-4">
              <p className="text-[13px] text-muted-foreground text-center px-2 pt-4">
                Ask me to build any chart from your data — employees, leaves, workforce allocation, AI usage, and more.
              </p>
              <div className="grid grid-cols-1 gap-2">
                {STARTERS.map((s) => (
                  <button
                    key={s.label}
                    onClick={() => sendMessage(s.prompt)}
                    className="flex items-center gap-2 text-left rounded-xl border border-[var(--border)] px-3.5 py-2.5 text-[12px] font-medium text-foreground hover:bg-[var(--muted)] hover:border-indigo-500/30 transition-all group"
                  >
                    <ChevronRight className="h-3 w-3 text-muted-foreground group-hover:text-indigo-400 shrink-0" />
                    <span className="truncate">{s.label}</span>
                  </button>
                ))}
              </div>
            </div>
          ) : (
            turns.map((turn, i) => (
              <div key={i} className={cn("flex flex-col gap-1", turn.role === "user" && "items-end")}>
                {turn.role === "user" ? (
                  <div className="max-w-[85%] rounded-2xl bg-indigo-500 px-4 py-2.5 text-[13px] text-white leading-relaxed">
                    {turn.content}
                  </div>
                ) : (
                  <div className="space-y-2 max-w-full">
                    <div className="flex items-start gap-2">
                      <div className="flex h-6 w-6 items-center justify-center rounded-lg bg-indigo-500/10 shrink-0 mt-0.5">
                        <Sparkles className="h-3 w-3 text-indigo-400" />
                      </div>
                      <p className="text-[13px] text-foreground leading-relaxed flex-1"
                         dangerouslySetInnerHTML={{
                           __html: turn.content.replace(/\*\*(.*?)\*\*/g, "<strong>$1</strong>"),
                         }}
                      />
                    </div>

                    {/* Inline mini-preview when chart exists and it's not the latest */}
                    {turn.chart && i < turns.length - 1 && (
                      <button
                        onClick={() => { setActiveChart(turn.chart!); setActiveTitle(turn.chart!.title); }}
                        className="ml-8 flex items-center gap-1.5 rounded-xl border border-[var(--border)] px-3 py-1.5 text-[11px] text-muted-foreground hover:text-foreground hover:bg-[var(--muted)] transition-all"
                      >
                        <BarChart2 className="h-3 w-3" /> Restore this chart
                      </button>
                    )}

                    {/* Suggestions */}
                    {turn.suggestions && turn.suggestions.length > 0 && i === turns.length - 1 && (
                      <div className="ml-8 flex flex-wrap gap-1.5 pt-1">
                        {turn.suggestions.slice(0, 4).map((s) => (
                          <button
                            key={s}
                            onClick={() => sendMessage(s)}
                            className="rounded-lg border border-[var(--border)] px-2.5 py-1 text-[11px] text-muted-foreground hover:text-foreground hover:border-indigo-500/40 hover:bg-indigo-500/5 transition-all"
                          >
                            {s}
                          </button>
                        ))}
                      </div>
                    )}
                  </div>
                )}
              </div>
            ))
          )}
          {loading && (
            <div className="flex items-center gap-2 text-[13px] text-muted-foreground pl-1">
              <Loader2 className="h-4 w-4 animate-spin text-indigo-400" />
              <span>Building chart…</span>
            </div>
          )}
          <div ref={chatEndRef} />
        </div>

        {/* Input */}
        <div className="px-4 pb-4 pt-2 shrink-0 border-t border-[var(--border)]">
          <div className="flex items-end gap-2 rounded-2xl border border-[var(--border)] bg-background p-2 focus-within:border-indigo-500/50 transition-colors">
            <textarea
              ref={inputRef}
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder="Ask for any chart… e.g. bench vs allocated by function"
              className="flex-1 bg-transparent resize-none text-[13px] outline-none placeholder:text-muted-foreground/60 min-h-[36px] max-h-[120px] leading-relaxed px-1 py-0.5"
              rows={1}
            />
            <button
              onClick={() => sendMessage(input)}
              disabled={loading || !input.trim()}
              className="flex h-8 w-8 items-center justify-center rounded-xl bg-indigo-500 text-white disabled:opacity-40 hover:bg-indigo-600 transition-colors shrink-0"
            >
              {loading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Send className="h-3.5 w-3.5" />}
            </button>
          </div>
          <p className="text-[10px] text-muted-foreground/50 text-center mt-1.5">
            Enter to send · Shift+Enter for new line
          </p>
        </div>
      </div>

      {/* ── RIGHT: Chart Canvas ───────────────────────────────────────────────── */}
      <div className="flex-1 flex flex-col overflow-hidden hidden lg:flex">
        {activeChart ? (
          <>
            {/* Chart toolbar */}
            <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 gap-3 px-6 py-3.5 border-b border-[var(--border)] shrink-0 bg-card/30">
              <div className="min-w-0">
                <h2 className="text-[15px] font-semibold text-foreground truncate">{activeChart.title}</h2>
                {activeChart.subtitle && (
                  <p className="text-[11px] text-muted-foreground truncate">{activeChart.subtitle}</p>
                )}
              </div>
              <div className="flex items-center gap-2 shrink-0">
                <button
                  onClick={() => setTurns([])}
                  className="flex items-center gap-1.5 rounded-xl border border-[var(--border)] px-3 py-1.5 text-[11px] font-medium text-muted-foreground hover:text-foreground transition-colors"
                  title="Clear chat"
                >
                  <RotateCcw className="h-3 w-3" /> Reset
                </button>
                <button
                  onClick={() => exportChartCsv(activeChart)}
                  className="flex items-center gap-1.5 rounded-xl border border-[var(--border)] px-3 py-1.5 text-[11px] font-medium text-muted-foreground hover:text-foreground transition-colors"
                >
                  <Download className="h-3 w-3" /> CSV
                </button>
                <button
                  onClick={() => exportChartPng(chartRef, activeChart.title)}
                  className="flex items-center gap-1.5 rounded-xl border border-[var(--border)] px-3 py-1.5 text-[11px] font-medium text-muted-foreground hover:text-foreground transition-colors"
                >
                  <Download className="h-3 w-3" /> PNG
                </button>
                <button
                  onClick={() =>
                    toast.promise(exportChartServer(activeChart, "pdf", authHeaders), {
                      loading: "Building PDF…",
                      success: (ok: boolean) => (ok ? "PDF downloaded" : "Export failed"),
                      error: "Export failed",
                    })
                  }
                  className="flex items-center gap-1.5 rounded-xl border border-[var(--border)] px-3 py-1.5 text-[11px] font-medium text-muted-foreground hover:text-foreground transition-colors"
                >
                  <Download className="h-3 w-3" /> PDF
                </button>
                <button
                  onClick={() =>
                    toast.promise(exportChartServer(activeChart, "pptx", authHeaders), {
                      loading: "Building PPTX…",
                      success: (ok: boolean) => (ok ? "PPTX downloaded" : "Export failed"),
                      error: "Export failed",
                    })
                  }
                  className="flex items-center gap-1.5 rounded-xl border border-[var(--border)] px-3 py-1.5 text-[11px] font-medium text-muted-foreground hover:text-foreground transition-colors"
                >
                  <Download className="h-3 w-3" /> PPTX
                </button>
                <button
                  onClick={handleSave}
                  disabled={saveStatus === "saving"}
                  className={cn(
                    "flex items-center gap-1.5 rounded-xl px-3.5 py-1.5 text-[11px] font-medium transition-colors",
                    saveStatus === "saved"
                      ? "bg-emerald-500/15 text-emerald-500 border border-emerald-500/30"
                      : "bg-indigo-500 text-white hover:bg-indigo-600 disabled:opacity-50",
                  )}
                >
                  {saveStatus === "saving" ? (
                    <Loader2 className="h-3 w-3 animate-spin" />
                  ) : (
                    <Save className="h-3 w-3" />
                  )}
                  {saveStatus === "saved" ? "Saved!" : "Save to board"}
                </button>
              </div>
            </div>

            {/* Chart type switcher */}
            <div className="px-6 py-3 border-b border-[var(--border)] bg-card/20 shrink-0">
              <div className="flex items-center gap-1 flex-wrap">
                <span className="text-[10px] font-semibold text-muted-foreground/60 uppercase tracking-wider mr-2">
                  Chart type
                </span>
                {CHART_TYPES.map(({ type, label, icon: Icon, tip }) => (
                  <button
                    key={type}
                    onClick={() => switchChartType(type)}
                    title={tip}
                    className={cn(
                      "flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-[11px] font-medium transition-all",
                      activeChart.type === type
                        ? "bg-indigo-500/15 text-indigo-400 border border-indigo-500/30"
                        : "text-muted-foreground hover:text-foreground hover:bg-[var(--muted)] border border-transparent",
                    )}
                  >
                    <Icon className="h-3 w-3 shrink-0" />
                    {label}
                  </button>
                ))}
              </div>
            </div>

            {/* Chart */}
            <div className="flex-1 overflow-y-auto p-8" ref={chartRef}>
              <div className="max-w-4xl mx-auto">
                <ChartCanvas spec={activeChart} height={420} />

                {/* Data table preview */}
                {activeChart.data.length > 0 && (
                  <div className="mt-8">
                    <h3 className="text-[12px] font-semibold text-muted-foreground mb-3 uppercase tracking-wider">
                      Raw Data
                    </h3>
                    <div className="overflow-x-auto rounded-xl border border-[var(--border)]">
                      <table className="w-full text-[12px]">
                        <thead>
                          <tr className="border-b border-[var(--border)] bg-muted/40">
                            <th className="text-left px-4 py-2.5 font-semibold text-muted-foreground">
                              {activeChart.x_key}
                            </th>
                            {activeChart.y_keys.map((k) => (
                              <th key={k} className="text-right px-4 py-2.5 font-semibold text-muted-foreground">
                                {activeChart.y_labels?.[k] ?? k}
                              </th>
                            ))}
                          </tr>
                        </thead>
                        <tbody>
                          {activeChart.data.slice(0, 20).map((row, i) => (
                            <tr key={i} className="border-b border-[var(--border)]/50 hover:bg-muted/20">
                              <td className="px-4 py-2 text-foreground font-medium">
                                {String(row[activeChart.x_key] ?? "—")}
                              </td>
                              {activeChart.y_keys.map((k) => (
                                <td key={k} className="px-4 py-2 text-right text-muted-foreground tabular-nums">
                                  {row[k] ?? "—"}
                                </td>
                              ))}
                            </tr>
                          ))}
                        </tbody>
                      </table>
                      {activeChart.data.length > 20 && (
                        <p className="px-4 py-2 text-[11px] text-muted-foreground">
                          + {activeChart.data.length - 20} more rows — export CSV for full dataset
                        </p>
                      )}
                    </div>
                  </div>
                )}
              </div>
            </div>
          </>
        ) : (
          /* Empty state */
          <div className="flex-1 flex flex-col items-center justify-center gap-6 px-8 text-center">
            <div className="flex h-20 w-20 items-center justify-center rounded-3xl bg-indigo-500/10">
              <BarChart2 className="h-10 w-10 text-indigo-400" />
            </div>
            <div className="space-y-2 max-w-sm">
              <h2 className="text-[20px] font-bold text-foreground">AI Chart Builder</h2>
              <p className="text-[14px] text-muted-foreground leading-relaxed">
                Describe any chart you want — employee headcount, leave trends, workforce allocation,
                AI usage, satisfaction — in plain English. The agent builds it instantly.
              </p>
            </div>
            <div className="grid grid-cols-3 gap-3 mt-2 max-w-xl">
              {CHART_TYPES.map(({ type, label, icon: Icon }) => (
                <div
                  key={type}
                  className="rounded-xl border border-[var(--border)] bg-card/60 px-4 py-3 flex flex-col items-center gap-1.5"
                >
                  <Icon className="h-5 w-5 text-indigo-400" />
                  <span className="text-[11px] font-semibold text-foreground">{label}</span>
                </div>
              ))}
            </div>
            <p className="text-[12px] text-muted-foreground/60">
              Start a conversation in the left panel →
            </p>
          </div>
        )}
      </div>

      {/* Mobile: chart below chat (shown only on small screens) */}
      {activeChart && (
        <div className="lg:hidden fixed inset-0 z-40 bg-background flex flex-col">
          <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 gap-3 px-4 py-3 border-b border-[var(--border)]">
            <h2 className="text-[14px] font-semibold text-foreground truncate flex-1">{activeChart.title}</h2>
            <div className="flex items-center gap-2">
              <button onClick={() => exportChartCsv(activeChart)} className="p-2 text-muted-foreground hover:text-foreground">
                <Download className="h-4 w-4" />
              </button>
              <button
                onClick={() => setActiveChart(null)}
                className="rounded-xl border border-[var(--border)] px-3 py-1.5 text-[12px] text-muted-foreground"
              >
                Back to chat
              </button>
            </div>
          </div>
          <div className="flex-1 overflow-y-auto p-4">
            <ChartCanvas spec={activeChart} height={300} />
          </div>
        </div>
      )}
    </div>
  );
}
