import { useAuth } from "@/lib/auth-store";
import { useState, useEffect, useCallback, useMemo } from "react";
import {
  Brain,
  Search,
  Loader2,
  RefreshCw,
  Sparkles,
  Layers,
  Link2,
  Lightbulb,
  Users,
  Boxes,
  CheckCircle2,
  AlertCircle,
  ShieldCheck,
  FileText,
  ArrowRight,
  Calendar,
  Shield,
  ExternalLink,
  Activity,
  Zap,
  BookOpen,
  TrendingUp,
  UserCheck,
  GraduationCap,
  Database,
  Hash,
} from "lucide-react";
import { cn } from "@/lib/utils";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetDescription,
} from "@/components/ui/sheet";
import { motion } from "framer-motion";

type Tab = "search" | "library" | "analytics" | "risks";

interface Health {
  score: number;
  level: "strong" | "moderate" | "thin";
  flags: string[];
}
interface Capability {
  capability_name: string;
  category?: string | null;
  maturity_level?: string | null;
  confidence: string;
  evidence?: string | null;
  source_quote?: string | null;
}
interface Integration {
  system_name: string;
  integration_type?: string | null;
  complexity_level?: string | null;
  lessons_learned?: string | null;
  confidence: string;
  source_quote?: string | null;
}
interface Lesson {
  category?: string | null;
  lesson: string;
  impact_level?: string | null;
  recommendation?: string | null;
  confidence: string;
  evidence?: string | null;
  source_quote?: string | null;
}
interface Asset {
  asset_name: string;
  asset_type?: string | null;
  repository_url?: string | null;
  owner?: string | null;
  reuse_readiness?: string | null;
  documentation_url?: string | null;
  confidence: string;
  source_quote?: string | null;
}
interface Expert {
  person_name: string;
  role_on_project?: string | null;
  capability?: string | null;
  evidence_level: string;
  employee_id?: number | null;
  source_quote?: string | null;
}
interface Analytics {
  total_projects: number;
  reviewed: number;
  draft: number;
  totals: { lessons: number; assets: number; experts: number };
  health: Record<string, number>;
  capabilities: { label: string; count: number }[];
  technologies: { label: string; count: number }[];
  integrations: { label: string; count: number }[];
  industries: { label: string; count: number }[];
  statuses: { label: string; count: number }[];
}

interface Risk {
  category: string;
  lesson: string;
  recommendation?: string | null;
  impact_level?: string | null;
  recurrence: number;
  projects: { slug: string; name: string }[];
}

interface AvailableExpert {
  person_name: string;
  projects: string[];
  project_count: number;
  capabilities: string[];
  roles: string[];
  evidence_level: string;
  availability: string;
  utilization_pct: number | null;
  current_projects: string[];
}

interface UdemyCourse {
  title: string;
  url: string;
  headline: string;
  rating?: number | null;
  num_subscribers?: number | null;
}

interface TrainingArea {
  area: string;
  courses: UdemyCourse[];
}

interface TrainingRecs {
  status: string;
  slug: string;
  project_name: string;
  areas: TrainingArea[];
}

interface SourceDoc {
  title: string;
  source_key: string;
}

interface Profile {
  id: number;
  slug: string;
  name: string;
  client_industry?: string | null;
  status?: string | null;
  business_problem?: string | null;
  solution_summary?: string | null;
  business_outcomes?: string | null;
  technology_stack: string[];
  architecture_summary?: string | null;
  complexity_drivers: string[];
  project_size?: string | null;
  team_size?: string | null;
  delivery_start_date?: string | null;
  delivery_end_date?: string | null;
  confidence: string;
  review_status: string;
  reviewed_by?: string | null;
  reviewed_at?: string | null;
  source_doc_count: number;
  query_count?: number;
  updated_at?: string | null;
  dna_summary?: string | null;
  source_docs?: SourceDoc[];
  health?: Health;
  similarity?: number;
  capabilities?: Capability[];
  integrations?: Integration[];
  lessons?: Lesson[];
  reusable_assets?: Asset[];
  expertise?: Expert[];
}

function ConfBadge({ value }: { value?: string }) {
  const verified = value === "verified";
  return (
    <span
      className={cn(
        "inline-flex items-center gap-0.5 px-2 py-0.5 rounded-lg text-[10px] font-bold uppercase tracking-wider shadow-sm shrink-0",
        verified
          ? "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border border-emerald-500/20"
          : "bg-amber-500/10 text-amber-600 dark:text-amber-400 border border-amber-500/20",
      )}
      title={
        verified
          ? "Explicitly stated in source material"
          : "Inferred — needs review before client-facing use"
      }
    >
      {verified ? <ShieldCheck className="w-3.5 h-3.5" /> : <AlertCircle className="w-3.5 h-3.5" />}
      {verified ? "verified" : "inferred"}
    </span>
  );
}

function HealthBadge({ health }: { health?: Health }) {
  if (!health) return null;
  const map = {
    strong: "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border-emerald-500/20",
    moderate: "bg-amber-500/10 text-amber-600 dark:text-amber-400 border-amber-500/20",
    thin: "bg-red-500/10 text-red-600 dark:text-red-400 border-red-500/20",
  } as const;
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 px-2 py-0.5 rounded-lg text-[10px] font-bold uppercase tracking-wider shadow-sm shrink-0 border",
        map[health.level],
      )}
      title={
        health.flags.length
          ? `Completeness ${health.score}/100 — ${health.flags.join("; ")}`
          : `Completeness ${health.score}/100`
      }
    >
      <Activity className="w-3 h-3" />
      {health.score}
    </span>
  );
}

function ReviewBadge({ status }: { status: string }) {
  const reviewed = status === "reviewed";
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-[10px] font-bold uppercase tracking-wider shadow-sm shrink-0",
        reviewed
          ? "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border border-emerald-500/20"
          : "bg-zinc-500/10 text-zinc-600 dark:text-zinc-400 border border-zinc-500/20",
      )}
    >
      {reviewed ? (
        <CheckCircle2 className="w-3 h-3" />
      ) : (
        <Loader2 className="w-3 h-3 animate-spin" />
      )}
      {reviewed ? "Reviewed" : "Draft"}
    </span>
  );
}

export function ProjectIQPortal() {
  const { user } = useAuth();
  const role = (user?.role || "").toLowerCase();
  const canManage = ["pmo", "admin", "super admin"].includes(role);

  const [tab, setTab] = useState<Tab>("search");
  const [profiles, setProfiles] = useState<Profile[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [rebuilding, setRebuilding] = useState(false);
  const [analytics, setAnalytics] = useState<Analytics | null>(null);
  const [analyticsLoading, setAnalyticsLoading] = useState(false);

  // search
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<Profile[]>([]);
  const [searching, setSearching] = useState(false);
  const [searched, setSearched] = useState(false);

  // detail drawer
  const [selected, setSelected] = useState<Profile | null>(null);
  const [drawerTab, setDrawerTab] = useState<"overview" | "tech" | "evidence" | "training" | "sources">("overview");

  // Phase 2: Risk radar
  const [risks, setRisks] = useState<Risk[]>([]);
  const [risksLoading, setRisksLoading] = useState(false);

  // Phase 2: Available experts (in search)
  const [availExperts, setAvailExperts] = useState<AvailableExpert[]>([]);
  const [availExpertsLoading, setAvailExpertsLoading] = useState(false);
  const [availExpertsQuery, setAvailExpertsQuery] = useState("");

  // Phase 2: Kickoff brief
  const [brief, setBrief] = useState<{ status: string; brief: string; sources: { slug: string; name: string; similarity: number }[] } | null>(null);
  const [briefLoading, setBriefLoading] = useState(false);

  // Phase 2: Training recs
  const [trainingRecs, setTrainingRecs] = useState<TrainingRecs | null>(null);
  const [trainingLoading, setTrainingLoading] = useState(false);

  const authHeaders = {
    "Content-Type": "application/json",
    ...(user?.email ? { "x-user-email": user.email } : {}),
    ...(user?.role ? { "x-user-role": user.role.toLowerCase() } : {}),
  };

  const loadProfiles = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const resp = await fetch("/api/project-iq/profiles", { headers: authHeaders });
      if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
      const data = await resp.json();
      setProfiles(data.profiles || []);
    } catch {
      setError(
        "Couldn't load Project DNA. Make sure the project corpus has been ingested and DNA built.",
      );
      setProfiles([]);
    } finally {
      setLoading(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user?.email, user?.role]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    loadProfiles();
  }, [loadProfiles]);

  const loadAnalytics = useCallback(async () => {
    setAnalyticsLoading(true);
    try {
      const resp = await fetch("/api/project-iq/analytics", { headers: authHeaders });
      if (resp.ok) setAnalytics(await resp.json());
    } catch {
      /* ignore */
    } finally {
      setAnalyticsLoading(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user?.email, user?.role]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    if (tab === "analytics" && !analytics) loadAnalytics();
  }, [tab, analytics, loadAnalytics]);

  const loadRisks = useCallback(async () => {
    setRisksLoading(true);
    try {
      const resp = await fetch("/api/project-iq/recurring-risks?min_projects=2", { headers: authHeaders });
      if (resp.ok) setRisks((await resp.json()).risks || []);
    } catch { /* ignore */ }
    finally { setRisksLoading(false); }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user?.email, user?.role]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    if (tab === "risks" && risks.length === 0) loadRisks();
  }, [tab, risks.length, loadRisks]);

  const searchAvailExperts = async (skills: string) => {
    if (!skills.trim()) return;
    setAvailExpertsLoading(true);
    setAvailExpertsQuery(skills);
    try {
      const resp = await fetch(`/api/project-iq/available-experts?skills=${encodeURIComponent(skills)}`, { headers: authHeaders });
      if (resp.ok) setAvailExperts((await resp.json()).experts || []);
    } catch { setAvailExperts([]); }
    finally { setAvailExpertsLoading(false); }
  };

  const generateBrief = async () => {
    if (!query.trim() || results.length === 0) return;
    setBriefLoading(true);
    setBrief(null);
    try {
      const resp = await fetch("/api/project-iq/kickoff-brief", {
        method: "POST",
        headers: authHeaders,
        body: JSON.stringify({ description: query.trim() }),
      });
      if (resp.ok) setBrief(await resp.json());
    } catch { /* ignore */ }
    finally { setBriefLoading(false); }
  };

  const loadTrainingRecs = async (slug: string) => {
    setTrainingLoading(true);
    setTrainingRecs(null);
    try {
      const resp = await fetch(`/api/project-iq/training-recs?slug=${encodeURIComponent(slug)}`, { headers: authHeaders });
      if (resp.ok) setTrainingRecs(await resp.json());
    } catch { /* ignore */ }
    finally { setTrainingLoading(false); }
  };

  useEffect(() => {
    if (selected) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setDrawerTab("overview");
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setTrainingRecs(null);
    }
  }, [selected]);

  const doSearch = async () => {
    if (!query.trim()) return;
    setSearching(true);
    setSearched(true);
    setBrief(null);
    try {
      const resp = await fetch("/api/project-iq/search", {
        method: "POST",
        headers: authHeaders,
        body: JSON.stringify({ description: query.trim(), limit: 5 }),
      });
      const data = await resp.json();
      setResults(data.results || []);
    } catch {
      setResults([]);
    } finally {
      setSearching(false);
    }
  };

  const onSearch = (e: React.FormEvent) => {
    e.preventDefault();
    doSearch();
  };

  const openProfile = async (slug: string) => {
    try {
      const resp = await fetch(`/api/project-iq/profiles/${encodeURIComponent(slug)}`, {
        headers: authHeaders,
      });
      if (resp.ok) setSelected(await resp.json());
    } catch {
      /* ignore */
    }
  };

  const rebuildAll = async () => {
    setRebuilding(true);
    try {
      await fetch("/api/project-iq/rebuild-all", { method: "POST", headers: authHeaders });
    } finally {
      // Extraction runs in the background; give it a beat, then refresh.
      setTimeout(() => {
        setRebuilding(false);
        loadProfiles();
      }, 1500);
    }
  };

  const rebuildOne = async (slug: string) => {
    await fetch(`/api/project-iq/profiles/${encodeURIComponent(slug)}/rebuild`, {
      method: "POST",
      headers: authHeaders,
    });
    setSelected(null);
    setTimeout(loadProfiles, 1500);
  };

  const approve = async (slug: string) => {
    const resp = await fetch(`/api/project-iq/profiles/${encodeURIComponent(slug)}/review`, {
      method: "POST",
      headers: authHeaders,
      body: JSON.stringify({ review_status: "reviewed" }),
    });
    if (resp.ok) {
      const updated = await resp.json();
      setSelected(updated);
      loadProfiles();
    }
  };

  // Compute metrics for high-level cards
  const stats = useMemo(() => {
    let reviewed = 0;
    let assets = 0;
    let experts = 0;
    profiles.forEach((p) => {
      if (p.review_status === "reviewed") reviewed++;
      if (p.reusable_assets) assets += p.reusable_assets.length;
      if (p.expertise) experts += p.expertise.length;
    });
    return {
      total: profiles.length,
      reviewed,
      draft: profiles.length - reviewed,
      assets,
      experts,
    };
  }, [profiles]);

  return (
    <div className="flex-1 h-full overflow-y-auto bg-gradient-to-br from-slate-50/50 to-slate-100/50 dark:from-[#020d1a] dark:to-[#071428] px-4 sm:px-8 py-5 sm:py-6 select-none relative flex flex-col gap-5 sm:gap-6">
      {/* Subtle background glow highlight */}
      <div className="absolute top-10 left-1/2 -translate-x-1/2 w-[300px] sm:w-[500px] h-[150px] bg-gradient-to-r from-sky-500/10 to-blue-500/10 rounded-full blur-[80px] pointer-events-none" />

      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 border-b border-border/60 pb-5 shrink-0 z-10">
        <div className="flex items-center gap-3">
          <div className="p-2.5 rounded-2xl bg-gradient-to-tr from-sky-400 to-blue-600 text-white shadow-lg shadow-sky-500/10 animate-pulse">
            <Brain className="w-6 h-6" />
          </div>
          <div>
            <p className="text-xs sm:text-sm text-muted-foreground mt-0.5">
              Reuse delivery knowledge from past projects — internal only.
            </p>
          </div>
        </div>
        {canManage && (
          <button
            onClick={rebuildAll}
            disabled={rebuilding}
            className="w-full sm:w-auto inline-flex items-center justify-center gap-2 px-4 py-2 rounded-xl border border-sky-200 dark:border-white/[0.08] bg-white/70 dark:bg-white/[0.03] backdrop-blur-md text-sm font-semibold hover:bg-sky-500/10 hover:border-sky-500/30 active:scale-95 transition-all disabled:opacity-60 cursor-pointer shadow-sm"
          >
            {rebuilding ? (
              <Loader2 className="w-4 h-4 animate-spin text-sky-500" />
            ) : (
              <RefreshCw className="w-4 h-4 text-sky-500" />
            )}
            Rebuild all DNA
          </button>
        )}
      </div>

      {/* Stats Grid */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 sm:gap-4 shrink-0 z-10">
        {[
          {
            label: "Total Project DNA",
            value: stats.total,
            color: "from-blue-500/10 to-sky-500/10 border-blue-500/20 dark:border-blue-500/10",
            icon: Layers,
            iconColor: "text-blue-500 bg-blue-500/10",
          },
          {
            label: "Reviewed DNA",
            value: stats.reviewed,
            color:
              "from-emerald-500/10 to-teal-500/10 border-emerald-500/20 dark:border-emerald-500/10",
            icon: CheckCircle2,
            iconColor: "text-emerald-500 bg-emerald-500/10",
          },
          {
            label: "Reusable Assets",
            value: stats.assets,
            color:
              "from-purple-500/10 to-indigo-500/10 border-purple-500/20 dark:border-purple-500/10",
            icon: Boxes,
            iconColor: "text-purple-500 bg-purple-500/10",
          },
          {
            label: "Expert Connections",
            value: stats.experts,
            color:
              "from-amber-500/10 to-orange-500/10 border-amber-500/20 dark:border-amber-500/10",
            icon: Users,
            iconColor: "text-amber-500 bg-amber-500/10",
          },
        ].map((item, i) => (
          <div
            key={i}
            className={cn(
              "p-3.5 rounded-2xl border bg-gradient-to-br backdrop-blur-md flex items-center justify-between shadow-sm hover:scale-[1.01] transition-transform",
              item.color,
            )}
          >
            <div>
              <span className="text-[10px] sm:text-xs font-semibold text-muted-foreground uppercase tracking-wider block">
                {item.label}
              </span>
              <span className="text-xl sm:text-2xl font-black text-foreground mt-1 block tracking-tight">
                {item.value}
              </span>
            </div>
            <div
              className={cn(
                "p-2.5 rounded-xl border border-border/40 shadow-inner",
                item.iconColor,
              )}
            >
              <item.icon className="w-5 h-5" />
            </div>
          </div>
        ))}
      </div>

      {/* Tabs Switcher */}
      <div className="flex gap-2 border-b border-border/60 pb-px shrink-0 z-10">
        {(
          [
            ["search", "Find Similar", Sparkles],
            ["library", "DNA Library", Layers],
            ["analytics", "Portfolio Analytics", Activity],
            ["risks", "Risk Radar", Zap],
          ] as const
        ).map(([id, label, Icon]) => {
          const active = tab === id;
          return (
            <button
              key={id}
              onClick={() => setTab(id)}
              className={cn(
                "relative inline-flex items-center gap-2 px-4 py-2.5 text-xs sm:text-sm font-semibold transition-all duration-300 rounded-t-xl cursor-pointer hover:bg-sky-500/5 hover:text-foreground",
                active ? "text-sky-500 font-bold" : "text-muted-foreground",
              )}
            >
              <Icon className="w-4 h-4" />
              <span>{label}</span>
              {active && (
                <motion.div
                  layoutId="activeTabIndicator"
                  className="absolute bottom-0 left-0 right-0 h-[2px] bg-sky-500"
                  transition={{ type: "spring", stiffness: 350, damping: 30 }}
                />
              )}
            </button>
          );
        })}
      </div>

      {/* SEARCH TAB */}
      {tab === "search" && (
        <div className="flex flex-col gap-5 sm:gap-6 animate-in fade-in-50 duration-200">
          <form
            onSubmit={onSearch}
            className="flex flex-col gap-3 p-4 sm:p-5 rounded-2xl border border-border/60 bg-white/50 dark:bg-card/20 backdrop-blur-md shadow-sm relative overflow-hidden group"
          >
            {/* Glow accent */}
            <div className="absolute top-0 right-0 w-[200px] h-[200px] bg-gradient-to-bl from-sky-500/5 to-transparent rounded-full pointer-events-none blur-3xl group-hover:from-sky-500/10 transition-all duration-500" />

            <label className="text-xs sm:text-sm font-semibold text-foreground flex items-center gap-1.5">
              <Sparkles className="w-4 h-4 text-sky-500" />
              Have we built something similar before?
            </label>
            <div className="flex flex-col sm:flex-row gap-3">
              <div className="flex-1 relative flex flex-col">
                <textarea
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" && !e.shiftKey) {
                      e.preventDefault();
                      if (query.trim() && !searching) doSearch();
                    }
                  }}
                  placeholder="e.g. an e-commerce self-service portal with Next.js, Redis cart storage, Azure AD SSO and PayPal gateway integration..."
                  rows={2}
                  className="w-full resize-none rounded-xl border border-border bg-background/50 dark:bg-background/20 px-4 py-3 text-xs sm:text-sm focus:outline-none focus:ring-2 focus:ring-sky-500/30 focus:border-sky-500 transition-all placeholder:text-muted-foreground/60 shadow-inner"
                />
                {query.trim().length > 0 ? (
                  <span className="absolute bottom-2 right-3 text-[10px] text-muted-foreground font-mono">
                    {query.length} chars · Enter to search
                  </span>
                ) : (
                  <span className="absolute bottom-2 right-3 text-[10px] text-muted-foreground/50 font-mono">
                    Enter to search · Shift+Enter for newline
                  </span>
                )}
              </div>
              <button
                type="submit"
                disabled={searching || !query.trim()}
                className="inline-flex items-center justify-center gap-2 px-5 py-3 rounded-xl bg-gradient-to-r from-sky-500 to-blue-600 text-white text-xs sm:text-sm font-semibold hover:shadow-lg hover:shadow-sky-500/20 active:scale-95 transition-all disabled:opacity-60 disabled:pointer-events-none cursor-pointer shrink-0"
              >
                {searching ? (
                  <Loader2 className="w-4.5 h-4.5 animate-spin" />
                ) : (
                  <Search className="w-4.5 h-4.5" />
                )}
                <span>Search DNA</span>
              </button>
            </div>

            {/* Quick Prompts Helper */}
            <div className="mt-2.5 flex flex-wrap items-center gap-1.5 sm:gap-2">
              <span className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground mr-1">
                Suggestions:
              </span>
              {[
                "Next.js e-commerce portal with Redis",
                "Azure cloud migration secure landing zone",
                "Azure OpenAI patient note trial analyzer",
              ].map((p, idx) => (
                <button
                  key={idx}
                  type="button"
                  onClick={() => setQuery(p)}
                  className="text-[11px] px-2.5 py-1 rounded-lg border border-border hover:border-sky-500/30 hover:bg-sky-500/5 text-muted-foreground hover:text-foreground cursor-pointer transition-colors max-w-[250px] truncate"
                  title={p}
                >
                  {p}
                </button>
              ))}
            </div>
          </form>

          {searched && !searching && results.length === 0 && (
            <div className="text-center py-10 rounded-2xl border border-dashed border-border bg-background/20">
              <AlertCircle className="w-8 h-8 text-amber-500 mx-auto mb-2" />
              <h3 className="text-sm font-semibold text-foreground">
                No matching DNA profiles found
              </h3>
              <p className="text-xs text-muted-foreground mt-1 max-w-xs mx-auto">
                Try refining your search terms or rebuild the project DNA from the Library
                directory.
              </p>
            </div>
          )}

          {/* Search Results */}
          <div className="flex flex-col gap-4">
            {searching && (
              <div className="flex flex-col items-center justify-center py-16 gap-3">
                <Loader2 className="w-8 h-8 animate-spin text-sky-500" />
                <span className="text-xs text-muted-foreground font-semibold">
                  Running semantic similarity scan...
                </span>
              </div>
            )}

            {!searching && results.length > 0 && (
              <>
                <div className="flex items-center justify-between px-1">
                  <h3 className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground flex items-center gap-1.5">
                    Matched DNA Profiles ({results.length})
                  </h3>
                  <button
                    onClick={generateBrief}
                    disabled={briefLoading}
                    className="inline-flex items-center gap-1.5 px-3.5 py-1.5 rounded-xl bg-gradient-to-r from-violet-500 to-purple-600 text-white text-xs font-semibold hover:shadow-lg hover:shadow-purple-500/20 active:scale-95 transition-all disabled:opacity-60 cursor-pointer shadow-sm"
                  >
                    {briefLoading ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Sparkles className="w-3.5 h-3.5" />}
                    Generate Kickoff Brief
                  </button>
                </div>
                <div className="flex flex-col gap-3">
                  {results.map((p) => (
                    <button
                      key={p.id}
                      onClick={() => openProfile(p.slug)}
                      className="text-left rounded-2xl border border-border bg-gradient-to-br from-white to-slate-50/50 dark:from-card/40 dark:to-card/20 p-5 hover:border-sky-500/40 hover:shadow-lg hover:shadow-sky-500/5 active:scale-[0.99] transition-all cursor-pointer relative overflow-hidden group flex flex-col sm:flex-row sm:items-center justify-between gap-4"
                    >
                      <div className="absolute top-0 bottom-0 left-0 w-1 bg-gradient-to-b from-sky-400 to-blue-500 opacity-0 group-hover:opacity-100 transition-opacity" />
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center flex-wrap gap-2">
                          <span className="font-bold text-sm sm:text-base text-foreground tracking-tight group-hover:text-sky-500 transition-colors leading-tight">
                            {p.name}
                          </span>
                          <ReviewBadge status={p.review_status} />
                          <ConfBadge value={p.confidence} />
                          <HealthBadge health={p.health} />
                        </div>
                        {p.client_industry && (
                          <span className="inline-block text-[10px] font-semibold text-sky-500 uppercase tracking-wider mt-1.5">
                            {p.client_industry}
                          </span>
                        )}
                        {p.solution_summary && (
                          <p className="text-xs sm:text-sm mt-2 text-muted-foreground line-clamp-2 leading-relaxed">
                            {p.solution_summary}
                          </p>
                        )}
                        <div className="flex flex-wrap gap-1.5 mt-3">
                          {(p.capabilities || []).slice(0, 4).map((c, i) => (
                            <span key={i} className="px-2 py-0.5 rounded-lg bg-muted text-[10px] font-semibold border border-border/40 text-muted-foreground">
                              {c.capability_name}
                            </span>
                          ))}
                        </div>
                      </div>
                      {typeof p.similarity === "number" && (
                        <div className="flex flex-row sm:flex-col items-center justify-between sm:justify-center border-t sm:border-t-0 sm:border-l border-border/60 pt-3 sm:pt-0 sm:pl-6 shrink-0 sm:text-center gap-1">
                          <span className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">Match</span>
                          <span className="text-lg sm:text-2xl font-black text-sky-500 tracking-tight">
                            {Math.round(p.similarity * 100)}%
                          </span>
                        </div>
                      )}
                    </button>
                  ))}
                </div>

                {/* Kickoff Brief output */}
                {(briefLoading || brief) && (
                  <div className="rounded-2xl border border-violet-500/20 bg-violet-500/[0.04] p-5 flex flex-col gap-3">
                    <h4 className="text-xs font-bold uppercase tracking-wider text-violet-500 flex items-center gap-1.5">
                      <Sparkles className="w-4 h-4" /> Kickoff Brief
                    </h4>
                    {briefLoading ? (
                      <div className="flex items-center gap-2 text-xs text-muted-foreground">
                        <Loader2 className="w-4 h-4 animate-spin text-violet-500" />
                        Generating brief from past project DNA...
                      </div>
                    ) : brief?.brief ? (
                      <div className="prose prose-sm dark:prose-invert max-w-none text-xs sm:text-sm whitespace-pre-wrap leading-relaxed text-foreground">
                        {brief.brief}
                      </div>
                    ) : null}
                  </div>
                )}

                {/* Available Experts for this query */}
                <div className="rounded-2xl border border-border/60 bg-white/50 dark:bg-card/10 p-4 flex flex-col gap-3">
                  <div className="flex items-center justify-between">
                    <h4 className="text-xs font-bold uppercase tracking-wider text-muted-foreground flex items-center gap-1.5">
                      <UserCheck className="w-4 h-4 text-emerald-500" /> Available Experts
                    </h4>
                    <button
                      onClick={() => searchAvailExperts(query)}
                      disabled={availExpertsLoading}
                      className="text-[11px] px-2.5 py-1 rounded-lg border border-emerald-500/30 text-emerald-600 dark:text-emerald-400 hover:bg-emerald-500/10 transition-colors font-semibold cursor-pointer disabled:opacity-60"
                    >
                      {availExpertsLoading ? <Loader2 className="w-3 h-3 animate-spin inline" /> : "Find"}
                    </button>
                  </div>
                  {availExperts.length > 0 && availExpertsQuery === query && (
                    <div className="flex flex-col gap-2">
                      {availExperts.slice(0, 6).map((e, i) => {
                        const avail = e.availability;
                        const cls = avail === "available" || avail === "likely available"
                          ? "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border-emerald-500/20"
                          : avail === "partially available"
                          ? "bg-amber-500/10 text-amber-600 dark:text-amber-400 border-amber-500/20"
                          : "bg-red-500/10 text-red-600 dark:text-red-400 border-red-500/20";
                        return (
                          <div key={i} className="flex items-center justify-between gap-3 p-3 rounded-xl border border-border/50 bg-white/40 dark:bg-white/[0.02]">
                            <div className="min-w-0">
                              <span className="text-xs font-bold text-foreground block">{e.person_name}</span>
                              <span className="text-[10px] text-muted-foreground">
                                {e.projects.slice(0, 2).join(", ")}
                                {e.project_count > 2 ? ` +${e.project_count - 2} more` : ""}
                              </span>
                            </div>
                            <span className={cn("text-[10px] px-2 py-0.5 rounded-lg border font-bold uppercase tracking-wider shrink-0", cls)}>
                              {e.utilization_pct !== null ? `${e.utilization_pct}%` : ""} {avail}
                            </span>
                          </div>
                        );
                      })}
                    </div>
                  )}
                  {!availExpertsLoading && availExperts.length === 0 && availExpertsQuery === query && (
                    <p className="text-xs text-muted-foreground">No matching experts found.</p>
                  )}
                </div>
              </>
            )}
          </div>
        </div>
      )}

      {/* LIBRARY TAB */}
      {tab === "library" && (
        <div className="animate-in fade-in-50 duration-200 flex flex-col gap-4">
          {loading ? (
            <div className="flex flex-col items-center justify-center py-20 gap-3">
              <Loader2 className="w-8 h-8 animate-spin text-sky-500" />
              <span className="text-xs text-muted-foreground font-semibold">
                Loading Project DNA directory...
              </span>
            </div>
          ) : error ? (
            <div className="flex items-center gap-2.5 text-amber-600 bg-amber-500/10 border border-amber-500/20 p-4 rounded-xl text-sm font-semibold">
              <AlertCircle className="w-5 h-5 shrink-0" />
              <span>{error}</span>
            </div>
          ) : profiles.length === 0 ? (
            <div className="text-center py-16 rounded-2xl border border-dashed border-border bg-background/25">
              <p className="text-sm text-muted-foreground">
                No Project DNA profiles available.
                {canManage
                  ? " Click “Rebuild all DNA” in the header to extract from the project showcase corpus."
                  : " Please contact PMO/admin to build profiles."}
              </p>
            </div>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
              {profiles.map((p) => (
                <button
                  key={p.id}
                  onClick={() => openProfile(p.slug)}
                  className="text-left rounded-2xl border border-border/80 bg-white/70 dark:bg-card/20 backdrop-blur-sm p-5 hover:border-sky-500/40 hover:shadow-lg hover:shadow-sky-500/5 hover:-translate-y-0.5 active:translate-y-0 active:scale-[0.99] transition-all cursor-pointer flex flex-col gap-2.5 relative overflow-hidden group shadow-sm"
                >
                  {/* Card top border glow on hover */}
                  <div className="absolute top-0 left-0 right-0 h-1 bg-gradient-to-r from-sky-400 to-blue-500 opacity-0 group-hover:opacity-100 transition-opacity" />

                  <div className="flex items-start justify-between gap-3">
                    <span className="font-bold text-sm sm:text-base text-foreground group-hover:text-sky-500 transition-colors leading-tight tracking-tight line-clamp-1">
                      {p.name}
                    </span>
                    <div className="flex items-center gap-1.5 shrink-0">
                      <HealthBadge health={p.health} />
                      <ReviewBadge status={p.review_status} />
                    </div>
                  </div>

                  <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-[10px] font-semibold text-muted-foreground/75 uppercase tracking-wider">
                    {p.client_industry && <span className="text-sky-500">{p.client_industry}</span>}
                    {p.status && (
                      <>
                        <span>·</span>
                        <span
                          className={cn(
                            p.status.toLowerCase() === "completed"
                              ? "text-emerald-500"
                              : "text-amber-500",
                          )}
                        >
                          {p.status}
                        </span>
                      </>
                    )}
                  </div>

                  {p.solution_summary && (
                    <p className="text-xs text-muted-foreground line-clamp-2 leading-relaxed mt-1">
                      {p.solution_summary}
                    </p>
                  )}

                  {/* Tech stack pills */}
                  {p.technology_stack && p.technology_stack.length > 0 && (
                    <div className="flex flex-wrap gap-1 mt-1">
                      {p.technology_stack.slice(0, 3).map((tech, i) => (
                        <span
                          key={i}
                          className="px-1.5 py-0.5 rounded bg-sky-500/10 text-sky-600 dark:text-sky-400 text-[9px] font-bold"
                        >
                          {tech}
                        </span>
                      ))}
                      {p.technology_stack.length > 3 && (
                        <span className="px-1.5 py-0.5 rounded bg-muted text-muted-foreground text-[9px] font-bold">
                          +{p.technology_stack.length - 3} more
                        </span>
                      )}
                    </div>
                  )}

                  <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 border-t border-border/40 pt-2.5 mt-2.5 text-[10px] font-medium text-muted-foreground font-mono">
                    <span className="flex items-center gap-1">
                      <FileText className="w-3.5 h-3.5 text-sky-500" />
                      {p.source_doc_count} source doc(s)
                    </span>
                    <span className="flex items-center gap-1 font-semibold text-sky-500 group-hover:translate-x-0.5 transition-transform">
                      View details <ArrowRight className="w-3 h-3" />
                    </span>
                  </div>
                </button>
              ))}
            </div>
          )}
        </div>
      )}

      {/* ANALYTICS TAB */}
      {tab === "analytics" && (
        <div className="animate-in fade-in-50 duration-200 flex flex-col gap-5">
          {analyticsLoading || !analytics ? (
            <div className="flex flex-col items-center justify-center py-20 gap-3">
              <Loader2 className="w-8 h-8 animate-spin text-sky-500" />
              <span className="text-xs text-muted-foreground font-semibold">
                Aggregating portfolio DNA...
              </span>
            </div>
          ) : (
            <>
              {/* Health distribution */}
              <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
                {[
                  { label: "Strong DNA", value: analytics.health.strong || 0, cls: "text-emerald-500 bg-emerald-500/10" },
                  { label: "Moderate DNA", value: analytics.health.moderate || 0, cls: "text-amber-500 bg-amber-500/10" },
                  { label: "Thin DNA", value: analytics.health.thin || 0, cls: "text-red-500 bg-red-500/10" },
                  { label: "Reviewed", value: analytics.reviewed, cls: "text-sky-500 bg-sky-500/10" },
                ].map((m, i) => (
                  <div key={i} className="p-3.5 rounded-2xl border border-border/60 bg-white/60 dark:bg-card/20 backdrop-blur-md flex items-center justify-between shadow-sm">
                    <div>
                      <span className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider block">{m.label}</span>
                      <span className="text-2xl font-black text-foreground mt-1 block tracking-tight">{m.value}</span>
                    </div>
                    <div className={cn("p-2.5 rounded-xl", m.cls)}>
                      <Activity className="w-5 h-5" />
                    </div>
                  </div>
                ))}
              </div>

              <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
                <BarList title="Top Capabilities" icon={Layers} items={analytics.capabilities} />
                <BarList title="Technology Stack" icon={Shield} items={analytics.technologies} />
                <BarList title="Integrations" icon={Link2} items={analytics.integrations} />
                <BarList title="Industries" icon={Activity} items={analytics.industries} />
              </div>
            </>
          )}
        </div>
      )}

      {/* RISK RADAR TAB */}
      {tab === "risks" && (
        <div className="animate-in fade-in-50 duration-200 flex flex-col gap-4">
          <div className="flex items-center justify-between">
            <div>
              <h3 className="text-sm font-bold text-foreground flex items-center gap-2">
                <Zap className="w-4 h-4 text-amber-500" /> Recurring Risk Radar
              </h3>
              <p className="text-xs text-muted-foreground mt-0.5">
                Lessons and risks that appear across 2+ projects — the delivery watch-list.
              </p>
            </div>
            <button onClick={loadRisks} disabled={risksLoading} className="text-xs px-3 py-1.5 rounded-xl border border-border hover:bg-muted transition-colors cursor-pointer disabled:opacity-60 flex items-center gap-1">
              <RefreshCw className={cn("w-3 h-3", risksLoading && "animate-spin")} /> Refresh
            </button>
          </div>
          {risksLoading ? (
            <div className="flex items-center justify-center py-16 gap-3">
              <Loader2 className="w-7 h-7 animate-spin text-amber-500" />
              <span className="text-xs text-muted-foreground font-semibold">Scanning cross-project lessons...</span>
            </div>
          ) : risks.length === 0 ? (
            <div className="text-center py-14 rounded-2xl border border-dashed border-border bg-background/20">
              <Zap className="w-8 h-8 text-amber-400 mx-auto mb-2" />
              <p className="text-sm font-semibold text-foreground">No recurring risks detected yet</p>
              <p className="text-xs text-muted-foreground mt-1">Build DNA for more projects to surface cross-project patterns.</p>
            </div>
          ) : (
            <div className="flex flex-col gap-3">
              {risks.map((r, i) => {
                const isHigh = (r.impact_level || "").toLowerCase() === "high";
                return (
                  <div key={i} className={cn(
                    "rounded-2xl border p-4 flex flex-col gap-2.5 shadow-sm",
                    isHigh ? "border-red-500/20 bg-red-500/[0.03]" : "border-amber-500/20 bg-amber-500/[0.03]"
                  )}>
                    <div className="flex items-start justify-between gap-3">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className={cn(
                          "text-[10px] px-2 py-0.5 rounded-lg font-bold uppercase tracking-wider border",
                          isHigh ? "bg-red-500/10 text-red-600 dark:text-red-400 border-red-500/20"
                            : "bg-amber-500/10 text-amber-600 dark:text-amber-400 border-amber-500/20"
                        )}>
                          {r.impact_level || "Medium"} Impact
                        </span>
                        <span className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider border border-border/50 px-2 py-0.5 rounded-lg bg-background/50">
                          {r.category}
                        </span>
                      </div>
                      <div className="flex items-center gap-1.5 shrink-0 bg-background/50 border border-border/40 px-2.5 py-1 rounded-xl">
                        <TrendingUp className="w-3.5 h-3.5 text-amber-500" />
                        <span className="text-xs font-black text-foreground tabular-nums">{r.recurrence}</span>
                        <span className="text-[10px] text-muted-foreground">projects</span>
                      </div>
                    </div>
                    <p className="text-xs sm:text-sm font-semibold text-foreground leading-relaxed">{r.lesson}</p>
                    {r.recommendation && (
                      <div className="text-xs text-foreground bg-emerald-500/5 border-l-2 border-emerald-500/40 px-3 py-2 rounded-r-xl font-medium leading-relaxed">
                        <span className="text-emerald-600 dark:text-emerald-400 font-bold text-[10px] uppercase tracking-wider block mb-0.5">Recommendation</span>
                        {r.recommendation}
                      </div>
                    )}
                    <div className="flex flex-wrap gap-1.5 mt-1">
                      {r.projects.map((p) => (
                        <button
                          key={p.slug}
                          onClick={() => openProfile(p.slug)}
                          className="text-[10px] px-2 py-0.5 rounded-lg border border-sky-500/20 bg-sky-500/5 text-sky-600 dark:text-sky-400 font-semibold hover:bg-sky-500/10 transition-colors cursor-pointer"
                        >
                          {p.name}
                        </button>
                      ))}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}

      {/* DETAIL DRAWER / SHEET */}
      <Sheet open={!!selected} onOpenChange={(open) => !open && setSelected(null)}>
        <SheetContent className="w-full sm:max-w-2xl overflow-y-auto flex flex-col gap-5 p-5 sm:p-6 h-full border-l border-border/60 bg-popover/95 backdrop-blur-xl">
          {selected && (
            <>
              <SheetHeader className="text-left pb-4 border-b border-border/60 flex flex-col gap-2 shrink-0">
                <div className="flex flex-wrap items-center gap-2">
                  <ReviewBadge status={selected.review_status} />
                  <ConfBadge value={selected.confidence} />
                  <HealthBadge health={selected.health} />
                </div>
                {selected.health && selected.health.flags.length > 0 && (
                  <div className="flex flex-wrap gap-1.5 mt-1">
                    {selected.health.flags.map((f, i) => (
                      <span
                        key={i}
                        className="inline-flex items-center gap-1 text-[10px] font-medium text-amber-600 dark:text-amber-400 bg-amber-500/10 border border-amber-500/20 px-2 py-0.5 rounded-md"
                      >
                        <AlertCircle className="w-3 h-3" />
                        {f}
                      </span>
                    ))}
                  </div>
                )}
                <SheetTitle className="text-lg sm:text-xl font-black text-foreground tracking-tight leading-snug mt-1">
                  {selected.name}
                </SheetTitle>
                <SheetDescription className="text-xs font-semibold text-sky-500 uppercase tracking-wider flex items-center gap-1">
                  <Activity className="w-3.5 h-3.5 text-sky-500" />
                  {selected.client_industry || "General Industry"}{" "}
                  {selected.status ? `· ${selected.status}` : ""}
                </SheetDescription>

                {/* PMO / Admin Actions */}
                {canManage && (
                  <div className="flex flex-wrap gap-2 mt-3 pt-2">
                    {selected.review_status !== "reviewed" && (
                      <button
                        onClick={() => approve(selected.slug)}
                        className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-semibold hover:shadow-lg active:scale-95 transition-all cursor-pointer shadow-sm"
                      >
                        <CheckCircle2 className="w-4 h-4" />
                        <span>Mark Reviewed</span>
                      </button>
                    )}
                    <button
                      onClick={() => rebuildOne(selected.slug)}
                      className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-border/80 bg-background/50 hover:bg-muted text-foreground text-xs font-semibold hover:border-sky-500/30 active:scale-95 transition-all cursor-pointer shadow-sm"
                    >
                      <RefreshCw className="w-4 h-4 text-sky-500" />
                      <span>Rebuild DNA</span>
                    </button>
                  </div>
                )}
              </SheetHeader>

              {/* Core Metrics Mini Panel */}
              <div className="grid grid-cols-2 gap-3 bg-muted/30 dark:bg-white/[0.01] border border-border/40 p-4 rounded-2xl shrink-0">
                {[
                  { label: "Project Size", value: selected.project_size, icon: Layers },
                  { label: "Team Size", value: selected.team_size, icon: Users },
                  { label: "Start Date", value: selected.delivery_start_date, icon: Calendar },
                  {
                    label: "End Date",
                    value: selected.delivery_end_date || "Present",
                    icon: Calendar,
                  },
                ].map((m, idx) => (
                  <div key={idx} className="flex items-center gap-2.5">
                    <div className="p-1.5 rounded-lg bg-background/50 border border-border/40 text-muted-foreground/75">
                      <m.icon className="w-4 h-4" />
                    </div>
                    <div>
                      <span className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider block">
                        {m.label}
                      </span>
                      <span className="text-xs font-bold text-foreground block mt-0.5">
                        {m.value || "Unknown"}
                      </span>
                    </div>
                  </div>
                ))}
              </div>

              {/* Custom Drawer Tabs Switcher */}
              <div className="flex gap-1 border-b border-border/40 shrink-0 flex-wrap">
                {(
                  [
                    ["overview", "Overview", FileText],
                    ["tech", "Tech & Arch", Shield],
                    ["evidence", "Assets & Experts", Boxes],
                    ["training", "Training Recs", GraduationCap],
                    ["sources", "Sources", Database],
                  ] as const
                ).map(([id, label, Icon]) => (
                  <button
                    key={id}
                    onClick={() => {
                      setDrawerTab(id);
                      if (id === "training" && selected && !trainingRecs && !trainingLoading) {
                        loadTrainingRecs(selected.slug);
                      }
                    }}
                    className={cn(
                      "flex items-center gap-1.5 px-3.5 py-2 text-xs font-semibold border-b-2 -mb-px transition-colors cursor-pointer",
                      drawerTab === id
                        ? "border-sky-500 text-sky-500 font-bold"
                        : "border-transparent text-muted-foreground hover:text-foreground",
                    )}
                  >
                    <Icon className="w-3.5 h-3.5" />
                    <span>{label}</span>
                  </button>
                ))}
              </div>

              {/* Drawer Content Views */}
              <div className="flex-1 overflow-y-auto pr-1">
                {drawerTab === "overview" && (
                  <div className="flex flex-col gap-4 animate-in fade-in-30 duration-200">
                    <Section title="Business Problem">
                      <div className="text-xs sm:text-sm leading-relaxed text-foreground p-3.5 rounded-xl bg-amber-500/5 border border-amber-500/15">
                        {selected.business_problem ||
                          "No documented business problem details available."}
                      </div>
                    </Section>
                    <Section title="Solution Deliverables">
                      <div className="text-xs sm:text-sm leading-relaxed text-foreground p-3.5 rounded-xl bg-sky-500/5 border border-sky-500/15">
                        {selected.solution_summary ||
                          "No documented solution summary details available."}
                      </div>
                    </Section>
                    <Section title="Business Outcomes">
                      <div className="text-xs sm:text-sm leading-relaxed text-foreground p-3.5 rounded-xl bg-emerald-500/5 border border-emerald-500/15">
                        {selected.business_outcomes || "No documented outcomes details available."}
                      </div>
                    </Section>
                  </div>
                )}

                {drawerTab === "tech" && (
                  <div className="flex flex-col gap-4 animate-in fade-in-30 duration-200">
                    <Section title="Architecture Summary">
                      <p className="text-xs sm:text-sm leading-relaxed text-muted-foreground bg-muted/20 border border-border/40 p-3.5 rounded-xl">
                        {selected.architecture_summary || "No architectural description captured."}
                      </p>
                    </Section>

                    {selected.technology_stack?.length > 0 && (
                      <Section title="Technology Stack">
                        <div className="flex flex-wrap gap-1.5">
                          {selected.technology_stack.map((tech, idx) => (
                            <span
                              key={idx}
                              className="px-2.5 py-1 rounded-lg bg-sky-500/10 border border-sky-500/20 text-sky-600 dark:text-sky-400 text-xs font-semibold shadow-sm"
                            >
                              {tech}
                            </span>
                          ))}
                        </div>
                      </Section>
                    )}

                    {selected.complexity_drivers?.length > 0 && (
                      <Section title="Complexity Drivers">
                        <ul className="flex flex-col gap-2">
                          {selected.complexity_drivers.map((driver, idx) => (
                            <li
                              key={idx}
                              className="flex items-start gap-2.5 text-xs sm:text-sm text-foreground bg-muted/10 border border-border/30 p-2.5 rounded-xl"
                            >
                              <AlertCircle className="w-4 h-4 text-amber-500 shrink-0 mt-0.5" />
                              <span className="leading-relaxed">{driver}</span>
                            </li>
                          ))}
                        </ul>
                      </Section>
                    )}
                  </div>
                )}

                {drawerTab === "evidence" && (
                  <div className="flex flex-col gap-5 animate-in fade-in-30 duration-200">
                    <ChildSection
                      icon={Layers}
                      title="Capabilities Extracted"
                      items={selected.capabilities}
                      render={(c: Capability) => (
                        <div className="flex flex-col gap-1 w-full">
                          <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 gap-3">
                            <span className="font-bold text-xs sm:text-sm text-foreground">
                              {c.capability_name}
                              {c.category ? ` — ${c.category}` : ""}
                            </span>
                            <ConfBadge value={c.confidence} />
                          </div>
                          {c.maturity_level && (
                            <span className="text-[10px] font-semibold text-sky-500 uppercase tracking-wider">
                              Maturity: {c.maturity_level}
                            </span>
                          )}
                          {c.evidence && (
                            <p className="text-xs text-muted-foreground mt-1 bg-muted/40 p-2 rounded-lg leading-relaxed">
                              {c.evidence}
                            </p>
                          )}
                        </div>
                      )}
                    />

                    <ChildSection
                      icon={Link2}
                      title="Integrations Mapped"
                      items={selected.integrations}
                      render={(i: Integration) => (
                        <div className="flex flex-col gap-1 w-full">
                          <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 gap-3">
                            <span className="font-bold text-xs sm:text-sm text-foreground">
                              {i.system_name}
                              {i.integration_type ? ` (${i.integration_type})` : ""}
                            </span>
                            <ConfBadge value={i.confidence} />
                          </div>
                          {i.complexity_level && (
                            <span className="text-[10px] font-semibold text-amber-500 uppercase tracking-wider">
                              Complexity: {i.complexity_level}
                            </span>
                          )}
                          {i.lessons_learned && (
                            <div className="text-xs text-muted-foreground bg-amber-500/5 border-l-2 border-amber-500/40 p-2 rounded-r-lg mt-1.5 italic">
                              &ldquo;{i.lessons_learned}&rdquo;
                            </div>
                          )}
                        </div>
                      )}
                    />

                    <ChildSection
                      icon={Lightbulb}
                      title="Lessons Learned"
                      items={selected.lessons}
                      render={(l: Lesson) => (
                        <div className="flex flex-col gap-1 w-full">
                          <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 gap-3">
                            <span className="font-bold text-xs sm:text-sm text-foreground">
                              {l.lesson}
                            </span>
                            <ConfBadge value={l.confidence} />
                          </div>
                          <div className="flex items-center gap-2 mt-1">
                            {l.impact_level && (
                              <span
                                className={cn(
                                  "text-[9px] px-1.5 py-0.5 rounded font-bold uppercase tracking-wider",
                                  l.impact_level.toLowerCase() === "high"
                                    ? "bg-red-500/10 text-red-500"
                                    : "bg-amber-500/10 text-amber-500",
                                )}
                              >
                                {l.impact_level} Impact
                              </span>
                            )}
                            {l.category && (
                              <span className="text-[10px] font-semibold text-muted-foreground uppercase">
                                {l.category}
                              </span>
                            )}
                          </div>
                          {l.recommendation && (
                            <p className="text-xs text-foreground bg-emerald-500/5 border-l-2 border-emerald-500/40 p-2 rounded-r-lg mt-1.5 font-medium leading-relaxed">
                              <span className="text-emerald-600 font-bold block text-[10px] uppercase tracking-wider mb-0.5">
                                Recommendation:
                              </span>
                              {l.recommendation}
                            </p>
                          )}
                        </div>
                      )}
                    />

                    <ChildSection
                      icon={Boxes}
                      title="Reusable Assets Found"
                      items={selected.reusable_assets}
                      render={(a: Asset) => (
                        <div className="flex flex-col gap-1.5 w-full">
                          <div className="flex items-start justify-between gap-3">
                            <div>
                              <span className="font-bold text-xs sm:text-sm text-foreground block">
                                {a.asset_name}
                              </span>
                              {a.asset_type && (
                                <span className="text-[10px] font-semibold text-sky-500 uppercase tracking-wider">
                                  {a.asset_type}
                                </span>
                              )}
                            </div>
                            <ConfBadge value={a.confidence} />
                          </div>

                          <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-[11px] font-medium text-muted-foreground mt-0.5">
                            {a.reuse_readiness && (
                              <span className="px-1.5 py-0.5 rounded bg-sky-500/10 text-sky-600 font-bold text-[9px] uppercase tracking-wider">
                                {a.reuse_readiness}
                              </span>
                            )}
                            {a.owner && <span>· Owner: {a.owner}</span>}
                          </div>

                          <div className="flex flex-col gap-1 mt-1">
                            {a.repository_url && (
                              <a
                                href={a.repository_url}
                                target="_blank"
                                rel="noreferrer"
                                className="inline-flex items-center gap-1 text-[11px] text-sky-600 hover:text-sky-500 hover:underline"
                              >
                                <Link2 className="w-3.5 h-3.5 shrink-0" />
                                <span className="truncate">{a.repository_url}</span>
                                <ExternalLink className="w-2.5 h-2.5" />
                              </a>
                            )}
                            {a.documentation_url && (
                              <a
                                href={a.documentation_url}
                                target="_blank"
                                rel="noreferrer"
                                className="inline-flex items-center gap-1 text-[11px] text-sky-600 hover:text-sky-500 hover:underline"
                              >
                                <FileText className="w-3.5 h-3.5 shrink-0" />
                                <span className="truncate">{a.documentation_url}</span>
                                <ExternalLink className="w-2.5 h-2.5" />
                              </a>
                            )}
                          </div>
                        </div>
                      )}
                    />

                    <ChildSection
                      icon={Users}
                      title="Expertise Mapped"
                      items={selected.expertise}
                      render={(e: Expert) => (
                        <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 gap-3 w-full">
                          <div>
                            <span className="font-bold text-xs sm:text-sm text-foreground block">
                              {e.person_name}
                            </span>
                            <span className="text-xs text-muted-foreground mt-0.5 block">
                              {e.role_on_project || "Team Member"}{" "}
                              {e.capability ? `· ${e.capability}` : ""}
                            </span>
                          </div>
                          <ConfBadge value={e.evidence_level} />
                        </div>
                      )}
                    />
                  </div>
                )}

                {drawerTab === "sources" && (
                  <div className="flex flex-col gap-5 animate-in fade-in-30 duration-200">

                    {/* Extraction metadata */}
                    <div className="grid grid-cols-2 gap-3 p-4 rounded-2xl border border-border/50 bg-muted/20">
                      {[
                        { label: "Source Documents", value: selected.source_doc_count, icon: FileText },
                        { label: "Times Queried", value: selected.query_count ?? 0, icon: Hash },
                        {
                          label: "Confidence",
                          value: selected.confidence === "verified" ? "Verified" : "Inferred",
                          icon: ShieldCheck,
                        },
                        {
                          label: "Last Rebuilt",
                          value: selected.updated_at
                            ? new Date(selected.updated_at).toLocaleDateString()
                            : "Unknown",
                          icon: RefreshCw,
                        },
                      ].map((m, i) => (
                        <div key={i} className="flex items-center gap-2.5">
                          <div className="p-1.5 rounded-lg bg-background/60 border border-border/40 text-muted-foreground/70">
                            <m.icon className="w-3.5 h-3.5" />
                          </div>
                          <div>
                            <span className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider block">
                              {m.label}
                            </span>
                            <span className="text-xs font-bold text-foreground block mt-0.5">
                              {m.value}
                            </span>
                          </div>
                        </div>
                      ))}
                    </div>

                    {/* DNA Narrative */}
                    {selected.dna_summary && (
                      <div className="flex flex-col gap-2">
                        <h4 className="text-xs font-bold uppercase tracking-wider text-muted-foreground flex items-center gap-1.5">
                          <Brain className="w-3.5 h-3.5 text-sky-500" /> DNA Narrative
                        </h4>
                        <p className="text-[11px] sm:text-xs leading-relaxed text-muted-foreground whitespace-pre-wrap p-4 rounded-xl border border-border/50 bg-sky-500/[0.03]">
                          {selected.dna_summary}
                        </p>
                      </div>
                    )}

                    {/* Source document list */}
                    <div className="flex flex-col gap-2">
                      <h4 className="text-xs font-bold uppercase tracking-wider text-muted-foreground flex items-center gap-1.5">
                        <FileText className="w-3.5 h-3.5 text-sky-500" /> Ingested Source Documents
                        {selected.source_docs && selected.source_docs.length > 0 && (
                          <span className="ml-1 px-1.5 py-0.5 rounded bg-sky-500/10 text-sky-600 dark:text-sky-400 text-[9px] font-bold">
                            {selected.source_docs.length}
                          </span>
                        )}
                      </h4>
                      {(!selected.source_docs || selected.source_docs.length === 0) ? (
                        <p className="text-xs text-muted-foreground py-4 text-center">
                          No source documents found in the ingested corpus.
                        </p>
                      ) : (
                        <ul className="flex flex-col gap-1.5">
                          {selected.source_docs.map((doc, i) => {
                            const parts = doc.source_key.split("/");
                            const docType = parts.length >= 3 ? parts.slice(2).join("/") : doc.source_key;
                            return (
                              <li
                                key={i}
                                className="flex items-start gap-2.5 p-2.5 rounded-xl border border-border/40 bg-white/30 dark:bg-white/[0.01] hover:bg-sky-500/5 hover:border-sky-500/20 transition-colors"
                              >
                                <FileText className="w-3.5 h-3.5 text-sky-500 shrink-0 mt-0.5" />
                                <div className="min-w-0 flex-1">
                                  <span className="text-xs font-semibold text-foreground block leading-snug truncate">
                                    {doc.title}
                                  </span>
                                  <span className="text-[10px] text-muted-foreground font-mono truncate block mt-0.5">
                                    {docType}
                                  </span>
                                </div>
                              </li>
                            );
                          })}
                        </ul>
                      )}
                    </div>
                  </div>
                )}

                {drawerTab === "training" && (
                  <div className="flex flex-col gap-4 animate-in fade-in-30 duration-200">
                    <div className="flex items-center justify-between">
                      <h4 className="text-xs font-bold uppercase tracking-wider text-muted-foreground flex items-center gap-1.5">
                        <GraduationCap className="w-4 h-4 text-purple-500" /> Lesson-to-Training Recommendations
                      </h4>
                      <button
                        onClick={() => selected && loadTrainingRecs(selected.slug)}
                        disabled={trainingLoading}
                        className="text-[11px] px-2.5 py-1 rounded-lg border border-purple-500/30 text-purple-600 dark:text-purple-400 hover:bg-purple-500/10 transition-colors font-semibold cursor-pointer disabled:opacity-60"
                      >
                        {trainingLoading ? <Loader2 className="w-3 h-3 animate-spin inline" /> : "Refresh"}
                      </button>
                    </div>

                    {trainingLoading && (
                      <div className="flex items-center gap-2 py-8 justify-center text-xs text-muted-foreground">
                        <Loader2 className="w-5 h-5 animate-spin text-purple-500" />
                        Searching Udemy catalog for each skill area...
                      </div>
                    )}

                    {!trainingLoading && trainingRecs?.status === "udemy_unavailable" && (
                      <div className="text-xs text-muted-foreground bg-muted/20 border border-border/40 p-4 rounded-xl">
                        Udemy Business is not connected. Configure credentials in backend/.env to enable course recommendations.
                      </div>
                    )}

                    {!trainingLoading && trainingRecs?.areas && trainingRecs.areas.length === 0 && (
                      <div className="text-xs text-muted-foreground py-6 text-center">
                        No skill areas extracted from this project's lessons yet.
                      </div>
                    )}

                    {!trainingLoading && (trainingRecs?.areas || []).map((area, i) => (
                      <div key={i} className="flex flex-col gap-2">
                        <h5 className="text-[11px] font-bold text-purple-600 dark:text-purple-400 uppercase tracking-wider flex items-center gap-1.5">
                          <BookOpen className="w-3.5 h-3.5" /> {area.area}
                        </h5>
                        <div className="flex flex-col gap-2">
                          {area.courses.map((c, j) => (
                            <a
                              key={j}
                              href={c.url || "#"}
                              target="_blank"
                              rel="noreferrer"
                              className="flex flex-col gap-1 p-3 rounded-xl border border-border/50 bg-white/40 dark:bg-white/[0.02] hover:border-purple-500/30 hover:bg-purple-500/5 transition-colors group"
                            >
                              <div className="flex items-start justify-between gap-2">
                                <span className="text-xs font-semibold text-foreground group-hover:text-purple-600 dark:group-hover:text-purple-400 transition-colors leading-snug">
                                  {c.title}
                                </span>
                                <ExternalLink className="w-3 h-3 text-muted-foreground/60 shrink-0 mt-0.5" />
                              </div>
                              {c.headline && (
                                <p className="text-[10px] text-muted-foreground line-clamp-2 leading-relaxed">{c.headline}</p>
                              )}
                              <div className="flex items-center gap-2 mt-0.5">
                                {c.rating && (
                                  <span className="text-[10px] font-semibold text-amber-500">★ {c.rating.toFixed(1)}</span>
                                )}
                                {c.num_subscribers && (
                                  <span className="text-[10px] text-muted-foreground">
                                    {c.num_subscribers.toLocaleString()} students
                                  </span>
                                )}
                              </div>
                            </a>
                          ))}
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>

              {selected.reviewed_by && (
                <div className="mt-auto pt-3.5 border-t border-border/40 text-[10px] text-muted-foreground/80 font-mono text-center shrink-0">
                  Reviewed by {selected.reviewed_by}{" "}
                  {selected.reviewed_at
                    ? `on ${new Date(selected.reviewed_at).toLocaleDateString()}`
                    : ""}
                </div>
              )}
            </>
          )}
        </SheetContent>
      </Sheet>
    </div>
  );
}

function BarList({
  title,
  icon: Icon,
  items,
}: {
  title: string;
  icon: typeof Layers;
  items: { label: string; count: number }[];
}) {
  const max = items.reduce((m, it) => Math.max(m, it.count), 0) || 1;
  return (
    <div className="rounded-2xl border border-border/60 bg-white/60 dark:bg-card/20 backdrop-blur-md p-4 shadow-sm">
      <h4 className="text-xs sm:text-sm font-bold text-foreground inline-flex items-center gap-1.5 border-b border-border/40 pb-2 mb-3 w-full">
        <Icon className="w-4 h-4 text-sky-500" /> {title}
      </h4>
      {items.length === 0 ? (
        <p className="text-xs text-muted-foreground py-4 text-center">No data yet.</p>
      ) : (
        <ul className="flex flex-col gap-2">
          {items.slice(0, 12).map((it, i) => (
            <li key={i} className="flex items-center gap-2">
              <span className="text-xs text-foreground truncate w-1/2 shrink-0" title={it.label}>
                {it.label}
              </span>
              <div className="flex-1 h-2.5 rounded-full bg-muted/50 overflow-hidden">
                <div
                  className="h-full rounded-full bg-gradient-to-r from-sky-400 to-blue-500"
                  style={{ width: `${Math.max(6, (it.count / max) * 100)}%` }}
                />
              </div>
              <span className="text-[11px] font-bold text-muted-foreground tabular-nums w-6 text-right">
                {it.count}
              </span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-2 mt-1">
      <h4 className="text-xs sm:text-sm font-bold uppercase tracking-wider text-muted-foreground/80">
        {title}
      </h4>
      {children}
    </div>
  );
}

function ChildSection<T>({
  icon: Icon,
  title,
  items,
  render,
}: {
  icon: typeof Layers;
  title: string;
  items?: T[];
  render: (item: T) => React.ReactNode;
}) {
  if (!items || items.length === 0) return null;
  return (
    <div className="flex flex-col gap-2.5">
      <h4 className="text-xs sm:text-sm font-bold text-foreground inline-flex items-center gap-1.5 border-b border-border/40 pb-1.5">
        <Icon className="w-4 h-4 text-sky-500" /> {title}
      </h4>
      <ul className="flex flex-col gap-3">
        {items.map((it, i) => {
          const quote = (it as { source_quote?: string | null }).source_quote;
          return (
            <li
              key={i}
              className="text-sm rounded-2xl border border-border/60 bg-white/40 dark:bg-white/[0.01] p-3.5 flex flex-col gap-2 shadow-sm relative overflow-hidden"
            >
              {render(it)}
              {quote && (
                <div className="flex items-start gap-1.5 text-[11px] text-muted-foreground bg-sky-500/[0.04] border-l-2 border-sky-500/30 pl-2 pr-2 py-1.5 rounded-r-lg italic">
                  <FileText className="w-3 h-3 mt-0.5 shrink-0 text-sky-500" />
                  <span className="leading-relaxed">&ldquo;{quote}&rdquo;</span>
                </div>
              )}
            </li>
          );
        })}
      </ul>
    </div>
  );
}
