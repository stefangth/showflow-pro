import * as React from "react";

import { cn } from "@/lib/utils";

/**
 * PATCHED against the shipped card.tsx (ADR 0012, finding 05).
 *
 * The default was `shadow-elev2`, which the system explicitly does not want for a
 * card sitting on the page: a hairline carries the work there. SeasonKpis had opted
 * out of Card entirely because of this, with a source comment explaining why. That
 * comment can now be deleted.
 *
 * Padding is symmetric. CardContent no longer removes its own top padding, which was
 * the reason every call site had to pass `pt-6` back in.
 */
const Card = React.forwardRef<
  HTMLDivElement,
  React.HTMLAttributes<HTMLDivElement> & { elevation?: 0 | 2 | 3 }
>(({ className, elevation = 0, ...props }, ref) => (
  <div
    ref={ref}
    className={cn(
      "rounded-l border bg-card text-card-foreground",
      elevation === 2 && "shadow-elev2",
      elevation === 3 && "shadow-elev3",
      className,
    )}
    {...props}
  />
));
Card.displayName = "Card";

const CardHeader = React.forwardRef<HTMLDivElement, React.HTMLAttributes<HTMLDivElement>>(
  ({ className, ...props }, ref) => (
    <div ref={ref} className={cn("flex flex-col space-y-1.5 p-4 pb-0", className)} {...props} />
  ),
);
CardHeader.displayName = "CardHeader";

const CardTitle = React.forwardRef<HTMLParagraphElement, React.HTMLAttributes<HTMLHeadingElement>>(
  ({ className, ...props }, ref) => (
    <h3 ref={ref} className={cn("text-[22px] font-semibold leading-none tracking-tight font-display", className)} {...props} />
  ),
);
CardTitle.displayName = "CardTitle";

const CardDescription = React.forwardRef<HTMLParagraphElement, React.HTMLAttributes<HTMLParagraphElement>>(
  ({ className, ...props }, ref) => (
    <p ref={ref} className={cn("text-sm text-muted-foreground", className)} {...props} />
  ),
);
CardDescription.displayName = "CardDescription";

const CardContent = React.forwardRef<HTMLDivElement, React.HTMLAttributes<HTMLDivElement>>(
  ({ className, ...props }, ref) => <div ref={ref} className={cn("p-4", className)} {...props} />,
);
CardContent.displayName = "CardContent";

const CardFooter = React.forwardRef<HTMLDivElement, React.HTMLAttributes<HTMLDivElement>>(
  ({ className, ...props }, ref) => (
    <div ref={ref} className={cn("flex items-center p-4 pt-0", className)} {...props} />
  ),
);
CardFooter.displayName = "CardFooter";

export { Card, CardHeader, CardFooter, CardTitle, CardDescription, CardContent };
