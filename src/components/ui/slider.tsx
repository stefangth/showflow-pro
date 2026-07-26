import * as React from "react";
import * as SliderPrimitive from "@radix-ui/react-slider";

import { cn } from "@/lib/utils";

/**
 * The element with `role="slider"` (and the one that actually receives
 * keyboard focus) is the Thumb, not the Root - Root renders a plain
 * unlabelled wrapping span. Radix's Thumb only reads its OWN `aria-label` /
 * `aria-labelledby` props (never inherited from Root, since a multi-thumb
 * slider needs one label per thumb), so `id`/`aria-label`/`aria-labelledby`
 * passed to `<Slider>` must land on the Thumb: putting them on Root instead
 * left the interactive control with no accessible name at all, and left a
 * `<label htmlFor>` pointing at a non-focusable element. Every other prop
 * (min/max/step/value/onValueChange/disabled/...) stays on Root, where Radix
 * expects it.
 */
const Slider = React.forwardRef<
  React.ElementRef<typeof SliderPrimitive.Root>,
  React.ComponentPropsWithoutRef<typeof SliderPrimitive.Root>
>(({ className, id, "aria-label": ariaLabel, "aria-labelledby": ariaLabelledBy, ...props }, ref) => (
  <SliderPrimitive.Root
    ref={ref}
    className={cn("relative flex w-full touch-none select-none items-center", className)}
    {...props}
  >
    <SliderPrimitive.Track className="relative h-2 w-full grow overflow-hidden rounded-full bg-secondary">
      <SliderPrimitive.Range className="absolute h-full bg-primary" />
    </SliderPrimitive.Track>
    <SliderPrimitive.Thumb
      id={id}
      aria-label={ariaLabel}
      aria-labelledby={ariaLabelledBy}
      className="block h-5 w-5 rounded-full border-2 border-primary bg-background ring-offset-background transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:pointer-events-none disabled:opacity-50"
    />
  </SliderPrimitive.Root>
));
Slider.displayName = SliderPrimitive.Root.displayName;

export { Slider };
