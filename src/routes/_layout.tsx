import { createFileRoute, Outlet, useNavigate, Link, useLocation } from "@tanstack/react-router";
import { Logo } from "@/components/Logo";
import { CopilotSidebar } from "@/components/assistant/CopilotSidebar";
import { RoleSwitcher } from "@/components/RoleSwitcher";
import { BrandName } from "@/components/BrandName";
import {
  MessageSquare,
  Settings,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  Menu,
  Users,
  LogOut,
  Shield,
  Plus,
  Trash2,
  X,
  Sparkles,
  FileText,
  Globe,
  Search,
  ClipboardCheck,
  Sun,
  Moon,
  PlayCircle,
  Rocket,
  UsersRound,
  RotateCcw,
  BrainCircuit,
} from "lucide-react";
import { useState, useEffect, useRef, useCallback } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { CommandPalette } from "@/components/CommandPalette";
import { ProactiveNudgeFeed } from "@/components/assistant/ProactiveNudgeFeed";
import { ActivityBell } from "@/components/assistant/ActivityBell";
import { EmailAutomationDrawer } from "@/components/EmailAutomationDrawer";
import { useChatStore } from "@/lib/chat-store";
import {
  useSettings,
  detectCountryFromTimezone,
  clockFromTimezone,
  listAllTimezones,
  POPULAR_CLOCK_TZS,
} from "@/lib/settings-store";
import { useIntroStore } from "@/lib/intro-store";
import { useMasterModeStore } from "@/lib/master-mode-store";
import { setChatSyncUser, hydrateChatFromServer } from "@/lib/chat-sync";
import { useAuth } from "@/lib/auth-store";
import { SittingBuddy } from "@/components/assistant/GreetingBot";
import { cn } from "@/lib/utils";
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

export const Route = createFileRoute("/_layout")({
  component: LayoutComponent,
});

let isInitialAppLoad = true;


const NAV_COLORS: Record<string, string> = {
  "/": "var(--clarity)",
  "/onboarding": "var(--collaboration)",
  "/books": "var(--connectivity)",
  "/documents": "var(--connectivity)",
  "/directory": "var(--connectivity)",
  "/my-requests": "var(--collaboration)",
  "/team": "var(--collaboration)",
  "/control-hub": "var(--clarity)",
  "/settings": "var(--capacity)",
};

// --- Timezone Clock Card Component with Parallax Hover ---
function TimezoneOrbitClockCard({
  country,
  onRemove,
}: {
  country: any;
  onRemove?: () => void;
}) {
  const [tilt, setTilt] = useState({ rotateX: 0, rotateY: 0, scale: 1 });
  const [timeData, setTimeData] = useState({
    timeStr: "",
    isOpen: false,
    hrDeg: 0,
    minDeg: 0,
    secDeg: 0,
    h: 12,
    m: 0,
  });

  useEffect(() => {
    const updateTime = () => {
      const now = new Date();

      let localTimeStr = "";
      let isOpen = false;
      let hrDeg = 0;
      let minDeg = 0;
      let secDeg = 0;
      let h = 12;
      let m = 0;

      try {
        localTimeStr = now.toLocaleTimeString("en-US", {
          timeZone: country.timezone,
          hour: "numeric",
          minute: "2-digit",
          hour12: true,
        });

        const formatter = new Intl.DateTimeFormat("en-US", {
          timeZone: country.timezone,
          hour: "numeric",
          minute: "numeric",
          second: "numeric",
          hour12: false,
          weekday: "short",
        });

        const parts = formatter.formatToParts(now);
        h = parseInt(parts.find((p) => p.type === "hour")?.value || "0", 10);
        m = parseInt(parts.find((p) => p.type === "minute")?.value || "0", 10);
        const s = parseInt(parts.find((p) => p.type === "second")?.value || "0", 10);
        const weekday = parts.find((p) => p.type === "weekday")?.value || "Mon";

        secDeg = s * 6;
        minDeg = m * 6 + s * 0.1;
        hrDeg = (h % 12) * 30 + m * 0.5;

        const isWeekend = weekday === "Sat" || weekday === "Sun";
        isOpen = !isWeekend && h >= 9 && h < 18;
      } catch (err) {
        // fallback
      }

      setTimeData({ timeStr: localTimeStr, isOpen, hrDeg, minDeg, secDeg, h, m });
    };

    updateTime();
    const interval = setInterval(updateTime, 1000);
    return () => clearInterval(interval);
  }, [country]);

  const handleMouseMove = (e: React.MouseEvent<HTMLDivElement>) => {
    const card = e.currentTarget;
    const rect = card.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;
    const xc = rect.width / 2;
    const yc = rect.height / 2;
    const rotateX = -((y - yc) / yc) * 8;
    const rotateY = ((x - xc) / xc) * 8;
    setTilt({ rotateX, rotateY, scale: 1.03 });
  };

  const handleMouseLeave = () => {
    setTilt({ rotateX: 0, rotateY: 0, scale: 1 });
  };

  const { h, timeStr, isOpen, hrDeg, minDeg, secDeg } = timeData;
  let bgGradient = "from-indigo-950/30 via-slate-900/25 to-black/20";
  let borderGlow = "hover:border-indigo-500/20 hover:shadow-[0_0_15px_rgba(99,102,241,0.15)]";
  let timeLabel = "Night";

  if (h >= 6 && h < 11) {
    bgGradient = "from-amber-500/20 via-sky-400/10 to-transparent";
    borderGlow = "hover:border-amber-500/25 hover:shadow-[0_0_15px_rgba(245,158,11,0.15)]";
    timeLabel = "Morning";
  } else if (h >= 11 && h < 16) {
    bgGradient = "from-sky-400/20 via-blue-500/10 to-transparent";
    borderGlow = "hover:border-sky-400/25 hover:shadow-[0_0_15px_rgba(56,189,248,0.15)]";
    timeLabel = "Afternoon";
  } else if (h >= 16 && h < 19) {
    bgGradient = "from-orange-500/20 via-pink-600/10 to-indigo-950/10";
    borderGlow = "hover:border-orange-500/25 hover:shadow-[0_0_15px_rgba(249,115,22,0.15)]";
    timeLabel = "Evening";
  }

  return (
    <motion.div
      onMouseMove={handleMouseMove}
      onMouseLeave={handleMouseLeave}
      style={{
        transform: `perspective(1000px) rotateX(${tilt.rotateX}deg) rotateY(${tilt.rotateY}deg) scale3d(${tilt.scale}, ${tilt.scale}, 1)`,
        transition: "transform 0.1s ease-out",
      }}
      className={cn(
        "relative rounded-3xl border border-border/50 p-5 flex flex-col items-center gap-4 text-center backdrop-blur-md transition-shadow",
        "bg-gradient-to-br",
        bgGradient,
        borderGlow,
        "group/clock",
      )}
    >
      {onRemove && (
        <button
          onClick={onRemove}
          title={`Remove ${country.name}`}
          className="absolute top-3 left-3 z-20 flex h-6 w-6 items-center justify-center rounded-full bg-background/70 text-muted-foreground opacity-0 group-hover/clock:opacity-100 hover:bg-destructive/15 hover:text-destructive transition-all cursor-pointer"
        >
          <X className="h-3.5 w-3.5" />
        </button>
      )}
      <div className="absolute top-4 right-4 flex items-center gap-1.5">
        <span
          className={cn(
            "h-2 w-2 rounded-full",
            isOpen ? "bg-emerald-500 shadow-[0_0_8px_#10b981]" : "bg-zinc-600",
          )}
        />
        <span className="text-[9px] font-bold text-foreground/50 uppercase tracking-wider">
          {isOpen ? "Open" : "Closed"}
        </span>
      </div>

      <div className="flex items-center gap-2 mt-2">
        <span className="text-2xl">{country.flag}</span>
        <div className="text-left">
          <h4 className="text-xs font-bold text-foreground truncate max-w-[120px]">
            {country.name}
          </h4>
          <p className="text-[10px] text-muted-foreground font-medium truncate max-w-[120px]">
            {country.office}
          </p>
        </div>
      </div>

      {/* Sweeping Analog Clock Face — hidden on mobile, digital time below is shown instead */}
      <div className="relative w-24 h-24 rounded-full border border-foreground/10 bg-background/40 hidden sm:flex items-center justify-center shadow-inner">
        <div className="absolute w-2 h-2 rounded-full bg-foreground z-20" />

        {[0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11].map((tick) => (
          <div
            key={tick}
            className="absolute inset-1 flex flex-col items-center pointer-events-none"
            style={{ transform: `rotate(${tick * 30}deg)` }}
          >
            <div
              className={cn(
                "w-0.5 rounded-full bg-foreground/20",
                tick % 3 === 0 ? "h-1.5 bg-foreground/35" : "h-0.75",
              )}
            />
          </div>
        ))}

        {/* Hour Hand */}
        <div
          className="absolute w-1 h-6 rounded-full bg-foreground origin-bottom bottom-1/2 z-10"
          style={{
            transform: `rotate(${hrDeg}deg)`,
            transformOrigin: "bottom center",
          }}
        />

        {/* Minute Hand */}
        <div
          className="absolute w-0.75 h-9 rounded-full bg-foreground/75 origin-bottom bottom-1/2 z-10"
          style={{
            transform: `rotate(${minDeg}deg)`,
            transformOrigin: "bottom center",
          }}
        />

        {/* Sweeping Second Hand */}
        <div
          className="absolute w-0.5 h-10 rounded-full bg-primary origin-bottom bottom-1/2 z-10"
          style={{
            transform: `rotate(${secDeg}deg)`,
            transformOrigin: "bottom center",
          }}
        />
      </div>

      <div className="space-y-0.5">
        <div className="text-lg font-extrabold text-foreground tracking-tight">{timeStr}</div>
        <div className="flex items-center justify-center gap-1.5 text-[9px] text-muted-foreground font-bold uppercase tracking-wider">
          <span>{timeLabel}</span>
          <span>•</span>
          <span className="truncate max-w-[80px]">
            {(country.timezone.split("/").slice(1).join("/") || country.timezone).replace(
              /_/g,
              " ",
            )}
          </span>
        </div>
      </div>
    </motion.div>
  );
}

function LayoutComponent() {
  const [commandOpen, setCommandOpen] = useState(false);
  const [hoveredPath, setHoveredPath] = useState<string | null>(null);
  const navigate = useNavigate();
  const location = useLocation();

  const { threads, activeId, setActiveId, createThread, deleteThread } = useChatStore();
  const activeThread = activeId ? threads[activeId] : null;
  const { user, logout } = useAuth();
  const { theme, setTheme, country, setCountry } = useSettings();
  const worldClocks = useSettings((s) => s.worldClocks);
  const addClock = useSettings((s) => s.addClock);
  const removeClock = useSettings((s) => s.removeClock);
  const resetClocks = useSettings((s) => s.resetClocks);
  const openIntro = useIntroStore((s) => s.open);
  const isMasterMode = useMasterModeStore((s) => s.isMasterMode);
  const toggleMasterMode = useMasterModeStore((s) => s.toggle);
  // Intro tour play button is restricted to the app owner only.
  const canWatchIntro = (user?.email ?? "").toLowerCase() === "shivam.sharma@alignedautomation.com";

  const [historyDrawerOpen, setHistoryDrawerOpen] = useState(false);
  const [profileDropdownOpen, setProfileDropdownOpen] = useState(false);
  const [clocksOverlayOpen, setClocksOverlayOpen] = useState(false);
  const [clockPickerOpen, setClockPickerOpen] = useState(false);
  const [clockSearch, setClockSearch] = useState("");
  const [copilotOpen, setCopilotOpen] = useState(false);

  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [userWantsCollapsed, setUserWantsCollapsed] = useState(false);
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);

  // Recent Chats is tied to the account, not the device: pull the user's server-saved
  // threads once on login and merge them into the local store, then let chat-sync.ts's
  // subscriber push any further local changes back up for the same account.
  useEffect(() => {
    setChatSyncUser(user?.email ?? null);
    if (user?.email) hydrateChatFromServer(user.email);
  }, [user?.email]);

  // Close mobile drawer when route changes
  useEffect(() => {
    setMobileMenuOpen(false);
  }, [location.pathname]);

  // Auto-collapse / restore left sidebar based on right Copilot sidebar state
  useEffect(() => {
    if (copilotOpen) {
      setSidebarCollapsed(true);
    } else {
      setSidebarCollapsed(userWantsCollapsed);
    }
  }, [copilotOpen, userWantsCollapsed]);

  const toggleSidebar = () => {
    const newState = !sidebarCollapsed;
    setSidebarCollapsed(newState);
    setUserWantsCollapsed(newState);
  };

  const getPageTitle = (path: string) => {
    if (path === "/") return "Chat Hub";
    if (path.startsWith("/onboarding")) return "Onboarding Portal";
    if (path.startsWith("/documents")) return "Document Center";
    if (path.startsWith("/directory")) return "Employee Directory";
    if (path.startsWith("/my-requests")) return "My Requests";
    if (path.startsWith("/team")) return "Team Manager";
    if (path.startsWith("/control-hub")) return "Control Hub";
    if (path.startsWith("/settings")) return "Settings";
    return "Workspace";
  };

  useEffect(() => {
    if (
      location.pathname === "/" ||
      location.pathname === "/settings" ||
      location.pathname.startsWith("/documents")
    ) {
      setCopilotOpen(false);
    }
  }, [location.pathname]);

  const [searchQuery, setSearchQuery] = useState("");
  const [deleteConfirmId, setDeleteConfirmId] = useState<string | null>(null);
  const [hasTeam, setHasTeam] = useState(false);

  useEffect(() => {
    if (!user?.email) return;
    fetch("/api/portal/manager/has-team", {
      headers: { "x-user-email": user.email, "x-user-role": (user.role ?? "").toLowerCase() },
    })
      .then((r) => r.json())
      .then((d) => setHasTeam(!!d?.has_team))
      .catch(() => {});
  }, [user?.email, user?.role]);

  const profileDropdownRef = useRef<HTMLDivElement>(null);
  const [avatarError, setAvatarError] = useState(false);

  useEffect(() => {
    if (isInitialAppLoad) {
      isInitialAppLoad = false;
      createThread();
    }
  }, [createThread]);

  const activeTheme =
    theme === "system"
      ? typeof window !== "undefined" && window.matchMedia("(prefers-color-scheme: dark)").matches
        ? "dark"
        : "light"
      : theme;

  const handleThemeToggle = () => {
    const targetTheme = activeTheme === "dark" ? "light" : "dark";
    setTheme(targetTheme);
  };

  useEffect(() => {
    const detected = detectCountryFromTimezone();
    if (detected !== country) setCountry(detected);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    setAvatarError(false);
  }, [user?.avatarUrl]);

  // Click outside profile dropdown
  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (profileDropdownRef.current && !profileDropdownRef.current.contains(e.target as Node)) {
        setProfileDropdownOpen(false);
      }
    };
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  // Keyboard shortcut listener (Cmd/Ctrl+K → command palette)
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === "k") {
        e.preventDefault();
        setCommandOpen((v) => !v);
      }
      if ((e.metaKey || e.ctrlKey) && e.key === "l") {
        e.preventDefault();
        window.dispatchEvent(new Event("centriq:focus-composer"));
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, []);

  const handleDelete = (id: string) => {
    setDeleteConfirmId(id);
  };

  const confirmDelete = async () => {
    if (!deleteConfirmId) return;
    const id = deleteConfirmId;
    setDeleteConfirmId(null);
    deleteThread(id);
    try {
      await fetch(`/api/chat/${id}`, {
        method: "DELETE",
        headers: user?.email ? { "x-user-email": user.email } : {},
      });
    } catch {
      // failed silently
    }
  };

  if (!user) return null;

  const isActive = (path: string) => {
    if (path === "/" && location.pathname === "/") return true;
    if (path !== "/" && location.pathname.startsWith(path)) return true;
    return false;
  };

  // Static checks for Hub items
  const hasControlHubAccess = [
    "HR",
    "IT",
    "PMO",
    "Admin",
    "Functional Manager",
    "Super Admin",
  ].includes(user.role);

  const navItems = [
    { to: "/", icon: MessageSquare, label: "Chat", show: true },
    { to: "/onboarding", icon: Rocket, label: "Onboarding", show: true },
    { to: "/documents", icon: FileText, label: "Documents", show: true },
    { to: "/directory", icon: Users, label: "Directory", show: true },
    { to: "/my-requests", icon: ClipboardCheck, label: "My Requests", show: true },
    { to: "/team", icon: UsersRound, label: "My Team", show: hasTeam },
    {
      to: "/control-hub",
      icon: Shield,
      label: "Control Hub",
      show: hasControlHubAccess,
    },
    { to: "/settings", icon: Settings, label: "Settings", show: true },
  ];

  const avatarEl =
    user.avatarUrl && !avatarError ? (
      <img
        src={user.avatarUrl}
        alt={user.name}
        onError={() => setAvatarError(true)}
        className="h-7 w-7 rounded-full object-cover shrink-0 ring-2 ring-primary/20"
      />
    ) : (
      <div
        className="flex h-7 w-7 items-center justify-center rounded-full text-[10px] font-black text-white shrink-0"
        style={{
          background: "var(--gradient-primary)",
        }}
      >
        {user.name
          .split(" ")
          .map((n) => n[0]?.toUpperCase() ?? "")
          .join("")}
      </div>
    );

  const showCopilot =
    location.pathname !== "/" &&
    location.pathname !== "/settings" &&
    !location.pathname.startsWith("/team") &&
    !location.pathname.startsWith("/documents") &&
    !location.pathname.startsWith("/control-hub");

  return (
    <div className="flex h-screen h-[100dvh] w-full bg-background overflow-hidden flex-row">
      {/* --- DESKTOP LEFT SIDEBAR --- */}
      <aside
        className={cn(
          "hidden lg:flex flex-col h-full bg-[#090f21] border-r border-blue-950/60 backdrop-blur-xl shrink-0 transition-all duration-300 relative select-none z-30",
          sidebarCollapsed ? "w-[78px]" : "w-[260px]"
        )}
      >
        {/* Brand Header */}
        <div className={cn("flex items-center py-5 h-16 border-b border-blue-950/60 shrink-0 gap-2.5", sidebarCollapsed ? "justify-center px-0" : "px-4")}>
          <Link to="/" className="flex items-center gap-2 hover:opacity-95 transition-opacity overflow-hidden">
            <div className="relative shrink-0 flex items-center justify-center">
              <Logo size="sm" />
              <motion.div
                className="absolute -inset-1 rounded-xl opacity-30 blur-sm pointer-events-none"
                style={{ background: "var(--gradient-primary)" }}
                animate={{ opacity: [0.2, 0.4, 0.2] }}
                transition={{ duration: 3, repeat: Infinity }}
              />
            </div>
            {!sidebarCollapsed && (
              <BrandName className="text-sm font-bold tracking-tight text-white whitespace-nowrap" withAI={true} />
            )}
          </Link>
        </div>

        {/* Navigation List */}
        <nav
          className="flex-1 py-3 px-3 overflow-hidden flex flex-col min-h-0"
          onMouseLeave={() => setHoveredPath(null)}
        >
          {/* Main Links */}
          <div className="space-y-0.5 shrink-0">
            {navItems
              .filter((n) => n.show)
              .map((item) => {
                const Icon = item.icon;
                const active = isActive(item.to);
                const accentColor = NAV_COLORS[item.to] || "var(--clarity)";
                return (
                  <Link
                    key={item.to}
                    to={item.to}
                    onMouseEnter={() => setHoveredPath(item.to)}
                    className={cn(
                      "relative flex items-center gap-3 px-3 py-2 rounded-xl text-xs font-semibold transition-all duration-200 cursor-pointer whitespace-nowrap z-10",
                      sidebarCollapsed ? "justify-center" : "justify-start",
                      active
                        ? "font-bold text-white"
                        : "text-zinc-400 hover:text-white",
                    )}
                    style={{
                      color: active ? accentColor : undefined,
                    }}
                    title={sidebarCollapsed ? item.label : undefined}
                  >
                    {active && (
                      <motion.div
                        layoutId="desktop-sidebar-active-pill"
                        className="absolute inset-0 rounded-xl -z-10"
                        style={{
                          background: `color-mix(in oklab, ${accentColor} 14%, transparent)`,
                          boxShadow: `inset 0 0 0 1px color-mix(in oklab, ${accentColor} 20%, transparent)`,
                        }}
                        transition={{ type: "spring", stiffness: 380, damping: 30 }}
                      />
                    )}
                    {active && (
                      <motion.div
                        layoutId="desktop-sidebar-active-stripe"
                        className="absolute left-0 top-2.5 bottom-2.5 w-0.75 rounded-r-full"
                        style={{ background: accentColor, boxShadow: `0 0 8px ${accentColor}` }}
                        transition={{ type: "spring", stiffness: 400, damping: 28 }}
                      />
                    )}
                    {hoveredPath === item.to && !active && (
                      <motion.div
                        layoutId="desktop-sidebar-hover-pill"
                        className="absolute inset-0 rounded-xl bg-zinc-800/40 -z-20"
                        transition={{ type: "spring", stiffness: 350, damping: 28 }}
                      />
                    )}
                    <motion.div
                      whileHover={{ scale: 1.15, rotate: [0, -5, 5, 0] }}
                      animate={active ? { scale: 1.05 } : { scale: 1 }}
                      transition={{
                        type: "spring",
                        stiffness: 400,
                        damping: 10,
                        rotate: { type: "tween", duration: 0.3 },
                      }}
                      className="shrink-0 flex items-center justify-center"
                    >
                      <Icon
                        className="h-4.5 w-4.5"
                        style={{ color: active ? accentColor : "inherit" }}
                      />
                    </motion.div>
                    {!sidebarCollapsed && (
                      <span className="transition-opacity duration-300">{item.label}</span>
                    )}
                  </Link>
                );
              })}
          </div>

          {/* Recent Conversations — only this section scrolls */}
          {!sidebarCollapsed && (
            <div className="mt-3 pt-3 border-t border-blue-950/60 flex-1 flex flex-col min-h-0">
              <div className="flex items-center justify-between px-2 mb-1.5 shrink-0">
                <span className="text-[10px] font-bold uppercase tracking-[0.15em] text-zinc-500">
                  Recent Chats
                </span>
                <button
                  onClick={() => {
                    const newId = createThread();
                    setActiveId(newId);
                    if (location.pathname !== "/") {
                      navigate({ to: "/" });
                    }
                  }}
                  className="flex h-5 w-5 items-center justify-center rounded-md bg-zinc-800 text-zinc-400 hover:bg-primary/20 hover:text-primary transition-all cursor-pointer"
                  title="New Conversation"
                >
                  <Plus className="h-3 w-3" />
                </button>
              </div>

              <div className="space-y-0.5 overflow-y-auto no-scrollbar">
                {Object.keys(threads).length === 0 ? (
                  <div className="text-[10px] text-zinc-600 italic px-2 py-1.5">
                    No conversations yet
                  </div>
                ) : (
                  Object.values(threads)
                    .filter((t) => t.turns.length > 0)
                    .sort((a, b) => b.updatedAt - a.updatedAt)
                    .map((t) => {
                      const firstUserMsg = (t.turns ?? []).find((x) => x.role === "user")?.text;
                      const chatTitle = firstUserMsg
                        ? firstUserMsg.length > 32 ? firstUserMsg.slice(0, 32) + "…" : firstUserMsg
                        : "New conversation";
                      const isActiveChat = activeId === t.id && location.pathname === "/";
                      return (
                        <div
                          key={t.id}
                          className={cn(
                            "group relative flex items-center gap-2 px-2 py-1.5 rounded-lg cursor-pointer transition-all",
                            isActiveChat
                              ? "bg-primary/12 text-white"
                              : "text-zinc-500 hover:bg-zinc-800/50 hover:text-zinc-200"
                          )}
                          onClick={() => {
                            setActiveId(t.id);
                            if (location.pathname !== "/") navigate({ to: "/" });
                          }}
                        >
                          <MessageSquare className={cn("h-3 w-3 shrink-0", isActiveChat ? "text-primary" : "text-zinc-600")} />
                          <span className="truncate flex-1 text-[11px] font-medium pr-4">{chatTitle}</span>
                          <button
                            onClick={(e) => { e.stopPropagation(); handleDelete(t.id); }}
                            className="absolute right-1.5 opacity-0 group-hover:opacity-100 flex h-4.5 w-4.5 items-center justify-center rounded text-zinc-500 hover:text-rose-400 hover:bg-rose-500/10 transition-all cursor-pointer"
                            title="Delete"
                          >
                            <Trash2 className="h-2.5 w-2.5" />
                          </button>
                        </div>
                      );
                    })
                )}
              </div>
            </div>
          )}

        </nav>

        {/* Collapse/Expand Toggle — outside scrollable nav so it's always visible */}
        <div className="px-3 py-2 border-t border-blue-950/60 shrink-0">
          <button
            onClick={toggleSidebar}
            className={cn(
              "w-full flex items-center gap-3 px-3 py-2 rounded-xl text-xs font-semibold transition-all duration-200 cursor-pointer whitespace-nowrap",
              sidebarCollapsed ? "justify-center" : "justify-start",
              "text-zinc-500 hover:text-zinc-200 hover:bg-zinc-800/40"
            )}
            title={sidebarCollapsed ? "Expand Sidebar" : "Collapse Sidebar"}
          >
            {sidebarCollapsed ? (
              <ChevronRight className="h-4 w-4 shrink-0" />
            ) : (
              <>
                <ChevronLeft className="h-4 w-4 shrink-0" />
                <span>Collapse Sidebar</span>
              </>
            )}
          </button>
        </div>

        {/* Sidebar Footer */}
        <div className="mt-auto p-3 border-t border-blue-950/60 flex flex-col gap-2 shrink-0">
          {/* Utilities row when expanded */}
          {!sidebarCollapsed && (
            <div className="flex items-center justify-around py-1 bg-[#0c1630]/40 rounded-xl border border-blue-950/40">
              {canWatchIntro && (
                <button
                  onClick={openIntro}
                  className="flex h-7 w-7 items-center justify-center rounded-lg hover:bg-[#0c1630]/60 text-zinc-400 hover:text-white transition-all cursor-pointer"
                  title="Watch intro tour"
                >
                  <PlayCircle className="h-4 w-4 text-primary" />
                </button>
              )}

              <button
                onClick={() => setClocksOverlayOpen(true)}
                className="flex h-7 w-7 items-center justify-center rounded-lg hover:bg-[#0c1630]/60 text-zinc-400 hover:text-white transition-all cursor-pointer"
                title="Office Clocks"
              >
                <Globe className="h-4 w-4 text-primary" />
              </button>

              <button
                onClick={handleThemeToggle}
                className="flex h-7 w-7 items-center justify-center rounded-lg hover:bg-[#0c1630]/60 text-zinc-400 hover:text-white transition-all cursor-pointer"
                title="Toggle Theme"
              >
                {activeTheme === "dark" ? (
                  <Sun className="h-4 w-4 text-amber-400" />
                ) : (
                  <Moon className="h-4 w-4 text-indigo-400" />
                )}
              </button>

              <button
                onClick={toggleMasterMode}
                className={cn(
                  "flex h-7 w-7 items-center justify-center rounded-lg transition-all cursor-pointer",
                  isMasterMode
                    ? "bg-[#00c4bb]/20 text-[#00c4bb]"
                    : "hover:bg-[#0c1630]/60 text-zinc-400 hover:text-white",
                )}
                title={isMasterMode ? "Exit Master Mode" : "Enter Master Mode"}
              >
                <BrainCircuit className="h-4 w-4" />
              </button>
            </div>
          )}

          {/* Utilities column when collapsed */}
          {sidebarCollapsed && (
            <div className="flex flex-col items-center gap-1.5 pb-1">
              {canWatchIntro && (
                <button
                  onClick={openIntro}
                  className="flex h-8 w-8 items-center justify-center rounded-xl bg-[#0c1630]/40 hover:bg-[#0c1630]/60 text-zinc-400 hover:text-white transition-all cursor-pointer"
                  title="Watch intro tour"
                >
                  <PlayCircle className="h-4 w-4 text-primary" />
                </button>
              )}
              <button
                onClick={() => setClocksOverlayOpen(true)}
                className="flex h-8 w-8 items-center justify-center rounded-xl bg-[#0c1630]/40 hover:bg-[#0c1630]/60 text-zinc-400 hover:text-white transition-all cursor-pointer shadow-sm"
                title="Office Clocks"
              >
                <Globe className="h-4 w-4 text-primary" />
              </button>
              <button
                onClick={handleThemeToggle}
                className="flex h-8 w-8 items-center justify-center rounded-xl bg-[#0c1630]/40 hover:bg-[#0c1630]/60 text-zinc-400 hover:text-white transition-all cursor-pointer"
                title="Toggle Theme"
              >
                {activeTheme === "dark" ? (
                  <Sun className="h-4 w-4 text-amber-400" />
                ) : (
                  <Moon className="h-4 w-4 text-indigo-400" />
                )}
              </button>
              <button
                onClick={toggleMasterMode}
                className={cn(
                  "flex h-8 w-8 items-center justify-center rounded-xl transition-all cursor-pointer shadow-sm",
                  isMasterMode
                    ? "bg-[#00c4bb]/20 text-[#00c4bb]"
                    : "bg-[#0c1630]/40 hover:bg-[#0c1630]/60 text-zinc-400 hover:text-white",
                )}
                title={isMasterMode ? "Exit Master Mode" : "Enter Master Mode"}
              >
                <BrainCircuit className="h-4 w-4" />
              </button>
            </div>
          )}

          {/* Profile Switcher Dropdown inside Sidebar */}
          <div className="relative" ref={profileDropdownRef}>
            <button
              onClick={() => setProfileDropdownOpen(!profileDropdownOpen)}
              className={cn(
                "flex w-full items-center rounded-xl border border-blue-950 bg-[#0c1630]/35 hover:bg-[#0c1630]/60 p-1.5 transition-all text-xs font-medium text-white cursor-pointer shadow-sm",
                sidebarCollapsed ? "justify-center pr-1.5" : "justify-between pr-3"
              )}
            >
              <div className="flex items-center gap-2 min-w-0">
                {avatarEl}
                {!sidebarCollapsed && (
                  <div className="text-left min-w-0">
                    <div className="font-bold text-white truncate max-w-[120px]">{user.name}</div>
                    <div className="text-[10px] text-zinc-400 truncate max-w-[120px]">{user.role}</div>
                  </div>
                )}
              </div>
              {!sidebarCollapsed && (
                <ChevronDown
                  className={cn(
                    "h-3.5 w-3.5 text-zinc-400 opacity-55 transition-transform duration-200 shrink-0",
                    profileDropdownOpen && "rotate-180"
                  )}
                />
              )}
            </button>

            <AnimatePresence>
              {profileDropdownOpen && (
                <motion.div
                  initial={{ opacity: 0, y: 8, scale: 0.97 }}
                  animate={{ opacity: 1, y: 0, scale: 1 }}
                  exit={{ opacity: 0, y: 8, scale: 0.97 }}
                  transition={{ duration: 0.13, ease: [0.16, 1, 0.3, 1] }}
                  className="absolute bottom-full left-0 mb-2 z-[100] rounded-xl border border-zinc-700/60 bg-[#0d1628] p-1.5 shadow-2xl"
                  style={{ minWidth: "220px", width: "220px" }}
                >
                  {/* User identity header */}
                  <div className="px-2.5 py-2 mb-1 flex items-center gap-2.5">
                    <div className="shrink-0">{avatarEl}</div>
                    <div className="min-w-0">
                      <div className="text-[11px] font-bold text-white truncate">{user.name}</div>
                      <div className="text-[10px] text-zinc-400 truncate">{user.role}</div>
                    </div>
                  </div>

                  <RoleSwitcher />

                  <div className="border-t border-zinc-700/50 mt-1.5 pt-1.5">
                    <button
                      onClick={() => {
                        logout();
                        setProfileDropdownOpen(false);
                      }}
                      className="flex w-full items-center gap-2 rounded-lg px-2.5 py-1.5 text-[11px] font-medium text-rose-400 hover:bg-rose-500/10 hover:text-rose-300 transition-all text-left cursor-pointer"
                    >
                      <LogOut className="h-3.5 w-3.5 shrink-0" />
                      <span>Sign Out</span>
                    </button>
                  </div>
                </motion.div>
              )}
            </AnimatePresence>
          </div>
        </div>
      </aside>

      {/* --- MOBILE LEFT DRAWER --- */}
      <AnimatePresence>
        {mobileMenuOpen && (
          <>
            {/* Backdrop */}
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 0.4 }}
              exit={{ opacity: 0 }}
              onClick={() => setMobileMenuOpen(false)}
              className="fixed inset-0 bg-black/60 z-40 backdrop-blur-xs lg:hidden"
            />
            {/* Drawer Panel */}
            <motion.div
              initial={{ x: "-100%" }}
              animate={{ x: 0 }}
              exit={{ x: "-100%" }}
              transition={{ type: "spring", stiffness: 300, damping: 30 }}
              className="fixed inset-y-0 left-0 w-72 bg-[#090f21] border-r border-blue-950/60 shadow-2xl z-50 flex flex-col p-4 pt-6 lg:hidden select-none"
            >
              {/* Drawer Header */}
              <div className="flex items-center justify-between mb-6 px-2 shrink-0">
                <Link to="/" className="flex items-center gap-2" onClick={() => setMobileMenuOpen(false)}>
                  <Logo size="sm" />
                  <BrandName className="text-sm font-bold tracking-tight text-white" withAI={true} />
                </Link>
                <button
                  onClick={() => setMobileMenuOpen(false)}
                  className="p-1.5 rounded-xl text-zinc-400 hover:bg-zinc-800/40 hover:text-white transition-all cursor-pointer"
                >
                  <X className="h-4 w-4" />
                </button>
              </div>

              {/* Navigation Items */}
              <div className="flex-1 space-y-1.5 overflow-y-auto px-1 no-scrollbar">
                {navItems
                  .filter((n) => n.show)
                  .map((item) => {
                    const Icon = item.icon;
                    const active = isActive(item.to);
                    const accentColor = NAV_COLORS[item.to] || "var(--clarity)";
                    return (
                      <Link
                        key={item.to}
                        to={item.to}
                        onClick={() => setMobileMenuOpen(false)}
                        className={cn(
                          "relative flex items-center gap-3.5 px-3.5 py-3 rounded-xl text-xs font-semibold transition-all duration-200 cursor-pointer z-10",
                          active
                            ? "font-bold"
                            : "text-zinc-400 hover:text-white hover:bg-zinc-800/20",
                        )}
                        style={{
                          color: active ? accentColor : undefined,
                        }}
                      >
                        {active && (
                          <motion.div
                            layoutId="mobile-drawer-active-pill"
                            className="absolute inset-0 rounded-xl -z-10"
                            style={{
                              background: `color-mix(in oklab, ${accentColor} 14%, transparent)`,
                              boxShadow: `inset 0 0 0 1px color-mix(in oklab, ${accentColor} 20%, transparent)`,
                            }}
                          />
                        )}
                        <Icon
                          className="h-4.5 w-4.5"
                          style={{ color: active ? accentColor : "inherit" }}
                        />
                        <span>{item.label}</span>
                      </Link>
                    );
                  })}
              </div>

              {/* Recent Conversations */}
              <div className="border-t border-blue-950/60 pt-3 mt-3 px-1 shrink-0 max-h-[35vh] flex flex-col">
                <div className="flex items-center justify-between px-2 mb-1.5 shrink-0">
                  <span className="text-[10px] font-bold uppercase tracking-[0.15em] text-zinc-500">
                    Recent Chats
                  </span>
                  <button
                    onClick={() => {
                      const newId = createThread();
                      setActiveId(newId);
                      if (location.pathname !== "/") {
                        navigate({ to: "/" });
                      }
                      setMobileMenuOpen(false);
                    }}
                    className="flex h-5 w-5 items-center justify-center rounded-md bg-zinc-800 text-zinc-400 hover:bg-primary/20 hover:text-primary transition-all cursor-pointer"
                    title="New Conversation"
                  >
                    <Plus className="h-3 w-3" />
                  </button>
                </div>

                <div className="space-y-0.5 overflow-y-auto no-scrollbar">
                  {Object.keys(threads).length === 0 ? (
                    <div className="text-[10px] text-zinc-600 italic px-2 py-1.5">
                      No conversations yet
                    </div>
                  ) : (
                    Object.values(threads)
                      .filter((t) => t.turns.length > 0)
                      .sort((a, b) => b.updatedAt - a.updatedAt)
                      .map((t) => {
                        const firstUserMsg = (t.turns ?? []).find((x) => x.role === "user")?.text;
                        const chatTitle = firstUserMsg
                          ? firstUserMsg.length > 32 ? firstUserMsg.slice(0, 32) + "…" : firstUserMsg
                          : "New conversation";
                        const isActiveChat = activeId === t.id && location.pathname === "/";
                        return (
                          <div
                            key={t.id}
                            className={cn(
                              "group relative flex items-center gap-2 px-2 py-1.5 rounded-lg cursor-pointer transition-all",
                              isActiveChat
                                ? "bg-primary/12 text-white"
                                : "text-zinc-500 hover:bg-zinc-800/50 hover:text-zinc-200"
                            )}
                            onClick={() => {
                              setActiveId(t.id);
                              if (location.pathname !== "/") navigate({ to: "/" });
                              setMobileMenuOpen(false);
                            }}
                          >
                            <MessageSquare className={cn("h-3 w-3 shrink-0", isActiveChat ? "text-primary" : "text-zinc-600")} />
                            <span className="truncate flex-1 text-[11px] font-medium pr-4">{chatTitle}</span>
                            <button
                              onClick={(e) => { e.stopPropagation(); handleDelete(t.id); }}
                              className="absolute right-1.5 opacity-0 group-hover:opacity-100 flex h-4.5 w-4.5 items-center justify-center rounded text-zinc-500 hover:text-rose-400 hover:bg-rose-500/10 transition-all cursor-pointer"
                              title="Delete"
                            >
                              <Trash2 className="h-2.5 w-2.5" />
                            </button>
                          </div>
                        );
                      })
                  )}
                </div>
              </div>

              {/* Drawer Footer Actions */}
              <div className="border-t border-blue-950/60 pt-4 mt-4 space-y-3 px-2 shrink-0">
                {/* Utilities */}
                <div className="flex items-center justify-around py-1.5 bg-[#0c1630]/40 rounded-xl border border-blue-950/40">
                  {canWatchIntro && (
                    <button
                      onClick={() => {
                        openIntro();
                        setMobileMenuOpen(false);
                      }}
                      className="flex h-8 w-8 items-center justify-center rounded-lg text-zinc-400 hover:text-white transition-all cursor-pointer"
                      title="Watch intro tour"
                    >
                      <PlayCircle className="h-4.5 w-4.5 text-primary" />
                    </button>
                  )}

                  <button
                    onClick={() => {
                      setClocksOverlayOpen(true);
                      setMobileMenuOpen(false);
                    }}
                    className="flex h-8 w-8 items-center justify-center rounded-lg text-zinc-400 hover:text-white transition-all cursor-pointer"
                    title="Office Clocks"
                  >
                    <Globe className="h-4.5 w-4.5 text-primary" />
                  </button>

                  <button
                    onClick={handleThemeToggle}
                    className="flex h-8 w-8 items-center justify-center rounded-lg text-zinc-400 hover:text-white transition-all cursor-pointer"
                    title="Toggle Theme"
                  >
                    {activeTheme === "dark" ? (
                      <Sun className="h-4.5 w-4.5 text-amber-400" />
                    ) : (
                      <Moon className="h-4.5 w-4.5 text-indigo-400" />
                    )}
                  </button>
                </div>

                {/* User card / switcher */}
                <div className="flex items-center gap-3 p-2 bg-[#0c1630]/35 rounded-2xl border border-blue-950">
                  <div className="shrink-0">{avatarEl}</div>
                  <div className="min-w-0 flex-1">
                    <div className="text-xs font-bold text-white truncate">{user.name}</div>
                    <div className="text-[9px] text-zinc-400 truncate">{user.role}</div>
                  </div>
                  <button
                    onClick={() => {
                      logout();
                      setMobileMenuOpen(false);
                    }}
                    className="p-1.5 rounded-lg text-rose-500 hover:bg-rose-500/10 transition-all cursor-pointer shrink-0"
                    title="Sign Out"
                  >
                    <LogOut className="h-4 w-4" />
                  </button>
                </div>
              </div>
            </motion.div>
          </>
        )}
      </AnimatePresence>


      {/* --- RIGHT SIDE CONTENT AREA --- */}
      <div className="flex-1 flex flex-col min-w-0 h-full overflow-hidden relative">
        {/* --- PREMIUM WORKSPACE HEADER --- */}
        <header className="h-14 sm:h-16 flex items-center justify-between gap-2 px-3 sm:px-6 border-b border-border/40 bg-background/60 backdrop-blur-xl z-20 shrink-0 select-none">
          {/* Left Side: Mobile Hamburger OR Page Title on desktop */}
          <div className="flex items-center gap-3">
            {/* Hamburger Button (Mobile Only) */}
            <button
              onClick={() => setMobileMenuOpen(true)}
              className="flex lg:hidden h-9 w-9 items-center justify-center rounded-xl border border-border/50 bg-muted/40 hover:bg-muted/70 text-foreground transition-all cursor-pointer shadow-sm"
              title="Open Navigation"
            >
              <Menu className="h-5 w-5" />
            </button>

            {/* Page Title (Desktop Only) / Logo + Brand (Mobile Only) */}
            <div className="flex items-center gap-2">
              {location.pathname !== "/" && !location.pathname.startsWith("/team") && (
                <span className="hidden lg:inline text-sm font-bold tracking-tight text-foreground select-none">
                  {getPageTitle(location.pathname)}
                </span>
              )}

              {/* Logo + Brand (Mobile Only) */}
              <Link to="/" className="flex lg:hidden items-center gap-2 hover:opacity-95 transition-opacity">
                <Logo size="sm" />
                <BrandName className="text-sm font-bold tracking-tight text-foreground" withAI={true} />
              </Link>
            </div>
          </div>

          {/* Right Side Utilities */}
          <div className="flex items-center gap-1.5 sm:gap-2 shrink-0">
            {/* Notifications: announcements + proactive nudges, merged into one bell */}
            <ProactiveNudgeFeed />

            {/* Admin/system Activity feed */}
            <ActivityBell />
          </div>
        </header>

        {/* --- MAIN WORKSPACE --- */}
        <main
          className={cn(
            "flex-1 w-full min-h-0 relative z-0 overflow-hidden transition-all duration-300",
            showCopilot && copilotOpen && "lg:pr-[480px]",
          )}
        >
          <Outlet />
        </main>
      </div>

      {/* --- PARALLAX TIME ORBIT OVERLAY --- */}
      <AnimatePresence>
        {clocksOverlayOpen && (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 0.6 }}
              exit={{ opacity: 0 }}
              onClick={() => setClocksOverlayOpen(false)}
              className="absolute inset-0 bg-black backdrop-blur-md"
            />

            <motion.div
              initial={{ opacity: 0, scale: 0.92, y: 15 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.92, y: 15 }}
              transition={{ type: "spring", stiffness: 320, damping: 26 }}
              className="relative bg-background/85 border border-border/80 shadow-2xl p-6 md:p-8 rounded-3xl max-w-4xl w-full z-10 max-h-[88vh] overflow-y-auto no-scrollbar"
            >
              <div className="absolute inset-0 bg-radial from-primary/5 via-transparent to-transparent pointer-events-none" />

              <button
                onClick={() => setClocksOverlayOpen(false)}
                className="absolute top-4 right-4 p-2 rounded-xl text-muted-foreground hover:bg-muted hover:text-foreground transition-all cursor-pointer"
              >
                <X className="h-5 w-5" />
              </button>

              <div className="mb-6 text-center select-none">
                <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-primary/10 border border-primary/20 text-primary text-xs font-semibold mb-2">
                  <Globe
                    className="h-3.5 w-3.5 animate-spin-slow"
                    style={{ animationDuration: "10s" }}
                  />
                  <span>Interactive Workspace Clocks</span>
                </div>
                <h2 className="text-xl md:text-2xl font-bold tracking-tight text-foreground">
                  Global Office Time Orbit
                </h2>
                <p className="text-xs md:text-sm text-muted-foreground max-w-md mx-auto mt-1">
                  Real-time dial sweeping across your pinned offices and cities. Add any timezone in
                  the world, or remove the ones you don't need.
                </p>
              </div>

              {/* Toolbar */}
              <div className="flex items-center justify-center gap-2 mb-5">
                <button
                  onClick={() => {
                    setClockSearch("");
                    setClockPickerOpen((v) => !v);
                  }}
                  className={cn(
                    "inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-semibold border transition-all cursor-pointer",
                    clockPickerOpen
                      ? "bg-primary/15 border-primary/40 text-primary"
                      : "bg-muted/40 border-border/60 text-foreground hover:bg-muted",
                  )}
                >
                  <Plus className="h-3.5 w-3.5" />
                  Add clock
                </button>
                <button
                  onClick={resetClocks}
                  title="Reset to default clocks"
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-semibold border border-border/60 bg-muted/40 text-muted-foreground hover:bg-muted hover:text-foreground transition-all cursor-pointer"
                >
                  <RotateCcw className="h-3.5 w-3.5" />
                  Reset
                </button>
              </div>

              {/* Timezone picker */}
              <AnimatePresence>
                {clockPickerOpen && (
                  <motion.div
                    initial={{ opacity: 0, height: 0 }}
                    animate={{ opacity: 1, height: "auto" }}
                    exit={{ opacity: 0, height: 0 }}
                    transition={{ duration: 0.2 }}
                    className="overflow-hidden mb-5"
                  >
                    <div className="rounded-2xl border border-border/60 bg-muted/25 p-3">
                      <div className="relative mb-3">
                        <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                        <input
                          autoFocus
                          value={clockSearch}
                          onChange={(e) => setClockSearch(e.target.value)}
                          placeholder="Search any city or timezone (e.g. Tokyo, Paris, GMT)…"
                          className="w-full rounded-xl border border-border/60 bg-background/70 py-2 pl-9 pr-3 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary/40"
                        />
                      </div>
                      {(() => {
                        const pinned = new Set(worldClocks.map((c) => c.id));
                        const q = clockSearch.trim().toLowerCase();
                        const source = q ? listAllTimezones() : POPULAR_CLOCK_TZS;
                        const matches = source
                          .filter((tz) => !pinned.has(tz))
                          .filter((tz) => !q || tz.toLowerCase().replace(/_/g, " ").includes(q))
                          .slice(0, 60);

                        if (matches.length === 0) {
                          return (
                            <p className="text-center text-xs text-muted-foreground py-4">
                              {q ? "No matching timezone found." : "All popular clocks are already pinned."}
                            </p>
                          );
                        }

                        return (
                          <>
                            {!q && (
                              <p className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground mb-2 px-1">
                                Popular
                              </p>
                            )}
                            <div className="max-h-56 overflow-y-auto grid grid-cols-1 sm:grid-cols-2 gap-1.5 pr-1">
                              {matches.map((tz) => {
                                const clock = clockFromTimezone(tz);
                                return (
                                  <button
                                    key={tz}
                                    onClick={() => {
                                      addClock(clock);
                                      setClockSearch("");
                                    }}
                                    className="flex items-center gap-2.5 rounded-xl border border-transparent hover:border-primary/30 hover:bg-primary/10 px-2.5 py-2 text-left transition-all cursor-pointer"
                                  >
                                    <span className="text-lg shrink-0">{clock.flag}</span>
                                    <span className="min-w-0 flex-1">
                                      <span className="block text-xs font-semibold text-foreground truncate">
                                        {clock.label}
                                      </span>
                                      <span className="block text-[10px] text-muted-foreground truncate">
                                        {tz.replace(/_/g, " ")}
                                      </span>
                                    </span>
                                    <Plus className="h-3.5 w-3.5 text-primary shrink-0" />
                                  </button>
                                );
                              })}
                            </div>
                          </>
                        );
                      })()}
                    </div>
                  </motion.div>
                )}
              </AnimatePresence>

              {/* Clocks Grid */}
              {worldClocks.length === 0 ? (
                <p className="text-center text-sm text-muted-foreground py-10">
                  No clocks pinned. Use <span className="font-semibold text-foreground">Add clock</span> to
                  pin any timezone in the world.
                </p>
              ) : (
                <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-4 gap-4 md:gap-5 mt-4">
                  {worldClocks.map((c) => (
                    <TimezoneOrbitClockCard
                      key={c.id}
                      country={{
                        code: c.id,
                        name: c.label,
                        office: c.region,
                        flag: c.flag,
                        timezone: c.timezone,
                      }}
                      onRemove={() => removeClock(c.id)}
                    />
                  ))}
                </div>
              )}
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      {/* --- FLOATING OFFICE RUNNER MASCOT --- */}
      {theme && location.pathname === "/" && (
        <div className="fixed bottom-20 lg:bottom-28 right-4 md:right-8 z-40">
          <SittingBuddy />
        </div>
      )}

      {/* --- COMMAND PALETTE --- */}
      <CommandPalette open={commandOpen} onClose={() => setCommandOpen(false)} />

      {/* --- DELETE CONFIRMATION DIALOG --- */}
      <AlertDialog
        open={!!deleteConfirmId}
        onOpenChange={(open) => {
          if (!open) setDeleteConfirmId(null);
        }}
      >
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

      {/* --- COPILOT SIDEBAR DRAWER --- */}
      {showCopilot && <CopilotSidebar isOpen={copilotOpen} setIsOpen={setCopilotOpen} />}

      {/* --- GLOBAL EMAIL AUTOMATION DRAWER --- */}
      <EmailAutomationDrawer />
    </div>
  );
}
