import { ArrowLeft } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { SHOWFLOW_FIELDS, type AirtableFieldMap } from "@/data/airtableMapping";
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
}

/** Presentational Field-mapping tab of the Airtable Sync console: a two-column
 *  ShowFlow-field to Airtable-column table with a required-mapped counter, amber
 *  highlight for unmapped required rows, the cancellation mapping, and an
 *  "unread columns" footer. All data + callbacks arrive via props. */
export function MappingTab(props: MappingTabProps) {
  const { tableName, fields, fieldMap, onSetField, mapped, total, optionNames, unboundFields, onAddAllCustom, canWrite } = props;
  const readOnly = !canWrite;

  const columnOptions = (
    <>
      <SelectItem value={NONE}>Not mapped</SelectItem>
      {fields.map((af) => <SelectItem key={af.id} value={af.name}>{af.name}</SelectItem>)}
    </>
  );

  return (
    <div className="bg-card border border-border rounded-lg shadow-sm">
      {/* Header: title + required-mapped counter */}
      <div className="flex items-start justify-between gap-4 px-4 py-3.5 border-b border-border">
        <div>
          <h3 className="text-[17px] font-semibold tracking-tight">Field mapping</h3>
          <p className="mt-1 text-[13px] text-muted-foreground">
            Every ShowFlow field reads from one column in <strong className="font-medium text-foreground">{tableName}</strong>. Catalog links are keyed on Program &middot; Sub-program.
          </p>
        </div>
        <div className="shrink-0 text-right">
          <p className="font-mono tabular-nums text-[17px] font-medium">{mapped} / {total}</p>
          <p className="mt-0.5 text-xs text-muted-foreground">required mapped</p>
        </div>
      </div>

      {/* Two-column mapping table */}
      <div className="grid grid-cols-2">
        <p className="px-4 py-2.5 text-[11px] font-semibold uppercase tracking-[0.1em] text-muted-foreground border-b border-r border-border">
          ShowFlow field
        </p>
        <p className="px-4 py-2.5 text-[11px] font-semibold uppercase tracking-[0.1em] text-muted-foreground border-b border-border">
          Airtable column
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
                {f.optional && <span className="text-[11px] text-muted-foreground/70">optional</span>}
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
                    <SelectValue placeholder="Not mapped" />
                  </SelectTrigger>
                  <SelectContent>{columnOptions}</SelectContent>
                </Select>
              </div>
            </div>
          );
        })}

        {/* Cancellation mapping (status to cancelled + reason) */}
        <div className="flex items-center min-h-[44px] px-4 border-b border-r border-border">
          <Label className="text-sm font-medium">Status field (optional)</Label>
        </div>
        <div className="flex items-center gap-2.5 min-h-[44px] px-4 border-b border-border">
          <ArrowLeft className="h-3.5 w-3.5 shrink-0 text-accent-300" aria-hidden />
          <Select
            value={fieldMap.status_field ?? NONE}
            onValueChange={(v) => onSetField("status_field", v === NONE ? null : v)}
            disabled={readOnly}
          >
            <SelectTrigger aria-label="Status field" className="flex-1 h-[30px]"><SelectValue placeholder="Not mapped" /></SelectTrigger>
            <SelectContent>{columnOptions}</SelectContent>
          </Select>
        </div>

        {fieldMap.status_field && (
          <>
            <div className="flex items-center min-h-[44px] px-4 border-b border-r border-border">
              <Label className="text-sm font-medium">"Cancelled" value</Label>
            </div>
            <div className="flex items-center gap-2.5 min-h-[44px] px-4 border-b border-border">
              <ArrowLeft className="h-3.5 w-3.5 shrink-0 text-accent-300" aria-hidden />
              <Select
                value={fieldMap.cancelled_value ?? NONE}
                onValueChange={(v) => onSetField("cancelled_value", v === NONE ? null : v)}
                disabled={readOnly}
              >
                <SelectTrigger aria-label={'"Cancelled" value'} className="flex-1 h-[30px]"><SelectValue placeholder="Pick the cancelled option" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value={NONE}>None</SelectItem>
                  {optionNames(fieldMap.status_field).map((name) => <SelectItem key={name} value={name}>{name}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
          </>
        )}

        <div className="flex items-center min-h-[44px] px-4 border-b border-r border-border">
          <Label className="text-sm font-medium">Cancellation reason (optional)</Label>
        </div>
        <div className="flex items-center gap-2.5 min-h-[44px] px-4 border-b border-border">
          <ArrowLeft className="h-3.5 w-3.5 shrink-0 text-accent-300" aria-hidden />
          <Select
            value={fieldMap.cancellation_reason_field ?? NONE}
            onValueChange={(v) => onSetField("cancellation_reason_field", v === NONE ? null : v)}
            disabled={readOnly}
          >
            <SelectTrigger aria-label="Cancellation reason" className="flex-1 h-[30px]"><SelectValue placeholder="Not mapped" /></SelectTrigger>
            <SelectContent>{columnOptions}</SelectContent>
          </Select>
        </div>
      </div>

      {/* Footer: columns ShowFlow doesn't read */}
      {unboundFields.length > 0 && (
        <div className="flex items-center justify-between gap-3 px-4 py-3.5 border-t border-border">
          <p className="text-xs text-muted-foreground">
            {unboundFields.length} {unboundFields.length === 1 ? "column" : "columns"} in {tableName} {unboundFields.length === 1 ? "isn't" : "aren't"} read by ShowFlow: {unboundFields.slice(0, 4).map((f) => f.name).join(", ")}.
          </p>
          <Button
            variant="outline"
            size="sm"
            className="shrink-0"
            disabled={readOnly || unboundFields.length === 0}
            onClick={onAddAllCustom}
          >
            Add as custom fields
          </Button>
        </div>
      )}
    </div>
  );
}
