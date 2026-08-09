/// <reference types="npm:@types/react@18.3.1" />
import * as React from "npm:react@18.3.1";
import { Text } from "npm:@react-email/components@0.0.22";
import type { TemplateData, TemplateEntry } from "./registry.ts";
import { EmailShell, emailRoleStyle } from "./_shell/EmailShell.tsx";
import { EMAIL_COPY_DEFAULTS, type EmailCopy } from "./_shell/emailCopy.ts";
import { EMAIL_THEME_DEFAULTS, type EmailFamily, type EmailRoleKey, type EmailTheme } from "./_shell/emailTheme.ts";

interface Props {
  actionLink?: string;
  _emailCopy?: EmailCopy; _emailTheme?: EmailTheme; _emailFamily?: EmailFamily; _highlightRole?: EmailRoleKey;
}

const MagicLinkEmail = ({
  actionLink,
  _emailCopy = EMAIL_COPY_DEFAULTS as EmailCopy, _emailTheme = EMAIL_THEME_DEFAULTS,
  _emailFamily = "violet", _highlightRole,
}: Props) => {
  const copy = _emailCopy; const theme = _emailTheme;
  const href = actionLink || "";
  return (
    <EmailShell family={_emailFamily} theme={theme}
      previewText={copy["magic-link.previewText"]}
      heading={copy["magic-link.heading"]}
      footer={copy["magic-link.footer"]}
      cta={{ href, label: copy["magic-link.ctaLabel"] }} highlightRole={_highlightRole}>
      <Text style={{ ...emailRoleStyle(theme, "body", _highlightRole), lineHeight: "1.6", margin: "0 0 16px" }}>{copy["magic-link.greeting"]}</Text>
      <Text style={{ ...emailRoleStyle(theme, "body", _highlightRole), lineHeight: "1.6", margin: "0 0 16px" }}>{copy["magic-link.intro"]}</Text>
      <Text style={{ ...emailRoleStyle(theme, "footer", _highlightRole), margin: "0 0 8px" }}>{copy["magic-link.pasteLink"]}</Text>
      <Text style={{ ...emailRoleStyle(theme, "dataValue", _highlightRole), margin: "0" }}>{href}</Text>
    </EmailShell>
  );
};

export const template = {
  component: MagicLinkEmail as React.ComponentType<TemplateData>,
  subject: EMAIL_COPY_DEFAULTS["magic-link.subject"],
  displayName: "Sign-in link",
  previewData: { actionLink: "https://app.showflow.pro/auth/callback?redirect=/dashboard" },
} satisfies TemplateEntry;
