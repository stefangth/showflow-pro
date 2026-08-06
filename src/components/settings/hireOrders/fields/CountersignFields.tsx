import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import type { CountersignMode, HireOrderCountersign } from "../CountersignCard";

export interface CountersignFieldsProps {
  value: HireOrderCountersign;
  onChange: (next: HireOrderCountersign) => void;
  readOnly?: boolean;
  idPrefix?: string;
}

/** The countersign mode choice, shared by Settings and the setup rail.
 *
 *  The design frame offered "draw or type" against "confirm by click only". Click-only
 *  is not an implemented mode and building it would touch the electronic-countersign DB
 *  gate, the issue_snapshot freeze and the consent-text mirror (spec, non-goals). The
 *  stored values are unchanged; only the labels move to describe what actually happens. */
export function CountersignFields({
  value,
  onChange,
  readOnly = false,
  idPrefix = "ho-countersign",
}: CountersignFieldsProps) {
  return (
    <div className="space-y-4">
      <RadioGroup
        value={value.mode}
        onValueChange={(v) => onChange({ ...value, mode: v as CountersignMode })}
        disabled={readOnly}
        className="gap-3"
      >
        <div className="flex items-start gap-3 rounded-lg border border-border p-3">
          <RadioGroupItem value="electronic" id={`${idPrefix}-electronic`} className="mt-0.5" />
          <Label htmlFor={`${idPrefix}-electronic`} className="cursor-pointer font-normal">
            <span className="block text-sm font-medium">Artist signs in ShowFlow</span>
            <span className="block text-xs text-muted-foreground">
              The artist reviews and signs the issued order in the app. Signature, timestamp and IP are stored with it.
            </span>
          </Label>
        </div>
        <div className="flex items-start gap-3 rounded-lg border border-border p-3">
          <RadioGroupItem value="manual" id={`${idPrefix}-manual`} className="mt-0.5" />
          <Label htmlFor={`${idPrefix}-manual`} className="cursor-pointer font-normal">
            <span className="block text-sm font-medium">Signatures handled outside ShowFlow</span>
            <span className="block text-xs text-muted-foreground">
              A producer marks the order countersigned once the artist has signed elsewhere.
            </span>
          </Label>
        </div>
      </RadioGroup>
      {value.mode === "electronic" && (
        <div className="flex items-start gap-3 rounded-lg border border-border p-3">
          <Checkbox
            id={`${idPrefix}-email-producers`}
            className="mt-0.5"
            disabled={readOnly}
            checked={!!value.email_producers_on_countersign}
            onCheckedChange={(c) => onChange({ ...value, email_producers_on_countersign: c === true })}
          />
          <Label htmlFor={`${idPrefix}-email-producers`} className="cursor-pointer font-normal">
            <span className="block text-sm font-medium">Also email producers the signed copy</span>
            <span className="block text-xs text-muted-foreground">
              When the artist signs, email the assigned producers a copy. Producers are notified in-app either way.
            </span>
          </Label>
        </div>
      )}
    </div>
  );
}
