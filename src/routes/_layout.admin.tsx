import { createFileRoute } from "@tanstack/react-router";
import { useAuth } from "@/lib/auth-store";
import { useState } from "react";
import {
  LineChart, Line, XAxis, YAxis, CartesianGrid,
  Tooltip as RechartsTooltip, ResponsiveContainer,
  BarChart, Bar, AreaChart, Area, PieChart, Pie, Cell,
} from "recharts";
import {
  Users, Zap, Clock, TrendingUp, ArrowUpRight,
  ArrowDownRight, Activity, Server, Shield, Eye,
} from "lucide-react";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/_layout/admin")({
  component: AdminDashboard,
});

const trafficData = [
  { time: "06:00", users: 120, queries: 89, resolved: 82 },
  { time: "08:00", users: 420, queries: 340, resolved: 310 },
  { time: "10:00", users: 680, queries: 520, resolved: 480 },
  { time: "12:00", users: 540, queries: 980, resolved: 920 },
  { time: "14:00", users: 780, queries: 690, resolved: 650 },
  { time: "16:00", users: 890, queries: 780, resolved: 740 },
  { time: "18:00", users: 620, queries: 580, resolved: 550 },
  { time: "20:00", users: 340, queries: 230, resolved: 220 },
];

const deptData = [
  { name: "HR", value: 340, color: "#10b981" },
  { name: "IT", value: 520, color: "#6366f1" },
  { name: "Admin", value: 180, color: "#f59e0b" },
  { name: "PMO", value: 260, color: "#06b6d4" },
  { name: "Org", value: 150, color: "#8b5cf6" },
];

const weeklyData = [
  { day: "Mon", queries: 1240 },
  { day: "Tue", queries: 1580 },
  { day: "Wed", queries: 1890 },
  { day: "Thu", queries: 1620 },
  { day: "Fri", queries: 980 },
  { day: "Sat", queries: 340 },
  { day: "Sun", queries: 210 },
];

interface StatCardProps {
  title: string;
  value: string;
  change: string;
  trend: "up" | "down" | "neutral";
  icon: typeof Users;
  iconColor: string;
}

function StatCard({ title, value, change, trend, icon: Icon, iconColor }: StatCardProps) {
  return (
    <div className="rounded-2xl border border-[var(--border)] bg-card p-6 transition-all duration-200 hover:shadow-lg hover:border-[var(--border-strong)]">
      <div className="flex items-start justify-between">
        <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-[var(--muted)]">
          <Icon className={cn("h-5 w-5", iconColor)} />
        </div>
        <div className={cn(
          "flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-semibold",
          trend === "up" && "bg-emerald-500/10 text-emerald-500",
          trend === "down" && "bg-rose-500/10 text-rose-500",
          trend === "neutral" && "bg-[var(--muted)] text-muted-foreground",
        )}>
          {trend === "up" && <ArrowUpRight className="h-3 w-3" />}
          {trend === "down" && <ArrowDownRight className="h-3 w-3" />}
          {change}
        </div>
      </div>
      <div className="mt-4">
        <p className="text-3xl font-bold tracking-tight text-foreground">{value}</p>
        <p className="mt-1 text-[13px] text-muted-foreground">{title}</p>
      </div>
    </div>
  );
}

function AdminDashboard() {
  const { user } = useAuth();
  const [viewerAccess, setViewerAccess] = useState(["HR", "PMO"]);
  const allRoles = ["HR", "IT", "PMO", "Employee", "Functional Manager"];

  if (!user || user.role !== "Admin") {
    return (
      <div className="flex h-full items-center justify-center">
        <div className="text-center">
          <Shield className="h-12 w-12 text-muted-foreground/30 mx-auto mb-4" />
          <p className="text-lg font-medium text-foreground">Access Restricted</p>
          <p className="text-sm text-muted-foreground mt-1">This dashboard is available to Administrators only.</p>
        </div>
      </div>
    );
  }

  const toggleAccess = (role: string) => {
    setViewerAccess(prev =>
      prev.includes(role) ? prev.filter(r => r !== role) : [...prev, role]
    );
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

  return (
    <div className="flex h-full flex-col overflow-y-auto">
      {/* Header */}
      <div className="sticky top-0 z-10 border-b border-[var(--border)] bg-background/80 backdrop-blur-xl px-8 py-5">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-xl font-semibold text-foreground tracking-tight">Analytics Dashboard</h1>
            <p className="text-[13px] text-muted-foreground mt-0.5">
              Real-time system performance and usage metrics
            </p>
          </div>
          <div className="flex items-center gap-2">
            <div className="flex items-center gap-1.5 rounded-lg bg-emerald-500/10 px-3 py-1.5">
              <div className="h-2 w-2 rounded-full bg-emerald-500 animate-pulse" />
              <span className="text-xs font-semibold text-emerald-500">Live</span>
            </div>
          </div>
        </div>
      </div>

      <div className="flex-1 p-8 space-y-8">
        {/* KPI Cards */}
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-4">
          <StatCard title="Active Users" value="2,405" change="+12.5%" trend="up" icon={Users} iconColor="text-blue-500" />
          <StatCard title="Resolution Rate" value="94.2%" change="+2.4%" trend="up" icon={Zap} iconColor="text-emerald-500" />
          <StatCard title="Avg Response Time" value="1.2s" change="-0.3s" trend="up" icon={Clock} iconColor="text-amber-500" />
          <StatCard title="Total Queries Today" value="3,847" change="+8.1%" trend="up" icon={TrendingUp} iconColor="text-violet-500" />
        </div>

        {/* Charts Row */}
        <div className="grid grid-cols-1 xl:grid-cols-3 gap-6">
          {/* Traffic Chart — Spans 2 cols */}
          <div className="xl:col-span-2 rounded-2xl border border-[var(--border)] bg-card p-6">
            <div className="flex items-center justify-between mb-6">
              <div>
                <h3 className="text-[15px] font-semibold text-foreground">User Traffic</h3>
                <p className="text-xs text-muted-foreground mt-0.5">Hourly active users and query volume</p>
              </div>
              <div className="flex items-center gap-4 text-xs">
                <div className="flex items-center gap-1.5">
                  <div className="h-2.5 w-2.5 rounded-full bg-primary" />
                  <span className="text-muted-foreground">Users</span>
                </div>
                <div className="flex items-center gap-1.5">
                  <div className="h-2.5 w-2.5 rounded-full bg-emerald-500" />
                  <span className="text-muted-foreground">Queries</span>
                </div>
              </div>
            </div>
            <div className="h-[280px]">
              <ResponsiveContainer width="100%" height="100%">
                <AreaChart data={trafficData} margin={{ top: 5, right: 10, bottom: 5, left: -10 }}>
                  <defs>
                    <linearGradient id="usersFill" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="0%" stopColor="var(--primary)" stopOpacity={0.15} />
                      <stop offset="100%" stopColor="var(--primary)" stopOpacity={0} />
                    </linearGradient>
                  </defs>
                  <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" opacity={0.4} />
                  <XAxis dataKey="time" stroke="var(--muted-foreground)" fontSize={11} opacity={0.6} tickLine={false} axisLine={false} />
                  <YAxis stroke="var(--muted-foreground)" fontSize={11} opacity={0.6} tickLine={false} axisLine={false} />
                  <RechartsTooltip contentStyle={tooltipStyle} />
                  <Area type="monotone" dataKey="users" stroke="var(--primary)" strokeWidth={2} fill="url(#usersFill)" />
                  <Line type="monotone" dataKey="queries" stroke="#10b981" strokeWidth={2} dot={false} />
                </AreaChart>
              </ResponsiveContainer>
            </div>
          </div>

          {/* Department Breakdown */}
          <div className="rounded-2xl border border-[var(--border)] bg-card p-6">
            <h3 className="text-[15px] font-semibold text-foreground mb-1">By Department</h3>
            <p className="text-xs text-muted-foreground mb-6">Query distribution today</p>
            <div className="h-[180px] flex items-center justify-center">
              <ResponsiveContainer width="100%" height="100%">
                <PieChart>
                  <Pie
                    data={deptData}
                    cx="50%"
                    cy="50%"
                    innerRadius={50}
                    outerRadius={80}
                    paddingAngle={3}
                    dataKey="value"
                    strokeWidth={0}
                  >
                    {deptData.map((entry) => (
                      <Cell key={entry.name} fill={entry.color} />
                    ))}
                  </Pie>
                  <RechartsTooltip contentStyle={tooltipStyle} />
                </PieChart>
              </ResponsiveContainer>
            </div>
            <div className="mt-4 space-y-2">
              {deptData.map((d) => (
                <div key={d.name} className="flex items-center justify-between text-xs">
                  <div className="flex items-center gap-2">
                    <div className="h-2.5 w-2.5 rounded-full" style={{ backgroundColor: d.color }} />
                    <span className="text-muted-foreground font-medium">{d.name}</span>
                  </div>
                  <span className="font-semibold text-foreground">{d.value}</span>
                </div>
              ))}
            </div>
          </div>
        </div>

        {/* Weekly + Access Control */}
        <div className="grid grid-cols-1 xl:grid-cols-3 gap-6">
          <div className="xl:col-span-2 rounded-2xl border border-[var(--border)] bg-card p-6">
            <div className="flex items-center justify-between mb-6">
              <div>
                <h3 className="text-[15px] font-semibold text-foreground">Weekly Overview</h3>
                <p className="text-xs text-muted-foreground mt-0.5">Queries processed this week</p>
              </div>
              <Activity className="h-5 w-5 text-muted-foreground/40" />
            </div>
            <div className="h-[220px]">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={weeklyData} margin={{ top: 5, right: 10, bottom: 5, left: -10 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" opacity={0.4} />
                  <XAxis dataKey="day" stroke="var(--muted-foreground)" fontSize={11} opacity={0.6} tickLine={false} axisLine={false} />
                  <YAxis stroke="var(--muted-foreground)" fontSize={11} opacity={0.6} tickLine={false} axisLine={false} />
                  <RechartsTooltip contentStyle={tooltipStyle} />
                  <Bar dataKey="queries" fill="var(--primary)" opacity={0.85} radius={[6, 6, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          </div>

          {/* Dashboard Access Control */}
          <div className="rounded-2xl border border-[var(--border)] bg-card p-6">
            <div className="flex items-center gap-2 mb-1">
              <Eye className="h-4 w-4 text-muted-foreground" />
              <h3 className="text-[15px] font-semibold text-foreground">Dashboard Access</h3>
            </div>
            <p className="text-xs text-muted-foreground mb-6">Control who can view analytics</p>
            <div className="space-y-2">
              {allRoles.map((role) => {
                const hasAccess = viewerAccess.includes(role);
                return (
                  <button
                    key={role}
                    onClick={() => toggleAccess(role)}
                    className={cn(
                      "flex w-full items-center justify-between rounded-xl px-4 py-3 text-[13px] font-medium transition-all duration-150 border",
                      hasAccess
                        ? "bg-primary/5 border-primary/20 text-foreground"
                        : "bg-transparent border-[var(--border)] text-muted-foreground hover:border-[var(--border-strong)]"
                    )}
                  >
                    <span>{role}</span>
                    <div className={cn(
                      "h-5 w-9 rounded-full transition-colors duration-200 relative",
                      hasAccess ? "bg-primary" : "bg-muted"
                    )}>
                      <div className={cn(
                        "absolute top-0.5 h-4 w-4 rounded-full bg-white shadow-sm transition-transform duration-200",
                        hasAccess ? "translate-x-4" : "translate-x-0.5"
                      )} />
                    </div>
                  </button>
                );
              })}
            </div>
            <div className="mt-4 rounded-lg bg-[var(--muted)] px-3 py-2">
              <p className="text-[11px] text-muted-foreground">
                <span className="font-semibold">Note:</span> Admins always have full access. Changes are saved automatically.
              </p>
            </div>
          </div>
        </div>

        {/* System Status */}
        <div className="rounded-2xl border border-[var(--border)] bg-card p-6">
          <h3 className="text-[15px] font-semibold text-foreground mb-4 flex items-center gap-2">
            <Server className="h-4 w-4 text-muted-foreground" /> System Status
          </h3>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
            {[
              { name: "API Gateway", status: "Operational", uptime: "99.99%" },
              { name: "LLM Engine", status: "Operational", uptime: "99.95%" },
              { name: "Vector Store", status: "Operational", uptime: "99.98%" },
              { name: "Auth Service", status: "Degraded", uptime: "98.20%" },
            ].map((s) => (
              <div key={s.name} className="flex items-center gap-3 rounded-xl border border-[var(--border)] px-4 py-3">
                <div className={cn(
                  "h-2.5 w-2.5 rounded-full shrink-0",
                  s.status === "Operational" ? "bg-emerald-500" : "bg-amber-500 animate-pulse"
                )} />
                <div className="flex-1 min-w-0">
                  <p className="text-[13px] font-medium text-foreground truncate">{s.name}</p>
                  <p className="text-[11px] text-muted-foreground">{s.uptime} uptime</p>
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
