import { useQuery, useMutation, useQueryClient, keepPreviousData } from "@tanstack/react-query";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { useMyArtist } from "@/hooks/useMyArtist";
import { resolveOrgSetting } from "@/data/settings";
import { COUNTERSIGN_DEFAULT } from "@/components/settings/hireOrders/defaults";
import type { HireOrderCountersign } from "@/components/settings/hireOrders/CountersignCard";
import { HIRE_ORDER_DEFAULT_TERMS } from "@/config/app.config";
import { normalizeTermsSetting, type HireOrderTermsSetting } from "@/lib/hireOrders/terms";
import { BLOCKER_COPY } from "@/lib/hireOrders/preflight";
import {
  fetchHireOrdersForDate,
  fetchDatesReadyForHireOrder,
  fetchHireOrder,
  fetchMyHireOrders,
  fetchHireOrders,
  fetchArtistsLite,
  fetchShowDatesLite,
  invokeHireOrderAction,
  updateHireOrderReview,
  updateHireOrderStatus,
  markHireOrderSeen,
  updateHireOrderDraft,
  bulkImportHireOrders,
  createArtistLite,
  signHireOrder,
  type HireOrderFilters,
  type HireOrderReview,
  type HireOrderRow,
  type UpdateHireOrderDraftPatch,
  type BulkImportHireOrdersArgs,
  type SignHireOrderArgs,
} from "@/data/hireOrders";

/** Every mutation below busts the whole `['hire-orders']` prefix, never a sub-key —
 *  the only pattern that stays correct as new consumers (Tasks 12-14) are added. */
function invalidateHireOrders(qc: ReturnType<typeof useQueryClient>) {
  qc.invalidateQueries({ queryKey: ["hire-orders"] });
}

/** All hire orders for a show date (draft through countersigned), for the
 *  producer-facing date-sheet card. */
export function useHireOrdersForDate(showDateId: string | null | undefined) {
  return useQuery({
    queryKey: ["hire-orders", "for-date", showDateId],
    enabled: !!showDateId,
    queryFn: () => fetchHireOrdersForDate(supabase, showDateId!),
  });
}

/** Which of the org's fully-filled dates are ready for a hire order (no active
 *  order yet), plus the active order covering each already-ordered date. Feeds
 *  the bookings aggregate banner and the per-row status cell. */
export function useDatesReadyForHireOrder(orgId: string | null | undefined) {
  return useQuery({
    queryKey: ["hire-orders", "ready", orgId],
    enabled: !!orgId,
    queryFn: () => fetchDatesReadyForHireOrder(supabase, orgId!),
  });
}

/** A single hire order by id, for the document viewer page. */
export function useHireOrder(id: string | null | undefined) {
  return useQuery({
    queryKey: ["hire-orders", "detail", id],
    enabled: !!id,
    queryFn: () => fetchHireOrder(supabase, id!),
  });
}

/** The current user's own issued/countersigned hire orders (artist surface). */
export function useMyHireOrders() {
  const { data: artist } = useMyArtist();
  const artistIds = artist ? [artist.id] : [];
  return useQuery({
    queryKey: ["hire-orders", "mine", ...artistIds],
    enabled: artistIds.length > 0,
    queryFn: () => fetchMyHireOrders(supabase, artistIds),
  });
}

/** All of an org's hire orders (any status by default), for the V4 tracking
 *  dashboard. `filters` defaults to `{}` (no status/search narrowing).
 *  `placeholderData: keepPreviousData` keeps the last-loaded rows on screen
 *  while a new filter/search combination refetches, instead of flashing back
 *  to a loading state on every chip click or keystroke. */
export function useHireOrders(orgId: string | null | undefined, filters: HireOrderFilters = {}) {
  return useQuery({
    queryKey: ["hire-orders", "list", orgId, filters],
    enabled: !!orgId,
    placeholderData: keepPreviousData,
    queryFn: () => fetchHireOrders(supabase, orgId!, filters),
  });
}

/** Every org artist, lightest shape, for the V5 "new order" wizard's artist
 *  picker (and Task 5's import entity-resolution step). Not date-scoped —
 *  deliberately NOT useEligibleArtists, which restricts to one show date. */
export function useArtistsLite(orgId: string | null | undefined) {
  return useQuery({
    queryKey: ["hire-orders", "artists-lite", orgId],
    enabled: !!orgId,
    queryFn: () => fetchArtistsLite(supabase, orgId!),
  });
}

/** Every org show_date, lightest shape, newest first, for the V5 wizard's date
 *  picker (and Task 5's import wizard). */
export function useShowDatesLite(orgId: string | null | undefined) {
  return useQuery({
    queryKey: ["hire-orders", "showdates-lite", orgId],
    enabled: !!orgId,
    queryFn: () => fetchShowDatesLite(supabase, orgId!),
  });
}

interface DraftResult { created?: string[]; skipped?: { booking_id: string; reason: string }[] }
interface DraftBatchResult {
  created?: string[];
  skipped?: { artist_id: string; reason: string }[];
  errors?: { artist_id: string; reason: string }[];
  /** Partial success: an order was created for the artist, but these requested
   *  dates were dropped because an active order already covered them. */
  date_conflicts?: { artist_id: string; dropped: string[] }[];
}
export interface IssueResult { issued?: string[]; failed?: { order_id: string; issues: string[] }[] }

/** Actions that actually write data and so must bust the hire-orders domain.
 *  `preview` and `download-url` are read-only -- the debounced live-preview
 *  cycle on HireOrderEditPage calls `preview` roughly every 800ms while a
 *  producer types, and invalidating on every tick would storm the whole
 *  ['hire-orders'] domain (table/KPIs/nav-count/detail queries) for an action
 *  that changes nothing. */
const WRITE_ACTIONS = new Set(["draft", "issue", "draft-manual", "draft-batch", "resend"]);

/** Friendly copy for the issue-validation failure codes generate-hire-orders
 *  can return (see orderReadyIssues / issueOrders in the edge function) — orgs
 *  ship with empty terms, so `missing_terms` is the common first failure and a
 *  raw code is not actionable on its own. Deliberately small: codes with no
 *  entry here fall back to the raw code rather than growing this list to cover
 *  every internal failure mode. */
export const ISSUE_FAILURE_COPY: Record<string, string> = {
  // The five readiness codes come FROM the blocker vocabulary rather than being
  // restated here. They are the same five codes the preflight sheet, the batch dialog
  // and the edit-page callout render, so a second map meant one blocker could read two
  // different ways depending on which surface surfaced it, and editing one left the
  // other stale. The entries below are the codes only the edge function emits.
  ...Object.fromEntries(Object.entries(BLOCKER_COPY).map(([code, copy]) => [code, copy.action])),
  already_issued: "Already issued",
  // Not a real issue failure: the document was rendered, uploaded, and stamped
  // issued -- generate-hire-orders' Documenso branch reports this as a warning
  // alongside a successful issue (see the failure-containment note in
  // issueOne), so the toast must never read as "the order was not issued".
  documenso_failed: "Order issued, but countersign delivery failed",
};

/** Unique, human-readable reasons across every failed order's issue codes. */
function describeIssueFailures(failed: { order_id: string; issues: string[] }[]): string {
  const codes = Array.from(new Set(failed.flatMap((f) => f.issues)));
  return codes.map((code) => ISSUE_FAILURE_COPY[code] ?? code).join(", ");
}

/** Friendly copy for the reasons a draft can be skipped (see draftOrders in the
 *  edge function). `exists` is the routine case (the booking already has a live
 *  order); `order_no_collision` should not occur now that {seq} makes each base
 *  unique, but it is mapped so the toast never shows a bare code. */
const DRAFT_SKIP_COPY: Record<string, string> = {
  // Number-agnostic phrasing: each reads correctly whether the toast counts 1 or N
  // bookings (e.g. "1 booking skipped: already ordered", "2 bookings skipped: already ordered").
  exists: "already ordered",
  order_no_collision: "could not be assigned a unique number",
  error: "hit an unexpected error",
};

/** Unique, human-readable reasons across every skipped draft. */
function describeDraftSkips(skipped: Array<{ reason: string }>): string {
  const reasons = Array.from(new Set(skipped.map((s) => s.reason)));
  return reasons.map((reason) => DRAFT_SKIP_COPY[reason] ?? reason).join(", ");
}

const DRAFT_BATCH_ERROR_COPY: Record<string, string> = {
  artist_not_found: "artist not found",
  show_date_not_found: "show date not found",
  availability_check_failed: "availability could not be checked",
  date_insert_failed: "assigned dates could not be saved",
  error: "unexpected error",
};

function describeBatchErrors(errors: Array<{ reason: string }>): string {
  const reasons = Array.from(new Set(errors.map((error) => error.reason)));
  return reasons.map((reason) => DRAFT_BATCH_ERROR_COPY[reason] ?? reason).join(", ");
}

/** Invoke generate-hire-orders (draft/issue/draft-manual/draft-batch/resend/preview/download-url).
 *  Invalidates the whole hire-orders domain for the write actions
 *  (including resend, whose last_sent_at drives the drawer timestamp). Preview
 *  and download-url are read-only, so they neither invalidate nor toast. */
export function useHireOrderAction() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: Record<string, unknown>) => invokeHireOrderAction(supabase, body),
    onSuccess: (data, variables) => {
      const action = variables.action;
      if (WRITE_ACTIONS.has(action as string)) invalidateHireOrders(qc);
      if (action === "draft") {
        const { created = [], skipped = [] } = (data ?? {}) as DraftResult;
        if (created.length > 0) {
          toast.success(`Drafted ${created.length} hire order${created.length === 1 ? "" : "s"}`);
          // Some bookings were still skipped (e.g. they already had an order) —
          // surface that rather than letting it pass silently under the success.
          if (skipped.length > 0) {
            toast.warning(
              `${skipped.length} booking${skipped.length === 1 ? "" : "s"} skipped: ${describeDraftSkips(skipped)}`,
            );
          }
        } else if (skipped.length > 0) {
          toast.error(`No hire orders drafted: ${describeDraftSkips(skipped)}`);
        } else {
          // Zero eligible bookings for this date — not a failure, just nothing to do.
          toast.info("No bookings need hire orders");
        }
      } else if (action === "draft-batch") {
        const { created = [], skipped = [], errors = [], date_conflicts = [] } = (data ?? {}) as DraftBatchResult;
        if (created.length > 0) {
          toast.success(`Drafted ${created.length} hire order${created.length === 1 ? "" : "s"}`);
        }
        if (skipped.length > 0) {
          toast.warning(
            `${skipped.length} artist${skipped.length === 1 ? "" : "s"} skipped: ${describeDraftSkips(skipped)}`,
          );
        }
        if (date_conflicts.length > 0) {
          const droppedTotal = date_conflicts.reduce((sum, c) => sum + c.dropped.length, 0);
          toast.warning(
            `${droppedTotal} date${droppedTotal === 1 ? "" : "s"} already had an order and ${droppedTotal === 1 ? "was" : "were"} left out`,
          );
        }
        if (errors.length > 0) {
          toast.error(
            `${errors.length} artist${errors.length === 1 ? "" : "s"} failed: ${describeBatchErrors(errors)}`,
          );
        }
        if (created.length === 0 && skipped.length === 0 && errors.length === 0) {
          toast.info("No artists need hire orders");
        }
      } else if (action === "issue") {
        const { issued = [], failed = [] } = (data ?? {}) as IssueResult;
        // documenso_failed rides in `failed` but describes an order that DID
        // issue successfully (PDF rendered, uploaded, stamped issued) -- only
        // its countersign-delivery step hit a snag. Routing it through the
        // same "failed to issue" error would contradict itself and double-count
        // an order that already counted toward the "issued" success toast, so
        // it gets pulled out into its own warning and excluded from the
        // genuine-failure count/copy.
        const genuineFailed = failed.filter((f) => !f.issues.includes("documenso_failed"));
        const documensoFailed = failed.filter((f) => f.issues.includes("documenso_failed"));
        if (issued.length > 0) {
          toast.success(`Issued ${issued.length} hire order${issued.length === 1 ? "" : "s"}`);
        }
        if (genuineFailed.length > 0) {
          toast.error(
            `${genuineFailed.length} hire order${genuineFailed.length === 1 ? "" : "s"} failed to issue: ${describeIssueFailures(genuineFailed)}`,
          );
        }
        if (documensoFailed.length > 0) {
          toast.warning(
            `${documensoFailed.length} hire order${documensoFailed.length === 1 ? "" : "s"} issued, but countersign delivery failed`,
          );
        }
      } else if (action === "resend") {
        toast.success("Hire order resent");
      }
      // preview / download-url: no toast — the caller opens the returned PDF/URL directly.
    },
    onError: (error: Error) => {
      toast.error(error.message || "Hire order action failed");
    },
  });
}

/** Persist the generate dialog's fee + terms-variant edits onto a draft/ready
 *  order (the pre-step before preview/issue). Silent on success — the caller
 *  chains preview/issue right after, which own the user-facing toasts. Busts the
 *  whole hire-orders domain so the date-sheet rows reflect the new fee/variant. */
export function useUpdateHireOrderReview() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (vars: { id: string; review: HireOrderReview; currentData: HireOrderRow["data"] }) =>
      updateHireOrderReview(supabase, vars.id, vars.review, vars.currentData),
    onSuccess: () => invalidateHireOrders(qc),
    onError: (error: Error) => {
      toast.error(error.message || "Could not save hire order changes");
    },
  });
}

/**
 * Persist the V2 builder's full data snapshot (+ optional fee/currency/terms)
 * onto a draft/ready order. Silent on success (only errors toast): both the
 * debounced live-preview refresh AND the explicit "Save draft" action share
 * this mutation, and a background preview-persist popping a toast on every
 * keystroke would be noisy. The "Save draft" button toasts explicitly itself
 * once its own `mutateAsync` resolves — same pattern as `useUpdateHireOrderReview`. */
export function useUpdateHireOrderDraft() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (vars: { id: string; patch: UpdateHireOrderDraftPatch }) =>
      updateHireOrderDraft(supabase, vars.id, vars.patch),
    onSuccess: () => invalidateHireOrders(qc),
    onError: (error: Error) => {
      toast.error(error.message || "Could not save hire order changes");
    },
  });
}

/** Mark a hire order as countersigned (the client path; the DB transition guard
 *  from Task 1 enforces legality server-side). */
export function useMarkCountersigned() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => updateHireOrderStatus(supabase, id, "countersigned"),
    onSuccess: () => {
      invalidateHireOrders(qc);
      toast.success("Hire order marked as countersigned");
    },
    onError: (error: Error) => {
      toast.error(error.message || "Could not mark as countersigned");
    },
  });
}

/** The org's terms-templates setting (id/name/clauses list + default), for the
 *  three order pickers (GenerateHireOrderDialog, HireOrderEditPage, and the
 *  import wizard's row default). Reuses the same query key as TermsVariantsCard
 *  so the cache is shared -- a save in Settings invalidates ["app-settings"]
 *  and every picker refetches. Normalizes (tolerating the legacy
 *  {lean,standard,full} shape) so every consumer reads the same shape. */
export function useHireOrderTerms(orgId: string | null) {
  return useQuery<HireOrderTermsSetting>({
    queryKey: ["app-settings", "hire_order_terms", orgId],
    queryFn: async () => {
      const raw = await resolveOrgSetting<unknown>(supabase, orgId, "hire_order_terms", HIRE_ORDER_DEFAULT_TERMS);
      return normalizeTermsSetting(raw);
    },
    enabled: Boolean(orgId),
  });
}

/** The org's countersign mode + producer-email flag (for the signing surface). */
export function useHireOrderCountersignMode(orgId: string | null | undefined) {
  return useQuery({
    queryKey: ["hire-orders", "countersign-mode", orgId],
    enabled: !!orgId,
    queryFn: () => resolveOrgSetting<HireOrderCountersign>(supabase, orgId!, "hire_order_countersign", COUNTERSIGN_DEFAULT),
  });
}

/** Artist in-app signing. On success busts the whole hire-orders domain so the
 *  detail page + any list re-render as countersigned. */
export function useSignHireOrder() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (args: SignHireOrderArgs) => signHireOrder(supabase, args),
    onSuccess: () => {
      invalidateHireOrders(qc);
      toast.success("Hire order signed");
    },
    onError: (error: Error) => {
      toast.error(error.message || "Could not sign the hire order");
    },
  });
}

/**
 * Submit the import wizard's Review-step selection to `bulk_import_hire_orders`.
 * Silent on success (only errors toast) — the wizard's own Done step renders the
 * per-row result counts, so a toast here would be redundant. Busts the whole
 * hire-orders domain since a successful import creates new draft orders.
 */
export function useBulkImportHireOrders() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (args: BulkImportHireOrdersArgs) => bulkImportHireOrders(supabase, args),
    onSuccess: () => invalidateHireOrders(qc),
    onError: (error: Error) => {
      toast.error(error.message || "Could not import hire orders");
    },
  });
}

/**
 * Create a new org artist from just a name + email (the import wizard's Resolve
 * step "Create artist" path). Busts BOTH the hire-orders domain (its
 * artists-lite cache) and the plain artists domain, per the house rule that a
 * mutation touching another domain's cache invalidates that domain too.
 */
export function useCreateArtistLite() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (args: { orgId: string; name: string; email: string | null }) => createArtistLite(supabase, args),
    onSuccess: () => {
      invalidateHireOrders(qc);
      qc.invalidateQueries({ queryKey: ["artists"] });
    },
    onError: (error: Error) => {
      toast.error(error.message || "Could not create the artist");
    },
  });
}

/** Void a hire order (the client path; the DB transition guard enforces
 *  legality server-side). Used by the V4 slide-over's Void action, which
 *  gates the call behind an AlertDialog confirmation. */
export function useVoidHireOrder() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => updateHireOrderStatus(supabase, id, "void"),
    onSuccess: () => {
      invalidateHireOrders(qc);
      toast.success("Hire order voided");
    },
    onError: (error: Error) => {
      toast.error(error.message || "Could not void hire order");
    },
  });
}

/** Stamp the order as seen by the linked artist (idempotent RPC; the DB scopes
 *  it to the linked artist on an issued/countersigned order). Fired from a
 *  guarded effect on first view — silent both ways so opening a page never
 *  pops a toast at the artist, and a failure here (e.g. a stale/edge race)
 *  should not be treated as a user-facing error. */
export function useMarkHireOrderSeen() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => markHireOrderSeen(supabase, id),
    onSuccess: () => invalidateHireOrders(qc),
    onError: (error: Error) => {
      console.error("Could not mark hire order as seen", error);
    },
  });
}
