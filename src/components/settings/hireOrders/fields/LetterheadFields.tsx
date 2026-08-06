import type { ReactNode } from "react";
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
  return (
    <div className="space-y-4">
      <div className="space-y-1.5">
        <Label htmlFor={`${idPrefix}-legal-name`}>Legal name</Label>
        <Input
          id={`${idPrefix}-legal-name`}
          value={value.legal_name}
          placeholder="Aurora Productions GmbH"
          disabled={readOnly}
          onChange={(e) => onChange({ ...value, legal_name: e.target.value })}
        />
      </div>
      <div className="space-y-1.5">
        <Label htmlFor={`${idPrefix}-address`}>Address</Label>
        <Textarea
          id={`${idPrefix}-address`}
          rows={3}
          value={addressText}
          placeholder={"Street and number\nPostal code and city\nCountry"}
          disabled={readOnly}
          onChange={(e) => onAddressTextChange(e.target.value)}
        />
        <p className="text-xs text-muted-foreground">One line per row.</p>
      </div>
      <div className="space-y-1.5">
        <Label htmlFor={`${idPrefix}-registration`}>Registration line</Label>
        <Input
          id={`${idPrefix}-registration`}
          value={value.registration_line}
          placeholder="Registered at Amtsgericht Berlin, HRB 123456"
          disabled={readOnly}
          onChange={(e) => onChange({ ...value, registration_line: e.target.value })}
        />
      </div>
      {children}
    </div>
  );
}
