import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link, useParams } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { EmailPreviewPane } from "@/components/settings/emailTemplates/EmailPreviewPane";
import { useFeature } from "@/hooks/useEntitlements";
import { useOrgKind } from "@/hooks/useOrgKind";
import { ORG_KINDS, ORG_KIND_LABELS, type OrgKind } from "@/lib/orgKind";
import { SUPPORTED_LANGUAGES, LANGUAGE_LABELS } from "@/i18n/config";
import type { ServerLocale } from "@/lib/i18n/orgLanguage";
import {
  EmailTemplateInspector,
} from "@/components/settings/emailTemplates/EmailTemplateInspector";
import {
  buildEmailEditorSections,
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
  const { t, i18n } = useTranslation("settingsEmailTemplates");
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
  // Preview language toggle (admin QA), gated by the language_packages entitlement.
  // The preview endpoint itself is not gated, so an admin can preview German before
  // turning the workspace language on.
  const languagePacksEnabled = useFeature("language_packages");
  const [previewLocale, setPreviewLocale] = useState<ServerLocale>("en");
  // Workspace-type preview toggle (admin QA): defaults to the org's kind so the preview
  // matches what a real send produces, but lets an admin see the other vocabulary without
  // switching the org. Not entitlement-gated (workspace type is not a paid module).
  const orgKind = useOrgKind();
  const [previewKind, setPreviewKind] = useState<OrgKind>(orgKind);
  const kindLang: "en" | "de" = i18n.language.startsWith("de") ? "de" : "en";

  const save = useMutation({
    mutationFn: async () => {
      if (!orgId) throw new Error(t("emailTemplateEditorPage.noActiveOrg"));
      await upsertOrgSetting(supabase, orgId, "email_copy", compactEmailCopy(copyDraft) as unknown as Json);
      await upsertOrgSetting(supabase, orgId, "email_theme", compactEmailTheme(themeDraft) as unknown as Json);
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["app-settings"] });
      toast.success(t("emailTemplateEditorPage.saveSuccess"));
    },
    onError: (error: Error) => toast.error(error.message),
  });

  // Translated once per language change, not per render (EMAIL_EDITOR_SECTIONS used to be
  // a static English constant; now it must be rebuilt whenever `t` resolves a new language).
  // `i18n.language` forces this to recompute on every real language change.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const editorSections = useMemo(() => buildEmailEditorSections(t), [t, i18n.language]);

  const previewInput = useMemo(() => ({
    templateKey: template.templateKey,
    copyOverride: copyDraft,
    themeOverride: themeDraft,
    highlightRole: selected === "document" ? undefined : selected,
    // `data` identities are stable (module-level meta), so this only re-renders the
    // preview when the SELECTION changes, not on every render.
    dataOverride: activeVariant?.data,
    locale: previewLocale,
    kind: previewKind,
  }), [activeVariant, copyDraft, previewKind, previewLocale, selected, template.templateKey, themeDraft]);

  if (settingsQuery.isLoading) return <Skeleton className="h-[80vh] w-full" />;
  if (settingsQuery.isError) {
    return (
      <Alert variant="destructive">
        <AlertDescription>
          {t("emailTemplateEditorPage.loadError", {
            message: settingsQuery.error instanceof Error ? settingsQuery.error.message : t("emailTemplateEditorPage.loadErrorFallback"),
          })}
        </AlertDescription>
      </Alert>
    );
  }

  return (
    <TemplateEditorShell
      title={template.label}
      breadcrumb={
        <Link to={ROUTES.SETTINGS} className="text-control font-medium text-accent-text hover:underline">
          {t("emailTemplateEditorPage.breadcrumb")}
        </Link>
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
            {t("emailTemplateEditorPage.resetAll")}
          </Button>
          <Button type="button" size="sm" disabled={readOnly || save.isPending || !orgId} onClick={() => save.mutate()}>
            {t("emailTemplateEditorPage.saveTemplate")}
          </Button>
        </>
      }
      outline={
        <TemplateOutline<EmailEditorSelection, EmailCopyKey>
          document={{ key: "document", label: t("emailTemplateEditorPage.documentLabel") }}
          sections={editorSections}
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
        variants || languagePacksEnabled ? (
          <div className="flex h-full flex-col">
            <div className="flex flex-wrap items-center gap-1 border-b border-border bg-background px-3 py-2">
              {variants && (
                <div role="group" aria-label={t("emailTemplateEditorPage.previewAsGroup")} className="flex flex-wrap items-center gap-1">
                  <span className="mr-1 text-xs text-muted-foreground">{t("emailTemplateEditorPage.previewAsLabel")}</span>
                  {variants.map((variant, index) => (
                    <Button
                      key={variant.label}
                      type="button"
                      size="sm"
                      variant={index === variantIdx ? "secondary" : "outline"}
                      aria-pressed={index === variantIdx}
                      onClick={() => setVariantIdx(index)}
                    >
                      {variant.label}
                    </Button>
                  ))}
                </div>
              )}
              <div role="group" aria-label={t("emailTemplateEditorPage.previewKindGroup")} className="ml-auto flex items-center gap-1">
                <span className="mr-1 text-xs text-muted-foreground">{t("emailTemplateEditorPage.previewKindLabel")}</span>
                {ORG_KINDS.map((code) => (
                  <Button
                    key={code}
                    type="button"
                    size="sm"
                    variant={code === previewKind ? "secondary" : "outline"}
                    aria-pressed={code === previewKind}
                    onClick={() => setPreviewKind(code)}
                  >
                    {ORG_KIND_LABELS[code][kindLang].title}
                  </Button>
                ))}
              </div>
              {languagePacksEnabled && (
                <div role="group" aria-label={t("emailTemplateEditorPage.previewLanguageGroup")} className="flex items-center gap-1">
                  <span className="mr-1 text-xs text-muted-foreground">{t("emailTemplateEditorPage.previewLanguageLabel")}</span>
                  {SUPPORTED_LANGUAGES.map((code) => (
                    <Button
                      key={code}
                      type="button"
                      size="sm"
                      variant={code === previewLocale ? "secondary" : "outline"}
                      aria-pressed={code === previewLocale}
                      onClick={() => setPreviewLocale(code)}
                    >
                      {LANGUAGE_LABELS[code]}
                    </Button>
                  ))}
                </div>
              )}
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
  const { t } = useTranslation("settingsEmailTemplates");
  const { templateKey } = useParams<{ templateKey: string }>();
  const { currentOrg } = useAuth();
  const canEdit = useCan("edit_email_templates");
  const template = EMAIL_TEMPLATE_COPY_FIELDS.find((entry) => entry.templateKey === templateKey);

  if (!template) {
    return (
      <Alert variant="destructive">
        <AlertDescription>{t("emailTemplateEditorPage.cannotEdit")}</AlertDescription>
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
