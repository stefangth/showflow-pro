import * as React from "react";
import { Slot } from "@radix-ui/react-slot";
import { cva, type VariantProps } from "class-variance-authority";

import { cn } from "@/lib/utils";

const buttonVariants = cva(
  /* Base: Geist 13 px / 500, 8 px radius, proper focus ring */
  "inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-md text-[13px] font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:pointer-events-none disabled:opacity-50 [&_svg]:pointer-events-none [&_svg]:size-4 [&_svg]:shrink-0",
  {
    variants: {
      variant: {
        /* Violet primary */
        default:
          "bg-primary text-primary-foreground shadow-elev1 hover:bg-primary-hover active:bg-primary-active",
        /* Surface secondary with hairline border */
        secondary:
          "bg-card text-foreground border border-border shadow-elev1 hover:bg-muted active:bg-muted/80",
        /* Destructive/danger */
        destructive:
          "bg-destructive/10 text-destructive border border-destructive/40 hover:bg-destructive/20 active:bg-destructive/30",
        /* Ghost — no border, subtle hover tint */
        ghost:
          "hover:bg-accent hover:text-accent-foreground active:bg-accent/80",
        /* Outline — hairline border variant of secondary */
        outline:
          "border border-border bg-background hover:bg-muted hover:text-foreground",
        /* Text link */
        link: "text-primary underline-offset-4 hover:underline",
      },
      size: {
        /* sm=26px, default=36px, lg=40px; icon=28×28px */
        sm:      "h-[26px] rounded-md px-2.5",
        default: "h-9 px-3 py-2",
        lg:      "h-10 rounded-md px-5",
        icon:    "h-7 w-7 rounded-[6px]",
      },
    },
    defaultVariants: {
      variant: "default",
      size: "default",
    },
  },
);

export interface ButtonProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement>,
    VariantProps<typeof buttonVariants> {
  asChild?: boolean;
}

const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant, size, asChild = false, ...props }, ref) => {
    const Comp = asChild ? Slot : "button";
    return (
      <Comp
        className={cn(buttonVariants({ variant, size, className }))}
        ref={ref}
        {...props}
      />
    );
  },
);
Button.displayName = "Button";

export { Button, buttonVariants };
