import { createFileRoute } from "@tanstack/react-router";
import { AssistantView } from "@/components/assistant/AssistantView";
import { MasterModeLanding } from "@/components/three/MasterModeLanding";
import { useMasterModeStore } from "@/lib/master-mode-store";

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
  const isMasterMode = useMasterModeStore((s) => s.isMasterMode);
  return isMasterMode ? <MasterModeLanding /> : <AssistantView />;
}
