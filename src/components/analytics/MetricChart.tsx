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
  AreaChart,
  Area,
  LineChart,
  Line,
} from "recharts";

// Shared analytics renderer — one component for the ROI dashboard, the Studio preview,
// and saved-dashboard tiles. Styling mirrors ObservabilityDashboard's charts.

export type ChartType = "bar" | "line" | "area" | "pie";

export interface SeriesPoint {
  label: string;
  value: number;
}

const PIE_COLORS = ["#6366f1", "#10b981", "#f59e0b", "#06b6d4", "#8b5cf6", "#ef4444", "#ec4899"];
const ACCENT = "#6366f1";

const tooltipStyle = {
  backgroundColor: "var(--card)",
  borderColor: "var(--border)",
  borderRadius: "12px",
  boxShadow: "0 8px 32px -8px rgba(0,0,0,0.12)",
  color: "var(--foreground)",
  fontSize: "12px",
  padding: "8px 12px",
};

// ISO date labels (from day/week/month buckets) → short readable form.
function formatLabel(v: string): string {
  if (typeof v === "string" && /^\d{4}-\d{2}-\d{2}/.test(v)) {
    const d = new Date(v);
    if (!isNaN(d.getTime())) {
      return d.toLocaleDateString("en-IN", { month: "short", day: "2-digit" });
    }
  }
  return v;
}

export function MetricChart({
  chartType,
  series,
  height = 260,
  unit,
}: {
  chartType: ChartType;
  series: SeriesPoint[];
  height?: number;
  unit?: string;
}) {
  if (!series || series.length === 0) {
    return (
      <div
        className="flex items-center justify-center text-[13px] text-muted-foreground"
        style={{ height }}
      >
        No data for this selection.
      </div>
    );
  }

  const data = series.map((p) => ({ ...p, _label: formatLabel(p.label) }));
  const fmtValue = (v: number | string) =>
    unit === "ms" ? `${(Number(v) / 1000).toFixed(1)}s` : unit === "pct" ? `${v}%` : `${v}`;

  const axes = (
    <>
      <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" />
      <XAxis dataKey="_label" tick={{ fontSize: 10, fill: "var(--muted-foreground)" }} />
      <YAxis tick={{ fontSize: 10, fill: "var(--muted-foreground)" }} tickFormatter={fmtValue} />
      <RechartsTooltip contentStyle={tooltipStyle} formatter={(v: any) => fmtValue(v)} />
    </>
  );

  return (
    <ResponsiveContainer width="100%" height={height}>
      {chartType === "pie" ? (
        <PieChart>
          <RechartsTooltip contentStyle={tooltipStyle} formatter={(v: any) => fmtValue(v)} />
          <Pie data={data} dataKey="value" nameKey="_label" innerRadius={55} outerRadius={95}>
            {data.map((_, i) => (
              <Cell key={i} fill={PIE_COLORS[i % PIE_COLORS.length]} />
            ))}
          </Pie>
        </PieChart>
      ) : chartType === "line" ? (
        <LineChart data={data}>
          {axes}
          <Line type="monotone" dataKey="value" stroke="#f59e0b" strokeWidth={2} dot={false} />
        </LineChart>
      ) : chartType === "area" ? (
        <AreaChart data={data}>
          <defs>
            <linearGradient id="metricGrad" x1="0" y1="0" x2="0" y2="1">
              <stop offset="5%" stopColor={ACCENT} stopOpacity={0.3} />
              <stop offset="95%" stopColor={ACCENT} stopOpacity={0} />
            </linearGradient>
          </defs>
          {axes}
          <Area type="monotone" dataKey="value" stroke={ACCENT} fill="url(#metricGrad)" strokeWidth={2} />
        </AreaChart>
      ) : (
        <BarChart data={data}>
          {axes}
          <Bar dataKey="value" fill={ACCENT} radius={[6, 6, 0, 0]} />
        </BarChart>
      )}
    </ResponsiveContainer>
  );
}
