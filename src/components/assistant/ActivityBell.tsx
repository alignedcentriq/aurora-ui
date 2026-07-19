import { useEffect, useState, useCallback } from "react";
import { History, UserCog, KeyRound, Workflow, Settings2 } from "lucide-react";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { useAuth } from "@/lib/auth-store";
import { AnimatePresence, motion } from "framer-motion";
import { cn } from "@/lib/utils";

interface ActivityEntry {
  id: number;
  actor_email: string;
  actor_name: string | null;
  category: string;
  action_type: string;
  severity: string;
  target_type: string | null;
  target_id: string | null;
  target_name: string | null;
  summary: string;
  created_at: string | null;
}

const LAST_SEEN_KEY = "activity_last_seen_at";

const CATEGORY_ICON: Record<string, typeof History> = {
  role_assignment: UserCog,
  role_definition: UserCog,
  access_grant: KeyRound,
  automation: Workflow,
  settings: Settings2,
};

function timeAgo(iso: string | null): string {
  if (!iso) return "";
  const then = new Date(iso.endsWith("Z") ? iso : `${iso}Z`).getTime();
  const diffSec = Math.max(0, Math.round((Date.now() - then) / 1000));
  if (diffSec < 60) return "just now";
  const diffMin = Math.round(diffSec / 60);
  if (diffMin < 60) return `${diffMin}m ago`;
  const diffHr = Math.round(diffMin / 60);
  if (diffHr < 24) return `${diffHr}h ago`;
  const diffDay = Math.round(diffHr / 24);
  return `${diffDay}d ago`;
}

export function ActivityBell({ triggerClassName }: { triggerClassName?: string } = {}) {
  const { user } = useAuth();
  const [entries, setEntries] = useState<ActivityEntry[]>([]);
  const [unread, setUnread] = useState(0);
  const [open, setOpen] = useState(false);

  const visible = user?.role === "Admin" || user?.role === "Super Admin";

  const authHeaders = {
    ...(user?.email ? { "x-user-email": user.email } : {}),
    ...(user?.role ? { "x-user-role": user.role.toLowerCase() } : {}),
  };

  const load = useCallback(() => {
    if (!visible) return;
    fetch("/api/activity/feed", { headers: authHeaders })
      .then((r) => r.json())
      .then((data: { entries: ActivityEntry[] }) => {
        const list = data.entries || [];
        setEntries(list);
        const lastSeen = localStorage.getItem(LAST_SEEN_KEY);
        const cutoff = lastSeen ? new Date(lastSeen).getTime() : 0;
        setUnread(
          list.filter((e) => e.created_at && new Date(`${e.created_at}Z`).getTime() > cutoff)
            .length,
        );
      })
      .catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible, user?.email, user?.role]);

  useEffect(() => {
    load();
    const interval = setInterval(load, 60000);
    return () => clearInterval(interval);
  }, [load]);

  const handleOpenChange = (next: boolean) => {
    setOpen(next);
    if (next) {
      localStorage.setItem(LAST_SEEN_KEY, new Date().toISOString());
      setUnread(0);
    }
  };

  if (!visible) return null;

  return (
    <Sheet open={open} onOpenChange={handleOpenChange}>
      <button
        onClick={() => handleOpenChange(true)}
        className={cn(
          "relative flex h-9 w-9 items-center justify-center rounded-xl border border-border/50 bg-muted/40 hover:bg-muted/70 text-foreground transition-all cursor-pointer shadow-sm",
          triggerClassName,
        )}
        title="Activity"
      >
        <History className="h-4 w-4 text-primary" />
        {unread > 0 && (
          <span className="absolute -top-1 -right-1 flex h-4 min-w-4 items-center justify-center rounded-full bg-rose-500 px-1 text-[10px] font-semibold text-white shadow">
            {unread > 9 ? "9+" : unread}
          </span>
        )}
      </button>

      <SheetContent side="right" className="w-[26rem] sm:max-w-md flex flex-col p-0">
        <SheetHeader className="border-b border-border/60 px-5 py-4">
          <SheetTitle className="flex items-center gap-2 text-base">
            <History className="h-4 w-4 text-primary" />
            Activity
          </SheetTitle>
          <p className="text-xs text-muted-foreground">Admin &amp; system actions — last 30 days</p>
        </SheetHeader>

        <div className="flex-1 overflow-y-auto">
          {entries.length === 0 ? (
            <div className="px-5 py-12 text-center text-sm text-muted-foreground">
              No admin activity in the last 30 days.
            </div>
          ) : (
            <AnimatePresence initial={false}>
              {entries.map((e) => {
                const Icon = CATEGORY_ICON[e.category] || History;
                return (
                  <motion.div
                    key={e.id}
                    layout
                    initial={{ opacity: 0, y: -6 }}
                    animate={{ opacity: 1, y: 0 }}
                    className="flex gap-3 border-b border-border/40 px-5 py-3 last:border-b-0 hover:bg-muted/30"
                  >
                    <div
                      className={`mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-lg ${
                        e.severity === "high" ? "bg-amber-500/15" : "bg-primary/10"
                      }`}
                    >
                      <Icon
                        className={`h-4 w-4 ${e.severity === "high" ? "text-amber-500" : "text-primary"}`}
                      />
                    </div>
                    <div className="min-w-0 flex-1">
                      <p className="text-sm leading-snug text-foreground">{e.summary}</p>
                      <p className="mt-0.5 text-xs text-muted-foreground">
                        {timeAgo(e.created_at)}
                      </p>
                    </div>
                  </motion.div>
                );
              })}
            </AnimatePresence>
          )}
        </div>
      </SheetContent>
    </Sheet>
  );
}
