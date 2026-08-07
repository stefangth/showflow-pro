/// <reference types="npm:@types/react@18.3.1" />
import * as React from "npm:react@18.3.1";
import { Section, Text } from "npm:@react-email/components@0.0.22";
import type { TemplateData, TemplateEntry } from "./registry.ts";
import { APP_URL } from "../app-url.ts";
import { EmailShell, emailRoleStyle } from "./_shell/EmailShell.tsx";
import { applyEmailTokens, EMAIL_COPY_DEFAULTS, type EmailCopy } from "./_shell/emailCopy.ts";
import { EMAIL_THEME_DEFAULTS, type EmailFamily, type EmailRoleKey, type EmailTheme } from "./_shell/emailTheme.ts";

interface Props {
  job_name?: string;
  status_code?: number | string;
  error?: string;
  last_ok_at?: string;
  dashboard_url?: string;
  _emailCopy?: EmailCopy;
  _emailTheme?: EmailTheme;
  _emailFamily?: EmailFamily;
  _highlightRole?: EmailRoleKey;
}

const CronHealthAlert = ({
  job_name,
  status_code,
  error,
  last_ok_at,
  dashboard_url,
  _emailCopy = EMAIL_COPY_DEFAULTS as EmailCopy,
  _emailTheme = EMAIL_THEME_DEFAULTS,
  _emailFamily = "steel",
  _highlightRole,
}: Props) => {
  const copy = _emailCopy;
  const theme = _emailTheme;
  const values = {
    jobName: job_name ?? copy["cron-health-alert.jobFallback"],
    statusCode: status_code ?? copy["cron-health-alert.valueFallback"],
    error: error || copy["cron-health-alert.valueFallback"],
    lastHealthy: last_ok_at ?? copy["cron-health-alert.valueFallback"],
  };

  return (
    <EmailShell family={_emailFamily} theme={theme} previewText={applyEmailTokens(copy["cron-health-alert.previewText"], values)} heading={copy["cron-health-alert.heading"]} footer={copy["cron-health-alert.footer"]} cta={{ href: dashboard_url || `${APP_URL}/platform`, label: copy["cron-health-alert.ctaLabel"] }} highlightRole={_highlightRole}>
      <Text style={{ ...emailRoleStyle(theme, "body", _highlightRole), lineHeight: "1.6", margin: "0 0 16px" }}>{applyEmailTokens(copy["cron-health-alert.intro"], values)}</Text>
      <Section style={{ margin: "24px 0", padding: "16px 20px", backgroundColor: theme.base.colors.tileBg, borderRadius: `${theme.base.buttonRadius}px` }}>
        <Text style={{ ...emailRoleStyle(theme, "dataLabel", _highlightRole), margin: "0 0 2px" }}>{copy["cron-health-alert.jobLabel"]}</Text>
        <Text style={{ ...emailRoleStyle(theme, "dataValue", _highlightRole), margin: "0 0 12px" }}>{values.jobName}</Text>
        <Text style={{ ...emailRoleStyle(theme, "dataLabel", _highlightRole), margin: "0 0 2px" }}>{copy["cron-health-alert.lastStatusLabel"]}</Text>
        <Text style={{ ...emailRoleStyle(theme, "dataValue", _highlightRole), margin: "0 0 12px" }}>{values.statusCode}</Text>
        <Text style={{ ...emailRoleStyle(theme, "dataLabel", _highlightRole), margin: "0 0 2px" }}>{copy["cron-health-alert.lastErrorLabel"]}</Text>
        <Text style={{ ...emailRoleStyle(theme, "dataValue", _highlightRole), margin: "0 0 12px" }}>{values.error}</Text>
        <Text style={{ ...emailRoleStyle(theme, "dataLabel", _highlightRole), margin: "0 0 2px" }}>{copy["cron-health-alert.lastHealthyLabel"]}</Text>
        <Text style={{ ...emailRoleStyle(theme, "dataValue", _highlightRole), margin: "0" }}>{values.lastHealthy}</Text>
      </Section>
    </EmailShell>
  );
};

export const template = {
  component: CronHealthAlert as React.ComponentType<TemplateData>,
  subject: (data: TemplateData) => applyEmailTokens(EMAIL_COPY_DEFAULTS["cron-health-alert.subject"], { jobName: String(data.job_name ?? "a job"), statusCode: String(data.status_code ?? "?") }),
  displayName: "Cron health alert",
  previewData: { job_name: "send-offer-digest", status_code: 404, error: "Requested function was not found", last_ok_at: "2026-06-20T19:00:00Z", dashboard_url: `${APP_URL}/platform` },
} satisfies TemplateEntry;
