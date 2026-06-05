import { cn } from "@/lib/utils";
import { motion } from "framer-motion";

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
      className={cn(
        "relative flex items-center justify-center overflow-hidden rounded-xl shrink-0",
        sizes[size],
        className,
      )}
    >
      {/* 4C rotating gradient ring */}
      <motion.div
        className="absolute inset-0 rounded-xl"
        style={{
          background: "conic-gradient(from 0deg, var(--clarity), var(--connectivity), var(--collaboration), var(--capacity), var(--clarity))",
          padding: "1.5px",
          WebkitMask: "linear-gradient(#fff 0 0) content-box, linear-gradient(#fff 0 0)",
          WebkitMaskComposite: "destination-out",
          maskComposite: "exclude",
        }}
        animate={{ rotate: 360 }}
        transition={{ duration: 6, repeat: Infinity, ease: "linear" }}
      />
      {/* Logo image */}
      <img
        src="/logo.png"
        alt="Centriq AI Logo"
        className="relative h-full w-full object-cover rounded-xl"
        style={{ padding: "2px" }}
      />
    </div>
  );
}
