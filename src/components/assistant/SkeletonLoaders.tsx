import { cn } from "@/lib/utils";

/**
 * Shimmer skeleton placeholders for premium loading states
 */

export function MessageSkeleton({ count = 3 }: { count?: number }) {
  return (
    <div className="space-y-6 animate-[fade-in_.3s_ease-out_both]">
      {Array.from({ length: count }).map((_, i) => (
        <div key={i} className={cn("flex gap-3", i % 2 === 0 ? "justify-start" : "justify-end")}>
          {i % 2 === 0 && <div className="h-6 w-6 rounded-xl shimmer shrink-0 mt-1" />}
          <div className={cn("space-y-2", i % 2 === 0 ? "max-w-[65%]" : "max-w-[50%]")}>
            <div
              className={cn("h-4 rounded-lg shimmer", i % 2 === 0 ? "w-full" : "w-3/4 ml-auto")}
            />
            <div
              className={cn("h-4 rounded-lg shimmer", i % 2 === 0 ? "w-4/5" : "w-full ml-auto")}
            />
            {i % 2 === 0 && <div className="h-4 w-2/3 rounded-lg shimmer" />}
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
            <div className="h-8 w-8 rounded-xl shimmer" />
            <div className="h-6 w-6 rounded-full shimmer" />
          </div>
          <div className="space-y-1.5">
            <div className="h-6 w-12 rounded-lg shimmer" />
            <div className="h-3 w-20 rounded shimmer" />
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
        <div className="h-5 w-48 rounded shimmer" />
        <div className="flex items-center justify-between">
          <div className="h-9 w-9 rounded-full shimmer" />
          <div className="h-9 w-9 rounded-full shimmer" />
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
          <div className="h-[18px] w-[18px] rounded shimmer shrink-0" />
          <div
            className={cn("h-3.5 rounded shimmer", i === 0 ? "w-12" : i === 1 ? "w-16" : "w-20")}
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
          <div className="h-4 w-32 rounded shimmer" />
          <div className="h-3 w-24 rounded shimmer" />
        </div>
        <div className="h-6 w-16 rounded-full shimmer" />
      </div>
      <div className="space-y-2">
        {Array.from({ length: 3 }).map((_, i) => (
          <div key={i} className="h-10 rounded-xl shimmer" />
        ))}
      </div>
      <div className="flex justify-end">
        <div className="h-8 w-28 rounded-xl shimmer" />
      </div>
    </div>
  );
}
