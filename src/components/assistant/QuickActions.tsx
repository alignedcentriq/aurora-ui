import { Users, Wrench, FileText, Megaphone, ArrowRight, type LucideIcon } from "lucide-react";
import { cn } from "@/lib/utils";

type Domain = {
  key: string;
  label: string;
  description: string;
  icon: LucideIcon;
  color: string;
};

const domains: Domain[] = [
  {
    key: "hr",
    label: "HR & People",
    description: "Manage your leaves, salary and employee benefits seamlessly.",
    icon: Users,
    color: "bg-emerald-500/10 text-emerald-500",
  },
  {
    key: "it",
    label: "IT Support",
    description: "Get help with hardware, software and network access requests.",
    icon: Wrench,
    color: "bg-violet-500/10 text-violet-500",
  },
  {
    key: "admin",
    label: "Admin & Operations",
    description: "Access company policies, documents and workplace tools.",
    icon: FileText,
    color: "bg-amber-500/10 text-amber-500",
  },
  {
    key: "org",
    label: "Org Directory",
    description: "Find colleagues, team info and company-wide announcements.",
    icon: Megaphone,
    color: "bg-blue-500/10 text-blue-500",
  },
];

export function QuickActions({ onPick }: { onPick: (prompt: string) => void }) {
  return (
    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
      {domains.map((d, i) => {
        const Icon = d.icon;
        return (
          <button
            key={d.key}
            onClick={() => onPick(d.label)}
            className="group relative flex flex-col items-start gap-4 rounded-2xl border border-[var(--border)] bg-card/50 p-6 text-left transition-all duration-300 hover:border-primary/30 hover:bg-card/80 hover:shadow-lg animate-[slide-up_.5s_ease-out_both] backdrop-blur-sm"
            style={{ animationDelay: `${i * 100}ms` }}
          >
            <div className={cn("flex h-12 w-12 items-center justify-center rounded-xl transition-transform duration-300 group-hover:scale-110", d.color)}>
              <Icon className="h-6 w-6" strokeWidth={2} />
            </div>

            <div className="flex-1">
              <div className="flex items-center justify-between">
                <h3 className="text-base font-bold text-foreground">{d.label}</h3>
                <ArrowRight className="h-4 w-4 opacity-0 -translate-x-2 transition-all group-hover:opacity-100 group-hover:translate-x-0 text-primary" />
              </div>
              <p className="mt-1 text-sm leading-relaxed text-muted-foreground">
                {d.description}
              </p>
            </div>

            {/* Subtle Gradient Hover */}
            <div className="absolute inset-0 -z-10 bg-gradient-to-br from-primary/5 to-transparent opacity-0 transition-opacity group-hover:opacity-100 rounded-2xl" />
          </button>
        );
      })}
    </div>
  );
}
