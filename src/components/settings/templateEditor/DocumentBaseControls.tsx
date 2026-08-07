import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Slider } from "@/components/ui/slider";
import { ScrollArea } from "@/components/ui/scroll-area";
import type { TemplateColorField, TemplateFont } from "./types";

interface ThemeDraft {
  base?: unknown;
}

export interface BaseFontField {
  key: string;
  label: string;
  kind?: string;
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
  key: string;
  label: string;
  value: number;
  min: number;
  max: number;
  step?: number;
  onChange: (value: number) => void;
}

export interface DocumentBaseControlsProps<Theme extends ThemeDraft> {
  title: string;
  base: Record<string, unknown>;
  baseModified: boolean;
  fonts: readonly TemplateFont[];
  fontFields: readonly BaseFontField[];
  colors: readonly TemplateColorField<string>[];
  colorValues: Record<string, string>;
  onBaseChange: (patch: Record<string, unknown>) => void;
  onThemeChange: (next: Theme) => void;
  themeDraft: Theme;
  readOnly: boolean;
  scaleField?: BaseScaleField;
  numberFields?: readonly BaseNumberField[];
  onColorChange?: (key: string, value: string) => void;
}

/** Parameterized base-style controls shared by document-like template editors. */
export function DocumentBaseControls<Theme extends ThemeDraft>({
  title,
  base,
  baseModified,
  fonts,
  fontFields,
  colors,
  colorValues,
  onBaseChange,
  onThemeChange,
  themeDraft,
  readOnly,
  scaleField,
  numberFields = [],
  onColorChange,
}: DocumentBaseControlsProps<Theme>) {
  const resetBase = () => {
    const next = { ...themeDraft } as Theme & { base?: unknown };
    delete next.base;
    onThemeChange(next as Theme);
  };

  return (
    <aside aria-label="Element settings" className="h-full">
      <ScrollArea className="h-full">
      <div className="space-y-4 p-4">
        <div className="flex items-center justify-between gap-2">
          <h3 className="font-display text-sm">{title}</h3>
          {baseModified && !readOnly && <Button type="button" variant="ghost" size="sm" className="h-6 px-2 text-xs" aria-label="Reset document style to default" onClick={resetBase}>Reset</Button>}
        </div>
        {fontFields.map((field) => (
          <div key={field.key} className="space-y-1.5">
            <Label htmlFor={`tpl-base-${field.key}`}>{field.label}</Label>
            <Select value={String(base[field.key] ?? "")} onValueChange={(value) => onBaseChange({ [field.key]: value })} disabled={readOnly}>
              <SelectTrigger id={`tpl-base-${field.key}`} aria-label={field.label}><SelectValue /></SelectTrigger>
              <SelectContent>{fonts.filter((font) => !field.kind || font.kind === field.kind).map((font) => <SelectItem key={font.key} value={font.key}>{font.label}</SelectItem>)}</SelectContent>
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
        <div className="space-y-2">
          <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Colours</p>
          {colors.map((field) => (
            <div key={field.key} className="flex items-center justify-between gap-2">
              <Label htmlFor={`tpl-color-${field.key}`} className="text-sm font-normal">{field.label}</Label>
              <Input id={`tpl-color-${field.key}`} type="color" className="h-8 w-14 p-1" value={colorValues[field.key]} disabled={readOnly} onChange={(event) => onColorChange?.(field.key, event.target.value.toUpperCase())} />
            </div>
          ))}
        </div>
        {numberFields.length > 0 && (
          <div className="space-y-2">
            <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Page margins</p>
            {numberFields.map((field) => (
              <div key={field.key} className="space-y-1">
                <Label htmlFor={`tpl-${field.key}`} className="text-sm font-normal">{field.label}</Label>
                <Input id={`tpl-${field.key}`} type="number" min={field.min} max={field.max} step={field.step} value={field.value} disabled={readOnly} onChange={(event) => {
                  const value = Number(event.target.value);
                  if (event.target.value.trim() !== "" && Number.isFinite(value)) field.onChange(value);
                }} />
              </div>
            ))}
          </div>
        )}
      </div>
      </ScrollArea>
    </aside>
  );
}
