import { ArrowLeft } from "lucide-react";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { SHOWFLOW_FIELDS, type AirtableFieldMap } from "@/data/airtableMapping";
import { Metric } from "@/components/ui/metric";
import { cn } from "@/lib/utils";

/** shadcn Select cannot use "" as an item value, so "not mapped" needs a sentinel. */
const NONE = "__none__";

export interface MappingTabProps {
  tableName: string;
  /** Airtable columns in the selected table. */
  fields: { id: string; name: string }[];
  fieldMap: AirtableFieldMap;
  onSetField: (key: keyof AirtableFieldMap, value: string | null) => void;
  /** From requiredMappedCount: rendered as "{mapped} / {total}". */
  mapped: number;
  total: number;
  /** Options of a single-select Airtable field (for the "cancelled" value picker). */
  optionNames: (fieldName: string | null | undefined) => string[];
  /** Airtable columns not mapped and not already added as custom fields. */
  unboundFields: { id: string; name: string; type: string }[];
  /** Adds every unboundField as a custom field. */
  onAddAllCustom: () => void;
  canWrite: boolean;
  /** Renders the card header one step down the type scale. The get-running wizard already
   *  titles the step above this card, so a 17px card title there competes with the step's
   *  own heading; in Settings this card IS the section, and its title matches its sibling
   *  cards' 17px. Defaults to the Settings size so no existing host changes. */
  dense?: boolean;
}

/** Presentational Field-mapping tab of the Airtable Sync console: a two-column
 *  ShowFlow-field to Airtable-column table with a required-mapped counter, amber
 *  highlight for unmapped required rows, the cancellation mapping, and an
 *  "unread columns" footer. All data + callbacks arrive via props. */
export function MappingTab(props: MappingTabProps) {
  const { t } = useTranslation('settingsAirtable');
  const { tableName, fields, fieldMap, onSetField, mapped, total, optionNames, unboundFields, onAddAllCustom, canWrite, dense = false } = props;
  const readOnly = !canWrite;

  const columnOptions = (
    <>
      <SelectItem value={NONE}>{t('mappingTab2.notMapped')}</SelectItem>
      {fields.map((af) => <SelectItem key={af.id} value={af.name}>{af.name}</SelectItem>)}
    </>
  );

  return (
    <div className="bg-card border border-border rounded-card shadow-sm">
      {/* Header: title + required-mapped counter */}
      <div className="flex flex-wrap items-start justify-between gap-x-4 gap-y-2 px-4 py-3.5 border-b border-border">
        <div className="min-w-0">
          <h3 className={cn("font-semibold tracking-tight", dense ? "text-control" : "text-title-sm")}>
            {t('mappingTab2.title')}
          </h3>
          <p className="mt-1 text-control text-muted-foreground">
            {tableName ? (
              <>
                {t('mappingTab2.headerPrefix')} <strong className="font-medium text-foreground">{tableName}</strong>{t('mappingTab2.headerSuffix')}
              </>
            ) : (
              // With no table picked the interpolated name is empty and the prefix/suffix
              // pair renders "...reads from one column in ." Say the same thing without
              // naming a table rather than leaving a dangling period.
              t('mappingTab2.headerNoTable')
            )}
          </p>
        </div>
        <div className="shrink-0 text-right">
          <Metric className={cn("font-medium", dense ? "text-control" : "text-title-sm")}>
            {mapped} / {total}
          </Metric>
          <p className="mt-0.5 text-xs text-muted-foreground">{t('mappingTab2.requiredMapped')}</p>
        </div>
      </div>

      {/* Two-column mapping table. The label column gives ground before the control
          column does: a flat 50/50 split collapsed the Select to 94px inside the
          get-running wizard, where "Not mapped" rendered as "No...". */}
      <div data-testid="mapping-grid" className="grid grid-cols-[minmax(110px,0.9fr)_minmax(0,1.1fr)]">
        {/* eslint-disable-next-line no-restricted-syntax -- non-standard tracking (0.1em) */}
        <p className="px-4 py-2.5 text-eyebrow font-semibold uppercase tracking-[0.1em] text-muted-foreground border-b border-r border-border">
          {t('mappingTab2.colShowflowField')}
        </p>
        {/* eslint-disable-next-line no-restricted-syntax -- non-standard tracking (0.1em) */}
        <p className="px-4 py-2.5 text-eyebrow font-semibold uppercase tracking-[0.1em] text-muted-foreground border-b border-border">
          {t('mappingTab2.colAirtableColumn')}
        </p>

        {SHOWFLOW_FIELDS.map((f) => {
          const required = !f.optional;
          const unmappedRequired = required && !fieldMap[f.key];
          return (
            <div key={f.key} className="contents">
              <div className="flex items-center justify-between gap-2.5 min-h-[44px] px-4 border-b border-r border-border">
                <Label className={cn("text-sm font-medium", unmappedRequired && "text-[color:var(--amber-600)]")}>
                  {f.label}
                </Label>
                {f.optional && <span className="text-eyebrow text-muted-foreground/70">{t('mappingTab2.optional')}</span>}
              </div>
              <div className="flex items-center gap-2.5 min-h-[44px] px-4 border-b border-border">
                <ArrowLeft className="h-3.5 w-3.5 shrink-0 text-accent-300" aria-hidden />
                <Select
                  value={(fieldMap[f.key] as string | null) ?? NONE}
                  onValueChange={(v) => onSetField(f.key, v === NONE ? null : v)}
                  disabled={readOnly}
                >
                  <SelectTrigger
                    aria-label={f.label}
                    className={cn("flex-1 h-[30px]", unmappedRequired && "border-[color:var(--amber-500)] ring-1 ring-[color:var(--amber-500)] text-[color:var(--amber-600)]")}
                  >
                    <SelectValue placeholder={t('mappingTab2.notMapped')} />
                  </SelectTrigger>
                  <SelectContent>{columnOptions}</SelectContent>
                </Select>
              </div>
            </div>
          );
        })}

        {/* Cancellation mapping (status to cancelled + reason) */}
        <div className="flex items-center min-h-[44px] px-4 border-b border-r border-border">
          <Label className="text-sm font-medium">{t('mappingTab2.statusFieldLabel')}</Label>
        </div>
        <div className="flex items-center gap-2.5 min-h-[44px] px-4 border-b border-border">
          <ArrowLeft className="h-3.5 w-3.5 shrink-0 text-accent-300" aria-hidden />
          <Select
            value={fieldMap.status_field ?? NONE}
            onValueChange={(v) => onSetField("status_field", v === NONE ? null : v)}
            disabled={readOnly}
          >
            <SelectTrigger aria-label={t('mappingTab2.statusFieldLabel')} className="flex-1 h-[30px]"><SelectValue placeholder={t('mappingTab2.notMapped')} /></SelectTrigger>
            <SelectContent>{columnOptions}</SelectContent>
          </Select>
        </div>

        {fieldMap.status_field && (
          <>
            <div className="flex items-center min-h-[44px] px-4 border-b border-r border-border">
              <Label className="text-sm font-medium">{t('mappingTab2.cancelledValueLabel')}</Label>
            </div>
            <div className="flex items-center gap-2.5 min-h-[44px] px-4 border-b border-border">
              <ArrowLeft className="h-3.5 w-3.5 shrink-0 text-accent-300" aria-hidden />
              <Select
                value={fieldMap.cancelled_value ?? NONE}
                onValueChange={(v) => onSetField("cancelled_value", v === NONE ? null : v)}
                disabled={readOnly}
              >
                <SelectTrigger aria-label={t('mappingTab2.cancelledValueLabel')} className="flex-1 h-[30px]"><SelectValue placeholder={t('mappingTab2.pickCancelledOption')} /></SelectTrigger>
                <SelectContent>
                  <SelectItem value={NONE}>{t('mappingTab2.none')}</SelectItem>
                  {optionNames(fieldMap.status_field).map((name) => <SelectItem key={name} value={name}>{name}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
          </>
        )}

        <div className="flex items-center min-h-[44px] px-4 border-b border-r border-border">
          <Label className="text-sm font-medium">{t('mappingTab2.cancellationReasonLabel')}</Label>
        </div>
        <div className="flex items-center gap-2.5 min-h-[44px] px-4 border-b border-border">
          <ArrowLeft className="h-3.5 w-3.5 shrink-0 text-accent-300" aria-hidden />
          <Select
            value={fieldMap.cancellation_reason_field ?? NONE}
            onValueChange={(v) => onSetField("cancellation_reason_field", v === NONE ? null : v)}
            disabled={readOnly}
          >
            <SelectTrigger aria-label={t('mappingTab2.cancellationReasonAria')} className="flex-1 h-[30px]"><SelectValue placeholder={t('mappingTab2.notMapped')} /></SelectTrigger>
            <SelectContent>{columnOptions}</SelectContent>
          </Select>
        </div>
      </div>

      {/* Footer: columns ShowFlow doesn't read */}
      {unboundFields.length > 0 && (
        <div className="flex items-center justify-between gap-3 px-4 py-3.5 border-t border-border">
          <p className="text-xs text-muted-foreground">
            {t('mappingTab2.footerUnbound', {
              count: unboundFields.length,
              tableName,
              names: unboundFields.slice(0, 4).map((f) => f.name).join(", "),
            })}
          </p>
          <Button
            variant="outline"
            size="sm"
            className="shrink-0"
            disabled={readOnly || unboundFields.length === 0}
            onClick={onAddAllCustom}
          >
            {t('mappingTab2.addAsCustomFields')}
          </Button>
        </div>
      )}
    </div>
  );
}
