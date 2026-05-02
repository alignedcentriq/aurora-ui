import { createFileRoute } from "@tanstack/react-router";
import { AssistantView } from "@/components/assistant/AssistantView";

export const Route = createFileRoute("/_layout/")({
  head: () => ({
    meta: [
      { title: "Nexus — One AI assistant for HR, IT, Admin & Org" },
      {
        name: "description",
        content:
          "Nexus replaces multi-system navigation with a single conversation. Apply leave, reset VPN, fetch payslips, find policies — all in one chat.",
      },
      { property: "og:title", content: "Nexus — Workplace AI Concierge" },
      {
        property: "og:description",
        content:
          "Skip the tabs. Ask once. Nexus unifies HR, IT, Admin and Org tools into a single conversational assistant.",
      },
    ],
  }),
  component: Index,
});

function Index() {
  return <AssistantView />;
}
