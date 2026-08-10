import type { AccessTone } from "@/lib/trust/facts";

/** Semantic classes for an access answer. Kept in one place so the in-app
 *  matrix and any other consumer read the same visual language: green means
 *  unrestricted, muted means narrowed, faint means nothing, primary means the
 *  answer depends on a right an administrator granted. */
export const ACCESS_TONE_CLASS: Record<AccessTone, string> = {
  full: "bg-emerald-500/10 text-emerald-700 dark:text-emerald-400",
  scoped: "bg-muted text-muted-foreground",
  none: "bg-muted/50 text-muted-foreground/70",
  gated: "bg-primary/10 text-primary",
};
