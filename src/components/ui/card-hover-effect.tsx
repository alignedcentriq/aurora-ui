import { cn } from "@/lib/utils";
import { AnimatePresence, motion } from "framer-motion";
import { useState } from "react";

export const HoverEffect = ({
  items,
  className,
}: {
  items: {
    title: string;
    description: string;
    onClick?: () => void;
    icon?: React.ReactNode;
    color?: string;
  }[];
  className?: string;
}) => {
  let [hoveredIndex, setHoveredIndex] = useState<number | null>(null);

  return (
    <div
      className={cn(
        "grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 py-4 gap-4",
        className
      )}
    >
      {items.map((item, idx) => (
        <div
          key={idx}
          className="relative group block p-2 h-full w-full cursor-pointer select-none"
          onMouseEnter={() => setHoveredIndex(idx)}
          onMouseLeave={() => setHoveredIndex(null)}
          onClick={item.onClick}
        >
          <AnimatePresence>
            {hoveredIndex === idx && (
              <motion.span
                className="absolute inset-0 h-full w-full bg-slate-200/50 dark:bg-slate-800/[0.4] block rounded-3xl"
                layoutId="hoverBackground"
                initial={{ opacity: 0 }}
                animate={{
                  opacity: 1,
                  transition: { duration: 0.15 },
                }}
                exit={{
                  opacity: 0,
                  transition: { duration: 0.15, delay: 0.1 },
                }}
                style={{
                  border: item.color ? `1px solid color-mix(in oklab, ${item.color} 30%, transparent)` : undefined,
                  boxShadow: item.color ? `0 10px 30px -10px color-mix(in oklab, ${item.color} 20%, transparent)` : undefined,
                }}
              />
            )}
          </AnimatePresence>
          <Card color={item.color} className="relative z-10">
            {item.icon && (
              <div
                className="flex h-10 w-10 items-center justify-center rounded-xl mb-4 transition-transform duration-300 group-hover:scale-110"
                style={{
                  backgroundColor: item.color ? `color-mix(in oklab, ${item.color} 12%, transparent)` : "rgba(255,255,255,0.06)",
                }}
              >
                {item.icon}
              </div>
            )}
            <CardTitle>{item.title}</CardTitle>
            <CardDescription>{item.description}</CardDescription>
          </Card>
        </div>
      ))}
    </div>
  );
};

export const Card = ({
  className,
  children,
  color,
}: {
  className?: string;
  children: React.ReactNode;
  color?: string;
}) => {
  return (
    <div
      className={cn(
        "rounded-2xl h-full w-full p-5 overflow-hidden bg-white dark:bg-card border border-[#e2e8f0] dark:border-white/[0.06] group-hover:border-transparent transition-all duration-300 relative",
        className
      )}
    >
      {color && (
        <div
          className="absolute top-0 left-0 right-0 h-[2.5px] opacity-75 group-hover:opacity-100 transition-opacity"
          style={{ backgroundColor: color }}
        />
      )}
      <div className="relative z-20">
        <div>{children}</div>
      </div>
    </div>
  );
};

export const CardTitle = ({
  className,
  children,
}: {
  className?: string;
  children: React.ReactNode;
}) => {
  return (
    <h4 className={cn("text-foreground font-extrabold tracking-tight text-[14px] leading-tight", className)}>
      {children}
    </h4>
  );
};

export const CardDescription = ({
  className,
  children,
}: {
  className?: string;
  children: React.ReactNode;
}) => {
  return (
    <p
      className={cn(
        "mt-2 text-muted-foreground leading-snug text-[11.5px] line-clamp-2",
        className
      )}
    >
      {children}
    </p>
  );
};
