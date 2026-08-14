import type { EmailCopyKey } from "@/lib/emailTemplates/emailCopy";
import type {
  EmailCopyFieldMeta,
  EmailTemplateCopyFields,
} from "@/lib/emailTemplates/emailTemplateMeta";
import type { EmailRoleKey } from "@/lib/emailTemplates/emailTheme";
import type { TemplateSection } from "@/components/settings/templateEditor/types";

export type EmailEditorSelection = "document" | EmailRoleKey;

/** Literal key type so `t(EMAIL_EDITOR_ROLE_LABEL_KEYS[role])` type-checks against the
 *  typed `settingsEmailTemplates` catalog (mirrors the NavLabelKey pattern in navItems.ts). */
export type EmailRoleLabelKey =
  | "emailTemplateInspector.roleLabels.header"
  | "emailTemplateInspector.roleLabels.heading"
  | "emailTemplateInspector.roleLabels.subheading"
  | "emailTemplateInspector.roleLabels.body"
  | "emailTemplateInspector.roleLabels.dataLabel"
  | "emailTemplateInspector.roleLabels.dataValue"
  | "emailTemplateInspector.roleLabels.button"
  | "emailTemplateInspector.roleLabels.footer";

/**
 * Translation keys (namespace `settingsEmailTemplates`) for each role's display label.
 * Shared by the outline sections below and by EmailTemplateInspector's per-role heading,
 * so both surfaces resolve the same label through one lookup.
 */
export const EMAIL_EDITOR_ROLE_LABEL_KEYS: Record<EmailRoleKey, EmailRoleLabelKey> = {
  header: "emailTemplateInspector.roleLabels.header",
  heading: "emailTemplateInspector.roleLabels.heading",
  subheading: "emailTemplateInspector.roleLabels.subheading",
  body: "emailTemplateInspector.roleLabels.body",
  dataLabel: "emailTemplateInspector.roleLabels.dataLabel",
  dataValue: "emailTemplateInspector.roleLabels.dataValue",
  button: "emailTemplateInspector.roleLabels.button",
  footer: "emailTemplateInspector.roleLabels.footer",
};

/**
 * Builds the outline sections with translated section titles and role labels.
 * Takes a `t` from `useTranslation("settingsEmailTemplates")` so section/role display
 * strings resolve at render time instead of being baked in as static English.
 */
export function buildEmailEditorSections(
  t: (key: string) => string,
): readonly TemplateSection<EmailEditorSelection, EmailCopyKey>[] {
  return [
    { title: t("emailEditorMeta.sections.header"), roles: [
      { key: "header", label: t(EMAIL_EDITOR_ROLE_LABEL_KEYS.header) },
      { key: "heading", label: t(EMAIL_EDITOR_ROLE_LABEL_KEYS.heading) },
      { key: "subheading", label: t(EMAIL_EDITOR_ROLE_LABEL_KEYS.subheading) },
    ] },
    { title: t("emailEditorMeta.sections.content"), roles: [
      { key: "body", label: t(EMAIL_EDITOR_ROLE_LABEL_KEYS.body) },
      { key: "dataLabel", label: t(EMAIL_EDITOR_ROLE_LABEL_KEYS.dataLabel) },
      { key: "dataValue", label: t(EMAIL_EDITOR_ROLE_LABEL_KEYS.dataValue) },
    ] },
    { title: t("emailEditorMeta.sections.action"), roles: [
      { key: "button", label: t(EMAIL_EDITOR_ROLE_LABEL_KEYS.button) },
    ] },
    { title: t("emailEditorMeta.sections.footer"), roles: [
      { key: "footer", label: t(EMAIL_EDITOR_ROLE_LABEL_KEYS.footer) },
    ] },
  ];
}

function fieldName(field: EmailCopyFieldMeta): string {
  return field.key.slice(field.key.indexOf(".") + 1);
}

function roleForCopyField(field: EmailCopyFieldMeta): EmailRoleKey {
  const name = fieldName(field);
  if (name.startsWith("subject") || name.startsWith("preview")) return "header";
  if (name.startsWith("heading")) return "heading";
  if (name === "footer") return "footer";
  if (/ctaLabel|signButton|signCtaLabel/.test(name)) return "button";
  if (name.startsWith("intro")) return "body";
  if (/Label$|Singular$|Plural$/.test(name)) return "dataLabel";
  return "body";
}

export function emailCopyFieldsForRole(
  template: EmailTemplateCopyFields,
  role: EmailRoleKey,
): EmailCopyFieldMeta[] {
  return template.fields.filter((field) => roleForCopyField(field) === role);
}
