import * as React from "react";
import { cva, type VariantProps } from "class-variance-authority";

import { cn } from "@/lib/utils";
import { StatusDot } from "./status-dot";

/**
 * PATCHED against the shipped badge.tsx (ADR 0012).
 *
 *  D3  `risk` was byte-identical to `hold`. It is now red, which is what the system
 *      reserves red for. `hold` is renamed `waiting` to match the shipped vocabulary
 *      in i18n/terms.ts, with `hold` kept as a deprecated alias for one release.
 *      Prefer <StatusPill tone> over these variants in new code.
 *
 * Radius stays 4. Badges are not pills.
 */
const badgeVariants = cva(
  "inline-flex items-center gap-1 rounded-chip border px-1.5 py-0 h-5 text-[11px] font-medium tracking-wide transition-colors focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2",
  {
    variants: {
      variant: {
        default: "border-transparent bg-primary text-primary-foreground hover:bg-primary/80",
        secondary: "border-transparent bg-secondary text-secondary-foreground hover:bg-secondary/80",
        outline: "text-foreground",
        confirmed: "border-transparent bg-[var(--green-100)] text-[var(--green-600)]",
        waiting: "border-transparent bg-[var(--amber-100)] text-[var(--amber-600)]",
        risk: "border-transparent bg-[var(--red-100)] text-[var(--red-600)]",
        destructive: "border-transparent bg-[var(--red-100)] text-[var(--red-600)]",
        accent: "border-accent-200 bg-accent-50 text-accent-text",
        neutral: "border-border bg-muted text-muted-foreground",
        /** Colour supplied by StatusPill from TONES. */
        tone: "border-transparent",
        /** @deprecated use `waiting` */
        hold: "border-transparent bg-[var(--amber-100)] text-[var(--amber-600)]",
      },
    },
    defaultVariants: { variant: "default" },
  },
);

export interface BadgeProps
  extends React.HTMLAttributes<HTMLDivElement>,
    VariantProps<typeof badgeVariants> {
  dot?: boolean;
}

function Badge({ className, variant, dot, children, ...props }: BadgeProps) {
  return (
    <div className={cn(badgeVariants({ variant }), className)} {...props}>
      {dot && <StatusDot tone="neutral" className="bg-current" />}
      {children}
    </div>
  );
}

export { Badge, badgeVariants };
