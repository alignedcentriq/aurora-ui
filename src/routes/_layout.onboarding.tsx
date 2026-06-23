import { createFileRoute } from "@tanstack/react-router";
import { OnboardingJourney } from "@/pages/OnboardingJourney";

export const Route = createFileRoute("/_layout/onboarding")({
  component: OnboardingJourney,
});
