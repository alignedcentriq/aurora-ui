import { createFileRoute } from "@tanstack/react-router";
import { useAuth } from "@/lib/auth-store";
import {
  Shield,
  Loader2,
  ExternalLink,
  Bot,
  CheckCircle2,
  Unlink,
  Link2,
  type LucideIcon,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { useSettings, BUDDY_PRESETS, useBuddyColors } from "@/lib/settings-store";
import { ThinkingBuddy } from "@/components/assistant/ThinkingBuddy";
import { ListeningBuddy } from "@/components/assistant/ListeningBuddy";
import { BUDDY_CHARACTERS } from "@/components/assistant/characters";
import { GreetingBotSVG, getBuddyGender } from "@/components/assistant/GreetingBot";
import { motion, AnimatePresence, type Variants } from "framer-motion";
import { useState, useEffect, useCallback, useMemo } from "react";

export const Route = createFileRoute("/_layout/settings")({
  component: SettingsPage,
});

import { Toggle } from "@/components/ui/toggle";

interface SettingRowProps {
  icon: LucideIcon;
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
    <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 sm:gap-6 py-4">
      <div className="flex items-center gap-4 min-w-0">
        <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-[var(--muted)] shrink-0">
          <Icon className={cn("h-[18px] w-[18px]", iconColor)} />
        </div>
        <div className="min-w-0">
          <p className="text-[13px] font-medium text-foreground">{title}</p>
          <p className="text-[11px] text-muted-foreground mt-0.5">{description}</p>
        </div>
      </div>
      <div className="shrink-0 pl-14 sm:pl-0">{children}</div>
    </div>
  );
}

const container: Variants = {
  hidden: { opacity: 0 },
  show: {
    opacity: 1,
    transition: { staggerChildren: 0.08, delayChildren: 0.1 },
  },
};

const item: Variants = {
  hidden: { opacity: 0, y: 12 },
  show: {
    opacity: 1,
    y: 0,
    transition: { type: "spring", stiffness: 300, damping: 30 },
  },
};

// -- Connected Accounts (OAuth2 popup flow) -----------------------------------

interface ProviderMeta {
  name: string;
  icon: React.FC<{ className?: string }>;
  description: string;
  features: string[];
  color: string;
}

function MicrosoftIcon({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 21 21" fill="none">
      <rect x="1" y="1" width="9" height="9" fill="#F25022" />
      <rect x="11" y="1" width="9" height="9" fill="#7FBA00" />
      <rect x="1" y="11" width="9" height="9" fill="#00A4EF" />
      <rect x="11" y="11" width="9" height="9" fill="#FFB900" />
    </svg>
  );
}

function ZohoIcon({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none">
      <rect width="24" height="24" rx="4" fill="#E42527" />
      <text x="4" y="17" fontFamily="Arial" fontWeight="bold" fontSize="11" fill="white">
        Z
      </text>
    </svg>
  );
}

const PROVIDER_META: Record<string, ProviderMeta> = {
  microsoft: {
    name: "Microsoft 365",
    icon: MicrosoftIcon,
    description: "Outlook, Calendar & Teams",
    features: ["Send & read emails", "View calendar events", "Teams chat"],
    color: "#0078D4",
  },
  zoho: {
    name: "Zoho People",
    icon: ZohoIcon,
    description: "Leave & Attendance",
    features: ["Leave balances", "Attendance records", "Apply for leave"],
    color: "#E42527",
  },
};

interface ConnectionStatus {
  provider: string;
  connected: boolean;
  email: string | null;
  connected_at: string | null;
  scopes: string | null;
}

function ConnectedAccounts({ userEmail }: { userEmail: string }) {
  const [connections, setConnections] = useState<ConnectionStatus[]>([]);
  const [loading, setLoading] = useState(true);
  const [connecting, setConnecting] = useState<string | null>(null);
  const [disconnecting, setDisconnecting] = useState<string | null>(null);

  const authHeaders = useMemo(
    () => ({
      "Content-Type": "application/json",
      "x-user-email": userEmail,
    }),
    [userEmail],
  );

  const fetchStatus = useCallback(async () => {
    try {
      const res = await fetch("/api/integrations/status", { headers: authHeaders });
      if (res.ok) {
        setConnections(await res.json());
      }
    } catch {
      // silent
    } finally {
      setLoading(false);
    }
  }, [authHeaders]);

  useEffect(() => {
    fetchStatus();
  }, [fetchStatus]);

  // Listen for postMessage from OAuth popup
  useEffect(() => {
    const handler = (e: MessageEvent) => {
      if (e.origin !== window.location.origin) return;
      if (e.data?.type === "oauth-callback") {
        setConnecting(null);
        fetchStatus();
      }
    };
    window.addEventListener("message", handler);
    return () => window.removeEventListener("message", handler);
  }, [fetchStatus]);

  const handleConnect = (provider: string) => {
    setConnecting(provider);
    const url = `/api/integrations/connect/${provider}?email=${encodeURIComponent(userEmail)}`;
    const w = 500,
      h = 650;
    const left = window.screenX + (window.outerWidth - w) / 2;
    const top = window.screenY + (window.outerHeight - h) / 2;
    const popup = window.open(
      url,
      `oauth_${provider}`,
      `width=${w},height=${h},left=${left},top=${top}`,
    );

    // Poll for popup close (fallback if postMessage fails)
    const timer = setInterval(() => {
      if (!popup || popup.closed) {
        clearInterval(timer);
        setConnecting(null);
        fetchStatus();
      }
    }, 500);
  };

  const handleDisconnect = async (provider: string) => {
    setDisconnecting(provider);
    try {
      await fetch(`/api/integrations/disconnect/${provider}`, {
        method: "DELETE",
        headers: authHeaders,
      });
      await fetchStatus();
    } catch {
      // silent
    } finally {
      setDisconnecting(null);
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center py-8">
        <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {Object.entries(PROVIDER_META).map(([key, meta]) => {
        const conn = connections.find((c) => c.provider === key);
        const isConnected = conn?.connected ?? false;
        const Icon = meta.icon;

        return (
          <div
            key={key}
            className={cn(
              "rounded-xl border p-4 transition-all",
              isConnected
                ? "border-green-500/30 bg-green-500/5"
                : "border-[var(--border)] hover:border-[var(--border-strong)]",
            )}
          >
            <div className="flex flex-col sm:flex-row sm:items-start justify-between gap-4">
              <div className="flex items-start gap-3 min-w-0">
                <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-[var(--muted)] shrink-0">
                  <Icon className="h-5 w-5" />
                </div>
                <div className="min-w-0">
                  <p className="text-[13px] font-semibold text-foreground">{meta.name}</p>
                  <p className="text-[11px] text-muted-foreground">{meta.description}</p>
                  {isConnected && conn?.email && (
                    <div className="flex items-center gap-1.5 mt-1.5 min-w-0">
                      <CheckCircle2 className="h-3 w-3 text-green-500 shrink-0" />
                      <span className="text-[11px] text-green-600 dark:text-green-400 font-medium break-all">
                        {conn.email}
                      </span>
                    </div>
                  )}
                  <div className="flex flex-wrap gap-1.5 mt-2">
                    {meta.features.map((f) => (
                      <span
                        key={f}
                        className="inline-flex items-center rounded-md bg-[var(--muted)] px-2 py-0.5 text-[10px] text-muted-foreground"
                      >
                        {f}
                      </span>
                    ))}
                  </div>
                </div>
              </div>
              <div className="shrink-0 flex justify-end sm:block">
                {isConnected ? (
                  <button
                    onClick={() => handleDisconnect(key)}
                    disabled={disconnecting === key}
                    className="inline-flex items-center justify-center gap-1.5 rounded-lg border border-red-200 dark:border-red-800 bg-red-50 dark:bg-red-950/30 px-3 py-1.5 text-[11px] font-medium text-red-600 dark:text-red-400 hover:bg-red-100 dark:hover:bg-red-950/50 transition-colors disabled:opacity-50 w-full sm:w-auto"
                  >
                    {disconnecting === key ? (
                      <Loader2 className="h-3 w-3 animate-spin" />
                    ) : (
                      <Unlink className="h-3 w-3" />
                    )}
                    Disconnect
                  </button>
                ) : (
                  <button
                    onClick={() => handleConnect(key)}
                    disabled={connecting === key}
                    className="inline-flex items-center justify-center gap-1.5 rounded-lg bg-primary px-3 py-1.5 text-[11px] font-medium text-primary-foreground hover:bg-primary/90 transition-colors disabled:opacity-50 w-full sm:w-auto"
                  >
                    {connecting === key ? (
                      <Loader2 className="h-3 w-3 animate-spin" />
                    ) : (
                      <ExternalLink className="h-3 w-3" />
                    )}
                    Connect
                  </button>
                )}
              </div>
            </div>
          </div>
        );
      })}
    </div>
  );
}

function SettingsPage() {
  const { user } = useAuth();
  const {
    buddyColorId,
    setBuddyColorId,
    buddyCharId,
    setBuddyCharId,
    buddyEnabled,
    setBuddyEnabled,
    buddyGender,
    setBuddyGender,
  } = useSettings();
  // Must be called at the top level (not inside JSX) to comply with Rules of Hooks
  const buddyColors = useBuddyColors();

  if (!user) return null;

  return (
    <div className="flex h-full w-full flex-col overflow-y-auto">
      {/* Header */}
      <motion.div
        initial={{ opacity: 0, y: -8 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.4, ease: [0.16, 1, 0.3, 1] }}
        className="sticky top-0 z-20 border-b border-[var(--border)] bg-background/80 backdrop-blur-xl px-4 py-4 sm:px-8 sm:py-5"
      >
        <h1 className="text-lg sm:text-xl font-semibold text-foreground tracking-tight">
          Settings
        </h1>
        <p className="text-[12px] sm:text-[13px] text-muted-foreground mt-0.5">
          Manage your preferences and personalization
        </p>
      </motion.div>

      <div className="flex-1 p-4 sm:p-8">
        <motion.div
          variants={container}
          initial="hidden"
          animate="show"
          className="mx-auto max-w-3xl space-y-6 sm:space-y-8"
        >
          {/* Profile Card */}
          <motion.div
            variants={item}
            className="rounded-2xl border border-[var(--border)] bg-card p-4 sm:p-6"
          >
            <div className="flex items-center gap-3 sm:gap-5">
              {user.avatarUrl ? (
                <img
                  src={user.avatarUrl}
                  alt={user.name}
                  className="h-12 w-12 sm:h-16 sm:w-16 rounded-2xl object-cover shadow-md shrink-0"
                />
              ) : (
                <div
                  className="flex h-12 w-12 sm:h-16 sm:w-16 items-center justify-center rounded-2xl text-lg sm:text-xl font-bold text-white shadow-sm shrink-0"
                  style={{ background: "var(--gradient-primary)" }}
                >
                  {user.name
                    .split(" ")
                    .map((n) => n[0]?.toUpperCase() ?? "")
                    .join("")}
                </div>
              )}
              <div className="flex-1 min-w-0">
                <h2 className="text-base sm:text-lg font-semibold text-foreground truncate">
                  {user.name}
                </h2>
                <p className="text-[11px] sm:text-[13px] text-muted-foreground truncate">
                  {user.email}
                </p>
                <div className="flex items-center gap-2 mt-2 flex-wrap">
                  <span className="inline-flex items-center gap-1 rounded-md bg-primary/10 px-2 py-0.5 text-[10px] sm:text-[11px] font-semibold text-primary">
                    <Shield className="h-3 w-3" />
                    {user.role}
                  </span>
                  {(user as any).department && (
                    <span className="text-[10px] sm:text-[11px] text-muted-foreground">
                      {(user as any).department}
                    </span>
                  )}
                </div>
              </div>
            </div>
          </motion.div>

          {/* Buddy Character Customization */}
          <motion.div
            variants={item}
            className="rounded-2xl border border-[var(--border)] bg-card overflow-hidden"
          >
            <div className="px-4 py-3 sm:px-6 sm:py-4 border-b border-[var(--border)] flex items-center justify-between">
              <div>
                <h3 className="text-[14px] sm:text-[15px] font-semibold text-foreground flex items-center gap-2">
                  <Bot className="h-4 w-4" style={{ color: "var(--clarity)" }} /> Buddy Companion
                </h3>
                <p className="text-[11px] text-muted-foreground mt-0.5">
                  Your vector-rigged active assistant in the sidebar.
                </p>
              </div>
              <Toggle on={buddyEnabled} onChange={setBuddyEnabled} />
            </div>

            <div className="p-4 sm:p-6 space-y-6">
              {/* Interactive Jail Cell / Open Cage display */}
              <div className="flex flex-col items-center">
                <AnimatePresence mode="wait">
                  {!buddyEnabled ? (
                    <motion.div
                      key="jail-locked"
                      initial={{ opacity: 0, scale: 0.95 }}
                      animate={{ opacity: 1, scale: 1 }}
                      exit={{ opacity: 0, scale: 0.95 }}
                      transition={{ duration: 0.3 }}
                      className="relative z-0 w-full max-w-sm h-56 bg-slate-950/80 border border-red-950/40 rounded-2xl overflow-hidden shadow-inner flex flex-col items-center justify-center p-4 border-dashed"
                    >
                      {/* Dark grid mesh background */}
                      <div className="absolute inset-0 bg-[linear-gradient(rgba(0,0,0,0.85),rgba(0,0,0,0.85)),url('data:image/svg+xml,%3Csvg xmlns=%22http://www.w3.org/2000/svg%22 width=%2210%22 height=%2210%22%3E%3Crect width=%2210%22 height=%2210%22 fill=%22%23020617%22/%3E%3Cpath d=%22M0 5h10M5 0v10%22 stroke=%22%231e293b%22 stroke-width=%220.5%22/%3E%3C/svg%3E')] opacity-45 pointer-events-none" />

                      {/* Locked Cage Bars */}
                      <div className="absolute inset-0 flex justify-between pointer-events-none px-6 z-10 overflow-hidden">
                        {[...Array(6)].map((_, i) => (
                          <div
                            key={i}
                            className="w-1.5 h-full bg-gradient-to-b from-slate-500 via-slate-300 to-slate-700 border-x border-black/40 shadow-xl"
                          />
                        ))}
                      </div>

                      {/* Trapped Character SVG */}
                      <motion.div
                        layoutId="sidebar-buddy-character"
                        transition={{ type: "spring", stiffness: 180, damping: 22 }}
                        className="relative z-0 select-none scale-110 mb-2 cursor-pointer"
                        onClick={() => setBuddyEnabled(true)}
                        whileHover={{ scale: 1.15 }}
                        title="Click to release me!"
                      >
                        <GreetingBotSVG
                          colors={buddyColors}
                          expression="heart"
                          isWaving={false}
                          size={54}
                          isSitting={false}
                          activity="sitting"
                          gender={getBuddyGender(user?.name, buddyGender)}
                        />
                      </motion.div>

                      {/* Status / Toggle button */}
                      <div className="relative z-20 mt-1 flex flex-col items-center">
                        <span className="text-[10px] font-bold text-red-500 uppercase tracking-[0.15em] animate-pulse bg-red-950/40 px-2 py-0.5 rounded border border-red-500/20">
                          Locked in Jail 🔒
                        </span>
                        <button
                          onClick={() => setBuddyEnabled(true)}
                          className="mt-2 text-[10px] font-bold bg-green-600 hover:bg-green-500 text-white px-3.5 py-1.5 rounded-xl shadow-md transition-colors"
                        >
                          🔓 Release Buddy!
                        </button>
                      </div>
                    </motion.div>
                  ) : (
                    <motion.div
                      key="jail-open"
                      initial={{ opacity: 0, scale: 0.95 }}
                      animate={{ opacity: 1, scale: 1 }}
                      exit={{ opacity: 0, scale: 0.95 }}
                      transition={{ duration: 0.3 }}
                      className="relative w-full max-w-sm h-40 bg-slate-950/10 border border-slate-800/20 rounded-2xl overflow-hidden flex flex-col items-center justify-center p-4"
                    >
                      {/* Swung open Cage bars (left and right sides) */}
                      <div className="absolute inset-y-0 left-0 w-8 flex justify-between pointer-events-none px-1.5 border-r border-slate-800 bg-slate-900/10">
                        {[...Array(3)].map((_, i) => (
                          <div key={i} className="w-1 h-full bg-slate-500/80 rounded" />
                        ))}
                      </div>
                      <div className="absolute inset-y-0 right-0 w-8 flex justify-between pointer-events-none px-1.5 border-l border-slate-800 bg-slate-900/10">
                        {[...Array(3)].map((_, i) => (
                          <div key={i} className="w-1 h-full bg-slate-500/80 rounded" />
                        ))}
                      </div>

                      <span className="text-[10px] font-bold text-green-500 uppercase tracking-[0.15em] bg-green-950/20 px-2 py-0.5 rounded border border-green-500/20 mb-1">
                        Free Companion 🏃‍♂️
                      </span>
                      <p className="text-[11px] text-muted-foreground font-medium text-center max-w-[200px] leading-relaxed">
                        Sitting dynamically on your sidebar profile card!
                      </p>

                      <button
                        onClick={() => setBuddyEnabled(false)}
                        className="mt-3 text-[10px] font-bold bg-slate-800 hover:bg-red-950 hover:text-red-300 text-slate-300 px-3 py-1.5 rounded-lg shadow-md transition-all border border-slate-700"
                      >
                        🔒 Put in Jail (Disable)
                      </button>
                    </motion.div>
                  )}
                </AnimatePresence>
              </div>

              {buddyEnabled && (
                <>
                  {/* Gender picker */}
                  <div>
                    <p className="text-[12px] sm:text-[13px] font-medium text-foreground mb-3">
                      Buddy Gender / Hairstyle
                    </p>
                    <div className="grid grid-cols-3 gap-2">
                      {(["auto", "male", "female"] as const).map((genderOption) => {
                        const isSelected = buddyGender === genderOption;
                        const labels = {
                          auto: "Auto-Detect 🤖",
                          male: "Always Male 🙋‍♂️",
                          female: "Always Female 🙋‍♀️",
                        };
                        return (
                          <motion.button
                            key={genderOption}
                            whileTap={{ scale: 0.95 }}
                            onClick={() => setBuddyGender(genderOption)}
                            className={cn(
                              "relative flex flex-col items-center justify-center gap-1.5 rounded-xl border-2 px-3 py-2.5 transition-all duration-150 text-[11px] font-semibold",
                              isSelected
                                ? "border-primary bg-primary/5 text-primary"
                                : "border-[var(--border)] hover:border-[var(--border-strong)] hover:bg-secondary/30 text-foreground",
                            )}
                          >
                            {isSelected && (
                              <motion.div
                                layoutId="settings-buddy-gender"
                                className="absolute inset-0 rounded-[10px] border-2 border-primary bg-primary/5"
                                transition={{ type: "spring", stiffness: 500, damping: 35 }}
                              />
                            )}
                            <span className="relative z-10">{labels[genderOption]}</span>
                          </motion.button>
                        );
                      })}
                    </div>
                  </div>

                  {/* Color preset picker */}
                  <div>
                    <p className="text-[12px] sm:text-[13px] font-medium text-foreground mb-3">
                      Color Theme
                    </p>
                    <div className="grid grid-cols-3 sm:grid-cols-6 gap-2">
                      {BUDDY_PRESETS.map((preset) => {
                        const isSelected = buddyColorId === preset.id;
                        return (
                          <motion.button
                            key={preset.id}
                            whileTap={{ scale: 0.93 }}
                            onClick={() => setBuddyColorId(preset.id)}
                            className={cn(
                              "relative flex flex-col items-center gap-1.5 rounded-xl border-2 px-2 py-3 transition-all duration-150",
                              isSelected
                                ? "border-primary bg-primary/5"
                                : "border-[var(--border)] hover:border-[var(--border-strong)]",
                            )}
                          >
                            {isSelected && (
                              <motion.div
                                layoutId="settings-buddy-color"
                                className="absolute inset-0 rounded-[10px] border-2 border-primary bg-primary/5"
                                transition={{ type: "spring", stiffness: 500, damping: 35 }}
                              />
                            )}
                            <div
                              className="relative z-10 h-7 w-7 rounded-full shadow-sm ring-1 ring-black/10"
                              style={{ background: preset.swatch }}
                            />
                            <span
                              className={cn(
                                "relative z-10 text-[10px] font-medium text-center leading-tight",
                                isSelected ? "text-primary" : "text-muted-foreground",
                              )}
                            >
                              {preset.label}
                            </span>
                          </motion.button>
                        );
                      })}
                    </div>
                  </div>

                  {/* Character picker */}
                  <div>
                    <p className="text-[12px] sm:text-[13px] font-medium text-foreground mb-3">
                      Reaction Set
                    </p>
                    <div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5">
                      {BUDDY_CHARACTERS.map((char) => {
                        const isSelected = buddyCharId === char.id;
                        return (
                          <motion.button
                            key={char.id}
                            whileTap={{ scale: 0.95 }}
                            onClick={() => setBuddyCharId(char.id)}
                            className={cn(
                              "relative flex flex-col items-center gap-1.5 rounded-xl border-2 px-3 py-3.5 transition-all duration-150",
                              isSelected
                                ? "border-primary bg-primary/5"
                                : "border-[var(--border)] hover:border-[var(--border-strong)] hover:bg-secondary/30",
                            )}
                          >
                            {isSelected && (
                              <motion.div
                                layoutId="settings-buddy-char"
                                className="absolute inset-0 rounded-[10px] border-2 border-primary bg-primary/5"
                                transition={{ type: "spring", stiffness: 500, damping: 35 }}
                              />
                            )}
                            <span className="relative z-10 text-2xl">{char.emoji}</span>
                            <span
                              className={cn(
                                "relative z-10 text-[12px] font-semibold",
                                isSelected ? "text-primary" : "text-foreground",
                              )}
                            >
                              {char.label}
                            </span>
                            <span className="relative z-10 text-[10px] text-muted-foreground text-center leading-tight">
                              {char.description}
                            </span>
                          </motion.button>
                        );
                      })}
                    </div>
                  </div>

                  {/* Live preview */}
                  <div>
                    <p className="text-[12px] sm:text-[13px] font-medium text-foreground mb-3">
                      AI Response States Preview
                    </p>
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                      <div className="flex flex-col items-center gap-2 rounded-xl border border-border/60 bg-muted/30 p-4">
                        <p className="text-[10px] uppercase tracking-widest text-muted-foreground font-semibold">
                          Thinking
                        </p>
                        <div className="transform scale-110">
                          <ThinkingBuddy activity="Preview mode" />
                        </div>
                      </div>
                      <div className="flex flex-col items-center gap-2 rounded-xl border border-border/60 bg-muted/30 p-4">
                        <p className="text-[10px] uppercase tracking-widest text-muted-foreground font-semibold">
                          Listening
                        </p>
                        <div className="transform scale-110 py-2">
                          <ListeningBuddy />
                        </div>
                      </div>
                    </div>
                  </div>
                </>
              )}
            </div>
          </motion.div>

          {/* Connected Accounts */}
          <motion.div
            variants={item}
            className="rounded-2xl border border-[var(--border)] bg-card overflow-hidden"
          >
            <div className="px-4 py-3 sm:px-6 sm:py-4 border-b border-[var(--border)]">
              <h3 className="text-[14px] sm:text-[15px] font-semibold text-foreground flex items-center gap-2">
                <Link2 className="h-4 w-4" style={{ color: "var(--clarity)" }} /> Connected Accounts
              </h3>
              <p className="text-[11px] text-muted-foreground mt-0.5">
                Connect your accounts to enable mail, calendar, and chat features through the
                assistant.
              </p>
            </div>
            <div className="p-4 sm:p-6">
              <ConnectedAccounts userEmail={user.email} />
            </div>
          </motion.div>
        </motion.div>
      </div>
    </div>
  );
}
