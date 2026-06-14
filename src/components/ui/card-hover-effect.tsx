import { cn } from "@/lib/utils";
import { AnimatePresence, motion } from "framer-motion";
import { useState } from "react";
import { ArrowUpRight } from "lucide-react";

export const HoverEffect = ({
  items,
  className,
}: {
  items: {
    title: string;
    description: string;
    category?: string;
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
            <div className="flex items-start justify-between gap-3">
              {item.icon && (
                <div
                  className="flex h-11 w-11 items-center justify-center rounded-2xl transition-transform duration-300 group-hover:scale-110 group-hover:-rotate-3"
                  style={{
                    backgroundColor: item.color ? `color-mix(in oklab, ${item.color} 12%, transparent)` : "rgba(255,255,255,0.06)",
                  }}
                >
                  {item.icon}
                </div>
              )}
              <span
                className="flex h-7 w-7 items-center justify-center rounded-full text-muted-foreground opacity-0 -translate-x-1 transition-all duration-300 group-hover:opacity-100 group-hover:translate-x-0"
                style={{
                  backgroundColor: item.color ? `color-mix(in oklab, ${item.color} 12%, transparent)` : "rgba(255,255,255,0.06)",
                  color: item.color,
                }}
              >
                <ArrowUpRight className="h-3.5 w-3.5" />
              </span>
            </div>
            <div className="mt-4">
              <CardTitle>{item.title}</CardTitle>
              <CardDescription>{item.description}</CardDescription>
            </div>
            {item.category && (
              <span className="mt-4 inline-flex items-center rounded-full border border-[#e2e8f0] dark:border-white/[0.08] bg-muted/40 px-2.5 py-0.5 text-[9.5px] font-bold uppercase tracking-[0.08em] text-muted-foreground">
                {item.category}
              </span>
            )}
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
