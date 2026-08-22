import { useTranslation } from "react-i18next";
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
  const { t } = useTranslation("settingsHireOrders");
  return (
    <div className="space-y-4">
      <RadioGroup
        value={value.mode}
        onValueChange={(v) => onChange({ ...value, mode: v as CountersignMode })}
        disabled={readOnly}
        className="gap-3"
      >
        <div className="flex items-start gap-3 rounded-l border border-border p-3">
          <RadioGroupItem value="electronic" id={`${idPrefix}-electronic`} className="mt-0.5" />
          <Label htmlFor={`${idPrefix}-electronic`} className="cursor-pointer font-normal">
            <span className="block text-sm font-medium">{t("countersignFields.electronicTitle")}</span>
            <span className="block text-xs text-muted-foreground">
              {t("countersignFields.electronicBody")}
            </span>
          </Label>
        </div>
        <div className="flex items-start gap-3 rounded-l border border-border p-3">
          <RadioGroupItem value="manual" id={`${idPrefix}-manual`} className="mt-0.5" />
          <Label htmlFor={`${idPrefix}-manual`} className="cursor-pointer font-normal">
            <span className="block text-sm font-medium">{t("countersignFields.manualTitle")}</span>
            <span className="block text-xs text-muted-foreground">
              {t("countersignFields.manualBody")}
            </span>
          </Label>
        </div>
      </RadioGroup>
      {value.mode === "electronic" && (
        <div className="flex items-start gap-3 rounded-l border border-border p-3">
          <Checkbox
            id={`${idPrefix}-email-producers`}
            className="mt-0.5"
            disabled={readOnly}
            checked={!!value.email_producers_on_countersign}
            onCheckedChange={(c) => onChange({ ...value, email_producers_on_countersign: c === true })}
          />
          <Label htmlFor={`${idPrefix}-email-producers`} className="cursor-pointer font-normal">
            <span className="block text-sm font-medium">{t("countersignFields.emailProducersTitle")}</span>
            <span className="block text-xs text-muted-foreground">
              {t("countersignFields.emailProducersBody")}
            </span>
          </Label>
        </div>
      )}
    </div>
  );
}
