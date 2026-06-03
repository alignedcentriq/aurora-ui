import { Monitor, Moon, Sun } from "lucide-react";
import { useSettings } from "@/lib/settings-store";
import { cn } from "@/lib/utils";
import { motion } from "framer-motion";

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
      className="relative inline-flex items-center gap-0.5 rounded-full p-1 bg-muted/40 border border-border ml-2"
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
              "relative flex h-7 w-7 items-center justify-center rounded-full transition-colors duration-200 z-10",
              active
                ? "text-white"
                : "text-muted-foreground hover:text-foreground",
            )}
          >
            {active && (
              <motion.span
                layoutId="theme-pill"
                aria-hidden
                className="absolute inset-0 rounded-full"
                style={{
                  background: "var(--gradient-primary)",
                  boxShadow: "0 2px 8px -2px color-mix(in oklab, var(--primary) 40%, transparent)",
                }}
                transition={{ type: "spring", stiffness: 500, damping: 35 }}
              />
            )}
            <Icon className="relative z-10 h-3.5 w-3.5" strokeWidth={active ? 2.5 : 2} />
          </button>
        );
      })}
    </div>
  );
}
