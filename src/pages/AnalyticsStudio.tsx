import { useAuth } from "@/lib/auth-store";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Sparkles,
  LayoutDashboard,
  Plus,
  Save,
  Loader2,
  Trash2,
  Maximize2,
  Minimize2,
  GripVertical,
  FolderOpen,
  X,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { MetricChart, type ChartType } from "@/components/analytics/MetricChart";
import { MyAnalytics } from "@/components/analytics/MyAnalytics";

interface CatalogMetric {
  id: string;
  label: string;
  dims: string[];
  chart_hint: ChartType;
  unit: string;
}
interface Catalog {
  metrics: CatalogMetric[];
  dimensions: { id: string; label: string }[];
  chart_types: ChartType[];
  periods: string[];
}

interface Widget {
  title: string;
  metric: string;
  dimension: string;
  period: string;
  chart_type: ChartType;
  layout: { w: number }; // w: 1 (half) | 2 (full) — persisted, round-trips on reload
}

interface Board {
  id: number;
  name: string;
  widgets: Widget[];
  is_owner: boolean;
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

export function AnalyticsStudio() {
  const authHeaders = useAuthHeaders();
  const [catalog, setCatalog] = useState<Catalog | null>(null);

  // Builder state
  const [metric, setMetric] = useState("requests");
  const [dimension, setDimension] = useState("domain");
  const [chartType, setChartType] = useState<ChartType>("bar");
  const [period, setPeriod] = useState("30d");
  const [preview, setPreview] = useState<any | null>(null);
  const [previewLoading, setPreviewLoading] = useState(false);

  // NL state
  const [question, setQuestion] = useState("");
  const [nlLoading, setNlLoading] = useState(false);
  const [nlMessage, setNlMessage] = useState<string | null>(null);

  // Board state
  const [widgets, setWidgets] = useState<Widget[]>([]);
  const [boardName, setBoardName] = useState("Untitled Board");
  const [boardId, setBoardId] = useState<number | null>(null);
  const [boards, setBoards] = useState<Board[]>([]);
  const [showLoad, setShowLoad] = useState(false);
  const [saving, setSaving] = useState(false);

  // Load catalog + saved boards
  useEffect(() => {
    fetch("/api/analytics/catalog", { headers: authHeaders })
      .then((r) => (r.ok ? r.json() : null))
      .then((c) => c && setCatalog(c));
  }, [authHeaders]);

  const fetchBoards = useCallback(async () => {
    const res = await fetch("/api/analytics/dashboards", { headers: authHeaders });
    if (res.ok) setBoards(await res.json());
  }, [authHeaders]);
  useEffect(() => {
    fetchBoards();
  }, [fetchBoards]);

  // Keep dimension valid for the selected metric
  const metricSpec = catalog?.metrics.find((m) => m.id === metric);
  useEffect(() => {
    if (metricSpec && !metricSpec.dims.includes(dimension)) {
      setDimension(metricSpec.dims[0]);
    }
  }, [metricSpec, dimension]);

  const runPreview = useCallback(async () => {
    setPreviewLoading(true);
    try {
      const res = await fetch("/api/analytics/query", {
        method: "POST",
        headers: authHeaders,
        body: JSON.stringify({ metric, dimension, period }),
      });
      setPreview(res.ok ? await res.json() : null);
    } finally {
      setPreviewLoading(false);
    }
  }, [authHeaders, metric, dimension, period]);

  useEffect(() => {
    runPreview();
  }, [runPreview]);

  const askData = async () => {
    if (!question.trim()) return;
    setNlLoading(true);
    setNlMessage(null);
    try {
      const res = await fetch("/api/analytics/nl-query", {
        method: "POST",
        headers: authHeaders,
        body: JSON.stringify({ question }),
      });
      const data = await res.json();
      if (!data.ok) {
        setNlMessage(data.message || "Couldn't map that question.");
        return;
      }
      // Back-fill the dropdowns with what the model understood (transparent + editable)
      setMetric(data.config.metric);
      setDimension(data.config.dimension);
      setPeriod(data.config.period);
      setChartType(data.config.chart_type);
      setPreview(data);
    } finally {
      setNlLoading(false);
    }
  };

  const addToBoard = () => {
    const label = metricSpec?.label || metric;
    setWidgets((w) => [
      ...w,
      {
        title: `${label} by ${dimension}`,
        metric,
        dimension,
        period,
        chart_type: chartType,
        layout: { w: 1 },
      },
    ]);
  };

  const saveBoard = async () => {
    setSaving(true);
    try {
      const body = JSON.stringify({ name: boardName, widgets });
      const res = boardId
        ? await fetch(`/api/analytics/dashboards/${boardId}`, {
            method: "PUT",
            headers: authHeaders,
            body,
          })
        : await fetch("/api/analytics/dashboards", { method: "POST", headers: authHeaders, body });
      if (res.ok) {
        const saved = await res.json();
        setBoardId(saved.id);
        fetchBoards();
      } else {
        alert("Save failed.");
      }
    } finally {
      setSaving(false);
    }
  };

  const openBoard = (b: Board) => {
    setBoardId(b.id);
    setBoardName(b.name);
    setWidgets(b.widgets || []);
    setShowLoad(false);
  };

  const newBoard = () => {
    setBoardId(null);
    setBoardName("Untitled Board");
    setWidgets([]);
  };

  // ── Native drag-to-reorder ──────────────────────────────────────────────────
  const dragIdx = useRef<number | null>(null);
  const onDragStart = (i: number) => (dragIdx.current = i);
  const onDrop = (i: number) => {
    const from = dragIdx.current;
    dragIdx.current = null;
    if (from === null || from === i) return;
    setWidgets((w) => {
      const next = [...w];
      const [moved] = next.splice(from, 1);
      next.splice(i, 0, moved);
      return next;
    });
  };

  const toggleWidth = (i: number) =>
    setWidgets((w) =>
      w.map((x, j) => (j === i ? { ...x, layout: { w: x.layout.w === 2 ? 1 : 2 } } : x)),
    );
  const removeWidget = (i: number) => setWidgets((w) => w.filter((_, j) => j !== i));

  return (
    <div className="flex h-full flex-col overflow-y-auto bg-background">
      {/* Header */}
      <div className="sticky top-0 z-30 border-b border-[var(--border)] bg-background/80 backdrop-blur-xl px-6 py-4">
        <div className="flex items-center justify-between flex-wrap gap-3">
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-indigo-500/10">
              <LayoutDashboard className="h-5 w-5 text-indigo-400" />
            </div>
            <div>
              <h1 className="text-[20px] font-bold text-foreground">Analytics Studio</h1>
              <p className="text-[12px] text-muted-foreground">
                Build charts in plain English or with dropdowns — then save a board
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <input
              value={boardName}
              onChange={(e) => setBoardName(e.target.value)}
              className="rounded-xl border border-[var(--border)] bg-background px-3 py-2 text-[13px] w-40"
            />
            <button
              onClick={() => setShowLoad(true)}
              className="flex items-center gap-1.5 rounded-xl border border-[var(--border)] px-3 py-2 text-[12px] font-medium text-muted-foreground hover:text-foreground"
            >
              <FolderOpen className="h-3.5 w-3.5" /> Open
            </button>
            <button
              onClick={newBoard}
              className="flex items-center gap-1.5 rounded-xl border border-[var(--border)] px-3 py-2 text-[12px] font-medium text-muted-foreground hover:text-foreground"
            >
              <Plus className="h-3.5 w-3.5" /> New
            </button>
            <button
              onClick={saveBoard}
              disabled={saving || widgets.length === 0}
              className="flex items-center gap-1.5 rounded-xl bg-primary px-3.5 py-2 text-[12px] font-medium text-primary-foreground disabled:opacity-50"
            >
              <Save className="h-3.5 w-3.5" /> {saving ? "Saving…" : "Save board"}
            </button>
          </div>
        </div>
      </div>

      <div className="p-6 space-y-6">
        {/* Personal + team analytics (item 9) — self-scoped to the caller / their reports */}
        <MyAnalytics />

        {/* NL bar */}
        <div className="rounded-2xl border border-indigo-500/20 bg-indigo-500/5 p-4">
          <div className="flex items-center gap-2">
            <Sparkles className="h-4 w-4 text-indigo-400 shrink-0" />
            <input
              value={question}
              onChange={(e) => setQuestion(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && askData()}
              placeholder='Ask your data — e.g. "requests by domain last 7 days"'
              className="flex-1 bg-transparent text-[14px] outline-none placeholder:text-muted-foreground/60"
            />
            <button
              onClick={askData}
              disabled={nlLoading}
              className="flex items-center gap-1.5 rounded-xl bg-indigo-500 px-3.5 py-2 text-[12px] font-medium text-white disabled:opacity-50"
            >
              {nlLoading ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
              ) : (
                <Sparkles className="h-3.5 w-3.5" />
              )}
              Ask
            </button>
          </div>
          {nlMessage && <p className="mt-2 text-[12px] text-amber-500 pl-6">{nlMessage}</p>}
        </div>

        {/* Builder + preview */}
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          <div className="rounded-2xl border border-[var(--border)] bg-card p-5 space-y-4">
            <h3 className="text-[14px] font-semibold text-foreground">Configure</h3>
            <Field label="Metric">
              <select
                value={metric}
                onChange={(e) => setMetric(e.target.value)}
                className={selectCls}
              >
                {catalog?.metrics.map((m) => (
                  <option key={m.id} value={m.id}>
                    {m.label}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="Group by">
              <select
                value={dimension}
                onChange={(e) => setDimension(e.target.value)}
                className={selectCls}
              >
                {(metricSpec?.dims || []).map((d) => (
                  <option key={d} value={d}>
                    {catalog?.dimensions.find((x) => x.id === d)?.label || d}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="Chart type">
              <select
                value={chartType}
                onChange={(e) => setChartType(e.target.value as ChartType)}
                className={selectCls}
              >
                {(catalog?.chart_types || []).map((c) => (
                  <option key={c} value={c}>
                    {c}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="Period">
              <select
                value={period}
                onChange={(e) => setPeriod(e.target.value)}
                className={selectCls}
              >
                {(catalog?.periods || []).map((p) => (
                  <option key={p} value={p}>
                    {p}
                  </option>
                ))}
              </select>
            </Field>
            <button
              onClick={addToBoard}
              className="w-full flex items-center justify-center gap-1.5 rounded-xl border border-[var(--border)] px-3 py-2.5 text-[13px] font-medium text-foreground hover:bg-[var(--muted)]"
            >
              <Plus className="h-4 w-4" /> Add to board
            </button>
          </div>

          <div className="lg:col-span-2 rounded-2xl border border-[var(--border)] bg-card p-5">
            <h3 className="text-[14px] font-semibold text-foreground mb-3">Preview</h3>
            {previewLoading ? (
              <div className="flex items-center justify-center h-[260px]">
                <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
              </div>
            ) : (
              <MetricChart
                chartType={chartType}
                series={preview?.series || []}
                unit={preview?.unit}
              />
            )}
          </div>
        </div>

        {/* Board */}
        <div>
          <h3 className="text-[14px] font-semibold text-foreground mb-3">
            Board · {widgets.length} widget{widgets.length === 1 ? "" : "s"}
          </h3>
          {widgets.length === 0 ? (
            <div className="rounded-2xl border border-dashed border-[var(--border)] p-10 text-center text-[13px] text-muted-foreground">
              Add charts above to build your board, then Save. Drag the handle to reorder; toggle a
              widget to full width.
            </div>
          ) : (
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
              {widgets.map((w, i) => (
                <div
                  key={i}
                  draggable
                  onDragStart={() => onDragStart(i)}
                  onDragOver={(e) => e.preventDefault()}
                  onDrop={() => onDrop(i)}
                  className={cn(
                    "rounded-2xl border border-[var(--border)] bg-card p-5",
                    w.layout.w === 2 && "lg:col-span-2",
                  )}
                >
                  <div className="flex items-center justify-between mb-3">
                    <div className="flex items-center gap-2">
                      <GripVertical className="h-4 w-4 text-muted-foreground cursor-grab" />
                      <span className="text-[14px] font-medium text-foreground">{w.title}</span>
                      <span className="text-[11px] text-muted-foreground">· {w.period}</span>
                    </div>
                    <div className="flex items-center gap-1">
                      <button
                        onClick={() => toggleWidth(i)}
                        className="rounded-lg p-1.5 text-muted-foreground hover:text-foreground"
                        title="Toggle width"
                      >
                        {w.layout.w === 2 ? (
                          <Minimize2 className="h-3.5 w-3.5" />
                        ) : (
                          <Maximize2 className="h-3.5 w-3.5" />
                        )}
                      </button>
                      <button
                        onClick={() => removeWidget(i)}
                        className="rounded-lg p-1.5 text-muted-foreground hover:text-rose-400"
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </button>
                    </div>
                  </div>
                  <WidgetTile widget={w} authHeaders={authHeaders} />
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      {showLoad && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm p-4">
          <div className="w-full max-w-md rounded-2xl border border-[var(--border)] bg-card p-6 shadow-2xl">
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-[16px] font-semibold text-foreground">Open a board</h3>
              <button
                onClick={() => setShowLoad(false)}
                className="text-muted-foreground hover:text-foreground"
              >
                <X className="h-4 w-4" />
              </button>
            </div>
            {boards.length === 0 ? (
              <p className="text-[13px] text-muted-foreground">No saved boards yet.</p>
            ) : (
              <div className="space-y-2 max-h-80 overflow-y-auto">
                {boards.map((b) => (
                  <button
                    key={b.id}
                    onClick={() => openBoard(b)}
                    className="w-full text-left rounded-xl border border-[var(--border)] px-4 py-3 hover:bg-[var(--muted)]"
                  >
                    <p className="text-[13px] font-medium text-foreground">{b.name}</p>
                    <p className="text-[11px] text-muted-foreground">
                      {(b.widgets || []).length} widget(s){b.is_owner ? "" : " · shared"}
                    </p>
                  </button>
                ))}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

function WidgetTile({
  widget,
  authHeaders,
}: {
  widget: Widget;
  authHeaders: Record<string, string>;
}) {
  const [series, setSeries] = useState<any[]>([]);
  const [unit, setUnit] = useState<string | undefined>();
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let alive = true;
    setLoading(true);
    fetch("/api/analytics/query", {
      method: "POST",
      headers: authHeaders,
      body: JSON.stringify({
        metric: widget.metric,
        dimension: widget.dimension,
        period: widget.period,
      }),
    })
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => {
        if (!alive || !d) return;
        setSeries(d.series || []);
        setUnit(d.unit);
      })
      .finally(() => alive && setLoading(false));
    return () => {
      alive = false;
    };
  }, [widget.metric, widget.dimension, widget.period, authHeaders]);

  if (loading) {
    return (
      <div className="flex items-center justify-center h-[240px]">
        <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
      </div>
    );
  }
  return <MetricChart chartType={widget.chart_type} series={series} unit={unit} height={240} />;
}

const selectCls =
  "w-full rounded-xl border border-[var(--border)] bg-background px-3 py-2 text-[13px] outline-none";

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <label className="block text-[12px] font-medium text-foreground mb-1">{label}</label>
      {children}
    </div>
  );
}
