import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { toast } from "sonner";
import { ArrowLeft, RefreshCw } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/features/auth/AuthContext";
import {
  useHireOrder, useHireOrderAction, useUpdateHireOrderDraft, useHireOrderTerms, ISSUE_FAILURE_COPY,
} from "@/hooks/useHireOrders";
import { fetchShowflowLayerForOrder, type UpdateHireOrderDraftPatch } from "@/data/hireOrders";
import { resolveOrgSetting } from "@/data/settings";
import { type Letterhead } from "@/components/settings/hireOrders/LetterheadCard";
import { LETTERHEAD_DEFAULT } from "@/components/settings/hireOrders/defaults";
import { createSingleFlightRunner } from "@/lib/singleFlight";
import { resolveFields } from "@/lib/hireOrders/resolveFields";
import { orderReadyIssues } from "@/lib/hireOrders/validate";
import { formatMoney } from "@/lib/hireOrders/money";
import { defaultTemplateId } from "@/lib/hireOrders/terms";
import { ORDER_FIELD_KEYS, type EditableOrderFieldKey, type OrderData } from "@/lib/hireOrders/types";
import { ROUTES, HIRE_ORDER_DEFAULT_TERMS } from "@/config/app.config";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { HireOrderStatusBadge } from "@/components/hireOrders/HireOrderStatusBadge";
import { FieldSection } from "@/components/hireOrders/edit/FieldSection";

/** Kept in sync with CURRENCY_SYMBOLS in money.ts / CURRENCIES in NewOrderWizard.tsx. */
const CURRENCIES = ["EUR", "USD", "CHF"];

const FIELD_LABELS: Record<EditableOrderFieldKey, string> = {
  artist_name: "Artist name",
  recipient_email: "Recipient email",
  role: "Role",
  cast: "Cast",
  date: "Date",
  venue: "Venue",
  city: "City",
  duration_min: "Duration (minutes)",
  sessions: "Sessions",
  fee: "Engagement fee",
  currency: "Currency",
  notes: "Notes",
};

/** Read a resolved field as an editable string. Arrays (e.g. showflow-sourced
 *  `sessions`) are joined with " · " for the text input; typing a new value
 *  back in always stores a plain string (resolveFields doesn't care about the
 *  type, only presence, and every downstream consumer stringifies anyway). */
function fieldString(data: OrderData, key: EditableOrderFieldKey): string {
  const v = data[key]?.value;
  if (v === undefined || v === null) return "";
  if (Array.isArray(v)) return (v as unknown[]).join(" · ");
  return String(v);
}

/** Split a resolved OrderData snapshot back into per-source layers so it can
 *  be re-run through `resolveFields`. The stored `data` column only carries
 *  the WINNING {value, source} per field, not the full layer history, so this
 *  is an approximation: each field's value is placed back into the bucket
 *  matching its last-known source. That reproduces the original resolution
 *  exactly when nothing has changed, and correctly re-tags a field as
 *  `manual` the moment it's overlaid with a session edit (see `manualLayer`
 *  in the component below). */
interface SplitLayers {
  showflow: Partial<Record<EditableOrderFieldKey, unknown>>;
  sheet: Partial<Record<EditableOrderFieldKey, unknown>>;
  manual: Partial<Record<EditableOrderFieldKey, unknown>>;
  defaults: Partial<Record<EditableOrderFieldKey, unknown>>;
  engagement_dates?: OrderData["engagement_dates"];
}

function splitLayers(data: OrderData): SplitLayers {
  const showflow: Partial<Record<EditableOrderFieldKey, unknown>> = {};
  const sheet: Partial<Record<EditableOrderFieldKey, unknown>> = {};
  const manual: Partial<Record<EditableOrderFieldKey, unknown>> = {};
  const defaults: Partial<Record<EditableOrderFieldKey, unknown>> = {};
  for (const key of ORDER_FIELD_KEYS) {
    const field = data[key];
    if (!field) continue;
    const bucket =
      field.source === "showflow" ? showflow : field.source === "sheet" ? sheet : field.source === "manual" ? manual : defaults;
    bucket[key] = field.value;
  }
  return { showflow, sheet, manual, defaults, engagement_dates: data.engagement_dates };
}

const READ_ONLY_STATUSES = new Set(["issued", "countersigned", "void"]);

/**
 * `resolveFields` treats `""` as "layer absent" and falls through to the
 * next layer (sheet -> showflow -> default) — correct for an untouched
 * field, but wrong for a field the user explicitly blanked: that must stay
 * empty, not revert to a lower-precedence fallback. `clearedFields` tracks
 * which keys were explicitly blanked this edit session; this helper
 * re-applies the empty manual value AFTER resolveFields has already (wrongly,
 * for these keys) fallen through, for both the on-screen snapshot and the
 * patch sent to `updateHireOrderDraft`. Does not touch the shared
 * `resolveFields` itself — that module is dual-homed with the edge function.
 */
function applyClearedOverrides(data: OrderData, cleared: Set<EditableOrderFieldKey>): OrderData {
  if (cleared.size === 0) return data;
  const out: OrderData = { ...data };
  for (const key of cleared) {
    out[key] = { value: "", source: "manual" };
  }
  return out;
}

/**
 * V2 split builder: draft editor at `/hire-orders/:id/edit` with a live PDF
 * preview and per-field provenance chips. Left column = four numbered
 * sections (Parties, Engagement, Fees and payment, Terms detail) built from
 * `FieldSection` rows; right column = the live document preview.
 *
 * Only draft/ready orders are editable — issued/countersigned/void orders
 * render a read-only notice instead (the DB freeze trigger is the real
 * backstop; this is only the UX guard).
 */
export default function HireOrderEditPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { currentOrg } = useAuth();
  const orgId = currentOrg?.id ?? "";

  const { data: order, isLoading, isError, error } = useHireOrder(id);
  const action = useHireOrderAction();
  const updateDraft = useUpdateHireOrderDraft();

  const letterheadQuery = useQuery({
    queryKey: ["app-settings", "hire_order_letterhead", orgId],
    queryFn: () => resolveOrgSetting<Letterhead>(supabase, orgId, "hire_order_letterhead", LETTERHEAD_DEFAULT),
    enabled: !!orgId,
  });

  // Org terms templates — reuses the same query key as TermsVariantsCard so the
  // cache is shared. Falls back to the shared seed defaults while loading/errored.
  const termsQuery = useHireOrderTerms(orgId);
  const terms = termsQuery.data ?? HIRE_ORDER_DEFAULT_TERMS;

  const [resolvedData, setResolvedData] = useState<OrderData | null>(null);
  const [sessionEdits, setSessionEdits] = useState<Partial<Record<EditableOrderFieldKey, unknown>>>({});
  // Fields the user explicitly blanked (typed "" into). Persists across a
  // Save (unlike sessionEdits, which resets) so a saved-then-reloaded empty
  // field doesn't silently revert the next time displayData is derived —
  // see applyClearedOverrides above.
  const [clearedFields, setClearedFields] = useState<Set<EditableOrderFieldKey>>(new Set());
  const [dirty, setDirty] = useState(false);
  const [termsVariant, setTermsVariant] = useState("");
  const [previewSrc, setPreviewSrc] = useState<string | null>(null);

  const isReadOnly = !!order && READ_ONLY_STATUSES.has(order.status);

  // Seed the editable snapshot once, from the order that just loaded. A later
  // background refetch (e.g. the debounced preview's own persist) must not
  // clobber in-progress edits — same convention as LetterheadCard.
  const seededRef = useRef(false);
  useEffect(() => {
    if (order && !seededRef.current) {
      seededRef.current = true;
      const data = (order.data ?? {}) as OrderData;
      setResolvedData(data);
      setTermsVariant(order.terms_variant || defaultTemplateId(terms) || "");
      // A field previously saved as an explicit empty manual value is the
      // durable, on-the-record marker for "the user cleared this" — restore
      // clearedFields from it so a reload doesn't let the field silently
      // revert to its showflow/sheet/default fallback.
      const initiallyCleared = new Set<EditableOrderFieldKey>();
      for (const key of ORDER_FIELD_KEYS) {
        const field = data[key];
        if (field && field.source === "manual" && field.value === "") initiallyCleared.add(key);
      }
      if (initiallyCleared.size > 0) setClearedFields(initiallyCleared);
    }
    // `terms` is read only for its effective-default fallback on the very first
    // seed (guarded by seededRef, so a later terms refetch never re-runs this
    // block) -- the dedicated re-seed effect below corrects the selection once
    // the REAL terms setting resolves for an order with no stored variant.
  }, [order, terms]);

  // The seed above may have used the HIRE_ORDER_DEFAULT_TERMS fallback (id
  // "standard") for `termsVariant` because the org's real terms setting was
  // still loading when `order` first arrived. If the order has NO stored
  // terms_variant, re-seed once the real setting resolves, to the org's
  // ACTUAL default -- mirrors GenerateHireOrderDialog's one-time-seed pattern.
  // An order that already has an explicit stored id is NEVER touched here
  // (even if that id happens to be "standard"), so a genuinely-removed
  // reference still shows as removed.
  const variantTouchedRef = useRef(false);
  const variantSeededRef = useRef(false);
  useEffect(() => {
    if (!order || order.terms_variant || variantTouchedRef.current || variantSeededRef.current) return;
    if (!termsQuery.data) return;
    variantSeededRef.current = true;
    setTermsVariant(defaultTemplateId(termsQuery.data) ?? "");
  }, [order, termsQuery.data]);

  const baseLayers = useMemo(() => splitLayers(resolvedData ?? {}), [resolvedData]);
  const manualLayer = useMemo(
    () => ({ ...baseLayers.manual, ...sessionEdits }),
    [baseLayers.manual, sessionEdits],
  );
  const displayData = useMemo(() => {
    const editable = resolveFields({
      showflow: baseLayers.showflow, sheet: baseLayers.sheet, manual: manualLayer, defaults: baseLayers.defaults,
    });
    const rebuilt: OrderData = { ...editable };
    if (baseLayers.engagement_dates) rebuilt.engagement_dates = baseLayers.engagement_dates;
    return applyClearedOverrides(rebuilt, clearedFields);
  }, [baseLayers, manualLayer, clearedFields]);

  /** Fold the given snapshot in as the new baseline: session edits are already
   *  reflected in its per-field sources, so they can be cleared. `markDirty`
   *  stays true after a Refresh (the refreshed snapshot hasn't hit the DB yet)
   *  and false after a Save (it just did). */
  function commit(next: OrderData, markDirty = false) {
    setResolvedData(next);
    setSessionEdits({});
    setDirty(markDirty);
  }

  function buildPatch(): UpdateHireOrderDraftPatch {
    const feeRaw = displayData.fee?.value;
    const feeAmount = feeRaw === undefined || feeRaw === null || feeRaw === "" ? null : Number(feeRaw as string | number);
    const currency = (displayData.currency?.value as string) || order?.fee_currency || "EUR";
    return { data: displayData, fee_amount: feeAmount, fee_currency: currency, terms_variant: termsVariant };
  }

  function handleFieldChange(key: EditableOrderFieldKey, raw: string) {
    setSessionEdits((prev) => ({ ...prev, [key]: raw }));
    setClearedFields((prev) => {
      const isCleared = raw === "";
      if (isCleared === prev.has(key)) return prev;
      const next = new Set(prev);
      if (isCleared) next.add(key);
      else next.delete(key);
      return next;
    });
    setDirty(true);
  }

  function handleTermsVariant(next: string) {
    variantTouchedRef.current = true;
    setTermsVariant(next);
    setDirty(true);
  }

  // Live preview: the `preview` edge action always renders the STORED order
  // (it takes no body payload beyond the id), so reflecting an edit means
  // persisting it first, then re-requesting the preview — debounced 800ms so
  // a burst of keystrokes becomes one save + one preview, not one per key.
  // `dirty` gates the persist step so the mount cycle below (fired before
  // any edit, `dirty` still false) previews the stored order as-is instead
  // of writing it back unchanged.
  //
  // The cycle's own two awaits can easily outlast 800ms, so a second edit's
  // timer can fire while the first edit's cycle is still persisting/
  // previewing. `createSingleFlightRunner` (below) guarantees those two
  // cycles never run concurrently — see its docstring for why that's the
  // only way to guarantee write ordering here. `latestRef` carries whatever
  // the guarded cycle needs so a trailing rerun always reads the LATEST
  // state, not whatever the timer's closure captured when it fired.
  //
  // The initial mount preview (right below) is routed through this SAME
  // single-flight runner rather than firing its own independent fetch: two
  // uncoordinated preview fetches (mount + an edit that lands inside the
  // mount fetch's round trip) could otherwise resolve out of order and let
  // the stale mount preview overwrite a newer edit's preview in `previewSrc`.
  const latestRef = useRef({ order, orgId, isReadOnly, buildPatch, updateDraft, action, dirty });
  latestRef.current = { order, orgId, isReadOnly, buildPatch, updateDraft, action, dirty };

  const runPreviewCycleRef = useRef<(() => void) | null>(null);
  if (runPreviewCycleRef.current === null) {
    runPreviewCycleRef.current = createSingleFlightRunner(async () => {
      const {
        order: curOrder, orgId: curOrgId, isReadOnly: curReadOnly, buildPatch: curBuildPatch,
        updateDraft: curUpdateDraft, action: curAction, dirty: curDirty,
      } = latestRef.current;
      if (!curOrder || curReadOnly || !curOrgId) return;
      try {
        if (curDirty) {
          await curUpdateDraft.mutateAsync({ id: curOrder.id, patch: curBuildPatch() });
        }
        const res = await curAction.mutateAsync({ action: "preview", org_id: curOrgId, order_id: curOrder.id });
        const b64 = (res as { pdf_base64?: string } | null)?.pdf_base64;
        if (b64) setPreviewSrc(`data:application/pdf;base64,${b64}`);
      } catch {
        /* a transient debounce-preview failure shouldn't interrupt editing;
           the explicit Save draft / Issue actions surface their own toasts */
      }
    });
  }

  // Initial live-preview render: fetch the stored order's PDF once on load
  // (before any edits), so the right column never sits empty. Goes through
  // `runPreviewCycleRef` (not its own fetch) so it can never race a
  // debounced edit cycle — see the comment above.
  const mountPreviewRef = useRef(false);
  useEffect(() => {
    if (!order || isReadOnly || !orgId || mountPreviewRef.current) return;
    mountPreviewRef.current = true;
    runPreviewCycleRef.current?.();
  }, [order, isReadOnly, orgId]);

  useEffect(() => {
    if (!dirty || !order || isReadOnly || !orgId) return;
    const timer = setTimeout(() => {
      runPreviewCycleRef.current?.();
    }, 800);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sessionEdits, termsVariant, dirty]);

  async function handleSaveDraft() {
    if (!order) return;
    try {
      const patch = buildPatch();
      await updateDraft.mutateAsync({ id: order.id, patch });
      commit(displayData);
      toast.success("Draft saved");
    } catch {
      /* useUpdateHireOrderDraft already toasts the error */
    }
  }

  async function handleIssue() {
    if (!order || !orgId) return;
    try {
      if (dirty) {
        await updateDraft.mutateAsync({ id: order.id, patch: buildPatch() });
        commit(displayData);
      }
      const res = await action.mutateAsync({ action: "issue", org_id: orgId, order_ids: [order.id] });
      const issued = (res as { issued?: string[] } | null)?.issued ?? [];
      if (issued.includes(order.id)) navigate(ROUTES.HIRE_ORDER_DETAIL.replace(":id", order.id));
    } catch {
      /* useHireOrderAction already toasts the failure */
    }
  }

  const canRefresh = !!order && (!!order.show_date_id || !!order.artist_id);

  async function handleRefresh() {
    if (!order || !canRefresh) return;
    try {
      const preservedManual: Partial<Record<EditableOrderFieldKey, unknown>> = {};
      for (const key of ORDER_FIELD_KEYS) {
        if (displayData[key]?.source === "manual") preservedManual[key] = displayData[key]!.value;
      }
      const freshLayer = await fetchShowflowLayerForOrder(supabase, {
        showDateId: order.show_date_id, artistId: order.artist_id,
      });
      const editable = resolveFields({ showflow: freshLayer, manual: preservedManual, defaults: baseLayers.defaults });
      const refreshed: OrderData = { ...editable };
      if (baseLayers.engagement_dates) refreshed.engagement_dates = baseLayers.engagement_dates;
      commit(refreshed, true);
      toast.success("Refreshed from ShowFlow");
    } catch (e) {
      toast.error((e as Error).message || "Could not refresh from ShowFlow");
    }
  }

  if (isLoading) {
    return (
      <div className="mx-auto max-w-6xl space-y-6 p-4 sm:p-6">
        <Skeleton className="h-10 w-64" />
        <div className="grid grid-cols-1 gap-6 lg:grid-cols-[428px_1fr]">
          <Skeleton className="h-[600px] w-full" />
          <Skeleton className="h-[600px] w-full" />
        </div>
      </div>
    );
  }

  if (isError || !order) {
    return (
      <div className="mx-auto max-w-6xl p-4 sm:p-6">
        <Button variant="ghost" size="sm" className="mb-4 -ml-2" onClick={() => navigate(-1)}>
          <ArrowLeft className="mr-1 h-4 w-4" /> Back
        </Button>
        <Alert variant="destructive">
          <AlertTitle>Could not load this hire order</AlertTitle>
          <AlertDescription>
            {(error as Error)?.message ?? "You may not have access to this order, or it no longer exists."}
          </AlertDescription>
        </Alert>
      </div>
    );
  }

  if (isReadOnly) {
    return (
      <div className="mx-auto max-w-2xl space-y-4 p-4 sm:p-6">
        <Button variant="ghost" size="sm" className="-ml-2" onClick={() => navigate(-1)}>
          <ArrowLeft className="mr-1 h-4 w-4" /> Back
        </Button>
        <Alert>
          <AlertTitle>This hire order can no longer be edited</AlertTitle>
          <AlertDescription>
            <span className="font-mono">{order.order_no}</span> is {order.status} and is read-only. View it on the
            hire order page instead.
          </AlertDescription>
        </Alert>
        <Button onClick={() => navigate(ROUTES.HIRE_ORDER_DETAIL.replace(":id", order.id))}>View order</Button>
      </div>
    );
  }

  const letterhead = letterheadQuery.data ?? LETTERHEAD_DEFAULT;
  const readyIssues = orderReadyIssues(displayData, letterhead);
  // The stored terms_variant no longer matches any live template (its template
  // was deleted in Settings). Never silently drop or auto-correct the
  // selection -- show it as a disabled "removed" chip and require an explicit
  // pick before Issue is allowed.
  const variantIsLive = terms.templates.some((t) => t.id === termsVariant);
  const hasTermsTemplates = terms.templates.length > 0;
  const issueDisabled = readyIssues.length > 0 || action.isPending || !variantIsLive;
  const issueTitleParts = readyIssues.map((code) => ISSUE_FAILURE_COPY[code] ?? code);
  if (!variantIsLive) {
    issueTitleParts.push(hasTermsTemplates ? "Choose a terms template before issuing" : "No terms templates configured");
  }
  const issueTitle = issueTitleParts.length > 0 ? issueTitleParts.join(", ") : undefined;

  const currency = fieldString(displayData, "currency") || order.fee_currency || "EUR";
  const feeDisplay =
    displayData.fee?.value != null && displayData.fee.value !== ""
      ? formatMoney(displayData.fee.value as string | number, currency)
      : "Not set";

  return (
    <div className="mx-auto max-w-6xl space-y-6 p-4 sm:p-6">
      {/* Header */}
      <div className="flex flex-wrap items-center justify-between gap-4 border-b border-border pb-4">
        <div className="flex items-center gap-2 min-w-0">
          <Button variant="ghost" size="icon" onClick={() => navigate(-1)} aria-label="Go back">
            <ArrowLeft className="h-5 w-5" />
          </Button>
          <div className="min-w-0">
            <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Edit hire order</p>
            <div className="flex items-center gap-2">
              <h1 className="font-mono text-lg text-foreground">{order.order_no}</h1>
              <HireOrderStatusBadge status={order.status} />
            </div>
          </div>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          <Button variant="outline" onClick={handleSaveDraft} disabled={updateDraft.isPending}>
            Save draft
          </Button>
          <Button onClick={handleIssue} disabled={issueDisabled} title={issueTitle}>
            Issue and send
          </Button>
        </div>
      </div>

      {/* Split builder */}
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-[428px_1fr]">
        {/* LEFT: numbered field sections */}
        <div className="space-y-4">
          <Section index={1} title="Parties">
            <FieldSection fieldKey="artist_name" label={FIELD_LABELS.artist_name} source={displayData.artist_name?.source}>
              <Input
                id="ho-edit-artist_name"
                value={fieldString(displayData, "artist_name")}
                onChange={(e) => handleFieldChange("artist_name", e.target.value)}
              />
            </FieldSection>
            <FieldSection fieldKey="recipient_email" label={FIELD_LABELS.recipient_email} source={displayData.recipient_email?.source}>
              <Input
                id="ho-edit-recipient_email"
                type="email"
                value={fieldString(displayData, "recipient_email")}
                onChange={(e) => handleFieldChange("recipient_email", e.target.value)}
              />
            </FieldSection>
            <FieldSection fieldKey="role" label={FIELD_LABELS.role} source={displayData.role?.source}>
              <Input
                id="ho-edit-role"
                value={fieldString(displayData, "role")}
                onChange={(e) => handleFieldChange("role", e.target.value)}
              />
            </FieldSection>
            <FieldSection fieldKey="cast" label={FIELD_LABELS.cast} source={displayData.cast?.source}>
              <Input
                id="ho-edit-cast"
                value={fieldString(displayData, "cast")}
                onChange={(e) => handleFieldChange("cast", e.target.value)}
              />
            </FieldSection>
          </Section>

          <Section index={2} title="Engagement">
            <FieldSection fieldKey="date" label={FIELD_LABELS.date} source={displayData.date?.source}>
              <Input
                id="ho-edit-date"
                type="date"
                value={fieldString(displayData, "date")}
                onChange={(e) => handleFieldChange("date", e.target.value)}
              />
            </FieldSection>
            <FieldSection fieldKey="venue" label={FIELD_LABELS.venue} source={displayData.venue?.source}>
              <Input
                id="ho-edit-venue"
                value={fieldString(displayData, "venue")}
                onChange={(e) => handleFieldChange("venue", e.target.value)}
              />
            </FieldSection>
            <FieldSection fieldKey="city" label={FIELD_LABELS.city} source={displayData.city?.source}>
              <Input
                id="ho-edit-city"
                value={fieldString(displayData, "city")}
                onChange={(e) => handleFieldChange("city", e.target.value)}
              />
            </FieldSection>
            <FieldSection fieldKey="duration_min" label={FIELD_LABELS.duration_min} source={displayData.duration_min?.source}>
              <Input
                id="ho-edit-duration_min"
                type="number"
                min="0"
                value={fieldString(displayData, "duration_min")}
                onChange={(e) => handleFieldChange("duration_min", e.target.value)}
              />
            </FieldSection>
            <FieldSection fieldKey="sessions" label={FIELD_LABELS.sessions} source={displayData.sessions?.source}>
              <Input
                id="ho-edit-sessions"
                className="font-mono"
                placeholder="19:00 · 21:00"
                value={fieldString(displayData, "sessions")}
                onChange={(e) => handleFieldChange("sessions", e.target.value)}
              />
            </FieldSection>
          </Section>

          <Section index={3} title="Fees and payment">
            <FieldSection fieldKey="fee" label={FIELD_LABELS.fee} source={displayData.fee?.source}>
              <div className="flex items-center gap-2">
                <span className="text-sm font-medium text-muted-foreground">{currency}</span>
                <Input
                  id="ho-edit-fee"
                  type="number"
                  inputMode="decimal"
                  min="0"
                  step="0.01"
                  className="font-mono"
                  value={fieldString(displayData, "fee")}
                  onChange={(e) => handleFieldChange("fee", e.target.value)}
                />
              </div>
              <p className="text-xs text-muted-foreground">Total payable: {feeDisplay}</p>
            </FieldSection>
            <FieldSection fieldKey="currency" label={FIELD_LABELS.currency} source={displayData.currency?.source}>
              <Select value={currency} onValueChange={(v) => handleFieldChange("currency", v)}>
                <SelectTrigger id="ho-edit-currency"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {CURRENCIES.map((c) => <SelectItem key={c} value={c}>{c}</SelectItem>)}
                </SelectContent>
              </Select>
            </FieldSection>
          </Section>

          <Section index={4} title="Terms detail">
            <FieldSection fieldKey="notes" label={FIELD_LABELS.notes} source={displayData.notes?.source}>
              <Textarea
                id="ho-edit-notes"
                rows={3}
                value={fieldString(displayData, "notes")}
                onChange={(e) => handleFieldChange("notes", e.target.value)}
              />
            </FieldSection>
            <div className="space-y-1.5">
              <p className="text-xs text-muted-foreground">Terms variant</p>
              {hasTermsTemplates ? (
                <>
                  <div role="radiogroup" aria-label="Terms variant" className="flex flex-wrap gap-2">
                    {!variantIsLive && termsVariant && (
                      <Button type="button" variant="outline" size="sm" disabled className="flex-1 text-muted-foreground">
                        Removed (will use default)
                      </Button>
                    )}
                    {terms.templates.map((t) => {
                      const selected = termsVariant === t.id;
                      return (
                        <Button
                          key={t.id}
                          type="button"
                          role="radio"
                          aria-checked={selected}
                          variant={selected ? "default" : "outline"}
                          size="sm"
                          className="flex-1"
                          onClick={() => handleTermsVariant(t.id)}
                        >
                          {t.name}
                        </Button>
                      );
                    })}
                  </div>
                  {!variantIsLive && termsVariant && (
                    <p className="text-xs text-destructive">
                      This order's saved terms template was removed. Choose one above before issuing.
                    </p>
                  )}
                </>
              ) : (
                // No template to pick, live or removed -- an empty radiogroup or a
                // "Removed" chip would both leave the producer guessing. Say so
                // plainly: this org has none configured yet.
                <p className="text-xs text-destructive">
                  No terms templates configured. Add one in Settings → Hire orders before issuing.
                </p>
              )}
            </div>
          </Section>

          <Button
            type="button"
            variant="outline"
            className="w-full"
            onClick={handleRefresh}
            disabled={!canRefresh}
            title={canRefresh ? undefined : "No linked artist or show date to refresh from"}
          >
            <RefreshCw className="mr-1 h-4 w-4" /> Refresh from ShowFlow
          </Button>
        </div>

        {/* RIGHT: live document preview */}
        <div className="rounded-xl border border-border bg-muted p-3 sm:p-4">
          <div className="sticky top-4 z-10 mb-3 flex justify-center">
            <span className="rounded-full border border-border bg-card px-3 py-1 text-xs font-medium text-muted-foreground shadow-elev1">
              Live preview, updates as you edit
            </span>
          </div>
          {previewSrc ? (
            <iframe
              title="Hire order live preview"
              src={previewSrc}
              className="h-[600px] w-full rounded-lg border border-border bg-background lg:h-[720px]"
            />
          ) : (
            <Skeleton className="h-[600px] w-full rounded-lg" />
          )}
        </div>
      </div>
    </div>
  );
}

/** One numbered section container in the left column. */
function Section({ index, title, children }: { index: number; title: string; children: ReactNode }) {
  return (
    <div className="space-y-4 rounded-xl border border-border bg-card p-4">
      <div className="flex items-center gap-2">
        <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-accent-500 text-[11px] font-medium text-primary-foreground">
          {index}
        </span>
        <h2 className="text-sm font-medium text-foreground">{title}</h2>
      </div>
      <div className="space-y-4">{children}</div>
    </div>
  );
}
