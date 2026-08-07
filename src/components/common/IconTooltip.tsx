import * as React from "react";

import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";

interface IconTooltipProps {
  /**
   * The hover label. When falsy the child is rendered unwrapped (no tooltip) —
   * a convenient escape hatch for callers whose label is conditionally empty.
   */
  label: React.ReactNode;
  /** The control to describe — typically an icon-only `Button`. */
  children: React.ReactElement;
  side?: React.ComponentProps<typeof TooltipContent>["side"];
  align?: React.ComponentProps<typeof TooltipContent>["align"];
  sideOffset?: number;
  /**
   * Extra classes for the wrapper span. Defaults to `inline-flex`, which suits a
   * small square icon button in a flex row; pass e.g. `flex w-full` for a
   * full-width block trigger so the wrapper doesn't shrink it to its content.
   */
  className?: string;
}

/**
 * Adds a styled shadcn tooltip to an icon-only control, reusing the established
 * `Tooltip` / `TooltipTrigger asChild` / `TooltipContent` structure so every icon
 * button reads the same way.
 *
 * The child is wrapped in an `inline-flex` span rather than made the trigger
 * directly, because Radix's `TooltipTrigger asChild` never fires on a `disabled`
 * button — the `Button` base style sets `disabled:pointer-events-none`, so the
 * button emits no hover events. With the span as the trigger, the disabled
 * button's suppressed pointer events bubble to the span and the tooltip still
 * opens on hover. Keep the child's own `aria-label` for screen readers; this
 * tooltip is an additive visual affordance.
 */
export function IconTooltip({
  label,
  children,
  side = "bottom",
  align,
  sideOffset,
  className,
}: IconTooltipProps) {
  if (!label) return children;

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <span className={cn("inline-flex", className)}>{children}</span>
      </TooltipTrigger>
      <TooltipContent side={side} align={align} sideOffset={sideOffset}>
        {label}
      </TooltipContent>
    </Tooltip>
  );
}
