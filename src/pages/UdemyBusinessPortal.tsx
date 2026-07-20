import { useAuth } from "@/lib/auth-store";
import { useState, useEffect, useCallback } from "react";
import { motion, AnimatePresence } from "framer-motion";
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
  UserMinus,
  Pencil,
  ShieldOff,
  User,
  Bell,
  Plus,
  Trash2,
  Play,
  Power,
  Send,
  Filter,
  Download,
  Mail,
  X,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { TableEmpty } from "@/components/ui/TableEmpty";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell } from "@/components/ui/table";
import { useUdemyAutomations } from "@/lib/udemy-automations-store";

type Tab = "catalog" | "insights" | "activity" | "course-activity" | "inactive" | "automations";

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
  if (l.includes("all levels")) return "bg-white/20 text-white border border-white/10";
  if (l.includes("beginner")) return "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border border-emerald-500/20";
  if (l.includes("intermediate")) return "bg-blue-500/10 text-blue-600 dark:text-blue-400 border border-blue-500/20";
  if (l.includes("expert") || l.includes("advanced")) return "bg-violet-500/10 text-violet-600 dark:text-violet-400 border border-violet-500/20";
  return "bg-slate-500/10 text-slate-600 dark:text-slate-400 border border-slate-500/20";
};

function UserAvatar({ name, email }: { name: string; email: string }) {
  const initials = name
    ? name
        .split(" ")
        .map((n) => n[0])
        .slice(0, 2)
        .join("")
        .toUpperCase()
    : email
      ? email[0].toUpperCase()
      : "U";

  // Hash string to map to a colorful gradient
  const hashStr = email || name || "Udemy";
  let hash = 0;
  for (let i = 0; i < hashStr.length; i++) {
    hash = hashStr.charCodeAt(i) + ((hash << 5) - hash);
  }
  const gradients = [
    "from-[#A435F0] to-[#7C3AED]",
    "from-[#EC4899] to-[#F43F5E]",
    "from-[#3B82F6] to-[#06B6D4]",
    "from-[#10B981] to-[#14B8A6]",
    "from-[#F59E0B] to-[#EF4444]",
    "from-[#8B5CF6] to-[#EC4899]",
  ];
  const gradient = gradients[Math.abs(hash) % gradients.length];

  return (
    <div
      className={cn(
        "w-9 h-9 rounded-full bg-gradient-to-br text-white flex items-center justify-center text-xs font-black shadow-md border border-white/10 shrink-0",
        gradient
      )}
    >
      {initials}
    </div>
  );
}

function CourseCard({ c, index }: { c: Course; index: number }) {
  return (
    <motion.a
      href={c.url}
      target="_blank"
      rel="noreferrer"
      initial={{ opacity: 0, y: 16 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.22, delay: Math.min(index * 0.025, 0.5) }}
      whileHover={{ y: -5, scale: 1.01 }}
      className="group flex flex-col rounded-2xl border border-slate-200 dark:border-zinc-800/80 bg-white/70 dark:bg-zinc-900/60 backdrop-blur-sm overflow-hidden hover:border-[#A435F0]/40 dark:hover:border-[#A435F0]/50 hover:shadow-xl hover:shadow-purple-500/[0.06] transition-all duration-300 animate-fade-in"
    >
      <div className="aspect-video bg-slate-100 dark:bg-zinc-800 overflow-hidden relative">
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
        <div className="absolute bottom-2.5 right-2.5 opacity-0 group-hover:opacity-100 transition-opacity duration-200">
          <div className="bg-white/90 dark:bg-zinc-900/90 backdrop-blur-sm rounded-xl p-2 shadow-lg border border-slate-100 dark:border-zinc-800/50">
            <ExternalLink className="w-3.5 h-3.5 text-[#A435F0]" />
          </div>
        </div>
        {c.level && (
          <div
            className={cn(
              "absolute top-2.5 left-2.5 text-[10px] font-extrabold px-2.5 py-1 rounded-lg backdrop-blur-md shadow-sm",
              levelColor(c.level)
            )}
          >
            {c.level}
          </div>
        )}
      </div>
      <div className="p-4 flex flex-col gap-2 flex-1">
        <p className="text-sm font-bold leading-snug line-clamp-2 text-slate-800 dark:text-zinc-100 group-hover:text-[#A435F0] dark:group-hover:text-[#C084FC] transition-colors">
          {c.title}
        </p>
        {c.headline && (
          <p className="text-xs text-slate-500 dark:text-zinc-400 line-clamp-2 leading-relaxed">{c.headline}</p>
        )}
        {c.instructors?.length ? (
          <p className="text-[11px] text-slate-400 dark:text-zinc-500 truncate font-semibold">
            By {c.instructors.join(", ")}
          </p>
        ) : null}
        <div className="mt-auto flex flex-wrap items-center gap-x-3 gap-y-1 pt-3 border-t border-slate-100 dark:border-zinc-800/50">
          {c.rating ? (
            <span className="inline-flex items-center gap-1 text-amber-500 font-extrabold text-xs">
              <Star className="w-3.5 h-3.5 fill-current" />
              {Number(c.rating).toFixed(1)}
            </span>
          ) : null}
          {c.content_info && (
            <span className="inline-flex items-center gap-1 text-xs text-slate-400 dark:text-zinc-500 font-medium">
              <Clock className="w-3.5 h-3.5" />
              {c.content_info}
            </span>
          )}
        </div>
      </div>
    </motion.a>
  );
}

function CourseGridSkeleton() {
  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4 mt-4 animate-pulse">
      {Array.from({ length: 8 }).map((_, i) => (
        <div
          key={i}
          className="flex flex-col rounded-2xl border border-slate-200 dark:border-zinc-800/80 bg-white/70 dark:bg-zinc-900/60 overflow-hidden shadow-sm"
        >
          <div className="aspect-video bg-slate-200 dark:bg-zinc-850" />
          <div className="p-4 flex flex-col gap-3 flex-1">
            <div className="h-4 bg-slate-200 dark:bg-zinc-800 rounded-md w-3/4" />
            <div className="h-3 bg-slate-200 dark:bg-zinc-800 rounded-md w-1/2 mt-1" />
            <div className="h-3 bg-slate-200 dark:bg-zinc-800 rounded-md w-5/6 mt-1" />
            <div className="mt-auto pt-3 border-t border-slate-100 dark:border-zinc-800/50 flex gap-4">
              <div className="h-3 bg-slate-200 dark:bg-zinc-800 rounded-md w-8" />
              <div className="h-3 bg-slate-200 dark:bg-zinc-800 rounded-md w-12" />
            </div>
          </div>
        </div>
      ))}
    </div>
  );
}

function TableSkeleton() {
  return (
    <div className="flex flex-col gap-3.5 w-full animate-pulse mt-4">
      <div className="h-12 bg-slate-200 dark:bg-zinc-800 rounded-2xl w-full" />
      <div className="h-16 bg-slate-100 dark:bg-zinc-900/40 border border-slate-200 dark:border-zinc-800/50 rounded-2xl w-full" />
      <div className="h-16 bg-slate-100 dark:bg-zinc-900/40 border border-slate-200 dark:border-zinc-800/50 rounded-2xl w-full" />
      <div className="h-16 bg-slate-100 dark:bg-zinc-900/40 border border-slate-200 dark:border-zinc-800/50 rounded-2xl w-full" />
      <div className="h-16 bg-slate-100 dark:bg-zinc-900/40 border border-slate-200 dark:border-zinc-800/50 rounded-2xl w-full" />
    </div>
  );
}

function matchesQuery(row: any, q: string) {
  if (!q) return true;
  const needle = q.toLowerCase();
  return Object.values(row).some((v) => {
    if (v == null) return false;
    if (Array.isArray(v)) return v.some((x) => String(x).toLowerCase().includes(needle));
    return String(v).toLowerCase().includes(needle);
  });
}

function TableSearch({
  value,
  onChange,
  placeholder,
}: {
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
}) {
  return (
    <div className="relative flex-1 min-w-[200px] sm:max-w-xs">
      <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground z-10 pointer-events-none" />
      <Input
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder || "Search…"}
        className="h-10 pl-9 pr-9"
      />
      {value && (
        <button
          type="button"
          onClick={() => onChange("")}
          title="Clear search"
          className="absolute right-3 top-1/2 -translate-y-1/2 z-10 text-muted-foreground hover:text-foreground cursor-pointer"
        >
          <X className="w-4 h-4" />
        </button>
      )}
    </div>
  );
}

const ROWS_PER_PAGE_OPTIONS = [5, 10, 25, 50] as const;

function TablePagination({
  total,
  page,
  rowsPerPage,
  onPage,
  onRowsPerPage,
}: {
  total: number;
  page: number;
  rowsPerPage: number;
  onPage: (p: number) => void;
  onRowsPerPage: (n: number) => void;
}) {
  const totalPages = Math.max(1, Math.ceil(total / rowsPerPage));
  const start = total === 0 ? 0 : page * rowsPerPage + 1;
  const end = Math.min((page + 1) * rowsPerPage, total);

  return (
    <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 px-5 py-3 border-t border-slate-100 dark:border-zinc-800/50 text-xs text-slate-500 dark:text-zinc-400 bg-slate-50/40 dark:bg-zinc-900/40">
      <div className="flex items-center gap-2">
        <span className="font-medium">Rows per page:</span>
        <select
          value={rowsPerPage}
          onChange={(e) => { onRowsPerPage(Number(e.target.value)); onPage(0); }}
          className="px-2.5 py-1.5 rounded-xl border border-slate-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 text-xs font-semibold text-slate-700 dark:text-zinc-300 focus:outline-none focus:ring-2 focus:ring-[#A435F0]/40 cursor-pointer"
        >
          {ROWS_PER_PAGE_OPTIONS.map((n) => (
            <option key={n} value={n}>{n}</option>
          ))}
        </select>
      </div>
      <div className="flex items-center gap-3">
        <span className="font-medium tabular-nums">{start}–{end} of {total}</span>
        <div className="flex items-center gap-0.5">
          <button
            onClick={() => onPage(0)}
            disabled={page === 0}
            className="px-1.5 py-1 rounded-lg hover:bg-slate-100 dark:hover:bg-zinc-800 disabled:opacity-30 disabled:cursor-not-allowed transition-colors font-bold"
            title="First page"
          >«</button>
          <button
            onClick={() => onPage(page - 1)}
            disabled={page === 0}
            className="px-1.5 py-1 rounded-lg hover:bg-slate-100 dark:hover:bg-zinc-800 disabled:opacity-30 disabled:cursor-not-allowed transition-colors font-bold"
            title="Previous page"
          >‹</button>
          <span className="px-2.5 font-semibold tabular-nums text-slate-700 dark:text-zinc-300">
            {page + 1} / {totalPages}
          </span>
          <button
            onClick={() => onPage(page + 1)}
            disabled={page >= totalPages - 1}
            className="px-1.5 py-1 rounded-lg hover:bg-slate-100 dark:hover:bg-zinc-800 disabled:opacity-30 disabled:cursor-not-allowed transition-colors font-bold"
            title="Next page"
          >›</button>
          <button
            onClick={() => onPage(totalPages - 1)}
            disabled={page >= totalPages - 1}
            className="px-1.5 py-1 rounded-lg hover:bg-slate-100 dark:hover:bg-zinc-800 disabled:opacity-30 disabled:cursor-not-allowed transition-colors font-bold"
            title="Last page"
          >»</button>
        </div>
      </div>
    </div>
  );
}

function getRowHeaderInfo(row: any) {
  const keys = Object.keys(row);
  let titleKey = keys[0];
  let subtitleKey = "";

  const nameKey = keys.find(
    (k) => k.toLowerCase().includes("name") || k.toLowerCase().includes("title")
  );
  if (nameKey) titleKey = nameKey;

  const emailKey = keys.find((k) => k.toLowerCase().includes("email"));
  if (emailKey && emailKey !== titleKey) {
    subtitleKey = emailKey;
  } else {
    const categoryKey = keys.find(
      (k) => k.toLowerCase().includes("category") || k.toLowerCase().includes("subject")
    );
    if (categoryKey) subtitleKey = categoryKey;
  }

  return { titleKey, subtitleKey };
}

function ResponsiveTable({
  rows,
  type = "default",
}: {
  rows: any[];
  type?: "default" | "course-activity" | "activity";
}) {
  const [page, setPage] = useState(0);
  const [rowsPerPage, setRowsPerPage] = useState(5);

  useEffect(() => { setPage(0); }, [rows]);

  if (!rows || rows.length === 0) return null;
  const cols = Object.keys(rows[0]);
  const { titleKey, subtitleKey } = getRowHeaderInfo(rows[0]);
  const pageRows = rows.slice(page * rowsPerPage, (page + 1) * rowsPerPage);

  return (
    <>
      {/* Desktop view */}
      <div className="hidden md:block overflow-hidden rounded-2xl border border-slate-200 dark:border-zinc-800/80 shadow-md bg-white/70 dark:bg-zinc-900/60 backdrop-blur-md">
        <div className="overflow-x-auto">
          <Table paginate itemsPerPage={10} className="min-w-full text-sm">
            <TableHeader>
              <TableRow className="bg-slate-50/80 dark:bg-zinc-900/80 border-b border-slate-200 dark:border-zinc-800/80">
                {cols.map((c) => (
                  <TableHead
                    key={c}
                    className="text-left px-5 py-3.5 font-bold text-slate-500 dark:text-zinc-400 whitespace-nowrap text-xs uppercase tracking-wider"
                  >
                    {c.replace(/_/g, " ").replace(/\b\w/g, (l) => l.toUpperCase())}
                  </TableHead>
                ))}
              </TableRow>
            </TableHeader>
            <TableBody>
              {pageRows.map((r, i) => (
                <TableRow
                  key={i}
                  className={cn(
                    "border-t border-slate-100 dark:border-zinc-800/50 hover:bg-[#A435F0]/5 dark:hover:bg-[#A435F0]/5 transition-colors",
                    i % 2 === 1 && "bg-slate-50/20 dark:bg-zinc-900/20"
                  )}
                >
                  {cols.map((c) => {
                    const val = r[c];
                    const pct = c.toLowerCase().includes("percent") || c.toLowerCase().split(/[-_\s]/).includes("ratio");
                    return (
                      <TableCell key={c} className="px-5 py-3.5 whitespace-nowrap text-sm font-medium text-slate-700 dark:text-zinc-300">
                        {pct && val != null ? (
                          <span
                            className={cn(
                              "inline-flex items-center gap-1 font-bold",
                              Number(val) >= 100
                                ? "text-emerald-600 dark:text-emerald-400"
                                : Number(val) >= 50
                                  ? "text-amber-600 dark:text-amber-400"
                                  : "text-slate-500 dark:text-zinc-400"
                            )}
                          >
                            {Number(val) >= 100 && <CheckCircle2 className="w-3.5 h-3.5 shrink-0" />}
                            {Number(val).toFixed(0)}%
                          </span>
                        ) : (
                          String(val ?? "")
                        )}
                      </TableCell>
                    );
                  })}
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
        <TablePagination
          total={rows.length}
          page={page}
          rowsPerPage={rowsPerPage}
          onPage={setPage}
          onRowsPerPage={(n) => { setRowsPerPage(n); setPage(0); }}
        />
      </div>

      {/* Mobile view */}
      <div className="block md:hidden flex flex-col gap-4">
        {pageRows.map((row, i) => (
          <div
            key={i}
            className="bg-white dark:bg-zinc-900/60 backdrop-blur-md p-5 rounded-2xl border border-slate-200 dark:border-zinc-800/80 shadow-sm flex flex-col gap-3.5"
          >
            <div className="flex items-start gap-3">
              <div className="w-9 h-9 rounded-xl bg-gradient-to-tr from-[#A435F0]/15 to-[#7C3AED]/15 flex items-center justify-center border border-[#A435F0]/20 shrink-0">
                {type === "course-activity" ? (
                  <BookOpen className="w-4 h-4 text-[#A435F0]" />
                ) : (
                  <Users className="w-4 h-4 text-[#7C3AED]" />
                )}
              </div>
              <div className="min-w-0">
                <h4 className="text-sm font-black text-slate-800 dark:text-white leading-snug line-clamp-2">
                  {String(row[titleKey] ?? "")}
                </h4>
                {subtitleKey && (
                  <p className="text-xs text-slate-400 dark:text-zinc-500 truncate mt-0.5">
                    {String(row[subtitleKey] ?? "")}
                  </p>
                )}
              </div>
            </div>

            <div className="grid grid-cols-2 gap-3.5 text-xs border-t border-slate-100 dark:border-zinc-800/50 pt-3">
              {cols.map((k) => {
                if (k === titleKey || k === subtitleKey) return null;
                const val = row[k];
                const label = k.replace(/_/g, " ").replace(/\b\w/g, (l) => l.toUpperCase());
                const pct = k.toLowerCase().includes("percent") || k.toLowerCase().split(/[-_\s]/).includes("ratio");

                return (
                  <div key={k} className="flex flex-col gap-0.5 min-w-0">
                    <span className="text-[10px] font-bold text-slate-400 dark:text-zinc-500 uppercase tracking-wider">
                      {label}
                    </span>
                    <span className="font-semibold text-slate-700 dark:text-zinc-300 truncate">
                      {pct && val != null ? (
                        <span
                          className={cn(
                            "inline-flex items-center gap-1 font-extrabold",
                            Number(val) >= 100
                              ? "text-emerald-600 dark:text-emerald-400"
                              : Number(val) >= 50
                                ? "text-amber-600 dark:text-amber-400"
                                : "text-slate-500 dark:text-zinc-400"
                          )}
                        >
                          {Number(val) >= 100 && <CheckCircle2 className="w-3 h-3" />}
                          {Number(val).toFixed(0)}%
                        </span>
                      ) : (
                        String(val ?? "—")
                      )}
                    </span>
                  </div>
                );
              })}
            </div>
          </div>
        ))}
        <TablePagination
          total={rows.length}
          page={page}
          rowsPerPage={rowsPerPage}
          onPage={setPage}
          onRowsPerPage={(n) => { setRowsPerPage(n); setPage(0); }}
        />
      </div>
    </>
  );
}

export function UdemyBusinessPortal() {
  const { user } = useAuth();
  const [tab, setTab] = useState<Tab>("catalog");
  const { isOpen: showAutomations, close: closeAutomations } = useUdemyAutomations();
  const [status, setStatus] = useState<{
    configured: boolean;
    can_view_reports: boolean;
    scim_configured?: boolean;
    can_provision?: boolean;
  } | null>(null);
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
          { headers: authHeaders }
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
    [user?.email, user?.role]
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

  const tabItems = [
    { id: "catalog", label: "Catalog", icon: BookOpen, show: true },
    { id: "insights", label: "Insights", icon: TrendingUp, show: !!status?.can_view_reports },
    { id: "activity", label: "Learner Activity", icon: BarChart2, show: !!status?.can_view_reports },
    { id: "course-activity", label: "Course Activity", icon: Activity, show: !!status?.can_view_reports },
    { id: "inactive", label: "Inactive Seats", icon: UserMinus, show: !!status?.can_view_reports },
  ] as const;

  return (
    <div className="flex-1 h-full overflow-y-auto bg-gradient-to-b from-slate-50 to-slate-100/50 dark:from-zinc-950 dark:to-background select-none">
      {/* Hero banner */}
      <div className="relative overflow-hidden bg-gradient-to-tr from-[#1E1B4B] via-[#4C1D95] to-[#701A75] dark:from-[#0F0C20] dark:via-[#2E1065] dark:to-[#4A044E] px-6 py-10 sm:py-14 rounded-b-[2rem] shadow-2xl border-b border-violet-500/20">
        {/* Animated glow background elements */}
        <div className="absolute top-[-20%] left-[-10%] w-[50%] aspect-square rounded-full bg-[#A435F0]/25 blur-[90px] pointer-events-none animate-pulse" />
        <div className="absolute bottom-[-20%] right-[-10%] w-[50%] aspect-square rounded-full bg-[#6366F1]/20 blur-[90px] pointer-events-none" />
        <div
          className="absolute inset-0 opacity-[0.03] dark:opacity-[0.05]"
        style={{
            backgroundImage:
              "radial-gradient(circle, white 1px, transparent 1px)",
            backgroundSize: "28px 28px",
          }}
        />
        
        <div className="relative max-w-7xl mx-auto flex flex-col md:flex-row md:items-center justify-between gap-6">
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2 mb-3">
              <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-white/10 dark:bg-white/5 backdrop-blur-md border border-white/10 text-white text-[10px] font-bold uppercase tracking-wider">
                <GraduationCap className="w-3.5 h-3.5 text-[#C084FC]" />
                Learning Platform
              </span>
            </div>
            <p className="text-sm sm:text-base text-white/70 mt-2 max-w-xl leading-relaxed">
              Browse your organization's course catalog and monitor development progress in real-time.
            </p>
          </div>
          <div className="flex items-center gap-3 shrink-0">
            {count > 0 && (
              <motion.div
                initial={{ opacity: 0, scale: 0.9 }}
                animate={{ opacity: 1, scale: 1 }}
                transition={{ duration: 0.4 }}
                className="shrink-0 bg-white/10 dark:bg-white/[0.03] backdrop-blur-md border border-white/20 dark:border-white/10 rounded-2xl p-5 flex items-center gap-4 shadow-xl hover:bg-white/15 dark:hover:bg-white/[0.05] transition-all duration-300"
              >
                <div className="w-12 h-12 rounded-xl bg-gradient-to-tr from-[#A435F0] to-[#7C3AED] flex items-center justify-center shadow-lg shadow-purple-500/30">
                  <BookOpen className="w-6 h-6 text-white" />
                </div>
                <div>
                  <div className="text-3xl font-black text-white leading-none tracking-tight">
                    {count.toLocaleString()}
                  </div>
                  <div className="text-[10px] text-white/60 font-semibold uppercase tracking-wider mt-1">
                    Active Courses
                  </div>
                </div>
              </motion.div>
            )}
          </div>
        </div>
      </div>

      {/* Automations slide-in drawer */}
      <AnimatePresence>
        {showAutomations && (
          <>
            {/* Backdrop */}
            <motion.div
              key="automations-backdrop"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.2 }}
              onClick={() => closeAutomations()}
              className="fixed inset-0 z-40 bg-black/40 backdrop-blur-sm"
            />
            {/* Panel */}
            <motion.div
              key="automations-panel"
              initial={{ x: "100%" }}
              animate={{ x: 0 }}
              exit={{ x: "100%" }}
              transition={{ type: "spring", stiffness: 300, damping: 30 }}
              className="fixed top-0 right-0 bottom-0 z-50 w-full max-w-2xl flex flex-col bg-slate-50 dark:bg-zinc-950 border-l border-slate-200 dark:border-zinc-800/80 shadow-2xl"
            >
              {/* Drawer header */}
              <div className="flex items-center justify-between gap-4 px-6 py-5 border-b border-slate-200 dark:border-zinc-800/80 bg-white/80 dark:bg-zinc-900/80 backdrop-blur-md shrink-0">
                <div className="flex items-center gap-3">
                  <div className="w-9 h-9 rounded-xl bg-[#A435F0]/10 border border-[#A435F0]/20 flex items-center justify-center">
                    <Bell className="w-4.5 h-4.5 text-[#A435F0]" />
                  </div>
                  <div>
                    <p className="text-sm font-extrabold text-slate-800 dark:text-white">Notification Automations</p>
                    <p className="text-xs text-slate-500 dark:text-zinc-400">Scheduled reports &amp; learner nudges</p>
                  </div>
                </div>
                <button
                  onClick={() => closeAutomations()}
                  className="p-2 rounded-xl hover:bg-slate-100 dark:hover:bg-zinc-800 text-slate-400 hover:text-slate-700 dark:hover:text-white transition-colors cursor-pointer"
                >
                  <X className="w-4.5 h-4.5" />
                </button>
              </div>
              {/* Drawer body — scrollable */}
              <div className="flex-1 overflow-y-auto px-6 py-6">
                <AutomationsTab authHeaders={authHeaders} />
              </div>
            </motion.div>
          </>
        )}
      </AnimatePresence>

      <div className="max-w-7xl mx-auto px-4 py-6 sm:px-6 sm:py-8 flex flex-col gap-6">
        {/* Tab Selector bar with custom Framer Motion indicator */}
        <div className="relative -mx-4 px-4 sm:mx-0 sm:px-0">
          <div className="absolute right-0 top-0 bottom-0 w-8 bg-gradient-to-l from-slate-50 dark:from-zinc-950 to-transparent pointer-events-none z-10 sm:hidden" />
          <div className="absolute left-0 top-0 bottom-0 w-8 bg-gradient-to-r from-slate-50 dark:from-zinc-950 to-transparent pointer-events-none z-10 sm:hidden" />
          
          <div className="flex items-center gap-1.5 p-1.5 bg-slate-200/50 dark:bg-zinc-900/60 backdrop-blur-md border border-slate-300/30 dark:border-zinc-800/80 rounded-2xl w-full sm:w-fit overflow-x-auto no-scrollbar scroll-smooth snap-x snap-mandatory">
            {tabItems.filter(t => t.show).map((tItem) => {
              const TabIcon = tItem.icon;
              const isActive = tab === tItem.id;
              return (
                <button
                  key={tItem.id}
                  onClick={() => setTab(tItem.id)}
                  className={cn(
                    "relative px-4 py-2 rounded-xl text-xs sm:text-sm font-semibold transition-all duration-300 inline-flex items-center gap-2 whitespace-nowrap cursor-pointer shrink-0 snap-align-start",
                    isActive
                      ? "text-white"
                      : "text-slate-600 dark:text-zinc-400 hover:text-slate-900 dark:hover:text-white"
                  )}
                >
                  {isActive && (
                    <motion.div
                      layoutId="activeTabBackground"
                      className="absolute inset-0 bg-gradient-to-r from-[#A435F0] to-[#7C3AED] rounded-xl -z-10 shadow-md shadow-purple-500/20"
                      transition={{ type: "spring", stiffness: 380, damping: 30 }}
                    />
                  )}
                  <TabIcon className={cn("w-4 h-4", isActive ? "text-white" : "text-slate-500 dark:text-zinc-400")} />
                  {tItem.label}
                </button>
              );
            })}
          </div>
        </div>

        {/* Tab Viewport */}
        <div className="min-h-[400px]">
          {tab === "automations" ? (
            <AutomationsTab authHeaders={authHeaders} />
          ) : tab === "insights" ? (
            <InsightsTab authHeaders={authHeaders} />
          ) : tab === "inactive" ? (
            <InactiveSeatsTab
              authHeaders={authHeaders}
              canProvision={!!status?.scim_configured && !!status?.can_provision}
            />
          ) : tab === "course-activity" ? (
            <CourseActivityTab authHeaders={authHeaders} />
          ) : tab === "catalog" ? (
            <>
              {/* Search bar */}
              <form onSubmit={onSearch} className="flex flex-col sm:flex-row gap-3 mb-6 max-w-2xl">
                <div className="relative flex-1">
                  <Search className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4.5 h-4.5 text-slate-400 dark:text-zinc-500" />
                  <input
                    value={query}
                    onChange={(e) => setQuery(e.target.value)}
                    placeholder="Search courses (e.g. React, AWS, Power BI)…"
                    className="w-full pl-11 pr-4 py-3 rounded-2xl border border-slate-200 dark:border-zinc-800/80 bg-white/80 dark:bg-zinc-900/60 backdrop-blur-sm text-sm shadow-inner focus:outline-none focus:ring-2 focus:ring-[#A435F0]/40 focus:border-[#A435F0]/60 transition-all placeholder:text-slate-400 dark:placeholder:text-zinc-500 text-slate-800 dark:text-white"
                  />
                </div>
                <button
                  type="submit"
                  className="px-6 py-3 rounded-2xl bg-gradient-to-r from-[#A435F0] to-[#7C3AED] text-white text-sm font-bold hover:opacity-95 shadow-md shadow-purple-500/15 hover:shadow-purple-500/25 inline-flex items-center justify-center gap-2 transition-all cursor-pointer shrink-0"
                >
                  <Search className="w-4 h-4" />
                  Search Catalog
                </button>
              </form>

              {error ? (
                <div className="flex items-start gap-3 rounded-2xl border border-rose-500/20 bg-rose-500/5 p-4.5 text-sm text-rose-700 dark:text-rose-400 max-w-xl animate-fade-in">
                  <AlertCircle className="w-4.5 h-4.5 mt-0.5 shrink-0 text-rose-500" />
                  <span>{error}</span>
                </div>
              ) : loading ? (
                <CourseGridSkeleton />
              ) : courses.length === 0 && searched && indexing ? (
                <div className="flex flex-col items-center justify-center gap-3 py-20 text-slate-500 dark:text-zinc-400 text-sm text-center">
                  <Loader2 className="w-6 h-6 animate-spin text-[#A435F0]" />
                  <p className="max-w-sm leading-relaxed">
                    Building the course search index for the first time — a one-time, few-minute job.
                    Re-run your search in a moment.
                  </p>
                </div>
              ) : courses.length === 0 ? (
                <div className="flex flex-col items-center justify-center py-20 text-slate-500 dark:text-zinc-400 gap-3">
                  <div className="w-14 h-14 rounded-3xl bg-slate-200/50 dark:bg-zinc-800 flex items-center justify-center">
                    <BookOpen className="w-7 h-7 text-slate-400/60 dark:text-zinc-500" />
                  </div>
                  <p className="text-sm font-bold">No courses found{searched ? ` for "${query}"` : ""}.</p>
                </div>
              ) : (
                <>
                  <p className="text-xs text-slate-500 dark:text-zinc-400 mb-4 ml-1">
                    Found <span className="font-extrabold text-slate-800 dark:text-zinc-200">{count.toLocaleString()}</span>{" "}
                    course{count === 1 ? "" : "s"}
                    {query ? ` matching "${query}"` : " in the catalog"} · showing {courses.length}
                  </p>
                  <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-5">
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
    </div>
  );
}

function CourseActivityTab({ authHeaders }: { authHeaders: Record<string, string> }) {
  const [rows, setRows] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [syncing, setSyncing] = useState(false);
  const [syncResult, setSyncResult] = useState<{ added: number; skipped: number; errors: number } | null>(null);
  const [search, setSearch] = useState("");

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

  const filteredRows = rows.filter((r) => matchesQuery(r, search.trim()));

  if (loading) {
    return <TableSkeleton />;
  }

  return (
    <div className="flex flex-col gap-5">
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 flex-wrap">
        <div className="flex items-center gap-3">
          <div className="h-10 w-10 rounded-2xl bg-[#A435F0]/10 flex items-center justify-center border border-[#A435F0]/20">
            <Activity className="w-5 h-5 text-[#A435F0]" />
          </div>
          <div>
            <p className="text-sm font-extrabold text-slate-800 dark:text-white">Course Activity</p>
            <p className="text-xs text-slate-500 dark:text-zinc-400">
              {search.trim() ? `${filteredRows.length} of ${rows.length}` : `${rows.length} record(s)`} · {completedRows.length} completed
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <ExportBtn href="/api/portal/udemy/export/course-activity" authHeaders={authHeaders} label="Export" />
          <button
            onClick={load}
            className="inline-flex items-center gap-1.5 text-xs font-semibold text-slate-600 dark:text-zinc-400 hover:text-slate-900 dark:hover:text-white bg-white dark:bg-zinc-900 border border-slate-200 dark:border-zinc-800/80 px-4 py-2.5 rounded-xl transition-all shadow-sm cursor-pointer"
          >
            <RefreshCw className="w-3.5 h-3.5" />
            Refresh
          </button>
          <button
            onClick={syncSkills}
            disabled={syncing}
            className="inline-flex items-center gap-1.5 text-xs font-bold text-white bg-gradient-to-r from-[#A435F0] to-[#7C3AED] hover:opacity-95 disabled:opacity-60 px-4 py-2.5 rounded-xl transition-all shadow-md shadow-purple-500/15 cursor-pointer"
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
        <div className="flex items-start gap-3 rounded-2xl border border-emerald-500/20 bg-emerald-500/5 p-4 text-sm text-emerald-700 dark:text-emerald-400 animate-fade-in">
          <CheckCircle2 className="w-4.5 h-4.5 mt-0.5 shrink-0 text-emerald-500" />
          <span>
            Skill sync complete — <strong>{syncResult.added}</strong> new skill(s) added,{" "}
            <strong>{syncResult.skipped}</strong> skipped (already present or no employee match
            {syncResult.errors > 0 && `, ${syncResult.errors} error(s)`}).
          </span>
        </div>
      )}

      {error && (
        <div className="flex items-start gap-3 rounded-2xl border border-rose-500/20 bg-rose-500/5 p-4 text-sm text-rose-700 dark:text-rose-400 max-w-xl animate-fade-in">
          <AlertCircle className="w-4.5 h-4.5 mt-0.5 shrink-0 text-rose-500" />
          <span>{error}</span>
        </div>
      )}

      {rows.length > 0 && (
        <TableSearch
          value={search}
          onChange={setSearch}
          placeholder="Search by learner, course, category…"
        />
      )}

      {!error && rows.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-20 text-slate-500 dark:text-zinc-400 gap-3 border border-slate-200 dark:border-zinc-800/80 rounded-2xl bg-white/70 dark:bg-zinc-900/60">
          <div className="w-14 h-14 rounded-3xl bg-slate-200/50 dark:bg-zinc-850 flex items-center justify-center">
            <Activity className="w-7 h-7 text-slate-400/50" />
          </div>
          <p className="text-sm font-bold">No course activity data yet.</p>
        </div>
      ) : filteredRows.length === 0 ? (
        <TableEmpty
          className="rounded-2xl border border-slate-200 dark:border-zinc-800/80 bg-white/70 dark:bg-zinc-900/60"
          icon={<Search className="w-7 h-7" />}
        >
          <span className="text-sm font-bold">No records match "{search.trim()}".</span>
        </TableEmpty>
      ) : (
        <ResponsiveTable rows={filteredRows} type="course-activity" />
      )}
    </div>
  );
}

interface InsightCourse {
  course_id: number;
  title: string;
  category: string;
  enrolled: number;
  completed: number;
  avg_completion_pct: number;
  completion_rate: number;
  hours: number;
}

interface CourseInsights {
  totals: {
    learners_engaged: number;
    courses_touched: number;
    enrollments: number;
    completions: number;
    completion_rate: number;
    hours_consumed: number;
  };
  top_enrolled: InsightCourse[];
  top_completed: InsightCourse[];
  low_engagement: InsightCourse[];
  categories: { category: string; enrolled: number; completed: number; hours: number; completion_rate: number }[];
  generated_at: string;
}

function StatCard({ label, value, sub, accent }: { label: string; value: string; sub?: string; accent?: boolean }) {
  return (
    <div
      className={cn(
        "rounded-2xl border p-5 shadow-sm transition-all duration-300 hover:shadow-md hover:scale-[1.01] bg-white/70 dark:bg-zinc-900/60 backdrop-blur-md",
        accent
          ? "border-[#A435F0]/25 bg-gradient-to-br from-[#A435F0]/5 to-purple-500/[0.04] dark:from-[#A435F0]/10 dark:to-purple-500/[0.03]"
          : "border-slate-200 dark:border-zinc-800/80"
      )}
    >
      <div className="text-[10px] font-bold uppercase tracking-wider text-slate-400 dark:text-zinc-500">{label}</div>
      <div className="text-3xl font-black mt-1.5 tabular-nums leading-none text-slate-800 dark:text-white">{value}</div>
      {sub && <div className="text-[11px] text-slate-500 dark:text-zinc-400 mt-2 font-medium">{sub}</div>}
    </div>
  );
}

function Bar({ value, max, label, right }: { value: number; max: number; label: string; right: string }) {
  const pct = max > 0 ? Math.max(2, Math.round((value / max) * 100)) : 0;
  return (
    <div className="flex items-center gap-3">
      <div className="flex-1 min-w-0">
        <div className="flex items-center justify-between gap-2 mb-1.5">
          <span className="text-sm font-bold text-slate-700 dark:text-zinc-300 truncate">{label}</span>
          <span className="text-xs font-bold text-[#A435F0] dark:text-[#C084FC] shrink-0 tabular-nums">{right}</span>
        </div>
        <div className="h-2.5 rounded-full bg-slate-100 dark:bg-zinc-850 overflow-hidden shadow-inner">
          <motion.div
            initial={{ width: 0 }}
            animate={{ width: `${pct}%` }}
            transition={{ duration: 0.8, ease: "easeOut" }}
            className="h-full rounded-full bg-gradient-to-r from-[#A435F0] to-[#7C3AED]"
          />
        </div>
      </div>
    </div>
  );
}

function InsightsTab({ authHeaders }: { authHeaders: Record<string, string> }) {
  const [data, setData] = useState<CourseInsights | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    setLoading(true);
    fetch("/api/portal/udemy/analytics/course-insights", { headers: authHeaders })
      .then(async (r) => {
        if (!r.ok) {
          const b = await r.json().catch(() => ({}));
          throw new Error(b.detail || `HTTP ${r.status}`);
        }
        return r.json();
      })
      .then(setData)
      .catch((e) => setError(e.message || "Couldn't load insights."))
      .finally(() => setLoading(false));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  if (loading) {
    return <TableSkeleton />;
  }
  if (error) {
    return (
      <div className="flex items-start gap-3 rounded-2xl border border-rose-500/20 bg-rose-500/5 p-4 text-sm text-rose-700 dark:text-rose-400 max-w-xl animate-fade-in">
        <AlertCircle className="w-4.5 h-4.5 mt-0.5 shrink-0 text-rose-500" />
        <span>{error}</span>
      </div>
    );
  }
  if (!data || !data.totals) {
    return (
      <div className="flex flex-col items-center justify-center py-20 text-slate-500 dark:text-zinc-400 gap-3 border border-slate-200 dark:border-zinc-800/80 rounded-2xl bg-white/70 dark:bg-zinc-900/60">
        <div className="w-14 h-14 rounded-3xl bg-slate-200/50 dark:bg-zinc-800 flex items-center justify-center">
          <BarChart2 className="w-7 h-7 text-slate-400/50" />
        </div>
        <p className="text-sm font-bold">No learning activity data available yet.</p>
        <p className="text-xs text-slate-400 dark:text-zinc-500 text-center max-w-xs leading-relaxed">
          Insights are built from course-activity data and appear once learners start or complete courses.
        </p>
      </div>
    );
  }

  if ((data as any).analytics_access_denied) {
    return (
      <div className="flex flex-col items-center justify-center py-20 text-slate-500 dark:text-zinc-400 gap-4 border border-amber-500/20 bg-amber-500/[0.03] rounded-2xl">
        <div className="w-14 h-14 rounded-3xl bg-amber-500/10 flex items-center justify-center border border-amber-500/20">
          <AlertCircle className="w-7 h-7 text-amber-500" />
        </div>
        <div className="text-center max-w-sm">
          <p className="text-sm font-bold text-slate-800 dark:text-white">Analytics API access denied</p>
          <p className="text-xs text-slate-500 dark:text-zinc-400 mt-2 leading-relaxed">
            The Udemy Business API credential doesn't have reporting scope, or your plan doesn't include
            the Analytics API. Check that the API client has <strong>Organization Analytics</strong> access
            in the Udemy admin console.
          </p>
        </div>
      </div>
    );
  }

  if (data.totals.enrollments === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-20 text-slate-500 dark:text-zinc-400 gap-3 border border-slate-200 dark:border-zinc-800/80 rounded-2xl bg-white/70 dark:bg-zinc-900/60">
        <div className="w-14 h-14 rounded-3xl bg-slate-200/50 dark:bg-zinc-800 flex items-center justify-center">
          <BarChart2 className="w-7 h-7 text-slate-400/50" />
        </div>
        <p className="text-sm font-bold">No course activity recorded yet.</p>
        <p className="text-xs text-slate-400 dark:text-zinc-500 text-center max-w-xs leading-relaxed">
          Insights appear once learners start or complete courses in your Udemy Business org.
          {(data as any).fetch_error && (
            <span className="block mt-1 text-rose-400">API error: {(data as any).fetch_error}</span>
          )}
        </p>
      </div>
    );
  }

  const t = data.totals;
  const maxEnroll = Math.max(1, ...data.top_enrolled.map((c) => c.enrolled));
  const maxCat = Math.max(1, ...data.categories.map((c) => c.enrolled));

  return (
    <div className="flex flex-col gap-6 animate-fade-in">
      {/* Headline stats */}
      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3.5">
        <StatCard label="Learners engaged" value={t.learners_engaged.toLocaleString()} accent />
        <StatCard label="Enrollments" value={t.enrollments.toLocaleString()} />
        <StatCard label="Completions" value={t.completions.toLocaleString()} />
        <StatCard label="Completion rate" value={`${t.completion_rate}%`} accent />
        <StatCard label="Hours consumed" value={t.hours_consumed.toLocaleString()} />
        <StatCard label="Courses in use" value={t.courses_touched.toLocaleString()} />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Top enrolled */}
        <div className="rounded-2xl border border-slate-200 dark:border-zinc-800/80 bg-white/70 dark:bg-zinc-900/60 backdrop-blur-md p-6 shadow-sm">
          <div className="flex items-center gap-2.5 mb-5">
            <div className="w-8 h-8 rounded-xl bg-violet-500/10 flex items-center justify-center">
              <Users className="w-4 h-4 text-violet-500" />
            </div>
            <h3 className="text-sm font-extrabold text-slate-800 dark:text-white">Most-enrolled courses</h3>
          </div>
          <div className="flex flex-col gap-4">
            {data.top_enrolled.map((c) => (
              <Bar key={c.course_id} value={c.enrolled} max={maxEnroll} label={c.title} right={`${c.enrolled} · ${c.completion_rate}%`} />
            ))}
          </div>
        </div>

        {/* Category mix */}
        <div className="rounded-2xl border border-slate-200 dark:border-zinc-800/80 bg-white/70 dark:bg-zinc-900/60 backdrop-blur-md p-6 shadow-sm">
          <div className="flex items-center gap-2.5 mb-5">
            <div className="w-8 h-8 rounded-xl bg-violet-500/10 flex items-center justify-center">
              <BarChart2 className="w-4 h-4 text-violet-500" />
            </div>
            <h3 className="text-sm font-extrabold text-slate-800 dark:text-white">Top categories by enrollment</h3>
          </div>
          <div className="flex flex-col gap-4">
            {data.categories.slice(0, 8).map((c) => (
              <Bar key={c.category} value={c.enrolled} max={maxCat} label={c.category} right={`${c.enrolled} · ${c.hours}h`} />
            ))}
          </div>
        </div>
      </div>

      {/* Low engagement list (responsive table -> cards) */}
      <div className="rounded-2xl border border-slate-200 dark:border-zinc-800/80 shadow-sm overflow-hidden bg-white/70 dark:bg-zinc-900/60 backdrop-blur-md">
        <div className="flex items-center gap-2 px-5 py-4 border-b border-slate-200 dark:border-zinc-800/80 bg-amber-500/[0.04]">
          <AlertCircle className="w-4.5 h-4.5 text-amber-500 shrink-0" />
          <h3 className="text-sm font-extrabold text-slate-800 dark:text-white">Low-engagement courses</h3>
          <span className="text-xs text-slate-500 dark:text-zinc-400">— enrolled but barely started (avg &lt; 10%)</span>
        </div>
        {data.low_engagement.length === 0 ? (
          <p className="px-5 py-6 text-sm text-slate-500 dark:text-zinc-400">No notably low-engagement courses. 🎉</p>
        ) : (
          <>
            {/* Desktop Table */}
            <div className="hidden md:block">
              <Table paginate itemsPerPage={10} className="w-full text-sm">
                <TableHeader>
                  <TableRow className="bg-slate-50/80 dark:bg-zinc-900/80 border-b border-slate-200 dark:border-zinc-800/80">
                    {["Course", "Category", "Enrolled", "Avg progress"].map((h) => (
                      <TableHead key={h} className="text-left px-5 py-3 font-bold text-slate-500 dark:text-zinc-400 text-xs uppercase tracking-wide whitespace-nowrap">{h}</TableHead>
                    ))}
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {data.low_engagement.map((c, i) => (
                    <TableRow key={c.course_id} className={cn("border-t border-slate-100 dark:border-zinc-850/50 hover:bg-slate-50/50 dark:hover:bg-zinc-800/40 transition-colors", i % 2 === 1 && "bg-slate-50/20 dark:bg-zinc-900/20")}>
                      <TableCell className="px-5 py-3 font-bold text-slate-700 dark:text-zinc-200 max-w-[340px] truncate">{c.title}</TableCell>
                      <TableCell className="px-5 py-3 text-slate-500 dark:text-zinc-400">{c.category}</TableCell>
                      <TableCell className="px-5 py-3 tabular-nums text-slate-600 dark:text-zinc-300">{c.enrolled}</TableCell>
                      <TableCell className="px-5 py-3">
                        <Badge variant="outline" className="normal-case tracking-normal font-bold border-amber-500/20 bg-amber-500/5 text-amber-600 dark:text-amber-400">
                          {c.avg_completion_pct}%
                        </Badge>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>

            {/* Mobile Cards */}
            <div className="block md:hidden flex flex-col gap-3 p-4">
              {data.low_engagement.map((c) => (
                <div
                  key={c.course_id}
                  className="bg-white dark:bg-zinc-900/40 p-4 rounded-xl border border-slate-100 dark:border-zinc-800/50 flex flex-col gap-2.5"
                >
                  <h4 className="text-sm font-bold text-slate-800 dark:text-white leading-snug line-clamp-2">
                    {c.title}
                  </h4>
                  <div className="flex items-center justify-between text-xs text-slate-400 dark:text-zinc-500 border-t border-slate-100 dark:border-zinc-800/50 pt-2.5 mt-0.5">
                    <span>{c.category}</span>
                    <span className="font-semibold">{c.enrolled} Enrolled</span>
                  </div>
                  <div className="flex items-center justify-between">
                    <span className="text-[10px] font-bold text-slate-400 dark:text-zinc-500 uppercase tracking-wider">Avg Progress</span>
                    <Badge variant="outline" className="text-[10px] font-bold border-amber-500/20 bg-amber-500/5 text-amber-600 dark:text-amber-400 py-0.5 px-2">
                      {c.avg_completion_pct}%
                    </Badge>
                  </div>
                </div>
              ))}
            </div>
          </>
        )}
      </div>

      <div className="flex items-center justify-between mt-1">
        <p className="text-[11px] text-slate-400 dark:text-zinc-500 ml-1">
          Aggregated from Udemy course-activity · cached hourly{data.generated_at ? ` · updated ${fmtDate(data.generated_at.slice(0, 10))}` : ""}.
        </p>
        <ExportBtn href="/api/portal/udemy/export/insights" authHeaders={authHeaders} label="Export Insights" />
      </div>
    </div>
  );
}

interface InactiveSeat {
  name: string;
  email: string;
  role: string;
  groups: string[];
  udemy_user_id: number | null;
  last_active: string | null;
  joined_date: string | null;
  idle_days: number;
  never_visited: boolean;
  video_minutes: number;
  completed_courses: number;
  is_deactivated: boolean;
  manage_url: string;
}

const ROLE_LABELS: Record<string, string> = {
  student: "Member",
  admin: "Admin",
  group_admin: "Group Admin",
};

interface LicenseSummary {
  purchased: number | null;
  available: number | null;
  used: number | null;
  utilization_pct: number | null;
  active_in_report: number;
  deactivated: number;
  provisioned: number;
  inactive_days: number;
  updated_by: string | null;
  updated_at: string | null;
}

const PRESET_DAYS = [30, 60, 90, 180];

function SeatPills({
  authHeaders,
  reclaimable,
  days,
  canEdit,
  onDefaultDays,
}: {
  authHeaders: Record<string, string>;
  reclaimable: number;
  days: number;
  canEdit: boolean;
  onDefaultDays?: (d: number) => void;
}) {
  const [s, setS] = useState<LicenseSummary | null>(null);
  const [editing, setEditing] = useState(false);
  const [purchased, setPurchased] = useState("");
  const [available, setAvailable] = useState("");
  const [inactiveDays, setInactiveDays] = useState("");
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState("");

  const load = useCallback(() => {
    fetch("/api/portal/udemy/analytics/license-summary", { headers: authHeaders })
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => {
        if (d) {
          setS(d);
          onDefaultDays?.(Number(d.inactive_days) || 30); // seed/refresh the tab's threshold
        } else {
          onDefaultDays?.(30);
        }
      })
      .catch(() => onDefaultDays?.(30));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const beginEdit = () => {
    setPurchased(s?.purchased != null ? String(s.purchased) : "");
    setAvailable(s?.available != null ? String(s.available) : "");
    setSaveError("");
    setEditing(true);
  };

  const save = async () => {
    setSaving(true);
    setSaveError("");
    try {
      const r = await fetch("/api/portal/udemy/analytics/license-config", {
        method: "PUT",
        headers: authHeaders,
        body: JSON.stringify({
          purchased: purchased === "" ? null : Number(purchased),
          available: available === "" ? null : Number(available),
          // inactive_days is not user-editable — preserve existing value
          inactive_days: s?.inactive_days ?? null,
        }),
      });
      const b = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(b.detail || `HTTP ${r.status}`);
      setEditing(false);
      load();
    } catch (e: any) {
      setSaveError(e.message || "Couldn't save.");
    } finally {
      setSaving(false);
    }
  };

  if (!s) return null;

  // ── Prompt PMO to set purchased total if it's never been configured ─────────
  // This is the single most important first action — without it, auto-calculation
  // can't derive available seats and the gauge shows nothing useful.
  const purchasedUnset = s.purchased == null;

  if (editing) {
    return (
      <div className="flex flex-wrap items-end gap-3.5 rounded-2xl border border-violet-500/25 bg-violet-500/[0.04] p-5 shadow-inner">
        <label className="flex flex-col gap-1.5">
          <span className="text-[10px] font-bold uppercase tracking-wider text-slate-400 dark:text-zinc-500">
            Total purchased seats
            <span className="ml-1.5 text-rose-500">*</span>
          </span>
          <input
            type="number"
            min={0}
            value={purchased}
            onChange={(e) => setPurchased(e.target.value)}
            placeholder="e.g. 230"
            autoFocus
            className="w-32 px-3 py-2 rounded-xl border border-slate-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 text-sm text-slate-800 dark:text-white focus:outline-none focus:ring-2 focus:ring-[#A435F0]/40"
          />
          <span className="text-[10px] text-slate-400 dark:text-zinc-500 leading-snug max-w-[140px]">
            Read from Udemy admin → Settings → License
          </span>
        </label>
        <button
          onClick={save}
          disabled={saving}
          className="inline-flex items-center gap-1.5 text-xs font-bold text-white bg-gradient-to-r from-[#A435F0] to-[#7C3AED] hover:opacity-95 disabled:opacity-60 px-4 py-2.5 rounded-xl shadow-md transition-all cursor-pointer"
        >
          {saving ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <CheckCircle2 className="w-3.5 h-3.5" />}
          Save
        </button>
        <button
          onClick={() => setEditing(false)}
          className="text-xs font-semibold text-slate-600 dark:text-zinc-400 hover:text-slate-850 dark:hover:text-white px-4 py-2.5 rounded-xl border border-slate-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 cursor-pointer"
        >
          Cancel
        </button>
        {saveError && <span className="text-xs text-rose-500 self-center">{saveError}</span>}
        <span className="text-[11px] text-slate-400 dark:text-zinc-500 self-center max-w-[260px] leading-snug">
          After saving, click <strong>Force Refresh</strong> to auto-calculate available seats from live Udemy data.
        </span>
      </div>
    );
  }

  // Visual Gauge Progress calculation
  const pct = s.utilization_pct != null ? s.utilization_pct : 0;
  const radius = 36;
  const circumference = 2 * Math.PI * radius;
  const strokeDashoffset = circumference - (pct / 100) * circumference;

  return (
    <div className="flex flex-col gap-4 mb-2">
      {/* Prominent PMO banner when purchased total is not yet configured */}
      {canEdit && purchasedUnset && (
        <div className="flex items-center gap-4 rounded-2xl border border-amber-500/30 bg-amber-500/[0.06] p-4 shadow-sm">
          <div className="w-9 h-9 rounded-xl bg-amber-500/15 flex items-center justify-center shrink-0 border border-amber-500/20">
            <Pencil className="w-4.5 h-4.5 text-amber-500" />
          </div>
          <div className="flex-1 min-w-0">
            <p className="text-sm font-extrabold text-slate-800 dark:text-white">Set your purchased seat total</p>
            <p className="text-xs text-slate-500 dark:text-zinc-400 mt-0.5 leading-snug">
              Required once — read it from <strong>Udemy admin → Settings → License</strong>. After saving, use <strong>Force Refresh</strong> to auto-calculate available seats.
            </p>
          </div>
          <button
            onClick={beginEdit}
            className="shrink-0 inline-flex items-center gap-1.5 text-xs font-bold text-white bg-gradient-to-r from-amber-500 to-orange-500 hover:opacity-95 px-4 py-2.5 rounded-xl shadow-md transition-all cursor-pointer"
          >
            <Pencil className="w-3.5 h-3.5" />
            Set Total
          </button>
        </div>
      )}

      <div className="grid grid-cols-1 md:grid-cols-3 gap-5">
        {/* Gauge Card */}
        <div className="relative overflow-hidden rounded-2xl border border-slate-200 dark:border-zinc-800/80 bg-white/70 dark:bg-zinc-900/60 backdrop-blur-md p-5 shadow-sm flex items-center gap-5 md:col-span-1">
          <div className="absolute top-0 right-0 w-20 h-20 bg-[#A435F0]/10 rounded-full blur-2xl pointer-events-none" />
          
          <div className="relative flex-shrink-0 w-20 h-20">
            <svg className="w-full h-full transform -rotate-90">
              <circle
                cx="40"
                cy="40"
                r={radius}
                className="stroke-slate-100 dark:stroke-zinc-850"
                strokeWidth="6"
                fill="transparent"
              />
              <motion.circle
                cx="40"
                cy="40"
                r={radius}
                className="stroke-[#A435F0]"
                strokeWidth="6"
                fill="transparent"
                strokeDasharray={circumference}
                initial={{ strokeDashoffset: circumference }}
                animate={{ strokeDashoffset }}
                transition={{ duration: 1.2, ease: "easeOut" }}
                strokeLinecap="round"
              />
            </svg>
            <div className="absolute inset-0 flex flex-col items-center justify-center">
              <span className="text-lg font-black text-slate-800 dark:text-white tabular-nums leading-none">
                {s.utilization_pct != null ? `${s.utilization_pct}%` : "—"}
              </span>
              <span className="text-[9px] font-bold text-slate-400 dark:text-zinc-500 uppercase mt-0.5 tracking-wider">Used</span>
            </div>
          </div>

          <div className="flex-1 min-w-0">
            <h3 className="text-sm font-extrabold text-slate-800 dark:text-white truncate">Seat Utilization</h3>
            <p className="text-xs text-slate-500 dark:text-zinc-400 mt-1 leading-snug">
              {s.used ?? 0} occupied of {s.purchased ?? "∞"} seats.
            </p>
            {canEdit && !purchasedUnset && (
              <button
                onClick={beginEdit}
                className="mt-3.5 inline-flex items-center gap-1.5 text-xs font-bold text-[#A435F0] dark:text-[#C084FC] hover:text-white hover:bg-gradient-to-r hover:from-[#A435F0] hover:to-[#7C3AED] border border-[#A435F0]/20 hover:border-transparent px-3 py-1.5 rounded-xl transition-all duration-300 shadow-sm cursor-pointer"
              >
                <Pencil className="w-3.5 h-3.5" />
                Edit Total
              </button>
            )}
          </div>
        </div>

        {/* Metrics Card Grid */}
        <div className="grid grid-cols-2 sm:grid-cols-4 md:grid-cols-2 md:col-span-2 gap-4">
          <div className="bg-white/70 dark:bg-zinc-900/60 backdrop-blur-md border border-slate-200 dark:border-zinc-800/80 rounded-2xl p-4.5 shadow-sm flex flex-col justify-between hover:shadow-md transition-shadow">
            <span className="text-[10px] font-bold uppercase tracking-wider text-slate-400 dark:text-zinc-500">Used Seats</span>
            <div>
              <div className="text-2xl font-black text-slate-800 dark:text-white mt-1 tabular-nums">{s.used ?? "—"}</div>
              <p className="text-[10px] text-slate-450 dark:text-zinc-500 mt-1">Occupied user seats</p>
            </div>
          </div>

          <div className="bg-white/70 dark:bg-zinc-900/60 backdrop-blur-md border border-slate-200 dark:border-zinc-800/80 rounded-2xl p-4.5 shadow-sm flex flex-col justify-between hover:shadow-md transition-shadow">
            <span className="text-[10px] font-bold uppercase tracking-wider text-slate-400 dark:text-zinc-500">Available Seats</span>
            <div>
              <div className={cn(
                "text-2xl font-black mt-1 tabular-nums",
                s.available != null && s.available <= 0 ? "text-amber-500" : "text-emerald-600 dark:text-emerald-400"
              )}>
                {s.available ?? "—"}
              </div>
              <p className="text-[10px] text-slate-455 dark:text-zinc-500 mt-1">Free to allocate</p>
            </div>
          </div>

          <div className="bg-white/70 dark:bg-zinc-900/60 backdrop-blur-md border border-slate-200 dark:border-zinc-800/80 rounded-2xl p-4.5 shadow-sm flex flex-col justify-between hover:shadow-md transition-shadow">
            <span className="text-[10px] font-bold uppercase tracking-wider text-slate-400 dark:text-zinc-500">Reclaimable</span>
            <div>
              <div className={cn(
                "text-2xl font-black mt-1 tabular-nums",
                reclaimable > 0 ? "text-amber-500" : "text-slate-800 dark:text-white"
              )}>
                {reclaimable}
              </div>
              <p className="text-[10px] text-slate-455 dark:text-zinc-500 mt-1">Learners idle ≥{days}d</p>
            </div>
          </div>

          {/* Contracted card — clickable for PMO to update the purchased total */}
          <div
            onClick={canEdit ? beginEdit : undefined}
            className={cn(
              "bg-white/70 dark:bg-zinc-900/60 backdrop-blur-md border rounded-2xl p-4.5 shadow-sm flex flex-col justify-between transition-all",
              canEdit
                ? "border-[#A435F0]/25 hover:border-[#A435F0]/50 hover:shadow-md cursor-pointer group"
                : "border-slate-200 dark:border-zinc-800/80 hover:shadow-md"
            )}
          >
            <div className="flex items-center justify-between">
              <span className="text-[10px] font-bold uppercase tracking-wider text-slate-400 dark:text-zinc-500">Contracted</span>
              {canEdit && (
                <Pencil className="w-3 h-3 text-slate-300 dark:text-zinc-600 group-hover:text-[#A435F0] transition-colors" />
              )}
            </div>
            <div>
              <div className="text-2xl font-black text-slate-800 dark:text-white mt-1 tabular-nums">{s.purchased ?? "—"}</div>
              <p className="text-[10px] mt-1 font-medium">
                {canEdit ? (
                  <span className="text-[#A435F0] dark:text-[#C084FC] group-hover:underline">Click to update</span>
                ) : (
                  <span className="text-slate-455 dark:text-zinc-500">Contract total purchased</span>
                )}
              </p>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}


function fmtDate(d: string | null) {
  if (!d) return "—";
  const dt = new Date(d + "T00:00:00");
  return dt.toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" });
}

function IdleBadge({ days, never }: { days: number; never: boolean }) {
  const cls =
    days >= 180
      ? "bg-rose-500/10 text-rose-600 dark:text-rose-400 border border-rose-500/25"
      : days >= 90
        ? "bg-amber-500/10 text-amber-600 dark:text-amber-400 border border-amber-500/20"
        : "bg-slate-100 dark:bg-zinc-800 text-slate-500 dark:text-zinc-400 border border-slate-200 dark:border-zinc-800/80";
  return (
    <span className={cn("inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-[11px] font-bold whitespace-nowrap", cls)}>
      <Clock className="w-3.5 h-3.5" />
      {days}d idle
      {never && <span className="font-semibold opacity-75">· never visited</span>}
    </span>
  );
}

function InactiveSeatCard({
  r,
  canProvision,
  confirming,
  setConfirming,
  busy,
  deactivate,
  done,
}: {
  r: InactiveSeat;
  canProvision: boolean;
  confirming: string | null;
  setConfirming: (email: string | null) => void;
  busy: string | null;
  deactivate: (email: string) => void;
  done: Record<string, string>;
}) {
  return (
    <div className="bg-white dark:bg-zinc-900/60 backdrop-blur-md border border-slate-200 dark:border-zinc-800/80 rounded-2xl p-5 shadow-sm flex flex-col gap-4 animate-fade-in">
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-center gap-3">
          <UserAvatar name={r.name} email={r.email} />
          <div className="min-w-0">
            <h4 className="text-sm font-black text-slate-800 dark:text-white leading-tight truncate">{r.name}</h4>
            <p className="text-xs text-slate-400 dark:text-zinc-500 truncate mt-0.5">{r.email}</p>
          </div>
        </div>
        <Badge variant="secondary" className="text-[10px] font-bold py-0.5 px-2 shrink-0">
          {ROLE_LABELS[r.role] || r.role || "Member"}
        </Badge>
      </div>

      {r.groups?.length ? (
        <div className="flex flex-wrap gap-1">
          {r.groups.map((g) => (
            <Badge key={g} variant="outline" className="text-[10px] normal-case tracking-normal font-medium text-slate-500 border-slate-200 dark:border-zinc-800">
              {g}
            </Badge>
          ))}
        </div>
      ) : null}

      <div className="grid grid-cols-2 gap-3.5 text-xs border-t border-slate-100 dark:border-zinc-800/50 pt-3.5">
        <div className="flex flex-col gap-0.5">
          <span className="text-[9px] font-bold text-slate-400 dark:text-zinc-500 uppercase tracking-wider">Last Active</span>
          <span className="font-semibold text-slate-700 dark:text-zinc-300">
            {r.never_visited ? "Never" : fmtDate(r.last_active)}
          </span>
        </div>
        
        <div className="flex flex-col gap-0.5">
          <span className="text-[9px] font-bold text-slate-400 dark:text-zinc-500 uppercase tracking-wider">Activity Status</span>
          <div>
            <IdleBadge days={r.idle_days} never={r.never_visited} />
          </div>
        </div>

        <div className="flex flex-col gap-0.5 col-span-2">
          <span className="text-[9px] font-bold text-slate-400 dark:text-zinc-500 uppercase tracking-wider">Activity History</span>
          <span className="font-semibold text-slate-605 dark:text-zinc-300">
            {Math.round(r.video_minutes)} min video · {r.completed_courses} courses completed
          </span>
        </div>
      </div>

      <div className="border-t border-slate-100 dark:border-zinc-800/50 pt-3.5 flex flex-wrap items-center justify-end gap-2.5">
        {done[r.email] === "done" ? (
          <span className="inline-flex items-center gap-1.5 text-xs font-semibold text-emerald-600 dark:text-emerald-400">
            <CheckCircle2 className="w-3.5 h-3.5" />
            Deactivated
          </span>
        ) : (
          <>
            <a
              href={r.manage_url}
              target="_blank"
              rel="noreferrer"
              className="inline-flex items-center gap-1.5 text-xs font-bold text-violet-650 dark:text-violet-400 hover:text-white hover:bg-gradient-to-r hover:from-[#A435F0] hover:to-[#7C3AED] border border-[#A435F0]/25 hover:border-transparent bg-white/50 dark:bg-zinc-900/50 px-3.5 py-2 rounded-xl transition-all cursor-pointer"
            >
              <ExternalLink className="w-3.5 h-3.5" />
              Open in Udemy
            </a>
            {canProvision &&
              (busy === r.email ? (
                <span className="inline-flex items-center px-3 py-2">
                  <Loader2 className="w-3.5 h-3.5 animate-spin text-rose-500" />
                </span>
              ) : confirming === r.email ? (
                <div className="inline-flex items-center gap-1.5">
                  <button
                    onClick={() => deactivate(r.email)}
                    className="inline-flex items-center gap-1 text-xs font-extrabold text-white bg-rose-600 hover:bg-rose-700 px-3 py-2 rounded-xl transition-colors cursor-pointer shadow-md"
                  >
                    Confirm
                  </button>
                  <button
                    onClick={() => setConfirming(null)}
                    className="text-xs font-bold text-slate-500 hover:text-slate-800 dark:text-zinc-400 dark:hover:text-white px-2 py-2 cursor-pointer"
                  >
                    Cancel
                  </button>
                </div>
              ) : (
                <button
                  onClick={() => setConfirming(r.email)}
                  className="inline-flex items-center gap-1.5 text-xs font-bold text-rose-600 dark:text-rose-450 border border-rose-500/25 hover:border-transparent hover:bg-rose-600 hover:text-white px-3.5 py-2 rounded-xl transition-all cursor-pointer"
                >
                  <ShieldOff className="w-3.5 h-3.5" />
                  Deactivate
                </button>
              ))}
          </>
        )}
        {done[r.email] && done[r.email] !== "done" && (
          <div className="w-full text-right text-[11px] text-rose-500 mt-1">{done[r.email]}</div>
        )}
      </div>
    </div>
  );
}

function InactiveSeatsTab({
  authHeaders,
  canProvision,
}: {
  authHeaders: Record<string, string>;
  canProvision: boolean;
}) {
  const { user } = useAuth();
  const canManageLicense = ["pmo", "admin", "super admin"].includes(
    (user?.role || "").toLowerCase()
  );
  const [days, setDays] = useState(0); // 0 until the PMO-configured org default arrives
  const [rows, setRows] = useState<InactiveSeat[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [confirming, setConfirming] = useState<string | null>(null); // email pending confirm
  const [busy, setBusy] = useState<string | null>(null); // email being deactivated
  const [done, setDone] = useState<Record<string, string>>({}); // email -> "done" | error msg
  const [page, setPage] = useState(0);
  const [rowsPerPage, setRowsPerPage] = useState(5);
  const [search, setSearch] = useState("");
  const [roleFilter, setRoleFilter] = useState("all");
  const [groupFilter, setGroupFilter] = useState("all");
  const [forceRefreshing, setForceRefreshing] = useState(false);
  const [refreshMsg, setRefreshMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [pillsKey, setPillsKey] = useState(0); // increment to force SeatPills to re-fetch

  const deactivate = useCallback(
    async (email: string) => {
      setBusy(email);
      try {
        const r = await fetch("/api/portal/udemy/scim/users/deactivate", {
          method: "POST",
          headers: authHeaders,
          body: JSON.stringify({ email }),
        });
        const b = await r.json().catch(() => ({}));
        if (!r.ok) throw new Error(b.detail || `HTTP ${r.status}`);
        setDone((d) => ({ ...d, [email]: "done" }));
      } catch (e: any) {
        setDone((d) => ({ ...d, [email]: e.message || "Failed" }));
      } finally {
        setBusy(null);
        setConfirming(null);
      }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    []
  );

  const load = useCallback(
    (threshold: number) => {
      setLoading(true);
      setError("");
      fetch(`/api/portal/udemy/analytics/inactive-users?days=${threshold}`, { headers: authHeaders })
        .then(async (r) => {
          if (!r.ok) {
            const b = await r.json().catch(() => ({}));
            throw new Error(b.detail || `HTTP ${r.status}`);
          }
          return r.json();
        })
        .then((data) => {
          setRows(data.results || []);
          setTotal(data.total_learners || 0);
        })
        .catch((e) => setError(e.message || "Couldn't load inactive seats."))
        .finally(() => setLoading(false));
      // eslint-disable-next-line react-hooks/exhaustive-deps
    },
    []
  );

  const forceRefresh = useCallback(
    async (threshold: number) => {
      setForceRefreshing(true);
      setRefreshMsg(null);
      try {
        const r = await fetch("/api/portal/udemy/analytics/refresh-cache", {
          method: "POST",
          headers: authHeaders,
        });
        const b = await r.json().catch(() => ({}));
        if (!r.ok) throw new Error(b.detail || `HTTP ${r.status}`);

        // Build a human-readable summary of what changed
        const parts: string[] = [`${b.learners ?? 0} learner records pulled from Udemy.`];
        if (b.available_updated && b.purchased != null) {
          parts.push(
            `Available seats auto-updated: ${b.purchased} purchased − ${b.active} active = ${b.available} available.`
          );
        } else if (!b.available_updated) {
          parts.push("Set a purchased seat total to enable auto-calculation of available seats.");
        }
        setRefreshMsg({ ok: true, text: parts.join(" ") });

        // Re-mount SeatPills so it re-fetches the updated license summary
        setPillsKey((k) => k + 1);
        // Reload the inactive-users table with fresh server data
        load(threshold);
      } catch (e: any) {
        setRefreshMsg({ ok: false, text: e.message || "Force refresh failed." });
      } finally {
        setForceRefreshing(false);
      }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [load]
  );

  useEffect(() => {
    if (days > 0) load(days); // wait for the configured default (set by SeatPills) before loading
  }, [load, days]);

  const uniqueRoles = Array.from(new Set(rows.map((r) => r.role).filter(Boolean))).sort();
  const uniqueGroups = Array.from(new Set(rows.flatMap((r) => r.groups || []))).sort();

  const filteredRows = rows.filter((r) => {
    if (roleFilter !== "all" && r.role !== roleFilter) return false;
    if (groupFilter !== "all" && !(r.groups || []).includes(groupFilter)) return false;

    const q = search.trim().toLowerCase();
    if (!q) return true;
    return (r.name || "").toLowerCase().includes(q) || (r.email || "").toLowerCase().includes(q);
  });

  useEffect(() => { setPage(0); }, [rows, search, roleFilter, groupFilter]);

  const pageRows = filteredRows.slice(page * rowsPerPage, (page + 1) * rowsPerPage);
  const filtersActive = !!search.trim() || roleFilter !== "all" || groupFilter !== "all";

  return (
    <div className="flex flex-col gap-5">
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 flex-wrap">
        <div className="flex items-center gap-3">
          <div className="h-10 w-10 rounded-2xl bg-[#A435F0]/10 flex items-center justify-center border border-[#A435F0]/20">
            <UserMinus className="w-5 h-5 text-[#A435F0]" />
          </div>
          <div>
            <p className="text-sm font-extrabold text-slate-800 dark:text-white">Inactive Seats</p>
            <p className="text-xs text-slate-500 dark:text-zinc-400">
              {loading
                ? "Scanning learner activity…"
                : filtersActive
                  ? `${filteredRows.length} of ${rows.length} idle learners match`
                  : `${rows.length} of ${total} learners idle ≥ ${days} days`}
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          <span className="text-xs text-slate-400 dark:text-zinc-500 font-bold uppercase tracking-wider">Inactive for</span>
          <div className="flex items-center gap-1 bg-slate-200/50 dark:bg-zinc-900/60 p-1.5 rounded-xl">
            {PRESET_DAYS.map((d) => (
              <button
                key={d}
                onClick={() => setDays(d)}
                className={cn(
                  "px-3 py-1.5 rounded-lg text-xs font-bold transition-all cursor-pointer",
                  days === d
                    ? "bg-white dark:bg-zinc-800 text-[#A435F0] dark:text-white shadow-sm"
                    : "text-slate-500 dark:text-zinc-400 hover:text-slate-850 dark:hover:text-white"
                )}
              >
                {d}d
              </button>
            ))}
          </div>
          <ExportBtn href={`/api/portal/udemy/export/inactive-users?days=${days}`} authHeaders={authHeaders} label="Export" />
          <button
            onClick={() => load(days)}
            className="inline-flex items-center gap-1.5 text-xs font-semibold text-slate-600 dark:text-zinc-400 hover:text-slate-900 dark:hover:text-white bg-white dark:bg-zinc-900 border border-slate-200 dark:border-zinc-800/80 px-4 py-2.5 rounded-xl transition-all shadow-sm cursor-pointer"
          >
            <RefreshCw className="w-3.5 h-3.5" />
            Refresh
          </button>
          {canManageLicense && (
            <button
              onClick={() => forceRefresh(days)}
              disabled={forceRefreshing || days === 0}
              title="Bypass the 1-hour cache and pull the latest data directly from Udemy"
              className="inline-flex items-center gap-1.5 text-xs font-bold text-white bg-gradient-to-r from-[#A435F0] to-[#7C3AED] hover:opacity-95 disabled:opacity-50 disabled:cursor-not-allowed px-4 py-2.5 rounded-xl transition-all shadow-md shadow-purple-500/15 cursor-pointer"
            >
              {forceRefreshing ? (
                <Loader2 className="w-3.5 h-3.5 animate-spin" />
              ) : (
                <RefreshCw className="w-3.5 h-3.5" />
              )}
              {forceRefreshing ? "Fetching from Udemy…" : "Force Refresh"}
            </button>
          )}
        </div>
      </div>

      {refreshMsg && (
        <div
          className={cn(
            "flex items-start gap-3 rounded-2xl border p-4 text-sm animate-fade-in",
            refreshMsg.ok
              ? "border-emerald-500/20 bg-emerald-500/5 text-emerald-700 dark:text-emerald-400"
              : "border-rose-500/20 bg-rose-500/5 text-rose-700 dark:text-rose-400"
          )}
        >
          {refreshMsg.ok ? (
            <CheckCircle2 className="w-4.5 h-4.5 mt-0.5 shrink-0 text-emerald-500" />
          ) : (
            <AlertCircle className="w-4.5 h-4.5 mt-0.5 shrink-0 text-rose-500" />
          )}
          <span>{refreshMsg.text}</span>
          <button
            onClick={() => setRefreshMsg(null)}
            className="ml-auto text-current opacity-50 hover:opacity-100 cursor-pointer"
          >
            <X className="w-4 h-4" />
          </button>
        </div>
      )}

      <SeatPills
        key={pillsKey}
        authHeaders={authHeaders}
        reclaimable={rows.length}
        days={days}
        canEdit={canManageLicense}
        onDefaultDays={(d) => setDays(d)}
      />

      <div className="flex items-start gap-3 rounded-2xl border border-violet-500/20 bg-violet-500/[0.04] p-4 text-xs text-slate-500 dark:text-zinc-400 leading-relaxed shadow-sm">
        <AlertCircle className="w-4.5 h-4.5 mt-0.5 shrink-0 text-[#A435F0]" />
        <span>
          These learners haven't visited Udemy in {days}+ days.{" "}
          {canProvision ? (
            <>
              Click <strong className="text-slate-800 dark:text-white font-bold">Deactivate</strong> to free the seat directly
              via SCIM, or <strong className="text-slate-800 dark:text-white font-bold">Open in Udemy</strong> to manage it in
              the admin console.
            </>
          ) : (
            <>
              Reviewing for license reclamation? Click <strong className="text-slate-800 dark:text-white font-bold">Open in Udemy</strong>{" "}
              to deactivate the seat in the Udemy admin console — nothing is revoked automatically from here.
            </>
          )}
        </span>
      </div>

      {!loading && !error && rows.length > 0 && (
        <div className="flex flex-col sm:flex-row gap-3">
          <TableSearch
            value={search}
            onChange={setSearch}
            placeholder="Search by name or email…"
          />
          <Select value={roleFilter} onValueChange={setRoleFilter}>
            <SelectTrigger className="sm:w-[160px] shrink-0">
              <SelectValue placeholder="Role" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All roles</SelectItem>
              {uniqueRoles.map((r) => (
                <SelectItem key={r} value={r}>
                  {ROLE_LABELS[r] || r}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Select value={groupFilter} onValueChange={setGroupFilter}>
            <SelectTrigger className="sm:w-[180px] shrink-0">
              <SelectValue placeholder="Group" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All groups</SelectItem>
              {uniqueGroups.map((g) => (
                <SelectItem key={g} value={g}>
                  {g}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          {filtersActive && (
            <button
              onClick={() => { setSearch(""); setRoleFilter("all"); setGroupFilter("all"); }}
              className="inline-flex items-center gap-1.5 text-xs font-semibold text-slate-500 hover:text-slate-800 dark:text-zinc-400 dark:hover:text-white px-3 py-2 rounded-xl transition-colors cursor-pointer shrink-0"
            >
              <X className="w-3.5 h-3.5" />
              Clear filters
            </button>
          )}
        </div>
      )}

      {loading ? (
        <TableSkeleton />
      ) : error ? (
        <div className="flex items-start gap-3 rounded-2xl border border-rose-500/20 bg-rose-500/5 p-4 text-sm text-rose-700 dark:text-rose-450 max-w-xl animate-fade-in">
          <AlertCircle className="w-4.5 h-4.5 mt-0.5 shrink-0 text-rose-500" />
          <span>{error}</span>
        </div>
      ) : rows.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-20 text-slate-500 dark:text-zinc-400 gap-3 border border-slate-200 dark:border-zinc-800/80 rounded-2xl bg-white/70 dark:bg-zinc-900/60">
          <div className="w-14 h-14 rounded-3xl bg-emerald-500/10 flex items-center justify-center border border-emerald-500/25">
            <CheckCircle2 className="w-7 h-7 text-emerald-550 dark:text-emerald-450" />
          </div>
          <p className="text-sm font-bold">No learners idle for {days}+ days. Every active seat is in use.</p>
        </div>
      ) : filteredRows.length === 0 ? (
        <TableEmpty
          className="rounded-2xl border border-slate-200 dark:border-zinc-800/80 bg-white/70 dark:bg-zinc-900/60"
          icon={<Search className="w-7 h-7" />}
        >
          <span className="text-sm font-bold">No idle learners match the current filters.</span>
        </TableEmpty>
      ) : (
        <>
          {/* Desktop Table View */}
          <div className="hidden md:block overflow-hidden rounded-2xl border border-slate-200 dark:border-zinc-800/80 shadow-md bg-white/70 dark:bg-zinc-900/60 backdrop-blur-md">
            <div className="overflow-x-auto">
              <Table paginate itemsPerPage={10} className="min-w-full text-sm">
                <TableHeader>
                  <TableRow className="bg-slate-50/80 dark:bg-zinc-900/80 border-b border-slate-200 dark:border-zinc-800/80">
                    {["Learner", "Role", "Groups", "Last active", "Idle Status", "Activity History", ""].map((h) => (
                      <TableHead
                        key={h}
                        className="text-left px-5 py-3.5 font-bold text-slate-500 dark:text-zinc-400 whitespace-nowrap text-xs uppercase tracking-wider"
                      >
                        {h}
                      </TableHead>
                    ))}
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {pageRows.map((r, i) => (
                    <TableRow
                      key={r.email || i}
                      className={cn(
                        "border-t border-slate-100 dark:border-zinc-850/50 hover:bg-[#A435F0]/5 dark:hover:bg-[#A435F0]/5 transition-colors",
                        i % 2 === 1 && "bg-slate-50/20 dark:bg-zinc-900/20"
                      )}
                    >
                      <TableCell className="px-5 py-3">
                        <div className="flex items-center gap-3">
                          <UserAvatar name={r.name} email={r.email} />
                          <div className="min-w-0">
                            <div className="font-bold text-slate-800 dark:text-white leading-tight truncate">{r.name}</div>
                            <div className="text-xs text-slate-400 dark:text-zinc-500 mt-0.5 truncate">{r.email}</div>
                          </div>
                        </div>
                      </TableCell>
                      <TableCell className="px-5 py-3 whitespace-nowrap">
                        <Badge variant="secondary" className="font-bold py-0.5 px-2">
                          {ROLE_LABELS[r.role] || r.role || "Member"}
                        </Badge>
                      </TableCell>
                      <TableCell className="px-5 py-3">
                        {r.groups?.length ? (
                          <div className="flex flex-wrap gap-1 max-w-[220px]">
                            {r.groups.map((g) => (
                              <Badge key={g} variant="outline" className="text-[10px] normal-case tracking-normal font-medium border-slate-200 dark:border-zinc-800">
                                {g}
                              </Badge>
                            ))}
                          </div>
                        ) : (
                          <span className="text-slate-400">—</span>
                        )}
                      </TableCell>
                      <TableCell className="px-5 py-3 whitespace-nowrap text-slate-500 dark:text-zinc-400 font-medium">
                        {r.never_visited ? "Never" : fmtDate(r.last_active)}
                      </TableCell>
                      <TableCell className="px-5 py-3 whitespace-nowrap">
                        <IdleBadge days={r.idle_days} never={r.never_visited} />
                      </TableCell>
                      <TableCell className="px-5 py-3 whitespace-nowrap text-xs text-slate-500 dark:text-zinc-400 font-semibold">
                        {Math.round(r.video_minutes)} min · {r.completed_courses} completed
                      </TableCell>
                      <TableCell className="px-5 py-3 whitespace-nowrap text-right">
                        <div className="inline-flex items-center gap-2">
                          {done[r.email] === "done" ? (
                            <span className="inline-flex items-center gap-1.5 text-xs font-semibold text-emerald-600 dark:text-emerald-400">
                              <CheckCircle2 className="w-3.5 h-3.5" />
                              Deactivated
                            </span>
                          ) : (
                            <>
                              <a
                                href={r.manage_url}
                                target="_blank"
                                rel="noreferrer"
                                className="inline-flex items-center gap-1.5 text-xs font-bold text-violet-650 dark:text-violet-400 hover:text-white hover:bg-gradient-to-r hover:from-[#A435F0] hover:to-[#7C3AED] border border-[#A435F0]/25 hover:border-transparent bg-white/50 dark:bg-zinc-900/50 px-3.5 py-2 rounded-xl transition-all cursor-pointer"
                                title={`Manage ${r.name} in Udemy admin`}
                              >
                                <ExternalLink className="w-3.5 h-3.5" />
                                Open in Udemy
                              </a>
                              {canProvision &&
                                (busy === r.email ? (
                                  <span className="inline-flex items-center px-3 py-2">
                                    <Loader2 className="w-3.5 h-3.5 animate-spin text-rose-500" />
                                  </span>
                                ) : confirming === r.email ? (
                                  <div className="inline-flex items-center gap-1">
                                    <button
                                      onClick={() => deactivate(r.email)}
                                      className="inline-flex items-center gap-1 text-xs font-extrabold text-white bg-rose-600 hover:bg-rose-700 px-3 py-2 rounded-xl transition-colors cursor-pointer shadow-md"
                                      title="Confirm deactivation via SCIM"
                                    >
                                      Confirm
                                    </button>
                                    <button
                                      onClick={() => setConfirming(null)}
                                      className="text-xs font-bold text-slate-500 hover:text-slate-800 dark:text-zinc-400 dark:hover:text-white px-2 py-2 cursor-pointer"
                                    >
                                      Cancel
                                    </button>
                                  </div>
                                ) : (
                                  <button
                                    onClick={() => setConfirming(r.email)}
                                    className="inline-flex items-center gap-1.5 text-xs font-bold text-rose-600 dark:text-rose-455 border border-rose-500/25 hover:border-transparent hover:bg-rose-600 hover:text-white px-3.5 py-2 rounded-xl transition-all cursor-pointer"
                                    title="Deactivate this seat in Udemy (SCIM)"
                                  >
                                    <ShieldOff className="w-3.5 h-3.5" />
                                    Deactivate
                                  </button>
                                ))}
                            </>
                          )}
                        </div>
                        {done[r.email] && done[r.email] !== "done" && (
                          <div className="text-[11px] text-rose-500 mt-1">{done[r.email]}</div>
                        )}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
            <TablePagination
              total={filteredRows.length}
              page={page}
              rowsPerPage={rowsPerPage}
              onPage={setPage}
              onRowsPerPage={(n) => { setRowsPerPage(n); setPage(0); }}
            />
          </div>

          {/* Mobile Cards Stack View */}
          <div className="block md:hidden flex flex-col gap-4">
            {pageRows.map((r, i) => (
              <InactiveSeatCard
                key={r.email || i}
                r={r}
                canProvision={canProvision}
                confirming={confirming}
                setConfirming={setConfirming}
                busy={busy}
                deactivate={deactivate}
                done={done}
              />
            ))}
            <TablePagination
              total={filteredRows.length}
              page={page}
              rowsPerPage={rowsPerPage}
              onPage={setPage}
              onRowsPerPage={(n) => { setRowsPerPage(n); setPage(0); }}
            />
          </div>
        </>
      )}
    </div>
  );
}

function ActivityTab({ authHeaders }: { authHeaders: Record<string, string> }) {
  const [rows, setRows] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [search, setSearch] = useState("");

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
    return <TableSkeleton />;
  }
  if (error) {
    return (
      <div className="flex items-start gap-3 rounded-2xl border border-rose-500/20 bg-rose-500/5 p-4 text-sm text-rose-700 dark:text-rose-450 max-w-xl animate-fade-in">
        <AlertCircle className="w-4.5 h-4.5 mt-0.5 shrink-0 text-rose-500" />
        <span>{error}</span>
      </div>
    );
  }
  if (!rows.length) {
    return (
      <div className="flex flex-col items-center justify-center py-20 text-slate-500 dark:text-zinc-400 gap-3 border border-slate-200 dark:border-zinc-800/80 rounded-2xl bg-white/70 dark:bg-zinc-900/60">
        <div className="w-14 h-14 rounded-3xl bg-slate-200/50 dark:bg-zinc-800 flex items-center justify-center">
          <Users className="w-7 h-7 text-slate-400/50" />
        </div>
        <p className="text-sm font-bold">No learner activity reported yet.</p>
      </div>
    );
  }

  const filteredRows = rows.filter((r) => matchesQuery(r, search.trim()));

  return (
    <div className="flex flex-col gap-5">
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div className="flex items-center gap-3">
          <div className="h-10 w-10 rounded-2xl bg-[#A435F0]/10 flex items-center justify-center border border-[#A435F0]/20">
            <TrendingUp className="w-5 h-5 text-[#A435F0]" />
          </div>
          <div>
            <p className="text-sm font-extrabold text-slate-800 dark:text-white">Learner Activity</p>
            <p className="text-xs text-slate-500 dark:text-zinc-400">
              {search.trim() ? `${filteredRows.length} of ${rows.length}` : `${rows.length} record(s)`}
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2 self-start md:self-auto">
          <ExportBtn href="/api/portal/udemy/export/user-activity" authHeaders={authHeaders} label="Export" />
          <button
            onClick={load}
            className="inline-flex items-center gap-1.5 text-xs font-semibold text-slate-600 dark:text-zinc-400 hover:text-slate-900 dark:hover:text-white bg-white dark:bg-zinc-900 border border-slate-200 dark:border-zinc-800/80 px-4 py-2.5 rounded-xl transition-all shadow-sm cursor-pointer"
          >
            <RefreshCw className="w-3.5 h-3.5" />
            Refresh
          </button>
        </div>
      </div>
      <TableSearch
        value={search}
        onChange={setSearch}
        placeholder="Search by learner, email, course…"
      />
      {filteredRows.length === 0 ? (
        <TableEmpty
          className="rounded-2xl border border-slate-200 dark:border-zinc-800/80 bg-white/70 dark:bg-zinc-900/60"
          icon={<Search className="w-7 h-7" />}
        >
          <span className="text-sm font-bold">No records match "{search.trim()}".</span>
        </TableEmpty>
      ) : (
        <ResponsiveTable rows={filteredRows} type="activity" />
      )}
    </div>
  );
}

// ── Export button (downloads via fetch + blob) ────────────────────────────────

function ExportBtn({
  href,
  authHeaders,
  label = "Export",
}: {
  href: string;
  authHeaders: Record<string, string>;
  label?: string;
}) {
  const [busy, setBusy] = useState(false);
  const download = async () => {
    setBusy(true);
    try {
      const r = await fetch(href, { headers: authHeaders });
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      const blob = await r.blob();
      const disposition = r.headers.get("content-disposition") || "";
      const match = disposition.match(/filename="?([^"]+)"?/);
      const name = match?.[1] || "export.xlsx";
      const a = document.createElement("a");
      a.href = URL.createObjectURL(blob);
      a.download = name;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(a.href);
    } catch {
      /* silently fail — user sees no file */
    } finally {
      setBusy(false);
    }
  };
  return (
    <button
      onClick={download}
      disabled={busy}
      className="inline-flex items-center gap-1.5 text-xs font-semibold text-slate-600 dark:text-zinc-400 hover:text-slate-900 dark:hover:text-white bg-white dark:bg-zinc-900 border border-slate-200 dark:border-zinc-800/80 px-3.5 py-2.5 rounded-xl transition-all shadow-sm cursor-pointer disabled:opacity-50"
    >
      {busy ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Download className="w-3.5 h-3.5" />}
      {label}
    </button>
  );
}

// ── Automations Tab ──────────────────────────────────────────────────────────

interface AutomationRule {
  id: number;
  name: string;
  description: string;
  frequency: string;
  day_of_week: number | null;
  day_of_month: number | null;
  hour: number;
  minute: number;
  email_subject: string;
  email_body: string;
  recipients_json: any[];
  extra_config: {
    inactive_days?: number;
    notify_mode?: string;
    filter_groups?: string[];
    filter_users?: string[];
    exclude_deactivated?: boolean;
    nudge_subject?: string;
    nudge_body?: string;
  };
  is_active: boolean;
  next_run: string | null;
  last_run: string | null;
  last_status: string | null;
  created_by: string;
  created_at: string | null;
  can_manage: boolean;
}

const FREQ_LABELS: Record<string, string> = { daily: "Daily", weekly: "Weekly", monthly: "Monthly" };
const DOW_LABELS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
const MODE_LABELS: Record<string, string> = {
  report: "Summary report to recipients",
  nudge: "Nudge emails to inactive users",
  both: "Report + nudge emails",
};

function fmtSchedule(r: AutomationRule) {
  const t = `${String(r.hour).padStart(2, "0")}:${String(r.minute || 0).padStart(2, "0")}`;
  if (r.frequency === "weekly" && r.day_of_week != null) return `${FREQ_LABELS.weekly} · ${DOW_LABELS[r.day_of_week]} · ${t}`;
  if (r.frequency === "monthly" && r.day_of_month != null) return `${FREQ_LABELS.monthly} · Day ${r.day_of_month} · ${t}`;
  return `${FREQ_LABELS[r.frequency] || r.frequency} · ${t}`;
}

function AutomationsTab({ authHeaders }: { authHeaders: Record<string, string> }) {
  const { user } = useAuth();
  const [rules, setRules] = useState<AutomationRule[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [showForm, setShowForm] = useState(false);
  const [editing, setEditing] = useState<AutomationRule | null>(null);
  const [busy, setBusy] = useState<number | null>(null);
  const [sendResult, setSendResult] = useState<Record<number, string>>({});

  const load = useCallback(() => {
    setLoading(true);
    setError("");
    fetch("/api/portal/udemy/automations", { headers: authHeaders })
      .then(async (r) => {
        if (!r.ok) throw new Error((await r.json().catch(() => ({}))).detail || `HTTP ${r.status}`);
        return r.json();
      })
      .then(setRules)
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => { load(); }, [load]);

  const toggle = async (id: number) => {
    setBusy(id);
    try {
      const r = await fetch(`/api/portal/udemy/automations/${id}/toggle`, { method: "PATCH", headers: authHeaders });
      if (!r.ok) throw new Error("Toggle failed");
      load();
    } catch {
    } finally {
      setBusy(null);
    }
  };

  const sendNow = async (id: number) => {
    setBusy(id);
    setSendResult((p) => ({ ...p, [id]: "sending…" }));
    try {
      const r = await fetch(`/api/portal/udemy/automations/${id}/send-now`, { method: "POST", headers: authHeaders });
      const body = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(body.detail || "Send failed");
      const parts: string[] = [];
      if (body.report_sent) parts.push("Report sent");
      if (body.nudges_sent > 0) parts.push(`${body.nudges_sent} nudge(s) sent`);
      if (body.inactive_count != null) parts.push(`${body.inactive_count} inactive`);
      setSendResult((p) => ({ ...p, [id]: parts.join(" · ") || "Sent" }));
    } catch (e: any) {
      setSendResult((p) => ({ ...p, [id]: e.message || "Failed" }));
    } finally {
      setBusy(null);
    }
  };

  const deleteRule = async (id: number) => {
    if (!confirm("Delete this automation?")) return;
    setBusy(id);
    try {
      await fetch(`/api/portal/udemy/automations/${id}`, { method: "DELETE", headers: authHeaders });
      load();
    } catch {
    } finally {
      setBusy(null);
    }
  };

  const onSaved = () => {
    setShowForm(false);
    setEditing(null);
    load();
  };

  return (
    <div className="flex flex-col gap-5">
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div className="flex items-center gap-3">
          <div className="h-10 w-10 rounded-2xl bg-[#A435F0]/10 flex items-center justify-center border border-[#A435F0]/20">
            <Bell className="w-5 h-5 text-[#A435F0]" />
          </div>
          <div>
            <p className="text-sm font-extrabold text-slate-800 dark:text-white">Notification Automations</p>
            <p className="text-xs text-slate-500 dark:text-zinc-400">
              Create scheduled notifications for inactive Udemy users
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2 self-start md:self-auto">
          <button
            onClick={load}
            className="inline-flex items-center gap-1.5 text-xs font-semibold text-slate-600 dark:text-zinc-400 hover:text-slate-900 dark:hover:text-white bg-white dark:bg-zinc-900 border border-slate-200 dark:border-zinc-800/80 px-4 py-2.5 rounded-xl transition-all shadow-sm cursor-pointer"
          >
            <RefreshCw className="w-3.5 h-3.5" />
            Refresh
          </button>
          <button
            onClick={() => { setEditing(null); setShowForm(true); }}
            className="inline-flex items-center gap-1.5 text-xs font-bold text-white bg-gradient-to-r from-[#A435F0] to-[#7C3AED] hover:opacity-95 px-4 py-2.5 rounded-xl transition-all shadow-md shadow-purple-500/15 cursor-pointer"
          >
            <Plus className="w-3.5 h-3.5" />
            New Automation
          </button>
        </div>
      </div>

      {error && (
        <div className="flex items-start gap-3 rounded-2xl border border-rose-500/20 bg-rose-500/5 p-4 text-sm text-rose-700 dark:text-rose-400 max-w-xl animate-fade-in">
          <AlertCircle className="w-4.5 h-4.5 mt-0.5 shrink-0 text-rose-500" />
          <span>{error}</span>
        </div>
      )}

      <AnimatePresence>
        {showForm && (
          <motion.div
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: "auto" }}
            exit={{ opacity: 0, height: 0 }}
            className="overflow-hidden"
          >
            <AutomationForm
              authHeaders={authHeaders}
              editing={editing}
              onSaved={onSaved}
              onCancel={() => { setShowForm(false); setEditing(null); }}
            />
          </motion.div>
        )}
      </AnimatePresence>

      {loading ? (
        <TableSkeleton />
      ) : rules.length === 0 && !showForm ? (
        <div className="flex flex-col items-center justify-center py-20 text-slate-500 dark:text-zinc-400 gap-3 border border-slate-200 dark:border-zinc-800/80 rounded-2xl bg-white/70 dark:bg-zinc-900/60">
          <div className="w-14 h-14 rounded-3xl bg-violet-500/10 flex items-center justify-center border border-violet-500/25">
            <Bell className="w-7 h-7 text-violet-500/50" />
          </div>
          <p className="text-sm font-bold">No automations yet</p>
          <p className="text-xs text-slate-400 dark:text-zinc-500 text-center max-w-xs leading-relaxed">
            Create a notification rule to automatically email inactive learners or send reports to PMO on a schedule.
          </p>
        </div>
      ) : (
        <div className="flex flex-col gap-4">
          {rules.map((r) => (
            <motion.div
              key={r.id}
              layout
              className={cn(
                "rounded-2xl border bg-white/70 dark:bg-zinc-900/60 backdrop-blur-md p-5 shadow-sm transition-all",
                r.is_active ? "border-slate-200 dark:border-zinc-800/80" : "border-slate-200/60 dark:border-zinc-800/40 opacity-60"
              )}
            >
              <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
                <div className="flex items-start gap-3 min-w-0">
                  <div className={cn(
                    "w-9 h-9 rounded-xl flex items-center justify-center shrink-0 mt-0.5",
                    r.is_active ? "bg-emerald-500/10 border border-emerald-500/20" : "bg-slate-200/50 dark:bg-zinc-800 border border-slate-200 dark:border-zinc-800"
                  )}>
                    {r.is_active ? <Bell className="w-4 h-4 text-emerald-500" /> : <Bell className="w-4 h-4 text-slate-400" />}
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2 flex-wrap">
                      <h4 className="text-sm font-extrabold text-slate-800 dark:text-white truncate">{r.name}</h4>
                      <Badge variant={r.is_active ? "default" : "secondary"} className="text-[10px] py-0 px-1.5 font-bold">
                        {r.is_active ? "Active" : "Paused"}
                      </Badge>
                    </div>
                    {r.description && <p className="text-xs text-slate-500 dark:text-zinc-400 mt-0.5 truncate">{r.description}</p>}
                    <div className="flex flex-wrap gap-x-4 gap-y-1 mt-2 text-[11px] text-slate-500 dark:text-zinc-400">
                      <span className="font-semibold">{fmtSchedule(r)}</span>
                      <span>{r.extra_config?.inactive_days || 30}+ days idle</span>
                      <span>{MODE_LABELS[r.extra_config?.notify_mode || "report"]}</span>
                      {(r.extra_config?.filter_groups?.length ?? 0) > 0 && (
                        <span className="flex items-center gap-1"><Filter className="w-3 h-3" />{r.extra_config.filter_groups!.join(", ")}</span>
                      )}
                    </div>
                    <div className="flex flex-wrap gap-x-4 gap-y-1 mt-1.5 text-[11px] text-slate-400 dark:text-zinc-500">
                      {r.next_run && <span>Next: {new Date(r.next_run).toLocaleString()}</span>}
                      {r.last_run && <span>Last: {new Date(r.last_run).toLocaleString()}</span>}
                      {r.last_status && <span className={r.last_status.startsWith("sent") ? "text-emerald-500" : "text-rose-400"}>{r.last_status}</span>}
                    </div>
                    {sendResult[r.id] && (
                      <div className="mt-1.5 text-xs font-semibold text-emerald-600 dark:text-emerald-400">
                        {sendResult[r.id]}
                      </div>
                    )}
                  </div>
                </div>

                <div className="flex items-center gap-1.5 shrink-0 self-start md:self-center">
                  <button
                    onClick={() => toggle(r.id)}
                    disabled={busy === r.id}
                    title={r.is_active ? "Pause" : "Activate"}
                    className={cn(
                      "p-2.5 rounded-xl border transition-all cursor-pointer",
                      r.is_active
                        ? "text-amber-600 dark:text-amber-400 border-amber-500/20 hover:bg-amber-500/10"
                        : "text-emerald-600 dark:text-emerald-400 border-emerald-500/20 hover:bg-emerald-500/10"
                    )}
                  >
                    <Power className="w-3.5 h-3.5" />
                  </button>
                  <button
                    onClick={() => sendNow(r.id)}
                    disabled={busy === r.id}
                    title="Send now"
                    className="p-2.5 rounded-xl border border-blue-500/20 text-blue-600 dark:text-blue-400 hover:bg-blue-500/10 transition-all cursor-pointer"
                  >
                    {busy === r.id ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Send className="w-3.5 h-3.5" />}
                  </button>
                  <button
                    onClick={() => { setEditing(r); setShowForm(true); }}
                    title="Edit"
                    className="p-2.5 rounded-xl border border-slate-200 dark:border-zinc-800 text-slate-500 dark:text-zinc-400 hover:bg-slate-100 dark:hover:bg-zinc-800 transition-all cursor-pointer"
                  >
                    <Pencil className="w-3.5 h-3.5" />
                  </button>
                  <button
                    onClick={() => deleteRule(r.id)}
                    disabled={busy === r.id}
                    title="Delete"
                    className="p-2.5 rounded-xl border border-rose-500/20 text-rose-500 hover:bg-rose-500/10 transition-all cursor-pointer"
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                </div>
              </div>
            </motion.div>
          ))}
        </div>
      )}
    </div>
  );
}

// ── Automation Form (Create / Edit) ──────────────────────────────────────────

function AutomationForm({
  authHeaders,
  editing,
  onSaved,
  onCancel,
}: {
  authHeaders: Record<string, string>;
  editing: AutomationRule | null;
  onSaved: () => void;
  onCancel: () => void;
}) {
  const { user } = useAuth();
  const cfg = editing?.extra_config || {};

  const [name, setName] = useState(editing?.name || "");
  const [description, setDescription] = useState(editing?.description || "");
  const [frequency, setFrequency] = useState(editing?.frequency || "weekly");
  const [dayOfWeek, setDayOfWeek] = useState<number>(editing?.day_of_week ?? 0);
  const [dayOfMonth, setDayOfMonth] = useState<number>(editing?.day_of_month ?? 1);
  const [hour, setHour] = useState(editing?.hour ?? 9);
  const [minute, setMinute] = useState(editing?.minute ?? 0);
  const [subject, setSubject] = useState(editing?.email_subject || "Udemy Business — Inactive Seats Report");
  const [body, setBody] = useState(editing?.email_body || "");
  const [inactiveDays, setInactiveDays] = useState(cfg.inactive_days ?? 30);
  const [notifyMode, setNotifyMode] = useState(cfg.notify_mode || "report");
  const [filterGroups, setFilterGroups] = useState<string[]>(cfg.filter_groups || []);
  const [nudgeSubject, setNudgeSubject] = useState(cfg.nudge_subject || "");
  const [nudgeBody, setNudgeBody] = useState(cfg.nudge_body || "");
  const [isActive, setIsActive] = useState(editing?.is_active ?? true);

  const [recipientSearch, setRecipientSearch] = useState("");
  const [recipientResults, setRecipientResults] = useState<{ name: string; email: string }[]>([]);
  const [recipients, setRecipients] = useState<{ type: string; email: string; name: string }[]>(
    (editing?.recipients_json || []).filter((r: any) => r.type === "individual")
  );

  const [availableGroups, setAvailableGroups] = useState<string[]>([]);
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState("");

  useEffect(() => {
    fetch("/api/portal/udemy/groups", { headers: authHeaders })
      .then((r) => r.json())
      .then((d) => setAvailableGroups(d.groups || []))
      .catch(() => {});
  }, []);

  useEffect(() => {
    if (recipientSearch.length < 2) { setRecipientResults([]); return; }
    const t = setTimeout(() => {
      fetch(`/api/automation/ms365/users/search?q=${encodeURIComponent(recipientSearch)}`, { headers: authHeaders })
        .then((r) => r.json())
        .then((d) => setRecipientResults(Array.isArray(d) ? d : []))
        .catch(() => setRecipientResults([]));
    }, 300);
    return () => clearTimeout(t);
  }, [recipientSearch]);

  const addRecipient = (r: { name: string; email: string }) => {
    if (!recipients.find((x) => x.email.toLowerCase() === r.email.toLowerCase())) {
      setRecipients((p) => [...p, { type: "individual", email: r.email, name: r.name }]);
    }
    setRecipientSearch("");
    setRecipientResults([]);
  };

  const removeRecipient = (email: string) => {
    setRecipients((p) => p.filter((r) => r.email !== email));
  };

  const toggleGroup = (g: string) => {
    setFilterGroups((p) => p.includes(g) ? p.filter((x) => x !== g) : [...p, g]);
  };

  const save = async () => {
    if (!name.trim() || !subject.trim()) { setErr("Name and email subject are required."); return; }
    if (notifyMode !== "nudge" && recipients.length === 0) { setErr("Add at least one report recipient."); return; }
    setSaving(true);
    setErr("");

    const payload: any = {
      name: name.trim(),
      description: description.trim(),
      frequency,
      day_of_week: frequency === "weekly" ? dayOfWeek : null,
      day_of_month: frequency === "monthly" ? dayOfMonth : null,
      hour,
      minute,
      email_subject: subject.trim(),
      email_body: body.trim(),
      recipients_json: recipients,
      inactive_days: inactiveDays,
      notify_mode: notifyMode,
      filter_groups: filterGroups,
      filter_users: [],
      exclude_deactivated: true,
      nudge_subject: nudgeSubject.trim(),
      nudge_body: nudgeBody.trim(),
      is_active: isActive,
    };

    try {
      const url = editing ? `/api/portal/udemy/automations/${editing.id}` : "/api/portal/udemy/automations";
      const method = editing ? "PATCH" : "POST";
      const r = await fetch(url, { method, headers: authHeaders, body: JSON.stringify(payload) });
      const b = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(b.detail || `HTTP ${r.status}`);
      onSaved();
    } catch (e: any) {
      setErr(e.message || "Save failed");
    } finally {
      setSaving(false);
    }
  };

  const inputCls = "w-full px-3.5 py-2.5 rounded-xl border border-slate-200 dark:border-zinc-800/80 bg-white dark:bg-zinc-900 text-sm text-slate-800 dark:text-white placeholder-slate-400 dark:placeholder-zinc-500 focus:outline-none focus:ring-2 focus:ring-[#A435F0]/30 focus:border-[#A435F0] transition-all";
  const labelCls = "text-xs font-bold text-slate-600 dark:text-zinc-400 uppercase tracking-wider";
  const selectCls = cn(inputCls, "cursor-pointer appearance-none");

  return (
    <div className="rounded-2xl border border-[#A435F0]/20 bg-white/90 dark:bg-zinc-900/90 backdrop-blur-md p-6 shadow-lg">
      <div className="flex items-center justify-between mb-5">
        <h3 className="text-sm font-extrabold text-slate-800 dark:text-white">
          {editing ? "Edit Automation" : "New Automation"}
        </h3>
        <button onClick={onCancel} className="p-1.5 rounded-lg hover:bg-slate-100 dark:hover:bg-zinc-800 cursor-pointer">
          <X className="w-4 h-4 text-slate-400" />
        </button>
      </div>

      {err && (
        <div className="mb-4 text-xs text-rose-600 dark:text-rose-400 font-semibold bg-rose-500/5 border border-rose-500/20 rounded-xl px-3.5 py-2.5">
          {err}
        </div>
      )}

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {/* Name */}
        <div className="flex flex-col gap-1.5">
          <label className={labelCls}>Name</label>
          <input className={inputCls} value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Weekly Inactive Report" />
        </div>

        {/* Description */}
        <div className="flex flex-col gap-1.5">
          <label className={labelCls}>Description</label>
          <input className={inputCls} value={description} onChange={(e) => setDescription(e.target.value)} placeholder="Optional" />
        </div>

        {/* Schedule */}
        <div className="flex flex-col gap-1.5">
          <label className={labelCls}>Frequency</label>
          <select className={selectCls} value={frequency} onChange={(e) => setFrequency(e.target.value)}>
            <option value="daily">Daily (weekdays)</option>
            <option value="weekly">Weekly</option>
            <option value="monthly">Monthly</option>
          </select>
        </div>

        {frequency === "weekly" && (
          <div className="flex flex-col gap-1.5">
            <label className={labelCls}>Day of Week</label>
            <select className={selectCls} value={dayOfWeek} onChange={(e) => setDayOfWeek(Number(e.target.value))}>
              {DOW_LABELS.map((d, i) => <option key={i} value={i}>{d}</option>)}
            </select>
          </div>
        )}

        {frequency === "monthly" && (
          <div className="flex flex-col gap-1.5">
            <label className={labelCls}>Day of Month</label>
            <select className={selectCls} value={dayOfMonth} onChange={(e) => setDayOfMonth(Number(e.target.value))}>
              {Array.from({ length: 28 }, (_, i) => i + 1).map((d) => <option key={d} value={d}>{d}</option>)}
            </select>
          </div>
        )}

        <div className="flex gap-3">
          <div className="flex flex-col gap-1.5 flex-1">
            <label className={labelCls}>Hour</label>
            <select className={selectCls} value={hour} onChange={(e) => setHour(Number(e.target.value))}>
              {Array.from({ length: 24 }, (_, i) => <option key={i} value={i}>{String(i).padStart(2, "0")}:00</option>)}
            </select>
          </div>
          <div className="flex flex-col gap-1.5 flex-1">
            <label className={labelCls}>Minute</label>
            <select className={selectCls} value={minute} onChange={(e) => setMinute(Number(e.target.value))}>
              {[0, 15, 30, 45].map((m) => <option key={m} value={m}>:{String(m).padStart(2, "0")}</option>)}
            </select>
          </div>
        </div>

        {/* Inactive days */}
        <div className="flex flex-col gap-1.5">
          <label className={labelCls}>Idle Days Threshold</label>
          <input type="number" className={inputCls} min={1} max={3650} value={inactiveDays}
            onChange={(e) => setInactiveDays(Number(e.target.value) || 30)} />
        </div>

        {/* Notify mode */}
        <div className="flex flex-col gap-1.5">
          <label className={labelCls}>Notification Mode</label>
          <select className={selectCls} value={notifyMode} onChange={(e) => setNotifyMode(e.target.value)}>
            <option value="report">Summary report to recipients only</option>
            <option value="nudge">Nudge emails to inactive users only</option>
            <option value="both">Report + nudge emails</option>
          </select>
        </div>

        {/* Email subject */}
        <div className="flex flex-col gap-1.5 md:col-span-2">
          <label className={labelCls}>Report Email Subject</label>
          <input className={inputCls} value={subject} onChange={(e) => setSubject(e.target.value)} />
        </div>

        {/* Email body */}
        <div className="flex flex-col gap-1.5 md:col-span-2">
          <label className={labelCls}>Report Intro Text (optional)</label>
          <textarea className={cn(inputCls, "min-h-[70px] resize-y")} value={body} onChange={(e) => setBody(e.target.value)}
            placeholder="Custom message at the top of the report email" />
        </div>

        {/* Nudge fields (shown when mode includes nudge) */}
        {(notifyMode === "nudge" || notifyMode === "both") && (
          <>
            <div className="flex flex-col gap-1.5 md:col-span-2">
              <label className={labelCls}>Nudge Email Subject</label>
              <input className={inputCls} value={nudgeSubject} onChange={(e) => setNudgeSubject(e.target.value)}
                placeholder="Your Udemy Business account needs attention" />
            </div>
            <div className="flex flex-col gap-1.5 md:col-span-2">
              <label className={labelCls}>Nudge Email Body</label>
              <textarea className={cn(inputCls, "min-h-[70px] resize-y")} value={nudgeBody} onChange={(e) => setNudgeBody(e.target.value)}
                placeholder="Message sent to each inactive learner" />
            </div>
          </>
        )}

        {/* Group filter */}
        {availableGroups.length > 0 && (
          <div className="flex flex-col gap-1.5 md:col-span-2">
            <label className={labelCls}>Filter by Udemy Groups (optional — blank = all)</label>
            <div className="flex flex-wrap gap-2 p-3 rounded-xl border border-slate-200 dark:border-zinc-800/80 bg-slate-50/50 dark:bg-zinc-950/50 max-h-[120px] overflow-y-auto">
              {availableGroups.map((g) => (
                <button
                  key={g}
                  type="button"
                  onClick={() => toggleGroup(g)}
                  className={cn(
                    "px-3 py-1.5 rounded-lg text-xs font-semibold border transition-all cursor-pointer",
                    filterGroups.includes(g)
                      ? "bg-[#A435F0] text-white border-[#A435F0]"
                      : "bg-white dark:bg-zinc-900 text-slate-600 dark:text-zinc-400 border-slate-200 dark:border-zinc-800 hover:border-[#A435F0]/50"
                  )}
                >
                  {g}
                </button>
              ))}
            </div>
          </div>
        )}

        {/* Recipients (report goes to these people) */}
        {notifyMode !== "nudge" && (
          <div className="flex flex-col gap-1.5 md:col-span-2">
            <label className={labelCls}>Report Recipients (PMO / Admin emails)</label>
            <div className="flex flex-wrap gap-1.5 mb-2">
              {recipients.map((r) => (
                <span key={r.email} className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg bg-violet-500/10 text-violet-700 dark:text-violet-300 text-xs font-semibold border border-violet-500/20">
                  <Mail className="w-3 h-3" />
                  {r.name || r.email}
                  <button onClick={() => removeRecipient(r.email)} className="ml-0.5 hover:text-rose-500 cursor-pointer">
                    <X className="w-3 h-3" />
                  </button>
                </span>
              ))}
            </div>
            <div className="relative">
              <input
                className={inputCls}
                value={recipientSearch}
                onChange={(e) => setRecipientSearch(e.target.value)}
                placeholder="Search by name or email…"
              />
              {recipientResults.length > 0 && (
                <div className="absolute z-20 top-full left-0 right-0 mt-1 rounded-xl border border-slate-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 shadow-lg max-h-[200px] overflow-y-auto">
                  {recipientResults.map((r) => (
                    <button
                      key={r.email}
                      onClick={() => addRecipient(r)}
                      className="w-full text-left px-3.5 py-2.5 text-sm hover:bg-violet-500/5 transition-colors cursor-pointer flex items-center gap-2"
                    >
                      <UserAvatar name={r.name} email={r.email} />
                      <div>
                        <div className="font-bold text-slate-800 dark:text-white text-xs">{r.name}</div>
                        <div className="text-[11px] text-slate-400">{r.email}</div>
                      </div>
                    </button>
                  ))}
                </div>
              )}
            </div>
          </div>
        )}

        {/* Active toggle */}
        <div className="flex items-center gap-3 md:col-span-2">
          <button
            type="button"
            onClick={() => setIsActive(!isActive)}
            className={cn(
              "w-10 h-6 rounded-full transition-colors cursor-pointer relative",
              isActive ? "bg-emerald-500" : "bg-slate-300 dark:bg-zinc-700"
            )}
          >
            <span className={cn(
              "absolute top-0.5 w-5 h-5 rounded-full bg-white shadow transition-transform",
              isActive ? "left-[18px]" : "left-0.5"
            )} />
          </button>
          <span className="text-xs font-bold text-slate-600 dark:text-zinc-400">
            {isActive ? "Active — will fire on schedule" : "Paused — won't fire until enabled"}
          </span>
        </div>
      </div>

      <div className="flex items-center justify-end gap-3 mt-6 pt-4 border-t border-slate-200 dark:border-zinc-800/80">
        <button
          onClick={onCancel}
          className="px-5 py-2.5 rounded-xl text-xs font-bold text-slate-600 dark:text-zinc-400 hover:bg-slate-100 dark:hover:bg-zinc-800 border border-slate-200 dark:border-zinc-800 transition-all cursor-pointer"
        >
          Cancel
        </button>
        <button
          onClick={save}
          disabled={saving}
          className="px-6 py-2.5 rounded-xl text-xs font-bold text-white bg-gradient-to-r from-[#A435F0] to-[#7C3AED] hover:opacity-95 disabled:opacity-60 shadow-md shadow-purple-500/15 transition-all cursor-pointer"
        >
          {saving ? <Loader2 className="w-3.5 h-3.5 animate-spin inline mr-1.5" /> : null}
          {editing ? "Update Automation" : "Create Automation"}
        </button>
      </div>
    </div>
  );
}
