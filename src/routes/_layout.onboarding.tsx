import { createFileRoute } from "@tanstack/react-router";
import { lazy, Suspense } from "react";
import { useAuth } from "@/lib/auth-store";
import { OnboardingJourney } from "@/pages/OnboardingJourney";

// HR/Admin/Super Admin get the management view (journey tracker, kickoff, content
// admin) at this same sidebar link instead of a separate Control Hub tile — one place
// for onboarding, for every audience. Lazy-loaded since it's a large, HR-only surface
// that most visitors to this route (regular employees viewing their own journey) never
// need to download.
const OnboardingTracker = lazy(() =>
  import("@/pages/OnboardingTracker").then((m) => ({ default: m.OnboardingTracker })),
);

const MANAGEMENT_ROLES = new Set(["HR", "Admin", "Super Admin"]);

function OnboardingRoute() {
  const { user } = useAuth();

  if (user?.role && MANAGEMENT_ROLES.has(user.role)) {
    return (
      <Suspense fallback={null}>
        <OnboardingTracker />
      </Suspense>
    );
  }

  return <OnboardingJourney />;
}

export const Route = createFileRoute("/_layout/onboarding")({
  component: OnboardingRoute,
});
