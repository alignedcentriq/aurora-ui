import * as React from "react";
import { cva, type VariantProps } from "class-variance-authority";

import { cn } from "@/lib/utils";

const badgeVariants = cva(
  "inline-flex items-center rounded-full px-2.5 py-0.5 text-[10px] font-bold uppercase tracking-wider transition-all duration-200 focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2 select-none",
  {
    variants: {
      variant: {
        default: "bg-primary/15 text-primary border border-primary/20 shadow-sm shadow-primary/5",
        secondary: "bg-secondary text-secondary-foreground border border-border/40",
        destructive: "bg-destructive/15 text-destructive border border-destructive/20",
        outline: "text-foreground border border-border bg-background/40 backdrop-blur-sm",
        success: "bg-accent-emerald/15 text-accent-emerald border border-accent-emerald/20",
        warning: "bg-accent-amber/15 text-accent-amber border border-accent-amber/20",
        info: "bg-accent-cyan/15 text-accent-cyan border border-accent-cyan/20",
        violet: "bg-accent-violet/15 text-accent-violet border border-accent-violet/20",
      },
    },
    defaultVariants: {
      variant: "default",
    },
  },
);

export interface BadgeProps
  extends React.HTMLAttributes<HTMLDivElement>, VariantProps<typeof badgeVariants> {}

function Badge({ className, variant, ...props }: BadgeProps) {
  return <div className={cn(badgeVariants({ variant }), className)} {...props} />;
}

export { Badge, badgeVariants };
