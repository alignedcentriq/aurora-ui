import { useAuth } from "@/lib/auth-store";
import { useState, useCallback, useEffect } from "react";
import {
  Search,
  Users,
  Briefcase,
  Clock,
  ChevronDown,
  ChevronUp,
  ChevronLeft,
  ChevronRight,
  Loader2,
  Shield,
  X,
  SlidersHorizontal,
  Award,
  BookOpen,
  Star,
  Lightbulb,
  UserCheck,
  FolderOpen,
  Languages,
  BadgeInfo,
  Trophy,
  Building2,
  ZoomIn,
} from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { Skeleton } from "@/components/ui/skeleton";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";

const SEARCH_ROLES = new Set(["HR", "PMO", "Admin", "Functional Manager", "Super Admin"]);

interface Project {
  project: string;
  sub_project: string | null;
  client: string | null;
  status: string | null;
  efforts_pct: number | null;
  billability_pct: number | null;
  date: string | null;
  delivery_manager: string | null;
  project_lead: string | null;
  project_type: string | null;
  billing: string | null;
}

interface Appreciation {
  id: number;
  title: string;
  description: string | null;
  client_name: string | null;
  has_screenshot: boolean;
  added_by_name: string | null;
  added_by_email: string;
  created_at: string | null;
}

interface Person {
  name: string;
  email: string;
  designation: string | null;
  function: string | null;
  // Skills
  skills: string | null;
  primary_skills: string | null;
  secondary_skills: string | null;
  expertise: string | null;
  can_teach: string | null;
  certifications: string | null;
  // Profile
  about_me: string | null;
  language_known: string | null;
  level: string | null;
  grade: string | null;
  total_experience: string | null;
  joining_date: string | null;
  reporting_manager: string | null;
  functional_manager: string | null;
  status: string | null;
  appreciation_count: number;
  projects: Project[];
}

function initials(name: string) {
  return name
    .split(" ")
    .map((n) => n[0])
    .join("")
    .slice(0, 2)
    .toUpperCase();
}

function SkillTag({ label, color = "primary" }: { label: string; color?: string }) {
  const colorMap: Record<string, string> = {
    primary:
      "bg-[#00a29a]/10 dark:bg-primary/10 text-[#00a29a] dark:text-primary/90 border-[#00a29a]/20 dark:border-primary/20",
    amber: "bg-amber-500/10 text-amber-600 dark:text-amber-400 border-amber-500/20",
    emerald: "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border-emerald-500/20",
    violet: "bg-violet-500/10 text-violet-600 dark:text-violet-400 border-violet-500/20",
    cyan: "bg-cyan-500/10 text-cyan-600 dark:text-cyan-400 border-cyan-500/20",
  };
  return (
    <span
      className={cn(
        "inline-flex items-center rounded-full border px-2.5 py-0.5 text-[11px] font-medium",
        colorMap[color] ?? colorMap.primary,
      )}
    >
      {label}
    </span>
  );
}

function SectionLabel({ icon: Icon, label }: { icon: React.ElementType; label: string }) {
  return (
    <p className="flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-widest text-muted-foreground/50 mb-2">
      <Icon className="h-3 w-3" />
      {label}
    </p>
  );
}

function PersonCard({ person }: { person: Person }) {
  const [expanded, setExpanded] = useState(false);
  const [appreciations, setAppreciations] = useState<Appreciation[] | null>(null);
  const [lightboxSrc, setLightboxSrc] = useState<string | null>(null);

  const primarySkills =
    (person.primary_skills || person.skills)
      ?.split(",")
      .map((s) => s.trim())
      .filter(Boolean) ?? [];
  const secondarySkills =
    (person.secondary_skills || person.expertise)
      ?.split(",")
      .map((s) => s.trim())
      .filter(Boolean) ?? [];
  const canTeach =
    (person.can_teach || person.expertise)
      ?.split(",")
      .map((s) => s.trim())
      .filter(Boolean) ?? [];
  const certs =
    person.certifications
      ?.split(",")
      .map((s) => s.trim())
      .filter(Boolean) ?? [];
  const activeProjects = person.projects.filter(
    (p) => p.status && ["active", "in progress"].some((k) => p.status!.toLowerCase().includes(k)),
  );
  const recentProject = person.projects[0];

  useEffect(() => {
    if (expanded && appreciations === null && person.email) {
      fetch(`/api/appreciations/employee/${encodeURIComponent(person.email)}`)
        .then((r) => (r.ok ? r.json() : []))
        .then(setAppreciations)
        .catch(() => setAppreciations([]));
    }
  }, [expanded, person.email, appreciations]);

  return (
    <div className="rounded-2xl border border-[#e2e8f0] dark:border-white/[0.08] bg-white dark:bg-card overflow-hidden transition-all hover:shadow-md hover:border-[#00a29a]/20 dark:hover:border-primary/20">
      {/* Card Header */}
      <div className="p-5">
        <div className="flex items-start gap-4">
          <div className="relative shrink-0">
            <div className="h-14 w-14 rounded-2xl bg-gradient-to-br from-[#00a29a]/20 to-[#0d9488]/20 dark:from-primary/20 dark:to-primary/5 text-[#00a29a] dark:text-primary flex items-center justify-center text-[16px] font-bold border border-[#00a29a]/10 dark:border-primary/10">
              {initials(person.name || "?")}
            </div>
            {person.status && (
              <span
                className={cn(
                  "absolute -bottom-1 -right-1 h-4 w-4 rounded-full border-2 border-white dark:border-card",
                  person.status.toLowerCase().includes("active")
                    ? "bg-emerald-500"
                    : "bg-[#94a3b8]",
                )}
              />
            )}
          </div>

          <div className="flex-1 min-w-0">
            <div className="flex items-start justify-between gap-2">
              <div>
                <p className="text-[15px] font-bold text-[#0f172a] dark:text-white leading-tight">
                  {person.name}
                </p>
                <p className="text-[13px] text-[#00a29a] dark:text-primary/70 font-semibold mt-0.5">
                  {person.designation || "—"}
                </p>
              </div>
              <div className="flex items-center gap-1.5 shrink-0">
                {person.appreciation_count > 0 && (
                  <span className="flex items-center gap-1 text-[10px] font-semibold px-2 py-0.5 rounded-full bg-amber-500/10 text-amber-600 dark:text-amber-400 border border-amber-500/20">
                    <Trophy className="h-3 w-3" />
                    {person.appreciation_count}
                  </span>
                )}
                {(person.level || person.grade) && (
                  <span className="text-[10px] font-semibold px-2 py-0.5 rounded-full bg-violet-500/10 text-violet-600 dark:text-violet-400 border border-violet-500/20">
                    {[person.level, person.grade].filter(Boolean).join(" · ")}
                  </span>
                )}
              </div>
            </div>

            <div className="mt-2 flex flex-wrap gap-x-3 gap-y-1 text-[12px] text-[#64748b] dark:text-white/50">
              {person.function && (
                <span className="flex items-center gap-1">
                  <Briefcase className="h-3 w-3" />
                  {person.function}
                </span>
              )}
              {person.total_experience && (
                <span className="flex items-center gap-1">
                  <Clock className="h-3 w-3" />
                  {person.total_experience} yrs
                </span>
              )}
              {person.reporting_manager && (
                <span className="flex items-center gap-1">
                  <UserCheck className="h-3 w-3" />
                  {person.reporting_manager}
                </span>
              )}
            </div>

            {/* Primary Skills Preview */}
            {primarySkills.length > 0 && (
              <div className="mt-3 flex flex-wrap gap-1.5">
                {primarySkills.slice(0, 6).map((s) => (
                  <SkillTag key={s} label={s} color="primary" />
                ))}
                {primarySkills.length > 6 && (
                  <SkillTag label={`+${primarySkills.length - 6} more`} color="primary" />
                )}
              </div>
            )}

            {/* Recent Project Preview */}
            {recentProject && (
              <div className="mt-3 rounded-xl bg-[#f8fafc] dark:bg-muted/40 border border-[#e2e8f0] dark:border-white/[0.08] px-3 py-2 text-[12px] flex items-center gap-2">
                <FolderOpen className="h-3.5 w-3.5 text-[#94a3b8] dark:text-muted-foreground shrink-0" />
                <span className="font-medium text-[#0f172a] dark:text-white truncate">
                  {recentProject.project}
                </span>
                {recentProject.client && (
                  <span className="text-[#94a3b8] dark:text-muted-foreground shrink-0">
                    · {recentProject.client}
                  </span>
                )}
                {activeProjects.length > 0 && (
                  <span className="ml-auto shrink-0 rounded-full bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 px-1.5 py-0.5 text-[10px] font-semibold">
                    {activeProjects.length} active
                  </span>
                )}
              </div>
            )}
          </div>
        </div>

        <button
          onClick={() => setExpanded((v) => !v)}
          className="mt-4 w-full flex items-center justify-center gap-1.5 rounded-xl py-2 text-[12px] font-medium text-[#94a3b8] dark:text-muted-foreground hover:text-[#00a29a] dark:hover:text-primary hover:bg-[#00a29a]/5 dark:hover:bg-primary/5 transition-all border border-[#e2e8f0] dark:border-white/[0.08]"
        >
          {expanded ? (
            <ChevronUp className="h-3.5 w-3.5" />
          ) : (
            <ChevronDown className="h-3.5 w-3.5" />
          )}
          {expanded ? "Show less" : `Full profile · ${person.projects.length} project(s)`}
        </button>
      </div>

      {/* Expanded Details */}
      {expanded && (
        <div className="border-t border-[var(--border)] bg-muted/10 px-5 py-5 space-y-5">
          {/* Identity Row */}
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-3 text-[12px]">
            {person.email && (
              <div className="col-span-2 sm:col-span-1">
                <p className="text-muted-foreground/50 text-[10px] font-semibold uppercase tracking-wider mb-0.5">
                  Email
                </p>
                <p className="text-foreground truncate">{person.email}</p>
              </div>
            )}
            {person.reporting_manager && (
              <div>
                <p className="text-muted-foreground/50 text-[10px] font-semibold uppercase tracking-wider mb-0.5">
                  Reporting Manager
                </p>
                <p className="text-foreground">{person.reporting_manager}</p>
              </div>
            )}
            {person.functional_manager && (
              <div>
                <p className="text-muted-foreground/50 text-[10px] font-semibold uppercase tracking-wider mb-0.5">
                  Functional Manager
                </p>
                <p className="text-foreground">{person.functional_manager}</p>
              </div>
            )}
            {person.joining_date && (
              <div>
                <p className="text-muted-foreground/50 text-[10px] font-semibold uppercase tracking-wider mb-0.5">
                  Joined
                </p>
                <p className="text-foreground">
                  {new Date(person.joining_date).toLocaleDateString("en-IN", {
                    day: "numeric",
                    month: "short",
                    year: "numeric",
                  })}
                </p>
              </div>
            )}
            {person.language_known && (
              <div>
                <p className="text-muted-foreground/50 text-[10px] font-semibold uppercase tracking-wider mb-0.5">
                  Languages
                </p>
                <p className="text-foreground flex items-center gap-1">
                  <Languages className="h-3 w-3" />
                  {person.language_known}
                </p>
              </div>
            )}
          </div>

          {/* About Me */}
          {person.about_me && (
            <div>
              <SectionLabel icon={BadgeInfo} label="About" />
              <p className="text-[12px] text-muted-foreground leading-relaxed italic">
                &ldquo;{person.about_me}&rdquo;
              </p>
            </div>
          )}

          {/* Primary Skills */}
          {primarySkills.length > 0 && (
            <div>
              <SectionLabel icon={Star} label="Primary Skills" />
              <div className="flex flex-wrap gap-1.5">
                {primarySkills.map((s) => (
                  <SkillTag key={s} label={s} color="primary" />
                ))}
              </div>
            </div>
          )}

          {/* Secondary Skills */}
          {secondarySkills.length > 0 && (
            <div>
              <SectionLabel icon={BookOpen} label="Secondary Skills / Skill Set Board" />
              <div className="flex flex-wrap gap-1.5">
                {secondarySkills.map((s) => (
                  <SkillTag key={s} label={s} color="amber" />
                ))}
              </div>
            </div>
          )}

          {/* What They Can Teach */}
          {canTeach.length > 0 && (
            <div>
              <SectionLabel icon={Lightbulb} label="Can Teach / Mentor Others In" />
              <div className="flex flex-wrap gap-1.5">
                {canTeach.map((s) => (
                  <SkillTag key={s} label={s} color="emerald" />
                ))}
              </div>
            </div>
          )}

          {/* Certifications */}
          {certs.length > 0 && (
            <div>
              <SectionLabel icon={Award} label="Certifications" />
              <div className="flex flex-wrap gap-1.5">
                {certs.map((c) => (
                  <SkillTag key={c} label={c} color="violet" />
                ))}
              </div>
            </div>
          )}

          {/* Project Allocations */}
          {person.projects.length > 0 && (
            <div>
              <SectionLabel
                icon={FolderOpen}
                label={`Project Allocations (${person.projects.length})`}
              />
              <div className="space-y-2">
                {person.projects.map((p, i) => (
                  <div
                    key={i}
                    className="rounded-xl border border-[var(--border)] bg-card px-4 py-3 text-[12px]"
                  >
                    <div className="flex items-start justify-between gap-2">
                      <div className="flex-1 min-w-0">
                        <p className="font-semibold text-foreground truncate">
                          {p.project}
                          {p.sub_project ? ` — ${p.sub_project}` : ""}
                        </p>
                        <div className="flex flex-wrap gap-x-3 gap-y-0.5 mt-1 text-muted-foreground">
                          {p.client && <span>{p.client}</span>}
                          {p.project_lead && <span>Lead: {p.project_lead}</span>}
                          {p.delivery_manager && <span>DM: {p.delivery_manager}</span>}
                          {p.project_type && <span>{p.project_type}</span>}
                          {p.billing && <span>{p.billing}</span>}
                        </div>
                      </div>
                      <div className="text-right shrink-0 space-y-1">
                        {p.status && (
                          <span
                            className={cn(
                              "text-[10px] font-semibold px-2 py-0.5 rounded-full",
                              ["active", "in progress"].some((k) =>
                                p.status!.toLowerCase().includes(k),
                              )
                                ? "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400"
                                : "bg-muted text-muted-foreground",
                            )}
                          >
                            {p.status}
                          </span>
                        )}
                        {p.efforts_pct != null && (
                          <p className="text-muted-foreground">{p.efforts_pct}% effort</p>
                        )}
                        {p.billability_pct != null && (
                          <p className="text-cyan-600 dark:text-cyan-400">
                            {p.billability_pct}% billable
                          </p>
                        )}
                        {p.date && (
                          <p className="text-muted-foreground/50">
                            {new Date(p.date).toLocaleDateString()}
                          </p>
                        )}
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Appreciations */}
          {appreciations !== null && appreciations.length > 0 && (
            <div>
              <SectionLabel
                icon={Trophy}
                label={`Client Appreciations (${appreciations.length})`}
              />
              <div className="space-y-2">
                {appreciations.map((a) => (
                  <div
                    key={a.id}
                    className="rounded-xl border border-amber-200 dark:border-amber-500/20 bg-amber-50/50 dark:bg-amber-500/5 px-4 py-3 text-[12px]"
                  >
                    <div className="flex items-start gap-3">
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 flex-wrap">
                          <p className="font-semibold text-foreground">{a.title}</p>
                          {a.client_name && (
                            <span className="flex items-center gap-1 text-[10px] font-medium text-amber-700 dark:text-amber-400 bg-amber-500/10 border border-amber-500/20 rounded-full px-2 py-0.5">
                              <Building2 className="h-2.5 w-2.5" />
                              {a.client_name}
                            </span>
                          )}
                        </div>
                        {a.description && (
                          <p className="mt-1 text-muted-foreground leading-relaxed">
                            {a.description}
                          </p>
                        )}
                        <p className="mt-1.5 text-muted-foreground/50">
                          Added by {a.added_by_name || a.added_by_email}
                          {a.created_at &&
                            ` · ${new Date(a.created_at).toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" })}`}
                        </p>
                      </div>
                      {a.has_screenshot && (
                        <button
                          onClick={() => setLightboxSrc(`/api/appreciations/${a.id}/screenshot`)}
                          className="shrink-0 rounded-lg overflow-hidden border border-amber-200 dark:border-amber-500/30 hover:border-amber-400 transition-colors group relative"
                          title="View screenshot"
                        >
                          <img
                            src={`/api/appreciations/${a.id}/screenshot`}
                            alt="Appreciation screenshot"
                            className="h-14 w-20 object-cover"
                          />
                          <div className="absolute inset-0 bg-black/0 group-hover:bg-black/20 transition-colors flex items-center justify-center">
                            <ZoomIn className="h-4 w-4 text-white opacity-0 group-hover:opacity-100 transition-opacity" />
                          </div>
                        </button>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}
          {appreciations !== null &&
            appreciations.length === 0 &&
            person.appreciation_count === 0 &&
            null}
        </div>
      )}

      {/* Lightbox */}
      {lightboxSrc && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-sm"
          onClick={() => setLightboxSrc(null)}
        >
          <div className="relative max-w-4xl max-h-[90vh] p-4">
            <img
              src={lightboxSrc}
              alt="Appreciation screenshot"
              className="max-h-[85vh] max-w-full rounded-xl shadow-2xl object-contain"
            />
            <button
              onClick={() => setLightboxSrc(null)}
              className="absolute top-2 right-2 rounded-full bg-black/50 p-1.5 text-white hover:bg-black/70"
            >
              <X className="h-4 w-4" />
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

export function PeoplePage() {
  const { user } = useAuth();

  const PAGE_SIZE = 10;

  const [query, setQuery] = useState("");
  const [skill, setSkill] = useState("");
  const [designation, setDesignation] = useState("");
  const [func, setFunc] = useState("");
  const [manager, setManager] = useState("");
  const [minExp, setMinExp] = useState("");
  const [showFilters, setShowFilters] = useState(false);
  const [results, setResults] = useState<Person[] | null>(null);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(0);
  const [loading, setLoading] = useState(false);
  const [searched, setSearched] = useState(false);

  const authHeaders = {
    ...(user?.email ? { "x-user-email": user.email } : {}),
    ...(user?.role ? { "x-user-role": user.role.toLowerCase() } : {}),
  };

  const handleSearch = useCallback(
    async (pageIndex = 0) => {
      setLoading(true);
      setSearched(true);
      setPage(pageIndex);
      try {
        const params = new URLSearchParams();
        if (query) params.set("q", query);
        if (skill) params.set("skill", skill);
        if (designation) params.set("designation", designation);
        if (func) params.set("function", func);
        if (manager) params.set("reporting_manager", manager);
        if (minExp) params.set("min_exp", minExp);
        params.set("limit", String(PAGE_SIZE));
        params.set("offset", String(pageIndex * PAGE_SIZE));

        const res = await fetch(`/api/people/search?${params}`, { headers: authHeaders });
        if (!res.ok) throw new Error("Search failed");
        const data = await res.json();
        // Tolerate both shapes: new paginated {total,results} and legacy bare array.
        const list: Person[] = Array.isArray(data) ? data : (data.results ?? []);
        setResults(list);
        setTotal(Array.isArray(data) ? list.length : (data.total ?? list.length));
      } catch {
        toast.error("Search failed");
      } finally {
        setLoading(false);
      }
    },
    [query, skill, designation, func, manager, minExp, user],
  );

  // Auto-load first page on first render
  useEffect(() => {
    if (user && SEARCH_ROLES.has(user.role)) {
      handleSearch(0);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user]);

  const clearFilter = (setter: (v: string) => void) => setter("");

  if (!user || !SEARCH_ROLES.has(user.role)) {
    return (
      <div className="flex h-full items-center justify-center">
        <div className="text-center">
          <Shield className="h-12 w-12 text-muted-foreground/30 mx-auto mb-4" />
          <p className="text-lg font-medium text-foreground">Access Restricted</p>
          <p className="text-sm text-muted-foreground mt-1">
            People search is available for HR, PMO, Admin, Functional Manager, and Super Admin
            roles.
          </p>
        </div>
      </div>
    );
  }

  const activeFilters = [skill, designation, func, manager, minExp].filter(Boolean).length;

  return (
    <div className="flex h-full flex-col overflow-hidden">
      {/* Header */}
      <div className="shrink-0 border-b border-[#e2e8f0] dark:border-white/[0.08] bg-white dark:bg-card px-8 py-5">
        <div>
          <p className="text-[11px] font-bold uppercase tracking-[0.1em] text-[#00a29a] dark:text-[#00c4bb] mb-1">
            Assets & Config
          </p>
          <h1 className="text-[22px] font-bold text-[#0f172a] dark:text-white tracking-tight">
            People Directory
          </h1>
          <p className="text-[13px] text-[#64748b] dark:text-white/50 mt-0.5">
            Search employees by skills, experience, projects, and reporting structure.
          </p>
        </div>
      </div>

      {/* Search area */}
      <div className="shrink-0 px-8 py-4 border-b border-[#e2e8f0] dark:border-white/[0.08] bg-white dark:bg-card space-y-3">
        <div className="flex gap-3">
          <div className="relative flex-1">
            <Search className="absolute left-4 top-1/2 -translate-y-1/2 h-4 w-4 text-[#94a3b8] dark:text-muted-foreground/50" />
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && handleSearch()}
              placeholder="Search by name, skill, designation, or keyword..."
              className="w-full rounded-xl border border-[#e2e8f0] dark:border-white/[0.1] bg-[#f8fafc] dark:bg-background pl-11 pr-4 py-2.5 text-[14px] text-foreground outline-none focus:border-[#00a29a]/40 dark:focus:border-primary/40 focus:ring-4 focus:ring-[#00a29a]/5 dark:focus:ring-primary/5"
            />
          </div>
          <button
            onClick={() => setShowFilters((v) => !v)}
            className={cn(
              "flex items-center gap-1.5 rounded-xl border px-4 py-2.5 text-[13px] font-medium transition-all",
              showFilters || activeFilters > 0
                ? "border-[#00a29a]/40 dark:border-primary/40 bg-[#00a29a]/10 dark:bg-primary/10 text-[#00a29a] dark:text-primary"
                : "border-[#e2e8f0] dark:border-white/[0.1] bg-white dark:bg-card text-[#64748b] dark:text-muted-foreground hover:text-[#0f172a] dark:hover:text-foreground",
            )}
          >
            <SlidersHorizontal className="h-4 w-4" />
            Filters
            {activeFilters > 0 && (
              <span className="rounded-full bg-[#00a29a] dark:bg-primary px-1.5 text-[10px] font-semibold text-white">
                {activeFilters}
              </span>
            )}
          </button>
          <button
            onClick={() => handleSearch(0)}
            disabled={loading}
            className="flex items-center gap-2 rounded-full bg-[#00a29a] hover:bg-[#008f88] px-5 py-2.5 text-[13px] font-semibold text-white hover:opacity-90 disabled:opacity-50 transition-all shadow-sm"
          >
            {loading ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <Search className="h-4 w-4" />
            )}
            Search
          </button>
        </div>

        {showFilters && (
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
            {[
              { label: "Skill", value: skill, setter: setSkill, placeholder: "e.g. Python, Java" },
              {
                label: "Designation",
                value: designation,
                setter: setDesignation,
                placeholder: "e.g. Senior Engineer",
              },
              { label: "Function", value: func, setter: setFunc, placeholder: "e.g. Engineering" },
              {
                label: "Reporting Manager",
                value: manager,
                setter: setManager,
                placeholder: "Manager name",
              },
              {
                label: "Min Experience (yrs)",
                value: minExp,
                setter: setMinExp,
                placeholder: "e.g. 3",
              },
            ].map(({ label, value, setter, placeholder }) => (
              <div key={label} className="relative">
                <label className="block text-[10px] font-bold uppercase tracking-widest text-[#94a3b8] dark:text-muted-foreground/60 mb-1">
                  {label}
                </label>
                <div className="relative">
                  <input
                    value={value}
                    onChange={(e) => setter(e.target.value)}
                    onKeyDown={(e) => e.key === "Enter" && handleSearch()}
                    placeholder={placeholder}
                    className="w-full rounded-lg border border-[#e2e8f0] dark:border-white/[0.1] bg-[#f8fafc] dark:bg-background px-3 py-2 text-[13px] text-foreground outline-none focus:border-[#00a29a]/40 dark:focus:border-primary/40 pr-7"
                  />
                  {value && (
                    <button
                      onClick={() => clearFilter(setter)}
                      className="absolute right-2 top-1/2 -translate-y-1/2 text-[#94a3b8] dark:text-muted-foreground/50 hover:text-[#0f172a] dark:hover:text-foreground"
                    >
                      <X className="h-3 w-3" />
                    </button>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Results */}
      <div className="flex-1 overflow-y-auto px-8 py-6 bg-[#f5f7fa] dark:bg-background">
        {!searched && (
          <div className="flex h-full items-center justify-center text-center">
            <div>
              <Users className="h-16 w-16 text-[#94a3b8]/30 dark:text-muted-foreground/20 mx-auto mb-4" />
              <p className="text-[15px] font-bold text-[#0f172a] dark:text-white">
                Search your people directory
              </p>
              <p className="text-[13px] text-[#64748b] dark:text-muted-foreground mt-1 max-w-sm">
                Find employees by skill, experience, project history, or reporting manager.
              </p>
            </div>
          </div>
        )}

        {searched && !loading && results?.length === 0 && (
          <div className="flex h-full items-center justify-center text-center">
            <div>
              <Search className="h-12 w-12 text-[#94a3b8]/30 dark:text-muted-foreground/20 mx-auto mb-4" />
              <p className="text-[15px] font-bold text-[#0f172a] dark:text-white">
                No results found
              </p>
              <p className="text-[13px] text-[#64748b] dark:text-muted-foreground mt-1">
                Try different keywords or adjust your filters.
              </p>
            </div>
          </div>
        )}

        {results && results.length > 0 && (
          <div className="space-y-4 w-full">
            {(() => {
              const start = page * PAGE_SIZE + 1;
              const end = page * PAGE_SIZE + results.length;
              const hasPrev = page > 0;
              const hasNext = (page + 1) * PAGE_SIZE < total;
              const Pager = () => (
                <div className="flex items-center justify-between gap-3">
                  <p className="text-[13px] text-[#64748b] dark:text-muted-foreground">
                    Showing{" "}
                    <span className="font-semibold text-[#0f172a] dark:text-white">
                      {start}–{end}
                    </span>{" "}
                    of <span className="font-semibold text-[#0f172a] dark:text-white">{total}</span>
                  </p>
                  <div className="flex items-center gap-2">
                    <button
                      onClick={() => handleSearch(page - 1)}
                      disabled={!hasPrev || loading}
                      className="flex items-center gap-1 rounded-lg border border-[#e2e8f0] dark:border-white/[0.1] bg-white dark:bg-card px-3 py-1.5 text-[12px] font-medium text-[#0f172a] dark:text-white hover:bg-[#f1f5f9] dark:hover:bg-white/[0.06] disabled:opacity-40 disabled:cursor-not-allowed transition-all"
                    >
                      <ChevronLeft className="h-3.5 w-3.5" /> Previous
                    </button>
                    <span className="text-[12px] text-[#94a3b8] dark:text-muted-foreground tabular-nums">
                      Page {page + 1} of {Math.max(1, Math.ceil(total / PAGE_SIZE))}
                    </span>
                    <button
                      onClick={() => handleSearch(page + 1)}
                      disabled={!hasNext || loading}
                      className="flex items-center gap-1 rounded-lg border border-[#e2e8f0] dark:border-white/[0.1] bg-white dark:bg-card px-3 py-1.5 text-[12px] font-medium text-[#0f172a] dark:text-white hover:bg-[#f1f5f9] dark:hover:bg-white/[0.06] disabled:opacity-40 disabled:cursor-not-allowed transition-all"
                    >
                      Next <ChevronRight className="h-3.5 w-3.5" />
                    </button>
                  </div>
                </div>
              );
              return (
                <>
                  <Pager />
                  <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
                    {results.map((person, i) => (
                      <PersonCard key={person.email || i} person={person} />
                    ))}
                  </div>
                  <Pager />
                </>
              );
            })()}
          </div>
        )}
      </div>
    </div>
  );
}
