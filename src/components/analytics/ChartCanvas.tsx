/**
 * ChartCanvas — universal chart renderer for the Analytics Builder.
 *
 * Accepts a ChartSpec (multi-series, named axes) and renders the appropriate
 * recharts component. Supports: bar, line, area, pie, scatter, radar, treemap,
 * funnel, composed (bar + line mix).
 */

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

const tooltipStyle = {
  backgroundColor: "var(--card)",
  borderColor: "var(--border)",
  borderRadius: "12px",
  boxShadow: "0 8px 32px -8px rgba(0,0,0,0.18)",
  color: "var(--foreground)",
  fontSize: "12px",
  padding: "8px 12px",
};

function color(spec: ChartSpec, idx: number) {
  const palette = spec.colors?.length ? spec.colors : DEFAULT_COLORS;
  return palette[idx % palette.length];
}

function fmtTick(v: any): string {
  if (typeof v === "string" && /^\d{4}-\d{2}-\d{2}/.test(v)) {
    const d = new Date(v);
    if (!isNaN(d.getTime()))
      return d.toLocaleDateString("en-IN", { month: "short", day: "2-digit" });
  }
  if (typeof v === "string" && v.length > 12) return v.slice(0, 12) + "…";
  return String(v ?? "");
}

function fmtValue(v: any, unit?: string | null) {
  if (unit === "pct") return `${v}%`;
  if (unit === "sec") return `${v}s`;
  if (unit === "days") return `${v}d`;
  return `${v}`;
}

const axisProps = {
  tick: { fontSize: 10, fill: "var(--muted-foreground)" },
  tickFormatter: fmtTick,
};

const axes = (unit?: string | null) => (
  <>
    <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" />
    <XAxis dataKey="x" {...axisProps} />
    <YAxis tick={{ fontSize: 10, fill: "var(--muted-foreground)" }}
           tickFormatter={(v) => fmtValue(v, unit)} />
    <RechartsTooltip
      contentStyle={tooltipStyle}
      formatter={(v: any) => fmtValue(v, unit)}
    />
  </>
);

// ── Sub-renderers ────────────────────────────────────────────────────────────

function BarCanvas({ spec, height }: { spec: ChartSpec; height: number }) {
  const isStacked = spec.stacked;
  return (
    <ResponsiveContainer width="100%" height={height}>
      <BarChart data={spec.data}>
        {axes(spec.unit)}
        {spec.y_keys.length > 1 && <Legend wrapperStyle={{ fontSize: 11 }} />}
        {spec.y_keys.map((k, i) => (
          <Bar
            key={k}
            dataKey={k}
            name={spec.y_labels?.[k] ?? k}
            fill={color(spec, i)}
            radius={[4, 4, 0, 0]}
            stackId={isStacked ? "stack" : undefined}
          />
        ))}
      </BarChart>
    </ResponsiveContainer>
  );
}

function LineCanvas({ spec, height }: { spec: ChartSpec; height: number }) {
  return (
    <ResponsiveContainer width="100%" height={height}>
      <LineChart data={spec.data}>
        {axes(spec.unit)}
        {spec.y_keys.length > 1 && <Legend wrapperStyle={{ fontSize: 11 }} />}
        {spec.y_keys.map((k, i) => (
          <Line
            key={k}
            type="monotone"
            dataKey={k}
            name={spec.y_labels?.[k] ?? k}
            stroke={color(spec, i)}
            strokeWidth={2}
            dot={false}
          />
        ))}
      </LineChart>
    </ResponsiveContainer>
  );
}

function AreaCanvas({ spec, height }: { spec: ChartSpec; height: number }) {
  const isStacked = spec.stacked;
  return (
    <ResponsiveContainer width="100%" height={height}>
      <AreaChart data={spec.data}>
        <defs>
          {spec.y_keys.map((k, i) => (
            <linearGradient key={k} id={`grad_${k}`} x1="0" y1="0" x2="0" y2="1">
              <stop offset="5%" stopColor={color(spec, i)} stopOpacity={0.3} />
              <stop offset="95%" stopColor={color(spec, i)} stopOpacity={0} />
            </linearGradient>
          ))}
        </defs>
        {axes(spec.unit)}
        {spec.y_keys.length > 1 && <Legend wrapperStyle={{ fontSize: 11 }} />}
        {spec.y_keys.map((k, i) => (
          <Area
            key={k}
            type="monotone"
            dataKey={k}
            name={spec.y_labels?.[k] ?? k}
            stroke={color(spec, i)}
            fill={`url(#grad_${k})`}
            strokeWidth={2}
            stackId={isStacked ? "stack" : undefined}
          />
        ))}
      </AreaChart>
    </ResponsiveContainer>
  );
}

function PieCanvas({ spec, height }: { spec: ChartSpec; height: number }) {
  const valueKey = spec.y_keys[0] ?? "value";
  const nameKey = spec.x_key;
  return (
    <ResponsiveContainer width="100%" height={height}>
      <PieChart>
        <RechartsTooltip
          contentStyle={tooltipStyle}
          formatter={(v: any) => fmtValue(v, spec.unit)}
        />
        <Legend wrapperStyle={{ fontSize: 11 }} />
        <Pie
          data={spec.data}
          dataKey={valueKey}
          nameKey={nameKey}
          innerRadius={height * 0.17}
          outerRadius={height * 0.32}
          paddingAngle={2}
          label={({ name, percent }) => `${fmtTick(name)} ${((percent ?? 0) * 100).toFixed(0)}%`}
          labelLine={false}
        >
          {spec.data.map((_, i) => (
            <Cell key={i} fill={color(spec, i)} />
          ))}
        </Pie>
      </PieChart>
    </ResponsiveContainer>
  );
}

function ScatterCanvas({ spec, height }: { spec: ChartSpec; height: number }) {
  const xKey = spec.x_key;
  const yKey = spec.y_keys[0] ?? "value";
  const xLabel = spec.y_labels?.[xKey] ?? xKey;
  const yLabel = spec.y_labels?.[yKey] ?? yKey;
  return (
    <ResponsiveContainer width="100%" height={height}>
      <ScatterChart>
        <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" />
        <XAxis
          dataKey={xKey}
          type="number"
          name={xLabel}
          tick={{ fontSize: 10, fill: "var(--muted-foreground)" }}
          label={{ value: xLabel, position: "insideBottom", offset: -4, fontSize: 10 }}
        />
        <YAxis
          dataKey={yKey}
          type="number"
          name={yLabel}
          tick={{ fontSize: 10, fill: "var(--muted-foreground)" }}
          label={{ value: yLabel, angle: -90, position: "insideLeft", fontSize: 10 }}
        />
        <ZAxis range={[60, 120]} />
        <RechartsTooltip
          contentStyle={tooltipStyle}
          cursor={{ strokeDasharray: "3 3" }}
          content={({ active, payload }) => {
            if (!active || !payload?.length) return null;
            const point = payload[0]?.payload ?? {};
            return (
              <div style={tooltipStyle}>
                {spec.label_key && <p style={{ fontWeight: 600 }}>{point[spec.label_key]}</p>}
                <p>{xLabel}: {point[xKey]}</p>
                <p>{yLabel}: {point[yKey]}</p>
              </div>
            );
          }}
        />
        <Scatter data={spec.data} fill={color(spec, 0)} />
      </ScatterChart>
    </ResponsiveContainer>
  );
}

function RadarCanvas({ spec, height }: { spec: ChartSpec; height: number }) {
  const subjectKey = spec.x_key;
  return (
    <ResponsiveContainer width="100%" height={height}>
      <RadarChart data={spec.data} cx="50%" cy="50%" outerRadius={height * 0.35}>
        <PolarGrid stroke="var(--border)" />
        <PolarAngleAxis dataKey={subjectKey} tick={{ fontSize: 10, fill: "var(--muted-foreground)" }} />
        <PolarRadiusAxis tick={{ fontSize: 9, fill: "var(--muted-foreground)" }} />
        <RechartsTooltip contentStyle={tooltipStyle} formatter={(v: any) => fmtValue(v, spec.unit)} />
        {spec.y_keys.length > 1 && <Legend wrapperStyle={{ fontSize: 11 }} />}
        {spec.y_keys.map((k, i) => (
          <Radar
            key={k}
            name={spec.y_labels?.[k] ?? k}
            dataKey={k}
            stroke={color(spec, i)}
            fill={color(spec, i)}
            fillOpacity={0.25}
            strokeWidth={2}
          />
        ))}
      </RadarChart>
    </ResponsiveContainer>
  );
}

// Custom content for Treemap cells
function TreemapCell({ root, depth, x, y, width, height, name, value, colors: c }: any) {
  const idx = (root?.children ?? []).findIndex((ch: any) => ch.name === name);
  const bg = (c ?? DEFAULT_COLORS)[idx % (c ?? DEFAULT_COLORS).length];
  if (width < 20 || height < 20) return null;
  return (
    <g>
      <rect x={x} y={y} width={width} height={height} fill={bg} rx={4} stroke="var(--background)" strokeWidth={2} />
      {width > 60 && height > 30 && (
        <>
          <text x={x + 8} y={y + 18} fill="#fff" fontSize={11} fontWeight={600}>
            {String(name).length > 14 ? String(name).slice(0, 14) + "…" : name}
          </text>
          {height > 46 && (
            <text x={x + 8} y={y + 34} fill="rgba(255,255,255,0.75)" fontSize={10}>
              {value}
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
          contentStyle={tooltipStyle}
          formatter={(v: any) => fmtValue(v, spec.unit)}
        />
      </Treemap>
    </ResponsiveContainer>
  );
}

function FunnelCanvas({ spec, height }: { spec: ChartSpec; height: number }) {
  const valueKey = spec.y_keys[0] ?? "value";
  const nameKey = spec.x_key;
  const funnelData = [...spec.data]
    .sort((a, b) => (b[valueKey] ?? 0) - (a[valueKey] ?? 0))
    .map((d, i) => ({ name: d[nameKey] ?? "—", value: d[valueKey] ?? 0, fill: color(spec, i) }));

  return (
    <ResponsiveContainer width="100%" height={height}>
      <FunnelChart>
        <RechartsTooltip contentStyle={tooltipStyle} formatter={(v: any) => fmtValue(v, spec.unit)} />
        <Funnel dataKey="value" data={funnelData} isAnimationActive>
          <LabelList position="right" fill="var(--foreground)" stroke="none" dataKey="name" style={{ fontSize: 11 }} />
        </Funnel>
      </FunnelChart>
    </ResponsiveContainer>
  );
}

function ComposedCanvas({ spec, height }: { spec: ChartSpec; height: number }) {
  // First y_key → Bar, remaining → Line
  const [barKey, ...lineKeys] = spec.y_keys;
  return (
    <ResponsiveContainer width="100%" height={height}>
      <ComposedChart data={spec.data}>
        {axes(spec.unit)}
        <Legend wrapperStyle={{ fontSize: 11 }} />
        {barKey && (
          <Bar
            dataKey={barKey}
            name={spec.y_labels?.[barKey] ?? barKey}
            fill={color(spec, 0)}
            radius={[4, 4, 0, 0]}
            yAxisId={0}
          />
        )}
        {lineKeys.map((k, i) => (
          <Line
            key={k}
            type="monotone"
            dataKey={k}
            name={spec.y_labels?.[k] ?? k}
            stroke={color(spec, i + 1)}
            strokeWidth={2}
            dot={false}
            yAxisId={0}
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
}: {
  spec: ChartSpec;
  height?: number;
  className?: string;
}) {
  if (!spec.data || spec.data.length === 0) {
    return (
      <div
        className={cn("flex items-center justify-center text-[13px] text-muted-foreground", className)}
        style={{ height }}
      >
        No data for this selection.
      </div>
    );
  }

  const props = { spec, height };

  return (
    <div className={className}>
      {spec.type === "bar" && <BarCanvas {...props} />}
      {spec.type === "line" && <LineCanvas {...props} />}
      {spec.type === "area" && <AreaCanvas {...props} />}
      {spec.type === "pie" && <PieCanvas {...props} />}
      {spec.type === "scatter" && <ScatterCanvas {...props} />}
      {spec.type === "radar" && <RadarCanvas {...props} />}
      {spec.type === "treemap" && <TreemapCanvas {...props} />}
      {spec.type === "funnel" && <FunnelCanvas {...props} />}
      {spec.type === "composed" && <ComposedCanvas {...props} />}
    </div>
  );
}
