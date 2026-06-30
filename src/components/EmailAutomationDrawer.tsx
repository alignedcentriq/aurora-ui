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
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4 pointer-events-none">
            <motion.div
              key="popup"
              initial={{ opacity: 0, scale: 0.97, y: 15 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.97, y: 15 }}
              transition={{ type: "spring", damping: 25, stiffness: 350 }}
              className="w-full max-w-2xl h-[80vh] flex flex-col bg-background border border-border shadow-2xl rounded-2xl overflow-hidden pointer-events-auto"
            >
              {/* Header */}
              <div
                className="flex-shrink-0 flex items-center justify-between gap-3 px-5 py-4 border-b border-border"
                style={{ borderTopColor: accent, borderTopWidth: 3 }}
              >
                <div className="flex items-center gap-2.5 min-w-0">
                  <div
                    className="w-8 h-8 rounded-lg flex items-center justify-center flex-shrink-0"
                    style={{ backgroundColor: `${accent}20` }}
                  >
                    <Zap className="h-4 w-4" style={{ color: accent }} />
                  </div>
                  <div className="min-w-0">
                    <h2 className="text-sm font-bold text-foreground truncate">Email Automations</h2>
                    <p className="text-[11px] text-muted-foreground truncate">
                      {portalId ? `Context: ${displayLabel}` : "All portals"}
                    </p>
                  </div>
                </div>
                <button
                  onClick={closeDrawer}
                  className="p-1.5 rounded-lg hover:bg-muted/60 text-muted-foreground transition-colors flex-shrink-0 cursor-pointer"
                  aria-label="Close"
                >
                  <X className="h-4 w-4" />
                </button>
              </div>

              {/* Automation hub content */}
              <div className="flex-1 min-h-0 flex flex-col">
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
