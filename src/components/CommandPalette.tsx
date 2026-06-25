import {
  CommandDialog,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
  CommandSeparator,
} from "@/components/ui/command";
import { Search, Trash2 } from "lucide-react";
import { useNavigate } from "@tanstack/react-router";
import { useChatStore } from "@/lib/chat-store";
import { QUERY_CATEGORY_LABELS, ICON_MAP } from "@/lib/quickQueries";
import { useQuickQueries } from "@/hooks/useQuickQueries";

interface CommandPaletteProps {
  open: boolean;
  onClose: () => void;
}

export function CommandPalette({ open, onClose }: CommandPaletteProps) {
  const navigate = useNavigate();
  const { createThread } = useChatStore();
  const { queries, removeQuery } = useQuickQueries();

  const runQuickAction = (prompt: string) => {
    // Create a new thread and navigate to chat
    createThread();
    navigate({ to: "/" });
    onClose();
    // Small delay so the thread is active before sending
    setTimeout(() => {
      const event = new CustomEvent("centriq:quick-action", { detail: { prompt } });
      window.dispatchEvent(event);
    }, 100);
  };

  return (
    <CommandDialog open={open} onOpenChange={(v) => !v && onClose()}>
      <CommandInput placeholder="What do you need help with?" />
      <CommandList>
        <CommandEmpty>
          <div className="flex flex-col items-center gap-2 py-4">
            <Search className="h-8 w-8 text-muted-foreground/30" />
            <p className="text-sm text-muted-foreground">No results found</p>
          </div>
        </CommandEmpty>

        {(["it", "admin", "hr"] as const).map((cat, i) => {
          const items = queries.filter((q) => q.category === cat);
          if (items.length === 0) return null;
          return (
            <span key={cat}>
              {i > 0 && <CommandSeparator />}
              <CommandGroup heading={QUERY_CATEGORY_LABELS[cat]}>
                {items.map(({ label, prompt, icon, iconColor }) => {
                  const Icon = ICON_MAP[icon] || Search;
                  return (
                    <CommandItem
                      key={label}
                      onSelect={() => runQuickAction(prompt)}
                      className="group flex items-center justify-between"
                    >
                      <div className="flex items-center gap-2">
                        <Icon className={`h-4 w-4 ${iconColor}`} />
                        <span>{label}</span>
                      </div>
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          e.preventDefault();
                          removeQuery(prompt);
                        }}
                        className="opacity-0 group-hover:opacity-100 p-1 rounded hover:bg-destructive/10 text-muted-foreground hover:text-destructive transition-colors shrink-0"
                        title="Remove quick search"
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </button>
                    </CommandItem>
                  );
                })}
              </CommandGroup>
            </span>
          );
        })}
      </CommandList>
    </CommandDialog>
  );
}
