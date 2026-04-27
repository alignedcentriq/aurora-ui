import { MessageSquareText, Sparkles, Plus } from "lucide-react";
import { cn } from "@/lib/utils";

type Thread = { id: string; title: string; domain: string; time: string };

const initialThreads: Thread[] = [
  { id: "1", title: "How many leave days do I have left?", domain: "HR", time: "Now" },
  { id: "2", title: "Reset my VPN access", domain: "IT", time: "2h" },
  { id: "3", title: "Request salary slip — October", domain: "HR", time: "Yesterday" },
  { id: "4", title: "Book a meeting room on 4F", domain: "Admin", time: "Mon" },
  { id: "5", title: "Q4 company-wide announcement", domain: "Org", time: "Mon" },
  { id: "6", title: "Install Figma on my workstation", domain: "IT", time: "Last week" },
];

const domainColor: Record<string, string> = {
  HR: "text-emerald-400",
  IT: "text-[color:var(--accent-cyan)]",
  Admin: "text-amber-400",
  Org: "text-[color:var(--accent-blue)]",
};

interface SidebarProps {
  activeId?: string;
  onSelect: (id: string) => void;
  onNewChat: () => void;
  className?: string;
}

export function AssistantSidebar({ activeId, onSelect, onNewChat, className }: SidebarProps) {
  return (
    <aside className={cn("glass-strong hidden h-full w-[300px] shrink-0 flex-col border-r lg:flex", className)}>
      {/* Brand */}
      <div className="flex items-center justify-between border-b border-[var(--color-border)] px-5 py-4">
        <div className="flex items-center gap-2.5">
          <div
            className="flex h-8 w-8 items-center justify-center rounded-lg"
            style={{
              background: "var(--gradient-primary)",
              boxShadow:
                "0 8px 24px -8px color-mix(in oklab, var(--accent-cyan) 60%, transparent)",
            }}
          >
            <Sparkles className="h-4 w-4 text-primary-foreground" strokeWidth={2.5} />
          </div>
          <div className="leading-tight">
            <div className="text-sm font-semibold tracking-tight">Synapse</div>
            <div className="font-mono text-[10px] uppercase tracking-widest text-muted-foreground">
              Workplace AI
            </div>
          </div>
        </div>
      </div>

      {/* New chat */}
      <div className="px-4 pt-4">
        <button
          onClick={onNewChat}
          className="group relative flex w-full items-center justify-between overflow-hidden rounded-xl border border-[var(--color-border-strong)] bg-surface-raised/60 px-3.5 py-2.5 text-sm font-medium transition-all hover:border-[color:var(--accent-cyan)]/40 active:scale-[0.98]"
        >
          <span className="flex items-center gap-2.5">
            <Plus className="h-4 w-4 text-[color:var(--accent-cyan)]" strokeWidth={2.5} />
            New conversation
          </span>
          <kbd className="font-mono text-[10px] text-muted-foreground">⌘K</kbd>
          <span
            aria-hidden
            className="pointer-events-none absolute inset-0 -translate-x-full bg-gradient-to-r from-transparent via-[color:var(--accent-cyan)]/10 to-transparent transition-transform duration-700 group-hover:translate-x-full"
          />
        </button>
      </div>

      {/* Threads */}
      <div className="flex-1 overflow-y-auto px-2 py-5">
        <div className="px-3 pb-2 font-mono text-[10px] uppercase tracking-[0.18em] text-muted-foreground">
          Recent
        </div>
        <ul className="space-y-0.5">
          {initialThreads.map((t) => (
            <li key={t.id}>
              <button
                onClick={() => onSelect(t.id)}
                className={cn(
                  "group relative flex w-full items-start gap-3 rounded-lg px-3 py-2.5 text-left transition-all",
                  activeId === t.id
                    ? "bg-[color:var(--accent-cyan)]/10 ring-1 ring-inset ring-[color:var(--accent-cyan)]/25"
                    : "hover:bg-surface-raised/60",
                )}
              >
                <MessageSquareText
                  className={cn(
                    "mt-0.5 h-3.5 w-3.5 shrink-0",
                    activeId === t.id ? "text-[color:var(--accent-cyan)]" : "text-muted-foreground",
                  )}
                />
                <div className="min-w-0 flex-1">
                  <div
                    className={cn(
                      "truncate text-[13px] leading-snug",
                      activeId === t.id ? "text-foreground" : "text-foreground/85",
                    )}
                  >
                    {t.title}
                  </div>
                  <div className="mt-1 flex items-center gap-2 font-mono text-[10px] uppercase tracking-wider">
                    <span className={domainColor[t.domain]}>{t.domain}</span>
                    <span className="text-muted-foreground/60">·</span>
                    <span className="text-muted-foreground/70">{t.time}</span>
                  </div>
                </div>
              </button>
            </li>
          ))}
        </ul>
      </div>

      {/* User */}
      <div className="border-t border-[var(--color-border)] p-4">
        <div className="flex items-center gap-3 rounded-xl px-2 py-2">
          <div
            className="flex h-9 w-9 items-center justify-center rounded-full font-mono text-xs font-semibold text-primary-foreground"
            style={{ background: "var(--gradient-primary)" }}
          >
            AK
          </div>
          <div className="min-w-0 flex-1">
            <div className="truncate text-[13px] font-medium">Ayesha Khan</div>
            <div className="truncate font-mono text-[10px] uppercase tracking-wider text-muted-foreground">
              Product · Bengaluru
            </div>
          </div>
          <div
            className="h-2 w-2 rounded-full bg-emerald-400"
            style={{ boxShadow: "0 0 10px currentColor" }}
          />
        </div>
      </div>
    </aside>
  );
}
