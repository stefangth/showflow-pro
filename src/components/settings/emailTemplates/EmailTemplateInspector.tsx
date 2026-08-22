import { useTranslation } from "react-i18next";
import { ScrollArea } from "@/components/ui/scroll-area";
import { CopyFieldControl } from "@/components/settings/templateEditor/CopyFieldControl";
import { DocumentBaseControls } from "@/components/settings/templateEditor/DocumentBaseControls";
import { RoleStyleControls } from "@/components/settings/templateEditor/RoleStyleControls";
import { hasOwnKeys } from "@/components/settings/templateEditor/overrideMap";
import {
  EMAIL_COPY_DEFAULTS,
  type EmailCopyKey,
} from "@/lib/emailTemplates/emailCopy";
import type {
  EmailTemplateCopyFields,
} from "@/lib/emailTemplates/emailTemplateMeta";
import {
  EMAIL_THEME_COLOR_KEYS,
  EMAIL_THEME_DEFAULTS,
  resolveEmailTheme,
  type EmailThemeOverride,
} from "@/lib/emailTemplates/emailTheme";
import {
  EMAIL_EDITOR_ROLE_LABEL_KEYS,
  emailCopyFieldsForRole,
  type EmailEditorSelection,
} from "./emailEditorMeta";

const SYSTEM_SANS = '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif';

export interface EmailTemplateInspectorProps {
  selected: EmailEditorSelection;
  template: EmailTemplateCopyFields;
  readOnly: boolean;
  copyDraft: Partial<Record<EmailCopyKey, string>>;
  themeDraft: EmailThemeOverride;
  onCopyChange: (next: Partial<Record<EmailCopyKey, string>>) => void;
  onThemeChange: (next: EmailThemeOverride) => void;
}

export function EmailTemplateInspector({
  selected,
  template,
  readOnly,
  copyDraft,
  themeDraft,
  onCopyChange,
  onThemeChange,
}: EmailTemplateInspectorProps) {
  const { t } = useTranslation("settingsEmailTemplates");
  const resolvedTheme = resolveEmailTheme(themeDraft);
  const setBase = (patch: Record<string, unknown>) => onThemeChange({
    ...themeDraft,
    base: { ...themeDraft.base, ...patch } as EmailThemeOverride["base"],
  });

  const roleFonts = [
    { key: "body", label: t("emailTemplateInspector.roleFonts.body"), kind: "body" },
    { key: "heading", label: t("emailTemplateInspector.roleFonts.heading"), kind: "heading" },
  ] as const;
  const baseFonts = [
    { key: EMAIL_THEME_DEFAULTS.base.bodyFamily, label: t("emailTemplateInspector.baseFonts.geist"), kind: "sans" },
    { key: SYSTEM_SANS, label: t("emailTemplateInspector.baseFonts.system"), kind: "sans" },
  ] as const;
  const colorLabels: Record<(typeof EMAIL_THEME_COLOR_KEYS)[number], string> = {
    heroText: t("emailTemplateInspector.colorLabels.heroText"),
    heroSub: t("emailTemplateInspector.colorLabels.heroSub"),
    bodyText: t("emailTemplateInspector.colorLabels.bodyText"),
    muted: t("emailTemplateInspector.colorLabels.muted"),
    faint: t("emailTemplateInspector.colorLabels.faint"),
    accent: t("emailTemplateInspector.colorLabels.accent"),
    line: t("emailTemplateInspector.colorLabels.line"),
    tileBg: t("emailTemplateInspector.colorLabels.tileBg"),
    buttonBg: t("emailTemplateInspector.colorLabels.buttonBg"),
    buttonText: t("emailTemplateInspector.colorLabels.buttonText"),
    cardBg: t("emailTemplateInspector.colorLabels.cardBg"),
    pageBg: t("emailTemplateInspector.colorLabels.pageBg"),
  };
  const colorFields = EMAIL_THEME_COLOR_KEYS.map((key) => ({ key, label: colorLabels[key] }));
  const weightOptions = [
    { value: 400, label: t("emailTemplateInspector.weightOptions.regular") },
    { value: 500, label: t("emailTemplateInspector.weightOptions.medium") },
    { value: 600, label: t("emailTemplateInspector.weightOptions.semibold") },
    { value: 700, label: t("emailTemplateInspector.weightOptions.bold") },
  ] as const;

  if (selected === "document") {
    return (
      <DocumentBaseControls
        title={t("emailTemplateInspector.documentTitle")}
        base={resolvedTheme.base}
        baseModified={hasOwnKeys(themeDraft.base)}
        fonts={baseFonts}
        fontFields={[
          { key: "bodyFamily", label: t("emailTemplateInspector.roleFonts.body"), allowedKinds: ["sans"] },
          { key: "headingFamily", label: t("emailTemplateInspector.roleFonts.heading"), allowedKinds: ["sans"] },
        ]}
        colors={colorFields}
        colorValues={resolvedTheme.base.colors}
        fieldGroups={[{
          label: t("emailTemplateInspector.emailDefaults"),
          fields: [
            {
              kind: "number",
              key: "buttonRadius",
              label: t("emailTemplateInspector.buttonRadius"),
              value: resolvedTheme.base.buttonRadius,
              min: 0,
              max: 24,
              onChange: (buttonRadius) => setBase({ buttonRadius }),
            },
            {
              kind: "text",
              key: "footerText",
              label: t("emailTemplateInspector.footerText"),
              value: resolvedTheme.base.footerText,
              multiline: true,
              onChange: (footerText) => setBase({ footerText }),
            },
          ],
        }]}
        onBaseChange={setBase}
        onThemeChange={onThemeChange}
        themeDraft={themeDraft}
        readOnly={readOnly}
        onColorChange={(key, value) => setBase({
          colors: { ...themeDraft.base?.colors, [key]: value },
        })}
      />
    );
  }

  const role = {
    key: selected,
    label: t(EMAIL_EDITOR_ROLE_LABEL_KEYS[selected]),
  };
  const copyFields = emailCopyFieldsForRole(template, selected);

  return (
    <aside aria-label={t("emailTemplateInspector.elementSettings")} className="h-full">
      <ScrollArea className="h-full">
        <div className="space-y-5 p-4">
          <h3 className="font-display text-sm">{role.label}</h3>
          {copyFields.length > 0 ? (
            <div className="space-y-3">
              {/* eslint-disable-next-line no-restricted-syntax -- non-standard tracking */}
              <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">{t("emailTemplateInspector.text")}</p>
              {copyFields.map((field) => (
                <CopyFieldControl
                  key={field.key}
                  field={field}
                  defaultValue={EMAIL_COPY_DEFAULTS[field.key]}
                  copyDraft={copyDraft}
                  onCopyChange={onCopyChange}
                  readOnly={readOnly}
                />
              ))}
            </div>
          ) : null}
          <div className="space-y-2">
            <p className="text-xs text-muted-foreground">{t("emailTemplateInspector.appliesToAllEmails")}</p>
            <RoleStyleControls
              role={role}
              roleDefaults={EMAIL_THEME_DEFAULTS.roles[selected]}
              roleOverride={themeDraft.roles?.[selected]}
              fonts={roleFonts}
              colorFields={colorFields}
              onRoleChange={(nextRole) => onThemeChange({
                ...themeDraft,
                roles: { ...themeDraft.roles, [selected]: nextRole },
              })}
              onResetRole={() => {
                const roles = { ...themeDraft.roles };
                delete roles[selected];
                const next = { ...themeDraft };
                if (hasOwnKeys(roles)) next.roles = roles;
                else delete next.roles;
                onThemeChange(next);
              }}
              readOnly={readOnly}
              fontResetLabel={t("emailTemplateInspector.emailBaseFont")}
              weightOptions={weightOptions}
            />
          </div>
        </div>
      </ScrollArea>
    </aside>
  );
}
