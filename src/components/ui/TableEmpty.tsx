import React from "react";
import { cn } from "@/lib/utils";

export interface TableEmptyProps {
  label?: string;
  className?: string;
  icon?: React.ReactNode;
  children?: React.ReactNode;
}

export function TableEmpty({ label, className, icon, children }: TableEmptyProps) {
  return (
    <div
      className={cn(
        "flex h-40 flex-col items-center justify-center gap-1.5 text-[13px] text-[#94a3b8] dark:text-white/40",
        className,
      )}
    >
      {icon && <div className="text-muted-foreground/60">{icon}</div>}
      {children ? children : <span>No {label || "items"} found</span>}
    </div>
  );
}
