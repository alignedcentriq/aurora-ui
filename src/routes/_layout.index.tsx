import { createFileRoute } from "@tanstack/react-router";
import { AssistantView } from "@/components/assistant/AssistantView";
import { HomeRightRail } from "@/components/assistant/HomeRightRail";

export const Route = createFileRoute("/_layout/")({
  head: () => ({
    meta: [
      { title: "Centriq AI" },
      {
        name: "description",
        content:
          "Centriq replaces multi-system navigation with a single conversation. Apply leave, reset VPN, fetch payslips, find policies — all in one chat.",
      },
      { property: "og:title", content: "Centriq AI" },
      {
        property: "og:description",
        content:
          "Skip the tabs. Ask once. Centriq unifies HR, IT, Admin and Org tools into a single conversational assistant.",
      },
    ],
  }),
  component: Index,
});

function Index() {
  return (
    <div className="flex h-full w-full overflow-hidden">
      <div className="min-w-0 flex-1">
        <AssistantView />
      </div>
      <HomeRightRail />
    </div>
  );
}
