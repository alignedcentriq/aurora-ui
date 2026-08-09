import { createFileRoute } from "@tanstack/react-router";
import { useAuth } from "@/lib/auth-store";
import { useAutomationDrawer } from "@/lib/automation-drawer-store";
import { useUdemyAutomations } from "@/lib/udemy-automations-store";
import { lazy, Suspense, useEffect, useMemo } from "react";
import { z } from "zod";
import { motion, AnimatePresence } from "framer-motion";
import { HoverEffect } from "@/components/ui/card-hover-effect";
import { AmbientField } from "@/components/three/AmbientField";
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
  Brain,
  ScrollText,
  LogIn,
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
const MemoryBrainTab = lazy(() =>
  import("@/pages/MemoryBrainTab").then((m) => ({ default: m.MemoryBrainTab })),
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
const AuditTrail = lazy(() =>
  import("@/pages/AuditTrail").then((m) => ({ default: m.AuditTrail })),
);
const LoginHistory = lazy(() =>
  import("@/pages/LoginHistory").then((m) => ({ default: m.LoginHistory })),
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

const controlHubSearchSchema = z.object({
  tab: z.string().optional(),
  // Deep-link into a tab's own internal sub-tab (e.g. Observability's Feedback Triage /
  // Feature Adoption panels) — read by that tab component itself, ignored otherwise.
  sub: z.string().optional(),
});

export const Route = createFileRoute("/_layout/control-hub")({
  validateSearch: controlHubSearchSchema,
  component: ControlHubPage,
});

type TabId =
  | "dashboard"
  | "analytics-builder"
  | "observability"
  | "memory-brain"
  | "llm-controls"
  | "role-control"
  | "audit-trail"
  | "login-history"
  | "admin-portal"
  | "hr-portal"
  | "it-portal"
  | "pmo-portal"
  | "leadership-command"
  | "project-iq"
  | "te-lms"
  | "udemy-business"
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
    id: "analytics-builder",
    label: "Analytics Studio",
    category: "System & Ops",
    icon: LayoutDashboard,
    color: "#6366F1",
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
    id: "audit-trail",
    label: "Audit Trail",
    category: "System & Ops",
    icon: ScrollText,
    color: "#F59E0B",
    show: (role) => role === "Super Admin",
    component: AuditTrail,
  },
  {
    id: "login-history",
    label: "Login History",
    category: "System & Ops",
    icon: LogIn,
    color: "#F59E0B",
    show: (role) => role === "Super Admin",
    component: LoginHistory,
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
    id: "memory-brain",
    label: "Memory Brain",
    category: "System & Ops",
    icon: Brain,
    color: "#00c4bb",
    show: (role) => role === "Super Admin",
    component: MemoryBrainTab,
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
    label: "HR Requests",
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
    show: (role) => role === "PMO" || role === "Admin" || role === "Super Admin",
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
  // ASSETS & CONFIG
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

// Legacy tab ids → current tab id. Keeps old deep-links working after a tab is
// renamed or merged. analytics-studio was consolidated into analytics-builder.
const TAB_ALIASES: Record<string, TabId> = {
  "analytics-studio": "analytics-builder",
};

const TAB_DESCRIPTIONS: Record<TabId, string> = {
  dashboard: "Broadcast alerts, policy changes, and official events to the workspace.",
  "analytics-builder": "Describe any chart in plain English, iterate, export — and save multi-chart dashboards.",
  "role-control": "Configure user role scopes, AD groups, and view permission trees.",
  "audit-trail":
    "Complete history of role, access, automation, and settings changes — who, what, when, before and after.",
  "login-history": "Every user login, who and when — Super Admin only, never notified.",
  observability: "Track AI token usage, request latency, and debug LLM tool calls.",
  "memory-brain":
    "Explore everything the assistant knows and has learned from chat as a living neuron graph.",
  "llm-controls": "Tweak parameters, override models, and toggle regional model routing.",
  "automation-hub": "Automate email sequences, rule actions, and triggers.",
  "admin-portal": "Submit transport claims, desk keys, parking stickers, and library books.",
  "hr-portal": "Handle escalations, document requests, HR queries, and grievances.",
  "it-portal": "Open IT tickets, view device status, and check active support incidents.",
  "pmo-portal": "Monitor project delivery status, milestones, and training compliance.",
  "leadership-command":
    "Org-wide workforce intelligence: capability heat map, pipeline readiness, SPOF risk, and bench cost.",
  "project-iq":
    "Reuse delivery knowledge: find similar past projects, lessons, experts, and reusable assets.",
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

      {/* Ambient three.js accent — device-tiered, skips itself on low-power/mobile-constrained hardware */}
      <div className="absolute top-0 left-0 right-0 h-[280px] opacity-60">
        <AmbientField colors={["#6366f1", "#00a29a"]} />
      </div>

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
  const { openDrawer: openAutomationDrawer } = useAutomationDrawer();
  const { open: openUdemyAutomations } = useUdemyAutomations();

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
    const requested = (TAB_ALIASES[search.tab ?? ""] ?? search.tab) as TabId | "overview";
    if (requested === "overview") return "overview";
    if (requested && allowedTabs.some((t) => t.id === requested)) {
      return requested;
    }
    return "overview";
  }, [search.tab, allowedTabs]);

  const handleTabChange = (tabId: TabId | "overview") => {
    navigate({
      search: (prev: { tab?: string }) => ({ ...prev, tab: tabId }),
    });
  };

  // Rewrite legacy tab deep-links (e.g. the retired analytics-studio) to their
  // current id so the URL reflects the resolved tab.
  useEffect(() => {
    if (search.tab && TAB_ALIASES[search.tab]) {
      handleTabChange(TAB_ALIASES[search.tab] as TabId);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [search.tab]);

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
                    <AnimatePresence mode="wait">
                      <motion.span
                        key={activeTabId}
                        initial={{ opacity: 0, y: -6 }}
                        animate={{ opacity: 1, y: 0 }}
                        exit={{ opacity: 0, y: 6 }}
                        transition={{ duration: 0.18, ease: "easeOut" }}
                        className="text-foreground font-semibold flex items-center gap-1.5 min-w-0"
                      >
                        {activeTab && (
                          <activeTab.icon
                            className="h-3.5 w-3.5 shrink-0"
                            style={{ color: activeTab.color }}
                          />
                        )}
                        <span className="truncate">{activeTab?.label}</span>
                      </motion.span>
                    </AnimatePresence>
                  </div>

                  {/* Portal-contextual Email Automation trigger */}
                  {activeTabId !== "automation-hub" && (
                    <button
                      onClick={() =>
                        activeTabId === "udemy-business"
                          ? openUdemyAutomations()
                          : openAutomationDrawer(
                              activeTabId as string,
                              activeTab?.label,
                            )
                      }
                      className="flex items-center gap-1.5 text-[11px] font-semibold px-2.5 py-1 rounded-lg border border-amber-200 dark:border-amber-500/30 text-amber-700 dark:text-amber-400 bg-amber-50 dark:bg-amber-500/10 hover:bg-amber-100 dark:hover:bg-amber-500/20 transition-colors shrink-0"
                    >
                      <Zap className="h-3 w-3" />
                      Automate
                    </button>
                  )}
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
