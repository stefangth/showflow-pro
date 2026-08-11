import { useEffect, useRef, useState } from "react";
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
}

/** Debounced edge-rendered preview with stale-run and unmount protection. */
export function EmailPreviewPane({
  templateKey,
  copyOverride,
  themeOverride,
  highlightRole,
  dataOverride,
}: EmailPreviewPaneProps) {
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
  }, [copyOverride, dataOverride, highlightRole, templateKey, themeOverride]);

  useEffect(() => () => {
    runId.current += 1;
  }, []);

  return (
    <section aria-label="Email preview" className="relative h-full overflow-y-auto bg-muted/30">
      {error ? (
        <Alert variant="destructive" className="m-3">
          <AlertDescription>Could not render the preview. {error}</AlertDescription>
        </Alert>
      ) : null}
      {pending ? (
        <p role="status" className="absolute right-3 top-3 z-10 rounded-md bg-background/90 px-2 py-1 text-xs text-muted-foreground shadow">
          Updating
        </p>
      ) : null}
      {html ? (
        <iframe
          title="Email template preview"
          srcDoc={html}
          sandbox=""
          className="h-full w-full border-0 bg-background"
        />
      ) : null}
    </section>
  );
}
