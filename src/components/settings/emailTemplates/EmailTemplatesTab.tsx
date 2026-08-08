import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { generatePath, Link } from "react-router-dom";
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
  return template.status !== "internal" || isSuperAdmin;
}

function statusVariant(status: EmailTemplateCoverage["status"]): "default" | "neutral" | "outline" {
  if (status === "editable") return "default";
  if (status === "internal") return "neutral";
  return "outline";
}

export function EmailTemplatesTab({ readOnly, isSuperAdmin }: EmailTemplatesTabProps) {
  const { currentOrg } = useAuth();
  const orgId = currentOrg?.id ?? null;
  const { data: settings, error, isError, isFetching, isLoading, isSuccess, refetch } = useQuery({
    queryKey: ["email-templates", "settings", orgId],
    queryFn: () => fetchEmailTemplateSettings(supabase, orgId),
    enabled: Boolean(orgId),
  });
  const [previewOpen, setPreviewOpen] = useState(false);
  const [preview, setPreview] = useState<PreviewState>({ title: "", html: "", loading: false });

  const visibleTemplates = EMAIL_TEMPLATE_COVERAGE.filter((template) => isVisibleTemplate(template, isSuperAdmin));
  const helperText = readOnly
    ? "Preview every transactional email. Your role cannot change email copy or branding."
    : "Preview every transactional email and see the delivery details behind it.";
  const previewDisabled = !isSuccess || !settings;
  const settingsError = error instanceof Error ? error.message : "Please try again.";

  const handlePreview = async (template: EmailTemplateCoverage) => {
    if (!settings) return;
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
      if (error) throw error;
      const html = data?.templates?.[0]?.html;
      setPreview({ title: template.displayName, html: typeof html === "string" ? html : "<p>No preview available.</p>", loading: false });
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unknown error";
      setPreview({ title: template.displayName, html: `<p>Preview failed: ${message}</p>`, loading: false });
    }
  };

  return (
    <>
      <Card>
        <CardHeader>
          <CardTitle className="font-display">Email templates</CardTitle>
          <CardDescription>{helperText}</CardDescription>
        </CardHeader>
        <CardContent className="space-y-6" aria-busy={isFetching}>
          {isLoading ? (
            <p role="status" className="text-sm text-muted-foreground">Loading saved email presentation…</p>
          ) : null}
          {isError ? (
            <Alert variant="destructive">
              <AlertDescription className="flex flex-wrap items-center justify-between gap-3">
                <span>Could not load the saved email presentation. {settingsError}</span>
                <Button type="button" variant="outline" size="sm" disabled={isFetching} onClick={() => void refetch()}>
                  Retry
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
                  <h3 className="font-display text-sm font-semibold">{group}</h3>
                </div>
                <div className="divide-y divide-border">
                  {templates.map((template) => (
                    <div key={template.key} className="grid gap-3 px-4 py-4 sm:grid-cols-[minmax(0,1fr)_minmax(0,1.2fr)_auto] sm:items-center">
                      <div className="min-w-0">
                        <div className="flex items-center gap-2">
                          {template.family ? <span aria-hidden="true" className="h-2 w-2 shrink-0 rounded-full bg-primary" /> : null}
                          <p className="font-medium">{template.displayName}</p>
                        </div>
                        <p className="mt-1 text-xs text-muted-foreground">To: {template.recipient}</p>
                      </div>
                      <p className="text-sm text-muted-foreground">{template.trigger}</p>
                      <div className="flex items-center gap-2 sm:justify-self-end">
                        <Badge variant={statusVariant(template.status)}>{template.status === "editable" ? "Editable" : template.status === "external" ? "External" : "Internal"}</Badge>
                        {template.status === "editable" ? (
                          <Button variant="outline" size="sm" aria-label={`Preview ${template.displayName}`} disabled={previewDisabled} onClick={() => void handlePreview(template)}>
                            Preview
                          </Button>
                        ) : null}
                        {template.status === "editable" && !readOnly ? (
                          <Button asChild size="sm">
                            <Link
                              aria-label={`Edit ${template.displayName}`}
                              to={generatePath(ROUTES.EMAIL_TEMPLATE, { templateKey: template.key })}
                            >
                              Edit
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
            <DialogTitle>Preview: {preview.title}</DialogTitle>
            <DialogDescription>Rendered with this organization&apos;s saved email copy and theme.</DialogDescription>
          </DialogHeader>
          {preview.loading ? (
            <div className="flex h-64 items-center justify-center text-muted-foreground">Rendering preview…</div>
          ) : (
            <iframe
              title="Email preview"
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
