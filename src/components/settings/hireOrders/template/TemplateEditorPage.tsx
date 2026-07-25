import { useMemo, useRef, useState } from "react";
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
  type CopyKey,
  type HireOrderCopy,
} from "@/lib/hireOrders/pdf/pdfCopy";
import {
  resolveHireOrderTheme,
  type HireOrderThemeOverride,
  type RoleKey,
} from "@/lib/hireOrders/pdf/pdfTheme";
import type { Json } from "@/integrations/supabase/types";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { ResizableHandle, ResizablePanel, ResizablePanelGroup } from "@/components/ui/resizable";
import { TemplateOutline } from "./TemplateOutline";
import { TemplateInspector } from "./TemplateInspector";
import { TemplateDocumentPane } from "./TemplateDocumentPane";
import { sampleRenderInput } from "./sampleDocument";

const COPY_DEFAULT: Partial<HireOrderCopy> = {};
const THEME_DEFAULT: HireOrderThemeOverride = {};

/** Keep only copy values that are non-empty AND differ from the default: the
 *  stored setting is a compact override map, never the full dictionary. An
 *  untouched field is simply absent, never sent as an explicit override (see
 *  the theme_override note below — the same rule applies to copy). */
function compactCopy(form: Partial<HireOrderCopy>): Partial<HireOrderCopy> {
  const out: Partial<HireOrderCopy> = {};
  for (const key of Object.keys(HIRE_ORDER_COPY_DEFAULTS) as CopyKey[]) {
    const v = form[key];
    if (typeof v === "string" && v.trim() !== "" && v !== HIRE_ORDER_COPY_DEFAULTS[key]) {
      out[key] = v;
    }
  }
  return out;
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

  // Draft overrides. Seeded once when server data first arrives; a later
  // unrelated refetch must not clobber in-progress edits.
  const [copyDraft, setCopyDraft] = useState<Partial<HireOrderCopy>>({});
  const [themeDraft, setThemeDraft] = useState<HireOrderThemeOverride>({});
  const [selected, setSelected] = useState<RoleKey | "document">("document");
  const seeded = useRef(false);
  if (!seeded.current && copyQuery.data && themeQuery.data) {
    seeded.current = true;
    setCopyDraft(copyQuery.data);
    setThemeDraft(themeQuery.data);
  }

  const copy = useMemo(() => resolveHireOrderCopy(copyDraft), [copyDraft]);
  const theme = useMemo(() => resolveHireOrderTheme(themeDraft), [themeDraft]);
  const renderInput = useMemo(
    () => sampleRenderInput(copy, theme, selected === "document" ? undefined : selected),
    [copy, theme, selected],
  );

  const save = useMutation({
    mutationFn: async () => {
      if (!orgId) throw new Error("No active organization");
      await upsertOrgSetting(supabase, orgId, "hire_order_copy", compactCopy(copyDraft) as unknown as Json);
      await upsertOrgSetting(supabase, orgId, "hire_order_theme", themeDraft as unknown as Json);
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
        theme_override: themeDraft,
      }),
    onSuccess: (res) => {
      const b64 = (res as { pdf_base64?: string } | null)?.pdf_base64;
      if (b64) openPdfBase64(b64);
    },
    onError: (e: Error) => toast.error(e.message),
  });

  if (copyQuery.isLoading || themeQuery.isLoading) return <Skeleton className="h-[80vh] w-full" />;
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
    <div className="flex h-[calc(100vh-8rem)] flex-col gap-3">
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <Button asChild variant="ghost" size="sm">
            <Link to={ROUTES.SETTINGS}><ArrowLeft className="mr-1 h-4 w-4" />Settings</Link>
          </Button>
          <h1 className="font-display text-lg">PDF template</h1>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="outline" size="sm" onClick={() => exact.mutate()} disabled={exact.isPending || !orgId}>
            Open exact PDF
          </Button>
          <Button
            variant="outline"
            size="sm"
            disabled={readOnly}
            onClick={() => { setCopyDraft({}); setThemeDraft({}); }}
          >
            Reset all
          </Button>
          <Button size="sm" onClick={() => save.mutate()} disabled={readOnly || save.isPending || !orgId}>
            Save template
          </Button>
        </div>
      </div>

      <ResizablePanelGroup direction="horizontal" className="flex-1 rounded-lg border">
        <ResizablePanel defaultSize={22} minSize={16}>
          <TemplateOutline
            selected={selected}
            onSelect={setSelected}
            copyDraft={copyDraft}
            themeDraft={themeDraft}
          />
        </ResizablePanel>
        <ResizableHandle withHandle />
        <ResizablePanel defaultSize={50} minSize={30}>
          <TemplateDocumentPane input={renderInput} />
        </ResizablePanel>
        <ResizableHandle withHandle />
        <ResizablePanel defaultSize={28} minSize={20}>
          <TemplateInspector
            selected={selected}
            readOnly={readOnly}
            copyDraft={copyDraft}
            themeDraft={themeDraft}
            onCopyChange={setCopyDraft}
            onThemeChange={setThemeDraft}
          />
        </ResizablePanel>
      </ResizablePanelGroup>
    </div>
  );
}
