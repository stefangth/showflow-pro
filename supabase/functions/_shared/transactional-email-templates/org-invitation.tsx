/// <reference types="npm:@types/react@18.3.1" />
import * as React from "npm:react@18.3.1";
import { Text } from "npm:@react-email/components@0.0.22";
import type { TemplateData, TemplateEntry } from "./registry.ts";
import { APP_URL } from "../app-url.ts";
import { EmailShell, emailRoleStyle } from "./_shell/EmailShell.tsx";
import { applyEmailTokens, EMAIL_COPY_DEFAULTS, type EmailCopy } from "./_shell/emailCopy.ts";
import { EMAIL_THEME_DEFAULTS, type EmailFamily, type EmailRoleKey, type EmailTheme } from "./_shell/emailTheme.ts";

interface Props {
  orgName?: string;
  role?: string;
  inviterEmail?: string;
  token?: string;
  actionLink?: string;
  _emailCopy?: EmailCopy;
  _emailTheme?: EmailTheme;
  _emailFamily?: EmailFamily;
  _highlightRole?: EmailRoleKey;
}

const OrgInvitationEmail = ({
  orgName,
  role,
  inviterEmail,
  token,
  actionLink,
  _emailCopy = EMAIL_COPY_DEFAULTS as EmailCopy,
  _emailTheme = EMAIL_THEME_DEFAULTS,
  _emailFamily = "violet",
  _highlightRole,
}: Props) => {
  const copy = _emailCopy;
  const theme = _emailTheme;
  const org = orgName || copy["org-invitation.orgFallback"];
  const acceptUrl = actionLink || (token ? `${APP_URL}/accept-invite?token=${token}` : APP_URL);
  const roleSuffix = role ? applyEmailTokens(copy["org-invitation.roleSuffix"], { role }) : "";
  const values = { orgName: org, roleSuffix, inviterEmail: inviterEmail ?? "" };

  return (
    <EmailShell family={_emailFamily} theme={theme} previewText={applyEmailTokens(copy["org-invitation.previewText"], values)} heading={applyEmailTokens(copy["org-invitation.heading"], values)} footer={copy["org-invitation.footer"]} cta={{ href: acceptUrl, label: copy["org-invitation.ctaLabel"] }} highlightRole={_highlightRole}>
      <Text style={{ ...emailRoleStyle(theme, "body", _highlightRole), lineHeight: "1.6", margin: "0 0 16px" }}>{copy["org-invitation.greeting"]}</Text>
      <Text style={{ ...emailRoleStyle(theme, "body", _highlightRole), lineHeight: "1.6", margin: "0 0 16px" }}>{applyEmailTokens(copy["org-invitation.intro"], values)}</Text>
      {inviterEmail && <Text style={{ ...emailRoleStyle(theme, "footer", _highlightRole), margin: "0 0 16px" }}>{applyEmailTokens(copy["org-invitation.invitedBy"], values)}</Text>}
      <Text style={{ ...emailRoleStyle(theme, "footer", _highlightRole), margin: "0 0 8px" }}>{copy["org-invitation.pasteLink"]}</Text>
      <Text style={{ ...emailRoleStyle(theme, "dataValue", _highlightRole), margin: "0" }}>{acceptUrl}</Text>
    </EmailShell>
  );
};

export const template = {
  component: OrgInvitationEmail as React.ComponentType<TemplateData>,
  subject: (data: TemplateData) => applyEmailTokens(EMAIL_COPY_DEFAULTS["org-invitation.subject"], { orgName: String(data.orgName || "an organization") }),
  displayName: "Organization invitation",
  previewData: { orgName: "Cirque Lumière", role: "Production Team", inviterEmail: "admin@cirque.example", token: "previewtoken1234567890abcdef" },
} satisfies TemplateEntry;
