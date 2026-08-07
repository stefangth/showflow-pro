import { ScrollArea } from "@/components/ui/scroll-area";
import { HIRE_ORDER_COPY_DEFAULTS, type CopyKey, type HireOrderCopy } from "@/lib/hireOrders/pdf/pdfCopy";
import {
  HIRE_ORDER_THEME_DEFAULTS,
  selectableFontFamilies,
  type HireOrderThemeOverride,
  type RoleKey,
  type ThemeColorKey,
} from "@/lib/hireOrders/pdf/pdfTheme";
import { CopyFieldControl } from "../../templateEditor/CopyFieldControl";
import { DocumentBaseControls } from "../../templateEditor/DocumentBaseControls";
import { hasOwnKeys } from "../../templateEditor/overrideMap";
import { RoleStyleControls } from "../../templateEditor/RoleStyleControls";
import { COPY_SECTIONS, type CopyField } from "../pdfCopyMeta";
import { COPY_LABELS, TEMPLATE_SECTIONS, type TemplateRole } from "./templateMeta";

export interface TemplateInspectorProps {
  selected: RoleKey | "document";
  readOnly: boolean;
  copyDraft: Partial<HireOrderCopy>;
  themeDraft: HireOrderThemeOverride;
  onCopyChange: (next: Partial<HireOrderCopy>) => void;
  onThemeChange: (next: HireOrderThemeOverride) => void;
}

const ALL_ROLES: TemplateRole[] = TEMPLATE_SECTIONS.flatMap((section) => section.roles);
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
const COLOR_FIELDS = COLOR_KEYS.map((key) => ({ key, label: COLOR_LABELS[key] }));
const MARGIN_KEYS = ["marginX", "marginTop", "marginBottom"] as const;
const MARGIN_LABELS: Record<(typeof MARGIN_KEYS)[number], string> = {
  marginX: "Left and right",
  marginTop: "Top",
  marginBottom: "Bottom",
};

/** PDF-only wiring for the shared copy, role, and document-base controls. */
export function TemplateInspector({ selected, readOnly, copyDraft, themeDraft, onCopyChange, onThemeChange }: TemplateInspectorProps) {
  const fonts = selectableFontFamilies();
  const setBase = (patch: Partial<NonNullable<HireOrderThemeOverride["base"]>>) => onThemeChange({ ...themeDraft, base: { ...themeDraft.base, ...patch } });

  if (selected === "document") {
    const base = { ...HIRE_ORDER_THEME_DEFAULTS.base, ...themeDraft.base };
    const colors = { ...HIRE_ORDER_THEME_DEFAULTS.base.colors, ...themeDraft.base?.colors };
    const page = { ...HIRE_ORDER_THEME_DEFAULTS.base.page, ...themeDraft.base?.page };
    return (
      <DocumentBaseControls
        title="Document"
        base={base}
        baseModified={hasOwnKeys(themeDraft.base)}
        fonts={fonts}
        fontFields={[{ key: "fontFamily", label: "Body font", kind: "sans" }, { key: "monoFamily", label: "Numeric font", kind: "mono" }]}
        colors={COLOR_FIELDS}
        colorValues={colors}
        onBaseChange={(patch) => setBase(patch)}
        onThemeChange={onThemeChange}
        themeDraft={themeDraft}
        readOnly={readOnly}
        scaleField={{
          label: "Text size",
          value: base.scale,
          min: 0.75,
          max: 1.5,
          step: 0.05,
          description: `Scales every element together, so the type hierarchy is preserved. ${Math.round(base.scale * 100)}%`,
          onChange: (scale) => setBase({ scale }),
        }}
        onColorChange={(key, value) => setBase({ colors: { ...themeDraft.base?.colors, [key]: value } })}
        numberFields={MARGIN_KEYS.map((key) => ({
          key,
          label: MARGIN_LABELS[key],
          value: page[key],
          min: 20,
          max: key === "marginX" ? 80 : 90,
          onChange: (margin) => setBase({ page: { ...themeDraft.base?.page, [key]: margin } }),
        }))}
      />
    );
  }

  const role = ALL_ROLES.find((candidate) => candidate.key === selected);
  if (!role) return <aside aria-label="Element settings" className="h-full" />;

  return (
    <aside aria-label="Element settings" className="h-full">
      <ScrollArea className="h-full">
        <div className="space-y-5 p-4">
          <h3 className="font-display text-sm">{role.label}</h3>
          {role.copyKeys.length > 0 && (
            <div className="space-y-3">
              <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Text</p>
              {role.copyKeys.map((key) => {
                const field = COPY_FIELDS[key];
                return (
                  <CopyFieldControl
                    key={key}
                    field={{ ...field, label: COPY_LABELS[key] ?? field.label }}
                    defaultValue={HIRE_ORDER_COPY_DEFAULTS[key]}
                    copyDraft={copyDraft}
                    onCopyChange={onCopyChange}
                    readOnly={readOnly}
                  />
                );
              })}
            </div>
          )}
          <RoleStyleControls
            role={role}
            roleDefaults={HIRE_ORDER_THEME_DEFAULTS.roles[role.key]}
            themeDraft={themeDraft}
            fonts={fonts}
            colorFields={COLOR_FIELDS}
            onThemeChange={onThemeChange}
            readOnly={readOnly}
          />
        </div>
      </ScrollArea>
    </aside>
  );
}
