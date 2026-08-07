/// <reference types="npm:@types/react@18.3.1" />
import * as React from "npm:react@18.3.1";
import { Section, Text } from "npm:@react-email/components@0.0.22";
import type { TemplateEntry, TemplateData } from "./registry.ts";
import { APP_URL } from "../app-url.ts";
import { EmailShell, emailRoleStyle } from "./_shell/EmailShell.tsx";
import { applyEmailTokens, EMAIL_COPY_DEFAULTS, type EmailCopy } from "./_shell/emailCopy.ts";
import { EMAIL_THEME_DEFAULTS, type EmailFamily, type EmailRoleKey, type EmailTheme } from "./_shell/emailTheme.ts";

const AVAILABILITY_URL = `${APP_URL}/availability`;

interface Props {
  displayName?: string;
  referenceLabel?: string;
  date?: string;
  city?: string | null;
  windowHours?: number;
  _emailCopy?: EmailCopy;
  _emailTheme?: EmailTheme;
  _emailFamily?: EmailFamily;
  _highlightRole?: EmailRoleKey;
}

const OfferImmediate = ({
  displayName,
  referenceLabel,
  date,
  city,
  windowHours,
  _emailCopy = EMAIL_COPY_DEFAULTS as EmailCopy,
  _emailTheme = EMAIL_THEME_DEFAULTS,
  _emailFamily = "violet",
  _highlightRole,
}: Props) => {
  const copy = _emailCopy;
  const theme = _emailTheme;
  const label = referenceLabel || copy["offer-immediate.showFallback"];
  const where = city ? `${date} in ${city}` : date;
  const hours = typeof windowHours === "number" ? windowHours : 48;
  const tokens = { displayName: displayName ?? "", referenceLabel: label, where: where ?? "", hours };

  return (
    <EmailShell
      family={_emailFamily}
      theme={theme}
      previewText={applyEmailTokens(copy["offer-immediate.previewText"], { referenceLabel: label })}
      heading={copy["offer-immediate.heading"]}
      footer={copy["offer-immediate.footer"]}
      cta={{ href: AVAILABILITY_URL, label: copy["offer-immediate.ctaLabel"] }}
      highlightRole={_highlightRole}
    >
      <Text style={{ ...emailRoleStyle(theme, "body", _highlightRole), lineHeight: "1.6", margin: "0 0 16px" }}>
        {displayName ? applyEmailTokens(copy["offer-immediate.greeting"], tokens) : copy["offer-immediate.greetingAnonymous"]}
      </Text>
      <Text style={{ ...emailRoleStyle(theme, "body", _highlightRole), lineHeight: "1.6", margin: "0 0 16px" }}>
        {applyEmailTokens(copy["offer-immediate.intro"], tokens)}
      </Text>
      <Section style={{ margin: "24px 0", padding: "16px 20px", backgroundColor: theme.base.colors.tileBg, borderRadius: `${theme.base.buttonRadius}px` }}>
        <Text style={{ ...emailRoleStyle(theme, "dataLabel", _highlightRole), margin: "0 0 2px" }}>{copy["offer-immediate.showLabel"]}</Text>
        <Text style={{ ...emailRoleStyle(theme, "dataValue", _highlightRole), margin: "0 0 12px" }}>{label}</Text>
        <Text style={{ ...emailRoleStyle(theme, "dataLabel", _highlightRole), margin: "0 0 2px" }}>{copy["offer-immediate.dateLabel"]}</Text>
        <Text style={{ ...emailRoleStyle(theme, "dataValue", _highlightRole), margin: "0" }}>{where}</Text>
      </Section>
    </EmailShell>
  );
};

export const template = {
  component: OfferImmediate as React.ComponentType<TemplateData>,
  subject: (data: TemplateData) => applyEmailTokens(EMAIL_COPY_DEFAULTS["offer-immediate.subject"], {
    referenceLabel: String(data.referenceLabel),
    date: String(data.date),
  }),
  displayName: "Immediate offer",
  previewData: {
    displayName: "Jane Performer",
    referenceLabel: "Candlelight · Strings",
    date: "2026-04-30",
    city: "Berlin",
    windowHours: 48,
  },
} satisfies TemplateEntry;
