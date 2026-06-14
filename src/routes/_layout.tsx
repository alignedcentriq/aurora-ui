import { createFileRoute, Outlet, useNavigate, Link, useLocation } from "@tanstack/react-router";
import { Logo } from "@/components/Logo";
import { BrandName } from "@/components/BrandName";
import {
  MessageSquare,
  Settings,
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
  X,
  Sparkles,
  BookOpen,
  FileText,
  Crown,
  Globe,
  Search,
  ClipboardCheck,
  Sun,
  Moon,
} from "lucide-react";
import { useState, useEffect, useRef, useCallback } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { CommandPalette } from "@/components/CommandPalette";
import { AnnouncementBanner } from "@/components/assistant/AnnouncementBanner";
import { useChatStore } from "@/lib/chat-store";
import { useSettings, COUNTRIES, detectCountryFromTimezone } from "@/lib/settings-store";
import { useAuth, Role } from "@/lib/auth-store";
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

const ROLE_META: Record<Role, { icon: any; color: string; label: string; cKey: string }> = {
  Employee: { icon: Briefcase, color: "text-[#3B8FE8]", label: "Employee", cKey: "Clarity" },
  HR: { icon: Users, color: "text-[#22C55E]", label: "Human Resources", cKey: "Collaboration" },
  IT: { icon: Wrench, color: "text-[#14B8A6]", label: "IT Support", cKey: "Connectivity" },
  PMO: { icon: ClipboardList, color: "text-[#4F6FEF]", label: "Project Management", cKey: "Capacity" },
  Admin: { icon: Shield, color: "text-[#3B8FE8]", label: "Administrator", cKey: "Clarity" },
  "Functional Manager": { icon: UserCog, color: "text-[#22C55E]", label: "Functional Manager", cKey: "Collaboration" },
  "Super Admin": { icon: Crown, color: "text-[#F59E0B]", label: "Super Admin", cKey: "Capacity" },
};

const NAV_COLORS: Record<string, string> = {
  "/": "var(--clarity)",
  "/books": "var(--connectivity)",
  "/documents": "var(--connectivity)",
  "/my-requests": "var(--collaboration)",
  "/control-hub": "var(--clarity)",
  "/settings": "var(--capacity)",
};

// --- Timezone Clock Card Component with Parallax Hover ---
function TimezoneOrbitClockCard({ country }: { country: any }) {
  const [tilt, setTilt] = useState({ rotateX: 0, rotateY: 0, scale: 1 });
  const [timeData, setTimeData] = useState({ timeStr: "", isOpen: false, hrDeg: 0, minDeg: 0, secDeg: 0, h: 12, m: 0 });

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
        h = parseInt(parts.find(p => p.type === "hour")?.value || "0", 10);
        m = parseInt(parts.find(p => p.type === "minute")?.value || "0", 10);
        const s = parseInt(parts.find(p => p.type === "second")?.value || "0", 10);
        const weekday = parts.find(p => p.type === "weekday")?.value || "Mon";

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
        borderGlow
      )}
    >
      <div className="absolute top-4 right-4 flex items-center gap-1.5">
        <span className={cn(
          "h-2 w-2 rounded-full",
          isOpen ? "bg-emerald-500 shadow-[0_0_8px_#10b981]" : "bg-zinc-600"
        )} />
        <span className="text-[9px] font-bold text-foreground/50 uppercase tracking-wider">
          {isOpen ? "Open" : "Closed"}
        </span>
      </div>

      <div className="flex items-center gap-2 mt-2">
        <span className="text-2xl">{country.flag}</span>
        <div className="text-left">
          <h4 className="text-xs font-bold text-foreground truncate max-w-[120px]">{country.name}</h4>
          <p className="text-[10px] text-muted-foreground font-medium truncate max-w-[120px]">{country.office}</p>
        </div>
      </div>

      {/* Sweeping Analog Clock Face */}
      <div className="relative w-24 h-24 rounded-full border border-foreground/10 bg-background/40 flex items-center justify-center shadow-inner">
        <div className="absolute w-2 h-2 rounded-full bg-foreground z-20" />
        
        {[0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11].map((tick) => (
          <div
            key={tick}
            className="absolute inset-1 flex flex-col items-center pointer-events-none"
            style={{ transform: `rotate(${tick * 30}deg)` }}
          >
            <div className={cn("w-0.5 rounded-full bg-foreground/20", tick % 3 === 0 ? "h-1.5 bg-foreground/35" : "h-0.75")} />
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
          <span className="truncate max-w-[80px]">{country.timezone.split("/")[1].replace("_", " ")}</span>
        </div>
      </div>
    </motion.div>
  );
}

function LayoutComponent() {
  const [commandOpen, setCommandOpen] = useState(false);
  const navigate = useNavigate();
  const location = useLocation();

  const { threads, activeId, setActiveId, createThread, deleteThread } = useChatStore();
  const activeThread = activeId ? threads[activeId] : null;
  const isChatOpen = location.pathname === "/" && activeThread && activeThread.turns.length > 0;
  const showHeaderNav = location.pathname === "/";
  const [dockPosition, setDockPosition] = useState<"top" | "bottom" | "left" | "right">("top");
  const { user, logout, setRole } = useAuth();
  const { theme, setTheme, country, setCountry, clocks = ["US", "IN", "AE", "IE"] } = useSettings();

  const [historyDrawerOpen, setHistoryDrawerOpen] = useState(false);
  const [profileDropdownOpen, setProfileDropdownOpen] = useState(false);
  const [clocksOverlayOpen, setClocksOverlayOpen] = useState(false);

  const handleDragEnd = (event: any, info: any) => {
    const x = info.point.x;
    const y = info.point.y;
    const w = typeof window !== "undefined" ? window.innerWidth : 1000;
    const h = typeof window !== "undefined" ? window.innerHeight : 800;

    // Snapping thresholds (e.g., within 220px of sides, 180px of bottom)
    if (x < 220) {
      setDockPosition("left");
    } else if (x > w - 220) {
      setDockPosition("right");
    } else if (y > h - 180) {
      setDockPosition("bottom");
    } else {
      setDockPosition("top");
    }
  };

  const [searchQuery, setSearchQuery] = useState("");
  const [deleteConfirmId, setDeleteConfirmId] = useState<string | null>(null);

  const profileDropdownRef = useRef<HTMLDivElement>(null);
  const [avatarError, setAvatarError] = useState(false);

  useEffect(() => {
    if (isInitialAppLoad) {
      isInitialAppLoad = false;
      createThread();
    }
  }, [createThread]);

  const activeTheme = theme === "system"
    ? (typeof window !== "undefined" && window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light")
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
      await fetch(`/api/chat/${id}`, { method: "DELETE" });
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

  // Check roles demo switcher
  const roles: Role[] = ["Employee", "HR", "IT", "PMO", "Admin", "Functional Manager", "Super Admin"];

  // Static checks for Hub items
  const hasControlHubAccess = ["HR", "IT", "PMO", "Admin", "Functional Manager", "Super Admin"].includes(user.role);

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

  const avatarEl = user.avatarUrl && !avatarError ? (
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
      {user.name.split(" ").map((n) => n[0]).join("")}
    </div>
  );

  return (
    <div className="flex h-screen w-full bg-background overflow-hidden flex-col">
      
      {/* --- PREMIUM TOP HEADER --- */}
      <header className="h-14 sm:h-16 flex items-center justify-between gap-2 px-3 sm:px-6 border-b border-border/40 bg-background/60 backdrop-blur-xl z-30 shrink-0 select-none">
        
        {/* Left Side: Brand Logo + Brand Name */}
        <div className="flex items-center gap-3">
          <Link to="/" className="flex items-center gap-2 hover:opacity-95 transition-opacity">
            <div className="relative shrink-0 flex items-center justify-center">
              <Logo size="sm" />
              <motion.div
                className="absolute -inset-1 rounded-xl opacity-30 blur-sm pointer-events-none"
                style={{ background: "var(--gradient-primary)" }}
                animate={{ opacity: [0.2, 0.4, 0.2] }}
                transition={{ duration: 3, repeat: Infinity }}
              />
            </div>
            <BrandName className="text-sm font-bold tracking-tight text-foreground" withAI={true} />
          </Link>
        </div>

        {/* Center: navigation dock during conversations (desktop), Office Clocks otherwise.
            During a chat the nav lives here — visible but out of the conversation's way —
            instead of the old floating pill pinned to the left edge of the screen. */}
        <div className="flex min-w-0 items-center justify-center">
          <button
            onClick={() => setClocksOverlayOpen(true)}
            className={cn(
              "hidden sm:flex group relative items-center gap-2 rounded-full border border-border/50 bg-muted/40 hover:bg-muted/70 hover:border-primary/30 px-3 sm:px-3.5 py-1 text-xs font-semibold text-foreground/80 hover:text-foreground transition-all shrink-0 cursor-pointer shadow-sm hover:shadow-md",
              showHeaderNav && "md:hidden"
            )}
          >
            <span className="relative flex h-2 w-2">
              <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75"></span>
              <span className="relative inline-flex rounded-full h-2 w-2 bg-emerald-500"></span>
            </span>
            <Globe className="h-4 w-4 text-primary animate-spin-slow group-hover:scale-110 transition-transform" style={{ animationDuration: '12s' }} />
            <span className="hidden sm:inline">Office Clocks</span>
            <ChevronDown className="h-3 w-3 opacity-60 group-hover:translate-y-0.5 transition-transform" />
          </button>
        </div>

        {/* Right Side: Theme, Announcement, History drawer toggle, User profile role switcher */}
        <div className="flex items-center gap-1.5 sm:gap-2 shrink-0">
          {/* Notifications / Announcements banner inside Header */}
          <div className="hidden md:block">
            <AnnouncementBanner variant="topbar" />
          </div>

          {/* Compact Office Clocks — only while the chat nav occupies the header center */}
          {showHeaderNav && (
            <button
              onClick={() => setClocksOverlayOpen(true)}
              className="hidden md:flex h-9 w-9 items-center justify-center rounded-xl border border-border/50 bg-muted/40 hover:bg-muted/70 text-foreground transition-all cursor-pointer shadow-sm"
              title="Office Clocks"
            >
              <Globe className="h-4 w-4 text-primary" />
            </button>
          )}

          {/* Theme Toggle */}
          <button
            onClick={handleThemeToggle}
            className="hidden sm:flex h-9 w-9 items-center justify-center rounded-xl border border-border/50 bg-muted/40 hover:bg-muted/70 text-foreground transition-all cursor-pointer shadow-sm"
            title="Toggle Theme"
          >
            {activeTheme === "dark" ? <Sun className="h-4 w-4 text-amber-400" /> : <Moon className="h-4 w-4 text-indigo-400" />}
          </button>

          {/* History Toggle */}
          <button
            onClick={() => setHistoryDrawerOpen(!historyDrawerOpen)}
            className={cn(
              "flex h-9 w-9 items-center justify-center rounded-xl border transition-all cursor-pointer shadow-sm",
              historyDrawerOpen
                ? "border-primary/30 bg-primary/10 text-primary"
                : "border-border/50 bg-muted/40 hover:bg-muted/70 text-foreground"
            )}
            title="Recent Chats"
          >
            <MessageSquare className="h-4 w-4" />
          </button>

          {/* Profile Switcher Dropdown */}
          <div className="relative" ref={profileDropdownRef}>
            <button
              onClick={() => setProfileDropdownOpen(!profileDropdownOpen)}
              className="flex items-center gap-2 rounded-xl border border-border/50 bg-muted/40 hover:bg-muted/70 p-1 pr-2 text-xs font-medium text-foreground transition-all shrink-0 cursor-pointer shadow-sm"
            >
              {avatarEl}
              <ChevronDown className={cn("h-3 w-3 opacity-55 transition-transform duration-200", profileDropdownOpen && "rotate-180")} />
            </button>

            <AnimatePresence>
              {profileDropdownOpen && (
                <motion.div
                  initial={{ opacity: 0, y: 10, scale: 0.95 }}
                  animate={{ opacity: 1, y: 0, scale: 1 }}
                  exit={{ opacity: 0, y: 10, scale: 0.95 }}
                  transition={{ duration: 0.15, ease: [0.16, 1, 0.3, 1] }}
                  className="absolute right-0 mt-2 w-54 z-50 rounded-2xl border border-border/60 bg-popover/95 backdrop-blur-xl p-2 shadow-2xl"
                  style={{ minWidth: "210px" }}
                >
                  <div className="px-3 py-1.5 border-b border-border/40 mb-1.5 flex flex-col">
                    <span className="text-xs font-bold text-foreground truncate">{user.name}</span>
                    <span className="text-[10px] text-muted-foreground truncate font-medium">{user.role}</span>
                  </div>

                  <div className="px-3 py-1 flex items-center gap-1.5 mb-1">
                    <Sparkles className="h-3 w-3 text-primary" />
                    <span className="text-[9px] font-bold uppercase tracking-[0.12em] text-muted-foreground/60">
                      Switch Role (Demo)
                    </span>
                  </div>

                  <div className="space-y-0.5 max-h-56 overflow-y-auto no-scrollbar">
                    {roles.map((r) => {
                      const meta = ROLE_META[r];
                      const RIcon = meta.icon;
                      const isSelected = user.role === r;
                      return (
                        <button
                          key={r}
                          onClick={() => {
                            setRole(r);
                            setProfileDropdownOpen(false);
                          }}
                          className={cn(
                            "flex w-full items-center gap-2.5 rounded-xl px-2.5 py-1.5 text-xs transition-all text-left",
                            isSelected
                              ? "bg-primary/10 text-primary font-semibold"
                              : "text-foreground/75 hover:bg-muted/65 hover:text-foreground"
                          )}
                        >
                          <RIcon className={cn("h-3.5 w-3.5", meta.color)} />
                          <span className="flex-1 truncate">{r}</span>
                          {isSelected && <Check className="h-3.5 w-3.5 text-primary shrink-0" />}
                        </button>
                      );
                    })}
                  </div>

                  <div className="border-t border-border/40 mt-1.5 pt-1.5">
                    <button
                      onClick={() => {
                        logout();
                        setProfileDropdownOpen(false);
                      }}
                      className="flex w-full items-center gap-2.5 rounded-xl px-2.5 py-1.5 text-xs text-rose-500 hover:bg-rose-500/10 transition-all text-left font-medium"
                    >
                      <LogOut className="h-3.5 w-3.5" />
                      <span>Sign Out</span>
                    </button>
                  </div>
                </motion.div>
              )}
            </AnimatePresence>
          </div>
        </div>
      </header>

      {/* --- MAIN WORKSPACE --- */}
      <main className="flex-1 w-full min-h-0 relative z-0 pb-20 md:pb-0 overflow-hidden">
        <Outlet />
      </main>

      {/* --- RECENT CHATS DRAWER --- */}
      <AnimatePresence>
        {historyDrawerOpen && (
          <>
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 0.4 }}
              exit={{ opacity: 0 }}
              onClick={() => setHistoryDrawerOpen(false)}
              className="fixed inset-0 bg-black z-40 backdrop-blur-xs"
            />
            <motion.div
              initial={{ x: "100%" }}
              animate={{ x: 0 }}
              exit={{ x: "100%" }}
              transition={{ type: "spring", stiffness: 300, damping: 30 }}
              className="fixed inset-y-0 right-0 w-80 bg-background/95 backdrop-blur-xl border-l border-border/80 shadow-2xl z-50 flex flex-col p-4 pt-6"
            >
              <div className="flex items-center justify-between mb-4 mt-1">
                <h3 className="text-xs font-bold text-foreground flex items-center gap-2 uppercase tracking-wider text-muted-foreground/80">
                  <MessageSquare className="h-4 w-4 text-primary" />
                  <span>Recent Conversations</span>
                </h3>
                <button
                  onClick={() => setHistoryDrawerOpen(false)}
                  className="p-1.5 rounded-xl text-muted-foreground hover:bg-muted hover:text-foreground transition-all cursor-pointer"
                >
                  <X className="h-4 w-4" />
                </button>
              </div>

              <button
                onClick={() => {
                  createThread();
                  setHistoryDrawerOpen(false);
                }}
                className="mb-4 flex items-center justify-center gap-2 w-full py-2.5 px-4 rounded-xl border border-primary/20 bg-primary/10 text-primary hover:bg-primary/20 text-xs font-semibold transition-all cursor-pointer"
              >
                <Plus className="h-4 w-4" />
                <span>New Conversation</span>
              </button>

              <div className="relative flex items-center mb-4">
                <Search className="absolute left-3 h-3.5 w-3.5 text-muted-foreground pointer-events-none" />
                <input
                  type="text"
                  placeholder="Search chats..."
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  className="w-full bg-muted/40 border border-border/50 hover:border-primary/20 focus:border-primary/40 focus:bg-background text-xs text-foreground placeholder:text-muted-foreground/60 rounded-xl pl-9 pr-8 py-2 focus:outline-none transition-all"
                />
                {searchQuery && (
                  <button
                    onClick={() => setSearchQuery("")}
                    className="absolute right-2.5 p-1 rounded-md text-muted-foreground/60 hover:text-foreground hover:bg-muted/50 transition-all cursor-pointer"
                  >
                    <X className="h-3 w-3" />
                  </button>
                )}
              </div>

              <div className="flex-1 overflow-y-auto no-scrollbar space-y-1 pr-0.5">
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
                      <div className="text-center py-8 text-xs text-muted-foreground/65">
                        {searchQuery ? "No matching chats found" : "No recent chats"}
                      </div>
                    );
                  }

                  return filteredThreads.map((thread) => {
                    const active = activeId === thread.id;
                    const title = thread.turns[0]?.text || "New Chat";
                    return (
                      <div
                        key={thread.id}
                        onClick={() => {
                          setActiveId(thread.id);
                          setHistoryDrawerOpen(false);
                        }}
                        className={cn(
                          "group flex items-center gap-2.5 rounded-xl px-3 py-2.5 text-xs font-medium cursor-pointer transition-all border border-transparent",
                          active
                            ? "bg-primary/10 text-primary font-semibold border-primary/20"
                            : "text-foreground/75 hover:bg-muted/40 hover:text-foreground"
                        )}
                      >
                        <MessageSquare className={cn("h-3.5 w-3.5 shrink-0", active ? "text-primary" : "text-muted-foreground/70")} />
                        <span className="truncate flex-1 text-left">{title}</span>
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            handleDelete(thread.id);
                          }}
                          className="opacity-0 group-hover:opacity-100 p-1 rounded-lg text-muted-foreground hover:bg-rose-500/10 hover:text-rose-500 transition-all shrink-0 cursor-pointer"
                          title="Delete conversation"
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                        </button>
                      </div>
                    );
                  });
                })()}
              </div>
            </motion.div>
          </>
        )}
      </AnimatePresence>

      {/* --- DESKTOP NAVIGATION DOCK ---
          During conversations the nav lives in the header center instead — no floating pill
          competing with the chat. */}
      {!showHeaderNav && (
        /* Horizontal floating dock at bottom center (when landing screen or other pages) */
        <div className="hidden md:flex fixed bottom-6 left-1/2 -translate-x-1/2 z-40 bg-background/85 backdrop-blur-xl border border-border/60 shadow-2xl rounded-2xl px-4 py-2.5 items-center gap-3 select-none">
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
                  title={item.label}
                  className={cn(
                    "group relative flex items-center gap-2 px-3.5 py-2 rounded-xl text-xs font-semibold transition-all duration-200 cursor-pointer",
                    active ? "text-foreground font-bold" : "text-muted-foreground hover:text-foreground"
                  )}
                  style={active ? {
                    background: `color-mix(in oklab, ${accentColor} 12%, transparent)`,
                    boxShadow: `inset 0 0 0 1px color-mix(in oklab, ${accentColor} 15%, transparent)`,
                  } : undefined}
                >
                  {active && (
                    <motion.div
                      layoutId="dock-active-dot-desktop"
                      className="absolute -top-1.5 left-1/2 -translate-x-1/2 h-1 w-1 rounded-full"
                      style={{
                        background: accentColor,
                        boxShadow: `0 0 8px ${accentColor}`,
                      }}
                      transition={{ type: "spring", stiffness: 300, damping: 20 }}
                    />
                  )}
                  <Icon
                    className="h-[18px] w-[18px] shrink-0 transition-transform duration-200 group-hover:scale-110"
                    style={{ color: active ? accentColor : "inherit" }}
                  />
                  <span>{item.label}</span>
                </Link>
              );
            })}
        </div>
      )}

      {/* --- BOTTOM FLOATING NAVIGATION DOCK (MOBILE) --- */}
      <div className="flex md:hidden fixed bottom-0 inset-x-0 z-40 bg-background/90 backdrop-blur-xl border-t border-border/60 justify-around py-1.5 px-1 select-none" style={{ paddingBottom: 'max(env(safe-area-inset-bottom, 0px), 6px)' }}>
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
                title={item.label}
                className={cn(
                  "group relative flex flex-col items-center justify-center gap-0.5 px-2 py-1.5 rounded-xl text-[10px] font-semibold transition-all duration-200 cursor-pointer min-w-[44px] flex-1 max-w-[80px]",
                  active ? "text-foreground font-bold" : "text-muted-foreground hover:text-foreground"
                )}
                style={active ? {
                  background: `color-mix(in oklab, ${accentColor} 12%, transparent)`,
                  boxShadow: `inset 0 0 0 1px color-mix(in oklab, ${accentColor} 15%, transparent)`,
                } : undefined}
              >
                {active && (
                  <motion.div
                    layoutId="dock-active-dot-mobile"
                    className="absolute -top-1 left-1/2 -translate-x-1/2 h-1 w-1 rounded-full"
                    style={{
                      background: accentColor,
                      boxShadow: `0 0 8px ${accentColor}`,
                    }}
                    transition={{ type: "spring", stiffness: 300, damping: 20 }}
                  />
                )}
                <Icon
                  className="h-[18px] w-[18px] shrink-0"
                  style={{ color: active ? accentColor : "inherit" }}
                />
                <span className="mt-0.5 text-[9px] truncate max-w-[60px] leading-tight text-center">{item.label}</span>
              </Link>
            );
          })}
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
              className="relative bg-background/85 border border-border/80 shadow-2xl p-6 md:p-8 rounded-3xl max-w-4xl w-full z-10 overflow-hidden"
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
                  <Globe className="h-3.5 w-3.5 animate-spin-slow" style={{ animationDuration: "10s" }} />
                  <span>Interactive Workspace Clocks</span>
                </div>
                <h2 className="text-xl md:text-2xl font-bold tracking-tight text-foreground">
                  Global Office Time Orbit
                </h2>
                <p className="text-xs md:text-sm text-muted-foreground max-w-md mx-auto mt-1">
                  Real-time dial sweeping and local timezone gradients across US, Ireland, Dubai, and India.
                </p>
              </div>

              {/* Clocks Grid */}
              <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-4 gap-4 md:gap-5 mt-4">
                {(() => {
                  const targetCodes = ["US", "IE", "AE", "IN"];
                  const targetCountries = COUNTRIES.filter((c) => targetCodes.includes(c.code));
                  const orderedCountries = [
                    targetCountries.find((c) => c.code === "US"),
                    targetCountries.find((c) => c.code === "IE"),
                    targetCountries.find((c) => c.code === "AE"),
                    targetCountries.find((c) => c.code === "IN"),
                  ].filter(Boolean);

                  return orderedCountries.map((c) => (
                    <TimezoneOrbitClockCard key={c?.code} country={c} />
                  ));
                })()}
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      {/* --- FLOATING OFFICE RUNNER MASCOT --- */}
      {theme && location.pathname === "/" && (
        <div className="fixed bottom-20 md:bottom-28 right-4 md:right-8 z-40">
          <SittingBuddy />
        </div>
      )}

      {/* --- DRAGGABLE DESKTOP NAVIGATION DOCK FOR HOME PAGE --- */}
      {showHeaderNav && (
        <div className={cn(
          "hidden md:flex fixed z-50 pointer-events-none",
          dockPosition === "top" && "top-[72px] left-0 right-0 justify-center",
          dockPosition === "bottom" && "bottom-6 left-0 right-0 justify-center",
          dockPosition === "left" && "left-3 top-0 bottom-0 items-center",
          dockPosition === "right" && "right-3 top-0 bottom-0 items-center"
        )}>
          <motion.nav
            drag
            dragMomentum={false}
            dragElastic={0.05}
            onDragEnd={handleDragEnd}
            animate={{ x: 0, y: 0 }}
            transition={{ type: "spring", stiffness: 300, damping: 28 }}
            whileDrag={{ scale: 1.03, cursor: "grabbing", opacity: 0.95 }}
            className={cn(
              "flex border border-border/60 bg-background/85 backdrop-blur-xl p-1 cursor-grab active:cursor-grabbing pointer-events-auto select-none shadow-xl hover:shadow-2xl transition-shadow rounded-2xl gap-1",
              (dockPosition === "top" || dockPosition === "bottom") ? "flex-row items-center" : "flex-col py-2 items-stretch"
            )}
          >
            {/* Drag handle indicator */}
            <div className={cn(
              "flex items-center justify-center opacity-30 shrink-0",
              (dockPosition === "top" || dockPosition === "bottom") ? "w-4 h-4" : "w-4 h-4 mx-auto"
            )}>
              <div className={cn(
                "rounded-full bg-foreground/60",
                (dockPosition === "top" || dockPosition === "bottom") ? "w-1 h-5" : "w-5 h-1"
              )} />
            </div>

            {navItems
              .filter((n) => n.show)
              .map((item) => {
                const Icon = item.icon;
                const active = isActive(item.to);
                const accentColor = NAV_COLORS[item.to] || "var(--clarity)";
                const isVertical = dockPosition === "left" || dockPosition === "right";
                return (
                  <Link
                    key={item.to}
                    to={item.to}
                    className={cn(
                      "group relative flex items-center gap-2 rounded-xl transition-all duration-200 cursor-pointer shrink-0 select-none",
                      isVertical ? "flex-row px-3 py-2 justify-start" : "flex-row px-3 h-8",
                      active ? "text-foreground font-semibold" : "text-muted-foreground hover:text-foreground hover:bg-muted/65"
                    )}
                    style={active ? {
                      background: `color-mix(in oklab, ${accentColor} 12%, transparent)`,
                      boxShadow: `inset 0 0 0 1px color-mix(in oklab, ${accentColor} 15%, transparent)`,
                    } : undefined}
                  >
                    {active && (
                      <motion.div
                        layoutId="dock-active-dot-desktop"
                        className={cn(
                          "absolute rounded-full",
                          (dockPosition === "top" || dockPosition === "bottom") && "-bottom-0.5 left-1/2 -translate-x-1/2 h-1 w-1",
                          dockPosition === "left" && "-left-0.5 top-1/2 -translate-y-1/2 h-1 w-1",
                          dockPosition === "right" && "-right-0.5 top-1/2 -translate-y-1/2 h-1 w-1"
                        )}
                        style={{
                          background: accentColor,
                          boxShadow: `0 0 8px ${accentColor}`,
                        }}
                        transition={{ type: "spring", stiffness: 300, damping: 20 }}
                      />
                    )}
                    <Icon
                      className="h-3.5 w-3.5 shrink-0 transition-transform duration-200 group-hover:scale-110"
                      style={{ color: active ? accentColor : "inherit" }}
                    />
                    <span className="text-[11px] tracking-tight whitespace-nowrap">{item.label}</span>
                  </Link>
                );
              })}
          </motion.nav>
        </div>
      )}

      {/* --- COMMAND PALETTE --- */}
      <CommandPalette open={commandOpen} onClose={() => setCommandOpen(false)} />

      {/* --- DELETE CONFIRMATION DIALOG --- */}
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

    </div>
  );
}
