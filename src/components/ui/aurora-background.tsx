import { cn } from "@/lib/utils";
import React, { ReactNode } from "react";

interface AuroraBackgroundProps extends React.HTMLAttributes<HTMLDivElement> {
  children: ReactNode;
  showRadialGradient?: boolean;
}

export const AuroraBackground = ({
  className,
  children,
  showRadialGradient = true,
  ...props
}: AuroraBackgroundProps) => {
  return (
    <div
      className={cn(
        "relative flex flex-col h-screen w-full items-center justify-center bg-zinc-950 text-slate-950 transition-colors duration-300",
        className,
      )}
      {...props}
    >
      <div className="absolute inset-0 overflow-hidden pointer-events-none">
        <div
          className={cn(
            `
            [--white-gradient:radial-gradient(at_top_left,white,transparent_50%)]
            [--dark-gradient:radial-gradient(at_top_left,var(--clarity),transparent_50%)]
            [--aurora:linear-gradient(90deg,var(--clarity)_0%,var(--connectivity)_25%,var(--collaboration)_50%,var(--capacity)_75%,var(--clarity)_100%)]
            [background-image:var(--white-gradient),var(--aurora)]
            dark:[background-image:var(--dark-gradient),var(--aurora)]
            [background-size:300%_200%]
            [background-position:50%_50%]
            filter blur-[24px] invert dark:invert-0
            after:content-[""] after:absolute after:inset-0 after:[background-image:var(--white-gradient),var(--aurora)] 
            after:dark:after:[background-image:var(--dark-gradient),var(--aurora)]
            after:[background-size:200%_100%] 
            after:animate-aurora after:[background-attachment:fixed]
            opacity-50 dark:opacity-40
            absolute -inset-[10px]`,
            showRadialGradient &&
              `[mask-image:radial-gradient(ellipse_at_100%_0%,black_10%,transparent_70%)]`,
          )}
        ></div>
      </div>
      {children}
    </div>
  );
};
