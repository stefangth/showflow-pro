import type { ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import type { Letterhead } from "../LetterheadCard";

export interface LetterheadFieldsProps {
  value: Letterhead;
  /** Raw address text, kept verbatim while typing and parsed only on save. */
  addressText: string;
  onChange: (next: Letterhead) => void;
  onAddressTextChange: (next: string) => void;
  readOnly?: boolean;
  /** Rendered after the three shared fields. Settings passes its agent name, agent
   *  email and agent-signature block here; the setup rail passes nothing, which is
   *  what makes it the compact variant. */
  children?: ReactNode;
  /** Disambiguates input ids when both surfaces are mounted in one tree. */
  idPrefix?: string;
}

/** The three letterhead fields shared by Settings and the setup rail. Fully
 *  controlled: it owns no state and performs no writes, so the two callers cannot
 *  drift in what they render, only in what they save. */
export function LetterheadFields({
  value,
  addressText,
  onChange,
  onAddressTextChange,
  readOnly = false,
  children,
  idPrefix = "ho",
}: LetterheadFieldsProps) {
  const { t } = useTranslation("settingsHireOrders");
  return (
    <div className="space-y-4">
      <div className="space-y-1.5">
        <Label htmlFor={`${idPrefix}-legal-name`}>{t("letterheadFields.legalName")}</Label>
        <Input
          id={`${idPrefix}-legal-name`}
          value={value.legal_name}
          placeholder={t("letterheadFields.legalNamePlaceholder")}
          disabled={readOnly}
          onChange={(e) => onChange({ ...value, legal_name: e.target.value })}
        />
      </div>
      <div className="space-y-1.5">
        <Label htmlFor={`${idPrefix}-address`}>{t("letterheadFields.address")}</Label>
        <Textarea
          id={`${idPrefix}-address`}
          rows={3}
          value={addressText}
          placeholder={t("letterheadFields.addressPlaceholder")}
          disabled={readOnly}
          onChange={(e) => onAddressTextChange(e.target.value)}
        />
        <p className="text-xs text-muted-foreground">{t("letterheadFields.addressHelp")}</p>
      </div>
      <div className="space-y-1.5">
        <Label htmlFor={`${idPrefix}-registration`}>{t("letterheadFields.registrationLine")}</Label>
        <Input
          id={`${idPrefix}-registration`}
          value={value.registration_line}
          placeholder={t("letterheadFields.registrationLinePlaceholder")}
          disabled={readOnly}
          onChange={(e) => onChange({ ...value, registration_line: e.target.value })}
        />
      </div>
      {children}
    </div>
  );
}
