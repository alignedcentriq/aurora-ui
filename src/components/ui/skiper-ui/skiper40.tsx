import { Link, type LinkComponentProps } from "@tanstack/react-router";
import React from "react";

import { cn } from "@/lib/utils";

// Adapted from Skiper UI (skiper40, "Animated Link") — https://skiper-ui.com
// Original uses next/link; swapped for TanStack Router's Link since this app
// isn't Next.js. External hrefs render a plain <a> instead.
const underlineSweep = cn(
  "group relative inline-flex w-fit items-center",
  "before:pointer-events-none before:absolute before:bottom-0 before:left-0 before:h-px before:w-full before:origin-right before:scale-x-0 before:bg-current before:transition-transform before:duration-300 before:ease-[cubic-bezier(0.4,0,0.2,1)] before:content-['']",
  "hover:before:origin-left hover:before:scale-x-100",
);

type AnimatedLinkProps = { className?: string; children: React.ReactNode } & (
  | ({ to: LinkComponentProps["to"] } & Omit<LinkComponentProps, "className" | "children">)
  | ({ href: string; to?: undefined } & Omit<React.AnchorHTMLAttributes<HTMLAnchorElement>, "className" | "children">)
);

const AnimatedLink = ({ className, children, ...props }: AnimatedLinkProps) => {
  if ("to" in props && props.to !== undefined) {
    return (
      <Link className={cn(underlineSweep, className)} {...(props as LinkComponentProps)}>
        {children}
      </Link>
    );
  }
  const { href, ...anchorProps } = props as { href: string } & React.AnchorHTMLAttributes<HTMLAnchorElement>;
  return (
    <a href={href} className={cn(underlineSweep, className)} {...anchorProps}>
      {children}
    </a>
  );
};

export { AnimatedLink };
