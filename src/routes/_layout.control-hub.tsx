import { createFileRoute } from "@tanstack/react-router";
import { useAuth } from "@/lib/auth-store";
import { useEffect, useMemo, useState } from "react";
import { z } from "zod";
import { motion, AnimatePresence } from "framer-motion";
import {
  Megaphone,
  Car,
  CalendarDays,
  Ticket,
  GraduationCap,
  UserCog,
  Users,
  Database,
  Link2,
  FileText,
  Activity,
  Shield,
  ShieldAlert,
  Zap,
  Building2,
  Search,
  LayoutDashboard,
  ChevronDown,
  ArrowRight,
  Lock,
  CheckCircle2,
  Crown,
  Briefcase,
  Wrench,
  ClipboardList,
  ShieldCheck,
  TrendingUp,
  Newspaper,
} from "lucide-react";

// Page components live outside the routes folder so they are code-split
import { AdminDashboard } from "@/pages/AdminDashboard";
import { AdminPortal } from "@/pages/AdminPortal";
import { HRPortal } from "@/pages/HRPortal";
import { ITPortal } from "@/pages/ITPortal";
import { PMOPortal } from "@/pages/PMOPortal";
import { AutomationHub } from "@/pages/AutomationHub";
import { ManagerPortal } from "@/pages/ManagerPortal";
import { PeoplePage } from "@/pages/PeoplePage";
import { ConfigPage } from "@/pages/ConfigPage";
import { UrlLibrary } from "@/pages/UrlLibrary";
import { FormLibrary } from "@/pages/FormLibrary";
import { ObservabilityDashboard } from "@/pages/ObservabilityDashboard";
import { LLMControlsPage } from "@/pages/LLMControlsPage";
import { AccessManagement } from "@/pages/AccessManagement";
import { CabinDirectory } from "@/pages/CabinDirectory";
import { SecurityDigestPage } from "@/pages/SecurityDigestPage";

const controlHubSearchSchema = z.object({
  tab: z.string().optional(),
});

export const Route = createFileRoute("/_layout/control-hub")({
  validateSearch: controlHubSearchSchema,
  component: ControlHubPage,
});

type TabId =
  | "dashboard"
  | "observability"
  | "llm-controls"
  | "role-control"
  | "admin-portal"
  | "hr-portal"
  | "it-portal"
  | "pmo-portal"
  | "manager-portal"
  | "people"
  | "config"
  | "url-library"
  | "form-library"
  | "automation-hub"
  | "cabin-directory"
  | "security-digest";

interface TabItem {
  id: TabId;
  label: string;
  category: "System & Ops" | "Management Portals" | "Assets & Config";
  icon: typeof Megaphone;
  color: string;
  show: (role: string) => boolean;
  requireScope?: string;       // Admin must have this specific scope (or full access)
  requireAnyScope?: string[];  // Admin must have at least one of these scopes (or full access)
  component: React.ComponentType<any>;
}

const TABS: TabItem[] = [
  // SYSTEM & OPS
  {
    id: "dashboard",
    label: "Announcements & Status",
    category: "System & Ops",
    icon: Megaphone,
    color: "#00a29a",
    show: (role) => role === "Admin",
    requireScope: "announcements",
    component: AdminDashboard,
  },
  {
    id: "role-control",
    label: "Access Management",
    category: "System & Ops",
    icon: UserCog,
    color: "#F59E0B",
    show: (role) => role === "Super Admin",
    component: AccessManagement,
  },
  {
    id: "observability",
    label: "AI Observability",
    category: "System & Ops",
    icon: Activity,
    color: "#6366F1",
    show: (role) => role === "Super Admin" || role === "IT",
    requireScope: "observability",
    component: ObservabilityDashboard,
  },
  {
    id: "llm-controls",
    label: "LLM Model Controls",
    category: "System & Ops",
    icon: Shield,
    color: "#F59E0B",
    show: (role) => role === "Super Admin" || role === "IT",
    requireScope: "llm_controls",
    component: LLMControlsPage,
  },
  {
    id: "automation-hub",
    label: "Email Automation Hub",
    category: "System & Ops",
    icon: Zap,
    color: "#F59E0B",
    show: (role) =>
      ["HR", "Admin", "IT", "PMO", "Functional Manager", "Super Admin", "Employee"].includes(role),
    requireScope: "email_automation",
    component: AutomationHub,
  },
  // PORTALS
  {
    id: "admin-portal",
    label: "Admin Services",
    category: "Management Portals",
    icon: Car,
    color: "#00a29a",
    show: (role) => role === "Admin",
    requireAnyScope: ["reimbursements", "parking", "desk_keys", "food_complaints", "bookshelf"],
    component: AdminPortal,
  },
  {
    id: "hr-portal",
    label: "HR Portal",
    category: "Management Portals",
    icon: CalendarDays,
    color: "#16A34A",
    show: (role) => role === "HR",
    requireScope: "leave_management",
    component: HRPortal,
  },
  {
    id: "it-portal",
    label: "IT Support & Control",
    category: "Management Portals",
    icon: Ticket,
    color: "#3B82F6",
    show: (role) => role === "IT",
    requireScope: "it_support",
    component: ITPortal,
  },
  {
    id: "security-digest",
    label: "Security Digest",
    category: "Management Portals",
    icon: Newspaper,
    color: "#F59E0B",
    show: (role) => role === "Super Admin",
    component: SecurityDigestPage,
  },
  {
    id: "pmo-portal",
    label: "PMO Portal",
    category: "Management Portals",
    icon: GraduationCap,
    color: "#8B5CF6",
    show: (role) => role === "PMO",
    requireScope: "pmo_portal",
    component: PMOPortal,
  },
  {
    id: "manager-portal",
    label: "My Team",
    category: "Management Portals",
    icon: UserCog,
    color: "#16A34A",
    show: (role) => role === "Functional Manager" || role === "Super Admin",
    requireScope: "attendance_reports",
    component: ManagerPortal,
  },
  // ASSETS & CONFIG
  {
    id: "people",
    label: "People Directory",
    category: "Assets & Config",
    icon: Users,
    color: "#00a29a",
    show: (role) => ["HR", "PMO", "Admin", "Functional Manager"].includes(role),
    requireScope: "people_directory",
    component: PeoplePage,
  },
  {
    id: "config",
    label: "AI Prompt Config",
    category: "Assets & Config",
    icon: Database,
    color: "#00a29a",
    show: (role) => ["Admin", "HR", "IT", "PMO", "Super Admin"].includes(role),
    requireScope: "prompt_config",
    component: ConfigPage,
  },
  {
    id: "cabin-directory",
    label: "Cabin Directory",
    category: "Assets & Config",
    icon: Building2,
    color: "#F59E0B",
    show: (role) => role === "Super Admin",
    component: CabinDirectory,
  },
  {
    id: "url-library",
    label: "URL Library",
    category: "Assets & Config",
    icon: Link2,
    color: "#00a29a",
    show: (role) => role === "Super Admin",
    component: UrlLibrary,
  },
  {
    id: "form-library",
    label: "Form Library",
    category: "Assets & Config",
    icon: FileText,
    color: "#00a29a",
    show: (role) => role === "Admin" || role === "Super Admin",
    requireScope: "form_library",
    component: FormLibrary,
  },
];

const TAB_DESCRIPTIONS: Record<TabId, string> = {
  dashboard: "Broadcast alerts, policy changes, and official events to the workspace.",
  "role-control": "Configure user role scopes, AD groups, and view permission trees.",
  observability: "Track AI token usage, request latency, and debug LLM tool calls.",
  "llm-controls": "Tweak parameters, override models, and toggle regional model routing.",
  "automation-hub": "Automate email sequences, rule actions, and triggers.",
  "admin-portal": "Submit transport claims, desk keys, parking stickers, and library books.",
  "hr-portal": "Request leave, review pending approvals, and download payroll reports.",
  "it-portal": "Open IT tickets, view device status, and check active support incidents.",
  "pmo-portal": "Monitor project delivery status, milestones, and training compliance.",
  "manager-portal": "Review attendance check-ins, hierarchy status, and shift reports.",
  people: "Browse team directories, organization hierarchy, and contact cards.",
  config: "Customize base templates, instructions, and system guardrails.",
  "cabin-directory": "Map of facility office spaces, meeting rooms, and cabins.",
  "url-library": "Curated catalog of workspace tools and deep-linked applications.",
  "form-library": "Submit custom forms, view request archives, and check statuses.",
  "security-digest": "Configure cybersecurity news digest — recipients, schedule, and news sources.",
};

const ROLE_META: Record<string, { icon: any; color: string; bg: string; label: string }> = {
  Employee:          { icon: Briefcase,    color: "#3B8FE8", bg: "rgba(59, 143, 232, 0.08)", label: "Employee" },
  HR:                { icon: Users,        color: "#22C55E", bg: "rgba(34, 197, 94, 0.08)", label: "Human Resources" },
  IT:                { icon: Wrench,       color: "#14B8A6", bg: "rgba(20, 184, 166, 0.08)", label: "IT Support" },
  PMO:               { icon: ClipboardList,color: "#4F6FEF", bg: "rgba(79, 111, 239, 0.08)", label: "Project Management" },
  Admin:             { icon: ShieldCheck,  color: "#3B8FE8", bg: "rgba(59, 143, 232, 0.08)", label: "Administrator" },
  "Functional Manager": { icon: UserCog,   color: "#22C55E", bg: "rgba(34, 197, 94, 0.08)", label: "Functional Manager" },
  "Super Admin":     { icon: Crown,        color: "#F59E0B", bg: "rgba(245, 158, 11, 0.08)", label: "Super Admin" },
};

const CATEGORIES = ["All", "System & Ops", "Management Portals", "Assets & Config"] as const;

interface ControlHubOverviewProps {
  allowedTabs: TabItem[];
  onTabChange: (tabId: TabId) => void;
  user: any;
}

function ControlHubOverview({ allowedTabs, onTabChange, user }: ControlHubOverviewProps) {
  const [selectedCategory, setSelectedCategory] = useState<string>("All");
  const [searchQuery, setSearchQuery] = useState("");

  const roleInfo = ROLE_META[user.role] || {
    icon: ShieldCheck,
    color: "#1B6FC8",
    bg: "rgba(27, 111, 200, 0.08)",
    label: user.role,
  };
  const RoleIcon = roleInfo.icon;

  const filteredTabs = useMemo(() => {
    return allowedTabs.filter((t) => {
      const matchesCategory = selectedCategory === "All" || t.category === selectedCategory;
      const matchesSearch =
        t.label.toLowerCase().includes(searchQuery.toLowerCase()) ||
        (TAB_DESCRIPTIONS[t.id] || "").toLowerCase().includes(searchQuery.toLowerCase());
      return matchesCategory && matchesSearch;
    });
  }, [allowedTabs, selectedCategory, searchQuery]);

  return (
    <div className="flex-1 h-full overflow-y-auto bg-gradient-to-br from-[#f5f7fa] to-[#e8eef8] dark:from-[#020d1a] dark:to-[#071428] mesh-accent px-8 py-6 select-none relative">
      {/* Glow highlight in background */}
      <div className="absolute top-10 left-1/2 -translate-x-1/2 w-[400px] h-[150px] bg-gradient-to-r from-primary/10 to-[#00a29a]/10 rounded-full blur-[80px] pointer-events-none" />

      {/* ── Top Header Section ── */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 border-b border-[#e2e8f0] dark:border-white/[0.08] pb-6 mb-6">
        <div>
          <span className="text-[10px] font-bold uppercase tracking-[0.15em] text-primary dark:text-[#00c4bb] mb-1.5 block">
            Operational Hub
          </span>
          <h1 className="text-[26px] font-black tracking-tight text-glow text-4c mb-1">
            Command Center
          </h1>
          <p className="text-[13px] text-muted-foreground">
            A centralized directory of all operational systems, configurations, and tools.
          </p>
        </div>

        {/* Live Nominals Tracker Card */}
        <div className="flex items-center gap-3 rounded-2xl bg-white/70 dark:bg-card/70 border border-[#e2e8f0] dark:border-white/[0.06] backdrop-blur-md p-3.5 pr-5 max-w-xs shadow-sm">
          <div className="h-2 w-2 rounded-full bg-emerald-500 shadow-[0_0_8px_rgba(16,185,129,0.7)] animate-pulse shrink-0" />
          <div className="text-left">
            <p className="text-[11px] font-bold text-foreground flex items-center gap-1">
              All Systems Operational
            </p>
            <p className="text-[10px] text-muted-foreground/85 mt-0.5">
              Secure TLS connection • latency nominal
            </p>
          </div>
        </div>
      </div>

      {/* ── Grid: Telemetry Banner & Actions ── */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 mb-6">
        {/* User Role Card */}
        <div className="rounded-2xl border border-[#e2e8f0] dark:border-[#3b8fe8]/12 bg-white dark:bg-card/50 p-5 shadow-sm flex items-center justify-between select-none">
          <div className="flex items-center gap-4">
            <div
              className="flex h-12 w-12 items-center justify-center rounded-2xl shrink-0"
              style={{ background: roleInfo.bg }}
            >
              <RoleIcon className="h-6 w-6" style={{ color: roleInfo.color }} />
            </div>
            <div>
              <p className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">Authorized Profile</p>
              <p className="text-base font-bold text-foreground mt-0.5">{user.name}</p>
              <span
                className="inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[9px] font-bold mt-1 text-white"
                style={{ backgroundColor: roleInfo.color }}
              >
                {roleInfo.label}
              </span>
            </div>
          </div>
        </div>

        {/* Access Level Card */}
        <div className="rounded-2xl border border-[#e2e8f0] dark:border-[#3b8fe8]/12 bg-white dark:bg-card/50 p-5 shadow-sm flex items-center justify-between select-none">
          <div>
            <p className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">Access Level</p>
            <p className="text-base font-bold text-foreground mt-0.5">
              {user.scopes && user.scopes.length > 0 ? `${user.scopes.length} Scoped Rules` : "Full Administrative"}
            </p>
            <p className="text-[11px] text-muted-foreground mt-1">
              {user.scopes && user.scopes.length > 0 ? "Permissions bound by AD group scopes" : "Inherited implicit superuser access"}
            </p>
          </div>
          <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-primary/10 shrink-0">
            <ShieldCheck className="h-5 w-5 text-primary" />
          </div>
        </div>

        {/* Telemetry quick status Card */}
        <div className="rounded-2xl border border-[#e2e8f0] dark:border-[#3b8fe8]/12 bg-white dark:bg-card/50 p-5 shadow-sm flex items-center justify-between select-none">
          <div>
            <p className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">Available Services</p>
            <p className="text-base font-bold text-foreground mt-0.5">
              {allowedTabs.length} Portals Gated
            </p>
            <p className="text-[11px] text-muted-foreground mt-1">
              Active workspaces matched to your roles
            </p>
          </div>
          <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-[#00a29a]/10 shrink-0">
            <TrendingUp className="h-5 w-5 text-[#00a29a]" />
          </div>
        </div>
      </div>

      {/* ── Filter & Search Controls ── */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 mb-6">
        {/* Categories Tabs Selector */}
        <div className="flex flex-wrap rounded-xl border border-[#e2e8f0] dark:border-white/[0.08] bg-white/50 dark:bg-background/50 p-1 select-none w-fit">
          {CATEGORIES.map((cat) => (
            <button
              key={cat}
              onClick={() => setSelectedCategory(cat)}
              className={`px-4 py-1.5 rounded-lg text-xs font-semibold relative transition-all cursor-pointer ${
                selectedCategory === cat
                  ? "text-primary dark:text-[#00c4bb] bg-white dark:bg-card shadow-sm"
                  : "text-muted-foreground hover:text-foreground"
              }`}
            >
              {cat}
            </button>
          ))}
        </div>

        {/* Search Input */}
        <div className="relative w-full sm:w-64">
          <Search className="absolute left-3.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground pointer-events-none" />
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Search portals..."
            className="w-full h-9 rounded-xl border border-[#e2e8f0] dark:border-white/[0.08] bg-white/50 dark:bg-card/50 pl-10 pr-4 text-xs outline-none focus:bg-white dark:focus:bg-card focus:border-primary/40 focus:ring-1 focus:ring-primary/20 transition-all placeholder:text-muted-foreground/75"
          />
        </div>
      </div>

      {/* ── Directory Grid ── */}
      <AnimatePresence mode="popLayout">
        {filteredTabs.length === 0 ? (
          <motion.div
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 10 }}
            className="text-center py-12 rounded-2xl border border-dashed border-[#e2e8f0] dark:border-white/[0.06] bg-white/30 dark:bg-card/10 w-full"
          >
            <p className="text-sm text-muted-foreground">No portals match your criteria.</p>
          </motion.div>
        ) : (
          <motion.div
            layout
            className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-5 w-full"
          >
            {filteredTabs.map((tab) => {
              const TabIcon = tab.icon;
              const hoverShadowGlow = `0 12px 30px -5px color-mix(in oklab, ${tab.color} 18%, transparent), 0 0 0 1px color-mix(in oklab, ${tab.color} 24%, transparent)`;
              return (
                <motion.div
                  key={tab.id}
                  layout
                  initial={{ opacity: 0, scale: 0.95 }}
                  animate={{ opacity: 1, scale: 1 }}
                  exit={{ opacity: 0, scale: 0.95 }}
                  transition={{ duration: 0.2, ease: "easeOut" }}
                  onClick={() => onTabChange(tab.id)}
                  whileHover={{ y: -4, scale: 1.01 }}
                  className="glass-widget rounded-2xl p-5 border border-[#e2e8f0] dark:border-white/[0.06] flex flex-col justify-between h-44 cursor-pointer text-left relative overflow-hidden group"
                  style={{
                    boxShadow: "0 4px 12px -2px rgba(0, 0, 0, 0.02)",
                  }}
                  onMouseEnter={(e) => {
                    e.currentTarget.style.boxShadow = hoverShadowGlow;
                  }}
                  onMouseLeave={(e) => {
                    e.currentTarget.style.boxShadow = "0 4px 12px -2px rgba(0, 0, 0, 0.02)";
                  }}
                >
                  {/* Subtle top color stripe overlay */}
                  <div
                    className="absolute top-0 left-0 right-0 h-[2.5px] opacity-75 group-hover:opacity-100 transition-opacity"
                    style={{ backgroundColor: tab.color }}
                  />

                  {/* Icon & Category Indicator */}
                  <div className="flex items-center justify-between">
                    <div
                      className="flex h-10 w-10 items-center justify-center rounded-xl transition-all"
                      style={{
                        backgroundColor: `color-mix(in oklab, ${tab.color} 12%, transparent)`,
                      }}
                    >
                      <TabIcon
                        className="h-5 w-5 transition-transform duration-300 group-hover:scale-110"
                        style={{ color: tab.color }}
                      />
                    </div>
                    <span className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground/60">
                      {tab.category}
                    </span>
                  </div>

                  {/* Title & Description */}
                  <div className="mt-3 flex-1">
                    <h3 className="text-[14px] font-extrabold text-foreground group-hover:text-primary dark:group-hover:text-[#00c4bb] transition-colors leading-tight flex items-center gap-1">
                      {tab.label}
                      <ArrowRight className="h-3 w-3 opacity-0 group-hover:opacity-100 -translate-x-1.5 group-hover:translate-x-0 transition-all duration-200" style={{ color: tab.color }} />
                    </h3>
                    <p className="text-[11.5px] text-muted-foreground leading-snug mt-1.5 line-clamp-2">
                      {TAB_DESCRIPTIONS[tab.id] || "Workspace management portal."}
                    </p>
                  </div>
                </motion.div>
              );
            })}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

function ControlHubPage() {
  const { user } = useAuth();
  const search = Route.useSearch();
  const navigate = Route.useNavigate();

  const role = user?.role ?? "";
  const scopes = user?.scopes ?? [];
  const fullAccess = scopes.length === 0;

  const hasScopeAccess = (scopeId: string) =>
    scopes.includes(scopeId) || scopes.some((s) => s.startsWith(`${scopeId}:`));

  const allowedTabs = useMemo(() => {
    return TABS.filter((t) => {
      if (!t.show(role)) return false;
      if (!fullAccess) {
        if (t.requireScope && !hasScopeAccess(t.requireScope)) return false;
        if (t.requireAnyScope && !t.requireAnyScope.some((s) => hasScopeAccess(s))) return false;
      }
      return true;
    });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [role, fullAccess, scopes.join(",")]);

  const activeTabId = useMemo<TabId | "overview">(() => {
    const requestedTab = search.tab as TabId | "overview";
    if (requestedTab === "overview") return "overview";
    if (requestedTab && allowedTabs.some((t) => t.id === requestedTab)) {
      return requestedTab;
    }
    return "overview";
  }, [search.tab, allowedTabs]);

  const handleTabChange = (tabId: TabId | "overview") => {
    navigate({
      search: (prev: { tab?: string }) => ({ ...prev, tab: tabId }),
    });
  };

  useEffect(() => {
    if (activeTabId !== "overview" && !allowedTabs.some((t) => t.id === activeTabId)) {
      handleTabChange("overview");
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [allowedTabs, activeTabId]);

  if (!user) {
    return (
      <div className="flex h-full items-center justify-center bg-background">
        <div className="text-center max-w-sm px-4">
          <div className="mx-auto mb-5 flex h-14 w-14 items-center justify-center rounded-2xl bg-destructive/10 text-destructive border border-destructive/20 shadow-[0_0_15px_rgba(239,68,68,0.07)] animate-pulse">
            <ShieldAlert className="h-6 w-6" />
          </div>
          <h2 className="text-lg font-bold text-foreground tracking-tight">Access Restricted</h2>
          <p className="text-sm text-muted-foreground mt-2 leading-relaxed">
            Please log in to access this page.
          </p>
        </div>
      </div>
    );
  }

  const activeTab = allowedTabs.find((t) => t.id === activeTabId);
  const ActiveComponent = activeTab?.component;

  return (
    <div className="flex flex-col h-full w-full bg-[#f5f7fa] dark:bg-background overflow-hidden relative select-none">
      <main className="flex-1 h-full overflow-hidden relative flex flex-col bg-[#f5f7fa] dark:bg-background">
        <AnimatePresence mode="wait">
          <motion.div
            key={activeTabId}
            initial={{ opacity: 0, y: 5 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -5 }}
            transition={{ duration: 0.15, ease: "easeOut" }}
            className="flex-1 h-full overflow-hidden flex flex-col"
          >
            {activeTabId === "overview" ? (
              <ControlHubOverview
                allowedTabs={allowedTabs}
                onTabChange={handleTabChange}
                user={user}
              />
            ) : ActiveComponent ? (
              <div className="flex-1 h-full overflow-hidden flex flex-col bg-background">
                {/* Sleek Breadcrumb/Sub-navigation Header */}
                <div className="flex items-center justify-between border-b border-[#e2e8f0] dark:border-white/[0.08] bg-white/80 dark:bg-background/80 backdrop-blur-md px-6 py-2.5 shrink-0 select-none">
                  <div className="flex items-center gap-2 text-[11px]">
                    <button
                      onClick={() => handleTabChange("overview")}
                      className="text-muted-foreground hover:text-foreground transition-colors font-semibold hover:underline cursor-pointer"
                    >
                      Control Hub
                    </button>
                    <span className="text-muted-foreground/35">/</span>
                    <span className="text-foreground font-semibold flex items-center gap-1.5">
                      {activeTab && (
                        <activeTab.icon
                          className="h-3.5 w-3.5 shrink-0"
                          style={{ color: activeTab.color }}
                        />
                      )}
                      {activeTab?.label}
                    </span>
                  </div>

                  {/* Actions & Portal Quick Switcher */}
                  <div className="flex items-center gap-2.5">
                    <button
                      onClick={() => handleTabChange("overview")}
                      className="flex items-center gap-1 text-[11px] font-semibold text-muted-foreground hover:text-foreground hover:bg-muted px-2.5 py-1.5 rounded-lg transition-all cursor-pointer border border-[#e2e8f0] dark:border-white/[0.08] bg-white dark:bg-card shadow-sm"
                    >
                      <LayoutDashboard className="h-3.5 w-3.5" />
                      <span>Overview</span>
                    </button>

                    <div className="relative group">
                      <button className="flex items-center gap-1 text-[11px] font-semibold text-muted-foreground hover:text-foreground hover:bg-muted px-2.5 py-1.5 rounded-lg transition-all cursor-pointer border border-[#e2e8f0] dark:border-white/[0.08] bg-white dark:bg-card shadow-sm">
                        <span>Switch Portal</span>
                        <ChevronDown className="h-3.5 w-3.5 opacity-60" />
                      </button>
                      <div className="absolute right-0 top-full mt-1.5 w-56 bg-[#0c1222]/95 border border-white/[0.08] dark:border-white/[0.08] backdrop-blur-xl shadow-2xl rounded-xl p-1.5 opacity-0 pointer-events-none group-hover:opacity-100 group-hover:pointer-events-auto transition-all duration-200 z-50">
                        <div className="px-2.5 py-1 text-[9px] font-bold uppercase tracking-wider text-white/35">
                          Allowed Portals
                        </div>
                        <div className="max-h-60 overflow-y-auto space-y-0.5 no-scrollbar mt-1">
                          {allowedTabs.map((t) => {
                            const TIcon = t.icon;
                            return (
                              <button
                                key={t.id}
                                onClick={() => handleTabChange(t.id)}
                                className={`flex w-full items-center gap-2.5 px-2.5 py-1.5 rounded-lg text-[12px] font-medium transition-all text-left ${
                                  t.id === activeTabId
                                    ? "text-white bg-[#00a29a]/20 font-semibold"
                                    : "text-white/60 hover:text-white hover:bg-white/5"
                                }`}
                              >
                                <TIcon className="h-3.5 w-3.5 opacity-65 shrink-0" style={{ color: t.color }} />
                                <span className="truncate flex-1">{t.label}</span>
                              </button>
                            );
                          })}
                        </div>
                      </div>
                    </div>
                  </div>
                </div>

                {/* Viewport content */}
                <div className="flex-1 h-full overflow-hidden flex flex-col bg-[#f5f7fa] dark:bg-background">
                  <ActiveComponent />
                </div>
              </div>
            ) : (
              <div className="flex h-full items-center justify-center text-muted-foreground">
                No view selected.
              </div>
            )}
          </motion.div>
        </AnimatePresence>
      </main>
    </div>
  );
}
