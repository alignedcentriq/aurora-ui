import { MessageSquareText, Sparkles, Plus, Search, Settings, HelpCircle, LogOut } from "lucide-react";
import { cn } from "@/lib/utils";
import { Logo } from "@/components/Logo";

type Thread = { id: string; title: string; domain: string; time: string };

const initialThreads: Thread[] = [];

const domainColor: Record<string, string> = {
  HR: "text-emerald-400",
  IT: "text-violet-400",
  Admin: "text-amber-400",
  Org: "text-indigo-400",
};

interface SidebarProps {
  threads: Thread[];
  activeId?: string;
  onSelect: (id: string) => void;
  onNewChat: () => void;
  onSettings?: () => void;
  onHelp?: () => void;
  className?: string;
}

export function AssistantSidebar({ threads, activeId, onSelect, onNewChat, onSettings, onHelp, className }: SidebarProps) {
  return (
    <aside className={cn("hidden h-full w-[280px] shrink-0 flex-col bg-[var(--sidebar-bg)] border-r border-[var(--border)] lg:flex", className)}>
      {/* Brand */}
      <div className="flex items-center justify-between px-6 py-8">
        <div className="flex items-center gap-3">
          <Logo size="md" className="shadow-lg shadow-primary/20" />
          <div className="leading-tight">
            <div className="text-lg font-bold tracking-tight text-[var(--sidebar-foreground)]">Centriq AI</div>
            <div className="text-[10px] font-medium uppercase tracking-[0.2em] text-[var(--sidebar-foreground)]/40">
              Assistant
            </div>
          </div>
        </div>
      </div>

      {/* New chat */}
      <div className="px-4 mb-6">
        <button
          onClick={onNewChat}
          className="group flex w-full items-center gap-3 rounded-xl bg-primary px-4 py-3 text-sm font-semibold text-white transition-all hover:bg-primary/90 active:scale-[0.98] shadow-md shadow-primary/10"
        >
          <Plus className="h-4 w-4" strokeWidth={3} />
          New Conversation
        </button>
      </div>

      {/* Search */}
      <div className="px-4 mb-4">
        <div className="relative">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-[var(--sidebar-foreground)]/30" />
          <input
            type="text"
            placeholder="Search chats..."
            className="w-full rounded-xl bg-[var(--sidebar-accent)] py-2.5 pl-10 pr-4 text-sm text-[var(--sidebar-foreground)] outline-none placeholder:text-[var(--sidebar-foreground)]/30 focus:ring-1 focus:ring-primary/50"
          />
        </div>
      </div>

      {/* Threads */}
      <div className="flex-1 overflow-y-auto px-3">
        <div className="mb-2 px-3 text-[10px] font-bold uppercase tracking-[0.15em] text-[var(--sidebar-foreground)]/30">
          Recent Conversations
        </div>
        <ul className="space-y-1">
          {threads.map((t) => (
            <li key={t.id}>
              <button
                onClick={() => onSelect(t.id)}
                className={cn(
                  "sidebar-item w-full",
                  activeId === t.id && "active bg-[var(--sidebar-accent)]"
                )}
              >
                <MessageSquareText className="h-4 w-4 shrink-0" />
                <div className="min-w-0 flex-1 text-left">
                  <div className="truncate text-sm font-medium">{t.title}</div>
                  <div className="flex items-center gap-2 text-[10px] opacity-60">
                    <span className={domainColor[t.domain]}>{t.domain}</span>
                    <span>·</span>
                    <span>{t.time}</span>
                  </div>
                </div>
              </button>
            </li>
          ))}
        </ul>
      </div>

      {/* Bottom Actions */}
      <div className="mt-auto border-t border-[var(--sidebar-accent)] p-4 space-y-1">
        <button onClick={onSettings} className="sidebar-item w-full">
          <Settings className="h-4 w-4" />
          <span className="text-sm font-medium">Settings</span>
        </button>
        <button onClick={onHelp} className="sidebar-item w-full">
          <HelpCircle className="h-4 w-4" />
          <span className="text-sm font-medium">Help Center</span>
        </button>
      </div>

      {/* User */}
      <div className="border-t border-[var(--sidebar-accent)] p-4">
        <div className="flex items-center gap-3 rounded-xl px-3 py-2 transition-colors hover:bg-[var(--sidebar-accent)] cursor-pointer">
          <div className="relative">
            <div className="flex h-9 w-9 items-center justify-center rounded-full bg-violet-500/20 text-violet-400 font-bold text-xs border border-violet-500/30">
              SS
            </div>
            <div className="absolute -right-0.5 -bottom-0.5 h-3 w-3 rounded-full border-2 border-[var(--sidebar-bg)] bg-emerald-500" />
          </div>
          <div className="min-w-0 flex-1">
            <div className="truncate text-sm font-semibold text-[var(--sidebar-foreground)]">Shivam Sharma</div>
            <div className="truncate text-[10px] text-[var(--sidebar-foreground)]/40 font-medium">
              Product · Bengaluru
            </div>
          </div>
          <LogOut className="h-4 w-4 text-[var(--sidebar-foreground)]/30 hover:text-red-400 transition-colors" />
        </div>
      </div>
    </aside>
  );
}
