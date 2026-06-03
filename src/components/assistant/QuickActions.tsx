import { Users, Wrench, FileText, Megaphone, ArrowRight, Briefcase, type LucideIcon } from "lucide-react";
import { cn } from "@/lib/utils";
import { motion } from "framer-motion";

type Domain = {
  key: string;
  label: string;
  icon: LucideIcon;
  color: string;
  glowColor: string;
};

const domains: Domain[] = [
  {
    key: "hr",
    label: "HR & People",
    icon: Users,
    color: "bg-emerald-500/10 text-emerald-500",
    glowColor: "hover:shadow-emerald-500/10 hover:border-emerald-500/20",
  },
  {
    key: "pmo",
    label: "PMO & Projects",
    icon: Briefcase,
    color: "bg-rose-500/10 text-rose-500",
    glowColor: "hover:shadow-rose-500/10 hover:border-rose-500/20",
  },
  {
    key: "it",
    label: "IT Support",
    icon: Wrench,
    color: "bg-violet-500/10 text-violet-500",
    glowColor: "hover:shadow-violet-500/10 hover:border-violet-500/20",
  },
  {
    key: "admin",
    label: "Admin & Operations",
    icon: FileText,
    color: "bg-amber-500/10 text-amber-500",
    glowColor: "hover:shadow-amber-500/10 hover:border-amber-500/20",
  },
  {
    key: "org",
    label: "Org Directory",
    icon: Megaphone,
    color: "bg-blue-500/10 text-blue-500",
    glowColor: "hover:shadow-blue-500/10 hover:border-blue-500/20",
  },
];

const container = {
  hidden: { opacity: 0 },
  show: {
    opacity: 1,
    transition: { staggerChildren: 0.06, delayChildren: 0.1 },
  },
};

const item = {
  hidden: { opacity: 0, y: 12, scale: 0.95 },
  show: {
    opacity: 1,
    y: 0,
    scale: 1,
    transition: { type: "spring", stiffness: 300, damping: 25 },
  },
};

export function QuickActions({
  onPick,
  variant = "grid",
}: {
  onPick: (prompt: string) => void;
  variant?: "grid" | "list";
}) {
  return (
    <motion.div
      variants={container}
      initial="hidden"
      animate="show"
      className={cn("grid gap-3", variant === "grid" ? "grid-cols-1 sm:grid-cols-2 lg:grid-cols-5" : "grid-cols-1")}
    >
      {domains.map((d) => {
        const Icon = d.icon;
        return (
          <motion.button
            key={d.key}
            variants={item}
            whileHover={{ y: -3, transition: { duration: 0.2 } }}
            whileTap={{ scale: 0.97 }}
            onClick={() => onPick(d.label)}
            className={cn(
              "group relative flex flex-col items-center gap-3 rounded-2xl border border-border bg-card/40 p-5 text-center transition-all duration-300 hover:bg-card/70 hover:shadow-lg backdrop-blur-sm",
              d.glowColor,
              variant === "grid" ? "min-h-[120px]" : "flex-row p-4 min-h-0"
            )}
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
          </motion.button>
        );
      })}
    </motion.div>
  );
}
