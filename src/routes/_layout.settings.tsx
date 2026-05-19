import { createFileRoute } from "@tanstack/react-router";
import { useAuth } from "@/lib/auth-store";
import {
  User,
  Palette,
  Globe,
  Bell,
  Shield,
  Moon,
  Sun,
  Monitor,
  MessageSquare,
  Volume2,
  VolumeX,
  Keyboard,
  Eye,
  EyeOff,
  Download,
  Trash2,
  ChevronRight,
  Brain,
  AlignLeft,
  ShieldCheck,
  Zap,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { toast } from "sonner";
import { useSettings } from "@/lib/settings-store";

export const Route = createFileRoute("/_layout/settings")({
  component: SettingsPage,
});

interface ToggleProps {
  enabled: boolean;
  onToggle: () => void;
}

function Toggle({ enabled, onToggle }: ToggleProps) {
  return (
    <button
      onClick={onToggle}
      className={cn(
        "h-6 w-11 rounded-full transition-colors duration-200 relative shrink-0",
        enabled ? "bg-primary" : "bg-muted",
      )}
    >
      <div
        className={cn(
          "absolute top-0.5 h-5 w-5 rounded-full bg-white shadow-sm transition-transform duration-200",
          enabled ? "translate-x-[22px]" : "translate-x-0.5",
        )}
      />
    </button>
  );
}

interface SettingRowProps {
  icon: typeof Bell;
  iconColor?: string;
  title: string;
  description: string;
  children: React.ReactNode;
}

function SettingRow({
  icon: Icon,
  iconColor = "text-muted-foreground",
  title,
  description,
  children,
}: SettingRowProps) {
  return (
    <div className="flex items-center justify-between gap-6 py-4">
      <div className="flex items-center gap-4 min-w-0">
        <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-[var(--muted)] shrink-0">
          <Icon className={cn("h-[18px] w-[18px]", iconColor)} />
        </div>
        <div className="min-w-0">
          <p className="text-[13px] font-medium text-foreground">{title}</p>
          <p className="text-[11px] text-muted-foreground mt-0.5">{description}</p>
        </div>
      </div>
      <div className="shrink-0">{children}</div>
    </div>
  );
}

function SettingsPage() {
  const { user } = useAuth();
  const { theme, setTheme } = useSettings();

  if (!user) return null;

  const themeOptions = [
    { value: "light", icon: Sun, label: "Light" },
    { value: "dark", icon: Moon, label: "Dark" },
    { value: "system", icon: Monitor, label: "System" },
  ] as const;

  return (
    <div className="flex h-full flex-col overflow-y-auto">
      {/* Header */}
      <div className="sticky top-0 z-10 border-b border-[var(--border)] bg-background/80 backdrop-blur-xl px-4 py-4 sm:px-8 sm:py-5">
        <h1 className="text-lg sm:text-xl font-semibold text-foreground tracking-tight">Settings</h1>
        <p className="text-[12px] sm:text-[13px] text-muted-foreground mt-0.5">
          Manage your preferences and personalization
        </p>
      </div>

      <div className="flex-1 p-4 sm:p-8">
        <div className="mx-auto max-w-3xl space-y-6 sm:space-y-8">
          {/* Profile Card */}
          <div className="rounded-2xl border border-[var(--border)] bg-card p-4 sm:p-6">
            <div className="flex items-center gap-3 sm:gap-5">
              {user.avatarUrl ? (
                <img
                  src={user.avatarUrl}
                  alt={user.name}
                  className="h-12 w-12 sm:h-16 sm:w-16 rounded-2xl object-cover shadow-md shrink-0"
                />
              ) : (
                <div className="flex h-12 w-12 sm:h-16 sm:w-16 items-center justify-center rounded-2xl bg-primary/10 text-lg sm:text-xl font-bold text-primary shadow-sm shrink-0">
                  {user.name
                    .split(" ")
                    .map((n) => n[0])
                    .join("")}
                </div>
              )}
              <div className="flex-1 min-w-0">
                <h2 className="text-base sm:text-lg font-semibold text-foreground truncate">{user.name}</h2>
                <p className="text-[11px] sm:text-[13px] text-muted-foreground truncate">{user.email}</p>
                <div className="flex items-center gap-2 mt-2 flex-wrap">
                  <span className="inline-flex items-center gap-1 rounded-md bg-primary/10 px-2 py-0.5 text-[10px] sm:text-[11px] font-semibold text-primary">
                    <Shield className="h-3 w-3" />
                    {user.role}
                  </span>
                  {user.department && (
                    <span className="text-[10px] sm:text-[11px] text-muted-foreground">{user.department}</span>
                  )}
                </div>
              </div>
            </div>
          </div>

          {/* Appearance */}
          <div className="rounded-2xl border border-[var(--border)] bg-card overflow-hidden">
            <div className="px-4 py-3 sm:px-6 sm:py-4 border-b border-[var(--border)]">
              <h3 className="text-[14px] sm:text-[15px] font-semibold text-foreground flex items-center gap-2">
                <Palette className="h-4 w-4 text-violet-500" /> Appearance
              </h3>
            </div>
            <div className="p-4 sm:p-6 space-y-2">
              <p className="text-[12px] sm:text-[13px] font-medium text-foreground mb-3">Theme</p>
              <div className="grid grid-cols-3 gap-2 sm:gap-3">
                {themeOptions.map((opt) => {
                  const Icon = opt.icon;
                  const isSelected = theme === opt.value;
                  return (
                    <button
                      key={opt.value}
                      onClick={() => setTheme(opt.value)}
                      className={cn(
                        "flex flex-col items-center gap-1.5 sm:gap-2 rounded-xl border-2 px-2 py-3 sm:px-4 sm:py-4 transition-all duration-150",
                        isSelected
                          ? "border-primary bg-primary/5"
                          : "border-[var(--border)] hover:border-[var(--border-strong)]",
                      )}
                    >
                      <Icon
                        className={cn(
                          "h-4 w-4 sm:h-5 sm:w-5",
                          isSelected ? "text-primary" : "text-muted-foreground",
                        )}
                      />
                      <span
                        className={cn(
                          "text-[11px] sm:text-xs font-medium",
                          isSelected ? "text-primary" : "text-muted-foreground",
                        )}
                      >
                        {opt.label}
                      </span>
                    </button>
                  );
                })}
              </div>
            </div>
          </div>

        </div>
      </div>
    </div>
  );
}
