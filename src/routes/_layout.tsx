import { createFileRoute, Outlet } from "@tanstack/react-router";
import { Sidebar } from "@/components/Sidebar";
import { Logo } from "@/components/Logo";
import { BrandName } from "@/components/BrandName";
import { Menu, Search } from "lucide-react";
import { useState, useEffect, useCallback } from "react";
import { ThemeToggle } from "@/components/ThemeToggle";
import { useAuth } from "@/lib/auth-store";
import { motion, AnimatePresence } from "framer-motion";
import { CommandPalette } from "@/components/CommandPalette";
import { AnnouncementBanner } from "@/components/assistant/AnnouncementBanner";

export const Route = createFileRoute("/_layout")({
  component: LayoutComponent,
});

function LayoutComponent() {
  const [mobileOpen, setMobileOpen] = useState(false);
  const [commandOpen, setCommandOpen] = useState(false);
  const { user } = useAuth();

  // Cmd/Ctrl+K shortcut
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === "k") {
        e.preventDefault();
        setCommandOpen((v) => !v);
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
        <div className="ml-auto flex items-center gap-1">
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

          {/* Search trigger */}
          <button
            onClick={() => setCommandOpen(true)}
            className="flex items-center gap-2.5 h-8 rounded-xl border border-border bg-muted/40 px-3 text-[12px] text-muted-foreground hover:bg-muted/70 hover:text-foreground transition-all mr-3 min-w-[200px]"
          >
            <Search className="h-3.5 w-3.5 shrink-0" />
            <span className="flex-1 text-left">Search or ask...</span>
          </button>

          {/* Notifications */}
          <AnnouncementBanner variant="topbar" />

          {/* Theme toggle */}
          <ThemeToggle />

          {/* User avatar */}
          {user && (
            <div className="ml-2 flex h-7 w-7 items-center justify-center rounded-full bg-primary/10 text-[11px] font-bold text-primary ring-1 ring-primary/20 overflow-hidden">
              {user.avatarUrl ? (
                <img src={user.avatarUrl} alt={user.name} className="h-full w-full object-cover" />
              ) : (
                user.name.split(" ").map(n => n[0]).join("")
              )}
            </div>
          )}
        </motion.header>

        <Outlet />
      </main>

      {/* Command Palette */}
      <CommandPalette open={commandOpen} onClose={() => setCommandOpen(false)} />
    </div>
  );
}
