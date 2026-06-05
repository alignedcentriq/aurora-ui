import { cn } from "@/lib/utils";

interface BrandNameProps {
  className?: string;
  withAI?: boolean;
  plain?: boolean;
}

export function BrandName({ className, withAI = false, plain = false }: BrandNameProps) {
  if (plain) {
    return (
      <span className={cn("font-bold", className)}>
        Centriq {withAI && <span className="text-[0.8em] opacity-80">AI</span>}
      </span>
    );
  }

  return (
    <span className={cn("inline-flex items-center font-extrabold tracking-tight", className)}>
      {/* Unique: "C" is gradient, rest is white */}
      <span
        className="font-black"
        style={{
          background: "var(--gradient-primary)",
          WebkitBackgroundClip: "text",
          WebkitTextFillColor: "transparent",
          backgroundClip: "text",
        }}
      >
        C
      </span>
      <span className="text-current">entriq</span>
      {withAI && (
        <span
          className="ml-1.5 flex items-center justify-center rounded-md px-1.5 py-0.5 text-[0.58em] font-black uppercase tracking-widest"
          style={{
            background: "var(--gradient-primary)",
            color: "#fff",
          }}
        >
          AI
        </span>
      )}
    </span>
  );
}
