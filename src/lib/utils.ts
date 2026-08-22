import { clsx, type ClassValue } from "clsx";
import { extendTailwindMerge } from "tailwind-merge";

/**
 * tailwind-merge ships with a fixed idea of what a `text-*` class means: a
 * font-size utility OR a text-color utility, distinguished by matching
 * against Tailwind's built-in size scale (xs/sm/base/lg/...). It has no way
 * to know about this project's custom fontSize scale defined in
 * tailwind.config.ts (theme.extend.fontSize: eyebrow, caption, control,
 * body, title-sm, title, display-sm, display) — see docs/ui-conventions.md
 * §3. Left unconfigured, twMerge misclassifies `text-eyebrow`/`text-control`/
 * etc. as members of the text-color group, so combining one with a real
 * color class like `text-muted-foreground` silently drops one of the two
 * (last one wins). Registering the custom keys under the `font-size` class
 * group fixes the classification so size and color utilities coexist, while
 * two custom sizes on the same element still correctly conflict (last wins).
 */
const twMerge = extendTailwindMerge({
  extend: {
    classGroups: {
      "font-size": [
        {
          text: ["eyebrow", "caption", "control", "body", "title-sm", "title", "display-sm", "display"],
        },
      ],
    },
  },
});

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}
