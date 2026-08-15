import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { previewEmailTemplate } from "@/data/emailTemplates";
import { supabase } from "@/integrations/supabase/client";
import type { EmailCopyOverride } from "@/lib/emailTemplates/emailCopy";
import type { EmailThemeOverride } from "@/lib/emailTemplates/emailTheme";

const DEBOUNCE_MS = 250;

export interface EmailPreviewPaneProps {
  templateKey: string;
  copyOverride: EmailCopyOverride;
  themeOverride: EmailThemeOverride;
  highlightRole?: string;
  /** Sample-data override for variant previews (see EmailPreviewVariant). Pass a
   *  stable identity — this effect keys on it. */
  dataOverride?: Record<string, unknown>;
  /** Preview language (default English). */
  locale?: "en" | "de";
}

/** Debounced edge-rendered preview with stale-run and unmount protection. */
export function EmailPreviewPane({
  templateKey,
  copyOverride,
  themeOverride,
  highlightRole,
  dataOverride,
  locale,
}: EmailPreviewPaneProps) {
  const { t } = useTranslation("settingsEmailTemplates");
  const [html, setHtml] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const runId = useRef(0);

  useEffect(() => {
    const id = ++runId.current;
    setPending(true);
    setError(null);
    const timer = window.setTimeout(async () => {
      try {
        const nextHtml = await previewEmailTemplate(supabase, {
          templateName: templateKey,
          copyOverride,
          themeOverride,
          ...(highlightRole ? { highlightRole } : {}),
          ...(dataOverride ? { dataOverride } : {}),
          ...(locale ? { locale } : {}),
        });
        if (id !== runId.current) return;
        setHtml(nextHtml);
      } catch (caught) {
        if (id !== runId.current) return;
        setError(caught instanceof Error ? caught.message : String(caught));
      } finally {
        if (id === runId.current) setPending(false);
      }
    }, DEBOUNCE_MS);

    return () => window.clearTimeout(timer);
  }, [copyOverride, dataOverride, highlightRole, locale, templateKey, themeOverride]);

  useEffect(() => () => {
    runId.current += 1;
  }, []);

  return (
    <section aria-label={t("emailPreviewPane.ariaLabel")} className="relative h-full overflow-y-auto bg-muted/30">
      {error ? (
        <Alert variant="destructive" className="m-3">
          <AlertDescription>{t("emailPreviewPane.loadError", { message: error })}</AlertDescription>
        </Alert>
      ) : null}
      {pending ? (
        <p role="status" className="absolute right-3 top-3 z-10 rounded-md bg-background/90 px-2 py-1 text-xs text-muted-foreground shadow">
          {t("emailPreviewPane.updating")}
        </p>
      ) : null}
      {html ? (
        <iframe
          title={t("emailPreviewPane.iframeTitle")}
          srcDoc={html}
          sandbox=""
          className="h-full w-full border-0 bg-background"
        />
      ) : null}
    </section>
  );
}
