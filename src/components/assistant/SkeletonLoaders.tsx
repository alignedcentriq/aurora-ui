import { cn } from "@/lib/utils";
import { Skeleton } from "@/components/ui/skeleton";

/**
 * Shimmer skeleton placeholders for premium loading states
 * All skeletons use the Shadcn <Skeleton> component (shimmer + rounded-xl).
 */

export function MessageSkeleton({ count = 3 }: { count?: number }) {
  return (
    <div className="space-y-6 animate-[fade-in_.3s_ease-out_both]">
      {Array.from({ length: count }).map((_, i) => (
        <div key={i} className={cn("flex gap-3", i % 2 === 0 ? "justify-start" : "justify-end")}>
          {i % 2 === 0 && <Skeleton className="h-6 w-6 rounded-xl shrink-0 mt-1" />}
          <div className={cn("space-y-2", i % 2 === 0 ? "max-w-[65%]" : "max-w-[50%]")}>
            <Skeleton
              className={cn("h-4 rounded-lg", i % 2 === 0 ? "w-full" : "w-3/4 ml-auto")}
            />
            <Skeleton
              className={cn("h-4 rounded-lg", i % 2 === 0 ? "w-4/5" : "w-full ml-auto")}
            />
            {i % 2 === 0 && <Skeleton className="h-4 w-2/3 rounded-lg" />}
          </div>
        </div>
      ))}
    </div>
  );
}

export function WidgetSkeleton() {
  return (
    <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 w-full animate-[fade-in_.3s_ease-out_both]">
      {Array.from({ length: 4 }).map((_, i) => (
        <div key={i} className="rounded-2xl border border-border bg-card/60 p-4 space-y-3">
          <div className="flex items-center justify-between">
            <Skeleton className="h-8 w-8 rounded-xl" />
            <Skeleton className="h-6 w-6 rounded-full" />
          </div>
          <div className="space-y-1.5">
            <Skeleton className="h-6 w-12 rounded-lg" />
            <Skeleton className="h-3 w-20" />
          </div>
        </div>
      ))}
    </div>
  );
}

export function ComposerSkeleton() {
  return (
    <div className="animate-[fade-in_.3s_ease-out_both]">
      <div className="rounded-[24px] border border-border bg-card/60 p-4 space-y-3">
        <Skeleton className="h-5 w-48" />
        <div className="flex items-center justify-between">
          <Skeleton className="h-9 w-9 rounded-full" />
          <Skeleton className="h-9 w-9 rounded-full" />
        </div>
      </div>
    </div>
  );
}

export function SidebarSkeleton() {
  return (
    <div className="space-y-1 px-2 py-3 animate-[fade-in_.3s_ease-out_both]">
      {Array.from({ length: 5 }).map((_, i) => (
        <div key={i} className="flex items-center gap-3 px-3 py-2.5 rounded-xl">
          <Skeleton className="h-[18px] w-[18px] shrink-0" />
          <Skeleton
            className={cn("h-3.5", i === 0 ? "w-12" : i === 1 ? "w-16" : "w-20")}
          />
        </div>
      ))}
    </div>
  );
}

export function CardSkeleton() {
  return (
    <div className="rounded-2xl border border-border bg-card/60 p-5 space-y-4 animate-[fade-in_.3s_ease-out_both]">
      <div className="flex items-center justify-between">
        <div className="space-y-1.5">
          <Skeleton className="h-4 w-32" />
          <Skeleton className="h-3 w-24" />
        </div>
        <Skeleton className="h-6 w-16 rounded-full" />
      </div>
      <div className="space-y-2">
        {Array.from({ length: 3 }).map((_, i) => (
          <Skeleton key={i} className="h-10 w-full rounded-xl" />
        ))}
      </div>
      <div className="flex justify-end">
        <Skeleton className="h-8 w-28 rounded-xl" />
      </div>
    </div>
  );
}

/** Generic page-level loading skeleton: header bar + grid of cards */
export function PageSkeleton({ cards = 8 }: { cards?: number }) {
  return (
    <div className="flex flex-col h-full animate-[fade-in_.3s_ease-out_both]">
      {/* Header */}
      <div className="shrink-0 border-b border-border bg-card px-4 sm:px-6 py-3.5 space-y-3">
        <div className="flex items-center justify-between">
          <Skeleton className="h-6 w-48" />
          <Skeleton className="h-9 w-9 rounded-xl" />
        </div>
        <div className="flex gap-2">
          <Skeleton className="h-9 flex-1 rounded-xl" />
          <Skeleton className="h-9 w-36 rounded-xl" />
          <Skeleton className="h-9 w-36 rounded-xl" />
        </div>
      </div>
      {/* Grid */}
      <div className="flex-1 p-4 sm:p-6">
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-3">
          {Array.from({ length: cards }).map((_, i) => (
            <div key={i} className="rounded-2xl border border-border bg-card/60 p-4 space-y-3">
              <div className="flex items-center gap-3">
                <Skeleton className="h-12 w-12 rounded-full shrink-0" />
                <div className="space-y-1.5 flex-1">
                  <Skeleton className="h-4 w-3/4" />
                  <Skeleton className="h-3 w-1/2" />
                </div>
              </div>
              <Skeleton className="h-3 w-20" />
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

/** Row-based table skeleton */
export function TableSkeleton({ rows = 6, cols = 4 }: { rows?: number; cols?: number }) {
  return (
    <div className="space-y-0 animate-[fade-in_.3s_ease-out_both]">
      {Array.from({ length: rows }).map((_, i) => (
        <div
          key={i}
          className="flex items-center gap-4 px-4 py-3 border-b border-border last:border-0"
        >
          {Array.from({ length: cols }).map((_, j) => (
            <Skeleton
              key={j}
              className={cn(
                "h-4",
                j === 0 ? "w-32" : j === cols - 1 ? "w-16" : "flex-1",
              )}
            />
          ))}
        </div>
      ))}
    </div>
  );
}
