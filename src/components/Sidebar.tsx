import { Link, useLocation } from "@tanstack/react-router";
import {
  MessageSquare,
  Settings,
  Database,
  ChevronDown,
  Users,
  Check,
  LogOut,
  Shield,
  Briefcase,
  Wrench,
  ClipboardList,
  UserCog,
  Plus,
  Trash2,
  CalendarDays,
  Car,
  Ticket,
  PanelLeftClose,
  PanelLeftOpen,
  X,
  Sparkles,
  Activity,
  BookOpen,
  FileText,
  GraduationCap,
  Link2,
  Megaphone,
  SlidersHorizontal,
  Crown,
  Zap,
  Globe,
  Search,
  ClipboardCheck,
} from "lucide-react";
import { Logo } from "./Logo";
import { BrandName } from "./BrandName";
import { useAuth, Role } from "@/lib/auth-store";
import { COUNTRIES, useSettings } from "@/lib/settings-store";
import { cn } from "@/lib/utils";
import { useState, useRef, useEffect } from "react";
import { useChatStore } from "@/lib/chat-store";
import { motion, AnimatePresence } from "framer-motion";
import { SittingBuddy } from "./assistant/GreetingBot";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";

/** 4C color coding for roles */
const ROLE_META: Record<Role, { icon: typeof Shield; color: string; label: string; cKey: string }> = {
  Employee:          { icon: Briefcase,    color: "text-[#3B8FE8]",  label: "Employee",          cKey: "Clarity"       },
  HR:                { icon: Users,        color: "text-[#22C55E]",  label: "Human Resources",   cKey: "Collaboration" },
  IT:                { icon: Wrench,       color: "text-[#14B8A6]",  label: "IT Support",        cKey: "Connectivity"  },
  PMO:               { icon: ClipboardList,color: "text-[#4F6FEF]",  label: "Project Management",cKey: "Capacity"      },
  Admin:             { icon: Shield,       color: "text-[#3B8FE8]",  label: "Administrator",     cKey: "Clarity"       },
  "Functional Manager": { icon: UserCog,   color: "text-[#22C55E]",  label: "Functional Manager",cKey: "Collaboration" },
  "Super Admin":     { icon: Crown,        color: "text-[#F59E0B]",  label: "Super Admin",       cKey: "Capacity"      },
};

/** 4C Nav item accent colors for icons */
const NAV_COLORS: Record<string, string> = {
  "/":              "var(--clarity)",
  "/documents":     "var(--connectivity)",
  "/my-requests":   "var(--collaboration)",
  "/control-hub":   "var(--clarity)",
  "/settings":      "var(--capacity)",
};

interface ControlHubSubItem {
  id: string;
  label: string;
  category: "System & Ops" | "Management Portals" | "Assets & Config";
  icon: any;
  show: (role: string) => boolean;
}

const CONTROL_HUB_SUB_ITEMS: ControlHubSubItem[] = [
  // SYSTEM & OPS
  {
    id: "automation-hub",
    label: "Email Automation Hub",
    category: "System & Ops",
    icon: Zap,
    show: (role) =>
      ["HR", "Admin", "IT", "PMO", "Functional Manager", "Super Admin"].includes(role),
  },
  {
    id: "role-control",
    label: "Access Management",
    category: "System & Ops",
    icon: Shield,
    show: (role) => role === "Super Admin",
  },
  {
    id: "dashboard",
    label: "Announcements & Status",
    category: "System & Ops",
    icon: Megaphone,
    show: (role) => role === "Admin",
  },
  {
    id: "observability",
    label: "AI Observability",
    category: "System & Ops",
    icon: Activity,
    show: (role) => role === "Super Admin",
  },
  {
    id: "llm-controls",
    label: "LLM Model Controls",
    category: "System & Ops",
    icon: SlidersHorizontal,
    show: (role) => role === "Super Admin",
  },
  // PORTALS
  {
    id: "admin-portal",
    label: "Admin Services",
    category: "Management Portals",
    icon: Car,
    show: (role) => role === "Admin",
  },
  {
    id: "hr-portal",
    label: "HR Portal",
    category: "Management Portals",
    icon: CalendarDays,
    show: (role) => role === "HR",
  },
  {
    id: "it-portal",
    label: "IT Support & Control",
    category: "Management Portals",
    icon: Ticket,
    show: (role) => role === "IT",
  },
  {
    id: "pmo-portal",
    label: "PMO Portal",
    category: "Management Portals",
    icon: GraduationCap,
    show: (role) => role === "PMO",
  },
  {
    id: "manager-portal",
    label: "My Team",
    category: "Management Portals",
    icon: UserCog,
    show: (role) => role === "Functional Manager" || role === "Super Admin",
  },
  // ASSETS & CONFIG
  {
    id: "people",
    label: "People Directory",
    category: "Assets & Config",
    icon: Users,
    show: (role) => ["HR", "PMO", "Admin", "Functional Manager"].includes(role),
  },
  {
    id: "config",
    label: "AI Prompt Config",
    category: "Assets & Config",
    icon: Database,
    show: (role) => ["Admin", "HR", "IT", "PMO", "Super Admin"].includes(role),
  },
  {
    id: "url-library",
    label: "URL Library",
    category: "Assets & Config",
    icon: Link2,
    show: (role) => role === "Super Admin",
  },
  {
    id: "form-library",
    label: "Form Library",
    category: "Assets & Config",
    icon: FileText,
    show: (role) => role === "Admin" || role === "Super Admin",
  },
];

interface SidebarProps {
  mobileOpen: boolean;
  onMobileClose: () => void;
}

export function Sidebar({ mobileOpen, onMobileClose }: SidebarProps) {
  const { threads, activeId, setActiveId, createThread, deleteThread } = useChatStore();
  const { user, logout, setRole } = useAuth();
  const { buddyEnabled } = useSettings();
  const location = useLocation();
  const [isRoleDropdownOpen, setRoleDropdownOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const dropdownRef = useRef<HTMLDivElement>(null);
  const [avatarError, setAvatarError] = useState(false);
  const [deleteConfirmId, setDeleteConfirmId] = useState<string | null>(null);



  const isControlHubActive = location.pathname.startsWith("/control-hub");
  const [isControlHubExpanded, setIsControlHubExpanded] = useState(isControlHubActive);

  // For employees: show the automation-hub sidebar item only if they have co-owned automations
  const [hasCoOwnedAutomations, setHasCoOwnedAutomations] = useState(false);
  useEffect(() => {
    if (!user || user.role.toLowerCase() !== "employee") return;
    fetch("/api/automation/rules", {
      headers: { "x-user-email": user.email, "x-user-role": user.role },
    })
      .then((r) => r.json())
      .then((data) => setHasCoOwnedAutomations(Array.isArray(data) && data.length > 0))
      .catch(() => {});
  }, [user?.email, user?.role]);

  // Auto-expand when path changes to control-hub
  useEffect(() => {
    if (isControlHubActive) {
      setIsControlHubExpanded(true);
    }
  }, [isControlHubActive]);

  const defaultCollapsed = () => {
    if (typeof window === "undefined") return false;
    const saved = localStorage.getItem("sidebar-collapsed");
    if (saved !== null) return saved === "true";
    return window.innerWidth < 1024;
  };
  const [isCollapsed, setIsCollapsed] = useState(defaultCollapsed);

  const toggle = () => {
    setIsCollapsed((v) => {
      const next = !v;
      if (typeof window !== "undefined") {
        localStorage.setItem("sidebar-collapsed", String(next));
      }
      return next;
    });
  };

  useEffect(() => {
    setAvatarError(false);
  }, [user?.avatarUrl]);

  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) {
        setRoleDropdownOpen(false);
      }
    };
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  if (!user) return null;

  const isActive = (path: string) => {
    if (path === "/" && location.pathname === "/") return true;
    if (path !== "/" && location.pathname.startsWith(path)) return true;
    return false;
  };

  const handleDelete = (id: string) => {
    setDeleteConfirmId(id);
  };

  const confirmDelete = async () => {
    if (!deleteConfirmId) return;
    const id = deleteConfirmId;
    setDeleteConfirmId(null);
    deleteThread(id);
    try {
      await fetch(`/api/chat/${id}`, { method: "DELETE" });
    } catch {
      // delete failed silently — local state already removed
    }
  };

  const roles: Role[] = ["Employee", "HR", "IT", "PMO", "Admin", "Functional Manager", "Super Admin"];

  const visibleControlHubItems = CONTROL_HUB_SUB_ITEMS.filter((sub) => {
    if (sub.id === "automation-hub" && user.role.toLowerCase() === "employee") {
      return hasCoOwnedAutomations;
    }
    return sub.show(user.role);
  });
  const hasControlHubAccess = visibleControlHubItems.length > 0;

  const navItems = [
    { to: "/", icon: MessageSquare, label: "Chat", show: true },
    { to: "/books", icon: BookOpen, label: "Library", show: true },
    { to: "/documents", icon: FileText, label: "Documents", show: true },
    { to: "/my-requests", icon: ClipboardCheck, label: "My Requests", show: true },
    {
      to: "/control-hub",
      icon: Shield,
      label: "Control Hub",
      show: hasControlHubAccess,
    },
    { to: "/settings", icon: Settings, label: "Settings", show: true },
  ];

  const showLabels = !isCollapsed || mobileOpen;

  const avatarEl = user.avatarUrl && !avatarError ? (
    <img
      src={user.avatarUrl}
      alt={user.name}
      onError={() => setAvatarError(true)}
      className="h-9 w-9 rounded-full object-cover shrink-0 ring-2 ring-[var(--clarity)]/30"
    />
  ) : (
    <div
      className="flex h-9 w-9 items-center justify-center rounded-full text-[13px] font-bold text-white shrink-0"
      style={{
        background: "var(--gradient-primary)",
        boxShadow: "0 0 0 2px rgba(27,111,200,0.25)",
      }}
    >
      {user.name.split(" ").map((n) => n[0]).join("")}
    </div>
  );

  return (
    <>
      {/* Mobile backdrop */}
      <AnimatePresence>
        {mobileOpen && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.2 }}
            className="fixed inset-0 bg-black/70 backdrop-blur-sm z-40 md:hidden"
            onClick={onMobileClose}
          />
        )}
      </AnimatePresence>

      <motion.aside
        layout
        transition={{ duration: 0.25, ease: [0.16, 1, 0.3, 1] }}
        className={cn(
          "flex flex-col h-screen relative",
          "border-r border-white/[0.05]",
          "fixed md:relative inset-y-0 left-0 z-50",
          "w-[272px]",
          "transition-transform md:transition-[width] duration-250 ease-[cubic-bezier(0.16,1,0.3,1)]",
          mobileOpen ? "translate-x-0" : "-translate-x-full md:translate-x-0",
          isCollapsed ? "md:w-[62px]" : "md:w-[240px]",
        )}
        style={{ background: "var(--gradient-sidebar)" }}
      >
        {/* ── Unique: Vertical gradient brand stripe (leftmost 3px) ── */}
        <div
          className="absolute left-0 top-0 bottom-0 w-[3px] pointer-events-none"
          style={{ background: "var(--gradient-primary)" }}
        />

        {/* ── Unique: Subtle hex mesh overlay ── */}
        <div
          className="absolute inset-0 pointer-events-none opacity-[0.04]"
          style={{
            backgroundImage: `url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='56' height='100'%3E%3Cpath d='M28 66L0 50V16L28 0l28 16v34L28 66zm0-6l22-13V19L28 6 6 19v28l22 13z' fill='none' stroke='%233B8FE8' stroke-width='0.5'/%3E%3C/svg%3E")`,
            backgroundSize: "56px 100px",
          }}
        />

        {/* Animated scan-line for the sidebar */}
        <motion.div
          className="absolute inset-0 pointer-events-none overflow-hidden"
          aria-hidden="true"
        >
          <motion.div
            className="absolute w-full h-[1px] opacity-[0.08]"
            style={{
              background: "linear-gradient(90deg, transparent, var(--clarity), var(--connectivity), transparent)",
            }}
            animate={{ top: ["-2%", "102%"] }}
            transition={{ duration: 6, repeat: Infinity, ease: "linear", repeatDelay: 3 }}
          />
        </motion.div>

        {/* ── Header ─────────────────────────────────── */}
        <div
          className={cn(
            "relative flex h-[60px] items-center shrink-0",
            "border-b border-white/[0.06]",
            showLabels ? "pl-5 pr-3 gap-2.5" : "px-0 justify-center",
          )}
        >
          {showLabels ? (
            <>
              {/* Logo with 4C glow */}
              <div className="relative shrink-0">
                <Logo size="sm" />
                <motion.div
                  className="absolute -inset-1 rounded-xl opacity-30 blur-sm pointer-events-none"
                  style={{ background: "var(--gradient-primary)" }}
                  animate={{ opacity: [0.2, 0.4, 0.2] }}
                  transition={{ duration: 3, repeat: Infinity }}
                />
              </div>
              <BrandName
                className="text-[14px] font-bold text-[var(--sidebar-foreground)] flex-1 min-w-0"
                withAI={true}
              />
              {/* Desktop collapse */}
              <button
                onClick={toggle}
                className="hidden md:flex items-center justify-center h-7 w-7 rounded-lg text-[var(--sidebar-foreground)]/30 hover:bg-white/[0.06] hover:text-[var(--sidebar-foreground)]/80 transition-all duration-150 shrink-0"
                title="Collapse sidebar"
              >
                <PanelLeftClose className="h-4 w-4" />
              </button>
              {/* Mobile close */}
              <button
                onClick={onMobileClose}
                className="md:hidden flex items-center justify-center h-7 w-7 rounded-lg text-[var(--sidebar-foreground)]/30 hover:bg-white/[0.06] hover:text-[var(--sidebar-foreground)]/80 transition-all duration-150 shrink-0"
                title="Close"
              >
                <X className="h-4 w-4" />
              </button>
            </>
          ) : (
            <button
              onClick={toggle}
              className="flex items-center justify-center h-7 w-7 rounded-lg text-[var(--sidebar-foreground)]/30 hover:bg-white/[0.06] hover:text-[var(--sidebar-foreground)]/80 transition-all duration-150"
              title="Expand sidebar"
            >
              <PanelLeftOpen className="h-4 w-4" />
            </button>
          )}
        </div>

        {/* ── Navigation ─────────────────────────────── */}
        <nav className="relative flex-1 overflow-y-auto py-3 space-y-0.5 no-scrollbar px-2">
          {navItems
            .filter((n) => n.show)
            .map((item, idx) => {
              const Icon = item.icon;
              const active = isActive(item.to);
              const accentColor = NAV_COLORS[item.to] || "var(--clarity)";
              
              const isControlHub = item.to === "/control-hub";

              const content = (
                <Link
                  key={item.to}
                  to={item.to}
                  title={!showLabels ? item.label : undefined}
                  onClick={() => {
                    if (mobileOpen) onMobileClose();
                    if (isCollapsed) {
                      toggle();
                    }
                  }}
                  className={cn(
                    "group relative flex items-center rounded-xl py-2.5 text-[13px] font-medium transition-all duration-200",
                    showLabels ? "gap-3 px-3" : "justify-center px-0",
                    active
                      ? "text-[var(--sidebar-foreground)]"
                      : "text-[var(--sidebar-foreground)]/45 hover:text-[var(--sidebar-foreground)]/80",
                  )}
                  style={active ? {
                    background: `linear-gradient(90deg, color-mix(in oklab, ${accentColor} 16%, transparent), color-mix(in oklab, ${accentColor} 6%, transparent))`,
                    boxShadow: `inset 0 0 0 1px color-mix(in oklab, ${accentColor} 12%, transparent)`,
                  } : undefined}
                >
                  {/* Unique: Left accent bar (per-C color coded) */}
                  {active && (
                    <motion.div
                      layoutId="nav-active-bar"
                      className="absolute left-0 top-1/2 -translate-y-1/2 w-[3px] rounded-full"
                      style={{
                        height: "65%",
                        background: accentColor,
                        boxShadow: `0 0 8px ${accentColor}`,
                      }}
                      transition={{ type: "spring", stiffness: 500, damping: 35 }}
                    />
                  )}

                  {/* Icon with per-C color glow when active */}
                  <div
                    className={cn(
                      "relative flex items-center justify-center rounded-lg h-7 w-7 shrink-0 transition-all duration-200",
                      active ? "" : "opacity-60 group-hover:opacity-90",
                    )}
                    style={active ? {
                      background: `color-mix(in oklab, ${accentColor} 14%, transparent)`,
                    } : undefined}
                  >
                    <Icon
                      className="h-[16px] w-[16px] shrink-0 transition-colors"
                      style={{ color: active ? accentColor : "inherit" }}
                    />
                    {/* Active icon glow pulse */}
                    {active && (
                      <motion.div
                        className="absolute inset-0 rounded-lg pointer-events-none"
                        style={{ background: `color-mix(in oklab, ${accentColor} 20%, transparent)` }}
                        animate={{ opacity: [0.5, 1, 0.5] }}
                        transition={{ duration: 2, repeat: Infinity }}
                      />
                    )}
                  </div>

                  {showLabels && <span className="flex-1 truncate">{item.label}</span>}

                  {/* Expand/Collapse Chevron for Control Hub */}
                  {showLabels && isControlHub && (
                    <ChevronDown
                      onClick={(e) => {
                        e.preventDefault();
                        e.stopPropagation();
                        setIsControlHubExpanded((prev) => !prev);
                      }}
                      className={cn(
                        "ml-auto h-4 w-4 text-[var(--sidebar-foreground)]/25 transition-transform duration-200 hover:text-[var(--sidebar-foreground)]/80",
                        isControlHubExpanded && "rotate-180"
                      )}
                    />
                  )}

                  {/* Unique: Active C-badge */}
                  {showLabels && active && !isControlHub && (
                    <motion.div
                      initial={{ scale: 0, opacity: 0 }}
                      animate={{ scale: 1, opacity: 1 }}
                      className="ml-auto shrink-0 h-4 w-4 rounded-full flex items-center justify-center text-[7px] font-black"
                      style={{
                        background: accentColor,
                        color: "#fff",
                        boxShadow: `0 0 6px ${accentColor}`,
                      }}
                    >
                      C
                    </motion.div>
                  )}
                </Link>
              );

              if (isControlHub) {
                return (
                  <div key={item.to} className="space-y-0.5">
                    {content}
                    <AnimatePresence>
                      {showLabels && isControlHubExpanded && (
                        <motion.div
                          initial={{ opacity: 0, height: 0 }}
                          animate={{ opacity: 1, height: "auto" }}
                          exit={{ opacity: 0, height: 0 }}
                          className="overflow-hidden pl-7 pr-1 mt-1 space-y-1"
                        >
                          {visibleControlHubItems.map((sub) => {
                            const SubIcon = sub.icon;
                            const isSubActive = isControlHubActive && (location.search as any).tab === sub.id;
                            return (
                              <Link
                                key={sub.id}
                                to="/control-hub"
                                search={{ tab: sub.id }}
                                className={cn(
                                  "flex items-center gap-2.5 px-3 py-1.5 rounded-lg text-[12.5px] font-medium transition-all duration-200 border border-transparent",
                                  isSubActive
                                    ? "text-white bg-[#00a29a]/20 border-[#00a29a]/30 shadow-[0_0_12px_rgba(0,162,154,0.1)] font-semibold"
                                    : "text-[var(--sidebar-foreground)]/50 hover:text-[var(--sidebar-foreground)]/80 hover:bg-white/[0.04]"
                                )}
                              >
                                <SubIcon className="h-3.5 w-3.5 opacity-60 shrink-0" />
                                <span className="truncate flex-1 text-left">{sub.label}</span>
                              </Link>
                            );
                          })}
                        </motion.div>
                      )}
                    </AnimatePresence>
                  </div>
                );
              }

              return content;
            })}

          {/* New conversation (collapsed) */}
          {isCollapsed && !mobileOpen && isActive("/") && (
            <button
              onClick={() => createThread()}
              title="New Conversation"
              className="flex w-full items-center justify-center rounded-xl py-2.5 text-[var(--sidebar-foreground)]/40 hover:bg-white/[0.05] hover:text-[var(--clarity)] transition-all duration-150"
            >
              <Plus className="h-[18px] w-[18px] shrink-0" />
            </button>
          )}

          {/* Recent Chats */}
          {showLabels && isActive("/") && (
            <>
              {/* Controls at the top of the chat area */}
              <div className="space-y-1 mt-1 mb-2">
                <motion.button
                  whileHover={{ x: 3, scale: 1.01 }}
                  whileTap={{ scale: 0.98 }}
                  onClick={() => {
                    createThread();
                    if (mobileOpen) onMobileClose();
                  }}
                  className="flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-[13px] font-medium transition-all duration-150"
                  style={{ color: "var(--clarity)" }}
                >
                  <div
                    className="flex h-5 w-5 items-center justify-center rounded-md"
                    style={{ background: "color-mix(in oklab, var(--clarity) 15%, transparent)" }}
                  >
                    <Plus className="h-3.5 w-3.5" />
                  </div>
                  <span>New Conversation</span>
                </motion.button>

                {/* Search Chat Input */}
                <div className="px-3 py-1 relative flex items-center">
                  <Search className="absolute left-[22px] h-3.5 w-3.5 text-[var(--sidebar-foreground)]/35 pointer-events-none" />
                  <input
                    type="text"
                    placeholder="Search chats..."
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                    className="w-full bg-white/[0.02] border border-white/[0.05] hover:border-white/[0.1] hover:bg-white/[0.03] focus:border-[var(--clarity)]/30 focus:bg-white/[0.05] text-[13px] text-[var(--sidebar-foreground)] placeholder-[var(--sidebar-foreground)]/35 rounded-xl pl-10 pr-8 py-2 focus:outline-none transition-all duration-200"
                  />
                  {searchQuery && (
                    <button
                      onClick={() => setSearchQuery("")}
                      className="absolute right-5 p-0.5 rounded-md text-[var(--sidebar-foreground)]/30 hover:text-[var(--sidebar-foreground)]/70 hover:bg-white/5 transition-all"
                    >
                      <X className="h-3.5 w-3.5" />
                    </button>
                  )}
                </div>
              </div>

              {/* Recent Chats Divider Header */}
              <div className="px-3 pt-3 pb-2 flex items-center gap-2">
                <div className="h-[1px] flex-1 opacity-10" style={{ background: "var(--gradient-primary)" }} />
                <span className="text-[9px] font-bold uppercase tracking-[0.15em] text-[var(--sidebar-foreground)]/25">
                  Recent
                </span>
                <div className="h-[1px] flex-1 opacity-10" style={{ background: "var(--gradient-primary)" }} />
              </div>

              <div className="space-y-0.5">

                <AnimatePresence mode="popLayout">
                  {(() => {
                    const filteredThreads = Object.values(threads)
                      .filter((t) => {
                        if (t.turns.length === 0) return false;
                        if (!searchQuery) return true;
                        const query = searchQuery.toLowerCase();
                        return t.turns.some((turn) =>
                          turn.text.toLowerCase().includes(query)
                        );
                      })
                      .sort((a, b) => b.updatedAt - a.updatedAt);

                    if (filteredThreads.length === 0) {
                      return (
                        <div className="text-center py-6 px-3 text-[11px] text-[var(--sidebar-foreground)]/30 font-medium">
                          {searchQuery ? "No matching chats found" : "No recent chats"}
                        </div>
                      );
                    }

                    return filteredThreads.map((thread) => {
                      const active = activeId === thread.id;
                      const title = thread.turns[0]?.text || "New Chat";
                      return (
                        <motion.div
                          key={thread.id}
                          layout
                          initial={{ opacity: 0, x: -12 }}
                          animate={{ opacity: 1, x: 0 }}
                          exit={{ opacity: 0, x: -12, height: 0 }}
                          transition={{ duration: 0.2 }}
                          role="button"
                          tabIndex={0}
                          onClick={() => {
                            setActiveId(thread.id);
                            if (mobileOpen) onMobileClose();
                          }}
                          onKeyDown={(e) => {
                            if (e.key === "Enter") {
                              setActiveId(thread.id);
                              if (mobileOpen) onMobileClose();
                            }
                          }}
                          className={cn(
                            "group flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-[13px] font-medium transition-all duration-150 cursor-pointer",
                            active
                              ? "text-[var(--sidebar-foreground)]"
                              : "text-[var(--sidebar-foreground)]/35 hover:bg-white/[0.03] hover:text-[var(--sidebar-foreground)]/65",
                          )}
                          style={active ? {
                            background: "color-mix(in oklab, var(--clarity) 10%, transparent)",
                            border: "1px solid color-mix(in oklab, var(--clarity) 12%, transparent)",
                          } : undefined}
                        >
                          <MessageSquare
                            className="h-[15px] w-[15px] shrink-0 transition-colors"
                            style={{ color: active ? "var(--clarity)" : "inherit", opacity: active ? 1 : 0.4 }}
                          />
                          <span className="truncate text-left flex-1">{title}</span>
                          {active && (
                            <motion.div
                              className="h-1.5 w-1.5 rounded-full shrink-0 group-hover:hidden"
                              style={{ background: "var(--clarity)", boxShadow: "0 0 4px var(--clarity)" }}
                              animate={{ opacity: [1, 0.4, 1] }}
                              transition={{ duration: 1.5, repeat: Infinity }}
                            />
                          )}
                          <button
                            onClick={(e) => {
                              e.stopPropagation();
                              handleDelete(thread.id);
                            }}
                            className={cn(
                              "shrink-0 p-1 hover:bg-white/10 rounded-lg transition-all hover:text-red-400",
                              active
                                ? "hidden group-hover:block text-[var(--sidebar-foreground)]/40"
                                : "opacity-0 group-hover:opacity-100 text-[var(--sidebar-foreground)]/25",
                            )}
                            title="Delete conversation"
                          >
                            <Trash2 className="h-3.5 w-3.5" />
                          </button>
                        </motion.div>
                      );
                    });
                  })()}
                </AnimatePresence>
              </div>
            </>
          )}
        </nav>

        {/* ── Buddy Companion Ledge ───────────────────── */}
        {showLabels && buddyEnabled && (
          <div className="relative shrink-0 border-t border-white/[0.04] bg-white/[0.01] px-4 py-2.5 flex flex-col items-center justify-end overflow-visible select-none h-[110px]">
            {/* Ledge glass/neon horizontal line */}
            <div 
              className="absolute bottom-2.5 left-4 right-4 h-[2px] rounded-full opacity-65"
              style={{
                background: "linear-gradient(90deg, transparent, rgba(255, 255, 255, 0.2), transparent)",
                boxShadow: "0 1px 4px rgba(0, 0, 0, 0.3)"
              }}
            />
            <SittingBuddy />
          </div>
        )}

        {/* ── User Section ────────────────────────────── */}
        <div
          className={cn(
            "relative shrink-0",
            "border-t border-white/[0.06]",
            showLabels ? "p-2" : "px-0 py-2",
          )}
          ref={dropdownRef}
        >

          {/* Unique: 4C role indicator strip above user */}
          {showLabels && (
            <div className="flex items-center gap-1 px-2.5 pb-2">
              {(["Clarity", "Connectivity", "Collaboration", "Capacity"] as const).map((c, i) => {
                const colors = ["var(--clarity)", "var(--connectivity)", "var(--collaboration)", "var(--capacity)"];
                return (
                  <motion.div
                    key={c}
                    className="flex-1 h-[2px] rounded-full"
                    style={{ background: colors[i] }}
                    animate={{ opacity: [0.4, 1, 0.4] }}
                    transition={{ duration: 2, repeat: Infinity, delay: i * 0.5 }}
                    title={c}
                  />
                );
              })}
            </div>
          )}

          <button
            onClick={() => setRoleDropdownOpen(!isRoleDropdownOpen)}
            className={cn(
              "flex w-full items-center rounded-xl transition-all duration-150 hover:bg-white/[0.05]",
              showLabels ? "gap-3 p-2.5" : "justify-center py-2.5",
            )}
          >
            {avatarEl}
            {showLabels && (
              <>
                <div className="flex flex-1 flex-col items-start min-w-0">
                  <span className="text-[13px] font-semibold text-[var(--sidebar-foreground)] truncate w-full text-left">
                    {user.name}
                  </span>
                  <span className="text-[10px] text-[var(--sidebar-foreground)]/35 truncate w-full text-left font-medium">
                    {user.role}
                  </span>
                </div>
                <ChevronDown
                  className={cn(
                    "h-4 w-4 text-[var(--sidebar-foreground)]/25 transition-transform duration-200 shrink-0",
                    isRoleDropdownOpen && "rotate-180",
                  )}
                />
              </>
            )}
          </button>

          <AnimatePresence>
            {isRoleDropdownOpen && (
              <motion.div
                initial={{ opacity: 0, y: 10, scale: 0.95 }}
                animate={{ opacity: 1, y: 0, scale: 1 }}
                exit={{ opacity: 0, y: 10, scale: 0.95 }}
                transition={{ duration: 0.15, ease: [0.16, 1, 0.3, 1] }}
                className="absolute bottom-24 left-2 w-54 z-[60] rounded-2xl border border-white/[0.07] backdrop-blur-xl p-1.5 shadow-2xl"
                style={{ background: "rgba(4, 18, 40, 0.96)", minWidth: "210px" }}
              >
                <div className="px-3 py-2 border-b border-white/[0.06] mb-1 flex items-center gap-2">
                  <Sparkles className="h-3 w-3" style={{ color: "var(--clarity)" }} />
                  <span className="text-[10px] font-bold uppercase tracking-[0.12em] text-white/30">
                    Switch Role (Demo)
                  </span>
                </div>
                {roles.map((r) => {
                  const meta = ROLE_META[r];
                  const RIcon = meta.icon;
                  const isSelected = user.role === r;
                  return (
                    <motion.button
                      key={r}
                      whileHover={{ x: 3 }}
                      whileTap={{ scale: 0.97 }}
                      onClick={() => {
                        setRole(r);
                        setRoleDropdownOpen(false);
                      }}
                      className={cn(
                        "flex w-full items-center gap-3 rounded-xl px-3 py-2 text-[12px] transition-all duration-150",
                        isSelected
                          ? "bg-white/[0.07] text-white"
                          : "text-white/55 hover:bg-white/[0.04] hover:text-white/80",
                      )}
                    >
                      <RIcon className={cn("h-3.5 w-3.5", meta.color)} />
                      <div className="flex flex-1 flex-col items-start">
                        <span className="font-semibold">{r}</span>
                      </div>
                      {isSelected && (
                        <Check className="h-3.5 w-3.5 shrink-0" style={{ color: "var(--clarity)" }} />
                      )}
                    </motion.button>
                  );
                })}
                <div className="border-t border-white/[0.06] mt-1 pt-1">
                  <motion.button
                    whileHover={{ x: 3 }}
                    whileTap={{ scale: 0.97 }}
                    onClick={() => {
                      logout();
                      setRoleDropdownOpen(false);
                    }}
                    className="flex w-full items-center gap-3 rounded-xl px-3 py-2 text-[12px] text-rose-400/75 hover:bg-rose-500/10 hover:text-rose-400 transition-all duration-150"
                  >
                    <LogOut className="h-3.5 w-3.5" />
                    <span className="font-semibold">Sign Out</span>
                  </motion.button>
                </div>
              </motion.div>
            )}
          </AnimatePresence>
        </div>
      </motion.aside>

      {/* Delete Confirmation Dialog */}
      <AlertDialog open={!!deleteConfirmId} onOpenChange={(open) => { if (!open) setDeleteConfirmId(null); }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete conversation</AlertDialogTitle>
            <AlertDialogDescription>
              This will permanently delete this conversation. This action cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={confirmDelete}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
