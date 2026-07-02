/**
 * ChartCanvas — universal chart renderer for the Analytics Builder.
 *
 * Accepts a ChartSpec (multi-series, named axes) and renders the appropriate
 * recharts component. Supports: bar, line, area, pie, scatter, radar, treemap,
 * funnel, composed (bar + line mix).
 */

import { useId, useRef, useState, useCallback, useEffect } from "react";
import { useAuth } from "@/lib/auth-store";
import { toast } from "sonner";
import {
  ResponsiveContainer,
  CartesianGrid,
  XAxis,
  YAxis,
  Tooltip as RechartsTooltip,
  Legend,
  BarChart,
  Bar,
  LineChart,
  Line,
  AreaChart,
  Area,
  PieChart,
  Pie,
  Cell,
  ScatterChart,
  Scatter,
  ZAxis,
  RadarChart,
  Radar,
  PolarGrid,
  PolarAngleAxis,
  PolarRadiusAxis,
  Treemap,
  FunnelChart,
  Funnel,
  LabelList,
  ComposedChart,
} from "recharts";
import { cn } from "@/lib/utils";

// ── Shared types ──────────────────────────────────────────────────────────────

export interface ChartSpec {
  type:
    | "bar"
    | "line"
    | "area"
    | "pie"
    | "scatter"
    | "radar"
    | "treemap"
    | "funnel"
    | "composed";
  title: string;
  subtitle?: string | null;
  data: Record<string, any>[];
  x_key: string;
  y_keys: string[];
  y_labels?: Record<string, string>;
  colors?: string[];
  unit?: string | null;
  stacked?: boolean;
  label_key?: string | null;
}

// ── Constants ─────────────────────────────────────────────────────────────────

const DEFAULT_COLORS = [
  "#6366f1",
  "#10b981",
  "#f59e0b",
  "#06b6d4",
  "#8b5cf6",
  "#ef4444",
  "#ec4899",
  "#14b8a6",
  "#f97316",
  "#84cc16",
];

function color(spec: ChartSpec, idx: number) {
  const palette = spec.colors?.length ? spec.colors : DEFAULT_COLORS;
  return palette[idx % palette.length];
}

// ── Formatters ────────────────────────────────────────────────────────────────

function fmtTick(v: any): string {
  if (typeof v === "string") {
    // ISO datetime (date_trunc output like "2025-01-01T00:00:00")
    if (/^\d{4}-\d{2}-\d{2}[T ]/.test(v)) {
      const d = new Date(v);
      if (!isNaN(d.getTime()))
        return d.toLocaleDateString("en-IN", { month: "short", year: "2-digit" });
    }
    // ISO date
    if (/^\d{4}-\d{2}-\d{2}$/.test(v)) {
      const d = new Date(v);
      if (!isNaN(d.getTime()))
        return d.toLocaleDateString("en-IN", { month: "short", day: "2-digit" });
    }
  }
  return String(v ?? "");
}

function fmtValue(v: any, unit?: string | null): string {
  const n = Number(v);
  if (isNaN(n)) return String(v ?? "");
  if (unit === "pct") return `${n.toFixed(1)}%`;
  if (unit === "sec") return `${n.toFixed(1)}s`;
  if (unit === "days") return `${n}d`;
  if (unit === "hrs") return `${n.toFixed(1)}h`;
  // Large number shorthand
  if (Math.abs(n) >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (Math.abs(n) >= 10_000) return `${(n / 1_000).toFixed(0)}k`;
  if (Math.abs(n) >= 1_000) return `${(n / 1_000).toFixed(1)}k`;
  if (Number.isInteger(n)) return `${n}`;
  return `${n.toFixed(1)}`;
}

// ── Custom Tooltip ────────────────────────────────────────────────────────────

function CustomTooltip({
  active,
  payload,
  label,
  unit,
  yLabels,
}: {
  active?: boolean;
  payload?: any[];
  label?: any;
  unit?: string | null;
  yLabels?: Record<string, string>;
}) {
  if (!active || !payload?.length) return null;
  return (
    <div
      style={{
        background: "var(--card)",
        border: "1px solid var(--border)",
        borderRadius: 12,
        boxShadow: "0 12px 36px -8px rgba(0,0,0,0.2), 0 2px 8px -2px rgba(0,0,0,0.08)",
        padding: "10px 14px",
        minWidth: 130,
        maxWidth: 220,
        pointerEvents: "none",
      }}
    >
      {label != null && (
        <p
          style={{
            fontSize: 11,
            color: "var(--muted-foreground)",
            marginBottom: 8,
            fontWeight: 500,
            letterSpacing: "0.03em",
            textTransform: "uppercase",
          }}
        >
          {fmtTick(label)}
        </p>
      )}
      {payload.map((entry: any, i: number) => (
        <div
          key={i}
          style={{
            display: "flex",
            alignItems: "center",
            gap: 8,
            marginTop: i > 0 ? 5 : 0,
          }}
        >
          <span
            style={{
              width: 8,
              height: 8,
              borderRadius: "50%",
              background: entry.color ?? entry.fill,
              flexShrink: 0,
              boxShadow: `0 0 0 2px ${(entry.color ?? entry.fill)}33`,
            }}
          />
          <span
            style={{
              fontSize: 11,
              color: "var(--muted-foreground)",
              flex: 1,
              whiteSpace: "nowrap",
              overflow: "hidden",
              textOverflow: "ellipsis",
            }}
          >
            {yLabels?.[entry.dataKey] ?? entry.name}
          </span>
          <span
            style={{
              fontSize: 13,
              fontWeight: 700,
              color: "var(--foreground)",
              marginLeft: 4,
            }}
          >
            {fmtValue(entry.value, unit)}
          </span>
        </div>
      ))}
    </div>
  );
}

// ── Shared axis / grid helpers ────────────────────────────────────────────────

const axisStyle = { fontSize: 10, fill: "var(--muted-foreground)" };

// Safety cap only — long department names ("Technology Services", "Sales and
// Marketing"…) render in full both on screen and in the exported PNG/SVG. We
// only clip genuinely pathological strings so a stray 60-char value can't blow
// out the axis; the full text is always in the <title> and chart tooltip.
const TICK_MAX = 48;

/**
 * Custom X-axis tick. Short labels render flat and centred; long labels
 * (e.g. "Technology Services", "DS & AI Services") rotate so the whole name
 * is visible instead of being cut to "Technology Ser…". A <title> carries the
 * full, untruncated name for hover — and this survives PNG/SVG export.
 */
function AngledTick(props: any) {
  const { x, y, payload } = props;
  const full = fmtTick(payload?.value);
  const shown = full.length > TICK_MAX ? full.slice(0, TICK_MAX) + "…" : full;
  const rotate = full.length > 8;

  if (!rotate) {
    return (
      <g transform={`translate(${x},${y})`}>
        <title>{full}</title>
        <text dy={12} textAnchor="middle" fontSize={10} fill="var(--muted-foreground)">
          {shown}
        </text>
      </g>
    );
  }
  return (
    <g transform={`translate(${x},${y})`}>
      <title>{full}</title>
      <text
        dy={7}
        dx={-2}
        textAnchor="end"
        transform="rotate(-32)"
        fontSize={10}
        fill="var(--muted-foreground)"
      >
        {shown}
      </text>
    </g>
  );
}

function GridAxes({
  unit,
  hideVertical = true,
  categorical = false,
}: {
  unit?: string | null;
  hideVertical?: boolean;
  categorical?: boolean;
}) {
  return (
    <>
      <CartesianGrid
        strokeDasharray="3 6"
        stroke="var(--border)"
        strokeOpacity={0.45}
        vertical={!hideVertical}
      />
      <XAxis
        dataKey="x"
        tick={<AngledTick />}
        interval={categorical ? 0 : "preserveStartEnd"}
        height={categorical ? 96 : 44}
        axisLine={{ stroke: "var(--border)", strokeOpacity: 0.4 }}
        tickLine={false}
      />
      <YAxis
        tick={axisStyle}
        tickFormatter={(v) => fmtValue(v, unit)}
        axisLine={false}
        tickLine={false}
        width={48}
      />
    </>
  );
}

function LegendStyle() {
  return <Legend wrapperStyle={{ fontSize: 11, color: "var(--muted-foreground)", paddingTop: 8 }} />;
}

// ── Export helpers ────────────────────────────────────────────────────────────

function exportPng(containerRef: React.RefObject<HTMLDivElement | null>, title: string) {
  const svg = containerRef.current?.querySelector("svg");
  if (!svg) { toast.error("Nothing to export"); return; }
  const serializer = new XMLSerializer();
  const svgStr = serializer.serializeToString(svg);
  const bbox = svg.getBoundingClientRect();
  const canvas = document.createElement("canvas");
  canvas.width = bbox.width * 2;
  canvas.height = bbox.height * 2;
  const ctx = canvas.getContext("2d")!;
  ctx.scale(2, 2);
  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, bbox.width, bbox.height);
  const img = new Image();
  const url = URL.createObjectURL(new Blob([svgStr], { type: "image/svg+xml;charset=utf-8" }));
  img.onload = () => {
    ctx.drawImage(img, 0, 0);
    URL.revokeObjectURL(url);
    const a = document.createElement("a");
    a.download = `${title.replace(/\s+/g, "_") || "chart"}.png`;
    a.href = canvas.toDataURL("image/png");
    a.click();
  };
  img.src = url;
}

function exportCsv(spec: ChartSpec) {
  const headers = [spec.x_key, ...spec.y_keys];
  const rows = spec.data.map((d) => headers.map((h) => String(d[h] ?? "")).join(","));
  const csv = [headers.join(","), ...rows].join("\n");
  const a = document.createElement("a");
  a.download = `${spec.title.replace(/\s+/g, "_") || "chart"}.csv`;
  a.href = URL.createObjectURL(new Blob([csv], { type: "text/csv" }));
  a.click();
  URL.revokeObjectURL(a.href);
}

async function exportServer(
  spec: ChartSpec,
  format: "pdf" | "pptx",
  authHeaders: Record<string, string>,
): Promise<boolean> {
  const res = await fetch(`/api/analytics/export/${format}`, {
    method: "POST",
    headers: authHeaders,
    body: JSON.stringify(spec),
  });
  if (!res.ok) return false;
  const blob = await res.blob();
  const ext = format === "pptx" ? "pptx" : "pdf";
  const a = document.createElement("a");
  a.download = `${spec.title.replace(/\s+/g, "_") || "chart"}.${ext}`;
  a.href = URL.createObjectURL(blob);
  a.click();
  URL.revokeObjectURL(a.href);
  return true;
}

// ── Export overlay ────────────────────────────────────────────────────────────

const DownloadIcon = () => (
  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor"
    strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
    <polyline points="7 10 12 15 17 10" />
    <line x1="12" y1="15" x2="12" y2="3" />
  </svg>
);

const ChevronIcon = () => (
  <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor"
    strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
    <polyline points="6 9 12 15 18 9" />
  </svg>
);

function ExportOverlay({
  spec,
  containerRef,
}: {
  spec: ChartSpec;
  containerRef: React.RefObject<HTMLDivElement | null>;
}) {
  const { user } = useAuth();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const ref = useRef<HTMLDivElement>(null);

  const authHeaders: Record<string, string> = {
    "Content-Type": "application/json",
    ...(user?.email ? { "x-user-email": user.email } : {}),
    ...(user?.role ? { "x-user-role": user.role.toLowerCase() } : {}),
  };

  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      if (!ref.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [open]);

  const server = useCallback(
    async (format: "pdf" | "pptx") => {
      setBusy(format);
      try {
        const ok = await exportServer(spec, format, authHeaders);
        if (!ok) toast.error(`${format.toUpperCase()} export failed`);
      } catch {
        toast.error(`${format.toUpperCase()} export failed`);
      } finally {
        setBusy(null);
        setOpen(false);
      }
    },
    [spec, authHeaders],
  );

  const menuItem = (label: string, onClick: () => void, loading?: boolean) => (
    <button
      onClick={onClick}
      disabled={!!busy}
      style={{
        display: "flex", alignItems: "center", gap: 8,
        width: "100%", padding: "7px 12px",
        fontSize: 12, fontWeight: 500,
        color: "var(--foreground)",
        background: "transparent",
        border: "none", cursor: busy ? "not-allowed" : "pointer",
        opacity: busy && !loading ? 0.45 : 1,
        borderRadius: 6,
        transition: "background 0.1s",
        textAlign: "left",
        whiteSpace: "nowrap",
      }}
      onMouseEnter={(e) => { (e.currentTarget as HTMLButtonElement).style.background = "var(--muted)"; }}
      onMouseLeave={(e) => { (e.currentTarget as HTMLButtonElement).style.background = "transparent"; }}
    >
      {loading ? (
        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor"
          strokeWidth="2" style={{ animation: "spin 0.8s linear infinite" }}>
          <path d="M21 12a9 9 0 1 1-6.219-8.56" />
        </svg>
      ) : (
        <DownloadIcon />
      )}
      {label}
    </button>
  );

  return (
    <div
      ref={ref}
      style={{
        position: "absolute", top: 8, right: 8, zIndex: 20,
        opacity: 0,
        transition: "opacity 0.15s",
      }}
      className="chart-export-overlay"
    >
      <button
        onClick={() => setOpen((v) => !v)}
        title="Export chart"
        style={{
          display: "flex", alignItems: "center", gap: 4,
          padding: "4px 9px",
          fontSize: 11, fontWeight: 500,
          color: "var(--muted-foreground)",
          background: "var(--card)",
          border: "1px solid var(--border)",
          borderRadius: 8,
          cursor: "pointer",
          boxShadow: "0 1px 4px rgba(0,0,0,0.08)",
          transition: "color 0.1s, border-color 0.1s",
        }}
        onMouseEnter={(e) => {
          (e.currentTarget as HTMLButtonElement).style.color = "var(--foreground)";
          (e.currentTarget as HTMLButtonElement).style.borderColor = "var(--ring)";
        }}
        onMouseLeave={(e) => {
          (e.currentTarget as HTMLButtonElement).style.color = "var(--muted-foreground)";
          (e.currentTarget as HTMLButtonElement).style.borderColor = "var(--border)";
        }}
      >
        <DownloadIcon />
        Export
        <ChevronIcon />
      </button>

      {open && (
        <div
          style={{
            position: "absolute", top: "calc(100% + 4px)", right: 0,
            background: "var(--card)",
            border: "1px solid var(--border)",
            borderRadius: 10,
            boxShadow: "0 8px 24px -4px rgba(0,0,0,0.15), 0 2px 8px -2px rgba(0,0,0,0.08)",
            padding: "4px",
            minWidth: 140,
          }}
        >
          {menuItem("PNG image", () => { exportPng(containerRef, spec.title); setOpen(false); })}
          {menuItem("CSV data", () => { exportCsv(spec); setOpen(false); })}
          <div style={{ height: 1, background: "var(--border)", margin: "3px 8px" }} />
          {menuItem("PDF", () => server("pdf"), busy === "pdf")}
          {menuItem("PowerPoint", () => server("pptx"), busy === "pptx")}
        </div>
      )}

      <style>{`
        @keyframes spin { to { transform: rotate(360deg); } }
        .chart-export-overlay { opacity: 0; }
        .chart-export-wrap:hover .chart-export-overlay { opacity: 1; }
      `}</style>
    </div>
  );
}

// ── Bar Chart ─────────────────────────────────────────────────────────────────

function BarCanvas({ spec, height }: { spec: ChartSpec; height: number }) {
  const uid = useId();
  const isStacked = spec.stacked;
  return (
    <ResponsiveContainer width="100%" height={height}>
      <BarChart data={spec.data} barCategoryGap="28%" barGap={3} margin={{ left: 4, right: 8, top: 4, bottom: 4 }}>
        <defs>
          {spec.y_keys.map((k, i) => {
            const c = color(spec, i);
            return (
              <linearGradient key={k} id={`${uid}bg${i}`} x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor={c} stopOpacity={0.92} />
                <stop offset="100%" stopColor={c} stopOpacity={0.62} />
              </linearGradient>
            );
          })}
        </defs>
        <GridAxes unit={spec.unit} categorical />
        <RechartsTooltip
          content={<CustomTooltip unit={spec.unit} yLabels={spec.y_labels} />}
          cursor={{ fill: "var(--muted)", opacity: 0.25, radius: 4 } as any}
        />
        {spec.y_keys.length > 1 && <LegendStyle />}
        {spec.y_keys.map((k, i) => (
          <Bar
            key={k}
            dataKey={k}
            name={spec.y_labels?.[k] ?? k}
            fill={`url(#${uid}bg${i})`}
            radius={isStacked ? (i === spec.y_keys.length - 1 ? [4, 4, 0, 0] : [0, 0, 0, 0]) : [5, 5, 0, 0]}
            stackId={isStacked ? "stack" : undefined}
            isAnimationActive
            animationDuration={600}
            animationEasing="ease-out"
          />
        ))}
      </BarChart>
    </ResponsiveContainer>
  );
}

// ── Line Chart ────────────────────────────────────────────────────────────────

function LineCanvas({ spec, height }: { spec: ChartSpec; height: number }) {
  return (
    <ResponsiveContainer width="100%" height={height}>
      <LineChart data={spec.data}>
        <GridAxes unit={spec.unit} />
        <RechartsTooltip content={<CustomTooltip unit={spec.unit} yLabels={spec.y_labels} />} />
        {spec.y_keys.length > 1 && <LegendStyle />}
        {spec.y_keys.map((k, i) => (
          <Line
            key={k}
            type="monotone"
            dataKey={k}
            name={spec.y_labels?.[k] ?? k}
            stroke={color(spec, i)}
            strokeWidth={2.5}
            dot={false}
            activeDot={{ r: 5, strokeWidth: 2, stroke: "var(--background)", fill: color(spec, i) }}
            isAnimationActive
            animationDuration={700}
            animationEasing="ease-out"
          />
        ))}
      </LineChart>
    </ResponsiveContainer>
  );
}

// ── Area Chart ────────────────────────────────────────────────────────────────

function AreaCanvas({ spec, height }: { spec: ChartSpec; height: number }) {
  const uid = useId();
  const isStacked = spec.stacked;
  return (
    <ResponsiveContainer width="100%" height={height}>
      <AreaChart data={spec.data}>
        <defs>
          {spec.y_keys.map((k, i) => {
            const c = color(spec, i);
            return (
              <linearGradient key={k} id={`${uid}ag${i}`} x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor={c} stopOpacity={0.52} />
                <stop offset="60%" stopColor={c} stopOpacity={0.14} />
                <stop offset="100%" stopColor={c} stopOpacity={0} />
              </linearGradient>
            );
          })}
        </defs>
        <GridAxes unit={spec.unit} />
        <RechartsTooltip content={<CustomTooltip unit={spec.unit} yLabels={spec.y_labels} />} />
        {spec.y_keys.length > 1 && <LegendStyle />}
        {spec.y_keys.map((k, i) => (
          <Area
            key={k}
            type="monotone"
            dataKey={k}
            name={spec.y_labels?.[k] ?? k}
            stroke={color(spec, i)}
            strokeWidth={2.5}
            fill={`url(#${uid}ag${i})`}
            dot={false}
            activeDot={{ r: 5, strokeWidth: 2, stroke: "var(--background)", fill: color(spec, i) }}
            stackId={isStacked ? "stack" : undefined}
            isAnimationActive
            animationDuration={700}
            animationEasing="ease-out"
          />
        ))}
      </AreaChart>
    </ResponsiveContainer>
  );
}

// ── Pie / Donut Chart ─────────────────────────────────────────────────────────

function PieCanvas({ spec, height }: { spec: ChartSpec; height: number }) {
  const valueKey = spec.y_keys[0] ?? "value";
  const nameKey = spec.x_key;

  const total = spec.data.reduce((s, d) => s + (Number(d[valueKey]) || 0), 0);

  const renderInnerLabel = ({ cx, cy, midAngle, innerRadius, outerRadius, percent }: any) => {
    if ((percent ?? 0) < 0.06) return null;
    const RADIAN = Math.PI / 180;
    const r = innerRadius + (outerRadius - innerRadius) * 0.5;
    const x = cx + r * Math.cos(-midAngle * RADIAN);
    const y = cy + r * Math.sin(-midAngle * RADIAN);
    return (
      <text x={x} y={y} fill="white" textAnchor="middle" dominantBaseline="central"
        fontSize={11} fontWeight={700} style={{ pointerEvents: "none" }}>
        {`${((percent ?? 0) * 100).toFixed(0)}%`}
      </text>
    );
  };

  const innerR = height * 0.18;
  const outerR = height * 0.33;

  return (
    <ResponsiveContainer width="100%" height={height}>
      <PieChart>
        <RechartsTooltip
          content={({ active, payload }) => {
            if (!active || !payload?.length) return null;
            const entry = payload[0];
            const pct = total > 0 ? ((Number(entry.value) / total) * 100).toFixed(1) : "0";
            return (
              <div style={{
                background: "var(--card)", border: "1px solid var(--border)",
                borderRadius: 12, padding: "10px 14px", pointerEvents: "none",
                boxShadow: "0 12px 36px -8px rgba(0,0,0,0.2)",
              }}>
                <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 4 }}>
                  <span style={{ width: 10, height: 10, borderRadius: "50%", background: entry.payload?.fill ?? entry.color, flexShrink: 0 }} />
                  <span style={{ fontSize: 12, fontWeight: 600, color: "var(--foreground)" }}>
                    {fmtTick(entry.name)}
                  </span>
                </div>
                <div style={{ fontSize: 13, fontWeight: 700, color: "var(--foreground)" }}>
                  {fmtValue(entry.value, spec.unit)}
                  <span style={{ fontSize: 11, color: "var(--muted-foreground)", fontWeight: 400, marginLeft: 6 }}>
                    {pct}%
                  </span>
                </div>
              </div>
            );
          }}
        />
        <Legend
          formatter={(value) => (
            <span style={{ fontSize: 11, color: "var(--muted-foreground)" }}>
              {typeof value === "string" && value.length > 16 ? value.slice(0, 16) + "…" : value}
            </span>
          )}
          wrapperStyle={{ paddingTop: 8 }}
        />
        <Pie
          data={spec.data}
          dataKey={valueKey}
          nameKey={nameKey}
          innerRadius={innerR}
          outerRadius={outerR}
          paddingAngle={3}
          labelLine={false}
          label={renderInnerLabel}
          isAnimationActive
          animationDuration={700}
          animationEasing="ease-out"
        >
          {spec.data.map((_, i) => (
            <Cell key={i} fill={color(spec, i)} stroke="var(--card)" strokeWidth={2} />
          ))}
        </Pie>
        {/* Center total */}
        <text
          x="50%" y="50%"
          textAnchor="middle" dominantBaseline="middle"
          style={{ pointerEvents: "none" }}
        >
          <tspan x="50%" dy="-8" fontSize={18} fontWeight={700} fill="var(--foreground)">
            {fmtValue(total, spec.unit)}
          </tspan>
          <tspan x="50%" dy="18" fontSize={10} fill="var(--muted-foreground)">
            total
          </tspan>
        </text>
      </PieChart>
    </ResponsiveContainer>
  );
}

// ── Scatter Chart ─────────────────────────────────────────────────────────────

function ScatterCanvas({ spec, height }: { spec: ChartSpec; height: number }) {
  const xKey = spec.x_key;
  const yKey = spec.y_keys[0] ?? "value";
  const xLabel = spec.y_labels?.[xKey] ?? xKey;
  const yLabel = spec.y_labels?.[yKey] ?? yKey;
  return (
    <ResponsiveContainer width="100%" height={height}>
      <ScatterChart margin={{ bottom: 16, left: 8 }}>
        <CartesianGrid strokeDasharray="3 6" stroke="var(--border)" strokeOpacity={0.45} />
        <XAxis
          dataKey={xKey}
          type="number"
          name={xLabel}
          tick={axisStyle}
          tickLine={false}
          axisLine={{ stroke: "var(--border)", strokeOpacity: 0.4 }}
          label={{ value: xLabel, position: "insideBottom", offset: -8, fontSize: 10, fill: "var(--muted-foreground)" }}
        />
        <YAxis
          dataKey={yKey}
          type="number"
          name={yLabel}
          tick={axisStyle}
          tickLine={false}
          axisLine={false}
          width={48}
          label={{ value: yLabel, angle: -90, position: "insideLeft", fontSize: 10, fill: "var(--muted-foreground)" }}
        />
        <ZAxis range={[64, 128]} />
        <RechartsTooltip
          cursor={{ strokeDasharray: "3 3", stroke: "var(--border)" }}
          content={({ active, payload }) => {
            if (!active || !payload?.length) return null;
            const point = payload[0]?.payload ?? {};
            return (
              <div style={{
                background: "var(--card)", border: "1px solid var(--border)",
                borderRadius: 12, padding: "10px 14px", pointerEvents: "none",
                boxShadow: "0 12px 36px -8px rgba(0,0,0,0.2)",
              }}>
                {spec.label_key && (
                  <p style={{ fontSize: 12, fontWeight: 700, color: "var(--foreground)", marginBottom: 6 }}>
                    {point[spec.label_key]}
                  </p>
                )}
                <p style={{ fontSize: 11, color: "var(--muted-foreground)" }}>{xLabel}: <strong style={{ color: "var(--foreground)" }}>{point[xKey]}</strong></p>
                <p style={{ fontSize: 11, color: "var(--muted-foreground)" }}>{yLabel}: <strong style={{ color: "var(--foreground)" }}>{point[yKey]}</strong></p>
              </div>
            );
          }}
        />
        <Scatter
          data={spec.data}
          fill={color(spec, 0)}
          fillOpacity={0.82}
          isAnimationActive
          animationDuration={600}
        />
      </ScatterChart>
    </ResponsiveContainer>
  );
}

// ── Radar Chart ───────────────────────────────────────────────────────────────

function RadarCanvas({ spec, height }: { spec: ChartSpec; height: number }) {
  return (
    <ResponsiveContainer width="100%" height={height}>
      <RadarChart data={spec.data} cx="50%" cy="50%" outerRadius={height * 0.34}>
        <PolarGrid stroke="var(--border)" strokeOpacity={0.5} />
        <PolarAngleAxis
          dataKey={spec.x_key}
          tick={{ fontSize: 10, fill: "var(--muted-foreground)" }}
        />
        <PolarRadiusAxis
          tick={{ fontSize: 9, fill: "var(--muted-foreground)" }}
          axisLine={false}
        />
        <RechartsTooltip
          content={<CustomTooltip unit={spec.unit} yLabels={spec.y_labels} />}
        />
        {spec.y_keys.length > 1 && <LegendStyle />}
        {spec.y_keys.map((k, i) => (
          <Radar
            key={k}
            name={spec.y_labels?.[k] ?? k}
            dataKey={k}
            stroke={color(spec, i)}
            fill={color(spec, i)}
            fillOpacity={0.2}
            strokeWidth={2}
            isAnimationActive
            animationDuration={700}
          />
        ))}
      </RadarChart>
    </ResponsiveContainer>
  );
}

// ── Treemap ───────────────────────────────────────────────────────────────────

function TreemapCell({ root, depth, x, y, width, height: h, name, value, colors: c }: any) {
  const idx = (root?.children ?? []).findIndex((ch: any) => ch.name === name);
  const bg = (c ?? DEFAULT_COLORS)[idx % (c ?? DEFAULT_COLORS).length];
  if (width < 20 || h < 20) return null;
  const label = String(name ?? "");
  return (
    <g>
      <rect
        x={x} y={y} width={width} height={h}
        fill={bg} rx={6} ry={6}
        stroke="var(--background)" strokeWidth={2.5}
      />
      {width > 64 && h > 32 && (
        <>
          <text x={x + 10} y={y + 20} fill="rgba(255,255,255,0.95)" fontSize={12} fontWeight={700}>
            {label.length > 15 ? label.slice(0, 15) + "…" : label}
          </text>
          {h > 50 && (
            <text x={x + 10} y={y + 36} fill="rgba(255,255,255,0.65)" fontSize={11}>
              {fmtValue(value)}
            </text>
          )}
        </>
      )}
    </g>
  );
}

function TreemapCanvas({ spec, height }: { spec: ChartSpec; height: number }) {
  const valueKey = spec.y_keys[0] ?? "value";
  const nameKey = spec.x_key;
  const treeData = spec.data.map((d) => ({ name: d[nameKey] ?? "—", value: d[valueKey] ?? 0 }));
  return (
    <ResponsiveContainer width="100%" height={height}>
      <Treemap
        data={treeData}
        dataKey="value"
        aspectRatio={4 / 3}
        content={<TreemapCell colors={spec.colors?.length ? spec.colors : DEFAULT_COLORS} />}
      >
        <RechartsTooltip
          content={({ active, payload }) => {
            if (!active || !payload?.length) return null;
            const d = payload[0]?.payload ?? {};
            return (
              <div style={{
                background: "var(--card)", border: "1px solid var(--border)",
                borderRadius: 12, padding: "10px 14px", pointerEvents: "none",
                boxShadow: "0 12px 36px -8px rgba(0,0,0,0.2)",
              }}>
                <p style={{ fontSize: 12, fontWeight: 700, color: "var(--foreground)" }}>{d.name}</p>
                <p style={{ fontSize: 13, fontWeight: 700, color: "var(--foreground)", marginTop: 4 }}>
                  {fmtValue(d.value, spec.unit)}
                </p>
              </div>
            );
          }}
        />
      </Treemap>
    </ResponsiveContainer>
  );
}

// ── Funnel Chart ──────────────────────────────────────────────────────────────

function FunnelCanvas({ spec, height }: { spec: ChartSpec; height: number }) {
  const valueKey = spec.y_keys[0] ?? "value";
  const nameKey = spec.x_key;
  const funnelData = [...spec.data]
    .sort((a, b) => (b[valueKey] ?? 0) - (a[valueKey] ?? 0))
    .map((d, i) => ({
      name: d[nameKey] ?? "—",
      value: d[valueKey] ?? 0,
      fill: color(spec, i),
    }));

  return (
    <ResponsiveContainer width="100%" height={height}>
      <FunnelChart>
        <RechartsTooltip
          content={({ active, payload }) => {
            if (!active || !payload?.length) return null;
            const entry = payload[0];
            return (
              <div style={{
                background: "var(--card)", border: "1px solid var(--border)",
                borderRadius: 12, padding: "10px 14px", pointerEvents: "none",
                boxShadow: "0 12px 36px -8px rgba(0,0,0,0.2)",
              }}>
                <p style={{ fontSize: 12, fontWeight: 700, color: "var(--foreground)" }}>{entry.payload?.name}</p>
                <p style={{ fontSize: 13, fontWeight: 700, color: "var(--foreground)", marginTop: 4 }}>
                  {fmtValue(entry.value, spec.unit)}
                </p>
              </div>
            );
          }}
        />
        <Funnel dataKey="value" data={funnelData} isAnimationActive animationDuration={600}>
          <LabelList
            position="right"
            fill="var(--foreground)"
            stroke="none"
            dataKey="name"
            style={{ fontSize: 11, fill: "var(--muted-foreground)" }}
          />
        </Funnel>
      </FunnelChart>
    </ResponsiveContainer>
  );
}

// ── Composed Chart (bar + line) ───────────────────────────────────────────────

function ComposedCanvas({ spec, height }: { spec: ChartSpec; height: number }) {
  const uid = useId();
  const [barKey, ...lineKeys] = spec.y_keys;
  return (
    <ResponsiveContainer width="100%" height={height}>
      <ComposedChart data={spec.data} margin={{ left: 4, right: 8, top: 4, bottom: 4 }}>
        {barKey && (
          <defs>
            <linearGradient id={`${uid}cg0`} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor={color(spec, 0)} stopOpacity={0.92} />
              <stop offset="100%" stopColor={color(spec, 0)} stopOpacity={0.58} />
            </linearGradient>
          </defs>
        )}
        <GridAxes unit={spec.unit} categorical />
        <RechartsTooltip content={<CustomTooltip unit={spec.unit} yLabels={spec.y_labels} />} />
        <LegendStyle />
        {barKey && (
          <Bar
            dataKey={barKey}
            name={spec.y_labels?.[barKey] ?? barKey}
            fill={`url(#${uid}cg0)`}
            radius={[5, 5, 0, 0]}
            yAxisId={0}
            isAnimationActive
            animationDuration={600}
          />
        )}
        {lineKeys.map((k, i) => (
          <Line
            key={k}
            type="monotone"
            dataKey={k}
            name={spec.y_labels?.[k] ?? k}
            stroke={color(spec, i + 1)}
            strokeWidth={2.5}
            dot={false}
            activeDot={{ r: 5, strokeWidth: 2, stroke: "var(--background)", fill: color(spec, i + 1) }}
            yAxisId={0}
            isAnimationActive
            animationDuration={700}
          />
        ))}
      </ComposedChart>
    </ResponsiveContainer>
  );
}

// ── Main ChartCanvas ──────────────────────────────────────────────────────────

export function ChartCanvas({
  spec,
  height = 320,
  className,
  showExport = false,
}: {
  spec: ChartSpec;
  height?: number;
  className?: string;
  showExport?: boolean;
}) {
  const containerRef = useRef<HTMLDivElement>(null);

  if (!spec.data || spec.data.length === 0) {
    return (
      <div
        className={cn(
          "flex flex-col items-center justify-center gap-2 text-[13px] text-muted-foreground",
          className
        )}
        style={{ height }}
      >
        <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" opacity={0.4}>
          <path d="M3 3v18h18" /><path d="M7 16l4-4 4 4 5-5" />
        </svg>
        <span>No data for this selection.</span>
      </div>
    );
  }

  const props = { spec, height };

  return (
    <div ref={containerRef} className={cn("relative chart-export-wrap", className)}>
      {spec.type === "bar" && <BarCanvas {...props} />}
      {spec.type === "line" && <LineCanvas {...props} />}
      {spec.type === "area" && <AreaCanvas {...props} />}
      {spec.type === "pie" && <PieCanvas {...props} />}
      {spec.type === "scatter" && <ScatterCanvas {...props} />}
      {spec.type === "radar" && <RadarCanvas {...props} />}
      {spec.type === "treemap" && <TreemapCanvas {...props} />}
      {spec.type === "funnel" && <FunnelCanvas {...props} />}
      {spec.type === "composed" && <ComposedCanvas {...props} />}
      {showExport && <ExportOverlay spec={spec} containerRef={containerRef} />}
    </div>
  );
}
