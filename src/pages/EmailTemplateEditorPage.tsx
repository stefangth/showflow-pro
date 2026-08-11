import { useMemo, useState } from "react";
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
import { useDerivedDraft } from "@/hooks/useDerivedDraft";
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
  orgId: string | null;
  readOnly: boolean;
}

const EMPTY_COPY: Partial<Record<EmailCopyKey, string>> = {};
const EMPTY_THEME: EmailThemeOverride = {};

function EmailTemplateEditorWorkspace({ template, orgId, readOnly }: WorkspaceProps) {
  const queryClient = useQueryClient();
  const settingsQuery = useQuery({
    queryKey: ["app-settings", "email-templates", orgId],
    queryFn: () => fetchEmailTemplateSettings(supabase, orgId),
    enabled: Boolean(orgId),
  });
  // Memoized because EmailPreviewPane re-runs its debounced render on override
  // IDENTITY: a fresh compaction per render would re-fetch the preview forever.
  const storedCopy = useMemo(
    () => (settingsQuery.data ? compactEmailCopy(settingsQuery.data.copy) : undefined),
    [settingsQuery.data],
  );
  const storedTheme = useMemo(
    () => (settingsQuery.data ? compactEmailTheme(settingsQuery.data.theme) : undefined),
    [settingsQuery.data],
  );
  // Drafts as a VIEW of the stored settings rather than a copy of them. Seeding a
  // copy into state through an effect left a window — one commit wide, between the
  // loading gate opening and the effect running — where the editor was fully
  // interactive but both drafts were still `{}`. Save persists them verbatim, and
  // `copyDraft` is the ORG-WIDE email_copy map, so a click landing in that window
  // wiped EVERY template's copy, not just this one's. See useDerivedDraft.
  const [copyDraft, setCopyDraft] = useDerivedDraft<Partial<Record<EmailCopyKey, string>>>(storedCopy, EMPTY_COPY);
  const [themeDraft, setThemeDraft] = useDerivedDraft<EmailThemeOverride>(storedTheme, EMPTY_THEME);
  const [selected, setSelected] = useState<EmailEditorSelection>("document");
  // Which declared preview variant renders (org-invitation's four role action lines).
  // Index 0 is the template's own sample data, so templates without variants and the
  // default state both render exactly what they always did.
  const [variantIdx, setVariantIdx] = useState(0);
  const variants = template.previewVariants;
  const activeVariant = variants?.[variantIdx] ?? variants?.[0];

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
    // `data` identities are stable (module-level meta), so this only re-renders the
    // preview when the SELECTION changes, not on every render.
    dataOverride: activeVariant?.data,
  }), [activeVariant, copyDraft, selected, template.templateKey, themeDraft]);

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
              // copyDraft is the org-wide email_copy map, so clearing it
              // wholesale would wipe every other template's copy. Reset only this
              // template's copy keys, plus the shared theme this editor also edits.
              setCopyDraft((prev) => {
                const next = { ...prev };
                for (const field of template.fields) delete next[field.key];
                return next;
              });
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
      preview={
        variants ? (
          <div className="flex h-full flex-col">
            <div role="group" aria-label="Preview as" className="flex flex-wrap items-center gap-1 border-b border-border bg-background px-3 py-2">
              <span className="mr-1 text-xs text-muted-foreground">Preview as</span>
              {variants.map((variant, index) => (
                <Button
                  key={variant.label}
                  type="button"
                  size="sm"
                  variant={index === variantIdx ? "secondary" : "ghost"}
                  aria-pressed={index === variantIdx}
                  onClick={() => setVariantIdx(index)}
                >
                  {variant.label}
                </Button>
              ))}
            </div>
            <div className="min-h-0 flex-1">
              <EmailPreviewPane {...previewInput} />
            </div>
          </div>
        ) : (
          <EmailPreviewPane {...previewInput} />
        )
      }
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
  const { currentOrg } = useAuth();
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
    // Keyed by template AND org. Switching orgs in the sidebar re-keys the
    // settings query but does NOT unmount this page, and an edit belongs to the
    // org it was made in: without the org in the key, the previous org's unsaved
    // draft would sit over the new org's settings and Save would write it there.
    <EmailTemplateEditorWorkspace
      key={`${template.templateKey}:${currentOrg?.id ?? "no-org"}`}
      template={template}
      orgId={currentOrg?.id ?? null}
      readOnly={readOnlyProp ?? !canEdit}
    />
  );
}
