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
          "Centriq is your intelligent workplace concierge, helping you manage HR tasks, IT requests, and payroll with ease.",
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
        <div className="flex min-h-screen items-center justify-center bg-background">
          <Logo size="lg" className="animate-pulse" />
        </div>
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

function LoginView() {
  const { login, isInteracting } = useAuth();

  return (
    <div className="flex min-h-screen flex-col items-center justify-center bg-background px-4">
      <div className="w-full max-w-sm space-y-8 text-center">
        <div className="flex flex-col items-center gap-4">
          <Logo size="xl" className="shadow-2xl shadow-primary/20" />
          <h1 className="text-3xl font-bold tracking-tight text-foreground">Welcome to Centriq</h1>
          <p className="text-muted-foreground font-medium">
            Your intelligent workplace concierge. Please sign in to continue.
          </p>
        </div>

        <button
          onClick={() => login()}
          disabled={isInteracting}
          className={cn(
            "group relative flex w-full items-center justify-center gap-3 rounded-xl border border-border bg-card p-4 text-[15px] font-semibold text-foreground transition-all hover:bg-accent hover:shadow-lg active:scale-[0.98]",
            isInteracting && "opacity-50 cursor-not-allowed",
          )}
        >
          {isInteracting ? (
            <div className="flex items-center gap-2">
              <div className="h-4 w-4 animate-spin rounded-full border-2 border-primary border-t-transparent" />
              Signing in...
            </div>
          ) : (
            <>
              <svg className="h-5 w-5 shrink-0" viewBox="0 0 23 23" fill="none">
                <path
                  d="M11.5 2.3C6.42 2.3 2.3 6.42 2.3 11.5S6.42 20.7 11.5 20.7s9.2-4.12 9.2-9.2S16.58 2.3 11.5 2.3zm0 16.8c-4.19 0-7.6-3.41-7.6-7.6s3.41-7.6 7.6-7.6 7.6 3.41 7.6 7.6-3.41 7.6-7.6 7.6z"
                  fill="currentColor"
                  fillOpacity="0.2"
                />
                <path
                  d="M10.8 10.8H6.5V6.5h4.3v4.3zm5.7 0h-4.3V6.5h4.3v4.3zM10.8 16.5H6.5v-4.3h4.3v4.3zm5.7 0h-4.3v-4.3h4.3v4.3z"
                  fill="currentColor"
                />
              </svg>
              <span>Sign in with Microsoft</span>
            </>
          )}
        </button>
      </div>
    </div>
  );
}

function AuthenticatedApp() {
  const { user, isLoading } = useAuth();

  if (isLoading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background">
        <div className="flex flex-col items-center gap-4">
          <Logo size="lg" className="animate-pulse" />
          <div className="h-1 w-32 overflow-hidden rounded-full bg-muted">
            <div className="h-full w-1/2 animate-progress rounded-full bg-primary" />
          </div>
        </div>
      </div>
    );
  }

  if (!user) {
    return <LoginView />;
  }

  return (
    <>
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
