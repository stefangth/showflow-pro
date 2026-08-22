import { useTranslation } from "react-i18next";
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
const MARGIN_KEYS = ["marginX", "marginTop", "marginBottom"] as const;

/** PDF-only wiring for the shared copy, role, and document-base controls. */
export function TemplateInspector({ selected, readOnly, copyDraft, themeDraft, onCopyChange, onThemeChange }: TemplateInspectorProps) {
  const { t } = useTranslation("settingsHireOrders");
  const fonts = selectableFontFamilies();
  const setBase = (patch: Partial<NonNullable<HireOrderThemeOverride["base"]>>) => onThemeChange({ ...themeDraft, base: { ...themeDraft.base, ...patch } });
  const COLOR_LABELS: Record<ThemeColorKey, string> = {
    text: t("templateInspector.colors.text"),
    muted: t("templateInspector.colors.muted"),
    faint: t("templateInspector.colors.faint"),
    accent: t("templateInspector.colors.accent"),
    line: t("templateInspector.colors.line"),
    feeCell: t("templateInspector.colors.feeCell"),
    surface2: t("templateInspector.colors.surface2"),
  };
  const COLOR_FIELDS = COLOR_KEYS.map((key) => ({ key, label: COLOR_LABELS[key] }));
  const MARGIN_LABELS: Record<(typeof MARGIN_KEYS)[number], string> = {
    marginX: t("templateInspector.margins.marginX"),
    marginTop: t("templateInspector.margins.marginTop"),
    marginBottom: t("templateInspector.margins.marginBottom"),
  };

  if (selected === "document") {
    const base = { ...HIRE_ORDER_THEME_DEFAULTS.base, ...themeDraft.base };
    const colors = { ...HIRE_ORDER_THEME_DEFAULTS.base.colors, ...themeDraft.base?.colors };
    const page = { ...HIRE_ORDER_THEME_DEFAULTS.base.page, ...themeDraft.base?.page };
    return (
      <DocumentBaseControls
        title={t("templateInspector.documentTitle")}
        base={base}
        baseModified={hasOwnKeys(themeDraft.base)}
        fonts={fonts}
        fontFields={[
          { key: "fontFamily", label: t("templateInspector.bodyFont"), allowedKinds: ["sans", "serif"] },
          { key: "monoFamily", label: t("templateInspector.numericFont"), allowedKinds: ["mono"] },
        ]}
        colors={COLOR_FIELDS}
        colorValues={colors}
        onBaseChange={(patch) => setBase(patch)}
        onThemeChange={onThemeChange}
        themeDraft={themeDraft}
        readOnly={readOnly}
        scaleField={{
          label: t("templateInspector.textSize"),
          value: base.scale,
          min: 0.75,
          max: 1.5,
          step: 0.05,
          description: t("templateInspector.textSizeDescription", { percent: Math.round(base.scale * 100) }),
          onChange: (scale) => setBase({ scale }),
        }}
        onColorChange={(key, value) => setBase({ colors: { ...themeDraft.base?.colors, [key]: value } })}
        fieldGroups={[{
          label: t("templateInspector.pageMargins"),
          fields: MARGIN_KEYS.map((key) => ({
            kind: "number" as const,
            key,
            label: MARGIN_LABELS[key],
            value: page[key],
            min: 20,
            max: key === "marginX" ? 80 : 90,
            onChange: (margin) => setBase({ page: { ...themeDraft.base?.page, [key]: margin } }),
          })),
        }]}
      />
    );
  }

  const role = ALL_ROLES.find((candidate) => candidate.key === selected);
  if (!role) return <aside aria-label={t("templateInspector.elementSettingsAria")} className="h-full" />;

  return (
    <aside aria-label={t("templateInspector.elementSettingsAria")} className="h-full">
      <ScrollArea className="h-full">
        <div className="space-y-5 p-4">
          <h3 className="font-display text-sm">{role.label}</h3>
          {role.copyKeys.length > 0 && (
            <div className="space-y-3">
              {/* eslint-disable-next-line no-restricted-syntax -- non-standard tracking */}
              <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">{t("templateInspector.textSectionHeading")}</p>
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
            roleOverride={themeDraft.roles?.[role.key]}
            fonts={fonts}
            colorFields={COLOR_FIELDS}
            onRoleChange={(nextRole) => onThemeChange({
              ...themeDraft,
              roles: { ...themeDraft.roles, [role.key]: nextRole },
            })}
            onResetRole={() => {
              const roles = { ...themeDraft.roles };
              delete roles[role.key];
              onThemeChange({ ...themeDraft, roles });
            }}
            readOnly={readOnly}
          />
        </div>
      </ScrollArea>
    </aside>
  );
}
