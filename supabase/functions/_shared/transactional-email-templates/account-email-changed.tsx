/// <reference types="npm:@types/react@18.3.1" />
import * as React from "npm:react@18.3.1";
import { Section, Text } from "npm:@react-email/components@0.0.22";
import type { TemplateData, TemplateEntry } from "./registry.ts";
import { APP_URL } from "../app-url.ts";
import { EmailShell, emailRoleStyle } from "./_shell/EmailShell.tsx";
import { applyEmailTokens, EMAIL_COPY_DEFAULTS, type EmailCopy } from "./_shell/emailCopy.ts";
import { EMAIL_THEME_DEFAULTS, type EmailFamily, type EmailRoleKey, type EmailTheme } from "./_shell/emailTheme.ts";

interface Props {
  oldEmail?: string;
  newEmail?: string;
  appOrigin?: string;
  _emailCopy?: EmailCopy;
  _emailTheme?: EmailTheme;
  _emailFamily?: EmailFamily;
  _highlightRole?: EmailRoleKey;
}

const AccountEmailChanged = ({
  oldEmail,
  newEmail,
  appOrigin,
  _emailCopy = EMAIL_COPY_DEFAULTS as EmailCopy,
  _emailTheme = EMAIL_THEME_DEFAULTS,
  _emailFamily = "steel",
  _highlightRole,
}: Props) => {
  const copy = _emailCopy;
  const theme = _emailTheme;
  const previousEmail = oldEmail || copy["account-email-changed.emailFallback"];
  const nextEmail = newEmail || copy["account-email-changed.emailFallback"];
  const signInUrl = (appOrigin || APP_URL).replace(/\/+$/, "");

  return (
    <EmailShell family={_emailFamily} theme={theme} previewText={copy["account-email-changed.previewText"]} heading={copy["account-email-changed.heading"]} footer={copy["account-email-changed.footer"]} highlightRole={_highlightRole}>
      <Text style={{ ...emailRoleStyle(theme, "body", _highlightRole), lineHeight: "1.6", margin: "0 0 16px" }}>{copy["account-email-changed.greeting"]}</Text>
      <Text style={{ ...emailRoleStyle(theme, "body", _highlightRole), lineHeight: "1.6", margin: "0 0 16px" }}>{copy["account-email-changed.intro"]}</Text>
      <Section style={{ margin: "24px 0", padding: "16px 20px", backgroundColor: theme.base.colors.tileBg, borderRadius: `${theme.base.buttonRadius}px` }}>
        <Text style={{ ...emailRoleStyle(theme, "dataLabel", _highlightRole), margin: "0 0 2px" }}>{copy["account-email-changed.previousEmailLabel"]}</Text>
        <Text style={{ ...emailRoleStyle(theme, "dataValue", _highlightRole), margin: "0 0 12px" }}>{previousEmail}</Text>
        <Text style={{ ...emailRoleStyle(theme, "dataLabel", _highlightRole), margin: "0 0 2px" }}>{copy["account-email-changed.newEmailLabel"]}</Text>
        <Text style={{ ...emailRoleStyle(theme, "dataValue", _highlightRole), margin: "0" }}>{nextEmail}</Text>
      </Section>
      <Text style={{ ...emailRoleStyle(theme, "body", _highlightRole), lineHeight: "1.6", margin: "0" }}>{applyEmailTokens(copy["account-email-changed.signInPrompt"], { signInUrl })}</Text>
    </EmailShell>
  );
};

export const template = {
  component: AccountEmailChanged as React.ComponentType<TemplateData>,
  subject: EMAIL_COPY_DEFAULTS["account-email-changed.subject"],
  displayName: "Account email changed",
  previewData: { oldEmail: "old@example.com", newEmail: "new@example.com", appOrigin: "https://app.showflow.pro" },
} satisfies TemplateEntry;
