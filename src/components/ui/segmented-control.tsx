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
}

export function SegmentedControl<T extends string>({
  value,
  onChange,
  options,
  className,
}: SegmentedControlProps<T>) {
  return (
    <div
      role="tablist"
      className={cn(
        "inline-flex items-center gap-[2px] rounded-m bg-[var(--surface-3)] p-[2px]",
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
              "inline-flex h-[29px] cursor-pointer items-center gap-1.5 rounded-[var(--radius-s)] px-3 text-[13px] font-medium transition-colors",
              active
                ? "bg-card text-foreground shadow-elev1"
                : "bg-transparent text-muted-foreground shadow-none",
            )}
          >
            <span>{option.label}</span>
            {option.count != null && (
              <span className="font-mono text-[11px] tabular-nums text-muted-foreground">
                {option.count}
              </span>
            )}
          </button>
        );
      })}
    </div>
  );
}
