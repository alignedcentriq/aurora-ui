import { useAuth } from "@/lib/auth-store";
import { ModelControlsTab } from "@/pages/ITPortal";
import { ShieldAlert } from "lucide-react";

export function LLMControlsPage() {
  const { user } = useAuth();

  const authHeaders = {
    "Content-Type": "application/json",
    ...(user?.email ? { "x-user-email": user.email } : {}),
    ...(user?.role ? { "x-user-role": user.role.toLowerCase() } : {}),
  };

  if (user?.role !== "Super Admin") {
    return (
      <div className="flex h-full items-center justify-center text-muted-foreground">
        <div className="text-center max-w-sm px-4">
          <div className="mx-auto mb-5 flex h-14 w-14 items-center justify-center rounded-2xl bg-destructive/10 text-destructive border border-destructive/20">
            <ShieldAlert className="h-6 w-6" />
          </div>
          <h2 className="text-lg font-bold text-foreground">Access Restricted</h2>
          <p className="text-sm text-muted-foreground mt-2">
            LLM Model Controls are reserved for Super Admin only.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full overflow-hidden">
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 px-8 py-6 border-b border-[var(--border)] shrink-0">
        <div>
          <p className="text-[13px] text-muted-foreground mt-0.5">
            Runtime kill switch, GPU throttle, per-tier model parameters, and domain toggles
          </p>
        </div>
      </div>
      <div className="flex-1 overflow-auto px-8 py-6">
        <ModelControlsTab authHeaders={authHeaders} />
      </div>
    </div>
  );
}
