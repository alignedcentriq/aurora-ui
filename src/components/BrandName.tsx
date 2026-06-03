import { cn } from "@/lib/utils";

interface BrandNameProps {
  className?: string;
  withAI?: boolean;
}

export function BrandName({ className, withAI = false, plain = false }: BrandNameProps & { plain?: boolean }) {
  if (plain) {
    return (
      <span className={cn("font-bold", className)}>
        Centriq {withAI && <span className="text-[0.8em] opacity-80">AI</span>}
      </span>
    );
  }

  return (
    <span className={cn("inline-flex items-center font-extrabold tracking-tighter", className)}>
      <span className="text-current">
        Centriq
      </span>
      {withAI && (
        <span className="ml-1.5 flex items-center justify-center rounded-md px-1.5 py-0.5 text-[0.65em] font-black uppercase tracking-widest text-transparent bg-clip-text"
          style={{ background: "var(--gradient-primary)", WebkitBackgroundClip: "text", WebkitTextFillColor: "transparent" }}
        >
          AI
        </span>
      )}
    </span>
  );
}
