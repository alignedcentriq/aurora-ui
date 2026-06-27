import { createFileRoute } from "@tanstack/react-router";
import { useAuth } from "@/lib/auth-store";
import { lazy, Suspense, useEffect, useMemo } from "react";
import { z } from "zod";
import { motion, AnimatePresence } from "framer-motion";
import { HoverEffect } from "@/components/ui/card-hover-effect";
import {
  Megaphone,
  BookOpen,
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
  LayoutDashboard,
  ArrowRight,
  Lock,
  CheckCircle2,
  ShieldCheck,
  TrendingUp,
  Globe,
  Rocket,
  Brain,
} from "lucide-react";

// Page components are lazy-loaded so the Control Hub route ships only the shell;
// the heavy portal bundle for a tab is fetched on demand the first time it opens.
// (Only one tab renders at a time, so eagerly bundling all 23 wasted the initial download.)
const AdminDashboard = lazy(() =>
  import("@/pages/AdminDashboard").then((m) => ({ default: m.AdminDashboard })),
);
const AdminPortal = lazy(() =>
  import("@/pages/AdminPortal").then((m) => ({ default: m.AdminPortal })),
);
const HRPortal = lazy(() => import("@/pages/HRPortal").then((m) => ({ default: m.HRPortal })));
const ITPortal = lazy(() => import("@/pages/ITPortal").then((m) => ({ default: m.ITPortal })));
const PMOPortal = lazy(() => import("@/pages/PMOPortal").then((m) => ({ default: m.PMOPortal })));
const LeadershipPortal = lazy(() =>
  import("@/pages/LeadershipPortal").then((m) => ({ default: m.LeadershipPortal })),
);
const AutomationHub = lazy(() =>
  import("@/pages/AutomationHub").then((m) => ({ default: m.AutomationHub })),
);
const ManagerPortal = lazy(() =>
  import("@/pages/ManagerPortal").then((m) => ({ default: m.ManagerPortal })),
);
const PeoplePage = lazy(() =>
  import("@/pages/PeoplePage").then((m) => ({ default: m.PeoplePage })),
);
const ConfigPage = lazy(() =>
  import("@/pages/ConfigPage").then((m) => ({ default: m.ConfigPage })),
);
const UrlLibrary = lazy(() =>
  import("@/pages/UrlLibrary").then((m) => ({ default: m.UrlLibrary })),
);
const FormLibrary = lazy(() =>
  import("@/pages/FormLibrary").then((m) => ({ default: m.FormLibrary })),
);
const ConnectorStudio = lazy(() => import("@/pages/ConnectorStudio"));
const ObservabilityDashboard = lazy(() =>
  import("@/pages/ObservabilityDashboard").then((m) => ({ default: m.ObservabilityDashboard })),
);
const RoiDashboard = lazy(() =>
  import("@/pages/RoiDashboard").then((m) => ({ default: m.RoiDashboard })),
);
const AnalyticsStudio = lazy(() =>
  import("@/pages/AnalyticsStudio").then((m) => ({ default: m.AnalyticsStudio })),
);
const AnalyticsBuilder = lazy(() =>
  import("@/pages/AnalyticsBuilder").then((m) => ({ default: m.AnalyticsBuilder })),
);
const LLMControlsPage = lazy(() =>
  import("@/pages/LLMControlsPage").then((m) => ({ default: m.LLMControlsPage })),
);
const AccessManagement = lazy(() =>
  import("@/pages/AccessManagement").then((m) => ({ default: m.AccessManagement })),
);
const CabinDirectory = lazy(() =>
  import("@/pages/CabinDirectory").then((m) => ({ default: m.CabinDirectory })),
);
const TechElevateLocalPortal = lazy(() =>
  import("@/pages/TechElevateLocalPortal").then((m) => ({ default: m.TechElevateLocalPortal })),
);
const UdemyBusinessPortal = lazy(() =>
  import("@/pages/UdemyBusinessPortal").then((m) => ({ default: m.UdemyBusinessPortal })),
);
const ProjectIQPortal = lazy(() =>
  import("@/pages/ProjectIQPortal").then((m) => ({ default: m.ProjectIQPortal })),
);
const OnboardingTracker = lazy(() =>
  import("@/pages/OnboardingTracker").then((m) => ({ default: m.OnboardingTracker })),
);

const controlHubSearchSchema = z.object({
  tab: z.string().optional(),
});

export const Route = createFileRoute("/_layout/control-hub")({
  validateSearch: controlHubSearchSchema,
  component: ControlHubPage,
});

type TabId =
  | "dashboard"
  | "roi"
  | "analytics-studio"
  | "analytics-builder"
  | "observability"
  | "llm-controls"
  | "role-control"
  | "admin-portal"
  | "hr-portal"
  | "onboarding-tracker"
  | "it-portal"
  | "pmo-portal"
  | "leadership-command"
  | "project-iq"
  | "te-lms"
  | "udemy-business"
  | "manager-portal"
  | "people"
  | "config"
  | "url-library"
  | "form-library"
  | "automation-hub"
  | "cabin-directory"
  | "connector-studio";

interface TabItem {
  id: TabId;
  label: string;
  category: "System & Ops" | "Management Portals" | "Assets & Config";
  icon: typeof Megaphone;
  color: string;
  show: (role: string) => boolean;
  requireScope?: string; // Admin must have this specific scope (or full access)
  requireAnyScope?: string[]; // Admin must have at least one of these scopes (or full access)
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
    id: "roi",
    label: "ROI Dashboard",
    category: "System & Ops",
    icon: TrendingUp,
    color: "#10B981",
    show: (role) => role !== "Employee",
    component: RoiDashboard,
  },
  {
    id: "analytics-studio",
    label: "Analytics Studio",
    category: "System & Ops",
    icon: LayoutDashboard,
    color: "#6366F1",
    show: (role) => role !== "Employee",
    component: AnalyticsStudio,
  },
  {
    id: "analytics-builder",
    label: "Chart Builder AI",
    category: "System & Ops",
    icon: Brain,
    color: "#8B5CF6",
    show: (role) => role !== "Employee",
    component: AnalyticsBuilder,
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
    id: "onboarding-tracker",
    label: "Onboarding Tracker",
    category: "Management Portals",
    icon: Rocket,
    color: "#7C3AED",
    show: (role) => role === "HR",
    component: OnboardingTracker,
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
    id: "leadership-command",
    label: "Capability Command",
    category: "Management Portals",
    icon: TrendingUp,
    color: "#06B6D4",
    show: (role) => role === "PMO" || role === "Admin",
    component: LeadershipPortal,
  },
  {
    id: "project-iq",
    label: "Project IQ",
    category: "Management Portals",
    icon: Brain,
    color: "#0EA5E9",
    show: (role) => role !== "Employee",
    component: ProjectIQPortal,
  },
  {
    id: "te-lms",
    label: "TechElevate LMS",
    category: "Management Portals",
    icon: GraduationCap,
    color: "#7C3AED",
    show: () => true,
    component: TechElevateLocalPortal,
  },
  {
    id: "udemy-business",
    label: "Udemy Business",
    category: "Management Portals",
    icon: BookOpen,
    color: "#A435F0",
    show: () => true,
    component: UdemyBusinessPortal,
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
  {
    id: "connector-studio",
    label: "Connector Studio",
    category: "Assets & Config",
    icon: Globe,
    color: "#6366f1",
    show: (role) => role === "Super Admin",
    component: ConnectorStudio,
  },
];

const TAB_DESCRIPTIONS: Record<TabId, string> = {
  dashboard: "Broadcast alerts, policy changes, and official events to the workspace.",
  roi: "See time saved, ticket deflection, and cost — the assistant's business value.",
  "analytics-studio": "Build charts in plain English or dropdowns, then save dashboards.",
  "analytics-builder": "AI chart builder — describe any visualization in natural language, iterate, export.",
  "role-control": "Configure user role scopes, AD groups, and view permission trees.",
  observability: "Track AI token usage, request latency, and debug LLM tool calls.",
  "llm-controls": "Tweak parameters, override models, and toggle regional model routing.",
  "automation-hub": "Automate email sequences, rule actions, and triggers.",
  "admin-portal": "Submit transport claims, desk keys, parking stickers, and library books.",
  "hr-portal": "Request leave, review pending approvals, and download payroll reports.",
  "onboarding-tracker":
    "Track every new joiner's onboarding progress, steps, and joining documents.",
  "it-portal": "Open IT tickets, view device status, and check active support incidents.",
  "pmo-portal": "Monitor project delivery status, milestones, and training compliance.",
  "leadership-command":
    "Org-wide workforce intelligence: capability heat map, pipeline readiness, SPOF risk, and bench cost.",
  "project-iq":
    "Reuse delivery knowledge: find similar past projects, lessons, experts, and reusable assets.",
  "manager-portal": "Review attendance check-ins, hierarchy status, and shift reports.",
  people: "Browse team directories, organization hierarchy, and contact cards.",
  config: "Customize base templates, instructions, and system guardrails.",
  "cabin-directory": "Map of facility office spaces, meeting rooms, and cabins.",
  "url-library": "Curated catalog of workspace tools and deep-linked applications.",
  "form-library": "Submit custom forms, view request archives, and check statuses.",
  "connector-studio":
    "Import OpenAPI specs, configure auth, test operations, and publish connectors for zero-code integrations.",
  "te-lms":
    "In-house LMS: browse trainings, assign them, and take assessments that earn verified skills.",
  "udemy-business":
    "Browse the company's Udemy Business course catalog and track learner activity.",
};

function TabLoadingFallback() {
  return (
    <div className="flex flex-1 h-full items-center justify-center bg-[#f5f7fa] dark:bg-background">
      <div className="flex flex-col items-center gap-3 text-muted-foreground">
        <div className="h-8 w-8 rounded-full border-2 border-primary/30 border-t-primary animate-spin" />
        <p className="text-[13px] font-medium">Loading portal…</p>
      </div>
    </div>
  );
}

interface ControlHubOverviewProps {
  allowedTabs: TabItem[];
  onTabChange: (tabId: TabId) => void;
  user: any;
}

function ControlHubOverview({ allowedTabs, onTabChange, user }: ControlHubOverviewProps) {
  return (
    <div className="flex-1 h-full overflow-y-auto bg-gradient-to-br from-[#f5f7fa] to-[#e8eef8] dark:from-[#020d1a] dark:to-[#071428] mesh-accent px-4 sm:px-8 py-5 sm:py-6 select-none relative">
      {/* Glow highlight in background */}
      <div className="absolute top-10 left-1/2 -translate-x-1/2 w-[400px] h-[150px] bg-gradient-to-r from-primary/10 to-[#00a29a]/10 rounded-full blur-[80px] pointer-events-none" />

      {/* ── Top Header Section ── */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 border-b border-[#e2e8f0] dark:border-white/[0.08] pb-6 mb-6">
        <div>
          <span className="text-[10px] font-bold uppercase tracking-[0.15em] text-primary dark:text-[#00c4bb] mb-1.5 block">
            Operational Hub
          </span>
          <h1 className="text-[22px] sm:text-[26px] font-black tracking-tight text-glow text-4c mb-1">
            Command Center
          </h1>
          <p className="text-[13px] text-muted-foreground">
            A centralized directory of all operational systems, configurations, and tools.
          </p>
        </div>
      </div>

      {/* Telemetry Banner cards removed per user request */}

      {/* ── Directory Grid ── */}
      {allowedTabs.length === 0 ? (
        <div className="text-center py-12 rounded-2xl border border-dashed border-[#e2e8f0] dark:border-white/[0.06] bg-white/30 dark:bg-card/10 w-full">
          <p className="text-sm text-muted-foreground">No portals are available for your role.</p>
        </div>
      ) : (
        <HoverEffect
          items={allowedTabs.map((tab) => {
            const TabIcon = tab.icon;
            return {
              title: tab.label,
              description: TAB_DESCRIPTIONS[tab.id] || "Workspace management portal.",
              category: tab.category,
              onClick: () => onTabChange(tab.id),
              icon: <TabIcon className="h-5 w-5" style={{ color: tab.color }} />,
              color: tab.color,
            };
          })}
        />
      )}
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
                <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between border-b border-[#e2e8f0] dark:border-white/[0.08] bg-white/80 dark:bg-background/80 backdrop-blur-md px-4 py-2 sm:px-6 sm:py-2.5 shrink-0 select-none">
                  <div className="flex items-center gap-2 text-[11px] min-w-0">
                    <button
                      onClick={() => handleTabChange("overview")}
                      className="text-muted-foreground hover:text-foreground transition-colors font-semibold hover:underline cursor-pointer shrink-0"
                    >
                      Control Hub
                    </button>
                    <span className="text-muted-foreground/35">/</span>
                    <span className="text-foreground font-semibold flex items-center gap-1.5 min-w-0">
                      {activeTab && (
                        <activeTab.icon
                          className="h-3.5 w-3.5 shrink-0"
                          style={{ color: activeTab.color }}
                        />
                      )}
                      <span className="truncate">{activeTab?.label}</span>
                    </span>
                  </div>
                </div>

                {/* Viewport content */}
                <div className="flex-1 h-full overflow-hidden flex flex-col bg-[#f5f7fa] dark:bg-background">
                  <Suspense fallback={<TabLoadingFallback />}>
                    <ActiveComponent />
                  </Suspense>
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
