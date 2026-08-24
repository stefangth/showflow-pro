import * as React from "react";

import { cn } from "@/lib/utils";

export interface SegmentedControlOption<T extends string> {
  value: T;
  label: string;
  count?: number;
  /** Optional `data-testid` for the rendered tab button (identity data, not styling). */
  testId?: string;
}

export interface SegmentedControlProps<T extends string> {
  value: T;
  onChange: (value: T) => void;
  options: Array<SegmentedControlOption<T>>;
  className?: string;
  /** Non-wrapping, horizontally scrolling strip with snap points (mobile). */
  scrollable?: boolean;
  /**
   * Disables the whole control: every option button gets the native
   * `disabled` attribute (blocking mouse, keyboard, and assistive-tech
   * activation, not just pointer events) and dims to read as inactive.
   */
  disabled?: boolean;
}

export function SegmentedControl<T extends string>({
  value,
  onChange,
  options,
  className,
  scrollable = false,
  disabled = false,
}: SegmentedControlProps<T>) {
  return (
    <div
      role="tablist"
      className={cn(
        "items-center rounded-control bg-well-tint p-[2px]",
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
            data-testid={option.testId}
            data-active={active}
            disabled={disabled}
            onClick={() => onChange(option.value)}
            className={cn(
              "inline-flex h-[29px] cursor-pointer items-center gap-1.5 rounded-field px-3 text-control font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-50",
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
                  "inline-flex h-4 min-w-4 items-center justify-center rounded-chip px-1 font-mono text-eyebrow font-semibold tabular-nums",
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
