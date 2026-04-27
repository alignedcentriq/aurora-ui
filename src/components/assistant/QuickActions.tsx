import { Users, Wrench, FileText, Megaphone, type LucideIcon } from "lucide-react";

type Domain = {
  key: string;
  label: string;
  description: string;
  examples: string[];
  icon: LucideIcon;
  accent: string;
};

const domains: Domain[] = [
  {
    key: "hr",
    label: "HR",
    description: "Leaves, payroll, benefits",
    examples: ["Apply leave", "Latest payslip", "Maternity policy"],
    icon: Users,
    accent: "emerald",
  },
  {
    key: "it",
    label: "IT",
    description: "Access, tools, escalations",
    examples: ["Reset VPN", "Install software", "Raise ticket"],
    icon: Wrench,
    accent: "cyan",
  },
  {
    key: "admin",
    label: "Admin",
    description: "Forms, documents, policies",
    examples: ["Address proof", "Travel form", "Meeting room"],
    icon: FileText,
    accent: "amber",
  },
  {
    key: "org",
    label: "Org",
    description: "Announcements & info",
    examples: ["Org chart", "Holiday list", "Town hall"],
    icon: Megaphone,
    accent: "blue",
  },
];

const accentStyles: Record<string, { glow: string; icon: string; border: string }> = {
  emerald: {
    glow: "from-emerald-400/25 to-transparent",
    icon: "text-emerald-400",
    border: "group-hover:border-emerald-400/40",
  },
  cyan: {
    glow: "from-[color:var(--accent-cyan)]/30 to-transparent",
    icon: "text-[color:var(--accent-cyan)]",
    border: "group-hover:border-[color:var(--accent-cyan)]/50",
  },
  amber: {
    glow: "from-amber-400/25 to-transparent",
    icon: "text-amber-400",
    border: "group-hover:border-amber-400/40",
  },
  blue: {
    glow: "from-[color:var(--accent-blue)]/30 to-transparent",
    icon: "text-[color:var(--accent-blue)]",
    border: "group-hover:border-[color:var(--accent-blue)]/50",
  },
};

export function QuickActions({ onPick }: { onPick: (prompt: string) => void }) {
  return (
    <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
      {domains.map((d, i) => {
        const Icon = d.icon;
        const s = accentStyles[d.accent];
        return (
          <div
            key={d.key}
            className="flex h-full animate-[slide-up_.5s_cubic-bezier(0.22,1,0.36,1)_both]"
            style={{ animationDelay: `${i * 60}ms` }}
          >
            <div
              className={`group relative flex h-full w-full flex-col overflow-hidden rounded-2xl border border-[var(--color-border)] bg-card/60 p-4 backdrop-blur-xl transition-all duration-300 hover:-translate-y-0.5 ${s.border}`}
              style={{ boxShadow: "var(--shadow-elevated)" }}
            >
              {/* ambient glow */}
              <div
                className={`pointer-events-none absolute -top-16 -right-16 h-40 w-40 rounded-full bg-gradient-to-br ${s.glow} blur-2xl opacity-60 transition-opacity duration-500 group-hover:opacity-100`}
              />
              <div className="relative flex flex-1 flex-col">
                <div className="flex items-center justify-between">
                  <div
                    className={`flex h-9 w-9 items-center justify-center rounded-lg border border-[var(--color-border-strong)] bg-surface/70 ${s.icon}`}
                  >
                    <Icon className="h-4 w-4" strokeWidth={2.25} />
                  </div>
                  <span className="font-mono text-[10px] uppercase tracking-[0.18em] text-muted-foreground">
                    {d.label}
                  </span>
                </div>
                <div className="mt-3 text-sm font-semibold tracking-tight">{d.description}</div>
                <div className="mt-auto pt-4 flex flex-wrap gap-1.5">
                  {d.examples.map((ex) => (
                    <button
                      key={ex}
                      onClick={() => onPick(ex)}
                      className="rounded-full border border-[var(--color-border)] bg-surface/60 px-2.5 py-1 text-[11px] text-muted-foreground transition-all hover:border-[color:var(--accent-cyan)]/40 hover:text-foreground"
                    >
                      {ex}
                    </button>
                  ))}
                </div>
              </div>
            </div>
          </div>
        );
      })}
    </div>
  );
}
