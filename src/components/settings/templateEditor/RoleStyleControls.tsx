import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { hasOwnKeys, numericInputValue } from "./overrideMap";
import type { GenericRoleStyle, TemplateColorField, TemplateFont, TemplateRole } from "./types";

type ThemeDraft<RoleKey extends string> = {
  roles?: Partial<Record<RoleKey, GenericRoleStyle | null | undefined>>;
};

export interface RoleStyleControlsProps<RoleKey extends string, Theme extends ThemeDraft<RoleKey>> {
  role: TemplateRole<RoleKey, string>;
  roleDefaults: GenericRoleStyle;
  themeDraft: Theme;
  fonts: readonly TemplateFont[];
  colorFields: readonly TemplateColorField<string>[];
  onThemeChange: (next: Theme) => void;
  readOnly: boolean;
}

/** Generic typography controls. Whole-role and one-field resets delete keys. */
export function RoleStyleControls<RoleKey extends string, Theme extends ThemeDraft<RoleKey>>({
  role,
  roleDefaults,
  themeDraft,
  fonts,
  colorFields,
  onThemeChange,
  readOnly,
}: RoleStyleControlsProps<RoleKey, Theme>) {
  const override = themeDraft.roles?.[role.key];
  const style = { ...roleDefaults, ...(override ?? {}) };
  const setRole = (patch: Partial<GenericRoleStyle>) => {
    onThemeChange({
      ...themeDraft,
      roles: { ...themeDraft.roles, [role.key]: { ...(override ?? {}), ...patch } },
    } as Theme);
  };
  const clearRoleField = (field: keyof GenericRoleStyle) => {
    const nextStyle = { ...(override ?? {}) };
    delete nextStyle[field];
    onThemeChange({ ...themeDraft, roles: { ...themeDraft.roles, [role.key]: nextStyle } } as Theme);
  };
  const resetRole = () => {
    const roles = { ...themeDraft.roles };
    delete roles[role.key];
    onThemeChange({ ...themeDraft, roles } as Theme);
  };

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between gap-2">
        <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Style</p>
        {hasOwnKeys(override) && !readOnly && (
          <Button type="button" variant="ghost" size="sm" className="h-6 px-2 text-xs" aria-label={`Reset ${role.label} style to default`} onClick={resetRole}>
            Reset
          </Button>
        )}
      </div>
      <div className="space-y-1.5">
        <Label htmlFor="tpl-role-family">Font</Label>
        <Select value={style.family ?? "inherit"} onValueChange={(value) => value === "inherit" ? clearRoleField("family") : setRole({ family: value })} disabled={readOnly}>
          <SelectTrigger id="tpl-role-family" aria-label="Font"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="inherit">Document font</SelectItem>
            {fonts.map((font) => <SelectItem key={font.key} value={font.key}>{font.label}</SelectItem>)}
          </SelectContent>
        </Select>
      </div>
      {style.size !== undefined && (
        <div className="space-y-1.5">
          <Label htmlFor="tpl-role-size">Size</Label>
          <Input id="tpl-role-size" type="number" min={5} max={60} step={0.5} value={style.size} disabled={readOnly} onChange={(event) => {
            const size = numericInputValue(event.target.value);
            if (size !== null) setRole({ size });
          }} />
        </div>
      )}
      <div className="space-y-1.5">
        <Label htmlFor="tpl-role-weight">Weight</Label>
        <Select value={String(style.weight ?? 400)} onValueChange={(value) => setRole({ weight: Number(value) })} disabled={readOnly}>
          <SelectTrigger id="tpl-role-weight" aria-label="Weight"><SelectValue /></SelectTrigger>
          <SelectContent><SelectItem value="400">Regular</SelectItem><SelectItem value="500">Medium</SelectItem><SelectItem value="600">Semibold</SelectItem></SelectContent>
        </Select>
      </div>
      <div className="space-y-1.5">
        <Label htmlFor="tpl-role-color">Colour</Label>
        <Select value={style.color ?? colorFields[0]?.key ?? ""} onValueChange={(value) => setRole({ color: value })} disabled={readOnly}>
          <SelectTrigger id="tpl-role-color" aria-label="Colour"><SelectValue /></SelectTrigger>
          <SelectContent>{colorFields.map((field) => <SelectItem key={field.key} value={field.key}>{field.label}</SelectItem>)}</SelectContent>
        </Select>
      </div>
      <div className="space-y-1.5">
        <Label htmlFor="tpl-role-tracking">Letter spacing</Label>
        <Input id="tpl-role-tracking" type="number" min={-1} max={8} step={0.1} value={style.letterSpacing ?? 0} disabled={readOnly} onChange={(event) => {
          const letterSpacing = numericInputValue(event.target.value);
          if (letterSpacing !== null) setRole({ letterSpacing });
        }} />
      </div>
      <div className="space-y-1.5">
        <Label htmlFor="tpl-role-case">Case</Label>
        <Select value={style.transform ?? "none"} onValueChange={(value) => setRole({ transform: value })} disabled={readOnly}>
          <SelectTrigger id="tpl-role-case" aria-label="Case"><SelectValue /></SelectTrigger>
          <SelectContent><SelectItem value="none">As typed</SelectItem><SelectItem value="uppercase">Uppercase</SelectItem></SelectContent>
        </Select>
      </div>
    </div>
  );
}
