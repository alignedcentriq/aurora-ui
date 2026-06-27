import { useAuth } from "@/lib/auth-store";
import { useState, useEffect, useCallback } from "react";
import { motion } from "framer-motion";
import {
  BookOpen,
  Search,
  Loader2,
  RefreshCw,
  Star,
  Clock,
  BarChart2,
  ExternalLink,
  GraduationCap,
  AlertCircle,
  Users,
  TrendingUp,
  Zap,
  CheckCircle2,
  Activity,
} from "lucide-react";
import { cn } from "@/lib/utils";

type Tab = "catalog" | "activity" | "course-activity";

interface Course {
  id: number;
  title: string;
  url: string;
  headline?: string;
  image?: string;
  num_lectures?: number;
  content_info?: string;
  level?: string;
  instructors?: string[];
  category?: string;
  subcategory?: string;
  rating?: number;
  num_subscribers?: number;
}

const levelColor = (level?: string) => {
  const l = (level || "").toLowerCase();
  if (l.includes("all levels")) return "bg-white/25 text-white";
  if (l.includes("beginner")) return "bg-emerald-500/20 text-emerald-100";
  if (l.includes("intermediate")) return "bg-blue-500/20 text-blue-100";
  if (l.includes("expert") || l.includes("advanced")) return "bg-violet-500/20 text-violet-100";
  return "bg-white/15 text-white/80";
};

function CourseCard({ c, index }: { c: Course; index: number }) {
  return (
    <motion.a
      href={c.url}
      target="_blank"
      rel="noreferrer"
      initial={{ opacity: 0, y: 16 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.22, delay: Math.min(index * 0.025, 0.5) }}
      whileHover={{ y: -3 }}
      className="group flex flex-col rounded-2xl border border-border bg-card overflow-hidden hover:border-violet-400/50 hover:shadow-xl hover:shadow-violet-500/[0.08] transition-shadow"
    >
      <div className="aspect-video bg-muted overflow-hidden relative">
        {c.image ? (
          <img
            src={c.image}
            alt={c.title}
            className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-300"
            loading="lazy"
          />
        ) : (
          <div className="w-full h-full flex items-center justify-center bg-gradient-to-br from-violet-500/10 to-purple-600/10">
            <BookOpen className="w-10 h-10 text-violet-400/40" />
          </div>
        )}
        <div className="absolute inset-0 bg-gradient-to-t from-black/40 via-transparent to-transparent opacity-0 group-hover:opacity-100 transition-opacity" />
        <div className="absolute bottom-2 right-2 opacity-0 group-hover:opacity-100 transition-opacity">
          <div className="bg-white/90 dark:bg-zinc-900/90 backdrop-blur-sm rounded-lg p-1.5 shadow">
            <ExternalLink className="w-3.5 h-3.5 text-violet-600" />
          </div>
        </div>
        {c.level && (
          <div
            className={cn(
              "absolute top-2 left-2 text-[10px] font-bold px-2 py-0.5 rounded-md backdrop-blur-sm",
              levelColor(c.level),
            )}
          >
            {c.level}
          </div>
        )}
      </div>
      <div className="p-3.5 flex flex-col gap-1.5 flex-1">
        <p className="text-sm font-semibold leading-tight line-clamp-2 group-hover:text-violet-600 dark:group-hover:text-violet-400 transition-colors">
          {c.title}
        </p>
        {c.headline && (
          <p className="text-xs text-muted-foreground line-clamp-2 leading-relaxed">{c.headline}</p>
        )}
        {c.instructors?.length ? (
          <p className="text-[11px] text-muted-foreground truncate font-medium">
            {c.instructors.join(", ")}
          </p>
        ) : null}
        <div className="mt-auto flex flex-wrap items-center gap-x-3 gap-y-1 pt-2 border-t border-border/60">
          {c.rating ? (
            <span className="inline-flex items-center gap-1 text-amber-500 font-bold text-[11px]">
              <Star className="w-3 h-3 fill-current" />
              {Number(c.rating).toFixed(1)}
            </span>
          ) : null}
          {c.content_info && (
            <span className="inline-flex items-center gap-1 text-[11px] text-muted-foreground">
              <Clock className="w-3 h-3" />
              {c.content_info}
            </span>
          )}
        </div>
      </div>
    </motion.a>
  );
}

export function UdemyBusinessPortal() {
  const { user } = useAuth();
  const [tab, setTab] = useState<Tab>("catalog");
  const [status, setStatus] = useState<{ configured: boolean; can_view_reports: boolean } | null>(
    null,
  );
  const [query, setQuery] = useState("");
  const [courses, setCourses] = useState<Course[]>([]);
  const [count, setCount] = useState(0);
  const [indexing, setIndexing] = useState(false);
  const [searched, setSearched] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const authHeaders = {
    "Content-Type": "application/json",
    ...(user?.email ? { "x-user-email": user.email } : {}),
    ...(user?.role ? { "x-user-role": user.role.toLowerCase() } : {}),
  };

  const loadCourses = useCallback(
    async (q: string) => {
      setLoading(true);
      setError("");
      setSearched(!!q);
      try {
        const resp = await fetch(
          `/api/portal/udemy/courses?q=${encodeURIComponent(q)}&page_size=24`,
          { headers: authHeaders },
        );
        if (resp.status === 503) {
          const body = await resp.json().catch(() => ({}));
          setError(body.detail || "Udemy Business isn't connected yet.");
          setCourses([]);
          return;
        }
        if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
        const data = await resp.json();
        setCourses(data.results || []);
        setCount(data.count || 0);
        setIndexing(!!data.indexing);
      } catch (e: any) {
        setError("Couldn't load the Udemy Business catalog. Please try again.");
        setCourses([]);
      } finally {
        setLoading(false);
      }
      // eslint-disable-next-line react-hooks/exhaustive-deps
    },
    [user?.email, user?.role],
  );

  useEffect(() => {
    fetch("/api/portal/udemy/status", { headers: authHeaders })
      .then((r) => r.json())
      .then(setStatus)
      .catch(() => setStatus({ configured: false, can_view_reports: false }));
    loadCourses("");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loadCourses]);

  const onSearch = (e: React.FormEvent) => {
    e.preventDefault();
    loadCourses(query.trim());
  };

  return (
    <div className="flex-1 h-full overflow-y-auto bg-[#f5f7fa] dark:bg-background">
      {/* Hero banner */}
      <div className="relative overflow-hidden bg-gradient-to-br from-violet-700 via-purple-700 to-violet-800 px-6 py-7">
        <div
          className="absolute inset-0 opacity-[0.06]"
          style={{
            backgroundImage:
              "radial-gradient(circle, white 1px, transparent 1px)",
            backgroundSize: "28px 28px",
          }}
        />
        <div className="relative flex items-start justify-between gap-3">
          <div className="min-w-0">
            <div className="flex items-center gap-2 mb-2">
              <div className="p-1.5 rounded-lg bg-white/20 backdrop-blur-sm shrink-0">
                <GraduationCap className="w-4 h-4 text-white" />
              </div>
              <span className="text-[10px] font-extrabold uppercase tracking-[0.2em] text-white/60">
                Learning Platform
              </span>
            </div>
            <h1 className="text-[22px] sm:text-[26px] font-black text-white tracking-tight leading-tight">
              Udemy Business
            </h1>
            <p className="text-sm text-white/65 mt-1.5 leading-relaxed">
              Browse the company learning catalog and track learner progress.
            </p>
          </div>
          {count > 0 && (
            <div className="hidden sm:block shrink-0 bg-white/15 backdrop-blur-sm border border-white/20 rounded-2xl px-5 py-3 text-center">
              <div className="text-[28px] font-black text-white leading-none">
                {count.toLocaleString()}
              </div>
              <div className="text-[10px] text-white/60 font-semibold uppercase tracking-widest mt-1">
                Courses
              </div>
            </div>
          )}
        </div>
      </div>

      <div className="p-4 sm:p-6">
        {/* Pill tabs */}
        <div className="flex items-center gap-1 mb-5 bg-muted/70 p-1 rounded-xl w-fit flex-wrap">
          <button
            onClick={() => setTab("catalog")}
            className={cn(
              "px-4 py-1.5 rounded-lg text-sm font-semibold transition-all inline-flex items-center gap-1.5",
              tab === "catalog"
                ? "bg-white dark:bg-zinc-800 text-foreground shadow-sm"
                : "text-muted-foreground hover:text-foreground",
            )}
          >
            <BookOpen className="w-3.5 h-3.5" />
            Catalog
          </button>
          {status?.can_view_reports && (
            <button
              onClick={() => setTab("activity")}
              className={cn(
                "px-4 py-1.5 rounded-lg text-sm font-semibold transition-all inline-flex items-center gap-1.5",
                tab === "activity"
                  ? "bg-white dark:bg-zinc-800 text-foreground shadow-sm"
                  : "text-muted-foreground hover:text-foreground",
              )}
            >
              <BarChart2 className="w-3.5 h-3.5" />
              Learner Activity
            </button>
          )}
          {status?.can_view_reports && (
            <button
              onClick={() => setTab("course-activity")}
              className={cn(
                "px-4 py-1.5 rounded-lg text-sm font-semibold transition-all inline-flex items-center gap-1.5",
                tab === "course-activity"
                  ? "bg-white dark:bg-zinc-800 text-foreground shadow-sm"
                  : "text-muted-foreground hover:text-foreground",
              )}
            >
              <Activity className="w-3.5 h-3.5" />
              Course Activity
            </button>
          )}
        </div>

        {tab === "course-activity" ? (
          <CourseActivityTab authHeaders={authHeaders} />
        ) : tab === "catalog" ? (
          <>
            {/* Search bar */}
            <form onSubmit={onSearch} className="flex gap-2 mb-5 max-w-2xl">
              <div className="relative flex-1">
                <Search className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
                <input
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  placeholder="Search courses (e.g. React, AWS, Power BI)…"
                  className="w-full pl-10 pr-3 py-2.5 rounded-xl border border-border bg-white dark:bg-zinc-900 text-sm shadow-sm focus:outline-none focus:ring-2 focus:ring-violet-500/40 focus:border-violet-400/60 transition-all"
                />
              </div>
              <button
                type="submit"
                className="px-5 py-2.5 rounded-xl bg-gradient-to-r from-violet-600 to-purple-600 text-white text-sm font-semibold hover:from-violet-700 hover:to-purple-700 shadow-sm inline-flex items-center gap-1.5 transition-all"
              >
                <Search className="w-4 h-4" />
                Search
              </button>
            </form>

            {error ? (
              <div className="flex items-start gap-3 rounded-2xl border border-amber-500/30 bg-amber-500/5 p-4 text-sm text-amber-700 dark:text-amber-400 max-w-xl">
                <AlertCircle className="w-4 h-4 mt-0.5 shrink-0" />
                <span>{error}</span>
              </div>
            ) : loading ? (
              <div className="flex flex-col items-center justify-center py-20 text-muted-foreground gap-3">
                <div className="w-12 h-12 rounded-2xl bg-violet-500/10 flex items-center justify-center">
                  <Loader2 className="w-6 h-6 animate-spin text-violet-500" />
                </div>
                <span className="text-sm">Loading courses…</span>
              </div>
            ) : courses.length === 0 && searched && indexing ? (
              <div className="flex flex-col items-center justify-center gap-3 py-20 text-muted-foreground text-sm text-center">
                <Loader2 className="w-6 h-6 animate-spin text-violet-400" />
                <p className="max-w-sm leading-relaxed">
                  Building the course search index for the first time — a one-time, few-minute job.
                  Re-run your search in a moment.
                </p>
              </div>
            ) : courses.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-20 text-muted-foreground gap-3">
                <div className="w-14 h-14 rounded-3xl bg-violet-500/10 flex items-center justify-center">
                  <BookOpen className="w-7 h-7 text-violet-400/50" />
                </div>
                <p className="text-sm">No courses found{searched ? ` for "${query}"` : ""}.</p>
              </div>
            ) : (
              <>
                <p className="text-xs text-muted-foreground mb-4">
                  <span className="font-semibold text-foreground">{count.toLocaleString()}</span>{" "}
                  course{count === 1 ? "" : "s"}
                  {query ? ` matching "${query}"` : " in the catalog"} · showing {courses.length}
                </p>
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
                  {courses.map((c, i) => (
                    <CourseCard key={c.id} c={c} index={i} />
                  ))}
                </div>
              </>
            )}
          </>
        ) : (
          <ActivityTab authHeaders={authHeaders} />
        )}
      </div>
    </div>
  );
}

function CourseActivityTab({ authHeaders }: { authHeaders: Record<string, string> }) {
  const [rows, setRows] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [syncing, setSyncing] = useState(false);
  const [syncResult, setSyncResult] = useState<{ added: number; skipped: number; errors: number } | null>(null);

  const load = useCallback(() => {
    setLoading(true);
    setError("");
    fetch("/api/portal/udemy/analytics/user-course-activity?page_size=100", { headers: authHeaders })
      .then(async (r) => {
        if (!r.ok) {
          const b = await r.json().catch(() => ({}));
          throw new Error(b.detail || `HTTP ${r.status}`);
        }
        return r.json();
      })
      .then((data) => setRows(data.results || []))
      .catch((e) => setError(e.message || "Couldn't load course activity."))
      .finally(() => setLoading(false));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const syncSkills = useCallback(async () => {
    setSyncing(true);
    setSyncResult(null);
    try {
      const r = await fetch("/api/portal/udemy/analytics/sync-skills", {
        method: "POST",
        headers: authHeaders,
      });
      const body = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(body.detail || `HTTP ${r.status}`);
      setSyncResult(body);
    } catch (e: any) {
      setError(e.message || "Skill sync failed.");
    } finally {
      setSyncing(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const completedRows = rows.filter((r) => {
    const pct = Number(r.completion_percentage ?? r.percent_completed ?? r.progress_percent ?? 0);
    return pct >= 100 || r.completion_time || r.completion_date || r.completed_at;
  });

  if (loading) {
    return (
      <div className="flex flex-col items-center justify-center py-20 text-muted-foreground gap-3">
        <div className="w-12 h-12 rounded-2xl bg-violet-500/10 flex items-center justify-center">
          <Loader2 className="w-6 h-6 animate-spin text-violet-500" />
        </div>
        <span className="text-sm">Loading course activity…</span>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div className="flex items-center gap-2.5">
          <div className="h-8 w-8 rounded-xl bg-violet-500/10 flex items-center justify-center">
            <Activity className="w-4 h-4 text-violet-500" />
          </div>
          <div>
            <p className="text-sm font-semibold">Course Activity</p>
            <p className="text-xs text-muted-foreground">
              {rows.length} record(s) · {completedRows.length} completed
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={load}
            className="inline-flex items-center gap-1.5 text-xs font-medium text-muted-foreground hover:text-foreground bg-white dark:bg-zinc-900 border border-border px-3 py-1.5 rounded-lg transition-colors shadow-sm"
          >
            <RefreshCw className="w-3.5 h-3.5" />
            Refresh
          </button>
          <button
            onClick={syncSkills}
            disabled={syncing}
            className="inline-flex items-center gap-1.5 text-xs font-semibold text-white bg-gradient-to-r from-violet-600 to-purple-600 hover:from-violet-700 hover:to-purple-700 disabled:opacity-60 px-3 py-1.5 rounded-lg transition-all shadow-sm"
          >
            {syncing ? (
              <Loader2 className="w-3.5 h-3.5 animate-spin" />
            ) : (
              <Zap className="w-3.5 h-3.5" />
            )}
            {syncing ? "Syncing…" : "Sync to Skills"}
          </button>
        </div>
      </div>

      {syncResult && (
        <div className="flex items-start gap-3 rounded-2xl border border-emerald-500/30 bg-emerald-500/5 p-4 text-sm text-emerald-700 dark:text-emerald-400">
          <CheckCircle2 className="w-4 h-4 mt-0.5 shrink-0" />
          <span>
            Skill sync complete — <strong>{syncResult.added}</strong> new skill(s) added,{" "}
            <strong>{syncResult.skipped}</strong> skipped (already present or no employee match
            {syncResult.errors > 0 && `, ${syncResult.errors} error(s)`}).
          </span>
        </div>
      )}

      {error && (
        <div className="flex items-start gap-3 rounded-2xl border border-amber-500/30 bg-amber-500/5 p-4 text-sm text-amber-700 dark:text-amber-400 max-w-xl">
          <AlertCircle className="w-4 h-4 mt-0.5 shrink-0" />
          <span>{error}</span>
        </div>
      )}

      {!error && rows.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-20 text-muted-foreground gap-3">
          <div className="w-14 h-14 rounded-3xl bg-violet-500/10 flex items-center justify-center">
            <Activity className="w-7 h-7 text-violet-400/50" />
          </div>
          <p className="text-sm">No course activity data yet.</p>
        </div>
      ) : rows.length > 0 ? (
        <div className="overflow-x-auto rounded-2xl border border-border shadow-sm">
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-gradient-to-r from-violet-500/5 to-purple-500/5 border-b border-border">
                {Object.keys(rows[0]).map((c) => (
                  <th
                    key={c}
                    className="text-left px-4 py-3 font-semibold text-foreground/80 whitespace-nowrap text-xs uppercase tracking-wide"
                  >
                    {c.replace(/_/g, " ").replace(/\b\w/g, (l) => l.toUpperCase())}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((r, i) => (
                <tr
                  key={i}
                  className={cn(
                    "border-t border-border hover:bg-muted/40 transition-colors",
                    i % 2 === 1 && "bg-muted/20",
                  )}
                >
                  {Object.keys(rows[0]).map((c) => {
                    const val = r[c];
                    const pct = c.toLowerCase().includes("percent") || c.toLowerCase().includes("percentage");
                    return (
                      <td key={c} className="px-4 py-2.5 whitespace-nowrap text-sm">
                        {pct && val != null ? (
                          <span
                            className={cn(
                              "inline-flex items-center gap-1 font-semibold",
                              Number(val) >= 100
                                ? "text-emerald-600 dark:text-emerald-400"
                                : Number(val) >= 50
                                  ? "text-amber-600 dark:text-amber-400"
                                  : "text-muted-foreground",
                            )}
                          >
                            {Number(val) >= 100 && <CheckCircle2 className="w-3.5 h-3.5" />}
                            {Number(val).toFixed(0)}%
                          </span>
                        ) : (
                          String(val ?? "")
                        )}
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : null}
    </div>
  );
}

function ActivityTab({ authHeaders }: { authHeaders: Record<string, string> }) {
  const [rows, setRows] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const load = useCallback(() => {
    setLoading(true);
    setError("");
    fetch("/api/portal/udemy/analytics/user-activity?page_size=100", { headers: authHeaders })
      .then(async (r) => {
        if (!r.ok) {
          const b = await r.json().catch(() => ({}));
          throw new Error(b.detail || `HTTP ${r.status}`);
        }
        return r.json();
      })
      .then((data) => setRows(data.results || []))
      .catch((e) => setError(e.message || "Couldn't load learner activity."))
      .finally(() => setLoading(false));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  if (loading) {
    return (
      <div className="flex flex-col items-center justify-center py-20 text-muted-foreground gap-3">
        <div className="w-12 h-12 rounded-2xl bg-violet-500/10 flex items-center justify-center">
          <Loader2 className="w-6 h-6 animate-spin text-violet-500" />
        </div>
        <span className="text-sm">Loading activity…</span>
      </div>
    );
  }
  if (error) {
    return (
      <div className="flex items-start gap-3 rounded-2xl border border-amber-500/30 bg-amber-500/5 p-4 text-sm text-amber-700 dark:text-amber-400 max-w-xl">
        <AlertCircle className="w-4 h-4 mt-0.5 shrink-0" />
        <span>{error}</span>
      </div>
    );
  }
  if (!rows.length) {
    return (
      <div className="flex flex-col items-center justify-center py-20 text-muted-foreground gap-3">
        <div className="w-14 h-14 rounded-3xl bg-violet-500/10 flex items-center justify-center">
          <Users className="w-7 h-7 text-violet-400/50" />
        </div>
        <p className="text-sm">No learner activity reported yet.</p>
      </div>
    );
  }

  const cols = Object.keys(rows[0]);
  const fmtHeader = (c: string) =>
    c
      .replace(/_/g, " ")
      .replace(/\b\w/g, (l) => l.toUpperCase());

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2.5">
          <div className="h-8 w-8 rounded-xl bg-violet-500/10 flex items-center justify-center">
            <TrendingUp className="w-4 h-4 text-violet-500" />
          </div>
          <div>
            <p className="text-sm font-semibold">Learner Activity</p>
            <p className="text-xs text-muted-foreground">{rows.length} record(s)</p>
          </div>
        </div>
        <button
          onClick={load}
          className="inline-flex items-center gap-1.5 text-xs font-medium text-muted-foreground hover:text-foreground bg-white dark:bg-zinc-900 border border-border px-3 py-1.5 rounded-lg transition-colors shadow-sm"
        >
          <RefreshCw className="w-3.5 h-3.5" />
          Refresh
        </button>
      </div>
      <div className="overflow-x-auto rounded-2xl border border-border shadow-sm">
        <table className="w-full text-sm">
          <thead>
            <tr className="bg-gradient-to-r from-violet-500/5 to-purple-500/5 border-b border-border">
              {cols.map((c) => (
                <th
                  key={c}
                  className="text-left px-4 py-3 font-semibold text-foreground/80 whitespace-nowrap text-xs uppercase tracking-wide"
                >
                  {fmtHeader(c)}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((r, i) => (
              <tr
                key={i}
                className={cn(
                  "border-t border-border hover:bg-muted/40 transition-colors",
                  i % 2 === 1 && "bg-muted/20",
                )}
              >
                {cols.map((c) => (
                  <td key={c} className="px-4 py-2.5 whitespace-nowrap text-sm">
                    {String(r[c] ?? "")}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
