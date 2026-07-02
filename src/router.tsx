import { createRouter, useRouter } from "@tanstack/react-router";
import { routeTree } from "./routeTree.gen";
// Side-effect import: in dev, unregister any stale production service worker that
// would otherwise intercept the dev server and blank the page. No-op in prod.
import "./lib/sw-guard";
// Side-effect import: installs the /centriq path-prefix fetch shim before any request.
import "./lib/api-base";

function DefaultErrorComponent({ error, reset }: { error: Error; reset: () => void }) {
  const router = useRouter();

  // "Failed to fetch dynamically imported module" means Vite regenerated chunk hashes
  // (after a file save / HMR / server restart) and the old URL is stale in the browser.
  // A full page reload fetches fresh URLs; router.invalidate() alone won't help here.
  const isStaleChunk = error.message?.includes("Failed to fetch dynamically imported module");

  const handleTryAgain = () => {
    if (isStaleChunk) {
      window.location.reload();
    } else {
      router.invalidate();
      reset();
    }
  };

  return (
    <div className="flex min-h-screen items-center justify-center bg-background px-4">
      <div className="max-w-md text-center">
        <div className="mx-auto mb-6 flex h-16 w-16 items-center justify-center rounded-full bg-destructive/10">
          <svg
            xmlns="http://www.w3.org/2000/svg"
            className="h-8 w-8 text-destructive"
            fill="none"
            viewBox="0 0 24 24"
            stroke="currentColor"
            strokeWidth={2}
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              d="M12 9v3.75m-9.303 3.376c-.866 1.5.217 3.374 1.948 3.374h14.71c1.73 0 2.813-1.874 1.948-3.374L13.949 3.378c-.866-1.5-3.032-1.5-3.898 0L2.697 16.126ZM12 15.75h.007v.008H12v-.008Z"
            />
          </svg>
        </div>
        <h1 className="text-2xl font-bold tracking-tight text-foreground">Something went wrong</h1>
        <p className="mt-2 text-sm text-muted-foreground">
          {isStaleChunk
            ? 'The app was updated. Click "Try again" to reload with the latest version.'
            : "An unexpected error occurred. Please try again."}
        </p>
        {import.meta.env.DEV && error.message && (
          <pre className="mt-4 max-h-40 overflow-auto rounded-md bg-muted p-3 text-left font-mono text-xs text-destructive">
            {error.message}
          </pre>
        )}
        <div className="mt-6 flex items-center justify-center gap-3">
          <button
            onClick={handleTryAgain}
            className="inline-flex items-center justify-center rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90"
          >
            Try again
          </button>
          <a
            href={import.meta.env.BASE_URL}
            className="inline-flex items-center justify-center rounded-md border border-input bg-background px-4 py-2 text-sm font-medium text-foreground transition-colors hover:bg-accent"
          >
            Go home
          </a>
        </div>
      </div>
    </div>
  );
}

export const getRouter = () => {
  const router = createRouter({
    routeTree,
    // App is mounted under /centriq behind nginx — keep client routing/links in sync.
    basepath: "/centriq",
    context: {},
    scrollRestoration: true,
    defaultPreloadStaleTime: 0,
    defaultErrorComponent: DefaultErrorComponent,
  });

  return router;
};
