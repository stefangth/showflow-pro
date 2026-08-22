/// <reference types="npm:@types/react@18.3.1" />
import * as React from "npm:react@18.3.1";
import { Section, Text } from "npm:@react-email/components@0.0.22";
import type { TemplateData, TemplateEntry } from "./registry.ts";
import { APP_URL } from "../app-url.ts";
import { EmailShell, emailRoleStyle } from "./_shell/EmailShell.tsx";
import { applyEmailTokens, EMAIL_COPY_DEFAULTS, type EmailCopy, type EmailLocale } from "./_shell/emailCopy.ts";
import { EMAIL_THEME_DEFAULTS, type EmailFamily, type EmailRoleKey, type EmailTheme } from "./_shell/emailTheme.ts";

const BOOKINGS_URL = `${APP_URL}/dates`;

interface Props {
  program?: string;
  date?: string;
  tier?: number;
  accepted?: number;
  required?: number;
  _emailCopy?: EmailCopy;
  _emailTheme?: EmailTheme;
  _emailFamily?: EmailFamily;
  _highlightRole?: EmailRoleKey;
  _emailLocale?: EmailLocale;
}

const CastEscalationRequested = ({
  program,
  date,
  tier,
  accepted,
  required,
  _emailCopy = EMAIL_COPY_DEFAULTS as EmailCopy,
  _emailTheme = EMAIL_THEME_DEFAULTS,
  _emailFamily = "ember",
  _highlightRole,
  _emailLocale = "en",
}: Props) => {
  const copy = _emailCopy;
  const theme = _emailTheme;
  const values = {
    program: program ?? copy["cast-escalation-requested.showFallback"],
    date: date ?? copy["cast-escalation-requested.dateFallback"],
    tier: tier ?? "?",
    accepted: accepted ?? 0,
    required: required ?? "?",
  };

  return (
    <EmailShell
      family={_emailFamily}
      theme={theme}
      previewText={applyEmailTokens(copy["cast-escalation-requested.previewText"], values)}
      heading={copy["cast-escalation-requested.heading"]}
      footer={copy["cast-escalation-requested.footer"]}
      cta={{ href: BOOKINGS_URL, label: copy["cast-escalation-requested.ctaLabel"] }}
      highlightRole={_highlightRole}
      lang={_emailLocale}
    >
      <Text style={{ ...emailRoleStyle(theme, "body", _highlightRole), lineHeight: "1.6", margin: "0 0 16px" }}>
        {applyEmailTokens(copy["cast-escalation-requested.intro"], values)}
      </Text>
      <Section style={{ margin: "24px 0", padding: "16px 20px", backgroundColor: theme.base.colors.tileBg, borderRadius: `${theme.base.buttonRadius}px` }}>
        <Text style={{ ...emailRoleStyle(theme, "dataLabel", _highlightRole), margin: "0 0 2px" }}>{copy["cast-escalation-requested.showLabel"]}</Text>
        <Text style={{ ...emailRoleStyle(theme, "dataValue", _highlightRole), margin: "0 0 12px" }}>{values.program}</Text>
        <Text style={{ ...emailRoleStyle(theme, "dataLabel", _highlightRole), margin: "0 0 2px" }}>{copy["cast-escalation-requested.dateLabel"]}</Text>
        <Text style={{ ...emailRoleStyle(theme, "dataValue", _highlightRole), margin: "0 0 12px" }}>{values.date}</Text>
        <Text style={{ ...emailRoleStyle(theme, "dataLabel", _highlightRole), margin: "0 0 2px" }}>{copy["cast-escalation-requested.tierLabel"]}</Text>
        <Text style={{ ...emailRoleStyle(theme, "dataValue", _highlightRole), margin: "0 0 12px" }}>{values.tier}</Text>
        <Text style={{ ...emailRoleStyle(theme, "dataLabel", _highlightRole), margin: "0 0 2px" }}>{copy["cast-escalation-requested.filledLabel"]}</Text>
        <Text style={{ ...emailRoleStyle(theme, "dataValue", _highlightRole), margin: "0" }}>{values.accepted} / {values.required} {copy["cast-escalation-requested.slotsLabel"]}</Text>
      </Section>
      <Text style={{ ...emailRoleStyle(theme, "body", _highlightRole), lineHeight: "1.6", margin: "0" }}>
        {copy["cast-escalation-requested.followup"]}
      </Text>
    </EmailShell>
  );
};

export const template = {
  component: CastEscalationRequested as React.ComponentType<TemplateData>,
  subject: (data: TemplateData) => applyEmailTokens(EMAIL_COPY_DEFAULTS["cast-escalation-requested.subject"], {
    tier: String(data.tier ?? "?"),
    program: String(data.program ?? "show"),
    date: String(data.date ?? "?"),
  }),
  displayName: "Cast escalation requested",
  previewData: { program: "Riverdance", date: "2026-06-15", tier: 1, accepted: 2, required: 5 },
} satisfies TemplateEntry;
