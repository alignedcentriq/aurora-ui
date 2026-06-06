import { createRootRoute, Outlet, HeadContent, Scripts } from "@tanstack/react-router";
import * as React from "react";
import { DefaultCatchBoundary } from "../components/DefaultCatchBoundary";
import { NotFound } from "../components/NotFound";
import appCss from "../styles.css?url";
import { seo } from "../utils/seo";
import { MsalProvider } from "@azure/msal-react";
import { msalInstance } from "../lib/msal";
import { AuthProvider, useAuth } from "../lib/auth-store";
import { Toaster } from "sonner";
import { cn } from "../lib/utils";
import { Logo } from "../components/Logo";
import { BrandName } from "../components/BrandName";
import { AnimatedBackground } from "../components/AnimatedBackground";
import { FlyingBanner } from "../components/FlyingBanner";
import { motion } from "framer-motion";
import { LoadingCharacterDisplay, LoadingDots } from "../components/LoadingCharacter";
import { useSettings } from "../lib/settings-store";
import GreetingBot from "../components/assistant/GreetingBot";
import { useBuddyStore } from "../lib/buddy-store";
import { SplashOverlay } from "../components/assistant/SplashOverlay";

export const Route = createRootRoute({
  head: () => ({
    meta: [
      {
        charSet: "utf-8",
      },
      {
        name: "viewport",
        content: "width=device-width, initial-scale=1",
      },
      ...seo({
        title: "Centriq AI | Intelligent Workplace Assistant",
        description:
          "Centriq is your intelligent workplace concierge, helping you manage HR tasks, IT requests, and admin services with ease.",
      }),
    ],
    links: [{ rel: "stylesheet", href: appCss }],
  }),
  errorComponent: (props) => (
    <RootDocument>
      <DefaultCatchBoundary {...props} />
    </RootDocument>
  ),
  notFoundComponent: () => (
    <RootDocument>
      <NotFound />
    </RootDocument>
  ),
  component: RootComponent,
});

function RootComponent() {
  const isBrowser = typeof window !== "undefined";
  const [isMsalInitialized, setIsMsalInitialized] = React.useState(false);

  // MSAL initialization — must run before any conditional returns (Rules of Hooks)
  React.useEffect(() => {
    if (isBrowser && msalInstance) {
      msalInstance
        .initialize()
        .then(() => {
          setIsMsalInitialized(true);
        })
        .catch((e) => {
          console.error("MSAL Init Error:", e);
          setIsMsalInitialized(true);
        });
    }
  }, [isBrowser]);

  if (!isBrowser || !isMsalInitialized) {
    return (
      <RootDocument>
        <SplashScreen />
      </RootDocument>
    );
  }

  return (
    <MsalProvider instance={msalInstance}>
      <AuthProvider>
        <RootDocument>
          <AuthenticatedApp />
        </RootDocument>
      </AuthProvider>
    </MsalProvider>
  );
}

/** Brand splash — just the Centriq AI heading */
function SplashScreen() {
  return (
    <div className="flex min-h-screen items-center justify-center bg-background relative overflow-hidden">
      <AnimatedBackground />

      <motion.h1
        initial={{ opacity: 0, scale: 0.96 }}
        animate={{ opacity: 1, scale: 1 }}
        transition={{ duration: 0.6, ease: [0.16, 1, 0.3, 1] }}
        className="relative z-10 text-4xl font-black tracking-tight text-4c"
      >
        Centriq AI
      </motion.h1>
    </div>
  );
}

/** 4C Enterprise Login */
function LoginView() {
  const { login, isInteracting } = useAuth();
  const { loadingCharId = "centriq", loadingCharCustom = "" } = (typeof useSettings === "function" ? useSettings() : {}) as { loadingCharId?: string; loadingCharCustom?: string };

  const FOUR_C = [
    { key: "C", label: "Clarity", color: "var(--clarity)" },
    { key: "C", label: "Connectivity", color: "var(--connectivity)" },
    { key: "C", label: "Collaboration", color: "var(--collaboration)" },
    { key: "C", label: "Capacity", color: "var(--capacity)" },
  ] as const;

  return (
    <div className="flex min-h-screen bg-background relative overflow-hidden">
      <AnimatedBackground />

      {/* Left side — 4C brand panel */}
      <motion.div
        initial={{ opacity: 0, x: -40 }}
        animate={{ opacity: 1, x: 0 }}
        transition={{ duration: 0.8, ease: [0.16, 1, 0.3, 1] }}
        className="hidden lg:flex flex-col justify-between w-[420px] shrink-0 relative p-12 border-r border-white/[0.06] overflow-hidden"
        style={{ background: "var(--gradient-sidebar)" }}
      >
        {/* Left brand strip */}
        <div className="absolute left-0 top-0 bottom-0 w-[3px]" style={{ background: "var(--gradient-primary)" }} />

        {/* Hex overlay */}
        <div
          className="absolute inset-0 pointer-events-none opacity-[0.05]"
          style={{
            backgroundImage: `url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='56' height='100'%3E%3Cpath d='M28 66L0 50V16L28 0l28 16v34L28 66zm0-6l22-13V19L28 6 6 19v28l22 13z' fill='none' stroke='%233B8FE8' stroke-width='0.5'/%3E%3C/svg%3E")`,
            backgroundSize: "56px 100px",
          }}
        />

        {/* Top logo */}
        <div className="flex items-center gap-3 relative z-10">
          <Logo size="sm" />
          <BrandName className="text-[16px] text-white font-bold" withAI={true} />
        </div>

        {/* 4C cards */}
        <div className="space-y-5 relative z-10">
          <p className="text-[11px] font-bold uppercase tracking-[0.2em] text-white/30 mb-6">
            Built on 4 Pillars
          </p>
          {FOUR_C.map((c, i) => (
            <motion.div
              key={c.label}
              initial={{ opacity: 0, x: -20 }}
              animate={{ opacity: 1, x: 0 }}
              transition={{ delay: 0.3 + i * 0.12, duration: 0.5 }}
              className="flex items-center gap-4 group"
            >
              <div
                className="flex h-10 w-10 items-center justify-center rounded-xl shrink-0 font-black text-white text-[16px]"
                style={{
                  background: `color-mix(in oklab, ${c.color} 18%, transparent)`,
                  border: `1px solid color-mix(in oklab, ${c.color} 25%, transparent)`,
                  color: c.color,
                }}
              >
                {c.key}
              </div>
              <span className="text-[14px] font-semibold" style={{ color: c.color }}>{c.label}</span>
            </motion.div>
          ))}
        </div>

        {/* Bottom tagline */}
        <p className="text-[11px] text-white/20 font-medium relative z-10">
          Enterprise Intelligence · Unified Workforce
        </p>
      </motion.div>

      {/* Right side — login card */}
      <div className="flex flex-1 items-center justify-center px-6">
        <motion.div
          initial={{ opacity: 0, y: 30 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.7, ease: [0.16, 1, 0.3, 1] }}
          className="relative w-full max-w-sm z-10"
        >
          {/* Card */}
          <div
            className="rounded-3xl border p-8 shadow-2xl space-y-7 relative overflow-hidden"
            style={{
              background: "rgba(255,255,255,0.92)",
              borderColor: "rgba(27,111,200,0.12)",
              backdropFilter: "blur(24px)",
            }}
          >
            {/* Scan-line effect */}
            <div className="scan-line-overlay absolute inset-0 pointer-events-none" />

            {/* Logo */}
            <div className="flex flex-col items-center gap-4 text-center">
              <motion.div
                initial={{ scale: 0.8, opacity: 0 }}
                animate={{ scale: 1, opacity: 1 }}
                transition={{ delay: 0.1, duration: 0.5, type: "spring", stiffness: 200 }}
                className="relative"
              >
                <LoadingCharacterDisplay charId={loadingCharId} customChar={loadingCharCustom} size="md" />
              </motion.div>

              <motion.div
                initial={{ opacity: 0, y: 8 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: 0.25 }}
              >
                <h1 className="text-2xl font-black tracking-tight">
                  Welcome to{" "}
                  <span className="text-4c">Centriq</span>
                </h1>
                <p className="text-[13px] text-muted-foreground font-medium mt-1.5">
                  Your intelligent workplace concierge
                </p>
              </motion.div>
            </div>

            {/* 4C indicator dots */}
            <div className="flex justify-center gap-2">
              {FOUR_C.map((c) => (
                <motion.div
                  key={c.label}
                  className="h-1.5 w-8 rounded-full"
                  style={{ background: c.color }}
                  animate={{ opacity: [0.5, 1, 0.5] }}
                  transition={{ duration: 2, repeat: Infinity, delay: FOUR_C.indexOf(c) * 0.5 }}
                  title={c.label}
                />
              ))}
            </div>

            {/* Sign-in button */}
            <motion.div
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.4 }}
            >
              <motion.button
                whileHover={{ scale: 1.015, y: -2 }}
                whileTap={{ scale: 0.98 }}
                onClick={() => login()}
                disabled={isInteracting}
                className={cn(
                  "group relative flex w-full items-center justify-center gap-3 rounded-2xl p-4 text-[14px] font-bold text-white transition-all overflow-hidden",
                  isInteracting && "opacity-70 cursor-not-allowed",
                )}
                style={{ background: "var(--gradient-primary)" }}
              >
                {/* Shimmer overlay */}
                <motion.div
                  className="absolute inset-0 opacity-0 group-hover:opacity-100 transition-opacity"
                  style={{
                    background: "linear-gradient(105deg, transparent 40%, rgba(255,255,255,0.15) 50%, transparent 60%)",
                  }}
                  animate={{ x: ["-100%", "200%"] }}
                  transition={{ duration: 2, repeat: Infinity, ease: "linear" }}
                />

                {isInteracting ? (
                  <>
                    <LoadingDots />
                    <span>Signing in...</span>
                  </>
                ) : (
                  <>
                    <svg className="h-5 w-5 shrink-0" viewBox="0 0 23 23" fill="none">
                      <path
                        d="M10.8 10.8H6.5V6.5h4.3v4.3zm5.7 0h-4.3V6.5h4.3v4.3zM10.8 16.5H6.5v-4.3h4.3v4.3zm5.7 0h-4.3v-4.3h4.3v4.3z"
                        fill="currentColor"
                      />
                    </svg>
                    <span>Sign in with Microsoft</span>
                  </>
                )}
              </motion.button>
            </motion.div>

            {/* Footer */}
            <p className="text-center text-[11px] text-muted-foreground/50 font-medium">
              Powered by AI · Enterprise-grade security
            </p>
          </div>
        </motion.div>
      </div>
    </div>
  );
}

import { ThemeManager } from "@/lib/ThemeManager";

function AccessDeniedView() {
  const { logout } = useAuth();
  return (
    <div className="flex min-h-screen items-center justify-center bg-background relative overflow-hidden">
      <AnimatedBackground />
      <div className="relative z-10 text-center space-y-4 p-8 max-w-sm">
        <div className="text-5xl">🔒</div>
        <h1 className="text-2xl font-black tracking-tight">Access Denied</h1>
        <p className="text-sm text-muted-foreground">
          Your account is not authorized to use this application. Contact your administrator to request access.
        </p>
        <button
          onClick={logout}
          className="mt-4 px-5 py-2 rounded-xl text-sm font-semibold text-white"
          style={{ background: "var(--gradient-primary)" }}
        >
          Sign out
        </button>
      </div>
    </div>
  );
}

function AuthenticatedApp() {
  const { user, isLoading, accessDenied } = useAuth();
  const { updateActiveTime } = useBuddyStore();
  const [showSplash, setShowSplash] = React.useState(true);

  React.useEffect(() => {
    if (!user) return;

    let lastLogged = 0;
    const handleActivity = () => {
      const now = Date.now();
      // Throttle localStorage writes to once every 30 seconds
      if (now - lastLogged > 30000) {
        lastLogged = now;
        updateActiveTime();
      }
    };

    window.addEventListener("mousedown", handleActivity);
    window.addEventListener("keydown", handleActivity);
    window.addEventListener("scroll", handleActivity);
    window.addEventListener("touchstart", handleActivity);

    // Initial ping
    handleActivity();

    return () => {
      window.removeEventListener("mousedown", handleActivity);
      window.removeEventListener("keydown", handleActivity);
      window.removeEventListener("scroll", handleActivity);
      window.removeEventListener("touchstart", handleActivity);
    };
  }, [user, updateActiveTime]);

  if (isLoading) {
    return <SplashScreen />;
  }

  if (accessDenied) {
    return <AccessDeniedView />;
  }

  if (!user) {
    return <LoginView />;
  }

  return (
    <>
      <ThemeManager />
      <AnimatedBackground />
      <Outlet />
      <Toaster position="top-right" expand={false} richColors />
      <FlyingBanner />
      {!showSplash && <GreetingBot />}
      {showSplash && <SplashOverlay onComplete={() => setShowSplash(false)} />}
    </>
  );
}

function RootDocument({ children }: { children: React.ReactNode }) {
  return (
    <html>
      <head>
        <HeadContent />
      </head>
      <body>
        {children}
        <Scripts />
      </body>
    </html>
  );
}
