import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { hasOwnKeys, numericInputValue } from "./overrideMap";
import type { GenericRoleStyle, TemplateColorField, TemplateFont, TemplateRole } from "./types";

export interface RoleWeightOption {
  value: number;
  label: string;
}

export interface RoleStyleControlsProps<RoleKey extends string> {
  role: TemplateRole<RoleKey, string>;
  roleDefaults: GenericRoleStyle;
  roleOverride?: unknown;
  fonts: readonly TemplateFont[];
  colorFields: readonly TemplateColorField<string>[];
  onRoleChange: (next: Record<string, unknown>) => void;
  onResetRole: () => void;
  readOnly: boolean;
  fontResetLabel?: string;
  weightOptions?: readonly RoleWeightOption[];
}

const PDF_WEIGHT_OPTIONS: readonly RoleWeightOption[] = [
  { value: 400, label: "Regular" },
  { value: 500, label: "Medium" },
  { value: 600, label: "Semibold" },
];

function asRecord(value: unknown): Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

function finiteOr(value: unknown, fallback: number | undefined): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

/** Generic typography controls over one sparse role override, never a domain theme. */
export function RoleStyleControls<RoleKey extends string>({
  role,
  roleDefaults,
  roleOverride,
  fonts,
  colorFields,
  onRoleChange,
  onResetRole,
  readOnly,
  fontResetLabel = "Document font",
  weightOptions = PDF_WEIGHT_OPTIONS,
}: RoleStyleControlsProps<RoleKey>) {
  const override = asRecord(roleOverride);
  const family = typeof override.family === "string" ? override.family : roleDefaults.family;
  const size = finiteOr(override.size, roleDefaults.size);
  const weight = finiteOr(override.weight, roleDefaults.weight) ?? weightOptions[0]?.value ?? 400;
  const color = typeof override.color === "string" ? override.color : roleDefaults.color;
  const letterSpacing = finiteOr(override.letterSpacing, roleDefaults.letterSpacing) ?? 0;
  const transform = typeof override.transform === "string" ? override.transform : roleDefaults.transform ?? "none";
  const setRole = (patch: Record<string, unknown>) => onRoleChange({ ...override, ...patch });
  const clearRoleField = (field: keyof GenericRoleStyle) => {
    const next = { ...override };
    delete next[field];
    onRoleChange(next);
  };

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between gap-2">
        <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Style</p>
        {hasOwnKeys(override) && !readOnly && (
          <Button type="button" variant="ghost" size="sm" className="h-6 px-2 text-xs" aria-label={`Reset ${role.label} style to default`} onClick={onResetRole}>
            Reset
          </Button>
        )}
      </div>
      <div className="space-y-1.5">
        <Label htmlFor="tpl-role-family">Font</Label>
        <Select value={family ?? "inherit"} onValueChange={(value) => value === "inherit" ? clearRoleField("family") : setRole({ family: value })} disabled={readOnly}>
          <SelectTrigger id="tpl-role-family" aria-label="Font"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="inherit">{fontResetLabel}</SelectItem>
            {fonts.map((font) => <SelectItem key={font.key} value={font.key}>{font.label}</SelectItem>)}
          </SelectContent>
        </Select>
      </div>
      {size !== undefined && (
        <div className="space-y-1.5">
          <Label htmlFor="tpl-role-size">Size</Label>
          <Input id="tpl-role-size" type="number" min={5} max={60} step={0.5} value={size} disabled={readOnly} onChange={(event) => {
            const nextSize = numericInputValue(event.target.value);
            if (nextSize !== null) setRole({ size: nextSize });
          }} />
        </div>
      )}
      <div className="space-y-1.5">
        <Label htmlFor="tpl-role-weight">Weight</Label>
        <Select value={String(weight)} onValueChange={(value) => setRole({ weight: Number(value) })} disabled={readOnly}>
          <SelectTrigger id="tpl-role-weight" aria-label="Weight"><SelectValue /></SelectTrigger>
          <SelectContent>{weightOptions.map((option) => <SelectItem key={option.value} value={String(option.value)}>{option.label}</SelectItem>)}</SelectContent>
        </Select>
      </div>
      <div className="space-y-1.5">
        <Label htmlFor="tpl-role-color">Colour</Label>
        <Select value={color ?? colorFields[0]?.key ?? ""} onValueChange={(value) => setRole({ color: value })} disabled={readOnly}>
          <SelectTrigger id="tpl-role-color" aria-label="Colour"><SelectValue /></SelectTrigger>
          <SelectContent>{colorFields.map((field) => <SelectItem key={field.key} value={field.key}>{field.label}</SelectItem>)}</SelectContent>
        </Select>
      </div>
      <div className="space-y-1.5">
        <Label htmlFor="tpl-role-tracking">Letter spacing</Label>
        <Input id="tpl-role-tracking" type="number" min={-1} max={8} step={0.1} value={letterSpacing} disabled={readOnly} onChange={(event) => {
          const nextLetterSpacing = numericInputValue(event.target.value);
          if (nextLetterSpacing !== null) setRole({ letterSpacing: nextLetterSpacing });
        }} />
      </div>
      <div className="space-y-1.5">
        <Label htmlFor="tpl-role-case">Case</Label>
        <Select value={transform} onValueChange={(value) => setRole({ transform: value })} disabled={readOnly}>
          <SelectTrigger id="tpl-role-case" aria-label="Case"><SelectValue /></SelectTrigger>
          <SelectContent><SelectItem value="none">As typed</SelectItem><SelectItem value="uppercase">Uppercase</SelectItem></SelectContent>
        </Select>
      </div>
    </div>
  );
}
