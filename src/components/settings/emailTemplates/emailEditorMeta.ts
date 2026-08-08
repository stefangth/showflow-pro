import type { EmailCopyKey } from "@/lib/emailTemplates/emailCopy";
import type {
  EmailCopyFieldMeta,
  EmailTemplateCopyFields,
} from "@/lib/emailTemplates/emailTemplateMeta";
import type { EmailRoleKey } from "@/lib/emailTemplates/emailTheme";
import type { TemplateSection } from "@/components/settings/templateEditor/types";

export type EmailEditorSelection = "document" | EmailRoleKey;

export const EMAIL_EDITOR_SECTIONS: readonly TemplateSection<EmailEditorSelection, EmailCopyKey>[] = [
  { title: "Header", roles: [
    { key: "header", label: "Header" },
    { key: "heading", label: "Heading" },
    { key: "subheading", label: "Subheading" },
  ] },
  { title: "Content", roles: [
    { key: "body", label: "Body" },
    { key: "dataLabel", label: "Data label" },
    { key: "dataValue", label: "Data value" },
  ] },
  { title: "Action", roles: [{ key: "button", label: "Button" }] },
  { title: "Footer", roles: [{ key: "footer", label: "Footer" }] },
];

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
