import { useEffect, useState } from "react";
import { X, Megaphone, ChevronDown, ChevronUp, Bell, Trash2 } from "lucide-react";
import { cn } from "@/lib/utils";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { useAuth } from "@/lib/auth-store";

interface Announcement {
  id: number;
  title: string;
  body: string;
  category: string;
  created_by: string;
  target_audience: string;
  is_active: boolean;
  image_url: string | null;
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

const CATEGORY_COLORS: Record<string, string> = {
  "Policy Update": "bg-blue-500/10 text-blue-600 dark:text-blue-400",
  Holiday: "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400",
  Events: "bg-violet-500/10 text-violet-600 dark:text-violet-400",
  Hiring: "bg-amber-500/10 text-amber-600 dark:text-amber-400",
  Training: "bg-indigo-500/10 text-indigo-600 dark:text-indigo-400",
  "IT Alert": "bg-rose-500/10 text-rose-600 dark:text-rose-400",
  General: "bg-muted text-muted-foreground",
};

const DOMAIN_MANAGER_ROLES = new Set(["HR", "IT", "PMO", "Admin"]);

export function AnnouncementBanner() {
  const { user } = useAuth();
  const [announcements, setAnnouncements] = useState<Announcement[]>([]);
  const [dismissed, setDismissed] = useState<number[]>(getDismissed);
  const [expanded, setExpanded] = useState<number | null>(null);

  const isDomainManager = user ? DOMAIN_MANAGER_ROLES.has(user.role) : false;

  const authHeaders = {
    ...(user?.email ? { "x-user-email": user.email } : {}),
    ...(user?.role ? { "x-user-role": user.role.toLowerCase() } : {}),
  };

  const loadAnnouncements = () => {
    fetch("/api/announcements")
      .then((r) => r.json())
      .then((data: Announcement[]) => {
        const active = data.filter((a) => a.is_active);
        setAnnouncements(active);
        if (active.length > 0 && expanded === null) {
          setExpanded(active[0].id);
        }
      })
      .catch(() => {});
  };

  useEffect(() => { loadAnnouncements(); }, []);

  const dismiss = (id: number) => {
    const updated = [...dismissed, id];
    setDismissed(updated);
    saveDismissed(updated);
  };

  const deleteAnnouncement = (id: number) => {
    fetch(`/api/announcements/${id}`, { method: "DELETE", headers: authHeaders })
      .then(() => loadAnnouncements())
      .catch(() => {});
  };

  const visible = announcements.filter((a) => !dismissed.includes(a.id));
  const unreadCount = visible.length;

  return (
    <Popover>
      <PopoverTrigger asChild>
        <button className="relative flex h-8 w-8 items-center justify-center rounded-full hover:bg-white/[0.08] transition-colors ml-auto text-[var(--sidebar-foreground)]">
          <Bell className="h-4 w-4" />
          {unreadCount > 0 && (
            <span className="absolute right-1.5 top-1.5 flex h-2 w-2 rounded-full bg-rose-500">
              <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-rose-400 opacity-75"></span>
            </span>
          )}
        </button>
      </PopoverTrigger>
      <PopoverContent className="w-80 p-0 border-white/[0.06] bg-[#1a1f2e] shadow-2xl z-50" align="start" side="bottom">
        <div className="flex items-center justify-between border-b border-white/[0.06] px-4 py-3">
          <span className="text-sm font-semibold text-white">Notifications</span>
          {unreadCount > 0 && (
            <span className="rounded-full bg-primary/20 px-2 py-0.5 text-[10px] font-medium text-primary">
              {unreadCount} new
            </span>
          )}
        </div>
        <div className="max-h-[400px] overflow-y-auto p-3 space-y-2 no-scrollbar">
          {visible.length === 0 ? (
            <div className="py-8 text-center text-sm text-white/40">
              No new notifications
            </div>
          ) : (
            visible.map((a) => {
              const isExpanded = expanded === a.id;
              const colorClass = CATEGORY_COLORS[a.category] ?? CATEGORY_COLORS.General;
              return (
                <div
                  key={a.id}
                  className="flex flex-col gap-2 rounded-lg border border-white/[0.06] bg-white/[0.02] p-3 transition-colors hover:bg-white/[0.04]"
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
                        {isExpanded ? <ChevronUp className="h-3.5 w-3.5" /> : <ChevronDown className="h-3.5 w-3.5" />}
                      </button>
                      {isDomainManager ? (
                        <button
                          onClick={() => deleteAnnouncement(a.id)}
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
                    <span className={cn("rounded px-2 py-0.5 text-[10px] font-semibold tracking-wider shrink-0", colorClass)}>
                      {a.category}
                    </span>
                  </div>
                  {isExpanded && (
                    <div className="mt-1 space-y-2">
                      {a.image_url && (
                        <img
                          src={a.image_url}
                          alt="Announcement"
                          className="w-full rounded-lg object-cover max-h-36"
                          onError={(e) => { (e.target as HTMLImageElement).style.display = "none"; }}
                        />
                      )}
                      <p className="text-[12px] text-white/60 leading-relaxed max-h-48 overflow-y-auto whitespace-pre-wrap">
                        {a.body}
                      </p>
                    </div>
                  )}
                </div>
              );
            })
          )}
        </div>
      </PopoverContent>
    </Popover>
  );
}
