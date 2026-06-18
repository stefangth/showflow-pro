import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import type { CustomFieldDefinition } from "@/data/customFields";
import type { CustomFilterState } from "@/lib/customFields";

const ALL = "__all__";

interface Props {
  def: CustomFieldDefinition;
  value: CustomFilterState;
  onChange: (v: CustomFilterState) => void;
}

/** A single type-switched filter control for one custom field (controlled). */
export function CustomFieldFilter({ def, value, onChange }: Props) {
  if (def.type === "select" && value.kind === "select") {
    return (
      <Select value={value.value ?? ALL} onValueChange={(v) => onChange({ kind: "select", value: v === ALL ? null : v })}>
        <SelectTrigger className="w-[160px]" aria-label={`${def.label} filter`}>
          <SelectValue placeholder={def.label} />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value={ALL}>All {def.label}</SelectItem>
          {(def.options ?? []).map((o) => <SelectItem key={o} value={o}>{o}</SelectItem>)}
        </SelectContent>
      </Select>
    );
  }
  if (def.type === "boolean" && value.kind === "boolean") {
    const cur = value.value === null ? ALL : value.value ? "yes" : "no";
    return (
      <Select value={cur} onValueChange={(v) => onChange({ kind: "boolean", value: v === ALL ? null : v === "yes" })}>
        <SelectTrigger className="w-[140px]" aria-label={`${def.label} filter`}>
          <SelectValue placeholder={def.label} />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value={ALL}>All {def.label}</SelectItem>
          <SelectItem value="yes">Yes</SelectItem>
          <SelectItem value="no">No</SelectItem>
        </SelectContent>
      </Select>
    );
  }
  if (def.type === "number" && value.kind === "number") {
    const num = (s: string) => (s === "" ? null : Number(s));
    return (
      <div className="flex items-center gap-1">
        <Input type="number" className="w-[90px]" placeholder={`${def.label} min`} aria-label={`${def.label} min`}
          value={value.min ?? ""} onChange={(e) => onChange({ ...value, min: num(e.target.value) })} />
        <span className="text-muted-foreground text-xs">–</span>
        <Input type="number" className="w-[90px]" placeholder="max" aria-label={`${def.label} max`}
          value={value.max ?? ""} onChange={(e) => onChange({ ...value, max: num(e.target.value) })} />
      </div>
    );
  }
  if (def.type === "date" && value.kind === "date") {
    return (
      <div className="flex items-center gap-1">
        <Input type="date" className="w-[150px]" aria-label={`${def.label} from`}
          value={value.from ?? ""} onChange={(e) => onChange({ ...value, from: e.target.value || null })} />
        <span className="text-muted-foreground text-xs">–</span>
        <Input type="date" className="w-[150px]" aria-label={`${def.label} to`}
          value={value.to ?? ""} onChange={(e) => onChange({ ...value, to: e.target.value || null })} />
      </div>
    );
  }
  if (value.kind === "text") {
    return (
      <Input className="w-[160px]" placeholder={def.label} aria-label={`${def.label} contains`}
        value={value.q} onChange={(e) => onChange({ kind: "text", q: e.target.value })} />
    );
  }
  return null;
}

/** The empty (matches-all) filter state for a field type. */
export function emptyCustomFilter(type: CustomFieldDefinition["type"]): CustomFilterState {
  switch (type) {
    case "select": return { kind: "select", value: null };
    case "number": return { kind: "number", min: null, max: null };
    case "date": return { kind: "date", from: null, to: null };
    case "boolean": return { kind: "boolean", value: null };
    default: return { kind: "text", q: "" };
  }
}
