import { cn } from "@/lib/utils";

function Skeleton({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={cn("shimmer animate-in fade-in duration-500 rounded-xl opacity-75", className)}
      {...props}
    />
  );
}

export { Skeleton };
