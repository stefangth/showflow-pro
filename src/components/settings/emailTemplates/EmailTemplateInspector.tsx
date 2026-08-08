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
import { emailCopyFieldsForRole, type EmailEditorSelection } from "./emailEditorMeta";

const ROLE_FONTS = [
  { key: "body", label: "Body font", kind: "body" },
  { key: "heading", label: "Heading font", kind: "heading" },
] as const;
const SYSTEM_SANS = '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif';
const BASE_FONTS = [
  { key: EMAIL_THEME_DEFAULTS.base.bodyFamily, label: "Geist with system fallback", kind: "sans" },
  { key: SYSTEM_SANS, label: "System sans serif", kind: "sans" },
] as const;
const COLOR_LABELS: Record<(typeof EMAIL_THEME_COLOR_KEYS)[number], string> = {
  heroText: "Hero text",
  heroSub: "Hero supporting text",
  bodyText: "Body text",
  muted: "Muted text",
  faint: "Faint text",
  accent: "Accent",
  line: "Rules and borders",
  tileBg: "Data tile background",
  buttonBg: "Button background",
  buttonText: "Button text",
  cardBg: "Card background",
  pageBg: "Page background",
};
const COLOR_FIELDS = EMAIL_THEME_COLOR_KEYS.map((key) => ({ key, label: COLOR_LABELS[key] }));
const WEIGHT_OPTIONS = [
  { value: 400, label: "Regular" },
  { value: 500, label: "Medium" },
  { value: 600, label: "Semibold" },
  { value: 700, label: "Bold" },
] as const;

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
  const resolvedTheme = resolveEmailTheme(themeDraft);
  const setBase = (patch: Record<string, unknown>) => onThemeChange({
    ...themeDraft,
    base: { ...themeDraft.base, ...patch } as EmailThemeOverride["base"],
  });

  if (selected === "document") {
    return (
      <DocumentBaseControls
        title="Document"
        base={resolvedTheme.base}
        baseModified={hasOwnKeys(themeDraft.base)}
        fonts={BASE_FONTS}
        fontFields={[
          { key: "bodyFamily", label: "Body font", allowedKinds: ["sans"] },
          { key: "headingFamily", label: "Heading font", allowedKinds: ["sans"] },
        ]}
        colors={COLOR_FIELDS}
        colorValues={resolvedTheme.base.colors}
        fieldGroups={[{
          label: "Email defaults",
          fields: [
            {
              kind: "number",
              key: "buttonRadius",
              label: "Button radius",
              value: resolvedTheme.base.buttonRadius,
              min: 0,
              max: 24,
              onChange: (buttonRadius) => setBase({ buttonRadius }),
            },
            {
              kind: "text",
              key: "footerText",
              label: "Footer text",
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

  const role = { key: selected, label: selected === "dataLabel" ? "Data label" : selected === "dataValue" ? "Data value" : `${selected[0].toUpperCase()}${selected.slice(1)}` };
  const copyFields = emailCopyFieldsForRole(template, selected);

  return (
    <aside aria-label="Element settings" className="h-full">
      <ScrollArea className="h-full">
        <div className="space-y-5 p-4">
          <h3 className="font-display text-sm">{role.label}</h3>
          {copyFields.length > 0 ? (
            <div className="space-y-3">
              <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Text</p>
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
            <p className="text-xs text-muted-foreground">Applies to all emails.</p>
            <RoleStyleControls
              role={role}
              roleDefaults={EMAIL_THEME_DEFAULTS.roles[selected]}
              roleOverride={themeDraft.roles?.[selected]}
              fonts={ROLE_FONTS}
              colorFields={COLOR_FIELDS}
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
              fontResetLabel="Email base font"
              weightOptions={WEIGHT_OPTIONS}
            />
          </div>
        </div>
      </ScrollArea>
    </aside>
  );
}
