import { Users, FileText, Wrench, Globe, ArrowUpRight, type LucideIcon } from "lucide-react";
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
    label: "Human Resources",
    description: "Leaves, payroll, policies & benefits",
    icon: Users,
    color: "bg-blue-600",
  },
  {
    key: "admin",
    label: "Admin",
    description: "Document requests & forms",
    icon: FileText,
    color: "bg-emerald-600",
  },
  {
    key: "it",
    label: "IT Support",
    description: "Tool access & escalations",
    icon: Wrench,
    color: "bg-purple-600",
  },
  {
    key: "org",
    label: "Organization",
    description: "Org info & announcements",
    icon: Globe,
    color: "bg-orange-600",
  },
];

export function QuickActions({ onPick }: { onPick: (prompt: string) => void }) {
  return (
    <div className="grid grid-cols-1 gap-6 sm:grid-cols-2 lg:grid-cols-4">
      {domains.map((d, i) => {
        const Icon = d.icon;
        return (
          <button
            key={d.key}
            onClick={() => onPick(d.label)}
            className="group relative flex flex-col items-start gap-4 rounded-3xl border border-gray-200 bg-white p-8 text-left shadow-sm transition-all hover:border-gray-300 hover:shadow-md animate-[slide-up_.5s_ease-out_both] dark:border-white/10 dark:bg-white/5"
            style={{ animationDelay: `${i * 100}ms` }}
          >
            <div className="flex w-full items-center justify-between">
              <div className={cn("flex h-12 w-12 items-center justify-center rounded-full text-white shadow-sm", d.color)}>
                <Icon className="h-6 w-6" strokeWidth={2} />
              </div>
              <ArrowUpRight className="h-5 w-5 text-gray-300 transition-colors group-hover:text-gray-500 dark:text-white/20 dark:group-hover:text-white/40" />
            </div>

            <div className="mt-2">
              <h3 className="text-lg font-bold text-gray-900 dark:text-white">{d.label}</h3>
              <p className="mt-2 text-sm leading-relaxed text-gray-500 dark:text-gray-400">
                {d.description}
              </p>
            </div>

            {/* Subtle Hover Effect */}
            <div className="absolute inset-0 rounded-3xl bg-gray-500/0 transition-colors group-hover:bg-gray-500/5 dark:group-hover:bg-white/5" />
          </button>
        );
      })}
    </div>
  );
}
