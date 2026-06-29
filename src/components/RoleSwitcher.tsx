import { useAuth } from "@/lib/auth-store";
import { getImpersonatedRole, setImpersonatedRole } from "@/lib/impersonation";
import { UserCog, Check } from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * Super-Admin-only role switcher (testing). Lets a real Super Admin act as any role to
 * verify the app's behaviour for that role. Non-destructive: the Super Admin grant is
 * never changed, and selecting "Super Admin (you)" exits testing. Hidden for everyone else.
 */
const ALL_ROLES: { label: string; slug: string }[] = [
  { label: "Employee", slug: "employee" },
  { label: "HR", slug: "hr" },
  { label: "IT", slug: "it" },
  { label: "PMO", slug: "pmo" },
  { label: "Functional Manager", slug: "functional manager" },
  { label: "Admin", slug: "admin" },
];

export function RoleSwitcher() {
  const { user } = useAuth();
  // Gate on the REAL role so the switcher stays visible while impersonating.
  if (user?.realRole !== "Super Admin") return null;

  const current = getImpersonatedRole(); // lower-case slug, or null when not impersonating

  const apply = (slug: string | null) => {
    setImpersonatedRole(slug);
    // Full reload so every component re-resolves the effective role cleanly.
    window.location.reload();
  };

  return (
    <div className="border-t border-border/40 mt-1.5 pt-1.5">
      <div className="px-3 py-1 flex items-center gap-1.5 mb-1">
        <UserCog className="h-3 w-3 text-primary" />
        <span className="text-[9px] font-bold uppercase tracking-[0.12em] text-muted-foreground/60">
          Test as role
        </span>
      </div>
      <div className="space-y-0.5 max-h-52 overflow-y-auto">
        <button
          onClick={() => apply(null)}
          className={cn(
            "flex w-full items-center gap-2.5 rounded-xl px-2.5 py-1.5 text-xs transition-all text-left",
            !current ? "bg-primary/10 text-primary font-semibold" : "text-foreground/75 hover:bg-muted/65 hover:text-foreground",
          )}
        >
          <span className="flex-1 truncate">Super Admin (you)</span>
          {!current && <Check className="h-3.5 w-3.5" />}
        </button>
        {ALL_ROLES.map((r) => {
          const active = current === r.slug;
          return (
            <button
              key={r.slug}
              onClick={() => apply(r.slug)}
              className={cn(
                "flex w-full items-center gap-2.5 rounded-xl px-2.5 py-1.5 text-xs transition-all text-left",
                active ? "bg-primary/10 text-primary font-semibold" : "text-foreground/75 hover:bg-muted/65 hover:text-foreground",
              )}
            >
              <span className="flex-1 truncate">{r.label}</span>
              {active && <Check className="h-3.5 w-3.5" />}
            </button>
          );
        })}
      </div>
      {current && (
        <p className="px-3 pt-1.5 text-[10px] leading-snug text-amber-500">
          Testing as <strong className="font-bold capitalize">{current}</strong>. Your Super Admin
          access is intact — pick “Super Admin (you)” to exit.
        </p>
      )}
    </div>
  );
}
