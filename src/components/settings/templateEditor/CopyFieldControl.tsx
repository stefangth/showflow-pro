import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import type { TemplateCopyField } from "./types";

export interface CopyFieldControlProps<CopyKey extends string, FieldKey extends CopyKey = CopyKey> {
  field: TemplateCopyField<FieldKey>;
  defaultValue: string;
  copyDraft: Partial<Record<CopyKey, string | null | undefined>>;
  onCopyChange: (next: Partial<Record<CopyKey, string>>) => void;
  readOnly: boolean;
}

/** A metadata-driven copy field with safe reset and forbidden-dash feedback. */
export function CopyFieldControl<CopyKey extends string, FieldKey extends CopyKey = CopyKey>({
  field,
  defaultValue,
  copyDraft,
  onCopyChange,
  readOnly,
}: CopyFieldControlProps<CopyKey, FieldKey>) {
  const value = copyDraft[field.key] ?? defaultValue;
  const modified = value !== defaultValue;
  const id = `tpl-copy-${field.key}`;
  const setValue = (nextValue: string) => onCopyChange({ ...copyDraft, [field.key]: nextValue } as Partial<Record<CopyKey, string>>);
  const reset = () => {
    const next = { ...copyDraft };
    delete next[field.key];
    onCopyChange(next as Partial<Record<CopyKey, string>>);
  };

  return (
    <div className="space-y-1.5">
      <div className="flex items-center justify-between gap-2">
        <Label htmlFor={id}>{field.label}</Label>
        {modified && !readOnly && (
          <Button type="button" variant="ghost" size="sm" className="h-6 px-2 text-xs" aria-label={`Reset ${field.label} to default`} onClick={reset}>
            Reset
          </Button>
        )}
      </div>
      {field.multiline ? (
        <Textarea id={id} rows={2} value={value} disabled={readOnly} onChange={(event) => setValue(event.target.value)} />
      ) : (
        <Input id={id} value={value} disabled={readOnly} onChange={(event) => setValue(event.target.value)} />
      )}
      {field.tokens.length > 0 && <p className="text-xs text-muted-foreground">Tokens: {field.tokens.map((token) => `{{${token}}}`).join(" ")}</p>}
      {/[–—]/.test(value) && <p className="text-xs text-destructive">Use a period, comma, or middot instead of a dash.</p>}
    </div>
  );
}
