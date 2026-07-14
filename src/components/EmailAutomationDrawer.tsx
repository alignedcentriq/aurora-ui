import { useEffect } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { X, Zap } from "lucide-react";
import { useAutomationDrawer } from "@/lib/automation-drawer-store";
import { AutomationHub } from "@/pages/AutomationHub";
import { getCatalogForPortal } from "@/lib/automation-catalog";

export function EmailAutomationDrawer() {
  const { isOpen, portalId, portalLabel, closeDrawer } = useAutomationDrawer();

  // Close on Escape
  useEffect(() => {
    if (!isOpen) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") closeDrawer();
    };
    document.addEventListener("keydown", handler);
    return () => document.removeEventListener("keydown", handler);
  }, [isOpen, closeDrawer]);

  const relevantItems = getCatalogForPortal(portalId).filter((c) => c.portalIds.length > 0);
  const accent = relevantItems[0]?.accent ?? "#F59E0B";
  const displayLabel = portalLabel ?? "Email Automations";

  return (
    <AnimatePresence>
      {isOpen && (
        <>
          {/* Backdrop */}
          <motion.div
            key="backdrop"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.2 }}
            className="fixed inset-0 z-40 bg-black/30 backdrop-blur-[2px]"
            onClick={closeDrawer}
          />

          {/* Popup panel */}
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4 sm:p-6 pointer-events-none">
            <motion.div
              key="popup"
              initial={{ opacity: 0, scale: 0.95, y: 20 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.95, y: 20 }}
              transition={{ type: "spring", damping: 25, stiffness: 300 }}
              className="w-full max-w-3xl h-[85vh] flex flex-col bg-background/95 backdrop-blur-xl border border-white/10 shadow-2xl rounded-3xl overflow-hidden pointer-events-auto ring-1 ring-black/5 dark:ring-white/5 relative"
            >
              {/* Subtle top glow */}
              <div 
                className="absolute top-0 left-1/2 -translate-x-1/2 w-3/4 h-32 bg-gradient-to-b opacity-20 blur-3xl pointer-events-none"
                style={{ backgroundImage: `linear-gradient(to bottom, ${accent}, transparent)` }}
              />

              {/* Minimalist Header */}
              <div className="flex-shrink-0 flex items-center justify-between gap-4 px-6 py-5 z-10 border-b border-border/40">
                <div className="flex items-center gap-3 min-w-0">
                  <div
                    className="w-10 h-10 rounded-2xl flex items-center justify-center flex-shrink-0 shadow-sm"
                    style={{ backgroundColor: `${accent}15`, color: accent }}
                  >
                    <Zap className="h-5 w-5" />
                  </div>
                  <div className="min-w-0">
                    <h2 className="text-base font-semibold text-foreground tracking-tight truncate">Automations</h2>
                    <p className="text-xs text-muted-foreground/80 truncate font-medium">
                      {portalId ? displayLabel : "Global Hub"}
                    </p>
                  </div>
                </div>
                <button
                  onClick={closeDrawer}
                  className="p-2 rounded-full hover:bg-black/5 dark:hover:bg-white/10 text-muted-foreground transition-all flex-shrink-0"
                  aria-label="Close"
                >
                  <X className="h-4 w-4" />
                </button>
              </div>

              {/* Automation hub content */}
              <div className="flex-1 min-h-0 flex flex-col z-10 px-1 pb-1">
                <AutomationHub
                  portalId={portalId}
                  portalLabel={portalLabel}
                  compact
                />
              </div>
            </motion.div>
          </div>
        </>
      )}
    </AnimatePresence>
  );
}
