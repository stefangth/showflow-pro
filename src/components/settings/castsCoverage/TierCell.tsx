import { useTranslation } from "react-i18next";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Metric } from "@/components/ui/metric";
import { cn } from "@/lib/utils";
import type { CoverageCastRef } from "./coverageMatrix";

export interface TierCellOption {
  id: string;
  name: string;
  memberCount: number;
}

interface TierCellProps {
  tier: number;
  slot: CoverageCastRef | null;
  options: TierCellOption[];
  disabled: boolean;
  onSelect: (castId: string) => void;
  /** Omit when this exact slot has nothing to clear (e.g. a per-show cell showing an
   *  inherited org-default cast, where no override row exists yet). */
  onClear?: () => void;
}

/** One (city, tier) cell of the coverage matrix. A button showing the assigned cast
 *  (or a dashed empty-state) opens a popover to pick a cast for this slot, or clear it. */
export function TierCell({ tier, slot, options, disabled, onSelect, onClear }: TierCellProps) {
  const { t } = useTranslation('settingsCastsCoverage');
  return (
    <Popover>
      <PopoverTrigger asChild>
        <button
          type="button"
          disabled={disabled}
          aria-label={slot ? t('tierCell.tierWithName', { tier, name: slot.name }) : t('tierCell.setTier', { tier })}
          className={cn(
            "flex w-full flex-col items-start gap-0.5 rounded-field border px-2.5 py-1.5 text-left text-sm transition-colors",
            slot
              ? "border-border bg-card hover:bg-[var(--surface-3)]"
              : "border-dashed border-border text-muted-foreground hover:bg-[var(--surface-3)]",
            disabled && "cursor-not-allowed opacity-60 hover:bg-transparent",
          )}
        >
          {slot ? (
            <>
              <span className="font-medium text-foreground">{slot.name}</span>
              <span className="text-xs text-muted-foreground">
                {t('tierCell.memberCount', { count: slot.memberCount })}
              </span>
            </>
          ) : (
            <span>{t('tierCell.setTier', { tier })}</span>
          )}
        </button>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-64 p-1">
        <div className="max-h-64 space-y-0.5 overflow-y-auto">
          {options.length === 0 ? (
            <p className="px-2 py-1.5 text-xs text-muted-foreground">{t('tierCell.noCastsAvailable')}</p>
          ) : (
            options.map((opt) => (
              <button
                key={opt.id}
                type="button"
                aria-label={t('tierCell.assign', { name: opt.name })}
                onClick={() => onSelect(opt.id)}
                className="flex w-full items-center justify-between rounded-field px-2 py-1.5 text-left text-sm hover:bg-[var(--surface-3)]"
              >
                <span>{opt.name}</span>
                <Metric className="text-xs text-muted-foreground">
                  {t('tierCell.memberCount', { count: opt.memberCount })}
                </Metric>
              </button>
            ))
          )}
          {slot && onClear && (
            <>
              <div className="my-1 h-px bg-border" />
              <button
                type="button"
                onClick={onClear}
                className="flex w-full items-center rounded-field px-2 py-1.5 text-left text-sm text-destructive hover:bg-[var(--surface-3)]"
              >
                {t('tierCell.clearSlot')}
              </button>
            </>
          )}
        </div>
      </PopoverContent>
    </Popover>
  );
}
