import { AlertTriangle } from "lucide-react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { resolveOrgSetting } from "@/data/settings";
import { useCan } from "@/hooks/useCapabilities";
import { useOrgTerms } from "@/hooks/useHireOrderSetup";
import { LETTERHEAD_DEFAULT } from "@/components/settings/hireOrders/defaults";
import type { Letterhead } from "@/components/settings/hireOrders/LetterheadCard";
import { BLOCKER_COPY, computeBlockers } from "@/lib/hireOrders/preflight";
import type { HireOrderTermsSetting } from "@/lib/hireOrders/terms";
import type { OrderData } from "@/lib/hireOrders/types";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";

const EMPTY_TERMS: HireOrderTermsSetting = { templates: [], default_id: null };

export interface BatchPreflightOrder {
  id: string;
  order_no: string | null;
  artistName: string;
  data: OrderData;
  terms_variant: string | null;
}

export interface BatchIssuePreflightDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  orgId: string | null;
  orders: BatchPreflightOrder[];
  /** Called with the ids that passed the check. The caller performs the issue. */
  onConfirm: (cleanIds: string[]) => void;
  isIssuing?: boolean;
}

/**
 * Batch preflight. The single-order sheet does not scale to a selection, and issuing
 * seven to have four fail is exactly the post-hoc-toast pattern this work removes.
 *
 * Sends only the clean subset, leaving the blocked rows selected in the table so they
 * can be fixed and retried, which matches what OrdersTable's onSuccess already does
 * with per-row failures returned by the edge function.
 *
 * No inline fixes here on purpose: a fix is per-order or org-wide, and mixing both into
 * a list of seven is unreadable. The blocked rows are named so the producer can open
 * each one, where the single-order sheet does offer the fix.
 */
export function BatchIssuePreflightDialog({
  open, onOpenChange, orgId, orders, onConfirm, isIssuing = false,
}: BatchIssuePreflightDialogProps) {
  const canEditSettings = useCan("edit_hire_order_settings");
  const letterhead = useQuery({
    queryKey: ["app-settings", "hire_order_letterhead", orgId],
    enabled: !!orgId && open,
    queryFn: () => resolveOrgSetting<Letterhead>(supabase, orgId, "hire_order_letterhead", LETTERHEAD_DEFAULT),
  });
  // Gated on `open` like the letterhead query above it: the two halves of one check
  // should not read on different schedules, and this dialog is mounted on every
  // /hire-orders render, so an ungated read here costs a round trip per page load.
  const terms = useOrgTerms(open ? orgId : null);
  const isLoading = !!orgId && (letterhead.isLoading || terms.isLoading);
  // Carried forward from plan 1's review: an unread setting is not an empty setting.
  // A failed read must not present a clean bill of health -- see useOrderBlockers,
  // which this dialog deliberately does not reuse (it checks every selected order at
  // once, not one), but the same isError honesty applies.
  const isError = !!orgId && (letterhead.isError || terms.isError);

  const checked = orders.map((o) => ({
    order: o,
    blockers: computeBlockers({
      data: o.data,
      letterhead: letterhead.data ?? null,
      terms: terms.data ?? EMPTY_TERMS,
      termsVariant: o.terms_variant,
      canEditSettings,
    }),
  }));
  const clean = isError ? [] : checked.filter((c) => c.blockers.length === 0);
  const blocked = checked.filter((c) => c.blockers.length > 0);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle className="font-display">Issue selected orders</DialogTitle>
          <DialogDescription>
            {isLoading
              ? "Checking the selection."
              : isError
                ? "Could not check the selection. Reload and try again before issuing."
                : `${clean.length} of ${orders.length} can be issued now. The rest stay as drafts.`}
          </DialogDescription>
        </DialogHeader>

        {isLoading ? (
          <Skeleton className="h-24 w-full" />
        ) : isError ? (
          <div className="flex items-center gap-2.5 rounded-lg border border-border p-3">
            <AlertTriangle className="h-4 w-4 shrink-0 text-[var(--amber-600)]" />
            <p className="text-sm text-muted-foreground">Could not check this selection's readiness. Reload the page and try again.</p>
          </div>
        ) : (
          blocked.length > 0 && (
            <div className="max-h-64 space-y-2 overflow-y-auto">
              {blocked.map(({ order, blockers }) => (
                <div key={order.id} className="rounded-lg border border-border p-3">
                  <p className="text-sm font-medium">{order.artistName}</p>
                  <p className="font-mono text-xs text-muted-foreground">{order.order_no ?? "Draft"}</p>
                  <p className="mt-1 text-xs text-[var(--amber-600)]">
                    {blockers.map((b) => BLOCKER_COPY[b.key].label).join(", ")}
                  </p>
                </div>
              ))}
            </div>
          )
        )}

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button
            disabled={clean.length === 0 || isIssuing || isLoading}
            onClick={() => onConfirm(clean.map((c) => c.order.id))}
          >
            Issue {clean.length} {clean.length === 1 ? "order" : "orders"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
