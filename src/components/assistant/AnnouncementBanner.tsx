import { useEffect, useState } from "react";
import { X, Megaphone, ChevronDown, ChevronUp } from "lucide-react";
import { cn } from "@/lib/utils";

interface Announcement {
  id: number;
  title: string;
  body: string;
  category: string;
  created_by: string;
  target_audience: string;
  is_active: boolean;
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

export function AnnouncementBanner() {
  const [announcements, setAnnouncements] = useState<Announcement[]>([]);
  const [dismissed, setDismissed] = useState<number[]>(getDismissed);
  const [expanded, setExpanded] = useState<number | null>(null);

  useEffect(() => {
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
  }, []);

  const dismiss = (id: number) => {
    const updated = [...dismissed, id];
    setDismissed(updated);
    saveDismissed(updated);
  };

  const visible = announcements.filter((a) => !dismissed.includes(a.id));

  if (visible.length === 0) return null;

  return (
    <div className="mt-4 px-3">
      <div className="mb-2 px-1 flex items-center justify-between">
        <span className="text-[10px] font-bold uppercase tracking-[0.12em] text-[var(--sidebar-foreground)]/30">
          Announcements
        </span>
      </div>
      <div className="space-y-1.5">
        {visible.slice(0, 3).map((a) => {
          const isExpanded = expanded === a.id;
          const colorClass = CATEGORY_COLORS[a.category] ?? CATEGORY_COLORS.General;
          return (
            <div
              key={a.id}
              className="flex flex-col gap-1.5 rounded-lg border border-white/[0.06] bg-white/[0.02] p-2.5 transition-colors hover:bg-white/[0.04]"
            >
              <div className="flex items-start justify-between gap-2">
                <div className="flex flex-1 items-center gap-2 min-w-0">
                  <Megaphone className="h-3.5 w-3.5 shrink-0 text-white/40" />
                  <span className="text-[11px] font-semibold text-white/80 truncate">
                    {a.title}
                  </span>
                </div>
                <div className="flex items-center gap-0.5 shrink-0">
                  <button
                    onClick={() => setExpanded(isExpanded ? null : a.id)}
                    className="flex h-5 w-5 items-center justify-center rounded text-white/30 hover:text-white/80 transition-colors"
                  >
                    {isExpanded ? <ChevronUp className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />}
                  </button>
                  <button
                    onClick={() => dismiss(a.id)}
                    className="flex h-5 w-5 items-center justify-center rounded text-white/30 hover:text-rose-400 transition-colors"
                  >
                    <X className="h-3 w-3" />
                  </button>
                </div>
              </div>
              <div className="flex items-center gap-2">
                <span className={cn("rounded px-1.5 py-0.5 text-[8px] font-bold uppercase tracking-wider shrink-0", colorClass)}>
                  {a.category}
                </span>
              </div>
              {isExpanded && (
                <p className="mt-0.5 text-[10px] text-white/50 leading-relaxed">
                  {a.body}
                </p>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
