import { useAuth } from "@/lib/auth-store";
import { getImpersonatedRole, setImpersonatedRole } from "@/lib/impersonation";
import { Check, FlaskConical } from "lucide-react";
import { cn } from "@/lib/utils";

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
  if (user?.realRole !== "Super Admin") return null;

  const current = getImpersonatedRole();

  const apply = (slug: string | null) => {
    setImpersonatedRole(slug);
    window.location.reload();
  };

  return (
    <div className="border-t border-zinc-700/50 mt-1.5 pt-2 pb-0.5">
      <div className="px-2.5 mb-1.5 flex items-center gap-1.5">
        <FlaskConical className="h-3 w-3 text-indigo-400 shrink-0" />
        <span className="text-[9px] font-bold uppercase tracking-[0.12em] text-zinc-500">
          Test as role
        </span>
      </div>

      <div className="space-y-0.5">
        <button
          onClick={() => apply(null)}
          className={cn(
            "flex w-full items-center gap-2 rounded-lg px-2.5 py-1.5 text-[11px] font-medium transition-all text-left cursor-pointer",
            !current
              ? "bg-indigo-500/15 text-indigo-300"
              : "text-zinc-400 hover:bg-zinc-700/50 hover:text-zinc-100",
          )}
        >
          <span className="flex-1 truncate">Super Admin (you)</span>
          {!current && <Check className="h-3 w-3 shrink-0 text-indigo-400" />}
        </button>

        {ALL_ROLES.map((r) => {
          const active = current === r.slug;
          return (
            <button
              key={r.slug}
              onClick={() => apply(r.slug)}
              className={cn(
                "flex w-full items-center gap-2 rounded-lg px-2.5 py-1.5 text-[11px] font-medium transition-all text-left cursor-pointer",
                active
                  ? "bg-indigo-500/15 text-indigo-300"
                  : "text-zinc-400 hover:bg-zinc-700/50 hover:text-zinc-100",
              )}
            >
              <span className="flex-1 truncate">{r.label}</span>
              {active && <Check className="h-3 w-3 shrink-0 text-indigo-400" />}
            </button>
          );
        })}
      </div>

      {current && (
        <div className="mx-1 mt-2 mb-0.5 rounded-lg bg-amber-500/10 border border-amber-500/20 px-2.5 py-1.5">
          <p className="text-[10px] leading-snug text-amber-400">
            Testing as <span className="font-bold capitalize">{current}</span>. Pick &quot;Super Admin (you)&quot; to exit.
          </p>
        </div>
      )}
    </div>
  );
}
