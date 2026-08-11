import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/integrations/supabase/types";
import {
  legacyEmailOverridesToCopy,
  type EmailCopyOverride,
} from "@/lib/emailTemplates/emailCopy";
import type { EmailThemeOverride } from "@/lib/emailTemplates/emailTheme";
import { resolveOrgSetting } from "./settings";

export interface EmailTemplateSettings {
  copy: EmailCopyOverride;
  theme: EmailThemeOverride;
}

export interface EmailTemplatePreviewRequest {
  templateName: string;
  copyOverride: EmailCopyOverride;
  themeOverride: EmailThemeOverride;
  highlightRole?: string;
  /** Merged over the template's registered sample data by the preview edge function.
   *  Lets the editor preview data-selected variants (org-invitation's per-role action
   *  lines) that the hardcoded sample could otherwise never reach. */
  dataOverride?: Record<string, unknown>;
}

/**
 * Resolves the org's editable email presentation settings. A present empty
 * email_copy object is an intentional reset, so only an absent value falls
 * back to the one-release legacy setting.
 */
export async function fetchEmailTemplateSettings(
  client: SupabaseClient<Database>,
  orgId: string | null,
): Promise<EmailTemplateSettings> {
  const [copy, theme, legacy] = await Promise.all([
    resolveOrgSetting<EmailCopyOverride | null>(client, orgId, "email_copy", null),
    resolveOrgSetting<EmailThemeOverride>(client, orgId, "email_theme", {}),
    resolveOrgSetting<unknown>(client, orgId, "email_template_overrides", {}),
  ]);

  return {
    copy: copy ?? legacyEmailOverridesToCopy(legacy),
    theme,
  };
}

/** Render the current email draft through the same edge boundary used by delivery. */
export async function previewEmailTemplate(
  client: SupabaseClient<Database>,
  request: EmailTemplatePreviewRequest,
): Promise<string> {
  const { data, error } = await client.functions.invoke("preview-transactional-email", {
    body: request,
  });
  if (error) throw error;
  const response = data as { templates?: Array<{ html?: unknown }> } | null;
  const html = response?.templates?.[0]?.html;
  if (typeof html !== "string") throw new Error("Preview response did not include HTML");
  return html;
}
