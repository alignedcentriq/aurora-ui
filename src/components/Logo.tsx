import { cn } from "@/lib/utils";

interface LogoProps {
  className?: string;
  size?: "sm" | "md" | "lg" | "xl";
}

const sizes = {
  sm: "h-7 w-7",
  md: "h-9 w-9",
  lg: "h-14 w-14",
  xl: "h-20 w-20",
};

export function Logo({ className, size = "md" }: LogoProps) {
  return (
    <div
      className={cn("relative flex items-center justify-center shrink-0", sizes[size], className)}
    >
      {/* Logo image — screen blend drops the artwork's black backdrop; a radial mask feathers out
          the JPEG's compression noise near the edges so no square backdrop line survives */}
      <img
        src={`${import.meta.env.BASE_URL}logo.png`}
        alt="Centriq AI Logo"
        className="relative h-full w-full object-cover scale-125"
        style={{
          mixBlendMode: "screen",
          WebkitMaskImage: "radial-gradient(circle, white 55%, transparent 78%)",
          maskImage: "radial-gradient(circle, white 55%, transparent 78%)",
        }}
      />
    </div>
  );
}
