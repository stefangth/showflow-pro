/// <reference types="npm:@types/react@18.3.1" />
import * as React from "npm:react@18.3.1";
import { Button, Section, Text } from "npm:@react-email/components@0.0.22";
import type { TemplateData, TemplateEntry } from "./registry.ts";
import { APP_URL } from "../app-url.ts";
import { EmailShell, emailRoleStyle } from "./_shell/EmailShell.tsx";
import { applyEmailTokens, EMAIL_COPY_DEFAULTS, type EmailCopy, type EmailLocale } from "./_shell/emailCopy.ts";
import { EMAIL_THEME_DEFAULTS, type EmailFamily, type EmailRoleKey, type EmailTheme } from "./_shell/emailTheme.ts";

interface Props {
  artist_name?: string;
  order_no?: string;
  date_label?: string;
  engagement_dates_label?: string;
  venue?: string;
  city?: string;
  fee_label?: string;
  download_url?: string;
  countersign_mode?: "manual" | "documenso" | "electronic" | string;
  signing_url?: string;
  is_fully_signed?: boolean;
  _emailCopy?: EmailCopy;
  _emailTheme?: EmailTheme;
  _emailFamily?: EmailFamily;
  _highlightRole?: EmailRoleKey;
  _emailLocale?: EmailLocale;
}

const HireOrderIssuedEmail = ({
  artist_name,
  order_no,
  date_label,
  engagement_dates_label,
  venue,
  city,
  fee_label,
  download_url,
  countersign_mode,
  signing_url,
  is_fully_signed,
  _emailCopy = EMAIL_COPY_DEFAULTS as EmailCopy,
  _emailTheme = EMAIL_THEME_DEFAULTS,
  _emailFamily = "pine",
  _highlightRole,
  _emailLocale = "en",
}: Props) => {
  const copy = _emailCopy;
  const theme = _emailTheme;
  const values = {
    artistName: artist_name || copy["hire-order-issued.artistFallback"],
    dateLabel: date_label || copy["hire-order-issued.dateFallback"],
    venue: venue || copy["hire-order-issued.venueFallback"],
  };
  const engagementDates = engagement_dates_label || values.dateLabel;
  const downloadUrl = download_url || APP_URL;
  const showSignCta = !is_fully_signed && Boolean(signing_url) && (countersign_mode === "documenso" || countersign_mode === "electronic");
  const documentCtaLabel = showSignCta ? copy["hire-order-issued.signCtaLabel"] : copy["hire-order-issued.ctaLabel"];

  return (
    <EmailShell family={_emailFamily} theme={theme} previewText={applyEmailTokens(copy["hire-order-issued.previewText"], values)} heading={copy["hire-order-issued.heading"]} footer={copy["hire-order-issued.footer"]} cta={{ href: downloadUrl, label: documentCtaLabel }} highlightRole={_highlightRole} lang={_emailLocale}>
      <Text style={{ ...emailRoleStyle(theme, "body", _highlightRole), lineHeight: "1.6", margin: "0 0 16px" }}>{applyEmailTokens(copy["hire-order-issued.greeting"], values)}</Text>
      <Text style={{ ...emailRoleStyle(theme, "body", _highlightRole), lineHeight: "1.6", margin: "0 0 16px" }}>{applyEmailTokens(copy["hire-order-issued.intro"], values)}</Text>
      <Section style={{ margin: "24px 0", padding: "16px 20px", backgroundColor: theme.base.colors.tileBg, borderRadius: `${theme.base.buttonRadius}px` }}>
        {order_no && <Text style={{ ...emailRoleStyle(theme, "dataValue", _highlightRole), margin: "0 0 8px" }}><strong>{copy["hire-order-issued.orderLabel"]}</strong> {order_no}</Text>}
        <Text style={{ ...emailRoleStyle(theme, "dataValue", _highlightRole), margin: "0 0 8px" }}><strong>{copy["hire-order-issued.engagementDatesLabel"]}</strong> {engagementDates}</Text>
        <Text style={{ ...emailRoleStyle(theme, "dataValue", _highlightRole), margin: "0 0 8px" }}><strong>{copy["hire-order-issued.venueLabel"]}</strong> {values.venue}</Text>
        {city && <Text style={{ ...emailRoleStyle(theme, "dataValue", _highlightRole), margin: "0 0 8px" }}><strong>{copy["hire-order-issued.cityLabel"]}</strong> {city}</Text>}
        {fee_label && <Text style={{ ...emailRoleStyle(theme, "dataValue", _highlightRole), margin: "0" }}><strong>{copy["hire-order-issued.feeLabel"]}</strong> {fee_label}</Text>}
      </Section>
      {showSignCta && <>
        <Text style={{ ...emailRoleStyle(theme, "body", _highlightRole), lineHeight: "1.6", margin: "0 0 16px" }}>{copy["hire-order-issued.signPrompt"]}</Text>
        <Section style={{ textAlign: "center", margin: "0 0 24px" }}>
          <Button href={signing_url || APP_URL} style={{ ...emailRoleStyle(theme, "button", _highlightRole), backgroundColor: theme.base.colors.buttonBg, borderRadius: `${theme.base.buttonRadius}px`, padding: "12px 24px", textDecoration: "none" }}>{copy["hire-order-issued.signButton"]}</Button>
        </Section>
      </>}
      <Text style={{ ...emailRoleStyle(theme, "footer", _highlightRole), margin: "0 0 8px" }}>{copy["hire-order-issued.pasteLink"]}</Text>
      <Text style={{ ...emailRoleStyle(theme, "dataValue", _highlightRole), margin: "0 0 24px" }}>{downloadUrl}</Text>
      {!showSignCta && <Text style={{ ...emailRoleStyle(theme, "body", _highlightRole), lineHeight: "1.6", margin: "0" }}>{copy["hire-order-issued.manualPrompt"]}</Text>}
    </EmailShell>
  );
};

export const template = {
  component: HireOrderIssuedEmail as React.ComponentType<TemplateData>,
  subject: (data: TemplateData) => applyEmailTokens(EMAIL_COPY_DEFAULTS["hire-order-issued.subject"], { dateLabel: String(data.date_label || "your date"), venue: String(data.venue || "the venue") }),
  displayName: "Hire order issued",
  previewData: { artist_name: "Mara Lindqvist", order_no: "HO-2026-0142", date_label: "Sat, Aug 15 2026", venue: "Tempodrom", city: "Berlin", fee_label: "€850.00", download_url: `${APP_URL}/hire-orders/HO-2026-0142`, countersign_mode: "manual" },
} satisfies TemplateEntry;
