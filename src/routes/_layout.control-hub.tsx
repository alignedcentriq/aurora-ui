import { createFileRoute } from "@tanstack/react-router";
import { useAuth } from "@/lib/auth-store";
import { useEffect, useMemo } from "react";
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
  | "automation-hub";

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
      ["HR", "Admin", "IT", "PMO", "Functional Manager", "Super Admin"].includes(role),
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
    label: "HR Leave Portal",
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
    id: "manager-portal",
    label: "Manager Attendance",
    category: "Management Portals",
    icon: UserCog,
    color: "#16A34A",
    show: (role) => role === "Functional Manager",
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

function ControlHubPage() {
  const { user } = useAuth();
  const search = Route.useSearch();
  const navigate = Route.useNavigate();

  const role = user?.role ?? "";

  const scopes = user?.scopes ?? [];
  const fullAccess = scopes.length === 0;

  // Returns true if the user's scope list covers `scopeId` — either the exact base scope
  // OR any `scopeId:action` granular variant (read-only still counts as "has access").
  const hasScopeAccess = (scopeId: string) =>
    scopes.includes(scopeId) || scopes.some((s) => s.startsWith(`${scopeId}:`));

  // Filter tabs by role, then by scope (empty scopes = full role access)
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

  // Determine active tab
  const activeTabId = useMemo<TabId>(() => {
    const requestedTab = search.tab as TabId;
    if (requestedTab && allowedTabs.some((t) => t.id === requestedTab)) {
      return requestedTab;
    }
    return allowedTabs[0]?.id ?? "dashboard";
  }, [search.tab, allowedTabs]);

  // Sync tab selection with router search parameter
  const handleTabChange = (tabId: TabId) => {
    navigate({
      search: (prev: { tab?: string }) => ({ ...prev, tab: tabId }),
    });
  };

  // If role changes and active tab is no longer allowed, reset to first allowed tab
  useEffect(() => {
    if (allowedTabs.length > 0 && !allowedTabs.some((t) => t.id === activeTabId)) {
      handleTabChange(allowedTabs[0].id);
    }
  }, [allowedTabs, activeTabId]);

  // Access check
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
    <div className="flex flex-col h-full w-full bg-[#f5f7fa] dark:bg-background overflow-hidden relative">
      {/* ── Central Content Area ── */}
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
            {ActiveComponent ? (
              <ActiveComponent />
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
