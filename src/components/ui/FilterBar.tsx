import React from "react";
import { RefreshCw } from "lucide-react";
import { cn } from "@/lib/utils";

export interface FilterBarProps {
  filter: string;
  setFilter: (s: string) => void;
  options: string[];
  onRefresh: () => void;
  variant?: "pills" | "tabs";
  className?: string;
}

export function FilterBar({
  filter,
  setFilter,
  options,
  onRefresh,
  variant = "pills",
  className,
}: FilterBarProps) {
  return (
    <div className={cn("flex items-center justify-between mb-5", className)}>
      <div className={cn(
        "flex p-0.5",
        variant === "pills"
          ? "gap-0.5 bg-[#f1f5f9] dark:bg-white/[0.06] rounded-lg"
          : "gap-1"
      )}>
        {options.map((s) => (
          <button
            key={s}
            onClick={() => setFilter(s)}
            type="button"
            className={cn(
              "text-[13px] font-medium transition-all cursor-pointer",
              variant === "pills"
                ? cn(
                    "rounded-md px-4 py-1.5",
                    filter === s
                      ? "bg-white dark:bg-white/[0.12] text-[#0f172a] dark:text-white shadow-sm"
                      : "text-[#64748b] dark:text-white/40 hover:text-[#334155] dark:hover:text-white/60"
                  )
                : cn(
                    "rounded-lg px-3.5 py-1.5",
                    filter === s
                      ? "bg-primary/10 text-primary"
                      : "text-muted-foreground hover:bg-secondary hover:text-foreground"
                  )
            )}
          >
            {s}
          </button>
        ))}
      </div>
      <button
        onClick={onRefresh}
        type="button"
        className="flex items-center gap-1.5 rounded-lg border border-[#e2e8f0] dark:border-white/[0.1] bg-white dark:bg-card px-3.5 py-1.5 text-[13px] font-medium text-[#64748b] dark:text-white/50 hover:text-[#0f172a] dark:hover:text-white hover:border-[#cbd5e1] dark:hover:border-white/[0.15] transition-all cursor-pointer"
      >
        <RefreshCw className="h-3.5 w-3.5" />
        Refresh
      </button>
    </div>
  );
}
