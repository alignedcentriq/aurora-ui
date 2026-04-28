import { Monitor, Moon, Sun } from "lucide-react";
import { useTheme } from "@/hooks/use-theme";
import { cn } from "@/lib/utils";

export function ThemeToggle() {
  const { theme, setTheme } = useTheme();
  const options: { value: "system" | "light" | "dark"; icon: typeof Sun; label: string }[] = [
    { value: "system", icon: Monitor, label: "System" },
    { value: "light", icon: Sun, label: "Light" },
    { value: "dark", icon: Moon, label: "Dark" },
  ];

  return (
    <div
      role="radiogroup"
      aria-label="Theme"
      className="glass relative inline-flex items-center gap-0.5 rounded-full p-1"
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
              "relative flex h-7 w-7 items-center justify-center rounded-full transition-all",
              active
                ? "text-primary-foreground"
                : "text-muted-foreground hover:text-foreground",
            )}
          >
            {active && (
              <span
                aria-hidden
                className="absolute inset-0 rounded-full"
                style={{
                  background: "var(--gradient-primary)",
                  boxShadow:
                    "0 0 0 1px color-mix(in oklab, var(--accent-violet) 30%, transparent), 0 6px 20px -6px color-mix(in oklab, var(--accent-violet) 55%, transparent)",
                }}
              />
            )}
            <Icon className="relative h-3.5 w-3.5" strokeWidth={2.25} />
          </button>
        );
      })}
    </div>
  );
}
