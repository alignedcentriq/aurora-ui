import { createFileRoute } from "@tanstack/react-router";
import { useAuth } from "@/lib/auth-store";
import { useState, useEffect, useMemo } from "react";
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
} from "recharts";
import {
  Users,
  Zap,
  TrendingUp,
  ArrowUpRight,
  Server,
  Shield,
  Eye,
  Ticket,
  AlertTriangle,
  Car,
  Receipt,
  Megaphone,
  Plus,
  Trash2,
  Loader2,
  Sparkles,
  Image,
  Database,
  ThumbsUp,
  Lock,
  FolderOpen,
} from "lucide-react";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/_layout/admin")({
  component: AdminDashboard,
});

// ── Colour palettes ──────────────────────────────────────────────────────────
const DEPT_COLORS = ["#6366f1", "#10b981", "#f59e0b", "#06b6d4", "#8b5cf6", "#ef4444", "#ec4899"];
const TICKET_COLORS = ["#6366f1", "#f59e0b", "#10b981", "#ef4444", "#06b6d4", "#8b5cf6", "#ec4899"];

interface OpsMetricProps {
  label: string;
  value: number | string;
  sub: string;
  icon: typeof Ticket;
  color: string;
}

function OpsMetric({ label, value, sub, icon: Icon, color }: OpsMetricProps) {
  return (
    <div className="flex items-center gap-4 rounded-xl border border-[var(--border)] px-4 py-4">
      <div className={cn("flex h-10 w-10 shrink-0 items-center justify-center rounded-xl", color)}>
        <Icon className="h-5 w-5 text-white" />
      </div>
      <div className="min-w-0">
        <p className="text-2xl font-bold text-foreground leading-none">{value}</p>
        <p className="text-[13px] font-medium text-foreground mt-0.5">{label}</p>
        <p className="text-[11px] text-muted-foreground">{sub}</p>
      </div>
    </div>
  );
}

interface KpiCardProps {
  title: string;
  value: string | number;
  sub: string;
  icon: typeof Users;
  iconColor: string;
  loading?: boolean;
}

function KpiCard({ title, value, sub, icon: Icon, iconColor, loading }: KpiCardProps) {
  return (
    <div className="rounded-2xl border border-[var(--border)] bg-card p-6 hover:shadow-lg transition-all">
      <div className="flex items-start justify-between mb-4">
        <div className={cn("flex h-11 w-11 items-center justify-center rounded-xl bg-[var(--muted)]")}>
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

interface AnnouncementItem {
  id: number;
  title: string;
  body: string;
  category: string;
  created_by: string;
  created_by_domain: string;
  is_active: boolean;
  created_at: string;
}

const tooltipStyle = {
  backgroundColor: "var(--card)",
  borderColor: "var(--border)",
  borderRadius: "12px",
  boxShadow: "0 8px 32px -8px rgba(0,0,0,0.12)",
  color: "var(--foreground)",
  fontSize: "12px",
  padding: "8px 12px",
};

function AdminDashboard() {
  const { user } = useAuth();

  // Ops stats (existing endpoint)
  const [stats, setStats] = useState<Record<string, Record<string, number>> | null>(null);
  const [statsLoading, setStatsLoading] = useState(true);

  // Full analytics (new endpoint)
  const [analytics, setAnalytics] = useState<any | null>(null);
  const [analyticsLoading, setAnalyticsLoading] = useState(true);

  // Announcements
  const [announcements, setAnnouncements] = useState<AnnouncementItem[]>([]);
  const [annLoading, setAnnLoading] = useState(true);
  const [newAnn, setNewAnn] = useState({ title: "", body: "", category: "General", image_url: "" });
  const [creating, setCreating] = useState(false);
  const [suggesting, setSuggesting] = useState(false);
  const [showForm, setShowForm] = useState(false);

  const authHeaders = useMemo(() => ({
    "Content-Type": "application/json",
    ...(user?.email ? { "x-user-email": user.email } : {}),
    ...(user?.role ? { "x-user-role": user.role.toLowerCase() } : {}),
  }), [user?.email, user?.role]);

  useEffect(() => {
    fetch("/api/admin/stats", { headers: authHeaders })
      .then((r) => r.json()).then(setStats).catch(() => setStats(null))
      .finally(() => setStatsLoading(false));

    fetch("/api/admin/analytics", { headers: authHeaders })
      .then((r) => r.json()).then(setAnalytics).catch(() => setAnalytics(null))
      .finally(() => setAnalyticsLoading(false));

    fetch("/api/announcements", { headers: authHeaders })
      .then((r) => r.json())
      .then((data) => setAnnouncements(Array.isArray(data) ? data : []))
      .catch(() => setAnnouncements([]))
      .finally(() => setAnnLoading(false));
  }, []);

  // ── Derived chart data ─────────────────────────────────────────────────────

  const feedbackChartData = useMemo(() => {
    if (!analytics?.feedback?.by_domain) return [];
    const byDomain: Record<string, any> = {};
    analytics.feedback.by_domain.forEach((r: any) => {
      if (!byDomain[r.domain]) byDomain[r.domain] = { domain: r.domain.toUpperCase(), Helpful: 0, Unhelpful: 0 };
      if (r.rating === 1) byDomain[r.domain].Helpful = r.count;
      else if (r.rating === -1) byDomain[r.domain].Unhelpful = r.count;
    });
    return Object.values(byDomain);
  }, [analytics]);

  const ticketCategoryData = useMemo(() => {
    if (!analytics?.it_tickets?.by_category) return [];
    return analytics.it_tickets.by_category.map((r: any, i: number) => ({
      ...r,
      color: TICKET_COLORS[i % TICKET_COLORS.length],
    }));
  }, [analytics]);

  // ── Handlers ───────────────────────────────────────────────────────────────

  const refreshAnnouncements = () =>
    fetch("/api/announcements", { headers: authHeaders })
      .then((r) => r.json())
      .then((data) => setAnnouncements(Array.isArray(data) ? data : []))
      .catch(() => {});

  const handleSuggestBody = async () => {
    if (!newAnn.title.trim()) return;
    setSuggesting(true);
    try {
      const res = await fetch("/api/announcements/suggest", {
        method: "POST", headers: authHeaders,
        body: JSON.stringify({ title: newAnn.title, category: newAnn.category }),
      });
      if (res.ok) { const data = await res.json(); setNewAnn((p) => ({ ...p, body: data.body })); }
    } finally { setSuggesting(false); }
  };

  const handleCreateAnnouncement = async () => {
    if (!newAnn.title.trim() || !newAnn.body.trim()) return;
    setCreating(true);
    try {
      await fetch("/api/announcements", {
        method: "POST", headers: authHeaders,
        body: JSON.stringify({
          title: newAnn.title, body: newAnn.body, category: newAnn.category,
          created_by_domain: "admin", target_audience: "all",
          image_url: newAnn.image_url.trim() || null,
        }),
      });
      setNewAnn({ title: "", body: "", category: "General", image_url: "" });
      setShowForm(false);
      refreshAnnouncements();
    } finally { setCreating(false); }
  };

  const handleDeactivate = async (id: number) => {
    await fetch(`/api/announcements/${id}`, { method: "DELETE", headers: authHeaders });
    refreshAnnouncements();
  };

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

  const categoryColors: Record<string, string> = {
    "Policy Update": "bg-blue-500/10 text-blue-500",
    "Holiday": "bg-emerald-500/10 text-emerald-500",
    "Events": "bg-violet-500/10 text-violet-500",
    "IT Alert": "bg-rose-500/10 text-rose-500",
    "General": "bg-amber-500/10 text-amber-500",
  };

  return (
    <div className="flex h-full flex-col overflow-y-auto">
      {/* Header */}
      <div className="sticky top-0 z-10 border-b border-[var(--border)] bg-background/80 backdrop-blur-xl px-8 py-5">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-xl font-semibold text-foreground tracking-tight">Analytics Dashboard</h1>
            <p className="text-[13px] text-muted-foreground mt-0.5">Live data from the Centriq AI database</p>
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

        {/* KPI Cards — real data */}
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-4">
          <KpiCard
            title="Total Employees"
            value={analytics?.employees?.total ?? "—"}
            sub="in the organisation"
            icon={Users}
            iconColor="text-blue-500"
            loading={analyticsLoading}
          />
          <KpiCard
            title="AI Satisfaction Score"
            value={analytics?.feedback?.total ? `${analytics.feedback.score_pct}%` : "—"}
            sub={analytics?.feedback?.total ? `${analytics.feedback.helpful} helpful · ${analytics.feedback.unhelpful} unhelpful` : "no feedback yet"}
            icon={ThumbsUp}
            iconColor="text-emerald-500"
            loading={analyticsLoading}
          />
          <KpiCard
            title="Open IT Tickets"
            value={analytics?.it_tickets?.open ?? stats?.it_tickets?.open ?? "—"}
            sub={`of ${analytics?.it_tickets?.total ?? "—"} total tickets`}
            icon={Ticket}
            iconColor="text-amber-500"
            loading={analyticsLoading && statsLoading}
          />
          <KpiCard
            title="PMO Projects"
            value={analytics?.projects?.total ?? "—"}
            sub={`avg ${analytics?.projects?.avg_completion ?? 0}% completion`}
            icon={FolderOpen}
            iconColor="text-violet-500"
            loading={analyticsLoading}
          />
        </div>

        {/* Operations Overview — live from existing stats API */}
        <div className="rounded-2xl border border-[var(--border)] bg-card p-6">
          <div className="flex items-center justify-between mb-5">
            <div>
              <h3 className="text-[15px] font-semibold text-foreground">Operations Overview</h3>
              <p className="text-xs text-muted-foreground mt-0.5">Live counts across all service domains</p>
            </div>
            {statsLoading && <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />}
          </div>
          {stats ? (
            <div className="grid grid-cols-2 sm:grid-cols-3 xl:grid-cols-6 gap-3">
              <OpsMetric label="IT Tickets" value={stats.it_tickets?.open ?? "—"} sub="open tickets" icon={Ticket} color="bg-indigo-500" />
              <OpsMetric label="Resolved Today" value={stats.it_tickets?.resolved_today ?? "—"} sub="IT tickets" icon={Zap} color="bg-emerald-500" />
              <OpsMetric label="Facility Issues" value={stats.facility_complaints?.open ?? "—"} sub="open complaints" icon={AlertTriangle} color="bg-amber-500" />
              <OpsMetric label="Parking Pending" value={stats.parking?.pending ?? "—"} sub="sticker requests" icon={Car} color="bg-sky-500" />
              <OpsMetric label="Reimbursements" value={stats.reimbursements?.pending ?? "—"} sub="pending approval" icon={Receipt} color="bg-rose-500" />
              <OpsMetric label="Announcements" value={stats.announcements?.active ?? "—"} sub="active broadcasts" icon={Megaphone} color="bg-violet-500" />
            </div>
          ) : (
            <p className="text-sm text-muted-foreground">Stats unavailable — backend may be offline.</p>
          )}
        </div>

        {/* Row 1: Employee by Department + IT Tickets by Category */}
        <div className="grid grid-cols-1 xl:grid-cols-3 gap-6">
          <div className="xl:col-span-2 rounded-2xl border border-[var(--border)] bg-card p-6">
            <h3 className="text-[15px] font-semibold text-foreground mb-1">Employees by Department</h3>
            <p className="text-xs text-muted-foreground mb-6">Headcount distribution across all functions</p>
            {analyticsLoading ? (
              <div className="flex items-center justify-center h-[240px]"><Loader2 className="h-6 w-6 animate-spin text-muted-foreground" /></div>
            ) : (
              <div className="h-[240px]">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={analytics?.employees?.by_department ?? []} margin={{ top: 5, right: 10, bottom: 5, left: -10 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" opacity={0.4} />
                    <XAxis dataKey="dept" stroke="var(--muted-foreground)" fontSize={11} opacity={0.6} tickLine={false} axisLine={false} />
                    <YAxis stroke="var(--muted-foreground)" fontSize={11} opacity={0.6} tickLine={false} axisLine={false} />
                    <RechartsTooltip contentStyle={tooltipStyle} />
                    <Bar dataKey="count" name="Employees" radius={[6, 6, 0, 0]}>
                      {(analytics?.employees?.by_department ?? []).map((_: any, i: number) => (
                        <Cell key={i} fill={DEPT_COLORS[i % DEPT_COLORS.length]} />
                      ))}
                    </Bar>
                  </BarChart>
                </ResponsiveContainer>
              </div>
            )}
          </div>

          <div className="rounded-2xl border border-[var(--border)] bg-card p-6">
            <h3 className="text-[15px] font-semibold text-foreground mb-1">IT Tickets by Category</h3>
            <p className="text-xs text-muted-foreground mb-4">All-time breakdown by type</p>
            {analyticsLoading ? (
              <div className="flex items-center justify-center h-[180px]"><Loader2 className="h-6 w-6 animate-spin text-muted-foreground" /></div>
            ) : ticketCategoryData.length === 0 ? (
              <p className="text-sm text-muted-foreground text-center py-8">No ticket data yet</p>
            ) : (
              <>
                <div className="h-[160px]">
                  <ResponsiveContainer width="100%" height="100%">
                    <PieChart>
                      <Pie data={ticketCategoryData} cx="50%" cy="50%" innerRadius={40} outerRadius={70} paddingAngle={3} dataKey="count" strokeWidth={0}>
                        {ticketCategoryData.map((entry: any, i: number) => (
                          <Cell key={i} fill={entry.color} />
                        ))}
                      </Pie>
                      <RechartsTooltip contentStyle={tooltipStyle} formatter={(v: any, n: any) => [v, "Tickets"]} />
                    </PieChart>
                  </ResponsiveContainer>
                </div>
                <div className="mt-3 space-y-1.5">
                  {ticketCategoryData.map((d: any) => (
                    <div key={d.category} className="flex items-center justify-between text-xs">
                      <div className="flex items-center gap-2">
                        <div className="h-2.5 w-2.5 rounded-full shrink-0" style={{ backgroundColor: d.color }} />
                        <span className="text-muted-foreground font-medium truncate max-w-[120px]">{d.category}</span>
                      </div>
                      <span className="font-semibold text-foreground">{d.count}</span>
                    </div>
                  ))}
                </div>
              </>
            )}
          </div>
        </div>

        {/* Row 2: AI Feedback by Domain + Facility Complaints */}
        <div className="grid grid-cols-1 xl:grid-cols-2 gap-6">
          <div className="rounded-2xl border border-[var(--border)] bg-card p-6">
            <div className="flex items-center justify-between mb-6">
              <div>
                <h3 className="text-[15px] font-semibold text-foreground">AI Feedback by Domain</h3>
                <p className="text-xs text-muted-foreground mt-0.5">Helpful vs unhelpful ratings per domain</p>
              </div>
              <ThumbsUp className="h-4 w-4 text-muted-foreground/40" />
            </div>
            {analyticsLoading ? (
              <div className="flex items-center justify-center h-[220px]"><Loader2 className="h-6 w-6 animate-spin text-muted-foreground" /></div>
            ) : feedbackChartData.length === 0 ? (
              <p className="text-sm text-muted-foreground text-center py-10">No feedback recorded yet</p>
            ) : (
              <div className="h-[220px]">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={feedbackChartData} margin={{ top: 5, right: 10, bottom: 5, left: -10 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" opacity={0.4} />
                    <XAxis dataKey="domain" stroke="var(--muted-foreground)" fontSize={11} opacity={0.6} tickLine={false} axisLine={false} />
                    <YAxis stroke="var(--muted-foreground)" fontSize={11} opacity={0.6} tickLine={false} axisLine={false} />
                    <RechartsTooltip contentStyle={tooltipStyle} />
                    <Legend wrapperStyle={{ fontSize: 11 }} />
                    <Bar dataKey="Helpful" fill="#10b981" radius={[4, 4, 0, 0]} />
                    <Bar dataKey="Unhelpful" fill="#ef4444" radius={[4, 4, 0, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            )}
          </div>

          <div className="rounded-2xl border border-[var(--border)] bg-card p-6">
            <h3 className="text-[15px] font-semibold text-foreground mb-1">Facility Complaints</h3>
            <p className="text-xs text-muted-foreground mb-6">Volume by complaint category</p>
            {analyticsLoading ? (
              <div className="flex items-center justify-center h-[220px]"><Loader2 className="h-6 w-6 animate-spin text-muted-foreground" /></div>
            ) : (analytics?.facility_complaints?.by_category ?? []).length === 0 ? (
              <p className="text-sm text-muted-foreground text-center py-8">No complaints logged yet</p>
            ) : (
              <div className="h-[220px]">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={analytics.facility_complaints.by_category} layout="vertical" margin={{ top: 5, right: 10, bottom: 5, left: 10 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" opacity={0.4} horizontal={false} />
                    <XAxis type="number" stroke="var(--muted-foreground)" fontSize={11} opacity={0.6} tickLine={false} axisLine={false} />
                    <YAxis type="category" dataKey="category" stroke="var(--muted-foreground)" fontSize={11} opacity={0.6} tickLine={false} axisLine={false} width={80} />
                    <RechartsTooltip contentStyle={tooltipStyle} />
                    <Bar dataKey="count" name="Complaints" fill="#f59e0b" opacity={0.85} radius={[0, 6, 6, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            )}
          </div>
        </div>

        {/* PMO Projects status + Food Vendor ratings */}
        <div className="grid grid-cols-1 xl:grid-cols-2 gap-6">
          <div className="rounded-2xl border border-[var(--border)] bg-card p-6">
            <h3 className="text-[15px] font-semibold text-foreground mb-1">PMO Projects by Status</h3>
            <p className="text-xs text-muted-foreground mb-4">
              {analytics?.projects?.total ?? "—"} projects · avg {analytics?.projects?.avg_completion ?? 0}% complete
            </p>
            {analyticsLoading ? (
              <div className="flex items-center justify-center h-[160px]"><Loader2 className="h-6 w-6 animate-spin text-muted-foreground" /></div>
            ) : (
              <div className="space-y-2">
                {(analytics?.projects?.by_status ?? []).map((r: any, i: number) => (
                  <div key={r.status} className="flex items-center gap-3 rounded-xl border border-[var(--border)] px-4 py-3">
                    <div className="h-2.5 w-2.5 rounded-full shrink-0" style={{ backgroundColor: DEPT_COLORS[i % DEPT_COLORS.length] }} />
                    <span className="text-[13px] font-medium text-foreground flex-1">{r.status}</span>
                    <span className="text-[13px] font-bold text-foreground">{r.count}</span>
                  </div>
                ))}
              </div>
            )}
          </div>

          <div className="rounded-2xl border border-[var(--border)] bg-card p-6">
            <h3 className="text-[15px] font-semibold text-foreground mb-1">Food Vendor Ratings</h3>
            <p className="text-xs text-muted-foreground mb-4">Average employee rating (1–5 stars)</p>
            {analyticsLoading ? (
              <div className="flex items-center justify-center h-[160px]"><Loader2 className="h-6 w-6 animate-spin text-muted-foreground" /></div>
            ) : (analytics?.food_vendors ?? []).length === 0 ? (
              <p className="text-sm text-muted-foreground text-center py-6">No vendor feedback yet</p>
            ) : (
              <div className="space-y-2">
                {(analytics?.food_vendors ?? []).map((v: any) => (
                  <div key={v.vendor} className="flex items-center gap-3 rounded-xl border border-[var(--border)] px-4 py-3">
                    <span className="text-[13px] font-medium text-foreground flex-1 truncate">{v.vendor}</span>
                    <span className="text-[11px] text-muted-foreground">{v.reviews} reviews</span>
                    <span className="text-[13px] font-bold text-amber-500">★ {v.avg_rating}</span>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>

        {/* Announcement Management */}
        <div className="rounded-2xl border border-[var(--border)] bg-card p-6">
          <div className="flex items-center justify-between mb-5">
            <div className="flex items-center gap-2">
              <Megaphone className="h-4 w-4 text-muted-foreground" />
              <div>
                <h3 className="text-[15px] font-semibold text-foreground">Announcement Management</h3>
                <p className="text-xs text-muted-foreground mt-0.5">Create and manage broadcasts for all employees</p>
              </div>
            </div>
            <button
              onClick={() => setShowForm((v) => !v)}
              className="flex items-center gap-1.5 rounded-xl bg-primary px-4 py-2 text-[13px] font-semibold text-primary-foreground hover:opacity-90 transition-opacity"
            >
              <Plus className="h-4 w-4" />
              New Announcement
            </button>
          </div>

          {showForm && (
            <div className="mb-5 rounded-xl border border-[var(--border)] bg-[var(--muted)] p-4 space-y-3">
              <div className="flex gap-2">
                <input
                  type="text"
                  placeholder="Title"
                  value={newAnn.title}
                  onChange={(e) => setNewAnn((p) => ({ ...p, title: e.target.value }))}
                  className="flex-1 rounded-lg border border-[var(--border)] bg-background px-3 py-2 text-[13px] text-foreground placeholder:text-muted-foreground outline-none focus:border-primary/50"
                />
                <select
                  value={newAnn.category}
                  onChange={(e) => setNewAnn((p) => ({ ...p, category: e.target.value }))}
                  className="rounded-lg border border-[var(--border)] bg-background px-3 py-2 text-[13px] text-foreground outline-none focus:border-primary/50"
                >
                  {["General", "Policy Update", "Holiday", "Events", "IT Alert"].map((c) => (
                    <option key={c} value={c}>{c}</option>
                  ))}
                </select>
              </div>
              <div className="relative">
                <textarea
                  placeholder="Announcement body..."
                  rows={4}
                  value={newAnn.body}
                  onChange={(e) => setNewAnn((p) => ({ ...p, body: e.target.value }))}
                  className="w-full rounded-lg border border-[var(--border)] bg-background px-3 py-2 pr-28 text-[13px] text-foreground placeholder:text-muted-foreground outline-none focus:border-primary/50 resize-none"
                />
                <button
                  onClick={handleSuggestBody}
                  disabled={suggesting || !newAnn.title.trim()}
                  className="absolute right-2 top-2 flex items-center gap-1 rounded-md bg-violet-500/10 px-2.5 py-1.5 text-[11px] font-semibold text-violet-500 hover:bg-violet-500/20 disabled:opacity-40 transition-colors"
                >
                  {suggesting ? <Loader2 className="h-3 w-3 animate-spin" /> : <Sparkles className="h-3 w-3" />}
                  Suggest
                </button>
              </div>
              <div className="flex items-center gap-2">
                <Image className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
                <input
                  type="url"
                  placeholder="Image URL (optional)"
                  value={newAnn.image_url}
                  onChange={(e) => setNewAnn((p) => ({ ...p, image_url: e.target.value }))}
                  className="flex-1 rounded-lg border border-[var(--border)] bg-background px-3 py-2 text-[13px] text-foreground placeholder:text-muted-foreground outline-none focus:border-primary/50"
                />
              </div>
              {newAnn.image_url.trim() && (
                <img src={newAnn.image_url.trim()} alt="Preview" className="h-24 w-auto rounded-lg object-cover border border-[var(--border)]"
                  onError={(e) => { (e.target as HTMLImageElement).style.display = "none"; }} />
              )}
              <div className="flex items-center gap-3">
                <button
                  onClick={handleCreateAnnouncement}
                  disabled={creating || !newAnn.title.trim() || !newAnn.body.trim()}
                  className="flex items-center gap-1.5 rounded-lg bg-primary px-4 py-2 text-[13px] font-semibold text-primary-foreground hover:opacity-90 disabled:opacity-50 transition-opacity"
                >
                  {creating && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
                  Publish
                </button>
                <button
                  onClick={() => { setShowForm(false); setNewAnn({ title: "", body: "", category: "General", image_url: "" }); }}
                  className="rounded-lg border border-[var(--border)] px-4 py-2 text-[13px] font-medium text-muted-foreground hover:text-foreground transition-colors"
                >
                  Cancel
                </button>
              </div>
            </div>
          )}

          {annLoading ? (
            <div className="flex items-center gap-2 py-4 text-sm text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin" /> Loading announcements...
            </div>
          ) : announcements.length === 0 ? (
            <p className="text-sm text-muted-foreground py-2">No announcements found.</p>
          ) : (
            <div className="space-y-2">
              {announcements.map((ann) => (
                <div key={ann.id} className={cn(
                  "flex items-start justify-between gap-4 rounded-xl border px-4 py-3",
                  ann.is_active ? "border-[var(--border)] bg-background" : "border-[var(--border)] bg-[var(--muted)] opacity-60",
                )}>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="text-[13px] font-semibold text-foreground">{ann.title}</span>
                      <span className={cn("rounded-full px-2 py-0.5 text-[10px] font-semibold", categoryColors[ann.category] ?? "bg-[var(--muted)] text-muted-foreground")}>
                        {ann.category}
                      </span>
                      {!ann.is_active && (
                        <span className="rounded-full bg-[var(--muted)] px-2 py-0.5 text-[10px] font-semibold text-muted-foreground">Inactive</span>
                      )}
                    </div>
                    <p className="text-[12px] text-muted-foreground mt-0.5 line-clamp-2">{ann.body}</p>
                    <p className="text-[11px] text-muted-foreground/60 mt-1">by {ann.created_by} · {ann.created_by_domain}</p>
                  </div>
                  {ann.is_active && (
                    <button
                      onClick={() => handleDeactivate(ann.id)}
                      className="shrink-0 flex items-center gap-1 rounded-lg border border-rose-500/20 px-2.5 py-1.5 text-[11px] font-medium text-rose-500 hover:bg-rose-500/10 transition-colors"
                    >
                      <Trash2 className="h-3 w-3" /> Deactivate
                    </button>
                  )}
                </div>
              ))}
            </div>
          )}
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
              { name: "Auth Service", status: "Operational", uptime: "99.80%" },
            ].map((s) => (
              <div key={s.name} className="flex items-center gap-3 rounded-xl border border-[var(--border)] px-4 py-3">
                <div className={cn("h-2.5 w-2.5 rounded-full shrink-0", s.status === "Operational" ? "bg-emerald-500" : "bg-amber-500 animate-pulse")} />
                <div className="flex-1 min-w-0">
                  <p className="text-[13px] font-medium text-foreground truncate">{s.name}</p>
                  <p className="text-[11px] text-muted-foreground">{s.uptime} uptime</p>
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* Observability — tools explanation */}
        <div className="rounded-2xl border border-[var(--border)] bg-card p-6">
          <h3 className="text-[15px] font-semibold text-foreground mb-1 flex items-center gap-2">
            <Eye className="h-4 w-4 text-muted-foreground" /> Observability Tools
          </h3>
          <p className="text-xs text-muted-foreground mb-6">
            External monitoring tools — require separate login credentials to access.
          </p>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            {/* AI Observability */}
            <div className="rounded-xl border border-[var(--border)] p-4 space-y-3">
              <div className="flex items-start justify-between gap-3">
                <div className="flex items-center gap-2">
                  <Database className="h-5 w-5 text-indigo-500" />
                  <h4 className="text-[14px] font-semibold text-foreground">AI Observability</h4>
                </div>
                <span className="flex items-center gap-1 rounded-full bg-emerald-500/10 px-2 py-0.5 text-[10px] font-semibold text-emerald-600 shrink-0">
                  Built-in
                </span>
              </div>
              <p className="text-[12px] text-muted-foreground leading-relaxed">
                CloudTrail-style activity logs, request volume charts, latency metrics, domain routing analytics, and per-node LLM performance.
              </p>
              <a
                href="/observability"
                className="inline-flex items-center gap-1.5 text-[12px] font-medium text-primary hover:underline"
              >
                Open Observability <ArrowUpRight className="h-3.5 w-3.5" />
              </a>
            </div>

            {/* Langfuse */}
            <div className="rounded-xl border border-[var(--border)] p-4 space-y-3">
              <div className="flex items-start justify-between gap-3">
                <div className="flex items-center gap-2">
                  <TrendingUp className="h-5 w-5 text-violet-500" />
                  <h4 className="text-[14px] font-semibold text-foreground">Langfuse Tracing</h4>
                </div>
                <span className="flex items-center gap-1 rounded-full bg-amber-500/10 px-2 py-0.5 text-[10px] font-semibold text-amber-600 shrink-0">
                  <Lock className="h-2.5 w-2.5" /> Login required
                </span>
              </div>
              <p className="text-[12px] text-muted-foreground leading-relaxed">
                LLM trace waterfall — deep-dive into individual AI requests to see per-node generation spans, token usage, model latency, and tool calls.
                Use it to debug specific agent failures or inspect the full reasoning chain.
              </p>
              <a
                href={`${window.location.protocol}//${window.location.hostname}:3003`}
                target="_blank"
                rel="noreferrer"
                className="inline-flex items-center gap-1.5 text-[12px] font-medium text-primary hover:underline"
              >
                Open Langfuse <ArrowUpRight className="h-3.5 w-3.5" />
              </a>
            </div>
          </div>
        </div>

      </div>
    </div>
  );
}
