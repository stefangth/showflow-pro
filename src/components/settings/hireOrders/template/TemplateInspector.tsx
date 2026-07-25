// The right pane: typography/colour controls plus the bound copy fields for
// whichever role is selected in the outline. Selecting the "document" entry
// shows the base controls instead (fonts, scale, colour palette, margins).
//
// NEVER WRITE null/undefined-AS-A-VALUE INTO THE DRAFT. An override map's
// "unchanged" state is a plain ABSENT key - a leaf explicitly set to null or
// undefined still resolves to the hard-coded default, but it also still
// shows up in Object.keys(...), which is exactly what the outline pane (and
// this pane's own "modified" checks) use to decide whether something is
// overridden. Every clear/reset path below therefore deletes the key it is
// clearing, never assigns it a nullish value. See resetCopy, resetRole,
// clearRoleField, and resetBase.

import { HIRE_ORDER_COPY_DEFAULTS, type CopyKey, type HireOrderCopy } from "@/lib/hireOrders/pdf/pdfCopy";
import {
  HIRE_ORDER_THEME_DEFAULTS,
  selectableFontFamilies,
  type FontFamilyKey,
  type HireOrderThemeOverride,
  type RoleKey,
  type RoleStyle,
  type ThemeColorKey,
} from "@/lib/hireOrders/pdf/pdfTheme";
import { COPY_SECTIONS, hasBadDash, type CopyField } from "../pdfCopyMeta";
import { COPY_LABELS, TEMPLATE_SECTIONS, type TemplateRole } from "./templateMeta";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Slider } from "@/components/ui/slider";
import { Textarea } from "@/components/ui/textarea";

export interface TemplateInspectorProps {
  selected: RoleKey | "document";
  readOnly: boolean;
  copyDraft: Partial<HireOrderCopy>;
  themeDraft: HireOrderThemeOverride;
  onCopyChange: (next: Partial<HireOrderCopy>) => void;
  onThemeChange: (next: HireOrderThemeOverride) => void;
}

const ALL_ROLES: TemplateRole[] = TEMPLATE_SECTIONS.flatMap((s) => s.roles);

/** Copy-key -> its full field metadata (label, token hints, multiline), taken
 *  straight from pdfCopyMeta.ts's COPY_SECTIONS - never re-derived (e.g. by
 *  regexing the default strings for {{token}}), so this pane can never show
 *  a token hint that disagrees with the one PdfCopyCard would have shown. */
const COPY_FIELDS: Record<CopyKey, CopyField> = Object.fromEntries(
  COPY_SECTIONS.flatMap((section) => section.fields.map((field) => [field.key, field] as const)),
) as Record<CopyKey, CopyField>;

const COLOR_KEYS: ThemeColorKey[] = ["text", "muted", "faint", "accent", "line", "feeCell", "surface2"];
const COLOR_LABELS: Record<ThemeColorKey, string> = {
  text: "Text",
  muted: "Muted text",
  faint: "Faint text",
  accent: "Accent",
  line: "Rules and borders",
  feeCell: "Fee cell background",
  surface2: "Total row background",
};
const MARGIN_KEYS = ["marginX", "marginTop", "marginBottom"] as const;
const MARGIN_LABELS: Record<(typeof MARGIN_KEYS)[number], string> = {
  marginX: "Left and right",
  marginTop: "Top",
  marginBottom: "Bottom",
};

/** True for a non-null object with at least one own key. Guards both
 *  directions a hand-edited app_settings blob (or a stray bug) could go
 *  wrong: present-but-empty must NOT read as modified, and a stray `null`
 *  must not throw (`Object.keys(null)` throws; `typeof null === "object"`
 *  is also true, so the null check has to be explicit). Same helper as
 *  TemplateOutline's, kept local rather than shared since it is four lines. */
function hasOwnKeys(value: unknown): boolean {
  return typeof value === "object" && value !== null && Object.keys(value).length > 0;
}

export function TemplateInspector({
  selected,
  readOnly,
  copyDraft,
  themeDraft,
  onCopyChange,
  onThemeChange,
}: TemplateInspectorProps) {
  function setCopy(key: CopyKey, value: string) {
    onCopyChange({ ...copyDraft, [key]: value });
  }
  function resetCopy(key: CopyKey) {
    const next = { ...copyDraft };
    delete next[key];
    onCopyChange(next);
  }
  function setBase(patch: Partial<NonNullable<HireOrderThemeOverride["base"]>>) {
    onThemeChange({ ...themeDraft, base: { ...themeDraft.base, ...patch } });
  }
  /** Deletes `base` entirely (never sets it to `{}` or a nullish value), so
   *  the outline's document "modified" check (an own-keys count on `base`)
   *  goes back to reading unmodified, and every base field resolves off the
   *  hard-coded default again. */
  function resetBase() {
    const next = { ...themeDraft };
    delete next.base;
    onThemeChange(next);
  }
  function setRole(role: RoleKey, patch: Partial<RoleStyle>) {
    onThemeChange({
      ...themeDraft,
      roles: { ...themeDraft.roles, [role]: { ...themeDraft.roles?.[role], ...patch } },
    });
  }
  /** Clears ONE field of a role's override (e.g. "back to the document font")
   *  by deleting that key from the role's patch object, leaving any other
   *  overridden field on the same role untouched. Setting the field to
   *  `undefined` instead would leave it present in Object.keys(...) - same
   *  failure mode as writing `null` - so the whole role could keep reading
   *  as "modified" even after every field on it was individually cleared. */
  function clearRoleField(role: RoleKey, field: keyof RoleStyle) {
    const current = { ...themeDraft.roles?.[role] };
    delete current[field];
    onThemeChange({ ...themeDraft, roles: { ...themeDraft.roles, [role]: current } });
  }
  /** Deletes the whole role entry (never sets it to `{}` or null). */
  function resetRole(role: RoleKey) {
    const roles = { ...themeDraft.roles };
    delete roles[role];
    onThemeChange({ ...themeDraft, roles });
  }

  if (selected === "document") {
    return (
      <DocumentInspector
        readOnly={readOnly}
        themeDraft={themeDraft}
        setBase={setBase}
        resetBase={resetBase}
      />
    );
  }

  const role = ALL_ROLES.find((r) => r.key === selected);
  if (!role) return <aside aria-label="Element settings" className="h-full" />;

  return (
    <aside aria-label="Element settings" className="h-full">
      <ScrollArea className="h-full">
        <div className="space-y-5 p-4">
          <h3 className="font-display text-sm">{role.label}</h3>

          {role.copyKeys.length > 0 && (
            <div className="space-y-3">
              <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Text</p>
              {role.copyKeys.map((key) => (
                <CopyFieldControl
                  key={key}
                  fieldKey={key}
                  copyDraft={copyDraft}
                  readOnly={readOnly}
                  setCopy={setCopy}
                  resetCopy={resetCopy}
                />
              ))}
            </div>
          )}

          <RoleStyleControls
            role={role}
            readOnly={readOnly}
            themeDraft={themeDraft}
            setRole={setRole}
            clearRoleField={clearRoleField}
            resetRole={resetRole}
          />
        </div>
      </ScrollArea>
    </aside>
  );
}

interface CopyFieldControlProps {
  fieldKey: CopyKey;
  copyDraft: Partial<HireOrderCopy>;
  readOnly: boolean;
  setCopy: (key: CopyKey, value: string) => void;
  resetCopy: (key: CopyKey) => void;
}

/** One "Text" field: label, input (or textarea for a long field), the token
 *  hint and dash warning carried over verbatim from PdfCopyCard/pdfCopyMeta,
 *  and a reset-to-default button that only appears once the field differs
 *  from its default. A stray `null` draft value (hand-edited app_settings)
 *  falls back to the default via `??`, same as an absent key - it must not
 *  crash and must not read as modified. */
function CopyFieldControl({ fieldKey, copyDraft, readOnly, setCopy, resetCopy }: CopyFieldControlProps) {
  const field = COPY_FIELDS[fieldKey];
  const label = COPY_LABELS[fieldKey] ?? field.label;
  const value = copyDraft[fieldKey] ?? HIRE_ORDER_COPY_DEFAULTS[fieldKey];
  const modified = value !== HIRE_ORDER_COPY_DEFAULTS[fieldKey];
  const id = `tpl-copy-${fieldKey}`;

  return (
    <div className="space-y-1.5">
      <div className="flex items-center justify-between gap-2">
        <Label htmlFor={id}>{label}</Label>
        {modified && !readOnly && (
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="h-6 px-2 text-xs"
            aria-label={`Reset ${label} to default`}
            onClick={() => resetCopy(fieldKey)}
          >
            Reset
          </Button>
        )}
      </div>
      {field.multiline ? (
        <Textarea
          id={id}
          rows={2}
          value={value}
          disabled={readOnly}
          onChange={(e) => setCopy(fieldKey, e.target.value)}
        />
      ) : (
        <Input id={id} value={value} disabled={readOnly} onChange={(e) => setCopy(fieldKey, e.target.value)} />
      )}
      {field.tokens.length > 0 && (
        <p className="text-xs text-muted-foreground">Tokens: {field.tokens.map((t) => `{{${t}}}`).join(" ")}</p>
      )}
      {hasBadDash(value) && (
        <p className="text-xs text-destructive">Use a period, comma, or middot instead of a dash.</p>
      )}
    </div>
  );
}

interface RoleStyleControlsProps {
  role: TemplateRole;
  readOnly: boolean;
  themeDraft: HireOrderThemeOverride;
  setRole: (role: RoleKey, patch: Partial<RoleStyle>) => void;
  clearRoleField: (role: RoleKey, field: keyof RoleStyle) => void;
  resetRole: (role: RoleKey) => void;
}

/** The "Style" group for one role: font, size (only if this role has a
 *  default size - some roles, like clause titles, inherit their size from
 *  the surrounding text and were never given one), weight, colour, letter
 *  spacing, and case. */
function RoleStyleControls({ role, readOnly, themeDraft, setRole, clearRoleField, resetRole }: RoleStyleControlsProps) {
  const fonts = selectableFontFamilies();
  const override = themeDraft.roles?.[role.key];
  const style = { ...HIRE_ORDER_THEME_DEFAULTS.roles[role.key], ...override };
  // hasOwnKeys already treats a stray `null` override (a hand-edited
  // app_settings blob) the same as an absent one - see its own doc comment.
  const styleModified = hasOwnKeys(override);

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between gap-2">
        <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Style</p>
        {styleModified && !readOnly && (
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="h-6 px-2 text-xs"
            aria-label={`Reset ${role.label} style to default`}
            onClick={() => resetRole(role.key)}
          >
            Reset
          </Button>
        )}
      </div>

      <div className="space-y-1.5">
        <Label htmlFor="tpl-role-family">Font</Label>
        <Select
          value={style.family ?? "inherit"}
          onValueChange={(v) => {
            if (v === "inherit") clearRoleField(role.key, "family");
            else setRole(role.key, { family: v as FontFamilyKey });
          }}
          disabled={readOnly}
        >
          <SelectTrigger id="tpl-role-family" aria-label="Font">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="inherit">Document font</SelectItem>
            {fonts.map((f) => (
              <SelectItem key={f.key} value={f.key}>{f.label}</SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {style.size !== undefined && (
        <div className="space-y-1.5">
          <Label htmlFor="tpl-role-size">Size</Label>
          <Input
            id="tpl-role-size"
            type="number"
            min={5}
            max={60}
            step={0.5}
            value={style.size}
            disabled={readOnly}
            onChange={(e) => setRole(role.key, { size: Number(e.target.value) })}
          />
        </div>
      )}

      <div className="space-y-1.5">
        <Label htmlFor="tpl-role-weight">Weight</Label>
        <Select
          value={String(style.weight ?? 400)}
          onValueChange={(v) => setRole(role.key, { weight: Number(v) as 400 | 500 | 600 })}
          disabled={readOnly}
        >
          <SelectTrigger id="tpl-role-weight" aria-label="Weight">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="400">Regular</SelectItem>
            <SelectItem value="500">Medium</SelectItem>
            <SelectItem value="600">Semibold</SelectItem>
          </SelectContent>
        </Select>
      </div>

      <div className="space-y-1.5">
        <Label htmlFor="tpl-role-color">Colour</Label>
        <Select
          value={style.color ?? "text"}
          onValueChange={(v) => setRole(role.key, { color: v as ThemeColorKey })}
          disabled={readOnly}
        >
          <SelectTrigger id="tpl-role-color" aria-label="Colour">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {COLOR_KEYS.map((k) => (
              <SelectItem key={k} value={k}>{COLOR_LABELS[k]}</SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      <div className="space-y-1.5">
        <Label htmlFor="tpl-role-tracking">Letter spacing</Label>
        <Input
          id="tpl-role-tracking"
          type="number"
          min={-1}
          max={8}
          step={0.1}
          value={style.letterSpacing ?? 0}
          disabled={readOnly}
          onChange={(e) => setRole(role.key, { letterSpacing: Number(e.target.value) })}
        />
      </div>

      <div className="space-y-1.5">
        <Label htmlFor="tpl-role-case">Case</Label>
        <Select
          value={style.transform ?? "none"}
          onValueChange={(v) => setRole(role.key, { transform: v as "none" | "uppercase" })}
          disabled={readOnly}
        >
          <SelectTrigger id="tpl-role-case" aria-label="Case">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="none">As typed</SelectItem>
            <SelectItem value="uppercase">Uppercase</SelectItem>
          </SelectContent>
        </Select>
      </div>
    </div>
  );
}

interface DocumentInspectorProps {
  readOnly: boolean;
  themeDraft: HireOrderThemeOverride;
  setBase: (patch: Partial<NonNullable<HireOrderThemeOverride["base"]>>) => void;
  resetBase: () => void;
}

/** The base controls shown for the "document" outline entry: body/numeric
 *  font, the overall scale, the colour palette, and page margins. Colours
 *  and margins are each merged against their OWN defaults (not against the
 *  shallowly-merged `base` object) because they are nested objects - a
 *  shallow `{...defaults.base, ...themeDraft.base}` would replace an entire
 *  partially-overridden `page` (or `colors`) object wholesale, silently
 *  losing the untouched sibling keys instead of leaving them at default. */
function DocumentInspector({ readOnly, themeDraft, setBase, resetBase }: DocumentInspectorProps) {
  const base = { ...HIRE_ORDER_THEME_DEFAULTS.base, ...themeDraft.base };
  const colors = { ...HIRE_ORDER_THEME_DEFAULTS.base.colors, ...themeDraft.base?.colors };
  const page = { ...HIRE_ORDER_THEME_DEFAULTS.base.page, ...themeDraft.base?.page };
  const fonts = selectableFontFamilies();
  const baseModified = hasOwnKeys(themeDraft.base);

  return (
    <aside aria-label="Element settings" className="h-full">
      <ScrollArea className="h-full">
        <div className="space-y-4 p-4">
          <div className="flex items-center justify-between gap-2">
            <h3 className="font-display text-sm">Document</h3>
            {baseModified && !readOnly && (
              <Button
                type="button"
                variant="ghost"
                size="sm"
                className="h-6 px-2 text-xs"
                aria-label="Reset document style to default"
                onClick={resetBase}
              >
                Reset
              </Button>
            )}
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="tpl-body-font">Body font</Label>
            <Select
              value={base.fontFamily}
              onValueChange={(v) => setBase({ fontFamily: v as FontFamilyKey })}
              disabled={readOnly}
            >
              <SelectTrigger id="tpl-body-font" aria-label="Body font">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {fonts.filter((f) => f.kind !== "mono").map((f) => (
                  <SelectItem key={f.key} value={f.key}>{f.label}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="tpl-mono-font">Numeric font</Label>
            <Select
              value={base.monoFamily}
              onValueChange={(v) => setBase({ monoFamily: v as FontFamilyKey })}
              disabled={readOnly}
            >
              <SelectTrigger id="tpl-mono-font" aria-label="Numeric font">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {fonts.filter((f) => f.kind === "mono").map((f) => (
                  <SelectItem key={f.key} value={f.key}>{f.label}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="tpl-scale">Text size</Label>
            <Slider
              id="tpl-scale"
              aria-label="Text size"
              min={0.75}
              max={1.5}
              step={0.05}
              value={[base.scale]}
              disabled={readOnly}
              onValueChange={([v]) => setBase({ scale: v })}
            />
            <p className="text-xs text-muted-foreground">
              Scales every element together, so the type hierarchy is preserved. {Math.round(base.scale * 100)}%
            </p>
          </div>

          <div className="space-y-2">
            <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Colours</p>
            {COLOR_KEYS.map((key) => (
              <div key={key} className="flex items-center justify-between gap-2">
                <Label htmlFor={`tpl-color-${key}`} className="text-sm font-normal">{COLOR_LABELS[key]}</Label>
                <Input
                  id={`tpl-color-${key}`}
                  type="color"
                  className="h-8 w-14 p-1"
                  value={colors[key]}
                  disabled={readOnly}
                  onChange={(e) =>
                    setBase({ colors: { ...themeDraft.base?.colors, [key]: e.target.value.toUpperCase() } })
                  }
                />
              </div>
            ))}
          </div>

          <div className="space-y-2">
            <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Page margins</p>
            {MARGIN_KEYS.map((key) => (
              <div key={key} className="space-y-1">
                <Label htmlFor={`tpl-${key}`} className="text-sm font-normal">{MARGIN_LABELS[key]}</Label>
                <Input
                  id={`tpl-${key}`}
                  type="number"
                  min={20}
                  max={key === "marginX" ? 80 : 90}
                  value={page[key]}
                  disabled={readOnly}
                  onChange={(e) =>
                    setBase({ page: { ...themeDraft.base?.page, [key]: Number(e.target.value) } })
                  }
                />
              </div>
            ))}
          </div>
        </div>
      </ScrollArea>
    </aside>
  );
}
