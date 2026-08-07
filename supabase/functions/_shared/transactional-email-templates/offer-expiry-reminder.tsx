/// <reference types="npm:@types/react@18.3.1" />
import * as React from "npm:react@18.3.1";
import { Section, Text } from "npm:@react-email/components@0.0.22";
import type { TemplateEntry, TemplateData } from "./registry.ts";
import { APP_URL } from "../app-url.ts";
import { EmailShell, emailRoleStyle } from "./_shell/EmailShell.tsx";
import { applyEmailTokens, EMAIL_COPY_DEFAULTS, type EmailCopy } from "./_shell/emailCopy.ts";
import { EMAIL_THEME_DEFAULTS, type EmailFamily, type EmailRoleKey, type EmailTheme } from "./_shell/emailTheme.ts";

const AVAILABILITY_URL = `${APP_URL}/availability`;

interface OfferRow { referenceLabel: string; date: string; expiresAt: string }
interface Props {
  displayName?: string;
  offers?: OfferRow[];
  _emailCopy?: EmailCopy;
  _emailTheme?: EmailTheme;
  _emailFamily?: EmailFamily;
  _highlightRole?: EmailRoleKey;
}

const OfferExpiryReminder = ({
  displayName,
  offers = [],
  _emailCopy = EMAIL_COPY_DEFAULTS as EmailCopy,
  _emailTheme = EMAIL_THEME_DEFAULTS,
  _emailFamily = "violet",
  _highlightRole,
}: Props) => {
  const copy = _emailCopy;
  const theme = _emailTheme;
  const count = offers.length;
  const singular = count === 1;
  const tokens = { count, displayName: displayName ?? "" };
  const heading = singular
    ? copy["offer-expiry-reminder.headingSingular"]
    : applyEmailTokens(copy["offer-expiry-reminder.headingPlural"], tokens);
  const intro = singular
    ? copy["offer-expiry-reminder.introSingular"]
    : applyEmailTokens(copy["offer-expiry-reminder.introPlural"], tokens);
  const previewText = singular
    ? copy["offer-expiry-reminder.previewSingular"]
    : applyEmailTokens(copy["offer-expiry-reminder.previewPlural"], tokens);
  const ctaLabel = singular ? copy["offer-expiry-reminder.ctaLabelSingular"] : copy["offer-expiry-reminder.ctaLabelPlural"];

  return (
    <EmailShell
      family={_emailFamily}
      theme={theme}
      previewText={previewText}
      heading={heading}
      footer={copy["offer-expiry-reminder.footer"]}
      cta={{ href: AVAILABILITY_URL, label: ctaLabel }}
      highlightRole={_highlightRole}
    >
      <Text style={{ ...emailRoleStyle(theme, "body", _highlightRole), lineHeight: "1.6", margin: "0 0 16px" }}>
        {displayName ? applyEmailTokens(copy["offer-expiry-reminder.greeting"], tokens) : copy["offer-expiry-reminder.greetingAnonymous"]}
      </Text>
      <Text style={{ ...emailRoleStyle(theme, "body", _highlightRole), lineHeight: "1.6", margin: "0 0 16px" }}>{intro}</Text>
      {offers.length > 0 && (
        <Section style={{ margin: "24px 0", padding: "16px 20px", backgroundColor: theme.base.colors.tileBg, borderRadius: `${theme.base.buttonRadius}px` }}>
          {offers.map((offer, index) => (
            <Text key={index} style={{ ...emailRoleStyle(theme, "dataValue", _highlightRole), margin: index === offers.length - 1 ? "0" : "0 0 10px" }}>
              {applyEmailTokens(copy["offer-expiry-reminder.offerLine"], {
                referenceLabel: offer.referenceLabel,
                date: offer.date,
                expiresAt: offer.expiresAt,
              })}
            </Text>
          ))}
        </Section>
      )}
    </EmailShell>
  );
};

export const template = {
  component: OfferExpiryReminder as React.ComponentType<TemplateData>,
  subject: (data: TemplateData) => {
    const count = Array.isArray(data?.offers) ? data.offers.length : 0;
    return count === 1
      ? EMAIL_COPY_DEFAULTS["offer-expiry-reminder.subjectSingular"]
      : applyEmailTokens(EMAIL_COPY_DEFAULTS["offer-expiry-reminder.subjectPlural"], { count });
  },
  displayName: "Offer expiry reminder",
  previewData: {
    displayName: "Jane Performer",
    offers: [{ referenceLabel: "Candlelight · Strings", date: "2026-04-30", expiresAt: "30/04/2026 19:00" }],
  },
} satisfies TemplateEntry;
