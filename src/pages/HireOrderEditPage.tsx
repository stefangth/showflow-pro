import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { ArrowLeft, RefreshCw } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/features/auth/AuthContext";
import {
  useHireOrder, useHireOrderAction, useUpdateHireOrderDraft, useHireOrderTerms, ISSUE_FAILURE_COPY,
} from "@/hooks/useHireOrders";
import { fetchShowflowLayerForOrder, type UpdateHireOrderDraftPatch } from "@/data/hireOrders";
import { createSingleFlightRunner } from "@/lib/singleFlight";
import { resolveFields } from "@/lib/hireOrders/resolveFields";
import { formatMoney } from "@/lib/hireOrders/money";
import { feeCents } from "@/lib/hireOrders/feeBasis";
import { defaultTemplateId } from "@/lib/hireOrders/terms";
import { ORDER_FIELD_KEYS, type EditableOrderFieldKey, type OrderData } from "@/lib/hireOrders/types";
import { ROUTES, HIRE_ORDER_DEFAULT_TERMS } from "@/config/app.config";
import { Button } from "@/components/ui/button";
import { IconTooltip } from "@/components/common/IconTooltip";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { HireOrderStatusBadge } from "@/components/hireOrders/HireOrderStatusBadge";
import { Token } from "@/components/ui/token";
import { FieldSection } from "@/components/hireOrders/edit/FieldSection";
import { useOrderBlockers } from "@/hooks/useOrderBlockers";
import { SetupCallout } from "@/components/hireOrders/edit/SetupCallout";

/** Kept in sync with CURRENCY_SYMBOLS in money.ts / CURRENCIES in NewOrderWizard.tsx. */
const CURRENCIES = ["EUR", "USD", "CHF"];

const FIELD_LABEL_KEYS: Record<EditableOrderFieldKey, string> = {
  artist_name: "editPage.artistName",
  recipient_email: "editPage.recipientEmail",
  role: "editPage.role",
  cast: "editPage.cast",
  date: "editPage.date",
  venue: "editPage.venue",
  city: "editPage.city",
  duration_min: "editPage.durationMinutes",
  sessions: "editPage.sessions",
  fee: "editPage.engagementFee",
  currency: "editPage.currency",
  notes: "editPage.notes",
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
  /** Server-derived, not editable and therefore not in ORDER_FIELD_KEYS, so
   *  they must be carried across a re-resolution the same way
   *  `engagement_dates` is — see `carryDerivedFeeFields`. */
  fee_basis?: OrderData["fee_basis"];
  fee_per_date?: OrderData["fee_per_date"];
  /** The snapshot's own fee, the baseline every re-resolution compares against
   *  to decide whether the two fields above still describe it. */
  fee?: OrderData["fee"];
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
  return {
    showflow, sheet, manual, defaults,
    engagement_dates: data.engagement_dates,
    fee_basis: data.fee_basis,
    fee_per_date: data.fee_per_date,
    fee: data.fee,
  };
}

/**
 * Re-attach the stored `fee_basis`/`fee_per_date` to a freshly re-resolved
 * snapshot, but only while they still describe its fee.
 *
 * `resolveFields` only knows the twelve EDITABLE keys, so every rebuild here
 * starts without these two. Dropping them unconditionally would let a notes
 * typo fix permanently strip an aggregate order's per-date breakdown; keeping
 * them unconditionally would leave "500.00 per date x 3 dates" printed above a
 * total the producer just lowered. So: carry them when the fee is untouched,
 * clear them the moment it changes (the same invariant `updateHireOrderReview`
 * enforces, and the PDF renderer guards at the last mile). Compared in integer
 * cents, so a stored `"1500.00"` and a typed `1500` are the same fee.
 */
function carryDerivedFeeFields(next: OrderData, source: SplitLayers): OrderData {
  if (feeCents(next.fee?.value) !== feeCents(source.fee?.value)) return next;
  const out: OrderData = { ...next };
  if (source.fee_basis) out.fee_basis = source.fee_basis;
  if (source.fee_per_date) out.fee_per_date = source.fee_per_date;
  return out;
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
  const { t, i18n } = useTranslation("hireOrdersPages");
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { currentOrg } = useAuth();
  const orgId = currentOrg?.id ?? "";

  const FIELD_LABELS: Record<EditableOrderFieldKey, string> = {
    artist_name: t(FIELD_LABEL_KEYS.artist_name),
    recipient_email: t(FIELD_LABEL_KEYS.recipient_email),
    role: t(FIELD_LABEL_KEYS.role),
    cast: t(FIELD_LABEL_KEYS.cast),
    date: t(FIELD_LABEL_KEYS.date),
    venue: t(FIELD_LABEL_KEYS.venue),
    city: t(FIELD_LABEL_KEYS.city),
    duration_min: t(FIELD_LABEL_KEYS.duration_min),
    sessions: t(FIELD_LABEL_KEYS.sessions),
    fee: t(FIELD_LABEL_KEYS.fee),
    currency: t(FIELD_LABEL_KEYS.currency),
    notes: t(FIELD_LABEL_KEYS.notes),
  };

  const { data: order, isLoading, isError, error } = useHireOrder(id);
  const action = useHireOrderAction();
  const updateDraft = useUpdateHireOrderDraft();

  // The org's letterhead is read by `useOrderBlockers` below, on the same
  // ["app-settings", "hire_order_letterhead", orgId] key: this page no longer
  // observes it separately, because nothing here reads the letterhead except the
  // readiness rule, and that rule now lives in one place.

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
  // clobber in-progress edits.
  //
  // State, not a ref, because the builder must not render before it runs. The
  // effect lands a commit AFTER the one where `order` arrived and the isLoading
  // gate opened, and in between every control was live over `resolvedData ===
  // null`: "Save draft" only guards `if (!order) return`, and `order` is exactly
  // what IS present in that window, so a click there wrote a snapshot resolved
  // from nothing (plus terms_variant "") over the order's real stored fields.
  // Elsewhere this is fixed by deriving the draft from the query (useDerivedDraft);
  // here the seed also primes `clearedFields` and `termsVariant`, and a second
  // effect re-seeds the variant once the org's terms resolve, so gating the render
  // on the seed closes the same window without unpicking that.
  // Hydrate the editor state from the order once it loads, using React's
  // adjust-during-render pattern (guarded by `hydrated`, converges) instead of a
  // setState-in-effect. `terms` is read only for its effective-default fallback on
  // this first seed; the dedicated re-seed below corrects the selection once the
  // REAL terms setting resolves for an order with no stored variant.
  const [hydrated, setHydrated] = useState(false);
  if (order && !hydrated) {
    setHydrated(true);
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
  // One-time re-seed once the org's real terms setting resolves. Ref-coordinated
  // (variantTouchedRef guards against clobbering a manual pick; variantSeededRef makes
  // it once-only) and driven by async termsQuery.data arriving — external-system sync,
  // not derived state. Reading those guard refs during render is itself disallowed, so
  // this stays an effect.
  useEffect(() => {
    if (!order || order.terms_variant || variantTouchedRef.current || variantSeededRef.current) return;
    if (!termsQuery.data) return;
    variantSeededRef.current = true;
    // eslint-disable-next-line react-hooks/set-state-in-effect -- async terms seeding; see above
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
    // After applyClearedOverrides, never before: an explicitly blanked fee is
    // a fee change too, and only the post-override snapshot knows that.
    return carryDerivedFeeFields(applyClearedOverrides(rebuilt, clearedFields), baseLayers);
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
  // Keep the single-flight runner's view of state current without a render-time ref
  // write (react-hooks/refs): a trailing rerun always reads the LATEST state, not
  // whatever the timer's closure captured when it fired.
  useEffect(() => {
    latestRef.current = { order, orgId, isReadOnly, buildPatch, updateDraft, action, dirty };
  });

  // The single-flight runner is created once, inside a mount effect (not during
  // render), so it never references a ref during render (react-hooks/refs). Its
  // only callers are the two effects below, which run after it is set. It reads
  // latestRef.current at call time and setPreviewSrc is stable.
  const runPreviewCycleRef = useRef<(() => void) | null>(null);
  useEffect(() => {
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
  }, []);

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
      toast.success(t("editPage.draftSaved"));
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

  // The ONE readiness rule on this page: it feeds both the callout and the Issue
  // gate below, and it is what the edge function's issueOne actually enforces.
  // Called unconditionally, ABOVE the isLoading/isError/isReadOnly early returns
  // below, because it is a hook (Rules of Hooks). Its own read state travels with
  // it: the blockers are fail-safe, so an unread setting looks exactly like an
  // unconfigured org and neither surface may present it as one.
  const {
    blockers, isLoading: blockersLoading, isError: blockersError,
  } = useOrderBlockers(orgId, order ? { data: displayData, terms_variant: termsVariant } : null);

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
      commit(carryDerivedFeeFields(refreshed, baseLayers), true);
      toast.success(t("editPage.refreshed"));
    } catch (e) {
      toast.error((e as Error).message || t("editPage.refreshError"));
    }
  }

  // `order && !hydrated` is the one-commit window above: hold the skeleton for it.
  // Conditioned on `order` so a failed read still falls through to the alert below
  // rather than showing a skeleton forever.
  if (isLoading || (order && !hydrated)) {
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
        <Button variant="secondary" size="sm" className="mb-4 -ml-2" onClick={() => navigate(-1)}>
          <ArrowLeft className="mr-1 h-4 w-4" /> {t("common.back")}
        </Button>
        <Alert variant="destructive">
          <AlertTitle>{t("editPage.loadErrorTitle")}</AlertTitle>
          <AlertDescription>
            {(error as Error)?.message ?? t("editPage.loadErrorBody")}
          </AlertDescription>
        </Alert>
      </div>
    );
  }

  if (isReadOnly) {
    return (
      <div className="mx-auto max-w-2xl space-y-4 p-4 sm:p-6">
        <Button variant="secondary" size="sm" className="-ml-2" onClick={() => navigate(-1)}>
          <ArrowLeft className="mr-1 h-4 w-4" /> {t("common.back")}
        </Button>
        <Alert>
          <AlertTitle>{t("editPage.readOnlyTitle")}</AlertTitle>
          <AlertDescription>
            <Token>{order.order_no}</Token> {t("editPage.readOnlyBody", { status: order.status })}
          </AlertDescription>
        </Alert>
        <Button onClick={() => navigate(ROUTES.HIRE_ORDER_DETAIL.replace(":id", order.id))}>{t("editPage.viewOrder")}</Button>
      </div>
    );
  }

  // The stored terms_variant no longer matches any live template (its template
  // was deleted in Settings). Never silently drop or auto-correct the
  // selection -- show it as a disabled "removed" chip and require an explicit
  // pick before Issue is allowed. Stricter than the readiness rule on purpose:
  // resolveTermsClauses falls back to the org default for a dead reference, so
  // `blockers` alone would let a deleted reference through silently.
  const variantIsLive = terms.templates.some((t) => t.id === termsVariant);
  const hasTermsTemplates = terms.templates.length > 0;

  // `blockers` (computeBlockers, via useOrderBlockers above) is the readiness rule,
  // the same one the slide-over and the bulk bar preflight on and the same one
  // issueOne enforces server-side. It replaces this page's old `orderReadyIssues`
  // gate, which carried no terms rule and so enabled this button for orders the
  // server rejects with `missing_terms`. The two conditions below it are this
  // page's own, and neither is expressible as a blocker.
  const issueTitleParts = blockers.map((b) => ISSUE_FAILURE_COPY[b.key] ?? b.key);
  if (!variantIsLive) {
    issueTitleParts.push(hasTermsTemplates ? t("common.chooseTermsFirst") : t("common.noTermsConfiguredShort"));
  }
  const issueDisabled =
    blockersLoading || blockersError || blockers.length > 0 || action.isPending || !variantIsLive;
  // The read-state prefix is prepended, not substituted: `issueTitleParts` can already
  // hold the deleted-terms-template reason, which is derived from `terms` (not from the
  // blockers read) and is the one thing the producer can act on. Dropping it while the
  // settings read is in flight hides it exactly when they hover to find out why.
  if (blockersLoading) issueTitleParts.unshift(t("editPage.checking"));
  else if (blockersError) issueTitleParts.unshift(t("editPage.checkError"));
  const issueTitle = issueTitleParts.length > 0 ? issueTitleParts.join(", ") : undefined;

  const currency = fieldString(displayData, "currency") || order.fee_currency || "EUR";
  const feeDisplay =
    displayData.fee?.value != null && displayData.fee.value !== ""
      ? formatMoney(displayData.fee.value as string | number, currency, i18n.language)
      : t("common.notSet");

  return (
    <div className="mx-auto max-w-6xl space-y-6 p-4 sm:p-6">
      {/* Header */}
      <div className="flex flex-wrap items-center justify-between gap-4 border-b border-border pb-4">
        <div className="flex items-center gap-2 min-w-0">
          <IconTooltip label={t("common.goBack")}>
            <Button variant="ghost" size="icon" onClick={() => navigate(-1)} aria-label={t("common.goBack")}>
              <ArrowLeft className="h-5 w-5" />
            </Button>
          </IconTooltip>
          <div className="min-w-0">
            {/* eslint-disable-next-line no-restricted-syntax -- 12px + tracking-wide page-header caption, not the 11px Eyebrow pattern */}
            <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">{t("editPage.editHireOrder")}</p>
            <div className="flex items-center gap-2">
              <h1 className="text-lg text-foreground"><Token>{order.order_no}</Token></h1>
              <HireOrderStatusBadge status={order.status} />
            </div>
          </div>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          <Button variant="outline" onClick={handleSaveDraft} disabled={updateDraft.isPending}>
            {t("editPage.saveDraft")}
          </Button>
          <Button onClick={handleIssue} disabled={issueDisabled} title={issueTitle}>
            {t("common.issueAndSend")}
          </Button>
        </div>
      </div>

      {/* Split builder */}
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-[428px_1fr]">
        {/* LEFT: numbered field sections */}
        <div className="space-y-4">
          <Section index={1} title={t("editPage.sectionParties")}>
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

          <Section index={2} title={t("editPage.sectionEngagement")}>
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
                className="tabular-nums"
                placeholder={t("editPage.sessionsPlaceholder")}
                value={fieldString(displayData, "sessions")}
                onChange={(e) => handleFieldChange("sessions", e.target.value)}
              />
            </FieldSection>
          </Section>

          <Section index={3} title={t("editPage.sectionFees")}>
            <FieldSection fieldKey="fee" label={FIELD_LABELS.fee} source={displayData.fee?.source}>
              <div className="flex items-center gap-2">
                <span className="text-sm font-medium text-muted-foreground">{currency}</span>
                <Input
                  id="ho-edit-fee"
                  type="number"
                  inputMode="decimal"
                  min="0"
                  step="0.01"
                  className="tabular-nums"
                  value={fieldString(displayData, "fee")}
                  onChange={(e) => handleFieldChange("fee", e.target.value)}
                />
              </div>
              <p className="text-xs text-muted-foreground">{t("editPage.totalPayable", { fee: feeDisplay })}</p>
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

          <Section index={4} title={t("editPage.sectionTerms")}>
            <FieldSection fieldKey="notes" label={FIELD_LABELS.notes} source={displayData.notes?.source}>
              <Textarea
                id="ho-edit-notes"
                rows={3}
                value={fieldString(displayData, "notes")}
                onChange={(e) => handleFieldChange("notes", e.target.value)}
              />
            </FieldSection>
            <div className="space-y-1.5">
              <p className="text-xs text-muted-foreground">{t("editPage.termsVariant")}</p>
              {hasTermsTemplates ? (
                <>
                  <div role="radiogroup" aria-label={t("editPage.termsVariant")} className="flex flex-wrap gap-2">
                    {!variantIsLive && termsVariant && (
                      <Button type="button" variant="outline" size="sm" disabled className="flex-1 text-muted-foreground">
                        {t("common.removedWillUseDefault")}
                      </Button>
                    )}
                    {terms.templates.map((tmpl) => {
                      const selected = termsVariant === tmpl.id;
                      return (
                        <Button
                          key={tmpl.id}
                          type="button"
                          role="radio"
                          aria-checked={selected}
                          variant={selected ? "default" : "outline"}
                          size="sm"
                          className="flex-1"
                          onClick={() => handleTermsVariant(tmpl.id)}
                        >
                          {tmpl.name.trim() || t("common.untitledTemplate")}
                        </Button>
                      );
                    })}
                  </div>
                  {!variantIsLive && termsVariant && (
                    <p className="text-xs text-destructive">
                      {t("common.termsTemplateRemoved")}
                    </p>
                  )}
                </>
              ) : (
                // No template to pick, live or removed -- an empty radiogroup or a
                // "Removed" chip would both leave the producer guessing. Say so
                // plainly: this org has none configured yet.
                <p className="text-xs text-destructive">
                  {t("common.noTermsConfigured")}
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
            title={canRefresh ? undefined : t("editPage.refreshDisabled")}
          >
            <RefreshCw className="mr-1 h-4 w-4" /> {t("editPage.refresh")}
          </Button>
        </div>

        {/* RIGHT: live document preview */}
        <div>
          <SetupCallout orgId={orgId} blockers={blockers} isLoading={blockersLoading} isError={blockersError} />
          <div className="rounded-xl border border-border bg-well-tint p-3 sm:p-4">
            <div className="sticky top-4 z-10 mb-3 flex justify-center">
              <span className="rounded-full border border-border bg-card px-3 py-1 text-xs font-medium text-muted-foreground shadow-elev1">
                {t("editPage.livePreview")}
              </span>
            </div>
            {previewSrc ? (
              <iframe
                title={t("editPage.iframeTitle")}
                src={previewSrc}
                className="h-[600px] w-full rounded-card border border-border bg-background lg:h-[720px]"
              />
            ) : (
              <Skeleton className="h-[600px] w-full rounded-card" />
            )}
          </div>
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
        <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-accent-500 text-eyebrow font-medium text-primary-foreground">
          {index}
        </span>
        <h2 className="text-sm font-medium text-foreground">{title}</h2>
      </div>
      <div className="space-y-4">{children}</div>
    </div>
  );
}
