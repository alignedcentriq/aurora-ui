import { useEffect, useState } from "react";
import { X, Megaphone, ChevronDown, ChevronUp, Bell, Trash2 } from "lucide-react";
import { cn } from "@/lib/utils";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { useAuth } from "@/lib/auth-store";
import { motion, AnimatePresence } from "framer-motion";
import { flyBanner, subscribeFlyBanner } from "@/lib/fly-banner";
import { useSettings } from "@/lib/settings-store";
import { getBuddyGender } from "@/components/assistant/GreetingBot";
import { speakNotification } from "@/lib/speech";
import { openFormById } from "@/lib/form-trigger";
import { DynamicFormField } from "@/lib/chat-store";

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

const STORAGE_KEY = "centriq_dismissed_announcements";

function getDismissed(): number[] {
  try {
    return JSON.parse(localStorage.getItem(STORAGE_KEY) || "[]");
  } catch {
    return [];
  }
}

function saveDismissed(ids: number[]) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(ids));
}

// IDs we've already flown the celebratory jet for, so it fires once per
// announcement and never replays the existing backlog on refresh.
const FLOWN_KEY = "centriq_flown_announcements";

function getFlown(): number[] {
  try {
    return JSON.parse(localStorage.getItem(FLOWN_KEY) || "[]");
  } catch {
    return [];
  }
}

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

export function AnnouncementBanner({ variant = "sidebar" }: { variant?: "sidebar" | "topbar" }) {
  const { user } = useAuth();
  const { buddyGender } = useSettings();
  const [announcements, setAnnouncements] = useState<Announcement[]>([]);
  const [dismissed, setDismissed] = useState<number[]>(getDismissed);
  const [expanded, setExpanded] = useState<number | null>(null);
  const [recallTarget, setRecallTarget] = useState<number | null>(null);

  const isDomainManager = user ? DOMAIN_MANAGER_ROLES.has(user.role) : false;

  const authHeaders = {
    ...(user?.email ? { "x-user-email": user.email } : {}),
    ...(user?.role ? { "x-user-role": user.role.toLowerCase() } : {}),
  };

  const loadAnnouncements = () => {
    fetch("/api/announcements", { headers: authHeaders })
      .then((r) => r.json())
      .then((data: Announcement[]) => {
        const active = data.filter((a) => a.is_active);
        setAnnouncements(active);
        if (active.length > 0 && expanded === null) {
          setExpanded(active[0].id);
        }

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
  };

  useEffect(() => {
    loadAnnouncements();
    const interval = setInterval(loadAnnouncements, 10000);
    return () => clearInterval(interval);
  }, [user?.role, user?.email]);

  useEffect(() => {
    const unsubscribe = subscribeFlyBanner((item) => {
      const text = item.message.toLowerCase();
      const resolvedGender = getBuddyGender(user?.name, buddyGender);
      if (
        text.includes("approved") ||
        text.includes("released") ||
        text.includes("issued") ||
        text.includes("settled")
      ) {
        speakNotification("Your request is approved", resolvedGender);
      } else if (
        text.includes("request") ||
        text.includes("ticket") ||
        text.includes("submitted") ||
        text.includes("added") ||
        text.includes("new")
      ) {
        speakNotification("You got a new request", resolvedGender);
      }
    });
    return unsubscribe;
  }, [user?.name, buddyGender]);

  const dismiss = (id: number) => {
    const updated = [...dismissed, id];
    setDismissed(updated);
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
      const authH = {
        "x-user-email": user?.email || "",
        "x-user-role": (user?.role || "employee").toLowerCase(),
      };
      try {
        const data: {
          id: number;
          name: string;
          description: string;
          fields: DynamicFormField[];
        }[] = await fetch("/api/forms/list", { headers: authH }).then((r) => r.json());
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

  const visible = announcements.filter((a) => !dismissed.includes(a.id));
  const unreadCount = visible.length;

  return (
    <Popover>
      <PopoverTrigger asChild>
        <button
          className={cn(
            "relative flex h-8 w-8 items-center justify-center rounded-lg transition-colors",
            variant === "topbar"
              ? "text-muted-foreground hover:bg-accent hover:text-foreground"
              : "hover:bg-white/[0.08] ml-auto text-[var(--sidebar-foreground)]",
          )}
        >
          <Bell className="h-4 w-4" />
          {unreadCount > 0 && (
            <span className="absolute right-1.5 top-1.5 flex h-2 w-2 rounded-full bg-rose-500">
              <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-rose-400 opacity-75"></span>
            </span>
          )}
        </button>
      </PopoverTrigger>
      <PopoverContent
        className="w-80 p-0 border-white/[0.06] bg-[#0c1222]/95 backdrop-blur-xl shadow-2xl z-50 rounded-2xl"
        align="start"
        side="bottom"
      >
        <div className="flex items-center justify-between border-b border-white/[0.06] px-4 py-3">
          <span className="text-sm font-semibold text-white">Notifications</span>
          {unreadCount > 0 && (
            <motion.span
              initial={{ scale: 0 }}
              animate={{ scale: 1 }}
              transition={{ type: "spring", stiffness: 400, damping: 15 }}
              className="rounded-full bg-primary/20 px-2 py-0.5 text-[10px] font-medium text-primary"
            >
              {unreadCount} new
            </motion.span>
          )}
        </div>
        <div className="max-h-[400px] overflow-y-auto p-3 space-y-2 no-scrollbar">
          {visible.length === 0 ? (
            <div className="py-8 text-center text-sm text-white/40">No new notifications</div>
          ) : (
            <AnimatePresence mode="popLayout">
              {visible.map((a) => {
                const isExpanded = expanded === a.id;
                const colorClass = CATEGORY_COLORS[a.category] ?? CATEGORY_COLORS.General;
                return (
                  <motion.div
                    key={a.id}
                    layout
                    initial={{ opacity: 0, y: 8 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0, x: -20, height: 0 }}
                    transition={{ type: "spring", stiffness: 300, damping: 30 }}
                    className="flex flex-col gap-2 rounded-xl border border-white/[0.06] bg-white/[0.02] p-3 transition-colors hover:bg-white/[0.04]"
                  >
                    <div className="flex items-start justify-between gap-2">
                      <div className="flex flex-1 items-center gap-2 min-w-0">
                        <div className="flex h-6 w-6 items-center justify-center rounded-full bg-white/[0.06] shrink-0">
                          <Megaphone className="h-3 w-3 text-white/60" />
                        </div>
                        <span className="text-[13px] font-medium text-white/90 truncate">
                          {a.title}
                        </span>
                      </div>
                      <div className="flex items-center gap-1 shrink-0">
                        <button
                          onClick={() => setExpanded(isExpanded ? null : a.id)}
                          className="flex h-6 w-6 items-center justify-center rounded text-white/40 hover:bg-white/[0.08] hover:text-white transition-colors"
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
                            className="flex h-6 w-6 items-center justify-center rounded text-white/40 hover:bg-rose-500/10 hover:text-rose-400 transition-colors"
                            title="Delete for everyone"
                          >
                            <Trash2 className="h-3.5 w-3.5" />
                          </button>
                        ) : (
                          <button
                            onClick={() => dismiss(a.id)}
                            className="flex h-6 w-6 items-center justify-center rounded text-white/40 hover:bg-white/[0.08] hover:text-white/60 transition-colors"
                            title="Dismiss"
                          >
                            <X className="h-3.5 w-3.5" />
                          </button>
                        )}
                      </div>
                    </div>
                    <div className="flex items-center gap-2">
                      <span
                        className={cn(
                          "rounded px-2 py-0.5 text-[10px] font-semibold tracking-wider shrink-0",
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
                          <div className="mt-1 space-y-2">
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
                            <p className="text-[12px] text-white/60 leading-relaxed max-h-48 overflow-y-auto whitespace-pre-wrap">
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
          )}
        </div>

        {/* Recall confirm */}
        {recallTarget !== null && (
          <div className="absolute inset-0 z-10 flex items-center justify-center rounded-2xl bg-[#0c1222]/90 backdrop-blur-sm p-4">
            <div className="w-full space-y-3">
              <p className="text-[14px] font-semibold text-white">Delete Announcement</p>
              <p className="text-[12px] text-white/60">Also recall the email sent to recipients?</p>
              <div className="flex flex-col gap-2">
                <button
                  onClick={() => deleteAnnouncement(recallTarget, true)}
                  className="w-full rounded-xl bg-rose-600 px-3 py-2 text-[12px] font-semibold text-white hover:bg-rose-700 transition-colors"
                >
                  Delete &amp; Recall Email
                </button>
                <button
                  onClick={() => deleteAnnouncement(recallTarget, false)}
                  className="w-full rounded-xl border border-white/[0.1] px-3 py-2 text-[12px] font-medium text-white/70 hover:bg-white/[0.06] transition-colors"
                >
                  Delete Only
                </button>
                <button
                  onClick={() => setRecallTarget(null)}
                  className="w-full rounded-xl px-3 py-1.5 text-[11px] text-white/40 hover:text-white/60 transition-colors"
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
