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
  Zap,
} from "lucide-react";
import { Logo } from "./Logo";
import { BrandName } from "./BrandName";
import { useAuth, Role } from "@/lib/auth-store";
import { cn } from "@/lib/utils";
import { useState, useRef, useEffect } from "react";
import { useChatStore } from "@/lib/chat-store";

const ROLE_META: Record<Role, { icon: typeof Shield; color: string; label: string }> = {
  Employee: { icon: Briefcase, color: "text-blue-400", label: "Employee" },
  HR: { icon: Users, color: "text-emerald-400", label: "Human Resources" },
  IT: { icon: Wrench, color: "text-amber-400", label: "IT Support" },
  PMO: { icon: ClipboardList, color: "text-cyan-400", label: "Project Management" },
  Admin: { icon: Shield, color: "text-rose-400", label: "Administrator" },
  "Functional Manager": { icon: UserCog, color: "text-violet-400", label: "Functional Manager" },
};

export function Sidebar() {
  const { threads, activeId, setActiveId, createThread } = useChatStore();
  const { user, login, logout, setRole } = useAuth();
  const location = useLocation();
  const [isRoleDropdownOpen, setRoleDropdownOpen] = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);

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

  const roles: Role[] = ["Employee", "HR", "IT", "PMO", "Admin", "Functional Manager"];
  const currentRoleMeta = ROLE_META[user.role];
  const RoleIcon = currentRoleMeta.icon;

  const navItems = [
    { to: "/", icon: MessageSquare, label: "Chat", show: true },
    {
      to: "/config",
      icon: Database,
      label: "Prompt Config",
      show: ["Admin", "HR", "IT", "PMO"].includes(user.role),
    },
    {
      to: "/team",
      icon: Users,
      label: "Team Management",
      show: user.role === "Functional Manager",
    },
    { to: "/admin", icon: LayoutDashboard, label: "Analytics", show: user.role === "Admin" },
    { to: "/settings", icon: Settings, label: "Settings", show: true },
  ];

  return (
    <aside className="relative flex h-screen w-[272px] flex-col border-r border-[var(--border)] bg-[var(--sidebar-bg)]">
      {/* Brand */}
      <div className="flex h-16 items-center gap-3 px-6 border-b border-white/[0.06]">
        <Logo size="md" />
        <BrandName className="text-[15px] text-[var(--sidebar-foreground)]" withAI={true} />
      </div>

      {/* Role Badge */}
      <div className="mx-4 mt-4 mb-2">
        <div className="flex items-center gap-2.5 rounded-lg bg-white/[0.04] px-3 py-2">
          <RoleIcon className={cn("h-4 w-4", currentRoleMeta.color)} />
          <div className="flex flex-col">
            <span className="text-[11px] font-semibold uppercase tracking-widest text-[var(--sidebar-foreground)]/40">
              Role
            </span>
            <span className="text-xs font-medium text-[var(--sidebar-foreground)]/80">
              {currentRoleMeta.label}
            </span>
          </div>
        </div>
      </div>

      {/* Navigation */}
      <nav className="flex-1 overflow-y-auto px-3 py-2 space-y-0.5 no-scrollbar">
        <div className="px-3 py-2">
          <span className="text-[10px] font-bold uppercase tracking-[0.12em] text-[var(--sidebar-foreground)]/30">
            Navigation
          </span>
        </div>
        {navItems
          .filter((n) => n.show)
          .map((item) => {
            const Icon = item.icon;
            const active = isActive(item.to);
            return (
              <Link
                key={item.to}
                to={item.to}
                className={cn(
                  "flex items-center gap-3 rounded-lg px-3 py-2.5 text-[13px] font-medium transition-all duration-150",
                  active
                    ? "bg-white/[0.08] text-[var(--sidebar-foreground)] shadow-[inset_0_1px_0_0_rgba(255,255,255,0.06)]"
                    : "text-[var(--sidebar-foreground)]/50 hover:bg-white/[0.04] hover:text-[var(--sidebar-foreground)]/80",
                )}
              >
                <Icon className={cn("h-[18px] w-[18px]", active && "text-primary")} />
                {item.label}
                {active && <div className="ml-auto h-1.5 w-1.5 rounded-full bg-primary" />}
              </Link>
            );
          })}

        {/* Recent Chats Section */}
        {isActive("/") && (
          <>
            <div className="px-3 py-4">
              <span className="text-[10px] font-bold uppercase tracking-[0.12em] text-[var(--sidebar-foreground)]/30">
                Recent Chats
              </span>
            </div>
            <div className="space-y-0.5">
              {Object.values(threads)
                .filter((t) => t.turns.length > 0)
                .sort((a, b) => b.updatedAt - a.updatedAt)
                .map((thread) => {
                  const active = activeId === thread.id;
                  const title = thread.turns[0]?.text || "New Chat";
                  return (
                    <button
                      key={thread.id}
                      onClick={() => setActiveId(thread.id)}
                      className={cn(
                        "group flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-[13px] font-medium transition-all duration-150",
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
                      <span className="truncate text-left">{title}</span>
                      {active && <div className="ml-auto h-1 w-1 rounded-full bg-primary" />}
                    </button>
                  );
                })}

              <button
                onClick={() => createThread()}
                className="flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-[13px] font-medium text-primary hover:bg-primary/5 transition-colors mt-2"
              >
                <Zap className="h-4 w-4" />
                <span>New Conversation</span>
              </button>
            </div>
          </>
        )}
      </nav>

      {/* User Switcher */}
      <div className="border-t border-white/[0.06] p-3" ref={dropdownRef}>
        <button
          onClick={() => setRoleDropdownOpen(!isRoleDropdownOpen)}
          className="flex w-full items-center gap-3 rounded-lg p-2.5 transition-colors hover:bg-white/[0.04]"
        >
          {user.avatarUrl ? (
            <img
              src={user.avatarUrl}
              alt={user.name}
              className="h-9 w-9 rounded-full object-cover shadow-lg shadow-black/20"
            />
          ) : (
            <div className="flex h-9 w-9 items-center justify-center rounded-full bg-primary/20 text-[13px] font-bold text-primary shadow-lg shadow-black/10">
              {user.name
                .split(" ")
                .map((n) => n[0])
                .join("")}
            </div>
          )}
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
        </button>

        {isRoleDropdownOpen && (
          <div className="absolute bottom-20 left-3 right-3 z-50 rounded-xl border border-white/[0.08] bg-[#1a1f2e] p-1.5 shadow-2xl animate-in fade-in slide-in-from-bottom-2 duration-150">
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
  );
}
