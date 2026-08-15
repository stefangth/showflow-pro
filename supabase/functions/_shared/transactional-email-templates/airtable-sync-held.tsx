/// <reference types="npm:@types/react@18.3.1" />
import * as React from "npm:react@18.3.1";
import { Text } from "npm:@react-email/components@0.0.22";
import type { TemplateData, TemplateEntry } from "./registry.ts";
import { APP_URL } from "../app-url.ts";
import { EmailShell, emailRoleStyle } from "./_shell/EmailShell.tsx";
import { applyEmailTokens, EMAIL_COPY_DEFAULTS, type EmailCopy, type EmailLocale } from "./_shell/emailCopy.ts";
import { EMAIL_THEME_DEFAULTS, type EmailFamily, type EmailRoleKey, type EmailTheme } from "./_shell/emailTheme.ts";

/** The three causes syncOrg's held_unresolved branches emit (see topHeldReason in
 *  airtable-poll/index.ts, the single source of truth for this categorization). */
type HeldReasonCategory = "missing_date" | "unlinked_program" | "unlinked_city";

interface Props {
  orgName?: string;
  /** Set when records were held (mutually exclusive with zeroImport — mirrors
   *  notifyAdminsOnSyncProblem in airtable-poll/index.ts). */
  heldCount?: number;
  /** Set when the sync imported 0 records from a non-empty table. */
  zeroImport?: boolean;
  /** The most common held reason among currently-held records (held branch only —
   *  never set alongside zeroImport). Renders a quantified "N of M" line, never a
   *  blanket single-cause claim; see topHeldReason in airtable-poll/index.ts. */
  topReasonCategory?: HeldReasonCategory;
  topReasonCount?: number;
  settingsUrl?: string;
  _emailCopy?: EmailCopy;
  _emailTheme?: EmailTheme;
  _emailFamily?: EmailFamily;
  _highlightRole?: EmailRoleKey;
  _emailLocale?: EmailLocale;
}

const AirtableSyncHeld = ({
  orgName,
  heldCount,
  zeroImport,
  topReasonCategory,
  topReasonCount,
  settingsUrl,
  _emailCopy = EMAIL_COPY_DEFAULTS as EmailCopy,
  _emailTheme = EMAIL_THEME_DEFAULTS,
  _emailFamily = "violet",
  _highlightRole,
  _emailLocale = "en",
}: Props) => {
  const copy = _emailCopy;
  const theme = _emailTheme;
  // heldCount takes priority when set, matching notifyAdminsOnSyncProblem's own
  // message branching (held always wins over a zero-import run). zeroImport must be
  // explicitly true to select that branch — real callers always set exactly one of
  // heldCount/zeroImport, so an incomplete payload (neither set) falls through to the
  // held copy with a zero count rather than silently claiming a zero-import run that
  // was never asserted.
  const isHeld = !!heldCount && heldCount > 0;
  const isZeroImport = !isHeld && zeroImport === true;
  const heldRecord = heldCount === 1
    ? copy["airtable-sync-held.heldRecordSingular"]
    : copy["airtable-sync-held.heldRecordPlural"];
  const values = {
    orgName: orgName || copy["airtable-sync-held.orgFallback"],
    heldCount: heldCount ?? 0,
    heldRecord,
  };
  const intro = isZeroImport
    ? applyEmailTokens(copy["airtable-sync-held.introZeroImport"], values)
    : applyEmailTokens(copy["airtable-sync-held.introHeld"], values);
  // The reason breakdown only ever applies to the held branch: a zero-import run has no
  // held records, so topReasonCategory (if a caller passed one by mistake) is ignored there.
  const topReasonLabel = isHeld && topReasonCategory === "missing_date"
    ? copy["airtable-sync-held.topReasonMissingDate"]
    : isHeld && topReasonCategory === "unlinked_program"
    ? copy["airtable-sync-held.topReasonUnlinkedProgram"]
    : isHeld && topReasonCategory === "unlinked_city"
    ? copy["airtable-sync-held.topReasonUnlinkedCity"]
    : null;
  // True only when the named reason accounts for EVERY currently-held record (a "1 of 1"
  // or "N of N" match, not a partial "N of M" breakdown) — the only case where the
  // followup sentence below would just repeat what topReasonLine already said.
  const allReasonKnown = isHeld && !!topReasonLabel && topReasonCount === (heldCount ?? 0);
  // Both "1 of 1" and "N of N" are redundant fractions that always reduce to "all of
  // them" — state that directly instead. Only a genuine partial breakdown (some, not
  // all, held records share the reason) renders the plain N-of-M line.
  const topReasonLine = isHeld && topReasonLabel && topReasonCount
    ? allReasonKnown
      ? (heldCount === 1
        ? applyEmailTokens(copy["airtable-sync-held.topReasonLineSingle"], { ...values, topReasonLabel })
        : applyEmailTokens(copy["airtable-sync-held.topReasonLineAll"], { ...values, topReasonLabel }))
      // A partial breakdown counting exactly one record takes the singular verb form:
      // "1 of the 2 are" would pair a singular count with a plural verb.
      : applyEmailTokens(
        copy[topReasonCount === 1 ? "airtable-sync-held.topReasonLineOne" : "airtable-sync-held.topReasonLine"],
        { ...values, topReasonCount, topReasonLabel },
      )
    : null;
  // Singular vs. plural, and whether topReasonLine above already answered "why": a lone
  // held record is "it", never "which ones" (see followupHeldSingle*), and once the
  // reason is already stated the followup drops "why" so it never re-asks a question the
  // previous sentence just answered (see followupHeld*KnownReason).
  const followup = isZeroImport
    ? copy["airtable-sync-held.followupZeroImport"]
    : heldCount === 1
    ? (allReasonKnown ? copy["airtable-sync-held.followupHeldSingleKnownReason"] : copy["airtable-sync-held.followupHeldSingle"])
    : (allReasonKnown ? copy["airtable-sync-held.followupHeldKnownReason"] : copy["airtable-sync-held.followupHeld"]);
  const previewText = isZeroImport
    ? applyEmailTokens(copy["airtable-sync-held.previewTextZeroImport"], values)
    : applyEmailTokens(copy["airtable-sync-held.previewTextHeld"], values);
  const ctaHref = settingsUrl || `${APP_URL}/settings?tab=airtable`;

  return (
    <EmailShell
      family={_emailFamily}
      theme={theme}
      previewText={previewText}
      heading={copy["airtable-sync-held.heading"]}
      footer={copy["airtable-sync-held.footer"]}
      cta={{ href: ctaHref, label: copy["airtable-sync-held.ctaLabel"] }}
      highlightRole={_highlightRole}
      lang={_emailLocale}
    >
      <Text style={{ ...emailRoleStyle(theme, "body", _highlightRole), lineHeight: "1.6", margin: "0 0 16px" }}>
        {intro}
      </Text>
      {topReasonLine && (
        <Text style={{ ...emailRoleStyle(theme, "body", _highlightRole), lineHeight: "1.6", margin: "0 0 16px" }}>
          {topReasonLine}
        </Text>
      )}
      <Text style={{ ...emailRoleStyle(theme, "body", _highlightRole), lineHeight: "1.6", margin: "0" }}>
        {followup}
      </Text>
    </EmailShell>
  );
};

export const template = {
  component: AirtableSyncHeld as React.ComponentType<TemplateData>,
  subject: (data: TemplateData) => applyEmailTokens(EMAIL_COPY_DEFAULTS["airtable-sync-held.subject"], {
    orgName: String(data.orgName || EMAIL_COPY_DEFAULTS["airtable-sync-held.orgFallback"]),
  }),
  displayName: "Airtable sync held",
  previewData: {
    orgName: "Riverdance Co",
    heldCount: 3,
    topReasonCategory: "unlinked_program",
    topReasonCount: 2,
    settingsUrl: `${APP_URL}/settings?tab=airtable`,
  },
} satisfies TemplateEntry;
