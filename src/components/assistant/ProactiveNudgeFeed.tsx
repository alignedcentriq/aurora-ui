import { useEffect, useState, useCallback } from "react";
import { Bell, X, CalendarClock, AlarmClock, ExternalLink, Send, Loader2 } from "lucide-react";
import { cn } from "@/lib/utils";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { useAuth } from "@/lib/auth-store";
import { motion, AnimatePresence } from "framer-motion";
import { flyBanner } from "@/lib/fly-banner";

interface Nudge {
  id: number;
  nudge_type: string;
  title: string;
  body: string;
  severity: string;
  action_type: string | null;
  action_payload: Record<string, unknown>;
  entity_type: string | null;
  entity_id: string | null;
  status: string;
  created_at: string | null;
}

const TYPE_ICON: Record<string, typeof Bell> = {
  leave_expiring: CalendarClock,
  approval_stale: AlarmClock,
};

const ACTION_LABEL: Record<string, string> = {
  apply_leave: "Apply now",
  nudge_manager: "Nudge manager",
};

export function ProactiveNudgeFeed() {
  const { user } = useAuth();
  const [nudges, setNudges] = useState<Nudge[]>([]);
  const [unread, setUnread] = useState(0);
  const [open, setOpen] = useState(false);
  const [busyId, setBusyId] = useState<number | null>(null);

  const authHeaders = {
    ...(user?.email ? { "x-user-email": user.email } : {}),
    ...(user?.role ? { "x-user-role": user.role.toLowerCase() } : {}),
  };

  const load = useCallback(() => {
    if (!user?.email) return;
    fetch("/api/nudges", { headers: authHeaders })
      .then((r) => r.json())
      .then((data: { nudges: Nudge[]; unread: number }) => {
        setNudges(data.nudges || []);
        setUnread(data.unread || 0);
      })
      .catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user?.email, user?.role]);

  useEffect(() => {
    load();
    const interval = setInterval(load, 60000); // 60s — nudges are not time-critical
    return () => clearInterval(interval);
  }, [load]);

  // Opening the feed marks everything as read.
  const handleOpenChange = (next: boolean) => {
    setOpen(next);
    if (next && unread > 0) {
      setUnread(0);
      fetch("/api/nudges/seen", {
        method: "POST",
        headers: { ...authHeaders, "Content-Type": "application/json" },
        body: JSON.stringify({}),
      }).catch(() => {});
    }
  };

  const act = async (n: Nudge) => {
    setBusyId(n.id);
    try {
      const res = await fetch(`/api/nudges/${n.id}/act`, { method: "POST", headers: authHeaders });
      const data = await res.json();
      if (data?.success) {
        if (data.action === "open_apply_form" && data.link) {
          window.open(data.link as string, "_blank", "noopener");
        }
        flyBanner(`✓ ${data.message || "Done"}`);
        load();
      } else {
        flyBanner(`⚠ ${data?.message || "Couldn't complete that action."}`);
        load();
      }
    } catch {
      flyBanner("⚠ Network error — please try again.");
    } finally {
      setBusyId(null);
    }
  };

  const dismiss = async (n: Nudge) => {
    setNudges((prev) => prev.filter((x) => x.id !== n.id)); // optimistic
    fetch(`/api/nudges/${n.id}/dismiss`, { method: "POST", headers: authHeaders }).catch(() => {});
  };

  if (!user?.email) return null;

  return (
    <Popover open={open} onOpenChange={handleOpenChange}>
      <PopoverTrigger asChild>
        <button
          className="relative flex h-9 w-9 items-center justify-center rounded-xl border border-border/50 bg-muted/40 hover:bg-muted/70 text-foreground transition-all cursor-pointer shadow-sm"
          title="Proactive nudges"
        >
          <Bell className="h-4 w-4 text-primary" />
          {unread > 0 && (
            <span className="absolute -top-1 -right-1 flex h-4 min-w-4 items-center justify-center rounded-full bg-rose-500 px-1 text-[10px] font-semibold text-white shadow">
              {unread > 9 ? "9+" : unread}
            </span>
          )}
        </button>
      </PopoverTrigger>

      <PopoverContent align="end" className="w-[22rem] p-0 overflow-hidden">
        <div className="flex items-center justify-between border-b border-border/60 px-4 py-3">
          <div className="flex items-center gap-2">
            <Bell className="h-4 w-4 text-primary" />
            <span className="text-sm font-semibold">Nudges</span>
          </div>
          <span className="text-xs text-muted-foreground">{nudges.length} active</span>
        </div>

        <div className="max-h-[26rem] overflow-y-auto">
          {nudges.length === 0 ? (
            <div className="px-4 py-10 text-center text-sm text-muted-foreground">
              You're all caught up — nothing needs your attention.
            </div>
          ) : (
            <AnimatePresence initial={false}>
              {nudges.map((n) => {
                const Icon = TYPE_ICON[n.nudge_type] || Bell;
                return (
                  <motion.div
                    key={n.id}
                    layout
                    initial={{ opacity: 0, y: -6 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0, height: 0 }}
                    className="group relative border-b border-border/40 px-4 py-3 last:border-b-0 hover:bg-muted/30"
                  >
                    <button
                      onClick={() => dismiss(n)}
                      className="absolute right-2 top-2 rounded-md p-1 text-muted-foreground/60 opacity-0 transition-opacity hover:bg-muted hover:text-foreground group-hover:opacity-100"
                      title="Dismiss"
                    >
                      <X className="h-3.5 w-3.5" />
                    </button>
                    <div className="flex gap-3 pr-5">
                      <div className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-primary/10">
                        <Icon className="h-4 w-4 text-primary" />
                      </div>
                      <div className="min-w-0 flex-1">
                        <p className="text-sm font-medium leading-snug">{n.title}</p>
                        <p className="mt-0.5 text-xs leading-relaxed text-muted-foreground">
                          {n.body}
                        </p>
                        {n.action_type && (
                          <button
                            onClick={() => act(n)}
                            disabled={busyId === n.id}
                            className="mt-2 inline-flex items-center gap-1.5 rounded-lg bg-primary px-2.5 py-1 text-xs font-medium text-primary-foreground transition-opacity hover:opacity-90 disabled:opacity-60"
                          >
                            {busyId === n.id ? (
                              <Loader2 className="h-3 w-3 animate-spin" />
                            ) : n.action_type === "nudge_manager" ? (
                              <Send className="h-3 w-3" />
                            ) : (
                              <ExternalLink className="h-3 w-3" />
                            )}
                            {ACTION_LABEL[n.action_type] || "Open"}
                          </button>
                        )}
                      </div>
                    </div>
                  </motion.div>
                );
              })}
            </AnimatePresence>
          )}
        </div>
      </PopoverContent>
    </Popover>
  );
}
