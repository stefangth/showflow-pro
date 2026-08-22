import * as React from "react";

import { cn } from "@/lib/utils";

export interface SegmentedControlOption<T extends string> {
  value: T;
  label: string;
  count?: number;
}

export interface SegmentedControlProps<T extends string> {
  value: T;
  onChange: (value: T) => void;
  options: Array<SegmentedControlOption<T>>;
  className?: string;
  /** Non-wrapping, horizontally scrolling strip with snap points (mobile). */
  scrollable?: boolean;
}

export function SegmentedControl<T extends string>({
  value,
  onChange,
  options,
  className,
  scrollable = false,
}: SegmentedControlProps<T>) {
  return (
    <div
      role="tablist"
      className={cn(
        "items-center rounded-m bg-well-tint p-[2px]",
        scrollable ? "flex gap-2 overflow-x-auto snap-x" : "inline-flex gap-[2px]",
        className,
      )}
    >
      {options.map((option) => {
        const active = option.value === value;

        return (
          <button
            key={option.value}
            type="button"
            role="tab"
            aria-selected={active}
            onClick={() => onChange(option.value)}
            className={cn(
              "inline-flex h-[29px] cursor-pointer items-center gap-1.5 rounded-s px-3 text-control font-medium transition-colors",
              scrollable && "shrink-0 snap-start",
              active
                ? "bg-card text-foreground shadow-elev1"
                : "bg-transparent text-muted-foreground shadow-none",
            )}
          >
            <span>{option.label}</span>
            {option.count != null && (
              <span
                className={cn(
                  "inline-flex h-4 min-w-4 items-center justify-center rounded-xs px-1 font-mono text-eyebrow font-semibold tabular-nums",
                  active ? "bg-accent-tint text-accent-text" : "bg-well-tint text-muted-foreground",
                )}
              >
                {option.count}
              </span>
            )}
          </button>
        );
      })}
    </div>
  );
}
