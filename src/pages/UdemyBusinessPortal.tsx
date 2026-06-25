import { useAuth } from "@/lib/auth-store";
import { useState, useEffect, useCallback } from "react";
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
} from "lucide-react";
import { cn } from "@/lib/utils";

type Tab = "catalog" | "activity";

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

function CourseCard({ c }: { c: Course }) {
  return (
    <a
      href={c.url}
      target="_blank"
      rel="noreferrer"
      className="group flex flex-col rounded-xl border border-border bg-card overflow-hidden hover:border-primary/50 hover:shadow-lg transition-all"
    >
      <div className="aspect-video bg-muted overflow-hidden relative">
        {c.image ? (
          <img src={c.image} alt={c.title} className="w-full h-full object-cover" loading="lazy" />
        ) : (
          <div className="w-full h-full flex items-center justify-center text-muted-foreground">
            <BookOpen className="w-8 h-8" />
          </div>
        )}
        <div className="absolute inset-0 bg-black/0 group-hover:bg-black/10 transition-colors flex items-center justify-center">
          <ExternalLink className="w-5 h-5 text-white opacity-0 group-hover:opacity-90 transition-opacity" />
        </div>
      </div>
      <div className="p-3 flex flex-col gap-1.5 flex-1">
        <p className="text-sm font-semibold leading-tight line-clamp-2">{c.title}</p>
        {c.headline && <p className="text-xs text-muted-foreground line-clamp-2">{c.headline}</p>}
        {c.instructors?.length ? (
          <p className="text-[11px] text-muted-foreground truncate">{c.instructors.join(", ")}</p>
        ) : null}
        <div className="mt-auto flex flex-wrap items-center gap-x-3 gap-y-1 pt-1 text-[11px] text-muted-foreground">
          {c.rating ? (
            <span className="inline-flex items-center gap-0.5 text-amber-500">
              <Star className="w-3 h-3 fill-current" /> {Number(c.rating).toFixed(1)}
            </span>
          ) : null}
          {c.content_info && (
            <span className="inline-flex items-center gap-0.5">
              <Clock className="w-3 h-3" /> {c.content_info}
            </span>
          )}
          {c.level && <span className="px-1.5 py-0.5 rounded bg-muted">{c.level}</span>}
        </div>
      </div>
    </a>
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
          {
            headers: authHeaders,
          },
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
    <div className="flex-1 h-full overflow-y-auto bg-[#f5f7fa] dark:bg-background p-4 sm:p-6">
      {/* Header */}
      <div className="flex items-center gap-3 mb-5">
        <div className="p-2 rounded-lg bg-violet-500/10 text-violet-500">
          <GraduationCap className="w-5 h-5" />
        </div>
        <div>
          <h1 className="text-lg font-bold leading-tight">Udemy Business</h1>
          <p className="text-xs text-muted-foreground">
            Browse the company learning catalog and track learner activity.
          </p>
        </div>
      </div>

      {/* Tabs */}
      <div className="flex items-center gap-1 mb-4 border-b border-border">
        <button
          onClick={() => setTab("catalog")}
          className={cn(
            "px-3 py-2 text-sm font-medium border-b-2 -mb-px transition-colors inline-flex items-center gap-1.5",
            tab === "catalog"
              ? "border-primary text-foreground"
              : "border-transparent text-muted-foreground hover:text-foreground",
          )}
        >
          <BookOpen className="w-4 h-4" /> Catalog
        </button>
        {status?.can_view_reports && (
          <button
            onClick={() => setTab("activity")}
            className={cn(
              "px-3 py-2 text-sm font-medium border-b-2 -mb-px transition-colors inline-flex items-center gap-1.5",
              tab === "activity"
                ? "border-primary text-foreground"
                : "border-transparent text-muted-foreground hover:text-foreground",
            )}
          >
            <BarChart2 className="w-4 h-4" /> Learner Activity
          </button>
        )}
      </div>

      {tab === "catalog" ? (
        <>
          <form onSubmit={onSearch} className="flex gap-2 mb-4 max-w-xl">
            <div className="relative flex-1">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
              <input
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Search courses (e.g. React, AWS, Power BI)…"
                className="w-full pl-9 pr-3 py-2 rounded-lg border border-border bg-card text-sm focus:outline-none focus:ring-2 focus:ring-primary/40"
              />
            </div>
            <button
              type="submit"
              className="px-4 py-2 rounded-lg bg-primary text-primary-foreground text-sm font-medium hover:bg-primary/90 inline-flex items-center gap-1.5"
            >
              <Search className="w-4 h-4" /> Search
            </button>
          </form>

          {error ? (
            <div className="flex items-start gap-2 rounded-xl border border-amber-500/30 bg-amber-500/5 p-4 text-sm text-amber-700 dark:text-amber-400 max-w-xl">
              <AlertCircle className="w-4 h-4 mt-0.5 shrink-0" />
              <span>{error}</span>
            </div>
          ) : loading ? (
            <div className="flex items-center justify-center py-16 text-muted-foreground">
              <Loader2 className="w-5 h-5 animate-spin mr-2" /> Loading courses…
            </div>
          ) : courses.length === 0 && searched && indexing ? (
            <div className="flex flex-col items-center justify-center gap-2 py-16 text-muted-foreground text-sm text-center">
              <Loader2 className="w-5 h-5 animate-spin" />
              <p className="max-w-sm">
                Building the course search index for the first time (a one-time, few-minute job).
                Re-run your search in a moment.
              </p>
            </div>
          ) : courses.length === 0 ? (
            <div className="text-center py-16 text-muted-foreground text-sm">
              No courses found{searched ? ` for “${query}”` : ""}.
            </div>
          ) : (
            <>
              <p className="text-xs text-muted-foreground mb-3">
                {count.toLocaleString()} course{count === 1 ? "" : "s"}
                {query ? ` matching “${query}”` : " in the catalog"} · showing {courses.length}
              </p>
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
                {courses.map((c) => (
                  <CourseCard key={c.id} c={c} />
                ))}
              </div>
            </>
          )}
        </>
      ) : (
        <ActivityTab authHeaders={authHeaders} />
      )}
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
      <div className="flex items-center justify-center py-16 text-muted-foreground">
        <Loader2 className="w-5 h-5 animate-spin mr-2" /> Loading activity…
      </div>
    );
  }
  if (error) {
    return (
      <div className="flex items-start gap-2 rounded-xl border border-amber-500/30 bg-amber-500/5 p-4 text-sm text-amber-700 dark:text-amber-400 max-w-xl">
        <AlertCircle className="w-4 h-4 mt-0.5 shrink-0" />
        <span>{error}</span>
      </div>
    );
  }
  if (!rows.length) {
    return (
      <div className="text-center py-16 text-muted-foreground text-sm inline-flex flex-col items-center w-full gap-2">
        <Users className="w-6 h-6" />
        No learner activity reported yet.
      </div>
    );
  }

  // Render whatever columns the report returns, defensively.
  const cols = Object.keys(rows[0]);
  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center justify-between">
        <p className="text-xs text-muted-foreground">{rows.length} learner record(s)</p>
        <button
          onClick={load}
          className="text-xs inline-flex items-center gap-1 text-muted-foreground hover:text-foreground"
        >
          <RefreshCw className="w-3 h-3" /> Refresh
        </button>
      </div>
      <div className="overflow-x-auto rounded-xl border border-border">
        <table className="w-full text-sm">
          <thead className="bg-muted/50">
            <tr>
              {cols.map((c) => (
                <th
                  key={c}
                  className="text-left px-3 py-2 font-medium text-muted-foreground whitespace-nowrap"
                >
                  {c.replace(/_/g, " ")}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((r, i) => (
              <tr key={i} className="border-t border-border">
                {cols.map((c) => (
                  <td key={c} className="px-3 py-2 whitespace-nowrap">
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
