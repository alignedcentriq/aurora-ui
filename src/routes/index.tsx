import { createFileRoute } from "@tanstack/react-router";
import { AssistantView } from "@/components/assistant/AssistantView";
import { AmbientBackground } from "@/components/AmbientBackground";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "Synapse — One AI assistant for HR, IT, Admin & Org" },
      {
        name: "description",
        content:
          "Synapse replaces multi-system navigation with a single conversation. Apply leave, reset VPN, fetch payslips, find policies — all in one chat.",
      },
      { property: "og:title", content: "Synapse — Workplace AI Concierge" },
      {
        property: "og:description",
        content:
          "Skip the tabs. Ask once. Synapse unifies HR, IT, Admin and Org tools into a single conversational assistant.",
      },
    ],
  }),
  component: Index,
});

function Index() {
  return (
    <>
      <AmbientBackground />
      <AssistantView />
    </>
  );
}
