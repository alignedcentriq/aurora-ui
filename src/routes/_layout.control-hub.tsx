import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useAuth } from "@/lib/auth-store";
import { useState, useEffect, useMemo } from "react";
import { z } from "zod";
import { cn } from "@/lib/utils";
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
  ChevronRight,
  Menu,
} from "lucide-react";

// Import components from their route files
import { AdminDashboard } from "./_layout.admin";
import { AdminPortal } from "./_layout.admin-portal";
import { HRPortal } from "./_layout.hr-portal";
import { ITPortal } from "./_layout.it-portal";
import { PMOPortal } from "./_layout.pmo-portal";
import { ManagerPortal } from "./_layout.manager-portal";
import { PeoplePage } from "./_layout.people";
import { ConfigPage } from "./_layout.config";
import { UrlLibrary } from "./_layout.url-library";
import { FormLibrary } from "./_layout.form-library";
import { ObservabilityDashboard } from "./_layout.observability";

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
  | "admin-portal"
  | "hr-portal"
  | "it-portal"
  | "pmo-portal"
  | "manager-portal"
  | "people"
  | "config"
  | "url-library"
  | "form-library";

interface TabItem {
  id: TabId;
  label: string;
  category: "System & Ops" | "Management Portals" | "Assets & Config";
  icon: typeof Megaphone;
  color: string;
  show: (role: string) => boolean;
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
    component: AdminDashboard,
  },
  {
    id: "observability",
    label: "AI Observability",
    category: "System & Ops",
    icon: Activity,
    color: "#6366F1",
    show: (role) => role === "IT",
    component: ObservabilityDashboard,
  },
  // PORTALS
  {
    id: "admin-portal",
    label: "Admin Services",
    category: "Management Portals",
    icon: Car,
    color: "#00a29a",
    show: (role) => role === "Admin",
    component: AdminPortal,
  },
  {
    id: "hr-portal",
    label: "HR Leave Portal",
    category: "Management Portals",
    icon: CalendarDays,
    color: "#16A34A",
    show: (role) => role === "HR",
    component: HRPortal,
  },
  {
    id: "it-portal",
    label: "IT Support & Control",
    category: "Management Portals",
    icon: Ticket,
    color: "#3B82F6",
    show: (role) => role === "IT",
    component: ITPortal,
  },
  {
    id: "pmo-portal",
    label: "PMO Portal",
    category: "Management Portals",
    icon: GraduationCap,
    color: "#8B5CF6",
    show: (role) => role === "PMO",
    component: PMOPortal,
  },
  {
    id: "manager-portal",
    label: "Manager Attendance",
    category: "Management Portals",
    icon: UserCog,
    color: "#16A34A",
    show: (role) => role === "Functional Manager",
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
    component: PeoplePage,
  },
  {
    id: "config",
    label: "AI Prompt Config",
    category: "Assets & Config",
    icon: Database,
    color: "#00a29a",
    show: (role) => ["Admin", "HR", "IT", "PMO"].includes(role),
    component: ConfigPage,
  },
  {
    id: "url-library",
    label: "URL Library",
    category: "Assets & Config",
    icon: Link2,
    color: "#00a29a",
    show: (role) => role === "Admin",
    component: UrlLibrary,
  },
  {
    id: "form-library",
    label: "Form Library",
    category: "Assets & Config",
    icon: FileText,
    color: "#00a29a",
    show: (role) => role === "Admin",
    component: FormLibrary,
  },
];

function ControlHubPage() {
  const { user } = useAuth();
  const search = Route.useSearch();
  const navigate = useNavigate();

  const role = user?.role ?? "";

  // Filter tabs visible to the current user's role
  const allowedTabs = useMemo(() => {
    return TABS.filter((t) => t.show(role));
  }, [role]);

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
      search: { tab: tabId },
    });
  };

  // If role changes and active tab is no longer allowed, reset to first allowed tab
  useEffect(() => {
    if (allowedTabs.length > 0 && !allowedTabs.some((t) => t.id === activeTabId)) {
      handleTabChange(allowedTabs[0].id);
    }
  }, [allowedTabs, activeTabId]);

  // Access check
  if (!user || role === "Employee") {
    return (
      <div className="flex h-full items-center justify-center bg-background">
        <div className="text-center max-w-sm px-4">
          <div className="mx-auto mb-5 flex h-14 w-14 items-center justify-center rounded-2xl bg-destructive/10 text-destructive border border-destructive/20 shadow-[0_0_15px_rgba(239,68,68,0.07)] animate-pulse">
            <ShieldAlert className="h-6 w-6" />
          </div>
          <h2 className="text-lg font-bold text-foreground tracking-tight">Access Restricted</h2>
          <p className="text-sm text-muted-foreground mt-2 leading-relaxed">
            This Control Hub is reserved for HR, IT, PMO, Admin, and Functional Manager roles.
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
