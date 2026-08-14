import { Eye } from "lucide-react";
import { useTranslation } from "react-i18next";

/** Static "view only" notice for producers (or anyone without the
 *  `configure_airtable` capability): the console renders read-only, the
 *  banner explains why. Presentational: no props, no data access. */
export function ReadOnlyBanner() {
  const { t } = useTranslation('settingsAirtable');
  return (
    <div className="flex items-center gap-2.5 rounded-lg border border-border bg-muted px-3.5 py-2.5">
      <Eye className="h-4 w-4 shrink-0 text-muted-foreground" />
      <p className="text-sm text-muted-foreground">
        {t('readOnlyBanner.prefix')}{" "}
        <span className="font-mono text-xs">configure_airtable</span> {t('readOnlyBanner.suffix')}
      </p>
    </div>
  );
}
