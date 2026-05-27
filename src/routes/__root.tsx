import { createRootRoute, Outlet, HeadContent, Scripts } from "@tanstack/react-router";
import * as React from "react";
import { BluffApp } from "../components/BluffApp";
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
import { motion } from "framer-motion";

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
  // Bluff ON by default (null or "1"). Only "0" means real UI.
  const [isBluff, setIsBluff] = React.useState(
    !isBrowser || localStorage.getItem("centriq_bluff") !== "0"
  );

  // Secret toggle: Ctrl+Shift+B flips bluff mode
  React.useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.ctrlKey && e.shiftKey && e.key === "B") {
        const next = localStorage.getItem("centriq_bluff") !== "0" ? "0" : "1";
        localStorage.setItem("centriq_bluff", next);
        setIsBluff(next !== "0");
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, []);

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

  if (isBrowser && isBluff) {
    return (
      <RootDocument>
        <BluffApp />
      </RootDocument>
    );
  }

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

/** Premium splash / loading screen */
function SplashScreen() {
  return (
    <div className="flex min-h-screen items-center justify-center bg-background relative overflow-hidden">
      <AnimatedBackground />
      <motion.div
        initial={{ opacity: 0, scale: 0.9 }}
        animate={{ opacity: 1, scale: 1 }}
        transition={{ duration: 0.6, ease: [0.16, 1, 0.3, 1] }}
        className="flex flex-col items-center gap-6"
      >
        <motion.div
          animate={{ scale: [1, 1.05, 1] }}
          transition={{ duration: 2, repeat: Infinity, ease: "easeInOut" }}
        >
          <Logo size="lg" className="shadow-2xl shadow-primary/20" />
        </motion.div>
        <div className="h-1 w-40 overflow-hidden rounded-full bg-muted">
          <motion.div
            className="h-full rounded-full"
            style={{ background: "var(--gradient-primary)" }}
            initial={{ x: "-100%" }}
            animate={{ x: "200%" }}
            transition={{ duration: 1.5, repeat: Infinity, ease: "easeInOut" }}
          />
        </div>
      </motion.div>
    </div>
  );
}

function LoginView() {
  const { login, isInteracting } = useAuth();

  return (
    <div className="flex min-h-screen flex-col items-center justify-center bg-background px-4 relative overflow-hidden">
      <AnimatedBackground />

      <motion.div
        initial={{ opacity: 0, y: 30 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.7, ease: [0.16, 1, 0.3, 1] }}
        className="relative w-full max-w-sm space-y-8 text-center z-10"
      >
        {/* Logo with glow */}
        <div className="flex flex-col items-center gap-5">
          <motion.div
            initial={{ scale: 0.8, opacity: 0 }}
            animate={{ scale: 1, opacity: 1 }}
            transition={{ delay: 0.1, duration: 0.5, type: "spring", stiffness: 200 }}
          >
            <Logo size="xl" className="shadow-2xl shadow-primary/25" />
          </motion.div>

          <motion.div
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.25, duration: 0.5 }}
          >
            <h1 className="text-3xl font-extrabold tracking-tight text-foreground">
              Welcome to{" "}
              <span className="text-gradient">Centriq</span>
            </h1>
            <p className="text-muted-foreground font-medium mt-2">
              Your intelligent workplace concierge
            </p>
          </motion.div>
        </div>

        {/* Sign-in button */}
        <motion.div
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.4, duration: 0.5 }}
        >
          <motion.button
            whileHover={{ scale: 1.01, y: -1 }}
            whileTap={{ scale: 0.98 }}
            onClick={() => login()}
            disabled={isInteracting}
            className={cn(
              "group relative flex w-full items-center justify-center gap-3 rounded-2xl border border-border bg-card/80 backdrop-blur-sm p-4 text-[15px] font-semibold text-foreground transition-all hover:shadow-xl hover:shadow-primary/10 hover:border-primary/20",
              isInteracting && "opacity-50 cursor-not-allowed",
            )}
          >
            {isInteracting ? (
              <div className="flex items-center gap-2">
                <motion.div
                  className="h-4 w-4 rounded-full border-2 border-primary border-t-transparent"
                  animate={{ rotate: 360 }}
                  transition={{ duration: 1, repeat: Infinity, ease: "linear" }}
                />
                Signing in...
              </div>
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
        <motion.p
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ delay: 0.6 }}
          className="text-[11px] text-muted-foreground/50 font-medium"
        >
          Powered by AI · Enterprise grade security
        </motion.p>
      </motion.div>
    </div>
  );
}

import { ThemeManager } from "@/lib/ThemeManager";

function AuthenticatedApp() {
  const { user, isLoading } = useAuth();

  if (isLoading) {
    return <SplashScreen />;
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
