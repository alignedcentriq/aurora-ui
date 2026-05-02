import { createFileRoute } from "@tanstack/react-router";
import { useAuth } from "@/lib/auth-store";
import { useState } from "react";
import {
  User, Palette, Globe, Bell, Shield, Moon, Sun, Monitor,
  MessageSquare, Volume2, VolumeX, Keyboard, Eye, EyeOff,
  Download, Trash2, ChevronRight,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { toast } from "sonner";

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
        enabled ? "bg-primary" : "bg-muted"
      )}
    >
      <div className={cn(
        "absolute top-0.5 h-5 w-5 rounded-full bg-white shadow-sm transition-transform duration-200",
        enabled ? "translate-x-[22px]" : "translate-x-0.5"
      )} />
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

function SettingRow({ icon: Icon, iconColor = "text-muted-foreground", title, description, children }: SettingRowProps) {
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
  const [theme, setTheme] = useState<"light" | "dark" | "system">("system");
  const [notifications, setNotifications] = useState(true);
  const [soundEffects, setSoundEffects] = useState(true);
  const [compactMode, setCompactMode] = useState(false);
  const [showOnlineStatus, setShowOnlineStatus] = useState(true);
  const [keyboardShortcuts, setKeyboardShortcuts] = useState(true);
  const [aiMemory, setAiMemory] = useState(true);
  const [autoSuggestions, setAutoSuggestions] = useState(true);
  const [language, setLanguage] = useState("en-us");
  const [aiTone, setAiTone] = useState("professional");

  if (!user) return null;

  const themeOptions = [
    { value: "light", icon: Sun, label: "Light" },
    { value: "dark", icon: Moon, label: "Dark" },
    { value: "system", icon: Monitor, label: "System" },
  ] as const;

  return (
    <div className="flex h-full flex-col overflow-y-auto">
      {/* Header */}
      <div className="sticky top-0 z-10 border-b border-[var(--border)] bg-background/80 backdrop-blur-xl px-8 py-5">
        <h1 className="text-xl font-semibold text-foreground tracking-tight">Settings</h1>
        <p className="text-[13px] text-muted-foreground mt-0.5">Manage your preferences and personalization</p>
      </div>

      <div className="flex-1 p-8">
        <div className="mx-auto max-w-3xl space-y-8">
          {/* Profile Card */}
          <div className="rounded-2xl border border-[var(--border)] bg-card p-6">
            <div className="flex items-center gap-5">
              <div className="flex h-16 w-16 items-center justify-center rounded-2xl bg-primary/10 text-xl font-bold text-primary">
                {user.name.split(" ").map(n => n[0]).join("")}
              </div>
              <div className="flex-1 min-w-0">
                <h2 className="text-lg font-semibold text-foreground">{user.name}</h2>
                <p className="text-[13px] text-muted-foreground">{user.email}</p>
                <div className="flex items-center gap-2 mt-2">
                  <span className="inline-flex items-center gap-1 rounded-md bg-primary/10 px-2 py-0.5 text-[11px] font-semibold text-primary">
                    <Shield className="h-3 w-3" />
                    {user.role}
                  </span>
                  {user.department && (
                    <span className="text-[11px] text-muted-foreground">
                      {user.department}
                    </span>
                  )}
                </div>
              </div>
              <button className="rounded-xl border border-[var(--border)] px-4 py-2 text-[13px] font-medium text-foreground hover:bg-[var(--muted)] transition-colors">
                Edit Profile
              </button>
            </div>
          </div>

          {/* Appearance */}
          <div className="rounded-2xl border border-[var(--border)] bg-card overflow-hidden">
            <div className="px-6 py-4 border-b border-[var(--border)]">
              <h3 className="text-[15px] font-semibold text-foreground flex items-center gap-2">
                <Palette className="h-4 w-4 text-violet-500" /> Appearance
              </h3>
            </div>
            <div className="p-6 space-y-2">
              <p className="text-[13px] font-medium text-foreground mb-3">Theme</p>
              <div className="grid grid-cols-3 gap-3">
                {themeOptions.map((opt) => {
                  const Icon = opt.icon;
                  const isSelected = theme === opt.value;
                  return (
                    <button
                      key={opt.value}
                      onClick={() => setTheme(opt.value)}
                      className={cn(
                        "flex flex-col items-center gap-2 rounded-xl border-2 px-4 py-4 transition-all duration-150",
                        isSelected
                          ? "border-primary bg-primary/5"
                          : "border-[var(--border)] hover:border-[var(--border-strong)]"
                      )}
                    >
                      <Icon className={cn("h-5 w-5", isSelected ? "text-primary" : "text-muted-foreground")} />
                      <span className={cn("text-xs font-medium", isSelected ? "text-primary" : "text-muted-foreground")}>{opt.label}</span>
                    </button>
                  );
                })}
              </div>

              <div className="border-t border-[var(--border)] mt-4 pt-4">
                <SettingRow icon={Eye} iconColor="text-blue-500" title="Compact Mode" description="Reduce spacing for a denser layout">
                  <Toggle enabled={compactMode} onToggle={() => setCompactMode(!compactMode)} />
                </SettingRow>
              </div>
            </div>
          </div>

          {/* AI Preferences */}
          <div className="rounded-2xl border border-[var(--border)] bg-card overflow-hidden">
            <div className="px-6 py-4 border-b border-[var(--border)]">
              <h3 className="text-[15px] font-semibold text-foreground flex items-center gap-2">
                <MessageSquare className="h-4 w-4 text-emerald-500" /> AI Preferences
              </h3>
            </div>
            <div className="p-6 divide-y divide-[var(--border)]">
              <SettingRow icon={MessageSquare} iconColor="text-emerald-500" title="Response Tone" description="How Centriq AI communicates with you">
                <select
                  value={aiTone}
                  onChange={(e) => setAiTone(e.target.value)}
                  className="rounded-lg border border-[var(--border)] bg-background px-3 py-1.5 text-[13px] outline-none focus:ring-2 focus:ring-primary/20"
                >
                  <option value="professional">Professional</option>
                  <option value="friendly">Friendly</option>
                  <option value="concise">Concise</option>
                  <option value="detailed">Detailed</option>
                </select>
              </SettingRow>
              <SettingRow icon={Eye} iconColor="text-cyan-500" title="AI Memory" description="Allow Centriq to remember conversation context">
                <Toggle enabled={aiMemory} onToggle={() => setAiMemory(!aiMemory)} />
              </SettingRow>
              <SettingRow icon={Keyboard} iconColor="text-amber-500" title="Auto Suggestions" description="Show smart suggestions as you type">
                <Toggle enabled={autoSuggestions} onToggle={() => setAutoSuggestions(!autoSuggestions)} />
              </SettingRow>
            </div>
          </div>

          {/* Notifications */}
          <div className="rounded-2xl border border-[var(--border)] bg-card overflow-hidden">
            <div className="px-6 py-4 border-b border-[var(--border)]">
              <h3 className="text-[15px] font-semibold text-foreground flex items-center gap-2">
                <Bell className="h-4 w-4 text-amber-500" /> Notifications
              </h3>
            </div>
            <div className="p-6 divide-y divide-[var(--border)]">
              <SettingRow icon={Bell} iconColor="text-amber-500" title="Push Notifications" description="Get notified about tasks and updates">
                <Toggle enabled={notifications} onToggle={() => setNotifications(!notifications)} />
              </SettingRow>
              <SettingRow
                icon={soundEffects ? Volume2 : VolumeX}
                iconColor="text-rose-500"
                title="Sound Effects"
                description="Play sounds for messages and alerts"
              >
                <Toggle enabled={soundEffects} onToggle={() => setSoundEffects(!soundEffects)} />
              </SettingRow>
            </div>
          </div>

          {/* Language & Region */}
          <div className="rounded-2xl border border-[var(--border)] bg-card overflow-hidden">
            <div className="px-6 py-4 border-b border-[var(--border)]">
              <h3 className="text-[15px] font-semibold text-foreground flex items-center gap-2">
                <Globe className="h-4 w-4 text-cyan-500" /> Language & Region
              </h3>
            </div>
            <div className="p-6">
              <SettingRow icon={Globe} iconColor="text-cyan-500" title="Assistant Language" description="The language Centriq uses to reply">
                <select
                  value={language}
                  onChange={(e) => setLanguage(e.target.value)}
                  className="rounded-lg border border-[var(--border)] bg-background px-3 py-1.5 text-[13px] outline-none focus:ring-2 focus:ring-primary/20"
                >
                  <option value="en-us">English (US)</option>
                  <option value="en-gb">English (UK)</option>
                  <option value="es">Spanish</option>
                  <option value="fr">French</option>
                  <option value="de">German</option>
                  <option value="hi">Hindi</option>
                  <option value="ja">Japanese</option>
                </select>
              </SettingRow>
            </div>
          </div>

          {/* Privacy & Security */}
          <div className="rounded-2xl border border-[var(--border)] bg-card overflow-hidden">
            <div className="px-6 py-4 border-b border-[var(--border)]">
              <h3 className="text-[15px] font-semibold text-foreground flex items-center gap-2">
                <Shield className="h-4 w-4 text-rose-500" /> Privacy & Security
              </h3>
            </div>
            <div className="p-6 divide-y divide-[var(--border)]">
              <SettingRow
                icon={showOnlineStatus ? Eye : EyeOff}
                iconColor="text-emerald-500"
                title="Online Status"
                description="Show your online status to colleagues"
              >
                <Toggle enabled={showOnlineStatus} onToggle={() => setShowOnlineStatus(!showOnlineStatus)} />
              </SettingRow>
              <SettingRow icon={Keyboard} iconColor="text-indigo-500" title="Keyboard Shortcuts" description="Enable keyboard shortcuts across the app">
                <Toggle enabled={keyboardShortcuts} onToggle={() => setKeyboardShortcuts(!keyboardShortcuts)} />
              </SettingRow>
            </div>
          </div>

          {/* Data Management */}
          <div className="rounded-2xl border border-[var(--border)] bg-card overflow-hidden">
            <div className="px-6 py-4 border-b border-[var(--border)]">
              <h3 className="text-[15px] font-semibold text-foreground">Data Management</h3>
            </div>
            <div className="p-6 space-y-3">
              <button
                onClick={() => toast.success("Chat history exported successfully")}
                className="flex w-full items-center justify-between rounded-xl border border-[var(--border)] px-4 py-3.5 text-[13px] font-medium text-foreground transition-colors hover:bg-[var(--muted)]"
              >
                <div className="flex items-center gap-3">
                  <Download className="h-4 w-4 text-muted-foreground" />
                  Export Chat History
                </div>
                <ChevronRight className="h-4 w-4 text-muted-foreground" />
              </button>
              <button
                onClick={() => toast.error("This would clear all conversation data")}
                className="flex w-full items-center justify-between rounded-xl border border-rose-500/20 px-4 py-3.5 text-[13px] font-medium text-rose-500 transition-colors hover:bg-rose-500/5"
              >
                <div className="flex items-center gap-3">
                  <Trash2 className="h-4 w-4" />
                  Clear All Conversations
                </div>
                <ChevronRight className="h-4 w-4" />
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
