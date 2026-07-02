import { useEffect, useState, useCallback } from "react";
import {
  Bell,
  X,
  CalendarClock,
  AlarmClock,
  ExternalLink,
  Send,
  Loader2,
  Mail,
  MessageSquare,
  Megaphone,
  ChevronDown,
  ChevronUp,
  Trash2,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { useAuth } from "@/lib/auth-store";
import { motion, AnimatePresence } from "framer-motion";
import { flyBanner } from "@/lib/fly-banner";
import { openFormById } from "@/lib/form-trigger";
import { DynamicFormField } from "@/lib/chat-store";

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

interface ImageAction {
  type: "url" | "form" | "app";
  value: string;
  label: string;
}

interface Announcement {
  id: number;
  title: string;
  body: string;
  category: string;
  created_by: string;
  target_audience: string;
  is_active: boolean;
  image_url: string | null;
  image_action: ImageAction | null;
  expires_at: string | null;
  created_at: string;
}

const TYPE_ICON: Record<string, typeof Bell> = {
  leave_expiring: CalendarClock,
  approval_stale: AlarmClock,
  new_mail: Mail,
  new_community_post: MessageSquare,
};

const ACTION_LABEL: Record<string, string> = {
  apply_leave: "Apply now",
  nudge_manager: "Nudge manager",
};

const CATEGORY_COLORS: Record<string, string> = {
  "Policy Update": "bg-blue-500/10 text-blue-600 dark:text-blue-400",
  Holiday: "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400",
  Events: "bg-violet-500/10 text-violet-600 dark:text-violet-400",
  Hiring: "bg-amber-500/10 text-amber-600 dark:text-amber-400",
  Training: "bg-indigo-500/10 text-indigo-600 dark:text-indigo-400",
  "IT Alert": "bg-rose-500/10 text-rose-600 dark:text-rose-400",
  Activity: "bg-teal-500/10 text-teal-600 dark:text-teal-400",
  General: "bg-muted text-muted-foreground",
};

const DOMAIN_MANAGER_ROLES = new Set(["HR", "IT", "PMO", "Admin"]);

const DISMISSED_KEY = "centriq_dismissed_announcements";
const FLOWN_KEY = "centriq_flown_announcements";

function getDismissed(): number[] {
  try {
    return JSON.parse(localStorage.getItem(DISMISSED_KEY) || "[]");
  } catch {
    return [];
  }
}

function saveDismissed(ids: number[]) {
  localStorage.setItem(DISMISSED_KEY, JSON.stringify(ids));
}

function getFlown(): number[] {
  try {
    return JSON.parse(localStorage.getItem(FLOWN_KEY) || "[]");
  } catch {
    return [];
  }
}

export function ProactiveNudgeFeed() {
  const { user } = useAuth();
  const [nudges, setNudges] = useState<Nudge[]>([]);
  const [nudgesUnread, setNudgesUnread] = useState(0);
  const [open, setOpen] = useState(false);
  const [busyId, setBusyId] = useState<number | null>(null);

  const [announcements, setAnnouncements] = useState<Announcement[]>([]);
  const [dismissedAnnouncements, setDismissedAnnouncements] = useState<number[]>(getDismissed);
  const [expandedAnnouncement, setExpandedAnnouncement] = useState<number | null>(null);
  const [recallTarget, setRecallTarget] = useState<number | null>(null);

  const isDomainManager = user ? DOMAIN_MANAGER_ROLES.has(user.role) : false;

  const authHeaders = {
    ...(user?.email ? { "x-user-email": user.email } : {}),
    ...(user?.role ? { "x-user-role": user.role.toLowerCase() } : {}),
  };

  const loadNudges = useCallback(() => {
    if (!user?.email) return;
    fetch("/api/nudges", { headers: authHeaders })
      .then((r) => r.json())
      .then((data: { nudges: Nudge[]; unread: number }) => {
        setNudges(data.nudges || []);
        setNudgesUnread(data.unread || 0);
      })
      .catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user?.email, user?.role]);

  const loadAnnouncements = useCallback(() => {
    fetch("/api/announcements", { headers: authHeaders })
      .then((r) => r.json())
      .then((data: Announcement[]) => {
        const active = data.filter((a) => a.is_active);
        setAnnouncements(active);

        // Fly the jet for a newly-arrived announcement. On the very first
        // run (no flag yet) we seed silently so the existing backlog never
        // flies — only announcements that appear afterwards do.
        const seeded = localStorage.getItem(FLOWN_KEY) !== null;
        const flown = new Set(getFlown());
        const fresh = active.filter((a) => !flown.has(a.id));
        if (seeded && fresh.length > 0) {
          const newest = fresh.reduce((a, b) => (a.created_at > b.created_at ? a : b));
          flyBanner(`📣 ${newest.title}`);
        }
        localStorage.setItem(FLOWN_KEY, JSON.stringify(active.map((a) => a.id)));
      })
      .catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user?.role, user?.email]);

  useEffect(() => {
    loadNudges();
    const interval = setInterval(loadNudges, 60000); // nudges are not time-critical
    return () => clearInterval(interval);
  }, [loadNudges]);

  useEffect(() => {
    loadAnnouncements();
    const interval = setInterval(loadAnnouncements, 10000);
    return () => clearInterval(interval);
  }, [loadAnnouncements]);

  // Opening the feed marks nudges as read (announcements clear individually via dismiss).
  const handleOpenChange = (next: boolean) => {
    setOpen(next);
    if (next && nudgesUnread > 0) {
      setNudgesUnread(0);
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
        loadNudges();
      } else {
        flyBanner(`⚠ ${data?.message || "Couldn't complete that action."}`);
        loadNudges();
      }
    } catch {
      flyBanner("⚠ Network error — please try again.");
    } finally {
      setBusyId(null);
    }
  };

  const dismissNudge = async (n: Nudge) => {
    setNudges((prev) => prev.filter((x) => x.id !== n.id)); // optimistic
    fetch(`/api/nudges/${n.id}/dismiss`, { method: "POST", headers: authHeaders }).catch(() => {});
  };

  const dismissAnnouncement = (id: number) => {
    const updated = [...dismissedAnnouncements, id];
    setDismissedAnnouncements(updated);
    saveDismissed(updated);
  };

  const deleteAnnouncement = (id: number, recall: boolean) => {
    fetch(`/api/announcements/${id}?recall=${recall}`, { method: "DELETE", headers: authHeaders })
      .then(() => {
        setRecallTarget(null);
        loadAnnouncements();
      })
      .catch(() => {});
  };

  const handleImageAction = async (a: Announcement) => {
    const action = a.image_action;
    if (!action) return;
    if (action.type === "url" || action.type === "app") {
      window.open(action.value, "_blank", "noopener,noreferrer");
      return;
    }
    if (action.type === "form") {
      const formId = Number(action.value);
      try {
        const data: {
          id: number;
          name: string;
          description: string;
          fields: DynamicFormField[];
        }[] = await fetch("/api/forms/list", { headers: authHeaders }).then((r) => r.json());
        const form = data.find((f) => f.id === formId);
        if (form) {
          openFormById({
            formId: form.id,
            name: form.name,
            description: form.description,
            fields: form.fields,
            submitEndpoint: "/api/forms/submit",
          });
        }
      } catch {
        // silently ignore
      }
    }
  };

  if (!user?.email) return null;

  const visibleAnnouncements = announcements.filter((a) => !dismissedAnnouncements.includes(a.id));
  const combinedUnread = nudgesUnread + visibleAnnouncements.length;
  const isEmpty = nudges.length === 0 && visibleAnnouncements.length === 0;

  return (
    <Popover open={open} onOpenChange={handleOpenChange}>
      <PopoverTrigger asChild>
        <button
          className="relative flex h-9 w-9 items-center justify-center rounded-xl border border-border/50 bg-muted/40 hover:bg-muted/70 text-foreground transition-all cursor-pointer shadow-sm"
          title="Notifications"
        >
          <Bell className="h-4 w-4 text-primary" />
          {combinedUnread > 0 && (
            <span className="absolute -top-1 -right-1 flex h-4 min-w-4 items-center justify-center rounded-full bg-rose-500 px-1 text-[10px] font-semibold text-white shadow">
              {combinedUnread > 9 ? "9+" : combinedUnread}
            </span>
          )}
        </button>
      </PopoverTrigger>

      <PopoverContent align="end" className="w-[24rem] p-0 overflow-hidden relative">
        <div className="flex items-center justify-between border-b border-border/60 px-4 py-3">
          <div className="flex items-center gap-2">
            <Bell className="h-4 w-4 text-primary" />
            <span className="text-sm font-semibold">Notifications</span>
          </div>
          <span className="text-xs text-muted-foreground">
            {nudges.length + visibleAnnouncements.length} active
          </span>
        </div>

        <div className="max-h-[28rem] overflow-y-auto">
          {isEmpty ? (
            <div className="px-4 py-10 text-center text-sm text-muted-foreground">
              You're all caught up — nothing needs your attention.
            </div>
          ) : (
            <>
              {visibleAnnouncements.length > 0 && (
                <div className="px-4 pt-3 pb-1 text-[10px] font-bold uppercase tracking-wider text-muted-foreground">
                  Announcements
                </div>
              )}
              <AnimatePresence initial={false}>
                {visibleAnnouncements.map((a) => {
                  const isExpanded = expandedAnnouncement === a.id;
                  const colorClass = CATEGORY_COLORS[a.category] ?? CATEGORY_COLORS.General;
                  return (
                    <motion.div
                      key={`a-${a.id}`}
                      layout
                      initial={{ opacity: 0, y: -6 }}
                      animate={{ opacity: 1, y: 0 }}
                      exit={{ opacity: 0, height: 0 }}
                      className="group relative border-b border-border/40 px-4 py-3 last:border-b-0 hover:bg-muted/30"
                    >
                      <div className="flex items-start justify-between gap-2">
                        <div className="flex flex-1 items-center gap-2 min-w-0">
                          <div className="flex h-6 w-6 items-center justify-center rounded-full bg-primary/10 shrink-0">
                            <Megaphone className="h-3 w-3 text-primary" />
                          </div>
                          <span className="text-sm font-medium truncate">{a.title}</span>
                        </div>
                        <div className="flex items-center gap-1 shrink-0">
                          <button
                            onClick={() => setExpandedAnnouncement(isExpanded ? null : a.id)}
                            className="flex h-6 w-6 items-center justify-center rounded text-muted-foreground/60 hover:bg-muted hover:text-foreground transition-colors"
                          >
                            {isExpanded ? (
                              <ChevronUp className="h-3.5 w-3.5" />
                            ) : (
                              <ChevronDown className="h-3.5 w-3.5" />
                            )}
                          </button>
                          {isDomainManager ? (
                            <button
                              onClick={() => setRecallTarget(a.id)}
                              className="flex h-6 w-6 items-center justify-center rounded text-muted-foreground/60 hover:bg-rose-500/10 hover:text-rose-500 transition-colors"
                              title="Delete for everyone"
                            >
                              <Trash2 className="h-3.5 w-3.5" />
                            </button>
                          ) : (
                            <button
                              onClick={() => dismissAnnouncement(a.id)}
                              className="flex h-6 w-6 items-center justify-center rounded text-muted-foreground/60 hover:bg-muted hover:text-foreground transition-colors"
                              title="Dismiss"
                            >
                              <X className="h-3.5 w-3.5" />
                            </button>
                          )}
                        </div>
                      </div>
                      <div className="mt-1.5 pl-8">
                        <span
                          className={cn(
                            "rounded px-2 py-0.5 text-[10px] font-semibold tracking-wider",
                            colorClass,
                          )}
                        >
                          {a.category}
                        </span>
                      </div>
                      <AnimatePresence>
                        {isExpanded && (
                          <motion.div
                            initial={{ opacity: 0, height: 0 }}
                            animate={{ opacity: 1, height: "auto" }}
                            exit={{ opacity: 0, height: 0 }}
                            transition={{ duration: 0.2 }}
                            className="overflow-hidden"
                          >
                            <div className="mt-2 pl-8 space-y-2">
                              {a.image_url && (
                                <img
                                  src={a.image_url}
                                  alt="Announcement"
                                  onClick={a.image_action ? () => handleImageAction(a) : undefined}
                                  className={cn(
                                    "w-full rounded-lg object-cover max-h-36",
                                    a.image_action &&
                                      "cursor-pointer hover:opacity-90 transition-opacity",
                                  )}
                                  onError={(e) => {
                                    (e.target as HTMLImageElement).style.display = "none";
                                  }}
                                />
                              )}
                              <p className="text-xs text-muted-foreground leading-relaxed max-h-48 overflow-y-auto whitespace-pre-wrap">
                                {a.body}
                              </p>
                            </div>
                          </motion.div>
                        )}
                      </AnimatePresence>
                    </motion.div>
                  );
                })}
              </AnimatePresence>

              {nudges.length > 0 && (
                <div className="px-4 pt-3 pb-1 text-[10px] font-bold uppercase tracking-wider text-muted-foreground">
                  Nudges
                </div>
              )}
              <AnimatePresence initial={false}>
                {nudges.map((n) => {
                  const Icon = TYPE_ICON[n.nudge_type] || Bell;
                  return (
                    <motion.div
                      key={`n-${n.id}`}
                      layout
                      initial={{ opacity: 0, y: -6 }}
                      animate={{ opacity: 1, y: 0 }}
                      exit={{ opacity: 0, height: 0 }}
                      className="group relative border-b border-border/40 px-4 py-3 last:border-b-0 hover:bg-muted/30"
                    >
                      <button
                        onClick={() => dismissNudge(n)}
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
            </>
          )}
        </div>

        {/* Recall confirm (announcements only) */}
        {recallTarget !== null && (
          <div className="absolute inset-0 z-10 flex items-center justify-center rounded-2xl bg-background/95 backdrop-blur-sm p-4">
            <div className="w-full space-y-3">
              <p className="text-sm font-semibold">Delete Announcement</p>
              <p className="text-xs text-muted-foreground">
                Also recall the email sent to recipients?
              </p>
              <div className="flex flex-col gap-2">
                <button
                  onClick={() => deleteAnnouncement(recallTarget, true)}
                  className="w-full rounded-xl bg-rose-600 px-3 py-2 text-xs font-semibold text-white hover:bg-rose-700 transition-colors"
                >
                  Delete &amp; Recall Email
                </button>
                <button
                  onClick={() => deleteAnnouncement(recallTarget, false)}
                  className="w-full rounded-xl border border-border px-3 py-2 text-xs font-medium text-foreground/80 hover:bg-muted transition-colors"
                >
                  Delete Only
                </button>
                <button
                  onClick={() => setRecallTarget(null)}
                  className="w-full rounded-xl px-3 py-1.5 text-[11px] text-muted-foreground hover:text-foreground transition-colors"
                >
                  Cancel
                </button>
              </div>
            </div>
          </div>
        )}
      </PopoverContent>
    </Popover>
  );
}
