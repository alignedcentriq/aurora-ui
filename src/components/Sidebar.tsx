import { Link, useLocation } from "@tanstack/react-router";
import {
  MessageSquare,
  Settings,
  LayoutDashboard,
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
} from "lucide-react";
import { Logo } from "./Logo";
import { BrandName } from "./BrandName";
import { useAuth, Role } from "@/lib/auth-store";
import { cn } from "@/lib/utils";
import { useState, useRef, useEffect } from "react";
import { useChatStore } from "@/lib/chat-store";
import { AnnouncementBanner } from "./assistant/AnnouncementBanner";

const ROLE_META: Record<Role, { icon: typeof Shield; color: string; label: string }> = {
  Employee: { icon: Briefcase, color: "text-blue-400", label: "Employee" },
  HR: { icon: Users, color: "text-emerald-400", label: "Human Resources" },
  IT: { icon: Wrench, color: "text-amber-400", label: "IT Support" },
  PMO: { icon: ClipboardList, color: "text-cyan-400", label: "Project Management" },
  Admin: { icon: Shield, color: "text-rose-400", label: "Administrator" },
  "Functional Manager": { icon: UserCog, color: "text-violet-400", label: "Functional Manager" },
};

interface SidebarProps {
  mobileOpen: boolean;
  onMobileClose: () => void;
}

export function Sidebar({ mobileOpen, onMobileClose }: SidebarProps) {
  const { threads, activeId, setActiveId, createThread, deleteThread } = useChatStore();
  const { user, logout, setRole } = useAuth();
  const location = useLocation();
  const [isRoleDropdownOpen, setRoleDropdownOpen] = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);
  const [avatarError, setAvatarError] = useState(false);

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

  // Reset avatar error when the URL changes (e.g. after re-login)
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

  const handleDelete = async (id: string) => {
    if (!window.confirm("Delete this conversation?")) return;
    deleteThread(id);
    try {
      await fetch(`/api/chat/${id}`, { method: "DELETE" });
    } catch (err) {
      console.error("Failed to delete chat from backend:", err);
    }
  };

  const roles: Role[] = ["Employee", "HR", "IT", "PMO", "Admin", "Functional Manager"];

  const navItems = [
    { to: "/", icon: MessageSquare, label: "Chat", show: true },
    {
      to: "/people",
      icon: Users,
      label: "People",
      show: ["HR", "PMO", "Admin", "Functional Manager"].includes(user.role),
    },
    {
      to: "/config",
      icon: Database,
      label: "Prompt Config",
      show: ["Admin", "HR", "IT", "PMO"].includes(user.role),
    },
    { to: "/admin", icon: LayoutDashboard, label: "Analytics", show: user.role === "Admin" },
    { to: "/hr-portal", icon: CalendarDays, label: "HR Portal", show: user.role === "HR" },
    { to: "/admin-portal", icon: Car, label: "Admin Portal", show: user.role === "Admin" },
    { to: "/it-portal", icon: Ticket, label: "IT Portal", show: user.role === "IT" },
    { to: "/settings", icon: Settings, label: "Settings", show: true },
  ];

  // Show labels when expanded on desktop/tablet, or when the mobile drawer is open
  const showLabels = !isCollapsed || mobileOpen;

  const avatarEl = user.avatarUrl && !avatarError ? (
    <img
      src={user.avatarUrl}
      alt={user.name}
      onError={() => setAvatarError(true)}
      className="h-9 w-9 rounded-full object-cover shadow-lg shadow-black/20 shrink-0"
    />
  ) : (
    <div className="flex h-9 w-9 items-center justify-center rounded-full bg-primary/20 text-[13px] font-bold text-primary shadow-lg shadow-black/10 shrink-0">
      {user.name.split(" ").map((n) => n[0]).join("")}
    </div>
  );

  return (
    <>
      {/* Mobile backdrop */}
      {mobileOpen && (
        <div
          className="fixed inset-0 bg-black/60 z-40 md:hidden"
          onClick={onMobileClose}
        />
      )}

      <aside
        className={cn(
          "flex flex-col bg-[var(--sidebar-bg)] border-r border-[var(--border)] h-screen",
          // Mobile: fixed overlay drawer (always in DOM, controlled by transform)
          "fixed md:relative inset-y-0 left-0 z-50",
          // Mobile drawer width
          "w-[280px]",
          // Mobile slide in/out via transform; desktop collapses via width
          "transition-transform md:transition-[width] duration-200 ease-in-out",
          mobileOpen ? "translate-x-0" : "-translate-x-full md:translate-x-0",
          // Desktop/tablet collapsible width
          isCollapsed ? "md:w-[60px]" : "md:w-[240px]",
        )}
      >
        {/* Header */}
        <div
          className={cn(
            "flex h-16 items-center border-b border-white/[0.06] shrink-0",
            showLabels ? "px-4 gap-2" : "px-0 justify-center",
          )}
        >
          {showLabels ? (
            <>
              <Logo size="sm" />
              <BrandName
                className="text-[14px] text-[var(--sidebar-foreground)] flex-1 min-w-0"
                withAI={true}
              />
              <AnnouncementBanner />
              {/* Desktop collapse button */}
              <button
                onClick={toggle}
                className="hidden md:flex items-center justify-center h-7 w-7 rounded-md text-[var(--sidebar-foreground)]/40 hover:bg-white/[0.06] hover:text-[var(--sidebar-foreground)] transition-colors shrink-0"
                title="Collapse sidebar"
              >
                <PanelLeftClose className="h-4 w-4" />
              </button>
              {/* Mobile close button */}
              <button
                onClick={onMobileClose}
                className="md:hidden flex items-center justify-center h-7 w-7 rounded-md text-[var(--sidebar-foreground)]/40 hover:bg-white/[0.06] hover:text-[var(--sidebar-foreground)] transition-colors shrink-0"
                title="Close"
              >
                <X className="h-4 w-4" />
              </button>
            </>
          ) : (
            <button
              onClick={toggle}
              className="flex items-center justify-center h-7 w-7 rounded-md text-[var(--sidebar-foreground)]/40 hover:bg-white/[0.06] hover:text-[var(--sidebar-foreground)] transition-colors"
              title="Expand sidebar"
            >
              <PanelLeftOpen className="h-4 w-4" />
            </button>
          )}
        </div>

        {/* Navigation */}
        <nav className="flex-1 overflow-y-auto py-2 space-y-0.5 no-scrollbar px-2">
          {navItems
            .filter((n) => n.show)
            .map((item) => {
              const Icon = item.icon;
              const active = isActive(item.to);
              return (
                <Link
                  key={item.to}
                  to={item.to}
                  title={!showLabels ? item.label : undefined}
                  onClick={() => {
                    if (mobileOpen) onMobileClose();
                    // When collapsed on desktop and clicking Chat, expand so history is visible
                    if (isCollapsed && item.to === "/") toggle();
                  }}
                  className={cn(
                    "flex items-center rounded-lg py-2.5 text-[13px] font-medium transition-all duration-150",
                    showLabels ? "gap-3 px-3" : "justify-center px-0",
                    active
                      ? "bg-white/[0.08] text-[var(--sidebar-foreground)] shadow-[inset_0_1px_0_0_rgba(255,255,255,0.06)]"
                      : "text-[var(--sidebar-foreground)]/50 hover:bg-white/[0.04] hover:text-[var(--sidebar-foreground)]/80",
                  )}
                >
                  <Icon className={cn("h-[18px] w-[18px] shrink-0", active && "text-primary")} />
                  {showLabels && <span className="flex-1 truncate">{item.label}</span>}
                  {showLabels && active && (
                    <div className="ml-auto h-1.5 w-1.5 rounded-full bg-primary shrink-0" />
                  )}
                </Link>
              );
            })}

          {/* New conversation shortcut — collapsed desktop only */}
          {isCollapsed && !mobileOpen && isActive("/") && (
            <button
              onClick={() => createThread()}
              title="New Conversation"
              className="flex w-full items-center justify-center rounded-lg py-2.5 text-[var(--sidebar-foreground)]/50 hover:bg-white/[0.04] hover:text-primary transition-all duration-150"
            >
              <Plus className="h-[18px] w-[18px] shrink-0" />
            </button>
          )}

          {/* Recent Chats — only when labels are visible */}
          {showLabels && isActive("/") && (
            <>
              <div className="px-3 pt-4 pb-2">
                <span className="text-[10px] font-bold uppercase tracking-[0.12em] text-[var(--sidebar-foreground)]/30">
                  Recent Chats
                </span>
              </div>
              <div className="space-y-0.5">
                <button
                  onClick={() => {
                    createThread();
                    if (mobileOpen) onMobileClose();
                  }}
                  className="flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-[13px] font-medium text-primary hover:bg-primary/5 transition-colors"
                >
                  <Plus className="h-4 w-4 shrink-0" />
                  <span>New Conversation</span>
                </button>

                {Object.values(threads)
                  .filter((t) => t.turns.length > 0)
                  .sort((a, b) => b.updatedAt - a.updatedAt)
                  .map((thread) => {
                    const active = activeId === thread.id;
                    const title = thread.turns[0]?.text || "New Chat";
                    return (
                      <div
                        key={thread.id}
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
                          "group flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-[13px] font-medium transition-all duration-150 cursor-pointer",
                          active
                            ? "bg-white/[0.06] text-[var(--sidebar-foreground)]"
                            : "text-[var(--sidebar-foreground)]/40 hover:bg-white/[0.03] hover:text-[var(--sidebar-foreground)]/70",
                        )}
                      >
                        <MessageSquare
                          className={cn(
                            "h-[16px] w-[16px] shrink-0",
                            active ? "text-primary" : "opacity-40",
                          )}
                        />
                        <span className="truncate text-left flex-1">{title}</span>
                        {active && (
                          <div className="h-1.5 w-1.5 rounded-full bg-primary shrink-0 group-hover:hidden" />
                        )}
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            handleDelete(thread.id);
                          }}
                          className={cn(
                            "shrink-0 p-1 hover:bg-white/10 rounded transition-all hover:text-red-400",
                            active
                              ? "hidden group-hover:block text-[var(--sidebar-foreground)]/50"
                              : "opacity-0 group-hover:opacity-100 text-[var(--sidebar-foreground)]/30",
                          )}
                          title="Delete conversation"
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                        </button>
                      </div>
                    );
                  })}
              </div>
            </>
          )}
        </nav>

        {/* User section */}
        <div
          className={cn(
            "border-t border-white/[0.06] shrink-0",
            showLabels ? "p-2" : "px-0 py-2",
          )}
          ref={dropdownRef}
        >
          <button
            onClick={() => setRoleDropdownOpen(!isRoleDropdownOpen)}
            className={cn(
              "flex w-full items-center rounded-lg transition-colors hover:bg-white/[0.04]",
              showLabels ? "gap-3 p-2.5" : "justify-center py-2.5",
            )}
          >
            {avatarEl}
            {showLabels && (
              <>
                <div className="flex flex-1 flex-col items-start min-w-0">
                  <span className="text-[13px] font-medium text-[var(--sidebar-foreground)] truncate w-full text-left">
                    {user.name}
                  </span>
                  <span className="text-[11px] text-[var(--sidebar-foreground)]/40 truncate w-full text-left">
                    {user.role}
                  </span>
                </div>
                <ChevronDown
                  className={cn(
                    "h-4 w-4 text-[var(--sidebar-foreground)]/30 transition-transform duration-200 shrink-0",
                    isRoleDropdownOpen && "rotate-180",
                  )}
                />
              </>
            )}
          </button>

          {isRoleDropdownOpen && (
            <div className="absolute bottom-20 left-2 w-52 z-[60] rounded-xl border border-white/[0.08] bg-[#1a1f2e] p-1.5 shadow-2xl animate-in fade-in slide-in-from-bottom-2 duration-150">
              <div className="px-3 py-2 border-b border-white/[0.06] mb-1">
                <span className="text-[10px] font-bold uppercase tracking-[0.12em] text-white/30">
                  Switch Role (Demo)
                </span>
              </div>
              {roles.map((r) => {
                const meta = ROLE_META[r];
                const RIcon = meta.icon;
                const isSelected = user.role === r;
                return (
                  <button
                    key={r}
                    onClick={() => {
                      setRole(r);
                      setRoleDropdownOpen(false);
                    }}
                    className={cn(
                      "flex w-full items-center gap-3 rounded-lg px-3 py-2 text-[13px] transition-colors",
                      isSelected
                        ? "bg-white/[0.08] text-white"
                        : "text-white/60 hover:bg-white/[0.04] hover:text-white/80",
                    )}
                  >
                    <RIcon className={cn("h-4 w-4", meta.color)} />
                    <span className="flex-1 text-left font-medium">{r}</span>
                    {isSelected && <Check className="h-4 w-4 text-primary" />}
                  </button>
                );
              })}
              <div className="border-t border-white/[0.06] mt-1 pt-1">
                <button
                  onClick={() => {
                    logout();
                    setRoleDropdownOpen(false);
                  }}
                  className="flex w-full items-center gap-3 rounded-lg px-3 py-2 text-[13px] text-rose-400/80 hover:bg-rose-500/10 hover:text-rose-400 transition-colors"
                >
                  <LogOut className="h-4 w-4" />
                  <span className="font-medium">Sign Out</span>
                </button>
              </div>
            </div>
          )}
        </div>
      </aside>
    </>
  );
}
