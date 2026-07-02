import * as React from "react";
import { useMotionTemplate, useMotionValue, motion } from "framer-motion";
import { cn } from "@/lib/utils";

export interface InputProps extends React.InputHTMLAttributes<HTMLInputElement> {}

const Input = React.forwardRef<HTMLInputElement, InputProps>(
  ({ className, type, ...props }, ref) => {
    const radius = 100;
    const [visible, setVisible] = React.useState(false);

    let mouseX = useMotionValue(0);
    let mouseY = useMotionValue(0);

    function handleMouseMove({ currentTarget, clientX, clientY }: React.MouseEvent) {
      let { left, top } = currentTarget.getBoundingClientRect();
      mouseX.set(clientX - left);
      mouseY.set(clientY - top);
    }

    return (
      <motion.div
        style={{
          background: useMotionTemplate`
            radial-gradient(
              ${visible ? radius + "px" : "0px"} circle at ${mouseX}px ${mouseY}px,
              var(--primary),
              transparent 80%
            )
          `,
        }}
        onMouseMove={handleMouseMove}
        onMouseEnter={() => setVisible(true)}
        onMouseLeave={() => setVisible(false)}
        className="p-[1.5px] rounded-xl transition-all duration-300 group/input bg-gradient-to-br from-border via-border/50 to-border dark:from-zinc-700 dark:via-zinc-800 dark:to-zinc-700 w-full shadow-sm focus-within:shadow-lg focus-within:shadow-primary/15 focus-within:from-primary/50 focus-within:via-primary/20 focus-within:to-primary/50"
      >
        <input
          type={type}
          className={cn(
            "flex h-9 w-full border-none bg-gradient-to-b from-white to-slate-50 dark:from-zinc-900 dark:to-zinc-950 text-foreground shadow-[inset_0_1px_2px_rgba(15,23,42,0.04)] dark:shadow-[inset_0_1px_2px_rgba(0,0,0,0.3)] rounded-[10px] px-3 py-1 text-sm font-medium file:border-0 file:bg-transparent file:text-sm file:font-medium file:text-foreground placeholder:text-muted-foreground/45 placeholder:font-normal focus-visible:outline-none disabled:cursor-not-allowed disabled:opacity-50 transition duration-300 md:text-sm",
            className,
          )}
          ref={ref}
          {...props}
        />
      </motion.div>
    );
  },
);
Input.displayName = "Input";

export { Input };
