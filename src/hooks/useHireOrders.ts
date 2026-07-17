import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { useMyArtist } from "@/hooks/useMyArtist";
import {
  fetchHireOrdersForDate,
  fetchHireOrder,
  fetchMyHireOrders,
  invokeHireOrderAction,
  updateHireOrderStatus,
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
        } else if (skipped.length > 0) {
          toast.error("No hire orders drafted");
        }
      } else if (action === "issue") {
        const { issued = [], failed = [] } = (data ?? {}) as IssueResult;
        if (issued.length > 0) {
          toast.success(`Issued ${issued.length} hire order${issued.length === 1 ? "" : "s"}`);
        }
        if (failed.length > 0) {
          toast.error(`${failed.length} hire order${failed.length === 1 ? "" : "s"} failed to issue`);
        }
      }
      // preview / download-url: no toast — the caller opens the returned PDF/URL directly.
    },
    onError: (error: Error) => {
      toast.error(error.message || "Hire order action failed");
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
