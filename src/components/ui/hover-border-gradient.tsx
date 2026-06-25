import React, { useState, useEffect } from "react";
import { motion } from "framer-motion";
import { cn } from "@/lib/utils";

type Direction = "TOP" | "LEFT" | "BOTTOM" | "RIGHT";

export function HoverBorderGradient({
  children,
  containerClassName,
  className,
  as: Tag = "button",
  duration = 1,
  hovered = false,
  ...props
}: React.HTMLAttributes<HTMLElement> & {
  containerClassName?: string;
  as?: React.ElementType;
  duration?: number;
  hovered?: boolean;
  disabled?: boolean;
}) {
  const [hover, setHover] = useState(hovered);
  const [direction, setDirection] = useState<Direction>("TOP");

  const rotateDirection = (currentDirection: Direction): Direction => {
    const directions: Direction[] = ["TOP", "RIGHT", "BOTTOM", "LEFT"];
    const nextIndex = directions.indexOf(currentDirection) + 1;
    return directions[nextIndex % directions.length];
  };

  useEffect(() => {
    if (!hover) return;
    const interval = setInterval(() => {
      setDirection((prevState) => rotateDirection(prevState));
    }, duration * 1000);
    return () => clearInterval(interval);
  }, [hover]);

  const mapDirectionToCorner: Record<Direction, string> = {
    TOP: "radial-gradient(20% 50% at 50% 0%, var(--clarity) 0%, transparent 100%)",
    LEFT: "radial-gradient(50% 20% at 0% 50%, var(--connectivity) 0%, transparent 100%)",
    BOTTOM: "radial-gradient(20% 50% at 50% 100%, var(--collaboration) 0%, transparent 100%)",
    RIGHT: "radial-gradient(50% 20% at 100% 50%, var(--capacity) 0%, transparent 100%)",
  };

  return (
    <Tag
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      className={cn(
        "relative flex h-min w-fit content-center items-center justify-center rounded-full border border-border bg-zinc-100 dark:bg-black/20 transition-all",
        containerClassName,
      )}
      {...props}
    >
      <div
        className={cn(
          "w-auto text-foreground z-10 bg-background dark:bg-black px-4 py-2 rounded-[inherit]",
          className,
        )}
      >
        {children}
      </div>
      <motion.div
        className="absolute inset-0 z-0 overflow-hidden rounded-[inherit]"
        style={{
          filter: "blur(2px)",
        }}
        animate={{
          background: hover
            ? mapDirectionToCorner[direction]
            : "radial-gradient(20% 50% at 50% 0%, var(--border-strong) 0%, transparent 100%)",
        }}
        transition={{ duration: 0.5 }}
      />
    </Tag>
  );
}
