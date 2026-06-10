import React from "react";
import { Loader2 } from "lucide-react";
import { cn } from "@/lib/utils";

export interface TableLoaderProps {
  className?: string;
  label?: string;
}

export function TableLoader({ className, label }: TableLoaderProps) {
  return (
    <div className={cn("flex h-40 items-center justify-center gap-2.5 text-sm text-muted-foreground", className)}>
      <Loader2 className="h-5 w-5 animate-spin text-[#94a3b8]" />
      {label && <span>{label}</span>}
    </div>
  );
}
