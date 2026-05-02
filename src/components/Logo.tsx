import { cn } from "@/lib/utils";

interface LogoProps {
  className?: string;
  size?: "sm" | "md" | "lg" | "xl";
}

const sizes = {
  sm: "h-6 w-6",
  md: "h-8 w-8",
  lg: "h-12 w-12",
  xl: "h-20 w-20",
};

export function Logo({ className, size = "md" }: LogoProps) {
  return (
    <div className={cn("relative flex items-center justify-center overflow-hidden rounded-xl", sizes[size], className)}>
      <img 
        src="/logo.png" 
        alt="Centriq AI Logo" 
        className="h-full w-full object-cover"
      />
    </div>
  );
}
