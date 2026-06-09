import { useAuth } from "@/lib/auth-store";
import { SecurityDigestTab } from "@/pages/ITPortal";
import { ShieldAlert } from "lucide-react";

export function SecurityDigestPage() {
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
          <p className="text-sm text-muted-foreground mt-2">Security Digest settings are reserved for Super Admin only.</p>
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full overflow-hidden">
      <div className="flex items-center justify-between px-8 py-6 border-b border-[var(--border)] shrink-0">
        <div>
          <h1 className="text-[20px] font-semibold text-foreground">Security Digest</h1>
          <p className="text-[13px] text-muted-foreground mt-0.5">
            Manage cybersecurity news digest — recipients, schedule, and sources
          </p>
        </div>
      </div>
      <div className="flex-1 overflow-auto px-8 py-6">
        <SecurityDigestTab authHeaders={authHeaders} />
      </div>
    </div>
  );
}
