/// <reference types="npm:@types/react@18.3.1" />
import * as React from "npm:react@18.3.1";
import { Section, Text } from "npm:@react-email/components@0.0.22";
import type { TemplateEntry, TemplateData } from "./registry.ts";
import { digestEmailSubject } from "../scheduleChanges.ts";
import { APP_URL } from "../app-url.ts";
import { EmailShell, emailRoleStyle } from "./_shell/EmailShell.tsx";
import { applyEmailTokens, EMAIL_COPY_DEFAULTS, type EmailCopy, type EmailLocale } from "./_shell/emailCopy.ts";
import { EMAIL_THEME_DEFAULTS, type EmailFamily, type EmailRoleKey, type EmailTheme } from "./_shell/emailTheme.ts";

const BOOKINGS_URL = `${APP_URL}/bookings`;

interface BookingRow { show: string; date: string; city: string; label?: string }
interface ChangeRow { show: string; date: string; city: string; changes: string }
interface CancelRow { show: string; date: string; city: string; reason?: string | null }
interface Props {
  displayName?: string;
  bookings?: BookingRow[];
  scheduleChanges?: ChangeRow[];
  cancellations?: CancelRow[];
  _emailCopy?: EmailCopy;
  _emailTheme?: EmailTheme;
  _emailFamily?: EmailFamily;
  _highlightRole?: EmailRoleKey;
  _emailLocale?: EmailLocale;
}

function BookingTable({
  rows,
  labels,
  values,
  theme,
  highlightRole,
}: {
  rows: Array<{ show: string; date: string; city: string; reason?: string; changes?: string }>;
  labels: string[];
  values: Array<(row: { show: string; date: string; city: string; reason?: string; changes?: string }) => string | undefined>;
  theme: EmailTheme;
  highlightRole?: EmailRoleKey;
}) {
  return (
    <table style={{ width: "100%", borderCollapse: "collapse" }} cellPadding={0} cellSpacing={0}>
      <thead><tr>{labels.map((label) => <th key={label} style={{ ...emailRoleStyle(theme, "dataLabel", highlightRole), textAlign: "left", padding: "10px 12px", borderBottom: `2px solid ${theme.base.colors.line}` }}>{label}</th>)}</tr></thead>
      <tbody>{rows.map((row, index) => <tr key={index} style={index % 2 === 1 ? { backgroundColor: theme.base.colors.tileBg } : undefined}>
        {values.map((value, column) => <td key={column} style={{ ...emailRoleStyle(theme, "dataValue", highlightRole), padding: "10px 12px", borderBottom: `1px solid ${theme.base.colors.line}`, verticalAlign: "top" }}>{value(row)}</td>)}
      </tr>)}</tbody>
    </table>
  );
}

const ArtistConfirmationDigest = ({
  displayName,
  bookings = [],
  scheduleChanges = [],
  cancellations = [],
  _emailCopy = EMAIL_COPY_DEFAULTS as EmailCopy,
  _emailTheme = EMAIL_THEME_DEFAULTS,
  _emailFamily = "violet",
  _highlightRole,
  _emailLocale = "en",
}: Props) => {
  const copy = _emailCopy;
  const theme = _emailTheme;
  const hasUpdates = scheduleChanges.length > 0 || cancellations.length > 0;
  const heading = hasUpdates ? copy["artist-confirmation-digest.headingUpdates"] : copy["artist-confirmation-digest.headingConfirmed"];
  const intro = hasUpdates ? copy["artist-confirmation-digest.introUpdates"] : copy["artist-confirmation-digest.introConfirmed"];
  const tokens = { displayName: displayName ?? "" };

  const previewText = hasUpdates ? copy["artist-confirmation-digest.subjectUpdates"] : copy["artist-confirmation-digest.subjectConfirmed"];

  return (
    <EmailShell family={_emailFamily} theme={theme} previewText={previewText} heading={heading} footer={copy["artist-confirmation-digest.footer"]} cta={{ href: BOOKINGS_URL, label: copy["artist-confirmation-digest.ctaLabel"] }} highlightRole={_highlightRole} lang={_emailLocale}>
      <Text style={{ ...emailRoleStyle(theme, "body", _highlightRole), lineHeight: "1.6", margin: "0 0 16px" }}>
        {displayName ? applyEmailTokens(copy["artist-confirmation-digest.greeting"], tokens) : copy["artist-confirmation-digest.greetingAnonymous"]}
      </Text>
      <Text style={{ ...emailRoleStyle(theme, "body", _highlightRole), lineHeight: "1.6", margin: "0 0 16px" }}>{intro}</Text>
      {cancellations.length > 0 && <Section style={{ margin: "24px 0" }}>
        <Text style={{ ...emailRoleStyle(theme, "dataLabel", _highlightRole), margin: "0 0 8px" }}>{copy["artist-confirmation-digest.cancelledHeading"]}</Text>
        <BookingTable rows={cancellations.map((row) => ({ ...row, reason: row.reason || copy["artist-confirmation-digest.reasonFallback"] }))} labels={[copy["artist-confirmation-digest.showLabel"], copy["artist-confirmation-digest.dateLabel"], copy["artist-confirmation-digest.cityLabel"], copy["artist-confirmation-digest.reasonLabel"]]} values={[(row) => row.show, (row) => row.date, (row) => row.city, (row) => row.reason]} theme={theme} highlightRole={_highlightRole} />
      </Section>}
      {scheduleChanges.length > 0 && <Section style={{ margin: "24px 0" }}>
        <Text style={{ ...emailRoleStyle(theme, "dataLabel", _highlightRole), margin: "0 0 8px" }}>{copy["artist-confirmation-digest.scheduleChangesHeading"]}</Text>
        <BookingTable rows={scheduleChanges} labels={[copy["artist-confirmation-digest.showLabel"], copy["artist-confirmation-digest.dateLabel"], copy["artist-confirmation-digest.cityLabel"], copy["artist-confirmation-digest.changeLabel"]]} values={[(row) => row.show, (row) => row.date, (row) => row.city, (row) => row.changes]} theme={theme} highlightRole={_highlightRole} />
      </Section>}
      {bookings.length > 0 && <Section style={{ margin: "24px 0" }}>
        {hasUpdates && <Text style={{ ...emailRoleStyle(theme, "dataLabel", _highlightRole), margin: "0 0 8px" }}>{copy["artist-confirmation-digest.confirmedHeading"]}</Text>}
        <BookingTable rows={bookings.map((row) => ({ ...row, show: row.label || row.show }))} labels={[copy["artist-confirmation-digest.showLabel"], copy["artist-confirmation-digest.dateLabel"], copy["artist-confirmation-digest.cityLabel"]]} values={[(row) => row.show, (row) => row.date, (row) => row.city]} theme={theme} highlightRole={_highlightRole} />
      </Section>}
      {bookings.length === 0 && !hasUpdates && <Text style={{ ...emailRoleStyle(theme, "body", _highlightRole), margin: "0" }}>{copy["artist-confirmation-digest.emptyState"]}</Text>}
    </EmailShell>
  );
};

export const template = {
  component: ArtistConfirmationDigest as React.ComponentType<TemplateData>,
  subject: (data: TemplateData) => digestEmailSubject(data),
  displayName: "Artist confirmation digest",
  previewData: {
    displayName: "Jane Performer",
    bookings: [{ show: "Riverdance", date: "2026-06-15", city: "Berlin" }],
    scheduleChanges: [{ show: "Riverdance", date: "2026-06-22", city: "Hamburg", changes: "Session 1 now 20:00 (was 19:00)" }],
    cancellations: [{ show: "Riverdance", date: "2026-06-29", city: "Munich", reason: "Venue flooded" }],
  },
} satisfies TemplateEntry;
