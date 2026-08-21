import * as React from "react";
import { Slot } from "@radix-ui/react-slot";
import { cva, type VariantProps } from "class-variance-authority";

import { cn } from "@/lib/utils";

/**
 * PATCHED against the shipped button.tsx. Two changes, both from ADR 0012:
 *
 *  D1  The `link` variant is gone. A standalone action is a real button; an inline
 *      reference inside a sentence is an <a>, which is what it always was.
 *  D2  `ghost` is icon only, enforced by the prop type below. A ghost button with a
 *      text label is invisible on a matching surface, but ghost is load-bearing for
 *      the chrome icons, so it is narrowed rather than deleted.
 *
 * Also: svg sizing moved out of the base into the size variants, so a 26px sm button
 * no longer forces a 16px icon (finding 12).
 */
const buttonVariants = cva(
  "inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-m text-[13px] font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:pointer-events-none disabled:opacity-50 [&_svg]:pointer-events-none [&_svg]:shrink-0",
  {
    variants: {
      variant: {
        default: "bg-primary text-primary-foreground shadow-elev1 hover:bg-primary-hover active:bg-primary-active",
        secondary: "bg-card text-foreground border border-border shadow-elev1 hover:bg-muted active:bg-muted/80",
        destructive: "bg-destructive/10 text-destructive border border-destructive/40 hover:bg-destructive/20 active:bg-destructive/30",
        outline: "border border-border bg-background hover:bg-muted hover:text-foreground",
        ghost: "hover:bg-accent hover:text-accent-foreground active:bg-accent/80",
      },
      size: {
        sm: "h-[26px] rounded-m px-2.5 [&_svg]:size-[14px]",
        default: "h-9 px-3 py-2 [&_svg]:size-4",
        lg: "h-10 rounded-m px-5 [&_svg]:size-4",
        icon: "h-7 w-7 rounded-s [&_svg]:size-4",
      },
    },
    defaultVariants: { variant: "default", size: "default" },
  },
);

type BaseProps = React.ButtonHTMLAttributes<HTMLButtonElement> & { asChild?: boolean };
type Size = NonNullable<VariantProps<typeof buttonVariants>["size"]>;

/** D2: ghost is only reachable with size="icon". Any other pairing fails to compile. */
export type ButtonProps = BaseProps &
  (
    | { variant?: "default" | "secondary" | "destructive" | "outline"; size?: Size }
    | { variant: "ghost"; size: "icon" }
  );

const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant, size, asChild = false, ...props }, ref) => {
    const Comp = asChild ? Slot : "button";
    return <Comp className={cn(buttonVariants({ variant, size, className }))} ref={ref} {...props} />;
  },
);
Button.displayName = "Button";

export { Button, buttonVariants };
