import { useTranslation } from "react-i18next";
import { Switch } from "@/components/ui/switch";
import { cn } from "@/lib/utils";

export type ConsoleTab = "overview" | "mapping" | "catalog" | "activity";

interface ConsoleTabsProps {
  value: ConsoleTab;
  onChange: (t: ConsoleTab) => void;
  heldCount: number;
  syncEnabled: boolean;
  onToggleSync: (v: boolean) => void;
  canWrite: boolean;
}

const TAB_KEYS: { key: ConsoleTab; labelKey: string }[] = [
  { key: "overview", labelKey: "consoleTabs.overview" },
  { key: "mapping", labelKey: "consoleTabs.mapping" },
  { key: "catalog", labelKey: "consoleTabs.catalog" },
  { key: "activity", labelKey: "consoleTabs.activity" },
];

/** The segmented tab bar plus the "Sync" master switch that sits above the
 *  active tab panel. Presentational: the orchestrator owns tab + switch state. */
export function ConsoleTabs({
  value,
  onChange,
  heldCount,
  syncEnabled,
  onToggleSync,
  canWrite,
}: ConsoleTabsProps) {
  const { t } = useTranslation('settingsAirtable');
  return (
    <div className="flex items-center justify-between gap-3">
      <div className="inline-flex gap-0.5 rounded-control bg-well-tint p-0.5">
        {TAB_KEYS.map((tab) => {
          const active = tab.key === value;
          return (
            <button
              key={tab.key}
              type="button"
              onClick={() => onChange(tab.key)}
              className={cn(
                "inline-flex h-[30px] items-center gap-1.5 rounded-field px-3 text-xs font-medium transition-colors",
                active
                  ? "bg-card text-foreground shadow-sm"
                  : "text-muted-foreground hover:text-foreground",
              )}
            >
              {t(tab.labelKey)}
              {tab.key === "catalog" && heldCount > 0 && (
                <span className="inline-flex h-4 min-w-4 items-center justify-center rounded-chip bg-accent-tint px-1 text-eyebrow font-semibold tabular-nums text-accent-text">
                  {heldCount}
                </span>
              )}
            </button>
          );
        })}
      </div>
      <div className="flex items-center gap-2.5">
        <span className="text-xs text-muted-foreground">{t('consoleTabs.sync')}</span>
        <Switch
          checked={syncEnabled}
          onCheckedChange={onToggleSync}
          disabled={!canWrite}
          aria-label={t('consoleTabs.syncEnabledAria')}
        />
      </div>
    </div>
  );
}
