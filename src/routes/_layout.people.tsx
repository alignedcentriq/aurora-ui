import { createFileRoute } from "@tanstack/react-router";
import { useAuth } from "@/lib/auth-store";
import { useState, useRef, useCallback, useEffect } from "react";
import {
  Search,
  Users,
  Briefcase,
  MapPin,
  Clock,
  ChevronDown,
  ChevronUp,
  Upload,
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
} from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/_layout/people")({
  component: PeoplePage,
});

const SEARCH_ROLES = new Set(["HR", "PMO", "Admin", "Functional Manager"]);

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

interface Person {
  name: string;
  email: string;
  designation: string | null;
  function: string | null;
  location: string | null;
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
  projects: Project[];
}

function initials(name: string) {
  return name.split(" ").map((n) => n[0]).join("").slice(0, 2).toUpperCase();
}

function SkillTag({ label, color = "primary" }: { label: string; color?: string }) {
  const colorMap: Record<string, string> = {
    primary: "bg-primary/10 text-primary/90 border-primary/20",
    amber: "bg-amber-500/10 text-amber-600 dark:text-amber-400 border-amber-500/20",
    emerald: "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border-emerald-500/20",
    violet: "bg-violet-500/10 text-violet-600 dark:text-violet-400 border-violet-500/20",
    cyan: "bg-cyan-500/10 text-cyan-600 dark:text-cyan-400 border-cyan-500/20",
  };
  return (
    <span className={cn("inline-flex items-center rounded-full border px-2.5 py-0.5 text-[11px] font-medium", colorMap[color] ?? colorMap.primary)}>
      {label}
    </span>
  );
}

function SectionLabel({ icon: Icon, label }: { icon: React.ElementType; label: string }) {
  return (
    <p className="flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-widest text-muted-foreground/50 mb-2">
      <Icon className="h-3 w-3" />{label}
    </p>
  );
}

function PersonCard({ person }: { person: Person }) {
  const [expanded, setExpanded] = useState(false);
  const primarySkills = (person.primary_skills || person.skills)?.split(",").map((s) => s.trim()).filter(Boolean) ?? [];
  const secondarySkills = (person.secondary_skills || person.expertise)?.split(",").map((s) => s.trim()).filter(Boolean) ?? [];
  const canTeach = (person.can_teach || person.expertise)?.split(",").map((s) => s.trim()).filter(Boolean) ?? [];
  const certs = person.certifications?.split(",").map((s) => s.trim()).filter(Boolean) ?? [];
  const activeProjects = person.projects.filter(
    (p) => p.status && ["active", "in progress"].some(k => p.status!.toLowerCase().includes(k))
  );
  const recentProject = person.projects[0];

  return (
    <div className="rounded-2xl border border-[var(--border)] bg-card overflow-hidden transition-all hover:shadow-md hover:border-primary/20">
      {/* Card Header */}
      <div className="p-5">
        <div className="flex items-start gap-4">
          <div className="relative shrink-0">
            <div className="h-14 w-14 rounded-2xl bg-gradient-to-br from-primary/20 to-primary/5 text-primary flex items-center justify-center text-[16px] font-bold border border-primary/10">
              {initials(person.name || "?")}
            </div>
            {person.status && (
              <span className={cn(
                "absolute -bottom-1 -right-1 h-4 w-4 rounded-full border-2 border-card",
                person.status.toLowerCase().includes("active") ? "bg-emerald-500" : "bg-muted-foreground"
              )} />
            )}
          </div>

          <div className="flex-1 min-w-0">
            <div className="flex items-start justify-between gap-2">
              <div>
                <p className="text-[15px] font-semibold text-foreground leading-tight">{person.name}</p>
                <p className="text-[13px] text-primary/70 font-medium mt-0.5">{person.designation || "—"}</p>
              </div>
              {(person.level || person.grade) && (
                <span className="text-[10px] font-semibold px-2 py-0.5 rounded-full bg-violet-500/10 text-violet-600 dark:text-violet-400 border border-violet-500/20 shrink-0">
                  {[person.level, person.grade].filter(Boolean).join(" · ")}
                </span>
              )}
            </div>

            <div className="mt-2 flex flex-wrap gap-x-3 gap-y-1 text-[12px] text-muted-foreground">
              {person.function && <span className="flex items-center gap-1"><Briefcase className="h-3 w-3" />{person.function}</span>}
              {person.location && <span className="flex items-center gap-1"><MapPin className="h-3 w-3" />{person.location}</span>}
              {person.total_experience && <span className="flex items-center gap-1"><Clock className="h-3 w-3" />{person.total_experience} yrs</span>}
              {person.reporting_manager && <span className="flex items-center gap-1"><UserCheck className="h-3 w-3" />{person.reporting_manager}</span>}
            </div>

            {/* Primary Skills Preview */}
            {primarySkills.length > 0 && (
              <div className="mt-3 flex flex-wrap gap-1.5">
                {primarySkills.slice(0, 6).map((s) => <SkillTag key={s} label={s} color="primary" />)}
                {primarySkills.length > 6 && <SkillTag label={`+${primarySkills.length - 6} more`} color="primary" />}
              </div>
            )}

            {/* Recent Project Preview */}
            {recentProject && (
              <div className="mt-3 rounded-xl bg-muted/40 border border-[var(--border)] px-3 py-2 text-[12px] flex items-center gap-2">
                <FolderOpen className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
                <span className="font-medium text-foreground truncate">{recentProject.project}</span>
                {recentProject.client && <span className="text-muted-foreground shrink-0">· {recentProject.client}</span>}
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
          className="mt-4 w-full flex items-center justify-center gap-1.5 rounded-xl py-2 text-[12px] font-medium text-muted-foreground hover:text-primary hover:bg-primary/5 transition-all border border-[var(--border)]"
        >
          {expanded ? <ChevronUp className="h-3.5 w-3.5" /> : <ChevronDown className="h-3.5 w-3.5" />}
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
                <p className="text-muted-foreground/50 text-[10px] font-semibold uppercase tracking-wider mb-0.5">Email</p>
                <p className="text-foreground truncate">{person.email}</p>
              </div>
            )}
            {person.reporting_manager && (
              <div>
                <p className="text-muted-foreground/50 text-[10px] font-semibold uppercase tracking-wider mb-0.5">Reporting Manager</p>
                <p className="text-foreground">{person.reporting_manager}</p>
              </div>
            )}
            {person.functional_manager && (
              <div>
                <p className="text-muted-foreground/50 text-[10px] font-semibold uppercase tracking-wider mb-0.5">Functional Manager</p>
                <p className="text-foreground">{person.functional_manager}</p>
              </div>
            )}
            {person.joining_date && (
              <div>
                <p className="text-muted-foreground/50 text-[10px] font-semibold uppercase tracking-wider mb-0.5">Joined</p>
                <p className="text-foreground">{new Date(person.joining_date).toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" })}</p>
              </div>
            )}
            {person.language_known && (
              <div>
                <p className="text-muted-foreground/50 text-[10px] font-semibold uppercase tracking-wider mb-0.5">Languages</p>
                <p className="text-foreground flex items-center gap-1"><Languages className="h-3 w-3" />{person.language_known}</p>
              </div>
            )}
          </div>

          {/* About Me */}
          {person.about_me && (
            <div>
              <SectionLabel icon={BadgeInfo} label="About" />
              <p className="text-[12px] text-muted-foreground leading-relaxed italic">&ldquo;{person.about_me}&rdquo;</p>
            </div>
          )}

          {/* Primary Skills */}
          {primarySkills.length > 0 && (
            <div>
              <SectionLabel icon={Star} label="Primary Skills" />
              <div className="flex flex-wrap gap-1.5">
                {primarySkills.map((s) => <SkillTag key={s} label={s} color="primary" />)}
              </div>
            </div>
          )}

          {/* Secondary Skills */}
          {secondarySkills.length > 0 && (
            <div>
              <SectionLabel icon={BookOpen} label="Secondary Skills / Skill Set Board" />
              <div className="flex flex-wrap gap-1.5">
                {secondarySkills.map((s) => <SkillTag key={s} label={s} color="amber" />)}
              </div>
            </div>
          )}

          {/* What They Can Teach */}
          {canTeach.length > 0 && (
            <div>
              <SectionLabel icon={Lightbulb} label="Can Teach / Mentor Others In" />
              <div className="flex flex-wrap gap-1.5">
                {canTeach.map((s) => <SkillTag key={s} label={s} color="emerald" />)}
              </div>
            </div>
          )}

          {/* Certifications */}
          {certs.length > 0 && (
            <div>
              <SectionLabel icon={Award} label="Certifications" />
              <div className="flex flex-wrap gap-1.5">
                {certs.map((c) => <SkillTag key={c} label={c} color="violet" />)}
              </div>
            </div>
          )}

          {/* Project Allocations */}
          {person.projects.length > 0 && (
            <div>
              <SectionLabel icon={FolderOpen} label={`Project Allocations (${person.projects.length})`} />
              <div className="space-y-2">
                {person.projects.map((p, i) => (
                  <div key={i} className="rounded-xl border border-[var(--border)] bg-card px-4 py-3 text-[12px]">
                    <div className="flex items-start justify-between gap-2">
                      <div className="flex-1 min-w-0">
                        <p className="font-semibold text-foreground truncate">
                          {p.project}{p.sub_project ? ` — ${p.sub_project}` : ""}
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
                          <span className={cn("text-[10px] font-semibold px-2 py-0.5 rounded-full",
                            ["active", "in progress"].some(k => p.status!.toLowerCase().includes(k))
                              ? "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400"
                              : "bg-muted text-muted-foreground"
                          )}>{p.status}</span>
                        )}
                        {p.efforts_pct != null && (
                          <p className="text-muted-foreground">{p.efforts_pct}% effort</p>
                        )}
                        {p.billability_pct != null && (
                          <p className="text-cyan-600 dark:text-cyan-400">{p.billability_pct}% billable</p>
                        )}
                        {p.date && <p className="text-muted-foreground/50">{new Date(p.date).toLocaleDateString()}</p>}
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function PeoplePage() {
  const { user } = useAuth();

  const [query, setQuery] = useState("");
  const [skill, setSkill] = useState("");
  const [designation, setDesignation] = useState("");
  const [func, setFunc] = useState("");
  const [manager, setManager] = useState("");
  const [minExp, setMinExp] = useState("");
  const [showFilters, setShowFilters] = useState(false);
  const [results, setResults] = useState<Person[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [searched, setSearched] = useState(false);

  const empFileRef = useRef<HTMLInputElement>(null);
  const allocFileRef = useRef<HTMLInputElement>(null);
  const projFileRef = useRef<HTMLInputElement>(null);
  const [importing, setImporting] = useState<string | null>(null);

  const authHeaders = {
    ...(user?.email ? { "x-user-email": user.email } : {}),
    ...(user?.role ? { "x-user-role": user.role.toLowerCase() } : {}),
  };

  const handleSearch = useCallback(async () => {
    setLoading(true);
    setSearched(true);
    try {
      const params = new URLSearchParams();
      if (query) params.set("q", query);
      if (skill) params.set("skill", skill);
      if (designation) params.set("designation", designation);
      if (func) params.set("function", func);
      if (manager) params.set("reporting_manager", manager);
      if (minExp) params.set("min_exp", minExp);

      const res = await fetch(`/api/people/search?${params}`, { headers: authHeaders });
      if (!res.ok) throw new Error("Search failed");
      setResults(await res.json());
    } catch {
      toast.error("Search failed");
    } finally {
      setLoading(false);
    }
  }, [query, skill, designation, func, manager, minExp, user]);

  // Auto-load all people on first render
  useEffect(() => {
    if (user && SEARCH_ROLES.has(user.role)) {
      handleSearch();
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user]);

  const handleImport = async (endpoint: string, file: File, label: string) => {
    setImporting(label);
    const form = new FormData();
    form.append("file", file);
    try {
      const res = await fetch(`/api/people/import/${endpoint}`, {
        method: "POST",
        headers: authHeaders,
        body: form,
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.detail || "Import failed");
      toast.success(data.message);
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : "Import failed");
    } finally {
      setImporting(null);
    }
  };

  const clearFilter = (setter: (v: string) => void) => setter("");

  if (!user || !SEARCH_ROLES.has(user.role)) {
    return (
      <div className="flex h-full items-center justify-center">
        <div className="text-center">
          <Shield className="h-12 w-12 text-muted-foreground/30 mx-auto mb-4" />
          <p className="text-lg font-medium text-foreground">Access Restricted</p>
          <p className="text-sm text-muted-foreground mt-1">People search is available for HR, PMO, Admin, and Manager roles.</p>
        </div>
      </div>
    );
  }

  const isManager = ["HR", "Admin"].includes(user.role);
  const activeFilters = [skill, designation, func, manager, minExp].filter(Boolean).length;

  return (
    <div className="flex h-full flex-col overflow-hidden">
      {/* Header */}
      <div className="shrink-0 border-b border-[var(--border)] bg-background/80 backdrop-blur-xl px-8 py-5">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-xl font-semibold text-foreground tracking-tight">People</h1>
            <p className="text-[13px] text-muted-foreground mt-0.5">
              Search employees by skills, experience, projects, and reporting structure.
            </p>
          </div>

          {/* Import buttons — HR and Admin only */}
          {isManager && (
            <div className="flex items-center gap-2">
              <input ref={empFileRef} type="file" accept=".xlsx,.xls" className="hidden"
                onChange={(e) => { const f = e.target.files?.[0]; if (f) handleImport("employees", f, "employees"); e.target.value = ""; }} />
              <input ref={allocFileRef} type="file" accept=".xlsx,.xls" className="hidden"
                onChange={(e) => { const f = e.target.files?.[0]; if (f) handleImport("allocations", f, "allocations"); e.target.value = ""; }} />
              <input ref={projFileRef} type="file" accept=".xlsx,.xls" className="hidden"
                onChange={(e) => { const f = e.target.files?.[0]; if (f) handleImport("projects", f, "projects"); e.target.value = ""; }} />

              {[
                { label: "employees", ref: empFileRef, tip: "Import Employee Data.xlsx" },
                { label: "allocations", ref: allocFileRef, tip: "Import Allocation Data.xlsx" },
                { label: "projects", ref: projFileRef, tip: "Import Project Details.xlsx" },
              ].map(({ label, ref, tip }) => (
                <button
                  key={label}
                  onClick={() => ref.current?.click()}
                  disabled={importing === label}
                  title={tip}
                  className="flex items-center gap-1.5 rounded-xl border border-[var(--border)] bg-card px-3 py-2 text-[12px] font-medium text-muted-foreground hover:text-foreground hover:bg-muted transition-all disabled:opacity-50 capitalize"
                >
                  {importing === label ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Upload className="h-3.5 w-3.5" />}
                  {label}
                </button>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Search area */}
      <div className="shrink-0 px-8 py-4 border-b border-[var(--border)] bg-background space-y-3">
        <div className="flex gap-3">
          <div className="relative flex-1">
            <Search className="absolute left-4 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground/50" />
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && handleSearch()}
              placeholder="Search by name, skill, designation, or keyword..."
              className="w-full rounded-xl border border-[var(--border)] bg-card pl-11 pr-4 py-2.5 text-[14px] text-foreground outline-none focus:border-primary/40 focus:ring-4 focus:ring-primary/5"
            />
          </div>
          <button
            onClick={() => setShowFilters((v) => !v)}
            className={cn(
              "flex items-center gap-1.5 rounded-xl border px-4 py-2.5 text-[13px] font-medium transition-all",
              showFilters || activeFilters > 0
                ? "border-primary/40 bg-primary/10 text-primary"
                : "border-[var(--border)] bg-card text-muted-foreground hover:text-foreground"
            )}
          >
            <SlidersHorizontal className="h-4 w-4" />
            Filters
            {activeFilters > 0 && (
              <span className="rounded-full bg-primary px-1.5 text-[10px] font-semibold text-white">{activeFilters}</span>
            )}
          </button>
          <button
            onClick={handleSearch}
            disabled={loading}
            className="flex items-center gap-2 rounded-xl bg-primary px-5 py-2.5 text-[13px] font-semibold text-white hover:bg-primary/90 disabled:opacity-50 transition-all"
          >
            {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Search className="h-4 w-4" />}
            Search
          </button>
        </div>

        {showFilters && (
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
            {[
              { label: "Skill", value: skill, setter: setSkill, placeholder: "e.g. Python, Java" },
              { label: "Designation", value: designation, setter: setDesignation, placeholder: "e.g. Senior Engineer" },
              { label: "Function", value: func, setter: setFunc, placeholder: "e.g. Engineering" },
              { label: "Reporting Manager", value: manager, setter: setManager, placeholder: "Manager name" },
              { label: "Min Experience (yrs)", value: minExp, setter: setMinExp, placeholder: "e.g. 3" },
            ].map(({ label, value, setter, placeholder }) => (
              <div key={label} className="relative">
                <label className="block text-[10px] font-semibold uppercase tracking-widest text-muted-foreground/60 mb-1">{label}</label>
                <div className="relative">
                  <input
                    value={value}
                    onChange={(e) => setter(e.target.value)}
                    onKeyDown={(e) => e.key === "Enter" && handleSearch()}
                    placeholder={placeholder}
                    className="w-full rounded-lg border border-[var(--border)] bg-card px-3 py-2 text-[13px] text-foreground outline-none focus:border-primary/40 pr-7"
                  />
                  {value && (
                    <button onClick={() => clearFilter(setter)} className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground/50 hover:text-foreground">
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
      <div className="flex-1 overflow-y-auto px-8 py-6">
        {!searched && (
          <div className="flex h-full items-center justify-center text-center">
            <div>
              <Users className="h-16 w-16 text-muted-foreground/20 mx-auto mb-4" />
              <p className="text-[15px] font-medium text-foreground">Search your people directory</p>
              <p className="text-[13px] text-muted-foreground mt-1 max-w-sm">
                Find employees by skill, experience, project history, or reporting manager.
                {isManager && " Use the import buttons above to load data from Excel files."}
              </p>
            </div>
          </div>
        )}

        {searched && !loading && results?.length === 0 && (
          <div className="flex h-full items-center justify-center text-center">
            <div>
              <Search className="h-12 w-12 text-muted-foreground/20 mx-auto mb-4" />
              <p className="text-[15px] font-medium text-foreground">No results found</p>
              <p className="text-[13px] text-muted-foreground mt-1">
                Try different keywords or import employee data using the buttons above.
              </p>
            </div>
          </div>
        )}

        {results && results.length > 0 && (
          <div className="space-y-4 max-w-4xl">
            <p className="text-[13px] text-muted-foreground">{results.length} result{results.length !== 1 ? "s" : ""} found</p>
            {results.map((person, i) => (
              <PersonCard key={person.email || i} person={person} />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
