import { ORDER_FIELD_KEYS, type OrderFieldKey } from "@/lib/hireOrders/types";
import type { OrderColumnMapping } from "@/lib/hireOrderImport/guessOrderMapping";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

/** shadcn Select can't use "" as an item value, so "not mapped" needs a sentinel. */
const IGNORE = "__ignore__";

const FIELD_LABELS: Record<OrderFieldKey, string> = {
  artist_name: "Artist name",
  recipient_email: "Recipient email",
  role: "Role",
  cast: "Cast",
  date: "Date",
  venue: "Venue",
  city: "City",
  duration_min: "Duration (min)",
  sessions: "Sessions",
  fee: "Fee",
  currency: "Currency",
  notes: "Notes",
};

// `sessions` is excluded: neither `guessOrderMapping` nor `buildOrderRows` ever
// reads a mapped `sessions` column (there's no sheet-column convention for it —
// see guessOrderMapping's docstring), so a Select for it here would be a
// control that does nothing when the user picks a column.
const MAPPABLE_FIELD_KEYS: OrderFieldKey[] = ORDER_FIELD_KEYS.filter((key) => key !== "sessions");

interface Props {
  headers: string[];
  mapping: OrderColumnMapping;
  onMappingChange: (mapping: OrderColumnMapping) => void;
}

/**
 * Map step: one Select per mappable `OrderFieldKey`, options = sheet headers +
 * "Ignore", prefilled by the caller from `guessOrderMapping`.
 */
export function MapStep({ headers, mapping, onMappingChange }: Props) {
  function setField(key: OrderFieldKey, value: string) {
    const next = { ...mapping };
    if (value === IGNORE) delete next[key];
    else next[key] = value;
    onMappingChange(next);
  }

  return (
    <div className="space-y-3">
      <p className="text-sm text-muted-foreground">
        Matched your columns automatically where possible. Adjust any field below.
      </p>
      <div className="space-y-2.5">
        {MAPPABLE_FIELD_KEYS.map((key) => {
          const col = mapping[key];
          return (
            <div key={key} className="grid grid-cols-[10rem_1fr] items-center gap-3">
              <Label htmlFor={`import-map-${key}`}>{FIELD_LABELS[key]}</Label>
              <Select value={col ?? IGNORE} onValueChange={(v) => setField(key, v)}>
                <SelectTrigger id={`import-map-${key}`} aria-label={`${FIELD_LABELS[key]} column`}>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={IGNORE}>Ignore</SelectItem>
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
