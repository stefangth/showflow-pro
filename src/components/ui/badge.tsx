import * as React from "react";
import { cva, type VariantProps } from "class-variance-authority";

import { cn } from "@/lib/utils";

const badgeVariants = cva(
  /* 20 px tall pill, 11 px / 500, 4 px radius */
  "inline-flex items-center gap-1 rounded-[4px] border px-1.5 py-0 h-5 text-[11px] font-medium tracking-wide transition-colors focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2",
  {
    variants: {
      variant: {
        /* Semantic shadcn variants */
        default:
          "border-transparent bg-primary text-primary-foreground hover:bg-primary/80",
        secondary:
          "border-transparent bg-secondary text-secondary-foreground hover:bg-secondary/80",
        destructive:
          "border-transparent bg-[var(--red-100)] text-[var(--red-600)]",
        outline: "text-foreground",

        /* Design-system tone variants */
        confirmed:
          "border-transparent bg-[var(--green-100)] text-[var(--green-600)]",
        hold:
          "border-transparent bg-[var(--amber-100)] text-[var(--amber-600)]",
        /* "at-risk / degraded" — amber, distinct from destructive's red */
        risk:
          "border-transparent bg-[var(--amber-100)] text-[var(--amber-600)]",
        accent:
          "border-accent-200 bg-accent-50 text-accent-700",
        neutral:
          "border-border bg-muted text-muted-foreground",
      },
    },
    defaultVariants: {
      variant: "default",
    },
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
      {dot && (
        <span className="inline-block h-1.5 w-1.5 rounded-full bg-current shrink-0" aria-hidden="true" />
      )}
      {children}
    </div>
  );
}

export { Badge, badgeVariants };
