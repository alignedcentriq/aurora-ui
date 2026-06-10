import React from "react";
import { motion } from "framer-motion";
import { cn } from "@/lib/utils";

export interface ToggleProps {
  on: boolean;
  onChange: (v: boolean) => void;
  activeColor?: string; // Tailwind class, e.g. "bg-primary" or "bg-emerald-500"
  inactiveColor?: string; // Tailwind class, e.g. "bg-muted" or "bg-zinc-600"
  className?: string;
}

export function Toggle({
  on,
  onChange,
  activeColor = "bg-primary",
  inactiveColor = "bg-muted",
  className,
}: ToggleProps) {
  return (
    <button
      onClick={() => onChange(!on)}
      type="button"
      className={cn(
        "h-6 w-11 rounded-full transition-colors duration-200 relative shrink-0 cursor-pointer focus:outline-none",
        on ? activeColor : inactiveColor,
        className
      )}
    >
      <motion.div
        layout
        transition={{ type: "spring", stiffness: 500, damping: 35 }}
        className={cn(
          "absolute top-0.5 h-5 w-5 rounded-full bg-white shadow-sm",
          on ? "left-[22px]" : "left-0.5"
        )}
      />
    </button>
  );
}
