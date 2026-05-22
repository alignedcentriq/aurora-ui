import {
  CommandDialog,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
  CommandSeparator,
} from "@/components/ui/command";
import { Search } from "lucide-react";
import { useNavigate } from "@tanstack/react-router";
import { useChatStore } from "@/lib/chat-store";
import { QUICK_QUERIES, QUERY_CATEGORY_LABELS } from "@/lib/quickQueries";

interface CommandPaletteProps {
  open: boolean;
  onClose: () => void;
}

export function CommandPalette({ open, onClose }: CommandPaletteProps) {
  const navigate = useNavigate();
  const { createThread } = useChatStore();

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
          const items = QUICK_QUERIES.filter(q => q.category === cat);
          return (
            <span key={cat}>
              {i > 0 && <CommandSeparator />}
              <CommandGroup heading={QUERY_CATEGORY_LABELS[cat]}>
                {items.map(({ label, prompt, icon: Icon, iconColor }) => (
                  <CommandItem key={label} onSelect={() => runQuickAction(prompt)}>
                    <Icon className={`h-4 w-4 ${iconColor}`} />
                    <span>{label}</span>
                  </CommandItem>
                ))}
              </CommandGroup>
            </span>
          );
        })}


      </CommandList>
    </CommandDialog>
  );
}
