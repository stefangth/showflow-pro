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
