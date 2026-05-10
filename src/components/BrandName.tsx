import { cn } from "@/lib/utils";

interface BrandNameProps {
  className?: string;
  withAI?: boolean;
}

export function BrandName({ className, withAI = false }: BrandNameProps) {
  return (
    <span className={cn("inline-flex items-center font-extrabold tracking-tighter", className)}>
      <span 
        className="bg-clip-text text-transparent drop-shadow-sm"
        style={{
          backgroundImage: "linear-gradient(to right, var(--foreground) 0%, var(--primary) 100%)",
        }}
      >
        Centriq
      </span>
      {withAI && (
        <span className="ml-1.5 flex items-center justify-center rounded-md bg-primary/10 px-1.5 py-0.5 text-[0.7em] font-black uppercase tracking-widest text-primary ring-1 ring-inset ring-primary/20">
          AI
        </span>
      )}
    </span>
  );
}
