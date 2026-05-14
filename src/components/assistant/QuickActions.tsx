import { Users, Wrench, FileText, Megaphone, ArrowRight, Briefcase, type LucideIcon } from "lucide-react";
import { cn } from "@/lib/utils";

type Domain = {
  key: string;
  label: string;
  icon: LucideIcon;
  color: string;
};

const domains: Domain[] = [
  {
    key: "hr",
    label: "HR & People",
    icon: Users,
    color: "bg-emerald-500/10 text-emerald-500",
  },
  {
    key: "pmo",
    label: "PMO & Projects",
    icon: Briefcase,
    color: "bg-rose-500/10 text-rose-500",
  },
  {
    key: "it",
    label: "IT Support",
    icon: Wrench,
    color: "bg-violet-500/10 text-violet-500",
  },
  {
    key: "admin",
    label: "Admin & Operations",
    icon: FileText,
    color: "bg-amber-500/10 text-amber-500",
  },
  {
    key: "org",
    label: "Org Directory",
    icon: Megaphone,
    color: "bg-blue-500/10 text-blue-500",
  },
];

export function QuickActions({
  onPick,
  variant = "grid",
}: {
  onPick: (prompt: string) => void;
  variant?: "grid" | "list";
}) {
  return (
    <div className={cn("grid gap-4", variant === "grid" ? "grid-cols-1 sm:grid-cols-2 lg:grid-cols-5" : "grid-cols-1")}>
      {domains.map((d, i) => {
        const Icon = d.icon;
        return (
          <button
            key={d.key}
            onClick={() => onPick(d.label)}
            className={cn(
              "group relative flex flex-col items-center gap-3 rounded-[20px] border border-[var(--border)] bg-card/30 p-5 text-center transition-all duration-300 hover:bg-card/50 hover:shadow-md animate-[slide-up_.5s_ease-out_both] backdrop-blur-md",
              variant === "grid" ? "min-h-[120px]" : "flex-row p-4 min-h-0"
            )}
            style={{ animationDelay: `${i * 100}ms` }}
          >
            <div
              className={cn(
                "flex items-center justify-center rounded-xl transition-transform duration-300 group-hover:scale-110 shrink-0",
                variant === "grid" ? "h-12 w-12" : "h-8 w-8",
                d.color,
              )}
            >
              <Icon className={cn(variant === "grid" ? "h-6 w-6" : "h-4 w-4")} strokeWidth={1.5} />
            </div>

            <div className="flex-1 min-w-0">
              <h3 className={cn("font-semibold text-foreground truncate", variant === "grid" ? "text-[14px]" : "text-[13px]")}>{d.label}</h3>
            </div>
          </button>
        );
      })}
    </div>
  );
}
