/// <reference types="npm:@types/react@18.3.1" />
import * as React from "npm:react@18.3.1";
import { Text } from "npm:@react-email/components@0.0.22";
import type { TemplateData, TemplateEntry } from "./registry.ts";
import { APP_URL } from "../app-url.ts";
import { EmailShell, emailRoleStyle } from "./_shell/EmailShell.tsx";
import { applyEmailTokens, EMAIL_COPY_DEFAULTS, type EmailCopy, type EmailLocale } from "./_shell/emailCopy.ts";
import { EMAIL_THEME_DEFAULTS, type EmailFamily, type EmailRoleKey, type EmailTheme } from "./_shell/emailTheme.ts";

/** The early-warning twin of cast-escalation-requested: tier-at-risk-watcher sends
 *  this while the tier is STILL OPEN but can no longer mathematically fill before
 *  its deadline (pending + accepted < required). Unlike the escalation email, which
 *  fires only after the tier has fully expired, the recovery guidance here names
 *  two live remedies (open the next tier, or book directly) — a still-open tier can
 *  still be filled by a direct booking, not only by escalating. */
const BOOKINGS_URL = `${APP_URL}/dates`;

interface Props {
  program?: string;
  date?: string;
  tier?: number;
  pending?: number;
  accepted?: number;
  required?: number;
  reviewUrl?: string;
  _emailCopy?: EmailCopy;
  _emailTheme?: EmailTheme;
  _emailFamily?: EmailFamily;
  _highlightRole?: EmailRoleKey;
  _emailLocale?: EmailLocale;
}

const TierAtRisk = ({
  program,
  date,
  tier,
  pending,
  accepted,
  required,
  reviewUrl,
  _emailCopy = EMAIL_COPY_DEFAULTS as EmailCopy,
  _emailTheme = EMAIL_THEME_DEFAULTS,
  _emailFamily = "ember",
  _highlightRole,
  _emailLocale = "en",
}: Props) => {
  const copy = _emailCopy;
  const theme = _emailTheme;
  const values = {
    program: program ?? copy["tier-at-risk.showFallback"],
    date: date ?? copy["tier-at-risk.dateFallback"],
    tier: tier ?? "?",
    pending: pending ?? 0,
    accepted: accepted ?? 0,
    required: required ?? "?",
  };
  const ctaHref = reviewUrl || BOOKINGS_URL;

  return (
    <EmailShell
      family={_emailFamily}
      theme={theme}
      previewText={applyEmailTokens(copy["tier-at-risk.previewText"], values)}
      heading={copy["tier-at-risk.heading"]}
      footer={copy["tier-at-risk.footer"]}
      cta={{ href: ctaHref, label: copy["tier-at-risk.ctaLabel"] }}
      highlightRole={_highlightRole}
      lang={_emailLocale}
    >
      <Text style={{ ...emailRoleStyle(theme, "body", _highlightRole), lineHeight: "1.6", margin: "0" }}>
        {applyEmailTokens(copy["tier-at-risk.body"], values)}
      </Text>
    </EmailShell>
  );
};

export const template = {
  component: TierAtRisk as React.ComponentType<TemplateData>,
  subject: (data: TemplateData) => applyEmailTokens(EMAIL_COPY_DEFAULTS["tier-at-risk.subject"], {
    program: String(data.program ?? "show"),
    date: String(data.date ?? "?"),
  }),
  displayName: "Tier at risk",
  previewData: { program: "Phantom", date: "2026-09-10", tier: 2, pending: 1, accepted: 1, required: 4, reviewUrl: BOOKINGS_URL },
} satisfies TemplateEntry;
