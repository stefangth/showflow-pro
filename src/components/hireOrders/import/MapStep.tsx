import { useTranslation } from "react-i18next";
import { ORDER_FIELD_KEYS, type EditableOrderFieldKey } from "@/lib/hireOrders/types";
import type { OrderColumnMapping } from "@/lib/hireOrderImport/guessOrderMapping";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

/** shadcn Select can't use "" as an item value, so "not mapped" needs a sentinel. */
const IGNORE = "__ignore__";

const FIELD_LABEL_KEYS: Record<EditableOrderFieldKey, string> = {
  artist_name: "mapStep.artistName",
  recipient_email: "mapStep.recipientEmail",
  role: "mapStep.role",
  cast: "mapStep.cast",
  date: "mapStep.date",
  venue: "mapStep.venue",
  city: "mapStep.city",
  duration_min: "mapStep.durationMin",
  sessions: "mapStep.sessions",
  fee: "mapStep.fee",
  currency: "mapStep.currency",
  notes: "mapStep.notes",
};

// `sessions` is excluded: neither `guessOrderMapping` nor `buildOrderRows` ever
// reads a mapped `sessions` column (there's no sheet-column convention for it —
// see guessOrderMapping's docstring), so a Select for it here would be a
// control that does nothing when the user picks a column.
const MAPPABLE_FIELD_KEYS: EditableOrderFieldKey[] = ORDER_FIELD_KEYS.filter((key) => key !== "sessions");

interface Props {
  headers: string[];
  mapping: OrderColumnMapping;
  onMappingChange: (mapping: OrderColumnMapping) => void;
}

/**
 * Map step: one Select per mappable editable order field, options = sheet headers +
 * "Ignore", prefilled by the caller from `guessOrderMapping`.
 */
export function MapStep({ headers, mapping, onMappingChange }: Props) {
  const { t } = useTranslation("hireOrdersPages");
  function setField(key: EditableOrderFieldKey, value: string) {
    const next = { ...mapping };
    if (value === IGNORE) delete next[key];
    else next[key] = value;
    onMappingChange(next);
  }

  return (
    <div className="space-y-3">
      <p className="text-sm text-muted-foreground">
        {t("mapStep.intro")}
      </p>
      <div className="space-y-2.5">
        {MAPPABLE_FIELD_KEYS.map((key) => {
          const col = mapping[key];
          const fieldLabel = t(FIELD_LABEL_KEYS[key]);
          return (
            <div key={key} className="grid grid-cols-[10rem_1fr] items-center gap-3">
              <Label htmlFor={`import-map-${key}`}>{fieldLabel}</Label>
              <Select value={col ?? IGNORE} onValueChange={(v) => setField(key, v)}>
                <SelectTrigger id={`import-map-${key}`} aria-label={t("mapStep.columnAria", { label: fieldLabel })}>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={IGNORE}>{t("mapStep.ignore")}</SelectItem>
                  {headers.map((h) => (
                    <SelectItem key={h} value={h}>{h}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          );
        })}
      </div>
    </div>
  );
}
