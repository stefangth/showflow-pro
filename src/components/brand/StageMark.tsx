import { cn } from "@/lib/utils";

interface StageMarkProps {
  /** "mark" = outline mono mark (inherits currentColor); "tile" = violet filled square */
  variant?: "mark" | "tile";
  size?: number;
  className?: string;
}

/**
 * Proscenium arch + lighting beams — the Showflow Pro brand mark.
 * "mark" variant uses currentColor so it inherits theme (sidebar, topbar, etc.)
 * "tile" variant is the full violet rounded-square app icon.
 */
export function StageMark({ variant = "mark", size = 32, className }: StageMarkProps) {
  if (variant === "tile") {
    return (
      <svg
        width={size}
        height={size}
        viewBox="0 0 64 64"
        fill="none"
        xmlns="http://www.w3.org/2000/svg"
        className={className}
        aria-hidden="true"
      >
        <rect width="64" height="64" rx="14" fill="hsl(var(--primary))" />
        <path
          d="M10 50V32C10 18 22 10 32 10C42 10 54 18 54 32V50Z"
          stroke="white"
          strokeWidth="3"
          strokeLinejoin="round"
        />
        <path
          d="M22 50L32 24L42 50"
          stroke="white"
          strokeWidth="3"
          strokeLinecap="round"
          strokeLinejoin="round"
          opacity="0.7"
        />
        <circle cx="32" cy="20" r="2.8" fill="white" />
      </svg>
    );
  }

  /* "mark" — mono outline, inherits currentColor */
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 32 32"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      className={cn("text-primary", className)}
      aria-hidden="true"
    >
      <path
        d="M4 26V16C4 8.8 10 4 16 4C22 4 28 8.8 28 16V26Z"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinejoin="round"
      />
      <path
        d="M10 26L16 12L22 26"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
        opacity="0.6"
      />
      <circle cx="16" cy="10" r="1.5" fill="currentColor" />
    </svg>
  );
}
