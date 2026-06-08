import { createFileRoute, Outlet, useNavigate } from "@tanstack/react-router";
import { Sidebar } from "@/components/Sidebar";
import { Logo } from "@/components/Logo";
import { BrandName } from "@/components/BrandName";
import { Menu, Search, Trash2, Globe, ChevronDown, Sun, Moon } from "lucide-react";
import { useState, useEffect, useRef } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { CommandPalette } from "@/components/CommandPalette";
import { AnnouncementBanner } from "@/components/assistant/AnnouncementBanner";
import { useQuickQueries } from "@/hooks/useQuickQueries";
import { ICON_MAP, QUERY_CATEGORY_LABELS } from "@/lib/quickQueries";
import { useChatStore } from "@/lib/chat-store";
import { useSettings, COUNTRIES, detectCountryFromTimezone } from "@/lib/settings-store";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/_layout")({
  component: LayoutComponent,
});

let isInitialAppLoad = true;

function LayoutComponent() {
  const [mobileOpen, setMobileOpen] = useState(false);
  const [commandOpen, setCommandOpen] = useState(false);
  const navigate = useNavigate();
  const { createThread } = useChatStore();
  const { queries, removeQuery } = useQuickQueries();
  const [searchVal, setSearchVal] = useState("");
  const [dropdownOpen, setDropdownOpen] = useState(false);
  const searchRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (isInitialAppLoad) {
      isInitialAppLoad = false;
      createThread();
    }
  }, [createThread]);

  const { theme, setTheme, country, setCountry, clocks = ["US", "IN", "AE", "IE"], toggleClock } = useSettings();

  const activeTheme = theme === "system"
    ? (typeof window !== "undefined" && window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light")
    : theme;

  const handleThemeToggle = () => {
    const targetTheme = activeTheme === "dark" ? "light" : "dark";
    setTheme(targetTheme);
  };
  const [clocksDropdownOpen, setClocksDropdownOpen] = useState(false);
  const clocksRef = useRef<HTMLDivElement>(null);

  // Auto-detect country from browser timezone on mount
  useEffect(() => {
    const detected = detectCountryFromTimezone();
    if (detected !== country) setCountry(detected);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const [timeTick, setTimeTick] = useState(new Date());

  useEffect(() => {
    const timer = setInterval(() => {
      setTimeTick(new Date());
    }, 15000);
    return () => clearInterval(timer);
  }, []);

  function getOfficeTimeAndStatus(timezone: string) {
    const now = timeTick;
    const localTimeString = now.toLocaleTimeString("en-US", {
      timeZone: timezone,
      hour: "numeric",
      minute: "2-digit",
      hour12: true,
    });

    const formatter = new Intl.DateTimeFormat("en-US", {
      timeZone: timezone,
      hour: "numeric",
      hour12: false,
      weekday: "short",
    });
    const parts = formatter.formatToParts(now);
    const hourPart = parts.find(p => p.type === "hour");
    const weekdayPart = parts.find(p => p.type === "weekday");

    const localHour = hourPart ? parseInt(hourPart.value, 10) : 12;
    const localWeekday = weekdayPart ? weekdayPart.value : "Mon";

    const isWeekend = localWeekday === "Sat" || localWeekday === "Sun";
    const isOpen = !isWeekend && localHour >= 9 && localHour < 18;

    return { time: localTimeString, isOpen };
  }

  // Click outside to close search dropdown
  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (searchRef.current && !searchRef.current.contains(e.target as Node)) {
        setDropdownOpen(false);
      }
    };
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  // Click outside to close clocks dropdown
  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      const target = e.target as Node;
      if (clocksRef.current && !clocksRef.current.contains(target)) {
        setClocksDropdownOpen(false);
      }
    };
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  const runSearchAction = (prompt: string) => {
    createThread();
    navigate({ to: "/" });
    setDropdownOpen(false);
    // Small delay so the thread is active before sending
    setTimeout(() => {
      const event = new CustomEvent("centriq:quick-action", { detail: { prompt } });
      window.dispatchEvent(event);
    }, 100);
  };

  // Cmd/Ctrl+K → command palette; Cmd/Ctrl+L → focus composer
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

  return (
    <div className="flex h-screen w-full bg-background overflow-hidden">
      {/* Mobile top bar — hidden on md+ */}
      <div className="md:hidden fixed top-0 inset-x-0 h-14 flex items-center gap-3 px-4 border-b border-border bg-background/80 backdrop-blur-xl z-30">
        <button
          onClick={() => setMobileOpen(true)}
          className="flex items-center justify-center h-8 w-8 rounded-lg text-foreground/60 hover:bg-accent hover:text-foreground transition-colors"
          aria-label="Open menu"
        >
          <Menu className="h-5 w-5" />
        </button>
        <Logo size="sm" />
        <BrandName className="text-[14px]" withAI={true} />
        <div className="ml-auto flex items-center gap-1.5">
          <button
            onClick={handleThemeToggle}
            className="flex h-8 w-8 items-center justify-center rounded-lg text-muted-foreground hover:bg-accent hover:text-foreground transition-colors cursor-pointer"
            title="Toggle Theme"
          >
            {activeTheme === "dark" ? <Sun className="h-4 w-4 text-amber-400" /> : <Moon className="h-4 w-4 text-indigo-400" />}
          </button>
          <button
            onClick={() => setCommandOpen(true)}
            className="flex h-8 w-8 items-center justify-center rounded-lg text-muted-foreground hover:bg-accent hover:text-foreground transition-colors"
          >
            <Search className="h-4 w-4" />
          </button>
        </div>
      </div>

      <Sidebar mobileOpen={mobileOpen} onMobileClose={() => setMobileOpen(false)} />

      <main className="flex-1 flex flex-col h-full overflow-hidden relative pt-14 md:pt-0">
        {/* Desktop top bar */}
        <motion.header
          initial={{ opacity: 0, y: -8 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.4, ease: [0.16, 1, 0.3, 1] }}
          className="hidden md:flex items-center h-12 px-4 border-b border-border bg-background/60 backdrop-blur-xl z-20 shrink-0"
        >
          <div className="flex-1" />

          {/* Top search bar with quick search dropdown */}
          <div className="relative mr-3 min-w-[240px]" ref={searchRef}>
            <div className="relative flex items-center">
              <Search className="absolute left-3 h-3.5 w-3.5 text-muted-foreground pointer-events-none" />
              <input
                type="text"
                value={searchVal}
                onChange={(e) => {
                  setSearchVal(e.target.value);
                  setDropdownOpen(true);
                }}
                onFocus={() => setDropdownOpen(true)}
                placeholder="Search or ask..."
                className="h-8 w-full rounded-xl border border-border bg-muted/40 pl-9 pr-3 text-[12px] text-foreground placeholder:text-muted-foreground outline-none focus:border-primary/40 focus:bg-background transition-all"
                onKeyDown={(e) => {
                  if (e.key === "Enter" && searchVal.trim()) {
                    runSearchAction(searchVal.trim());
                    setSearchVal("");
                    setDropdownOpen(false);
                  }
                }}
              />
            </div>

            <AnimatePresence>
              {dropdownOpen && (
                <motion.div
                  initial={{ opacity: 0, y: 10 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: 10 }}
                  transition={{ duration: 0.15 }}
                  className="absolute top-10 right-0 w-[340px] rounded-2xl border border-white/[0.08] dark:border-white/[0.08] bg-[#0c1222]/95 backdrop-blur-xl shadow-2xl p-3 z-50 max-h-[380px] overflow-y-auto space-y-3 no-scrollbar"
                >
                  {(() => {
                    const filtered = queries.filter(q =>
                      q.label.toLowerCase().includes(searchVal.toLowerCase()) ||
                      q.prompt.toLowerCase().includes(searchVal.toLowerCase())
                    );

                    if (filtered.length === 0) {
                      return (
                        <div className="py-6 text-center text-xs text-white/40">
                          No quick searches found
                        </div>
                      );
                    }

                    const categories = ["it", "admin", "hr"] as const;
                    return categories.map((cat) => {
                      const items = filtered.filter(q => q.category === cat);
                      if (items.length === 0) return null;

                      return (
                        <div key={cat} className="space-y-1">
                          <p className="text-[10px] font-bold uppercase tracking-wider text-white/35 px-2 py-1">
                            {QUERY_CATEGORY_LABELS[cat]}
                          </p>
                          {items.map((q) => {
                            const Icon = ICON_MAP[q.icon] || Search;
                            return (
                              <div
                                key={q.prompt}
                                className="group/item flex items-center justify-between gap-2 rounded-xl px-2 py-1.5 hover:bg-white/[0.05] transition-colors cursor-pointer text-left"
                                onClick={() => {
                                  runSearchAction(q.prompt);
                                  setSearchVal("");
                                }}
                              >
                                <div className="flex items-center gap-2.5 min-w-0">
                                  <div className="flex h-6 w-6 items-center justify-center rounded-lg bg-white/[0.06] text-white/60 shrink-0">
                                    <Icon className={`h-3.5 w-3.5 ${q.iconColor}`} />
                                  </div>
                                  <div className="min-w-0 flex-1">
                                    <p className="text-[12px] font-semibold text-white/95 truncate">
                                      {q.label}
                                    </p>
                                    <p className="text-[10px] text-white/40 truncate">
                                      {q.prompt}
                                    </p>
                                  </div>
                                </div>
                                <button
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    removeQuery(q.prompt);
                                  }}
                                  className="opacity-0 group-hover/item:opacity-100 p-1 rounded text-white/30 hover:bg-rose-500/20 hover:text-rose-400 transition-all shrink-0"
                                  title="Remove quick search"
                                >
                                  <Trash2 className="h-3.5 w-3.5" />
                                </button>
                              </div>
                            );
                          })}
                        </div>
                      );
                    });
                  })()}
                </motion.div>
              )}
            </AnimatePresence>
          </div>

          {/* Custom Clocks Dropdown */}
          <div className="relative mr-3" ref={clocksRef}>
            <button
              onClick={() => setClocksDropdownOpen(!clocksDropdownOpen)}
              className="flex items-center gap-2 rounded-xl border border-border bg-muted/40 hover:bg-muted/70 px-3 h-8 text-[12px] font-medium text-foreground transition-all shrink-0 cursor-pointer"
            >
              <Globe className="h-3.5 w-3.5 text-primary" />
              <span className="hidden sm:inline">Office Clocks</span>
              <ChevronDown className="h-3 w-3 opacity-60" />
            </button>
            <AnimatePresence>
              {clocksDropdownOpen && (
                <motion.div
                  initial={{ opacity: 0, y: 8, scale: 0.95 }}
                  animate={{ opacity: 1, y: 0, scale: 1 }}
                  exit={{ opacity: 0, y: 8, scale: 0.95 }}
                  transition={{ duration: 0.15, ease: [0.16, 1, 0.3, 1] }}
                  className="absolute top-10 right-0 w-80 rounded-2xl border border-border bg-[#0c1222]/95 backdrop-blur-xl shadow-2xl p-4 z-50 space-y-4 text-left"
                >
                  <div>
                    <span className="text-[10px] font-bold uppercase tracking-[0.14em] text-white/35">
                      Global Clocks
                    </span>
                    <div className="grid grid-cols-2 gap-2 mt-2">
                      {COUNTRIES.filter((c) => clocks.includes(c.code)).map((c) => {
                        const { time, isOpen } = getOfficeTimeAndStatus(c.timezone);
                        return (
                          <div
                            key={c.code}
                            className="flex flex-col gap-0.5 rounded-lg bg-white/[0.02] border border-white/[0.04] p-2 hover:bg-white/[0.04] transition-colors"
                          >
                            <div className="flex items-center justify-between min-w-0">
                              <span className="truncate font-semibold text-white/85 flex items-center gap-1">
                                <span className="text-xs">{c.flag}</span>
                                <span className="truncate text-[10px]">{c.name}</span>
                              </span>
                              <span className={cn(
                                "h-1.5 w-1.5 rounded-full shrink-0",
                                isOpen ? "bg-emerald-500 shadow-[0_0_4px_rgba(16,185,129,0.6)]" : "bg-zinc-600"
                              )} />
                            </div>
                            <span className="text-[10px] text-white/50 font-bold">{time}</span>
                          </div>
                        );
                      })}
                    </div>
                  </div>

                  <div className="border-t border-white/[0.08] pt-3">
                    <span className="text-[10px] font-bold uppercase tracking-[0.14em] text-white/35">
                      Manage Clocks
                    </span>
                    <div className="grid grid-cols-2 gap-x-3 gap-y-1.5 mt-2 max-h-36 overflow-y-auto pr-1 select-none no-scrollbar">
                      {COUNTRIES.map((c) => {
                        const active = clocks.includes(c.code);
                        return (
                          <label
                            key={c.code}
                            className="flex items-center gap-2 cursor-pointer py-0.5 rounded hover:bg-white/[0.03] px-1"
                          >
                            <input
                              type="checkbox"
                              checked={active}
                              onChange={() => toggleClock(c.code)}
                              className="rounded border-border bg-background text-primary focus:ring-0 focus:ring-offset-0 h-3 w-3 accent-primary"
                            />
                            <span className="text-[11px] text-white/75 flex items-center gap-1">
                              <span>{c.flag}</span>
                              <span className="truncate">{c.name}</span>
                            </span>
                          </label>
                        );
                      })}
                    </div>
                  </div>
                </motion.div>
              )}
            </AnimatePresence>
          </div>

          {/* Custom Theme Toggle */}
          <button
            onClick={handleThemeToggle}
            className="flex h-8 w-8 items-center justify-center rounded-lg border border-border bg-muted/40 hover:bg-muted/70 text-foreground transition-all cursor-pointer mr-3"
            title="Toggle Theme"
          >
            {activeTheme === "dark" ? <Sun className="h-4 w-4 text-amber-400" /> : <Moon className="h-4 w-4 text-indigo-400" />}
          </button>

          {/* Notifications */}
          <AnnouncementBanner variant="topbar" />
        </motion.header>

        <Outlet />
      </main>

      {/* Command Palette */}
      <CommandPalette open={commandOpen} onClose={() => setCommandOpen(false)} />
    </div>
  );
}
