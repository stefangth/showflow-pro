import { useEffect, useMemo, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import { toast } from "sonner";
import { ArrowLeft } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/features/auth/AuthContext";
import { useCan } from "@/hooks/useCapabilities";
import { resolveOrgSetting, upsertOrgSetting } from "@/data/settings";
import { invokeHireOrderAction } from "@/data/hireOrders";
import { openPdfBase64 } from "@/lib/hireOrders/openPdf";
import { ROUTES } from "@/config/app.config";
import {
  HIRE_ORDER_COPY_DEFAULTS,
  resolveHireOrderCopy,
  type HireOrderCopy,
} from "@/lib/hireOrders/pdf/pdfCopy";
import {
  resolveHireOrderTheme,
  type HireOrderThemeOverride,
  type RoleKey,
} from "@/lib/hireOrders/pdf/pdfTheme";
import { sampleRenderInput } from "@/lib/hireOrders/pdf/sampleDocument";
import { resolveTermsClauses } from "@/lib/hireOrders/terms";
import { useHireOrderTerms } from "@/hooks/useHireOrders";
import { LETTERHEAD_DEFAULT } from "../defaults";
import type { Letterhead } from "../LetterheadCard";
import type { Json } from "@/integrations/supabase/types";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { compactCopyMap, compactThemeMap } from "../../templateEditor/overrideMap";
import { TemplateEditorShell } from "../../templateEditor/TemplateEditorShell";
import { TemplateOutline } from "./TemplateOutline";
import { TemplateInspector } from "./TemplateInspector";
import { TemplateDocumentPane } from "./TemplateDocumentPane";

const COPY_DEFAULT: Partial<HireOrderCopy> = {};
const THEME_DEFAULT: HireOrderThemeOverride = {};

/** Keep only copy values that are non-empty AND differ from the default: the
 *  stored setting is a compact override map, never the full dictionary. An
 *  untouched field is simply absent, never sent as an explicit override (see
 *  the theme_override note below — the same rule applies to copy). */
function compactCopy(form: Partial<HireOrderCopy>): Partial<HireOrderCopy> {
  return compactCopyMap(form, HIRE_ORDER_COPY_DEFAULTS) as Partial<HireOrderCopy>;
}

function compactTheme(draft: HireOrderThemeOverride): HireOrderThemeOverride {
  return compactThemeMap(draft);
}

/**
 * The PDF template editor: a three-pane workspace (document outline, live
 * preview, element inspector) over the org's `hire_order_copy` and
 * `hire_order_theme` settings. Owns both settings queries, the draft override
 * state for each, the selected role, and the combined save mutation; the
 * three panes themselves are thin, stateless views driven by this page's
 * state (their substance lands in later tasks — see TemplateOutline /
 * TemplateDocumentPane / TemplateInspector).
 *
 * `readOnly` is normally derived from the `edit_hire_order_settings`
 * capability, but can be forced by a caller/test via the `readOnly` prop.
 */
export default function TemplateEditorPage({ readOnly: readOnlyProp }: { readOnly?: boolean } = {}) {
  const { currentOrg } = useAuth();
  const orgId = currentOrg?.id ?? null;
  const canEdit = useCan("edit_hire_order_settings");
  const readOnly = readOnlyProp ?? !canEdit;
  const qc = useQueryClient();

  const copyQuery = useQuery({
    queryKey: ["app-settings", "hire_order_copy", orgId],
    queryFn: () => resolveOrgSetting<Partial<HireOrderCopy>>(supabase, orgId, "hire_order_copy", COPY_DEFAULT),
    enabled: Boolean(orgId),
  });
  const themeQuery = useQuery({
    queryKey: ["app-settings", "hire_order_theme", orgId],
    queryFn: () => resolveOrgSetting<HireOrderThemeOverride>(supabase, orgId, "hire_order_theme", THEME_DEFAULT),
    enabled: Boolean(orgId),
  });
  // The preview must show the org's OWN letterhead and terms: `legalName`,
  // `partyLine`, `clauseTitle` and `clauseBody` are editable roles, and
  // styling an invented fixture the org will never see is no styling at all.
  // Both share their query key with LetterheadCard / TermsVariantsCard, so
  // saving either card updates this preview without a refetch of its own.
  // Neither read blocks the editor: a failure here degrades to the sample
  // fixtures (see sampleLetterhead / sampleTerms), it does not hide the
  // copy/theme the page exists to edit.
  const letterheadQuery = useQuery({
    queryKey: ["app-settings", "hire_order_letterhead", orgId],
    queryFn: () => resolveOrgSetting<Letterhead>(supabase, orgId, "hire_order_letterhead", LETTERHEAD_DEFAULT),
    enabled: Boolean(orgId),
  });
  // useHireOrderTerms rather than a hand-rolled query: it already owns this
  // exact key and projection, and two queryFns on one key that resolve
  // different defaults would make whichever ran first win the cache.
  const termsQuery = useHireOrderTerms(orgId);

  // Draft overrides. Seeded once when server data first arrives (same
  // seeded-ref pattern as PdfCopyCard); a later unrelated refetch must not
  // clobber in-progress edits.
  const [copyDraft, setCopyDraft] = useState<Partial<HireOrderCopy>>({});
  const [themeDraft, setThemeDraft] = useState<HireOrderThemeOverride>({});
  const [selected, setSelected] = useState<RoleKey | "document">("document");
  const seeded = useRef(false);
  useEffect(() => {
    if (!seeded.current && copyQuery.data && themeQuery.data) {
      seeded.current = true;
      setCopyDraft(copyQuery.data);
      setThemeDraft(themeQuery.data);
    }
  }, [copyQuery.data, themeQuery.data]);

  const copy = useMemo(() => resolveHireOrderCopy(copyDraft), [copyDraft]);
  const theme = useMemo(() => resolveHireOrderTheme(themeDraft), [themeDraft]);
  // The org's default terms template, which is what an order with no explicit
  // variant renders (the same `resolveTermsClauses(setting, null)` the server
  // applies to the sample order).
  const termsClauses = useMemo(
    () => (termsQuery.data ? resolveTermsClauses(termsQuery.data, null) : null),
    [termsQuery.data],
  );
  const renderInput = useMemo(
    () =>
      sampleRenderInput({
        copy,
        theme,
        highlightRole: selected === "document" ? undefined : selected,
        letterhead: letterheadQuery.data ?? null,
        terms: termsClauses,
      }),
    [copy, theme, selected, letterheadQuery.data, termsClauses],
  );

  const save = useMutation({
    mutationFn: async () => {
      if (!orgId) throw new Error("No active organization");
      await upsertOrgSetting(supabase, orgId, "hire_order_copy", compactCopy(copyDraft) as unknown as Json);
      await upsertOrgSetting(supabase, orgId, "hire_order_theme", compactTheme(themeDraft) as unknown as Json);
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["app-settings"] });
      toast.success("PDF template saved");
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const exact = useMutation({
    mutationFn: () =>
      invokeHireOrderAction(supabase, {
        action: "preview",
        org_id: orgId,
        copy_override: compactCopy(copyDraft),
        // Compacted like the copy beside it: the server layers this over the
        // org's stored theme, so an uncompacted hollow role would send a
        // different payload than Save persists for the same on-screen state.
        theme_override: compactTheme(themeDraft),
      }),
    onSuccess: (res) => {
      const b64 = (res as { pdf_base64?: string } | null)?.pdf_base64;
      if (b64) openPdfBase64(b64);
    },
    onError: (e: Error) => toast.error(e.message),
  });

  // Letterhead and terms join the loading gate so the first paint is not the
  // sample fixtures visibly swapping to the org's own text a moment later.
  // They deliberately do NOT join the error gate below: if only they fail the
  // editor still does its job against the fixtures, whereas a failed copy or
  // theme read would show defaults as if they were the org's saved values.
  if (copyQuery.isLoading || themeQuery.isLoading || letterheadQuery.isLoading || termsQuery.isLoading) {
    return <Skeleton className="h-[80vh] w-full" />;
  }
  // A failed read must not fall through to the defaults: the editor would show
  // them as if they were the org's values, and a Save from there would
  // overwrite real stored copy/theme.
  if (copyQuery.isError || themeQuery.isError) {
    return (
      <Alert variant="destructive">
        <AlertDescription>
          Could not load the PDF template settings.{" "}
          {((copyQuery.error ?? themeQuery.error) as Error)?.message}
        </AlertDescription>
      </Alert>
    );
  }

  return (
    <TemplateEditorShell
      title="PDF template"
      breadcrumb={
        <Button asChild variant="ghost" size="sm">
          <Link to={ROUTES.SETTINGS}><ArrowLeft className="mr-1 h-4 w-4" />Settings</Link>
        </Button>
      }
      actions={
        <>
          <Button variant="outline" size="sm" onClick={() => exact.mutate()} disabled={exact.isPending || !orgId}>
            Open exact PDF
          </Button>
          <Button variant="outline" size="sm" disabled={readOnly} onClick={() => { setCopyDraft({}); setThemeDraft({}); }}>
            Reset all
          </Button>
          <Button size="sm" onClick={() => save.mutate()} disabled={readOnly || save.isPending || !orgId}>
            Save template
          </Button>
        </>
      }
      outline={<TemplateOutline selected={selected} onSelect={setSelected} copyDraft={copyDraft} themeDraft={themeDraft} />}
      preview={<TemplateDocumentPane input={renderInput} />}
      inspector={
        <TemplateInspector
          selected={selected}
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
