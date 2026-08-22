import { useTranslation } from "react-i18next";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Slider } from "@/components/ui/slider";
import { Textarea } from "@/components/ui/textarea";
import type { TemplateColorField, TemplateFont } from "./types";

interface ThemeDraft { base?: unknown; }

export interface BaseFontField {
  key: string;
  label: string;
  allowedKinds?: readonly string[];
}

export interface BaseScaleField {
  label: string;
  value: number;
  min: number;
  max: number;
  step: number;
  description: string;
  onChange: (value: number) => void;
}

export interface BaseNumberField {
  kind: "number";
  key: string;
  label: string;
  value: number;
  min: number;
  max: number;
  step?: number;
  onChange: (value: number) => void;
}

export interface BaseTextField {
  kind: "text";
  key: string;
  label: string;
  value: string;
  multiline?: boolean;
  onChange: (value: string) => void;
}

export interface BaseFieldGroup {
  label: string;
  fields: readonly (BaseNumberField | BaseTextField)[];
}

export interface DocumentBaseControlsProps<Theme extends ThemeDraft> {
  title: string;
  base: object;
  baseModified: boolean;
  fonts: readonly TemplateFont[];
  fontFields: readonly BaseFontField[];
  colors: readonly TemplateColorField<string>[];
  colorValues: Record<string, string>;
  fieldGroups?: readonly BaseFieldGroup[];
  onBaseChange: (patch: Record<string, unknown>) => void;
  onThemeChange: (next: Theme) => void;
  themeDraft: Theme;
  readOnly: boolean;
  scaleField?: BaseScaleField;
  onColorChange?: (key: string, value: string) => void;
}

/** Parameterized base-style controls shared by document-like template editors. */
export function DocumentBaseControls<Theme extends ThemeDraft>({
  title, base, baseModified, fonts, fontFields, colors, colorValues, fieldGroups = [], onBaseChange,
  onThemeChange, themeDraft, readOnly, scaleField, onColorChange,
}: DocumentBaseControlsProps<Theme>) {
  const { t } = useTranslation("settingsEditor");
  const baseValues = base as Record<string, unknown>;
  const resetBase = () => {
    const next = { ...themeDraft } as Theme & { base?: unknown };
    delete next.base;
    onThemeChange(next as Theme);
  };

  return (
    <aside aria-label={t("documentBase.elementSettingsAria")} className="h-full">
      <ScrollArea className="h-full">
        <div className="space-y-4 p-4">
          <div className="flex items-center justify-between gap-2">
            <h3 className="font-display text-sm">{title}</h3>
            {baseModified && !readOnly && <button type="button" className="text-control font-medium text-accent-text hover:underline" aria-label={t("documentBase.resetAria")} onClick={resetBase}>{t("documentBase.reset")}</button>}
          </div>
          {fontFields.map((field) => (
            <div key={field.key} className="space-y-1.5">
              <Label htmlFor={`tpl-base-${field.key}`}>{field.label}</Label>
              <Select value={String(baseValues[field.key] ?? "")} onValueChange={(value) => onBaseChange({ [field.key]: value })} disabled={readOnly}>
                <SelectTrigger id={`tpl-base-${field.key}`} aria-label={field.label}><SelectValue /></SelectTrigger>
                <SelectContent>{fonts.filter((font) => !field.allowedKinds || field.allowedKinds.includes(font.kind ?? "")).map((font) => <SelectItem key={font.key} value={font.key}>{font.label}</SelectItem>)}</SelectContent>
              </Select>
            </div>
          ))}
          {scaleField && (
            <div className="space-y-1.5">
              <Label htmlFor="tpl-scale">{scaleField.label}</Label>
              <Slider id="tpl-scale" aria-label={scaleField.label} min={scaleField.min} max={scaleField.max} step={scaleField.step} value={[scaleField.value]} disabled={readOnly} onValueChange={([value]) => scaleField.onChange(value)} />
              <p className="text-xs text-muted-foreground">{scaleField.description}</p>
            </div>
          )}
          {colors.length > 0 && <div className="space-y-2">
            {/* eslint-disable-next-line no-restricted-syntax -- non-standard tracking */}
            <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">{t("documentBase.colours")}</p>
            {colors.map((field) => (
              <div key={field.key} className="flex items-center justify-between gap-2">
                <Label htmlFor={`tpl-color-${field.key}`} className="text-sm font-normal">{field.label}</Label>
                <Input id={`tpl-color-${field.key}`} type="color" className="h-8 w-14 p-1" value={colorValues[field.key]} disabled={readOnly} onChange={(event) => onColorChange?.(field.key, event.target.value.toUpperCase())} />
              </div>
            ))}
          </div>}
          {fieldGroups.map((group) => (
            <div key={group.label} className="space-y-2">
              {/* eslint-disable-next-line no-restricted-syntax -- non-standard tracking */}
              <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">{group.label}</p>
              {group.fields.map((field) => field.kind === "number" ? (
                <div key={field.key} className="space-y-1">
                  <Label htmlFor={`tpl-${field.key}`} className="text-sm font-normal">{field.label}</Label>
                  <Input id={`tpl-${field.key}`} type="number" min={field.min} max={field.max} step={field.step} value={field.value} disabled={readOnly} onChange={(event) => {
                    const value = Number(event.target.value);
                    if (event.target.value.trim() !== "" && Number.isFinite(value)) field.onChange(value);
                  }} />
                </div>
              ) : (
                <div key={field.key} className="space-y-1">
                  <Label htmlFor={`tpl-${field.key}`} className="text-sm font-normal">{field.label}</Label>
                  {field.multiline
                    ? <Textarea id={`tpl-${field.key}`} rows={2} value={field.value} disabled={readOnly} onChange={(event) => field.onChange(event.target.value)} />
                    : <Input id={`tpl-${field.key}`} value={field.value} disabled={readOnly} onChange={(event) => field.onChange(event.target.value)} />}
                </div>
              ))}
            </div>
          ))}
        </div>
      </ScrollArea>
    </aside>
  );
}
