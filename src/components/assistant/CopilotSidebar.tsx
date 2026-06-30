import { useState, useEffect, useRef } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { X, Plus, Sparkles } from "lucide-react";
import { AssistantView } from "./AssistantView";
import { Logo } from "@/components/Logo";
import { useChatStore } from "@/lib/chat-store";
import { cn } from "@/lib/utils";
import { useLocation } from "@tanstack/react-router";
import { getPortalCopilot } from "@/lib/portal-copilot";

interface Particle {
  id: number;
  x: number;
  isTop: boolean;
  size: number;
  delay: number;
  duration: number;
  targetY: number;
  targetX: number;
}

interface CopilotSidebarProps {
  isOpen: boolean;
  setIsOpen: (open: boolean) => void;
}

export function CopilotSidebar({ isOpen, setIsOpen }: CopilotSidebarProps) {
  const [shuttersOpen, setShuttersOpen] = useState(false);
  const [slamActive, setSlamActive] = useState(false);
  const [particles, setParticles] = useState<Particle[]>([]);
  const [spinActive, setSpinActive] = useState(false);

  const { createThread, setActiveId, threads, activeId } = useChatStore();
  const location = useLocation();

  // Remembers which chat thread belongs to which portal, for this sidebar session, so each
  // portal keeps its OWN conversation. Reset when the sidebar unmounts (i.e. on Chat/Settings/
  // Documents, where the copilot isn't offered).
  const portalThreadsRef = useRef<Record<string, string>>({});

  // The full-screen Chat thread that was active before the sidebar took over a portal.
  // `undefined` = the sidebar never took over (don't touch activeId on unmount). Captured once
  // so returning to the main Chat screen never shows a portal sidebar conversation.
  const mainThreadRef = useRef<string | null | undefined>(undefined);

  // Portal the sidebar is currently opened on — drives the themed header label/accent.
  // For Control Hub, also factor in the active tab (from ?tab=xxx search param) so each
  // tab gets its own theme, starters, and placeholder copy.
  const portal = getPortalCopilot(
    location.pathname,
    location.search.tab ? `tab=${location.search.tab}` : "",
  );
  const PortalIcon = portal.Icon;

  // Enriched context string passed to AssistantView and used for per-tab thread isolation.
  // "/control-hub" + "?tab=roi" → "/control-hub/roi"; other routes stay as-is.
  const enrichedPortalContext = (() => {
    if (location.pathname === "/control-hub") {
      const tab = new URLSearchParams(location.search).get("tab");
      if (tab && tab !== "overview") return `/control-hub/${tab}`;
    }
    return location.pathname;
  })();

  // Close copilot sidebar if the user navigates to a page where it isn't offered
  // (Chat, Settings, Documents).
  useEffect(() => {
    if (
      location.pathname === "/" ||
      location.pathname === "/settings" ||
      location.pathname.startsWith("/documents")
    ) {
      setIsOpen(false);
      setShuttersOpen(false);
    }
  }, [location.pathname]);

  // Keep each portal's copilot on its OWN conversation. When the sidebar is opened — or the
  // user moves to a different portal while it's open — switch to that portal's remembered
  // thread, creating a fresh one only the first time. This way a Directory chat never bleeds
  // into My Requests, yet closing and reopening the SAME portal preserves its conversation.
  useEffect(() => {
    if (!isOpen) return;
    // Capture the full-screen Chat thread once, before the sidebar swaps in a portal thread.
    if (mainThreadRef.current === undefined) {
      mainThreadRef.current = activeId;
    }
    // Each Control Hub tab gets its own conversation; other portals group by path segment.
    const key = enrichedPortalContext.replace(/^\//, "").replace(/\//g, "-") || "home";
    const remembered = portalThreadsRef.current[key];
    if (remembered && threads[remembered]) {
      // Same portal as before → restore its thread (don't start over).
      if (remembered !== activeId) setActiveId(remembered);
    } else {
      // First visit to this portal this session (or its thread was deleted) → fresh chat.
      portalThreadsRef.current[key] = createThread();
    }
    // Keyed only on open-state + route: threads/activeId are read as a snapshot (not deps) so
    // the store updates from setActiveId/createThread don't re-run — and loop — this effect.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOpen, location.pathname, location.search]);

  // On unmount (leaving to the full Chat / Settings / Documents screens), hand the shared
  // activeId back to the main Chat thread so a portal sidebar conversation never opens in full
  // chat mode. If that thread is gone, drop to null → the Chat screen auto-starts a fresh chat.
  useEffect(() => {
    return () => {
      if (mainThreadRef.current === undefined) return; // sidebar never took over → leave as-is
      const store = useChatStore.getState();
      const main = mainThreadRef.current;
      store.setActiveId(main && store.threads[main] ? main : null);
    };
  }, []);

  // Reset shutters and animation states whenever isOpen changes to true
  useEffect(() => {
    if (isOpen) {
      setShuttersOpen(false);
      setSlamActive(false);
      setParticles([]);
    }
  }, [isOpen]);

  const toggleSidebar = () => {
    if (isOpen) {
      setIsOpen(false);
    } else {
      setIsOpen(true);
      setSpinActive(true);
      setTimeout(() => setSpinActive(false), 800);
    }
  };

  // Trigger door exit animations when the sidebar container has finished sliding in
  const handleSidebarSlideComplete = () => {
    if (isOpen) {
      setShuttersOpen(true);
    }
  };

  // Trigger screen shake, border shockwaves, and dust particles
  // when shutters complete their exit animation (450ms after they start opening)
  useEffect(() => {
    if (!shuttersOpen) return;

    const timer = setTimeout(() => {
      setSlamActive(true);

      // Generate random dust/impact particles
      const newParticles: Particle[] = [];
      const particleCount = 20;

      for (let i = 0; i < particleCount; i++) {
        // Top edge slam particles (shoot down)
        newParticles.push({
          id: i,
          x: Math.random() * 100, // percentage along the top edge
          isTop: true,
          size: Math.random() * 4 + 2, // 2px to 6px
          delay: Math.random() * 0.05,
          duration: Math.random() * 0.5 + 0.4, // 0.4s to 0.9s
          targetY: Math.random() * 120 + 30, // move 30px to 150px down
          targetX: (Math.random() - 0.5) * 60, // horizontal drift
        });

        // Bottom edge slam particles (shoot up)
        newParticles.push({
          id: i + particleCount,
          x: Math.random() * 100, // percentage along the bottom edge
          isTop: false,
          size: Math.random() * 4 + 2, // 2px to 6px
          delay: Math.random() * 0.05,
          duration: Math.random() * 0.5 + 0.4,
          targetY: -(Math.random() * 120 + 30), // move up
          targetX: (Math.random() - 0.5) * 60,
        });
      }

      setParticles(newParticles);

      // Turn off container shake after 250ms
      const shakeTimeout = setTimeout(() => {
        setSlamActive(false);
      }, 250);

      // Clear particles list after fade-out completes to avoid layout bloat
      const particlesTimeout = setTimeout(() => {
        setParticles([]);
      }, 1200);

      return () => {
        clearTimeout(shakeTimeout);
        clearTimeout(particlesTimeout);
      };
    }, 450);

    return () => clearTimeout(timer);
  }, [shuttersOpen]);

  return (
    <>
      {/* Floating Action Button.
          On mobile it is lifted above the bottom navigation dock (~64px + safe area)
          so it never overlaps the dock icons; on lg+ the dock is gone, so it drops back
          to the standard bottom-right corner. */}
      <div
        className={cn(
          "fixed right-4 z-50 flex items-center justify-center lg:right-6 lg:bottom-6",
          // Only lift above the mobile dock while the drawer is closed; once it is open
          // the full-screen drawer covers the dock and the button acts as a close affordance.
          isOpen ? "bottom-6" : "bottom-24 lg:bottom-6",
        )}
      >
        {/* Pulsing shockwave ring when Copilot is active */}
        <AnimatePresence>
          {isOpen && (
            <motion.div
              initial={{ scale: 0.8, opacity: 0.6 }}
              animate={{ scale: 1.4, opacity: 0 }}
              exit={{ scale: 0.8, opacity: 0 }}
              transition={{ repeat: Infinity, duration: 2, ease: "easeOut" }}
              className="absolute inset-0 rounded-full bg-primary/30 blur-sm pointer-events-none"
            />
          )}
        </AnimatePresence>

        <motion.button
          onClick={toggleSidebar}
          whileHover={{ scale: 1.06 }}
          whileTap={{ scale: 0.94 }}
          className={cn(
            "relative flex h-14 w-14 items-center justify-center rounded-full border bg-[#0d1424]/95 border-border/85 shadow-2xl transition-all cursor-pointer overflow-hidden",
            isOpen
              ? "border-primary/50 shadow-[0_0_22px_rgba(99,102,241,0.35)]"
              : "hover:border-[#00c4bb]/60 hover:shadow-[0_0_22px_rgba(0,196,187,0.3)]",
          )}
          title="Centriq Copilot"
        >
          {/* Inner hover glowing background */}
          <div className="absolute inset-0 bg-gradient-to-tr from-primary/10 to-[#00c4bb]/10 opacity-0 hover:opacity-100 transition-opacity duration-300 pointer-events-none" />

          {/* Logo container with rotation animation */}
          <motion.div
            animate={spinActive ? { rotate: 360 } : isOpen ? { rotate: 45 } : { rotate: 0 }}
            transition={{ duration: 0.6, ease: "easeInOut" }}
            className="relative flex items-center justify-center pointer-events-none"
          >
            <Logo size="md" />
          </motion.div>
        </motion.button>
      </div>

      {/* Sidebar Drawer */}
      <AnimatePresence>
        {isOpen && (
          /* Sidebar drawer container */
          <motion.div
            initial={{ x: "100%", y: 0 }}
            animate={
              slamActive
                ? {
                    x: [0, -3, 3, -2, 2, -1, 1, 0],
                    y: [0, 2, -2, 1.5, -1.5, 0.7, -0.7, 0],
                  }
                : { x: 0, y: 0 }
            }
            exit={{ x: "100%" }}
            transition={
              slamActive
                ? { duration: 0.25, ease: "linear" }
                : { type: "spring", stiffness: 320, damping: 30 }
            }
            onAnimationComplete={handleSidebarSlideComplete}
            className="fixed inset-y-0 right-0 w-full sm:w-[480px] bg-background border-l border-border/80 shadow-2xl z-50 flex flex-col overflow-hidden"
          >
            {/* Cinematic Shutters / Doors Overlay */}
            <AnimatePresence>
              {!shuttersOpen && (
                <div className="absolute inset-0 z-50 overflow-hidden pointer-events-none">
                  {/* Top Shutter Door */}
                  <motion.div
                    key="shutter-top"
                    initial={{ y: 0 }}
                    exit={{ y: "-100%" }}
                    transition={{ duration: 0.45, ease: [0.77, 0, 0.175, 1] }}
                    className="absolute top-0 left-0 w-full h-[50%] bg-[#080d16] border-b-2 border-primary/45 z-50 flex flex-col justify-end items-center pb-4 overflow-hidden select-none pointer-events-none"
                  >
                    {/* Industrial tech detailing */}
                    <div className="absolute inset-0 bg-grid-white/[0.02] pointer-events-none" />
                    <div className="absolute inset-x-0 bottom-0 h-[1px] bg-gradient-to-r from-transparent via-primary/50 to-transparent pointer-events-none" />

                    {/* Locking Hub Top Half */}
                    <div className="w-16 h-8 border border-b-0 border-primary/30 bg-[#0d1522] rounded-t-full flex items-end justify-center overflow-hidden">
                      <div className="w-8 h-4 bg-gradient-to-b from-[#00c4bb]/40 to-transparent blur-xs rounded-t-full animate-pulse" />
                    </div>

                    <div className="text-[9px] text-[#00c4bb]/45 tracking-[0.2em] font-semibold absolute top-4 uppercase">
                      Secure AI Lock engaged
                    </div>
                  </motion.div>

                  {/* Bottom Shutter Door */}
                  <motion.div
                    key="shutter-bottom"
                    initial={{ y: 0 }}
                    exit={{ y: "100%" }}
                    transition={{ duration: 0.45, ease: [0.77, 0, 0.175, 1] }}
                    className="absolute bottom-0 left-0 w-full h-[50%] bg-[#080d16] border-t-2 border-primary/45 z-50 flex flex-col justify-start items-center pt-4 overflow-hidden select-none pointer-events-none"
                  >
                    {/* Industrial tech detailing */}
                    <div className="absolute inset-0 bg-grid-white/[0.02] pointer-events-none" />
                    <div className="absolute inset-x-0 top-0 h-[1px] bg-gradient-to-r from-transparent via-primary/50 to-transparent pointer-events-none" />

                    {/* Locking Hub Bottom Half */}
                    <div className="w-16 h-8 border border-t-0 border-primary/30 bg-[#0d1522] rounded-b-full flex items-start justify-center overflow-hidden">
                      <div className="w-8 h-4 bg-gradient-to-t from-[#00c4bb]/40 to-transparent blur-xs rounded-b-full animate-pulse" />
                    </div>

                    <div className="text-[8px] text-muted-foreground/40 font-mono tracking-wider absolute bottom-4">
                      SYSTEM MODEL: CENTRIQ-V3
                    </div>
                  </motion.div>
                </div>
              )}
            </AnimatePresence>

            {/* Shutter landing flash border glows */}
            <AnimatePresence>
              {slamActive && (
                <>
                  <motion.div
                    initial={{ opacity: 0.9, scaleY: 1 }}
                    animate={{ opacity: 0, scaleY: 0 }}
                    exit={{ opacity: 0 }}
                    transition={{ duration: 0.4 }}
                    className="absolute top-0 inset-x-0 h-4 bg-gradient-to-b from-[#00c4bb]/30 to-transparent z-40 pointer-events-none"
                  />
                  <motion.div
                    initial={{ opacity: 0.9, scaleY: 1 }}
                    animate={{ opacity: 0, scaleY: 0 }}
                    exit={{ opacity: 0 }}
                    transition={{ duration: 0.4 }}
                    className="absolute bottom-0 inset-x-0 h-4 bg-gradient-to-t from-[#00c4bb]/30 to-transparent z-40 pointer-events-none"
                  />
                </>
              )}
            </AnimatePresence>

            {/* Dust / Slam Particle System */}
            {particles.map((p) => (
              <motion.div
                key={p.id}
                initial={{
                  opacity: 0.9,
                  x: `${p.x}%`,
                  y: p.isTop ? 0 : "100vh",
                }}
                animate={{
                  opacity: 0,
                  x: `calc(${p.x}% + ${p.targetX}px)`,
                  y: p.isTop ? p.targetY : `calc(100vh + ${p.targetY}px)`,
                }}
                transition={{
                  duration: p.duration,
                  delay: p.delay,
                  ease: "easeOut",
                }}
                style={{
                  position: "absolute",
                  left: 0,
                  width: `${p.size}px`,
                  height: `${p.size}px`,
                  borderRadius: "50%",
                  background: "rgba(0, 196, 187, 0.7)",
                  boxShadow: "0 0 6px rgba(0, 196, 187, 0.75)",
                  zIndex: 45,
                  pointerEvents: "none",
                }}
              />
            ))}

            {/* Copilot Sidebar Header */}
            <div className="h-14 sm:h-16 flex items-center justify-between px-4 border-b border-border/40 bg-background/60 backdrop-blur-xl shrink-0 z-30 select-none">
              <div className="flex items-center gap-2.5">
                <div className="relative shrink-0 flex items-center justify-center">
                  <div
                    className="flex h-8 w-8 items-center justify-center rounded-xl border"
                    style={{
                      background: `color-mix(in oklab, ${portal.accent} 14%, var(--background))`,
                      borderColor: `color-mix(in oklab, ${portal.accent} 30%, transparent)`,
                    }}
                  >
                    <PortalIcon className="h-4 w-4" style={{ color: portal.accent }} />
                  </div>
                  <motion.div
                    className="absolute -inset-1 rounded-xl opacity-35 blur-sm pointer-events-none"
                    style={{ background: portal.accent }}
                    animate={{ opacity: [0.2, 0.5, 0.2] }}
                    transition={{ duration: 2.5, repeat: Infinity }}
                  />
                </div>
                <div>
                  <h3 className="text-xs font-bold text-foreground flex items-center gap-1.5 uppercase tracking-wider text-muted-foreground/90">
                    <span>{portal.label} Copilot</span>
                    <Sparkles className="h-3 w-3 animate-pulse" style={{ color: portal.accent }} />
                  </h3>
                  <p className="text-[9px] text-muted-foreground font-semibold">
                    Scoped to this workspace
                  </p>
                </div>
              </div>

              <div className="flex items-center gap-1">
                <button
                  onClick={createThread}
                  className="p-1.5 rounded-xl text-muted-foreground hover:bg-muted hover:text-foreground transition-all cursor-pointer"
                  title="New conversation"
                >
                  <Plus className="h-4.5 w-4.5" />
                </button>
                <button
                  onClick={toggleSidebar}
                  className="p-1.5 rounded-xl text-muted-foreground hover:bg-muted hover:text-rose-500 transition-all cursor-pointer"
                  title="Close Copilot"
                >
                  <X className="h-4.5 w-4.5" />
                </button>
              </div>
            </div>

            {/* Content Panel (renders the actual chat view inside the sidebar) */}
            <div className="flex-1 w-full min-h-0 relative z-20 bg-background">
              {shuttersOpen && <AssistantView isCopilot={true} portalContext={enrichedPortalContext} />}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </>
  );
}
