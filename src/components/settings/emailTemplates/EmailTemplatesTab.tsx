import { useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { generatePath, Link } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { useAuth } from "@/features/auth/AuthContext";
import { fetchEmailTemplateSettings } from "@/data/emailTemplates";
import { supabase } from "@/integrations/supabase/client";
import { EMAIL_TEMPLATE_COVERAGE, type EmailTemplateCoverage } from "@/lib/emailTemplates/coverage";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { ROUTES } from "@/config/app.config";

interface EmailTemplatesTabProps {
  readOnly: boolean;
  isSuperAdmin: boolean;
}

interface PreviewState {
  title: string;
  html: string;
  loading: boolean;
}

const GROUPS = ["Booking engine", "Hire orders", "Accounts & access", "System"] as const;

function isVisibleTemplate(template: EmailTemplateCoverage, isSuperAdmin: boolean): boolean {
  if (template.status !== "internal") return true;
  // "internal" only hides a row from the org itself when nobody in the org is the
  // audience (audience defaults to "platform" — cron-health-alert, magic-link).
  // A row whose recipients ARE org admins (audience: "org", e.g. airtable-sync-held)
  // stays visible to them: they can't edit it, but they need to know it exists.
  return template.audience === "org" || isSuperAdmin;
}

function statusVariant(status: EmailTemplateCoverage["status"]): "default" | "neutral" | "outline" {
  if (status === "editable") return "default";
  if (status === "internal") return "neutral";
  return "outline";
}

function canPreview(template: EmailTemplateCoverage): boolean {
  if (template.status === "editable") return true;
  // An "internal" row still renders from the same registry entry as an editable one
  // (preview-transactional-email works off defaults when there is no per-org copy
  // override), so audience: "org" rows (e.g. airtable-sync-held) stay previewable: an
  // admin who can see the row because it is about them should be able to read what it
  // actually says, even though they can't reword it. Platform-only internal rows
  // (audience: "platform", e.g. cron-health-alert, magic-link) are not addressed by
  // this WP and stay preview-less.
  return template.status === "internal" && template.audience === "org";
}

function statusKey(template: EmailTemplateCoverage): "editable" | "external" | "automatic" | "internal" {
  if (template.status === "editable") return "editable";
  if (template.status === "external") return "external";
  // "internal" + org audience means "we render it, you can't reword it" rather than
  // "this is platform plumbing you shouldn't be able to see at all" — say so plainly.
  return template.audience === "org" ? "automatic" : "internal";
}

export function EmailTemplatesTab({ readOnly, isSuperAdmin }: EmailTemplatesTabProps) {
  const { t } = useTranslation("settingsEmailTemplates");
  const { currentOrg } = useAuth();
  const orgId = currentOrg?.id ?? null;
  const { data: settings, error, isError, isFetching, isLoading, isSuccess, refetch } = useQuery({
    queryKey: ["app-settings", "email-templates", orgId],
    queryFn: () => fetchEmailTemplateSettings(supabase, orgId),
    enabled: Boolean(orgId),
  });
  const [previewOpen, setPreviewOpen] = useState(false);
  const [preview, setPreview] = useState<PreviewState>({ title: "", html: "", loading: false });
  const previewRun = useRef(0);

  const visibleTemplates = EMAIL_TEMPLATE_COVERAGE.filter((template) => isVisibleTemplate(template, isSuperAdmin));
  const helperText = readOnly
    ? t("emailTemplatesTab.helperReadOnly")
    : t("emailTemplatesTab.helperEditable");
  const previewDisabled = !isSuccess || !settings;
  const settingsError = error instanceof Error ? error.message : t("emailTemplatesTab.loadErrorFallback");

  const handlePreview = async (template: EmailTemplateCoverage) => {
    if (!settings) return;
    // Guard against a slower earlier request resolving after a newer one and
    // overwriting the dialog with the wrong template's HTML.
    const runId = ++previewRun.current;
    setPreviewOpen(true);
    setPreview({ title: template.displayName, html: "", loading: true });
    try {
      const { data, error } = await supabase.functions.invoke("preview-transactional-email", {
        body: {
          templateName: template.key,
          copyOverride: settings.copy,
          themeOverride: settings.theme,
        },
      });
      if (runId !== previewRun.current) return;
      if (error) throw error;
      // A HTTP 200 { status: "render_failed", errorMessage, html: "" } is the real
      // failure shape from preview-transactional-email (an unregistered or broken
      // template) — it does not throw, so it must be checked explicitly. Without this,
      // an admin sees a blank iframe with no explanation, which is exactly the row
      // most exposed to it during the window between a frontend deploy and the
      // functions deploy landing a newly-added template. `status` is optional to stay
      // compatible with any caller that hands back a bare { html } shape.
      const result = data?.templates?.[0] as { html?: string; status?: string; errorMessage?: string } | undefined;
      if (result?.status === "render_failed") {
        const message = result.errorMessage || t("emailTemplatesTab.unknownError");
        setPreview({ title: template.displayName, html: `<p>${t("emailTemplatesTab.previewFailed", { message })}</p>`, loading: false });
        return;
      }
      const html = result?.html;
      setPreview({ title: template.displayName, html: typeof html === "string" && html.length > 0 ? html : `<p>${t("emailTemplatesTab.noPreviewAvailable")}</p>`, loading: false });
    } catch (error) {
      if (runId !== previewRun.current) return;
      const message = error instanceof Error ? error.message : t("emailTemplatesTab.unknownError");
      setPreview({ title: template.displayName, html: `<p>${t("emailTemplatesTab.previewFailed", { message })}</p>`, loading: false });
    }
  };

  return (
    <>
      <Card>
        <CardHeader>
          <CardTitle className="font-display">{t("emailTemplatesTab.title")}</CardTitle>
          <CardDescription>{helperText}</CardDescription>
        </CardHeader>
        <CardContent className="space-y-6" aria-busy={isFetching}>
          {isLoading ? (
            <p role="status" className="text-sm text-muted-foreground">{t("emailTemplatesTab.loading")}</p>
          ) : null}
          {isError ? (
            <Alert variant="destructive">
              <AlertDescription className="flex flex-wrap items-center justify-between gap-3">
                <span>{t("emailTemplatesTab.loadError", { message: settingsError })}</span>
                <Button type="button" variant="outline" size="sm" disabled={isFetching} onClick={() => void refetch()}>
                  {t("emailTemplatesTab.retry")}
                </Button>
              </AlertDescription>
            </Alert>
          ) : null}
          {GROUPS.map((group) => {
            const templates = visibleTemplates.filter((template) => template.group === group);
            return templates.length > 0 ? (
              <section
                key={group}
                data-testid={`email-template-group-${group}`}
                className="overflow-hidden rounded-lg border border-border bg-card text-foreground"
              >
                <div className="border-b border-border bg-muted px-4 py-3">
                  <h3 className="font-display text-sm font-semibold">{t(`emailTemplatesTab.groups.${group}`)}</h3>
                </div>
                <div className="divide-y divide-border">
                  {templates.map((template) => (
                    <div key={template.key} className="grid gap-3 px-4 py-4 sm:grid-cols-[minmax(0,1fr)_minmax(0,1.2fr)_auto] sm:items-center">
                      <div className="min-w-0">
                        <div className="flex items-center gap-2">
                          {template.family ? <span aria-hidden="true" className="h-2 w-2 shrink-0 rounded-full bg-primary" /> : null}
                          <p className="font-medium">{template.displayName}</p>
                        </div>
                        <p className="mt-1 text-xs text-muted-foreground">{t("emailTemplatesTab.recipientPrefix", { recipient: template.recipient })}</p>
                      </div>
                      <p className="text-sm text-muted-foreground">{template.trigger}</p>
                      <div className="flex items-center gap-2 sm:justify-self-end">
                        <Badge variant={statusVariant(template.status)}>{t(`emailTemplatesTab.status.${statusKey(template)}`)}</Badge>
                        {canPreview(template) ? (
                          <Button variant="outline" size="sm" aria-label={t("emailTemplatesTab.previewAriaLabel", { name: template.displayName })} disabled={previewDisabled} onClick={() => void handlePreview(template)}>
                            {t("emailTemplatesTab.previewAction")}
                          </Button>
                        ) : null}
                        {template.status === "editable" && !readOnly ? (
                          <Button asChild size="sm">
                            <Link
                              aria-label={t("emailTemplatesTab.editAriaLabel", { name: template.displayName })}
                              to={generatePath(ROUTES.EMAIL_TEMPLATE, { templateKey: template.key })}
                            >
                              {t("emailTemplatesTab.editAction")}
                            </Link>
                          </Button>
                        ) : null}
                      </div>
                    </div>
                  ))}
                </div>
              </section>
            ) : null;
          })}
        </CardContent>
      </Card>

      <Dialog open={previewOpen} onOpenChange={setPreviewOpen}>
        <DialogContent className="max-w-3xl">
          <DialogHeader>
            <DialogTitle>{t("emailTemplatesTab.previewDialog.title", { title: preview.title })}</DialogTitle>
            <DialogDescription>{t("emailTemplatesTab.previewDialog.description")}</DialogDescription>
          </DialogHeader>
          {preview.loading ? (
            <div className="flex h-64 items-center justify-center text-muted-foreground">{t("emailTemplatesTab.previewDialog.rendering")}</div>
          ) : (
            <iframe
              title={t("emailTemplatesTab.previewDialog.iframeTitle")}
              srcDoc={preview.html}
              sandbox="allow-same-origin"
              className="h-[520px] w-full rounded-lg border border-border bg-background"
            />
          )}
        </DialogContent>
      </Dialog>
    </>
  );
}
