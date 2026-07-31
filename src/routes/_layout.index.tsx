import { createFileRoute } from "@tanstack/react-router";
import { AssistantView } from "@/components/assistant/AssistantView";
import { useAuth } from "@/lib/auth-store";
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
  const { user } = useAuth();
  const isMasterMode = useMasterModeStore((s) => s.isMasterMode);
  // Master Mode is owner-only (see the header switch in _layout.tsx). Re-checked here,
  // not just at the switch, since the flag persists in localStorage per-browser rather
  // than per-account — this keeps it from leaking to another user on the same machine.
  const canUseMasterMode = (user?.email ?? "").toLowerCase() === "shivam.sharma@alignedautomation.com";
  // Master Mode no longer replaces the chat home — it layers the inference cockpit
  // into it, so the composer and quick-glance cards stay available either way.
  return <AssistantView masterMode={isMasterMode && canUseMasterMode} />;
}
