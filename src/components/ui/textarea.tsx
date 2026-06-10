import * as React from "react";
import { useMotionTemplate, useMotionValue, motion } from "framer-motion";
import { cn } from "@/lib/utils";

export interface TextareaProps
  extends React.TextareaHTMLAttributes<HTMLTextAreaElement> {}

const Textarea = React.forwardRef<HTMLTextAreaElement, TextareaProps>(
  ({ className, ...props }, ref) => {
    const radius = 120;
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
        className="p-[1.5px] rounded-xl transition duration-300 group/input bg-border/40 dark:bg-zinc-800 w-full"
      >
        <textarea
          className={cn(
            "flex min-h-[60px] w-full border-none bg-white dark:bg-zinc-950 text-foreground shadow-sm rounded-lg px-3 py-2 text-sm placeholder:text-muted-foreground/50 focus-visible:outline-none focus-visible:ring-[2px] focus-visible:ring-primary/20 disabled:cursor-not-allowed disabled:opacity-50 transition duration-300 md:text-sm",
            className
          )}
          ref={ref}
          {...props}
        />
      </motion.div>
    );
  }
);
Textarea.displayName = "Textarea";

export { Textarea };
