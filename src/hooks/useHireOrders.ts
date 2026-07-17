import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/features/auth/AuthContext";
import { useMyArtist } from "@/hooks/useMyArtist";
import {
  fetchHireOrdersForDate,
  fetchHireOrder,
  fetchMyHireOrders,
  fetchHireOrders,
  invokeHireOrderAction,
  updateHireOrderReview,
  updateHireOrderStatus,
  type HireOrderReview,
  type HireOrderRow,
  type HireOrderFilters,
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

/** A single hire order by id, for the document viewer page. */
export function useHireOrder(id: string | null | undefined) {
  return useQuery({
    queryKey: ["hire-orders", "detail", id],
    enabled: !!id,
    queryFn: () => fetchHireOrder(supabase, id!),
  });
}

/** All of the current org's hire orders for the V4 tracking dashboard,
 *  filtered by status/search (see fetchHireOrders). Disabled without a
 *  current org — matches every other org-scoped list hook in this file. */
export function useHireOrdersList(filters: HireOrderFilters = {}) {
  const { currentOrg } = useAuth();
  return useQuery({
    queryKey: ["hire-orders", "list", currentOrg?.id, filters],
    enabled: !!currentOrg,
    queryFn: () => fetchHireOrders(supabase, currentOrg!.id, filters),
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

interface DraftResult { created?: string[]; skipped?: { booking_id: string; reason: string }[] }
interface IssueResult { issued?: string[]; failed?: { order_id: string; issues: string[] }[] }

/** Friendly copy for the issue-validation failure codes generate-hire-orders
 *  can return (see orderReadyIssues / issueOrders in the edge function) — orgs
 *  ship with empty terms, so `missing_terms` is the common first failure and a
 *  raw code is not actionable on its own. Deliberately small: codes with no
 *  entry here fall back to the raw code rather than growing this list to cover
 *  every internal failure mode. */
const ISSUE_FAILURE_COPY: Record<string, string> = {
  missing_terms: "Add terms in Settings before issuing",
  missing_fee: "Set an engagement fee before issuing",
  missing_recipient_email: "Add a recipient email before issuing",
  missing_date: "Set a show date before issuing",
  missing_letterhead: "Add a letterhead in Settings before issuing",
  already_issued: "Already issued",
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
function describeDraftSkips(skipped: { booking_id: string; reason: string }[]): string {
  const reasons = Array.from(new Set(skipped.map((s) => s.reason)));
  return reasons.map((reason) => DRAFT_SKIP_COPY[reason] ?? reason).join(", ");
}

/** Invoke generate-hire-orders (draft/issue/preview/download-url). Invalidates the
 *  whole hire-orders domain and toasts a summary for draft/issue; preview and
 *  download-url return data the caller opens directly and stay silent. */
export function useHireOrderAction() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: Record<string, unknown>) => invokeHireOrderAction(supabase, body),
    onSuccess: (data, variables) => {
      invalidateHireOrders(qc);
      const action = variables.action;
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
      } else if (action === "issue") {
        const { issued = [], failed = [] } = (data ?? {}) as IssueResult;
        if (issued.length > 0) {
          toast.success(`Issued ${issued.length} hire order${issued.length === 1 ? "" : "s"}`);
        }
        if (failed.length > 0) {
          toast.error(
            `${failed.length} hire order${failed.length === 1 ? "" : "s"} failed to issue: ${describeIssueFailures(failed)}`,
          );
        }
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

/** Void a hire order (the client path; the DB transition guard allows `void`
 *  from any state, so this has no status precondition of its own). Used by
 *  the V4 slide-over's destructive "Void" action, behind an AlertDialog. */
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
