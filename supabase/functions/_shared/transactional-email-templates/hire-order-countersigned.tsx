/// <reference types="npm:@types/react@18.3.1" />
import * as React from "npm:react@18.3.1";
import { Section, Text } from "npm:@react-email/components@0.0.22";
import type { TemplateData, TemplateEntry } from "./registry.ts";
import { APP_URL } from "../app-url.ts";
import { EmailShell, emailRoleStyle } from "./_shell/EmailShell.tsx";
import { applyEmailTokens, EMAIL_COPY_DEFAULTS, type EmailCopy, type EmailLocale } from "./_shell/emailCopy.ts";
import { EMAIL_THEME_DEFAULTS, type EmailFamily, type EmailRoleKey, type EmailTheme } from "./_shell/emailTheme.ts";

interface Props {
  artist_name?: string;
  order_no?: string;
  date_label?: string;
  venue?: string;
  download_url?: string;
  _emailCopy?: EmailCopy;
  _emailTheme?: EmailTheme;
  _emailFamily?: EmailFamily;
  _highlightRole?: EmailRoleKey;
  _emailLocale?: EmailLocale;
}

const HireOrderCountersignedEmail = ({
  artist_name,
  order_no,
  date_label,
  venue,
  download_url,
  _emailCopy = EMAIL_COPY_DEFAULTS as EmailCopy,
  _emailTheme = EMAIL_THEME_DEFAULTS,
  _emailFamily = "steel",
  _highlightRole,
  _emailLocale = "en",
}: Props) => {
  const copy = _emailCopy;
  const theme = _emailTheme;
  const values = {
    artistName: artist_name || copy["hire-order-countersigned.artistFallback"],
    dateLabel: date_label || copy["hire-order-countersigned.dateFallback"],
    venue: venue || copy["hire-order-countersigned.venueFallback"],
  };
  const url = download_url || APP_URL;

  return (
    <EmailShell family={_emailFamily} theme={theme} previewText={applyEmailTokens(copy["hire-order-countersigned.previewText"], values)} heading={copy["hire-order-countersigned.heading"]} footer={copy["hire-order-countersigned.footer"]} cta={{ href: url, label: copy["hire-order-countersigned.ctaLabel"] }} highlightRole={_highlightRole} lang={_emailLocale}>
      <Text style={{ ...emailRoleStyle(theme, "body", _highlightRole), lineHeight: "1.6", margin: "0 0 16px" }}>{applyEmailTokens(copy["hire-order-countersigned.greeting"], values)}</Text>
      <Text style={{ ...emailRoleStyle(theme, "body", _highlightRole), lineHeight: "1.6", margin: "0 0 16px" }}>{applyEmailTokens(copy["hire-order-countersigned.intro"], values)}</Text>
      <Section style={{ margin: "24px 0", padding: "16px 20px", backgroundColor: theme.base.colors.tileBg, borderRadius: `${theme.base.buttonRadius}px` }}>
        {order_no && <Text style={{ ...emailRoleStyle(theme, "dataValue", _highlightRole), margin: "0 0 8px" }}><strong>{copy["hire-order-countersigned.orderLabel"]}</strong> {order_no}</Text>}
        <Text style={{ ...emailRoleStyle(theme, "dataValue", _highlightRole), margin: "0 0 8px" }}><strong>{copy["hire-order-countersigned.dateLabel"]}</strong> {values.dateLabel}</Text>
        <Text style={{ ...emailRoleStyle(theme, "dataValue", _highlightRole), margin: "0" }}><strong>{copy["hire-order-countersigned.venueLabel"]}</strong> {values.venue}</Text>
      </Section>
    </EmailShell>
  );
};

export const template = {
  component: HireOrderCountersignedEmail as React.ComponentType<TemplateData>,
  subject: (data: TemplateData) => applyEmailTokens(EMAIL_COPY_DEFAULTS["hire-order-countersigned.subject"], { dateLabel: String(data.date_label || "your date") }),
  displayName: "Contract countersigned",
  previewData: { artist_name: "Mara Lindqvist", order_no: "HO-2026-0142", date_label: "Sat, Aug 15 2026", venue: "Tempodrom", download_url: `${APP_URL}/contracts/HO-2026-0142` },
} satisfies TemplateEntry;
