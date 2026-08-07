/// <reference types="npm:@types/react@18.3.1" />
import * as React from "npm:react@18.3.1";
import { Section, Text } from "npm:@react-email/components@0.0.22";
import type { TemplateEntry, TemplateData } from "./registry.ts";
import { APP_URL } from "../app-url.ts";
import { EmailShell, emailRoleStyle } from "./_shell/EmailShell.tsx";
import { applyEmailTokens, EMAIL_COPY_DEFAULTS, type EmailCopy } from "./_shell/emailCopy.ts";
import { EMAIL_THEME_DEFAULTS, type EmailFamily, type EmailRoleKey, type EmailTheme } from "./_shell/emailTheme.ts";

const AVAILABILITY_URL = `${APP_URL}/availability`;

interface OfferRow { show: string; date: string; city: string; expires: string; label?: string }
interface Props {
  displayName?: string;
  offers?: OfferRow[];
  _emailCopy?: EmailCopy;
  _emailTheme?: EmailTheme;
  _emailFamily?: EmailFamily;
  _highlightRole?: EmailRoleKey;
}

const ArtistOfferDigest = ({
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
  const pendingOffer = count === 1 ? copy["artist-offer-digest.pendingOfferSingular"] : copy["artist-offer-digest.pendingOfferPlural"];
  const tokens = { count, pendingOffer, displayName: displayName ?? "" };

  return (
    <EmailShell
      family={_emailFamily}
      theme={theme}
      previewText={applyEmailTokens(copy["artist-offer-digest.previewText"], tokens)}
      heading={applyEmailTokens(copy["artist-offer-digest.heading"], tokens)}
      footer={copy["artist-offer-digest.footer"]}
      cta={{ href: AVAILABILITY_URL, label: copy["artist-offer-digest.ctaLabel"] }}
      highlightRole={_highlightRole}
    >
      <Text style={{ ...emailRoleStyle(theme, "body", _highlightRole), lineHeight: "1.6", margin: "0 0 16px" }}>
        {displayName ? applyEmailTokens(copy["artist-offer-digest.greeting"], tokens) : copy["artist-offer-digest.greetingAnonymous"]}
      </Text>
      <Text style={{ ...emailRoleStyle(theme, "body", _highlightRole), lineHeight: "1.6", margin: "0 0 16px" }}>
        {applyEmailTokens(copy["artist-offer-digest.intro"], tokens)}
      </Text>
      {offers.length > 0 && (
        <Section style={{ margin: "24px 0" }}>
          <table style={{ width: "100%", borderCollapse: "collapse" }} cellPadding={0} cellSpacing={0}>
            <thead>
              <tr>
                {["showLabel", "dateLabel", "cityLabel", "expiresLabel"].map((field) => (
                  <th key={field} style={{ ...emailRoleStyle(theme, "dataLabel", _highlightRole), textAlign: "left", padding: "10px 12px", borderBottom: `2px solid ${theme.base.colors.line}` }}>
                    {copy[`artist-offer-digest.${field}` as keyof EmailCopy]}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {offers.map((offer, index) => (
                <tr key={index} style={index % 2 === 1 ? { backgroundColor: theme.base.colors.tileBg } : undefined}>
                  {[offer.label || offer.show, offer.date, offer.city, offer.expires].map((value, column) => (
                    <td key={column} style={{ ...emailRoleStyle(theme, "dataValue", _highlightRole), padding: "10px 12px", borderBottom: `1px solid ${theme.base.colors.line}`, verticalAlign: "top" }}>
                      {value}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </Section>
      )}
    </EmailShell>
  );
};

export const template = {
  component: ArtistOfferDigest as React.ComponentType<TemplateData>,
  subject: (data: TemplateData) => {
    const count = Array.isArray(data?.offers) ? data.offers.length : 0;
    const pendingOffer = count === 1
      ? EMAIL_COPY_DEFAULTS["artist-offer-digest.pendingOfferSingular"]
      : EMAIL_COPY_DEFAULTS["artist-offer-digest.pendingOfferPlural"];
    return applyEmailTokens(EMAIL_COPY_DEFAULTS["artist-offer-digest.subject"], { count, pendingOffer });
  },
  displayName: "Artist offer digest",
  previewData: {
    displayName: "Jane Performer",
    offers: [
      { show: "Riverdance", date: "2026-06-15", city: "Berlin", expires: "2026-05-17 19:00" },
      { show: "Riverdance", date: "2026-06-22", city: "Berlin", expires: "2026-05-17 19:00" },
    ],
  },
} satisfies TemplateEntry;
