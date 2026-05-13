import { Monitor, Moon, Sun } from "lucide-react";
import { useSettings } from "@/lib/settings-store";
import { cn } from "@/lib/utils";

export function ThemeToggle() {
  const { theme, setTheme } = useSettings();
  const options: { value: "system" | "light" | "dark"; icon: typeof Sun; label: string }[] = [
    { value: "system", icon: Monitor, label: "System" },
    { value: "light", icon: Sun, label: "Light" },
    { value: "dark", icon: Moon, label: "Dark" },
  ];

  return (
    <div
      role="radiogroup"
      aria-label="Theme"
      className="glass relative inline-flex items-center gap-1 rounded-full p-1 bg-muted/30"
    >
      {options.map((opt) => {
        const Icon = opt.icon;
        const active = theme === opt.value;
        return (
          <button
            key={opt.value}
            role="radio"
            aria-checked={active}
            aria-label={opt.label}
            onClick={() => setTheme(opt.value)}
            className={cn(
              "relative flex h-8 w-8 items-center justify-center rounded-full transition-all duration-200",
              active
                ? "text-white shadow-md scale-110 z-10"
                : "text-muted-foreground hover:text-foreground hover:bg-muted/50",
            )}
          >
            {active && (
              <span
                aria-hidden
                className="absolute inset-0 rounded-full animate-[fade-in_.2s_ease-out]"
                style={{
                  background: "var(--gradient-primary)",
                  boxShadow: "0 4px 12px -2px color-mix(in oklab, var(--primary) 40%, transparent)",
                }}
              />
            )}
            <Icon className="relative z-10 h-4 w-4" strokeWidth={active ? 2.5 : 2} />
          </button>
        );
      })}
    </div>
  );
}
