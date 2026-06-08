import { ErrorComponent, Link, rootRouteId, useMatch, useRouter } from "@tanstack/react-router";
import * as React from "react";

export function DefaultCatchBoundary({ error }: { error: Error }) {
  const router = useRouter();
  const match = useMatch({
    strict: false,
  });
  const isRoot = match.id === rootRouteId;

  return (
    <div className="flex flex-col items-center justify-center min-h-[400px] p-6 text-center">
      <div className="space-y-4">
        <h2 className="text-2xl font-bold tracking-tight">Something went wrong!</h2>
        <p className="text-muted-foreground max-w-[400px] mx-auto">
          {error.message || "An unexpected error occurred. Please try again or contact support."}
        </p>
        <div className="flex items-center justify-center gap-4 pt-4">
          <button
            onClick={() => router.invalidate()}
            className="px-4 py-2 text-sm font-medium transition-colors bg-primary text-white rounded-lg hover:bg-primary/90"
          >
            Try Again
          </button>
          {isRoot ? (
            <Link
              to="/"
              className="px-4 py-2 text-sm font-medium transition-colors border border-border rounded-lg hover:bg-accent"
            >
              Home
            </Link>
          ) : (
            <Link
              to="/"
              className="px-4 py-2 text-sm font-medium transition-colors border border-border rounded-lg hover:bg-accent"
            >
              Go to Home
            </Link>
          )}
        </div>
      </div>
    </div>
  );
}
