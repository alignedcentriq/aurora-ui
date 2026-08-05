import { cn } from "@/lib/utils";
import React from "react";

export const Meteors = ({
  number,
  className,
  spread = 400,
  top = "0px",
}: {
  number?: number;
  className?: string;
  /** Half-width (px) of the random horizontal spawn band, centered on the container. */
  spread?: number;
  /** CSS `top` for the spawn point. Motion travels up-and-right from here, so a
   * spawn point above the container (e.g. "100%") is what makes the streaks cross
   * through it rather than just skim its top edge before exiting. */
  top?: string;
}) => {
  const meteors = new Array(number || 20).fill(true);
  return (
    <>
      {meteors.map((el, idx) => (
        <span
          key={"meteor" + idx}
          className={cn(
            "animate-meteor-effect absolute top-1/2 h-0.5 w-0.5 rounded-[9999px] bg-slate-500 shadow-[0_0_0_1px_#ffffff10] rotate-[215deg] pointer-events-none",
            "before:content-[''] before:absolute before:top-1/2 before:transform before:-translate-y-[50%] before:w-[50px] before:h-[1px] before:bg-gradient-to-r before:from-[#64748b] before:to-transparent",
            className,
          )}
          style={{
            top,
            // calc(50% + Npx), not a bare `Npx` — a raw pixel value overrides the `left-1/2`
            // class entirely instead of combining with it, so half the jitter range landed
            // off-screen past the container's left edge. calc() keeps the spawn band truly
            // centered regardless of the container's actual rendered width.
            left: `calc(50% + ${Math.floor(Math.random() * (spread * 2) - spread)}px)`,
            animationDelay: Math.random() * (0.8 - 0.2) + 0.2 + "s",
            animationDuration: Math.floor(Math.random() * (10 - 2) + 2) + "s",
          }}
        ></span>
      ))}
    </>
  );
};
