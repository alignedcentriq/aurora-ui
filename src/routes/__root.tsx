import { Outlet, Link, createRootRoute, HeadContent, Scripts } from "@tanstack/react-router";
import { Toaster } from "sonner";
import { AuthProvider } from "../lib/auth-store";

import appCss from "../styles.css?url";

function NotFoundComponent() {
  return (
    <div className="flex min-h-screen items-center justify-center bg-background px-4">
      <div className="max-w-md text-center">
        <h1 className="text-7xl font-bold text-foreground">404</h1>
        <h2 className="mt-4 text-xl font-semibold text-foreground">Page not found</h2>
        <p className="mt-2 text-sm text-muted-foreground">
          The page you're looking for doesn't exist or has been moved.
        </p>
        <div className="mt-6">
          <Link
            to="/"
            className="inline-flex items-center justify-center rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90"
          >
            Go home
          </Link>
        </div>
      </div>
    </div>
  );
}

export const Route = createRootRoute({
  head: () => ({
    meta: [
      { charSet: "utf-8" },
      { name: "viewport", content: "width=device-width, initial-scale=1" },
      { title: "Centriq AI" },
    ],
    links: [
      {
        rel: "stylesheet",
        href: appCss,
      },
      {
        rel: "icon",
        type: "image/png",
        href: "/logo.png",
      },
    ],
  }),
  shellComponent: RootShell,
  component: RootComponent,
  notFoundComponent: NotFoundComponent,
});

function RootShell({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
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

import { useAuth } from "../lib/auth-store";
import { Logo } from "@/components/Logo";

function LoginView() {
  const { login } = useAuth();

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
          className="group relative flex w-full items-center justify-center gap-3 rounded-xl border border-border bg-card p-4 text-[15px] font-semibold text-foreground transition-all hover:bg-accent hover:shadow-lg active:scale-[0.98]"
        >
          <svg className="h-5 w-5 shrink-0" viewBox="0 0 23 23" fill="none">
            <path d="M11.5 2.3C6.42 2.3 2.3 6.42 2.3 11.5S6.42 20.7 11.5 20.7s9.2-4.12 9.2-9.2S16.58 2.3 11.5 2.3zm0 16.8c-4.19 0-7.6-3.41-7.6-7.6s3.41-7.6 7.6-7.6 7.6 3.41 7.6 7.6-3.41 7.6-7.6 7.6z" fill="currentColor" fillOpacity="0.2"/>
            <path d="M10.8 10.8H6.5V6.5h4.3v4.3zm5.7 0h-4.3V6.5h4.3v4.3zM10.8 16.5H6.5v-4.3h4.3v4.3zm5.7 0h-4.3v-4.3h4.3v4.3z" fill="currentColor"/>
          </svg>
          Sign in with Microsoft
        </button>

        <p className="text-[11px] text-muted-foreground/60 uppercase tracking-[0.12em] font-bold">
          SECURE ENTERPRISE SSO
        </p>
      </div>
    </div>
  );
}

function AuthenticatedContent() {
  const { user, isLoading } = useAuth();

  if (isLoading) return null;

  if (!user) {
    return <LoginView />;
  }

  return <Outlet />;
}

function RootComponent() {
  return (
    <AuthProvider>
      <AuthenticatedContent />
      <Toaster position="top-center" richColors />
    </AuthProvider>
  );
}
