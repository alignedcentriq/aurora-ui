import { useAuth } from "@/lib/auth-store";
import { getIdToken } from "@/lib/api-token";
import { useState, useEffect, useCallback } from "react";
import {
  BookOpen, BarChart2, Users, ClipboardList, GraduationCap, Play,
  Link2, ChevronRight, ChevronDown, CheckCircle2, Clock, AlertCircle,
  RefreshCw, Loader2, TrendingUp, Award, Activity, BookMarked, Target,
  LayoutDashboard, Trophy, Building2, Tag, ExternalLink, PlayCircle,
  CalendarDays, Star, Percent, UserCheck, ListChecks
} from "lucide-react";
import { cn } from "@/lib/utils";
import { motion, AnimatePresence } from "framer-motion";

type TERole = "admin" | "employee" | null;
type AdminTab = "dashboard" | "trainings" | "assignments" | "reports";
type EmployeeTab = "my-trainings";

// ── helpers ──────────────────────────────────────────────────────────────────

function statusColor(s: string) {
  if (s === "completed") return "text-emerald-400 bg-emerald-400/10";
  if (s === "in_progress") return "text-amber-400 bg-amber-400/10";
  if (s === "assigned" || s === "pending") return "text-blue-400 bg-blue-400/10";
  if (s === "failed") return "text-rose-400 bg-rose-400/10";
  return "text-zinc-400 bg-zinc-400/10";
}

function statusLabel(s: string) {
  if (s === "in_progress") return "In Progress";
  if (s === "assigned") return "Assigned";
  if (s === "completed") return "Completed";
  if (s === "pending") return "Pending";
  if (s === "failed") return "Failed";
  return s;
}

function youtubeEmbed(url: string) {
  const m = url?.match(/(?:youtube\.com\/watch\?v=|youtu\.be\/)([\w-]+)/);
  return m ? `https://www.youtube.com/embed/${m[1]}` : null;
}

function StatCard({ label, value, sub, icon: Icon, accent }: {
  label: string; value: string | number; sub?: string;
  icon: React.ElementType; accent: string;
}) {
  return (
    <div className={cn("rounded-xl border border-border bg-card p-4 flex gap-3 items-start", "hover:border-border/80 transition-colors")}>
      <div className={cn("p-2 rounded-lg", accent)}><Icon className="w-4 h-4" /></div>
      <div className="min-w-0">
        <p className="text-xs text-muted-foreground truncate">{label}</p>
        <p className="text-xl font-semibold leading-tight">{value}</p>
        {sub && <p className="text-xs text-muted-foreground mt-0.5">{sub}</p>}
      </div>
    </div>
  );
}

// ── main export ───────────────────────────────────────────────────────────────

export function TechElevatePortal() {
  const { user } = useAuth();
  const [teRole, setTeRole] = useState<TERole>(null);
  const [loading, setLoading] = useState(true);
  const [needsConnect, setNeedsConnect] = useState(false);
  const [pasteJwt, setPasteJwt] = useState("");
  const [pasteError, setPasteError] = useState("");

  const authHeaders = {
    "Content-Type": "application/json",
    ...(user?.email ? { "x-user-email": user.email } : {}),
    ...(user?.role ? { "x-user-role": user.role.toLowerCase() } : {}),
  };

  // Establish a TechElevate session by minting an Azure id_token in the browser
  // (MSAL) and exchanging it at the backend's /connect (→ TechElevate sso-login).
  const connect = useCallback(async () => {
    const idToken = await getIdToken();
    if (!idToken) return false;
    const resp = await fetch("/api/portal/techelevate/connect", {
      method: "POST",
      headers: authHeaders,
      body: JSON.stringify({ id_token: idToken }),
    });
    return resp.ok;
  }, [user?.email]);

  // On mount: ask the backend who we are. If there's no session yet (401), mint
  // an id_token via MSAL, establish the session, and retry once.
  const loadProfile = useCallback(async () => {
    if (!user?.email) return;
    setLoading(true);
    try {
      let meResp = await fetch("/api/portal/techelevate/me", { headers: authHeaders });
      if (meResp.status === 401) {
        const ok = await connect();
        if (!ok) { setNeedsConnect(true); return; }
        meResp = await fetch("/api/portal/techelevate/me", { headers: authHeaders });
        if (!meResp.ok) { setNeedsConnect(true); return; }
      }
      const me = await meResp.json();
      setTeRole(me.role === "admin" ? "admin" : "employee");
      setNeedsConnect(false);
    } catch {
      setNeedsConnect(true);
    } finally {
      setLoading(false);
    }
  }, [user?.email, connect]);

  // Dev/manual fallback: paste a raw TechElevate JWT (grab from DevTools on training.alignedautomation.com)
  const connectWithPasted = useCallback(async () => {
    setPasteError("");
    if (!pasteJwt.trim()) { setPasteError("Paste a TechElevate JWT first."); return; }
    const resp = await fetch("/api/portal/techelevate/connect", {
      method: "POST",
      headers: authHeaders,
      body: JSON.stringify({ te_jwt: pasteJwt.trim() }),
    });
    if (!resp.ok) { setPasteError("Couldn't store the token — check it is valid."); return; }
    setPasteJwt("");
    loadProfile();
  }, [pasteJwt, authHeaders, loadProfile]);

  useEffect(() => { loadProfile(); }, [loadProfile]);

  if (loading) return (
    <div className="flex h-full items-center justify-center gap-2 text-muted-foreground">
      <Loader2 className="w-5 h-5 animate-spin" /> Loading TechElevate…
    </div>
  );

  if (needsConnect) return (
    <div className="flex h-full items-center justify-center p-6">
      <div className="text-center max-w-md space-y-4">
        <div className="p-3 rounded-full bg-violet-500/10 w-fit mx-auto">
          <GraduationCap className="w-8 h-8 text-violet-400" />
        </div>
        <p className="font-semibold text-lg">Couldn't sign in to TechElevate</p>
        <p className="text-sm text-muted-foreground">
          TechElevate uses your Microsoft (Azure AD) sign-in. We couldn't establish a session
          automatically — make sure you're signed in to Centriq and retry.
        </p>
        <button
          onClick={loadProfile}
          className="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-violet-600 hover:bg-violet-500 text-white text-sm font-medium transition-colors"
        >
          <RefreshCw className="w-4 h-4" /> Retry
        </button>

        <div className="border-t border-border pt-4 space-y-2 text-left">
          <p className="text-xs text-muted-foreground font-medium">Manual sign-in (dev / fallback)</p>
          <p className="text-xs text-muted-foreground">
            Open the TechElevate portal in a browser and sign in, then open
            DevTools → Network → any API request → copy the{" "}
            <span className="font-mono">Authorization</span> header value.
            Paste it below (with or without the "Bearer " prefix).
          </p>
          <textarea
            value={pasteJwt}
            onChange={e => setPasteJwt(e.target.value)}
            rows={3}
            placeholder="Paste TechElevate JWT here…"
            className="w-full text-xs font-mono rounded-lg border border-border bg-muted/40 px-3 py-2 resize-none focus:outline-none focus:ring-1 focus:ring-violet-500"
          />
          {pasteError && <p className="text-xs text-rose-400">{pasteError}</p>}
          <button
            onClick={connectWithPasted}
            disabled={!pasteJwt.trim()}
            className="inline-flex items-center gap-2 px-3 py-1.5 rounded-lg bg-violet-600 hover:bg-violet-500 disabled:opacity-40 text-white text-xs font-medium transition-colors"
          >
            Connect
          </button>
        </div>
      </div>
    </div>
  );

  return teRole === "admin"
    ? <AdminPortal authHeaders={authHeaders} />
    : <EmployeePortal authHeaders={authHeaders} email={user?.email ?? ""} />;
}

// ══════════════════════════════════════════════════════════════════════════════
// ADMIN PORTAL
// ══════════════════════════════════════════════════════════════════════════════

function AdminPortal({ authHeaders }: { authHeaders: Record<string, string> }) {
  const [tab, setTab] = useState<AdminTab>("dashboard");

  const tabs: { id: AdminTab; label: string; icon: React.ElementType }[] = [
    { id: "dashboard", label: "Dashboard", icon: LayoutDashboard },
    { id: "trainings", label: "Trainings", icon: BookOpen },
    { id: "assignments", label: "Assignments", icon: ClipboardList },
    { id: "reports", label: "Reports", icon: BarChart2 },
  ];

  return (
    <div className="flex flex-col h-full overflow-hidden">
      {/* header */}
      <div className="px-6 pt-5 pb-0 border-b border-border shrink-0">
        <div className="flex items-center gap-2 mb-4">
          <GraduationCap className="w-5 h-5 text-violet-400" />
          <h1 className="text-lg font-semibold">TechElevate</h1>
          <span className="text-xs px-1.5 py-0.5 rounded bg-violet-500/15 text-violet-400 font-medium">Admin</span>
        </div>
        <div className="flex gap-0">
          {tabs.map(t => (
            <button key={t.id} onClick={() => setTab(t.id)}
              className={cn("flex items-center gap-1.5 px-4 py-2.5 text-sm font-medium border-b-2 transition-colors",
                tab === t.id ? "border-violet-400 text-violet-400" : "border-transparent text-muted-foreground hover:text-foreground"
              )}>
              <t.icon className="w-4 h-4" />{t.label}
            </button>
          ))}
        </div>
      </div>

      <div className="flex-1 overflow-y-auto">
        {tab === "dashboard" && <DashboardTab authHeaders={authHeaders} />}
        {tab === "trainings" && <TrainingsTab authHeaders={authHeaders} />}
        {tab === "assignments" && <AssignmentsTab authHeaders={authHeaders} />}
        {tab === "reports" && <ReportsTab authHeaders={authHeaders} />}
      </div>
    </div>
  );
}

// ── Dashboard ─────────────────────────────────────────────────────────────────

function DashboardTab({ authHeaders }: { authHeaders: Record<string, string> }) {
  const [overview, setOverview] = useState<any>(null);
  const [stats, setStats] = useState<any>(null);
  const [topEmp, setTopEmp] = useState<any[]>([]);
  const [topTrn, setTopTrn] = useState<any[]>([]);
  const [monthly, setMonthly] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    setLoading(true);
    Promise.all([
      fetch("/api/portal/techelevate/reports/overview", { headers: authHeaders }).then(r => r.json()),
      fetch("/api/portal/techelevate/trainings/stats", { headers: authHeaders }).then(r => r.json()),
      fetch("/api/portal/techelevate/reports/top-employees", { headers: authHeaders }).then(r => r.json()),
      fetch("/api/portal/techelevate/reports/top-trainings", { headers: authHeaders }).then(r => r.json()),
      fetch("/api/portal/techelevate/reports/monthly-completions", { headers: authHeaders }).then(r => r.json()),
    ]).then(([ov, st, te, tt, mc]) => {
      setOverview(ov); setStats(st); setTopEmp(te || []); setTopTrn(tt || []);
      setMonthly((mc || []).slice(-6));
    }).finally(() => setLoading(false));
  }, []);

  if (loading) return <LoadingPane />;

  const maxMonthly = Math.max(...monthly.map((m: any) => m.total), 1);

  return (
    <div className="p-6 space-y-6">
      {/* KPI grid */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <StatCard label="Total Trainings" value={overview?.total_trainings ?? stats?.total_trainings ?? 0} icon={BookOpen} accent="bg-violet-500/10 text-violet-400" />
        <StatCard label="Total Assignments" value={overview?.total_assignments ?? 0} icon={ClipboardList} accent="bg-blue-500/10 text-blue-400" />
        <StatCard label="Completion Rate" value={`${(overview?.completion_rate ?? 0).toFixed(1)}%`} icon={CheckCircle2} accent="bg-emerald-500/10 text-emerald-400" sub={`${overview?.completed_assignments ?? 0} completed`} />
        <StatCard label="Avg Score" value={`${(overview?.average_score ?? 0).toFixed(1)}%`} icon={Star} accent="bg-amber-500/10 text-amber-400" />
        <StatCard label="Employees Enrolled" value={overview?.employees_with_assignments ?? 0} icon={UserCheck} accent="bg-cyan-500/10 text-cyan-400" sub={`of ${overview?.total_employees ?? 0} total`} />
        <StatCard label="In Progress" value={overview?.in_progress_assignments ?? 0} icon={Activity} accent="bg-orange-500/10 text-orange-400" />
        <StatCard label="Multi-Level" value={stats?.with_levels ?? 0} icon={ListChecks} accent="bg-purple-500/10 text-purple-400" sub={`${stats?.single_level ?? 0} single-level`} />
        <StatCard label="Departments" value={overview?.departments_with_assignments ?? 0} icon={Building2} accent="bg-rose-500/10 text-rose-400" />
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        {/* Monthly completions bar chart */}
        <div className="rounded-xl border border-border bg-card p-4">
          <h3 className="text-sm font-medium mb-4 flex items-center gap-1.5"><TrendingUp className="w-4 h-4 text-violet-400" />Monthly Assignments</h3>
          <div className="flex items-end gap-2 h-32">
            {monthly.map((m: any) => (
              <div key={m.month} className="flex-1 flex flex-col items-center gap-1">
                <div className="w-full flex flex-col items-center gap-0.5" style={{ height: "100px" }}>
                  <div className="w-full rounded-t bg-violet-500/20" style={{ height: `${(m.total / maxMonthly) * 80}px`, minHeight: 4 }} />
                  <div className="w-full rounded-t bg-emerald-500" style={{ height: `${(m.completed / maxMonthly) * 80}px`, minHeight: m.completed ? 2 : 0 }} />
                </div>
                <span className="text-[10px] text-muted-foreground">{m.month?.slice(5)}</span>
              </div>
            ))}
          </div>
          <div className="flex gap-3 mt-2 text-xs text-muted-foreground">
            <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-sm bg-violet-500/20 inline-block" />Assigned</span>
            <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-sm bg-emerald-500 inline-block" />Completed</span>
          </div>
        </div>

        {/* Top trainings */}
        <div className="rounded-xl border border-border bg-card p-4">
          <h3 className="text-sm font-medium mb-3 flex items-center gap-1.5"><Trophy className="w-4 h-4 text-amber-400" />Top Trainings</h3>
          <div className="space-y-2">
            {topTrn.slice(0, 5).map((t: any, i) => (
              <div key={t.training_id} className="flex items-center gap-2 text-sm">
                <span className="text-xs text-muted-foreground w-4">{i + 1}.</span>
                <span className="flex-1 truncate">{t.title}</span>
                <span className="text-xs text-muted-foreground shrink-0">{t.assigned_employees} enrolled</span>
                <span className="text-xs font-medium text-emerald-400 shrink-0">{(t.avg_score ?? 0).toFixed(0)}%</span>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* Top employees */}
      <div className="rounded-xl border border-border bg-card p-4">
        <h3 className="text-sm font-medium mb-3 flex items-center gap-1.5"><Award className="w-4 h-4 text-amber-400" />Top Performers</h3>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-xs text-muted-foreground border-b border-border">
                <th className="text-left py-2 pr-4">Employee</th>
                <th className="text-left py-2 pr-4">Designation</th>
                <th className="text-right py-2 pr-4">Courses</th>
                <th className="text-right py-2 pr-4">Completed</th>
                <th className="text-right py-2">Avg Score</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {topEmp.slice(0, 8).map((e: any) => (
                <tr key={e.employee_id} className="hover:bg-muted/30">
                  <td className="py-2 pr-4 font-medium">{e.name}</td>
                  <td className="py-2 pr-4 text-muted-foreground text-xs">{e.designation}</td>
                  <td className="py-2 pr-4 text-right">{e.total_courses}</td>
                  <td className="py-2 pr-4 text-right text-emerald-400">{e.completed_courses}</td>
                  <td className="py-2 text-right font-medium">{(e.avg_score ?? 0).toFixed(1)}%</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

// ── Trainings ─────────────────────────────────────────────────────────────────

function TrainingsTab({ authHeaders }: { authHeaders: Record<string, string> }) {
  const [trainings, setTrainings] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [expanded, setExpanded] = useState<number | null>(null);

  useEffect(() => {
    fetch("/api/portal/techelevate/trainings?limit=100", { headers: authHeaders })
      .then(r => r.json())
      .then(d => { setTrainings(d.items || []); setLoading(false); });
  }, []);

  if (loading) return <LoadingPane />;

  return (
    <div className="p-6 space-y-3">
      <p className="text-sm text-muted-foreground">{trainings.length} training{trainings.length !== 1 ? "s" : ""}</p>
      {trainings.map((t: any) => (
        <div key={t.id} className="rounded-xl border border-border bg-card overflow-hidden">
          <button className="w-full text-left p-4 flex items-start gap-3 hover:bg-muted/20 transition-colors"
            onClick={() => setExpanded(expanded === t.id ? null : t.id)}>
            {t.uploaded_photo && (
              <img src={`/api${t.uploaded_photo}`} alt="" className="w-12 h-12 rounded-lg object-cover shrink-0" />
            )}
            {!t.uploaded_photo && (
              <div className="w-12 h-12 rounded-lg bg-violet-500/10 flex items-center justify-center shrink-0">
                <BookOpen className="w-5 h-5 text-violet-400" />
              </div>
            )}
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2 flex-wrap">
                <span className="font-medium">{t.title}</span>
                <span className="text-xs px-1.5 py-0.5 rounded bg-muted text-muted-foreground">{t.category}</span>
                {t.has_levels
                  ? <span className="text-xs px-1.5 py-0.5 rounded bg-purple-500/10 text-purple-400">Multi-Level ({t.levels?.length ?? 0})</span>
                  : <span className="text-xs px-1.5 py-0.5 rounded bg-blue-500/10 text-blue-400">Single Level</span>
                }
              </div>
              <p className="text-sm text-muted-foreground mt-1 line-clamp-2">{t.description}</p>
            </div>
            {expanded === t.id ? <ChevronDown className="w-4 h-4 shrink-0 mt-0.5" /> : <ChevronRight className="w-4 h-4 shrink-0 mt-0.5" />}
          </button>

          <AnimatePresence>
            {expanded === t.id && (
              <motion.div initial={{ height: 0 }} animate={{ height: "auto" }} exit={{ height: 0 }}
                className="overflow-hidden border-t border-border">
                <div className="p-4 space-y-3">
                  {(t.levels || []).map((lv: any, idx: number) => (
                    <LevelCard key={lv.id} level={lv} index={idx} />
                  ))}
                </div>
              </motion.div>
            )}
          </AnimatePresence>
        </div>
      ))}
    </div>
  );
}

function LevelCard({ level: lv, index }: { level: any; index: number }) {
  const ytEmbed = youtubeEmbed(lv.video_source_url || lv.video_url || "");
  const isYT = !!(lv.video_source_url || lv.video_url);

  return (
    <div className="rounded-lg border border-border bg-muted/20 p-3 space-y-2">
      <div className="flex items-center gap-2">
        <span className="w-6 h-6 rounded-full bg-violet-500/15 text-violet-400 text-xs font-semibold flex items-center justify-center shrink-0">{index + 1}</span>
        <span className="font-medium text-sm">{lv.level_name}</span>
        {lv.duration_hours > 0 && (
          <span className="text-xs text-muted-foreground flex items-center gap-0.5 ml-auto">
            <Clock className="w-3 h-3" />{lv.duration_hours}h
          </span>
        )}
      </div>
      {lv.description && <p className="text-xs text-muted-foreground pl-8">{lv.description}</p>}

      <div className="pl-8 flex flex-wrap gap-3 text-xs text-muted-foreground">
        {lv.exam_questions_count > 0 && (
          <span className="flex items-center gap-0.5"><Target className="w-3 h-3 text-amber-400" />{lv.exam_questions_count} MCQs · {lv.exam_duration_minutes}m · Pass {lv.pass_percentage}%</span>
        )}
        {lv.max_attempts > 0 && <span>Max {lv.max_attempts} attempts</span>}
      </div>

      {lv.learning_plan_links && (
        <div className="pl-8">
          <a href={lv.learning_plan_links} target="_blank" rel="noreferrer"
            className="inline-flex items-center gap-1 text-xs text-blue-400 hover:underline">
            <Link2 className="w-3 h-3" />Learning Material
          </a>
        </div>
      )}

      {isYT && ytEmbed && (
        <div className="pl-8 mt-1">
          <iframe src={ytEmbed} className="rounded-lg w-full aspect-video max-w-md" allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope" allowFullScreen />
        </div>
      )}
      {isYT && !ytEmbed && (
        <div className="pl-8">
          <a href={lv.video_source_url || lv.video_url} target="_blank" rel="noreferrer"
            className="inline-flex items-center gap-1 text-xs text-rose-400 hover:underline">
            <PlayCircle className="w-3 h-3" />Watch Video
          </a>
        </div>
      )}
    </div>
  );
}

// ── Assignments ───────────────────────────────────────────────────────────────

function AssignmentsTab({ authHeaders }: { authHeaders: Record<string, string> }) {
  const [data, setData] = useState<any>({ total: 0, items: [] });
  const [stats, setStats] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [page, setPage] = useState(0);
  const [statusFilter, setStatusFilter] = useState("");
  const limit = 20;

  const load = useCallback(() => {
    setLoading(true);
    const qs = new URLSearchParams({ skip: String(page * limit), limit: String(limit), sort_by: "user_name", sort_order: "asc" });
    if (statusFilter) qs.set("status", statusFilter);
    Promise.all([
      fetch(`/api/portal/techelevate/assignments?${qs}`, { headers: authHeaders }).then(r => r.json()),
      fetch("/api/portal/techelevate/assignments/stats", { headers: authHeaders }).then(r => r.json()),
    ]).then(([d, s]) => { setData(d); setStats(s); }).finally(() => setLoading(false));
  }, [page, statusFilter]);

  useEffect(() => { load(); }, [load]);

  const statuses = ["", "assigned", "in_progress", "completed", "failed"];

  return (
    <div className="p-6 space-y-4">
      {/* stats row */}
      {stats && (
        <div className="grid grid-cols-4 gap-3">
          <StatCard label="Total" value={stats.total} icon={ClipboardList} accent="bg-zinc-500/10 text-zinc-400" />
          <StatCard label="Assigned" value={stats.pending} icon={CalendarDays} accent="bg-blue-500/10 text-blue-400" />
          <StatCard label="In Progress" value={stats.in_progress} icon={Activity} accent="bg-amber-500/10 text-amber-400" />
          <StatCard label="Completed" value={stats.completed} icon={CheckCircle2} accent="bg-emerald-500/10 text-emerald-400" sub={`Avg ${(stats.average_score ?? 0).toFixed(1)}%`} />
        </div>
      )}

      {/* filters */}
      <div className="flex items-center gap-2 flex-wrap">
        {statuses.map(s => (
          <button key={s} onClick={() => { setStatusFilter(s); setPage(0); }}
            className={cn("px-3 py-1 rounded-full text-xs font-medium border transition-colors",
              statusFilter === s ? "bg-violet-500/15 border-violet-500/40 text-violet-400" : "border-border text-muted-foreground hover:border-foreground/30")}>
            {s === "" ? "All" : statusLabel(s)}
          </button>
        ))}
        <button onClick={load} className="ml-auto p-1.5 rounded-lg hover:bg-muted transition-colors">
          <RefreshCw className={cn("w-4 h-4 text-muted-foreground", loading && "animate-spin")} />
        </button>
      </div>

      {/* table */}
      <div className="rounded-xl border border-border overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-xs text-muted-foreground bg-muted/40 border-b border-border">
                <th className="text-left py-2.5 px-3">Employee</th>
                <th className="text-left py-2.5 px-3">Training</th>
                <th className="text-left py-2.5 px-3">Level</th>
                <th className="text-left py-2.5 px-3">Status</th>
                <th className="text-left py-2.5 px-3">Due</th>
                <th className="text-right py-2.5 px-3">MCQs</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {loading && [...Array(5)].map((_, i) => (
                <tr key={i}><td colSpan={6} className="py-3 px-3"><div className="h-3 bg-muted rounded animate-pulse" /></td></tr>
              ))}
              {!loading && data.items.map((a: any) => (
                <tr key={a.id} className="hover:bg-muted/20 transition-colors">
                  <td className="py-2.5 px-3">
                    <p className="font-medium">{a.user_name}</p>
                    <p className="text-xs text-muted-foreground">{a.user_code} · {a.user_designation}</p>
                  </td>
                  <td className="py-2.5 px-3 max-w-[200px]">
                    <p className="truncate">{a.training_title}</p>
                  </td>
                  <td className="py-2.5 px-3 text-muted-foreground text-xs">{a.current_level_name}</td>
                  <td className="py-2.5 px-3">
                    <span className={cn("text-xs px-1.5 py-0.5 rounded font-medium", statusColor(a.status))}>
                      {statusLabel(a.status)}
                    </span>
                  </td>
                  <td className="py-2.5 px-3 text-xs text-muted-foreground">
                    {a.training_end_date || "—"}
                  </td>
                  <td className="py-2.5 px-3 text-right text-xs">
                    {a.exam_questions_count > 0 ? `${a.exam_questions_count}Q / ${a.exam_duration_minutes}m` : "—"}
                  </td>
                </tr>
              ))}
              {!loading && data.items.length === 0 && (
                <tr><td colSpan={6} className="py-8 text-center text-muted-foreground text-sm">No assignments found</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* pagination */}
      <div className="flex items-center justify-between text-sm text-muted-foreground">
        <span>{data.total} total</span>
        <div className="flex gap-2">
          <button disabled={page === 0} onClick={() => setPage(p => p - 1)}
            className="px-3 py-1 rounded border border-border disabled:opacity-40 hover:bg-muted transition-colors text-xs">Prev</button>
          <span className="px-2 py-1 text-xs">Page {page + 1} / {Math.max(1, Math.ceil(data.total / limit))}</span>
          <button disabled={(page + 1) * limit >= data.total} onClick={() => setPage(p => p + 1)}
            className="px-3 py-1 rounded border border-border disabled:opacity-40 hover:bg-muted transition-colors text-xs">Next</button>
        </div>
      </div>
    </div>
  );
}

// ── Reports ───────────────────────────────────────────────────────────────────

function ReportsTab({ authHeaders }: { authHeaders: Record<string, string> }) {
  const [catPerf, setCatPerf] = useState<any[]>([]);
  const [deptPerf, setDeptPerf] = useState<any[]>([]);
  const [enrollments, setEnrollments] = useState<any[]>([]);
  const [topByTrn, setTopByTrn] = useState<any>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    Promise.all([
      fetch("/api/portal/techelevate/reports/category-performance", { headers: authHeaders }).then(r => r.json()),
      fetch("/api/portal/techelevate/reports/department-performance", { headers: authHeaders }).then(r => r.json()),
      fetch("/api/portal/techelevate/reports/course-enrollments", { headers: authHeaders }).then(r => r.json()),
      fetch("/api/portal/techelevate/reports/top-employees-by-training", { headers: authHeaders }).then(r => r.json()),
    ]).then(([cp, dp, en, tb]) => {
      setCatPerf(cp || []); setDeptPerf(dp || []); setEnrollments(en || []); setTopByTrn(tb);
    }).finally(() => setLoading(false));
  }, []);

  if (loading) return <LoadingPane />;

  return (
    <div className="p-6 space-y-6">
      {/* category performance */}
      <div className="rounded-xl border border-border bg-card p-4">
        <h3 className="text-sm font-medium mb-3 flex items-center gap-1.5"><Tag className="w-4 h-4 text-violet-400" />By Category</h3>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
          {catPerf.map((c: any) => (
            <div key={c.category} className="rounded-lg border border-border p-3 space-y-2">
              <div className="flex items-center justify-between">
                <span className="font-medium text-sm">{c.category}</span>
                <span className="text-xs text-emerald-400 font-semibold">{(c.avg_score ?? 0).toFixed(1)}%</span>
              </div>
              <div className="text-xs text-muted-foreground">{c.total_employees} enrolled · {c.completed_employees} completed</div>
              <div className="h-1.5 rounded-full bg-muted overflow-hidden">
                <div className="h-full rounded-full bg-emerald-500" style={{ width: `${c.completion_rate ?? 0}%` }} />
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* department performance */}
      <div className="rounded-xl border border-border bg-card p-4">
        <h3 className="text-sm font-medium mb-3 flex items-center gap-1.5"><Building2 className="w-4 h-4 text-blue-400" />By Department</h3>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-xs text-muted-foreground border-b border-border">
                <th className="text-left py-2 pr-4">Department</th>
                <th className="text-right py-2 pr-4">Employees</th>
                <th className="text-right py-2 pr-4">Completed</th>
                <th className="text-right py-2 pr-4">Completion %</th>
                <th className="text-right py-2">Avg Score</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {deptPerf.map((d: any) => (
                <tr key={d.department} className="hover:bg-muted/20">
                  <td className="py-2 pr-4 font-medium">{d.department}</td>
                  <td className="py-2 pr-4 text-right">{d.total_employees}</td>
                  <td className="py-2 pr-4 text-right text-emerald-400">{d.completed_employees}</td>
                  <td className="py-2 pr-4 text-right">
                    <div className="flex items-center justify-end gap-2">
                      <div className="w-16 h-1.5 rounded-full bg-muted overflow-hidden">
                        <div className="h-full rounded-full bg-violet-500" style={{ width: `${d.completion_rate ?? 0}%` }} />
                      </div>
                      <span className="text-xs">{(d.completion_rate ?? 0).toFixed(0)}%</span>
                    </div>
                  </td>
                  <td className="py-2 text-right text-xs font-medium">{(d.avg_score ?? 0).toFixed(1)}%</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* course enrollments */}
      <div className="rounded-xl border border-border bg-card p-4">
        <h3 className="text-sm font-medium mb-3 flex items-center gap-1.5"><BookMarked className="w-4 h-4 text-amber-400" />Course Enrollments</h3>
        <div className="space-y-2">
          {enrollments.map((e: any) => (
            <div key={e.course_id} className="flex items-center gap-3">
              <span className="text-sm flex-1 truncate">{e.course_title}</span>
              <span className="text-xs text-muted-foreground shrink-0">{e.enrollments} enrolled</span>
              <span className="text-xs font-medium text-emerald-400 shrink-0 w-10 text-right">{(e.avg_score ?? 0).toFixed(0)}%</span>
              <div className="w-24 h-1.5 rounded-full bg-muted overflow-hidden shrink-0">
                <div className="h-full rounded-full bg-amber-400" style={{ width: `${Math.min(100, e.avg_score ?? 0)}%` }} />
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

// ══════════════════════════════════════════════════════════════════════════════
// EMPLOYEE PORTAL
// ══════════════════════════════════════════════════════════════════════════════

function EmployeePortal({ authHeaders, email }: { authHeaders: Record<string, string>; email: string }) {
  const [assignments, setAssignments] = useState<any[]>([]);
  const [trainings, setTrainings] = useState<Record<number, any>>({});
  const [loading, setLoading] = useState(true);
  const [selected, setSelected] = useState<any>(null);

  useEffect(() => {
    Promise.all([
      fetch(`/api/portal/techelevate/assignments/my`, { headers: authHeaders }).then(r => r.json()),
      fetch("/api/portal/techelevate/trainings?limit=100", { headers: authHeaders }).then(r => r.json()),
    ]).then(([asgn, trn]) => {
      setAssignments(asgn?.items || []);
      const map: Record<number, any> = {};
      (trn?.items || []).forEach((t: any) => { map[t.id] = t; });
      setTrainings(map);
    }).finally(() => setLoading(false));
  }, [email]);

  if (loading) return <LoadingPane />;

  return (
    <div className="flex flex-col h-full overflow-hidden">
      <div className="px-6 pt-5 pb-4 border-b border-border shrink-0 flex items-center gap-2">
        <GraduationCap className="w-5 h-5 text-violet-400" />
        <h1 className="text-lg font-semibold">TechElevate</h1>
        <span className="text-xs px-1.5 py-0.5 rounded bg-blue-500/15 text-blue-400 font-medium">My Trainings</span>
        <span className="text-xs text-muted-foreground ml-auto">{assignments.length} assigned</span>
      </div>

      {selected ? (
        <TrainingDetail
          assignment={selected}
          training={trainings[selected.training_id]}
          authHeaders={authHeaders}
          onBack={() => setSelected(null)}
        />
      ) : (
        <div className="flex-1 overflow-y-auto p-6 space-y-3">
          {assignments.length === 0 && (
            <div className="text-center text-muted-foreground py-16 text-sm">No trainings assigned yet.</div>
          )}
          {assignments.map((a: any) => {
            const t = trainings[a.training_id];
            return (
              <button key={a.id} onClick={() => setSelected(a)}
                className="w-full text-left rounded-xl border border-border bg-card p-4 flex items-center gap-4 hover:border-violet-500/40 hover:bg-muted/20 transition-colors">
                <div className="w-10 h-10 rounded-lg bg-violet-500/10 flex items-center justify-center shrink-0">
                  <BookOpen className="w-5 h-5 text-violet-400" />
                </div>
                <div className="flex-1 min-w-0">
                  <p className="font-medium truncate">{a.training_title}</p>
                  <p className="text-xs text-muted-foreground mt-0.5">{a.current_level_name} level · {t?.category}</p>
                </div>
                <div className="flex items-center gap-2 shrink-0">
                  <span className={cn("text-xs px-2 py-0.5 rounded font-medium", statusColor(a.status))}>
                    {statusLabel(a.status)}
                  </span>
                  {a.training_end_date && (
                    <span className="text-xs text-muted-foreground flex items-center gap-0.5">
                      <CalendarDays className="w-3 h-3" />{a.training_end_date}
                    </span>
                  )}
                  <ChevronRight className="w-4 h-4 text-muted-foreground" />
                </div>
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}

function TrainingDetail({ assignment, training, authHeaders, onBack }: {
  assignment: any; training: any; authHeaders: Record<string, string>; onBack: () => void;
}) {
  const [evaluations, setEvaluations] = useState<any[]>([]);
  const [levelDates, setLevelDates] = useState<Record<string, any>>({});
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    Promise.all([
      fetch(`/api/portal/techelevate/assignments/${assignment.id}/evaluations`, { headers: authHeaders }).then(r => r.json()),
      fetch(`/api/portal/techelevate/assignments/${assignment.id}/level-dates`, { headers: authHeaders }).then(r => r.json()),
    ]).then(([ev, ld]) => {
      setEvaluations(Array.isArray(ev) ? ev : []);
      setLevelDates(ld || {});
    }).finally(() => setLoading(false));
  }, [assignment.id]);

  const levels = training?.levels || [];

  return (
    <div className="flex-1 overflow-y-auto p-6 space-y-5">
      <button onClick={onBack} className="flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground transition-colors">
        <ChevronRight className="w-4 h-4 rotate-180" />Back to My Trainings
      </button>

      <div className="rounded-xl border border-border bg-card p-4">
        <div className="flex items-start gap-3">
          <div className="w-12 h-12 rounded-lg bg-violet-500/10 flex items-center justify-center shrink-0">
            <BookOpen className="w-6 h-6 text-violet-400" />
          </div>
          <div className="flex-1">
            <h2 className="text-base font-semibold">{assignment.training_title}</h2>
            <p className="text-sm text-muted-foreground mt-0.5">{training?.description}</p>
            <div className="flex flex-wrap gap-2 mt-2">
              <span className={cn("text-xs px-2 py-0.5 rounded font-medium", statusColor(assignment.status))}>{statusLabel(assignment.status)}</span>
              <span className="text-xs text-muted-foreground">{assignment.current_level_name} level</span>
              {assignment.training_end_date && <span className="text-xs text-muted-foreground">Due: {assignment.training_end_date}</span>}
              {assignment.assigned_by && <span className="text-xs text-muted-foreground">Assigned by: {assignment.assigner_name}</span>}
            </div>
          </div>
        </div>
      </div>

      {/* exam results */}
      {evaluations.length > 0 && (
        <div className="rounded-xl border border-border bg-card p-4">
          <h3 className="text-sm font-medium mb-3 flex items-center gap-1.5"><Award className="w-4 h-4 text-amber-400" />Exam Results</h3>
          <div className="space-y-2">
            {evaluations.map((ev: any) => (
              <div key={ev.id} className="flex items-center gap-3 p-2 rounded-lg bg-muted/20">
                <div className={cn("w-8 h-8 rounded-full flex items-center justify-center text-xs font-semibold",
                  ev.is_passing_score ? "bg-emerald-500/15 text-emerald-400" : "bg-rose-500/15 text-rose-400")}>
                  {ev.is_passing_score ? <CheckCircle2 className="w-4 h-4" /> : <AlertCircle className="w-4 h-4" />}
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium">{ev.level_name}</p>
                  <p className="text-xs text-muted-foreground">Attempt #{ev.attempt_number} · {new Date(ev.evaluation_date).toLocaleDateString()}</p>
                </div>
                <div className="text-right shrink-0">
                  <p className="text-sm font-semibold">{(ev.percentage_score ?? 0).toFixed(1)}%</p>
                  <p className="text-xs text-muted-foreground">MCQ: {(ev.mcq_score ?? 0).toFixed(0)}%</p>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* levels */}
      <div className="space-y-3">
        <h3 className="text-sm font-medium flex items-center gap-1.5"><ListChecks className="w-4 h-4 text-violet-400" />Learning Levels</h3>
        {loading && <LoadingPane />}
        {!loading && levels.map((lv: any, idx: number) => {
          const dates = levelDates[String(lv.id)] || {};
          const isActive = lv.level_name === assignment.current_level_name;
          const evalForLevel = evaluations.find((e: any) => e.training_level_id === lv.id);

          return (
            <div key={lv.id} className={cn("rounded-xl border p-4 space-y-3", isActive ? "border-violet-500/40 bg-violet-500/5" : "border-border bg-card")}>
              <div className="flex items-center gap-2">
                <span className={cn("w-7 h-7 rounded-full flex items-center justify-center text-xs font-semibold shrink-0",
                  evalForLevel?.is_passing_score ? "bg-emerald-500/15 text-emerald-400"
                  : isActive ? "bg-violet-500/20 text-violet-400"
                  : "bg-muted text-muted-foreground")}>
                  {evalForLevel?.is_passing_score ? <CheckCircle2 className="w-3.5 h-3.5" /> : idx + 1}
                </span>
                <span className="font-medium">{lv.level_name}</span>
                {isActive && <span className="text-xs px-1.5 py-0.5 rounded bg-violet-500/15 text-violet-400 ml-1">Current</span>}
                {evalForLevel?.is_passing_score && <span className="text-xs px-1.5 py-0.5 rounded bg-emerald-500/15 text-emerald-400 ml-1">Passed · {(evalForLevel.percentage_score ?? 0).toFixed(0)}%</span>}
                {dates.due_date && (
                  <span className="ml-auto text-xs text-muted-foreground flex items-center gap-0.5">
                    <CalendarDays className="w-3 h-3" />Due {new Date(dates.due_date).toLocaleDateString()}
                  </span>
                )}
              </div>

              {lv.description && <p className="text-xs text-muted-foreground pl-9">{lv.description}</p>}

              {lv.learning_objectives && (
                <div className="pl-9">
                  <p className="text-xs font-medium text-muted-foreground mb-0.5">Learning Objectives</p>
                  <p className="text-xs text-muted-foreground">{lv.learning_objectives}</p>
                </div>
              )}

              <div className="pl-9 flex flex-wrap gap-4">
                {lv.learning_plan_links && (
                  <a href={lv.learning_plan_links} target="_blank" rel="noreferrer"
                    className="inline-flex items-center gap-1.5 text-xs font-medium text-blue-400 hover:underline">
                    <ExternalLink className="w-3.5 h-3.5" />Study Material
                  </a>
                )}
                {(lv.video_source_url || lv.video_url) && !youtubeEmbed(lv.video_source_url || lv.video_url) && (
                  <a href={lv.video_source_url || lv.video_url} target="_blank" rel="noreferrer"
                    className="inline-flex items-center gap-1.5 text-xs font-medium text-rose-400 hover:underline">
                    <PlayCircle className="w-3.5 h-3.5" />Watch Video
                  </a>
                )}
              </div>

              {(lv.video_source_url || lv.video_url) && youtubeEmbed(lv.video_source_url || lv.video_url) && (
                <div className="pl-9">
                  <iframe
                    src={youtubeEmbed(lv.video_source_url || lv.video_url)!}
                    className="rounded-lg w-full aspect-video max-w-lg"
                    allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope"
                    allowFullScreen
                  />
                </div>
              )}

              {lv.exam_questions_count > 0 && (
                <div className="pl-9 mt-1">
                  <div className="inline-flex items-center gap-2 px-3 py-1.5 rounded-lg border border-amber-500/20 bg-amber-500/5 text-amber-400 text-xs">
                    <Target className="w-3.5 h-3.5" />
                    <span>{lv.exam_questions_count} MCQ Exam · {lv.exam_duration_minutes} min · Pass {lv.pass_percentage}%</span>
                    {lv.max_attempts > 0 && <span className="text-amber-400/60">· {lv.max_attempts} attempts</span>}
                  </div>
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ── shared ────────────────────────────────────────────────────────────────────

function LoadingPane() {
  return (
    <div className="flex h-32 items-center justify-center gap-2 text-muted-foreground">
      <Loader2 className="w-4 h-4 animate-spin" /><span className="text-sm">Loading…</span>
    </div>
  );
}
