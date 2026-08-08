import { useEffect, useMemo, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link, useParams } from "react-router-dom";
import { toast } from "sonner";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { EmailPreviewPane } from "@/components/settings/emailTemplates/EmailPreviewPane";
import {
  EmailTemplateInspector,
} from "@/components/settings/emailTemplates/EmailTemplateInspector";
import {
  EMAIL_EDITOR_SECTIONS,
  emailCopyFieldsForRole,
  type EmailEditorSelection,
} from "@/components/settings/emailTemplates/emailEditorMeta";
import { TemplateEditorShell } from "@/components/settings/templateEditor/TemplateEditorShell";
import { TemplateOutline } from "@/components/settings/templateEditor/TemplateOutline";
import { hasOwnKeys } from "@/components/settings/templateEditor/overrideMap";
import { ROUTES } from "@/config/app.config";
import { fetchEmailTemplateSettings } from "@/data/emailTemplates";
import { upsertOrgSetting } from "@/data/settings";
import { useAuth } from "@/features/auth/AuthContext";
import { useCan } from "@/hooks/useCapabilities";
import { supabase } from "@/integrations/supabase/client";
import type { Json } from "@/integrations/supabase/types";
import {
  compactEmailCopy,
  type EmailCopyKey,
} from "@/lib/emailTemplates/emailCopy";
import {
  EMAIL_TEMPLATE_COPY_FIELDS,
  type EmailTemplateCopyFields,
} from "@/lib/emailTemplates/emailTemplateMeta";
import {
  compactEmailTheme,
  type EmailRoleKey,
  type EmailThemeOverride,
} from "@/lib/emailTemplates/emailTheme";

interface WorkspaceProps {
  template: EmailTemplateCopyFields;
  readOnly: boolean;
}

function EmailTemplateEditorWorkspace({ template, readOnly }: WorkspaceProps) {
  const { currentOrg } = useAuth();
  const orgId = currentOrg?.id ?? null;
  const queryClient = useQueryClient();
  const settingsQuery = useQuery({
    queryKey: ["app-settings", "email-templates", orgId],
    queryFn: () => fetchEmailTemplateSettings(supabase, orgId),
    enabled: Boolean(orgId),
  });
  const [copyDraft, setCopyDraft] = useState<Partial<Record<EmailCopyKey, string>>>({});
  const [themeDraft, setThemeDraft] = useState<EmailThemeOverride>({});
  const [selected, setSelected] = useState<EmailEditorSelection>("document");
  const seeded = useRef(false);

  useEffect(() => {
    if (!seeded.current && settingsQuery.data) {
      seeded.current = true;
      setCopyDraft(compactEmailCopy(settingsQuery.data.copy));
      setThemeDraft(compactEmailTheme(settingsQuery.data.theme));
    }
  }, [settingsQuery.data]);

  const save = useMutation({
    mutationFn: async () => {
      if (!orgId) throw new Error("No active organization");
      await upsertOrgSetting(supabase, orgId, "email_copy", compactEmailCopy(copyDraft) as unknown as Json);
      await upsertOrgSetting(supabase, orgId, "email_theme", compactEmailTheme(themeDraft) as unknown as Json);
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["app-settings"] });
      toast.success("Email template saved");
    },
    onError: (error: Error) => toast.error(error.message),
  });

  const previewInput = useMemo(() => ({
    templateKey: template.templateKey,
    copyOverride: copyDraft,
    themeOverride: themeDraft,
    highlightRole: selected === "document" ? undefined : selected,
  }), [copyDraft, selected, template.templateKey, themeDraft]);

  if (settingsQuery.isLoading) return <Skeleton className="h-[80vh] w-full" />;
  if (settingsQuery.isError) {
    return (
      <Alert variant="destructive">
        <AlertDescription>
          Could not load the email template settings. {settingsQuery.error instanceof Error ? settingsQuery.error.message : "Please try again."}
        </AlertDescription>
      </Alert>
    );
  }

  return (
    <TemplateEditorShell
      title={template.label}
      breadcrumb={
        <Button asChild variant="ghost" size="sm">
          <Link to={ROUTES.SETTINGS}>Email templates</Link>
        </Button>
      }
      actions={
        <>
          <Button
            type="button"
            variant="outline"
            size="sm"
            disabled={readOnly}
            onClick={() => {
              setCopyDraft({});
              setThemeDraft({});
            }}
          >
            Reset all
          </Button>
          <Button type="button" size="sm" disabled={readOnly || save.isPending || !orgId} onClick={() => save.mutate()}>
            Save template
          </Button>
        </>
      }
      outline={
        <TemplateOutline<EmailEditorSelection, EmailCopyKey>
          document={{ key: "document", label: "Document" }}
          sections={EMAIL_EDITOR_SECTIONS}
          selected={selected}
          onSelect={setSelected}
          isModified={(key) => {
            if (key === "document") return hasOwnKeys(themeDraft.base);
            const role = key as EmailRoleKey;
            return hasOwnKeys(themeDraft.roles?.[role]) || emailCopyFieldsForRole(template, role).some((field) => copyDraft[field.key] !== undefined);
          }}
        />
      }
      preview={<EmailPreviewPane {...previewInput} />}
      inspector={
        <EmailTemplateInspector
          selected={selected}
          template={template}
          readOnly={readOnly}
          copyDraft={copyDraft}
          themeDraft={themeDraft}
          onCopyChange={setCopyDraft}
          onThemeChange={setThemeDraft}
        />
      }
    />
  );
}

export default function EmailTemplateEditorPage({ readOnly: readOnlyProp }: { readOnly?: boolean } = {}) {
  const { templateKey } = useParams<{ templateKey: string }>();
  const canEdit = useCan("edit_email_templates");
  const template = EMAIL_TEMPLATE_COPY_FIELDS.find((entry) => entry.templateKey === templateKey);

  if (!template) {
    return (
      <Alert variant="destructive">
        <AlertDescription>This email template cannot be edited.</AlertDescription>
      </Alert>
    );
  }

  return (
    <EmailTemplateEditorWorkspace
      key={template.templateKey}
      template={template}
      readOnly={readOnlyProp ?? !canEdit}
    />
  );
}
