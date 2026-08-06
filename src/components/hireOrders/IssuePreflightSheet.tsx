import { useNavigate } from "react-router-dom";
import { AlertTriangle, CheckCircle2 } from "lucide-react";
import { ROUTES } from "@/config/app.config";
import { useOrderBlockers } from "@/hooks/useOrderBlockers";
import type { OrderData } from "@/lib/hireOrders/types";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { BlockerList } from "./BlockerList";

export interface PreflightOrder {
  id: string;
  order_no: string | null;
  artistName: string;
  data: OrderData;
  terms_variant: string | null;
}

export interface IssuePreflightSheetProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  orgId: string | null;
  order: PreflightOrder | null;
  /** Called only when nothing is blocking. The caller performs the actual issue. */
  onConfirm: () => void;
  isIssuing?: boolean;
}

/**
 * The pre-issue check. Replaces firing `issue` blind and reporting the failure in a
 * toast: everything that would fail is shown first, with the fix inline where this
 * viewer is allowed to make it.
 *
 * It is a pre-check, not the gate. The edge function still validates every order it is
 * asked to issue, so a stale client here costs a toast, never a bad document.
 */
export function IssuePreflightSheet({
  open, onOpenChange, orgId, order, onConfirm, isIssuing = false,
}: IssuePreflightSheetProps) {
  const navigate = useNavigate();
  const { blockers, isLoading, isError } = useOrderBlockers(orgId, order);
  const clean = blockers.length === 0 && !isError;

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent className="flex w-full flex-col gap-0 sm:max-w-lg">
        <SheetHeader className="text-left">
          <p className="font-mono text-xs text-muted-foreground">
            {order?.order_no ?? "Draft"} · {order?.artistName ?? ""}
          </p>
          <SheetTitle className="font-display">
            {isLoading
              ? "Checking"
              : isError
                ? "Could not check this order"
                : clean
                  ? "Ready to issue"
                  : blockers.length === 1
                    ? "One thing to settle first"
                    : `${blockers.length} things to settle first`}
          </SheetTitle>
          <SheetDescription>
            {isError
              ? "The organization's settings could not be read. Reload and try again before issuing."
              : clean
                ? "The PDF is generated, numbered and emailed. The artist gets a link to countersign."
                : "Nothing is sent until these are cleared. The draft is saved either way."}
          </SheetDescription>
        </SheetHeader>

        <div className="flex-1 overflow-y-auto py-4">
          {isLoading ? (
            <Skeleton className="h-24 w-full" />
          ) : isError ? (
            <div className="flex items-center gap-2.5 rounded-lg border border-border p-3">
              <AlertTriangle className="h-4 w-4 shrink-0 text-[var(--amber-600)]" />
              <p className="text-sm text-muted-foreground">Could not check this order's readiness. Reload the page and try again.</p>
            </div>
          ) : clean ? (
            <div className="flex items-center gap-2.5 rounded-lg border border-border p-3">
              <CheckCircle2 className="h-4 w-4 shrink-0 text-[var(--green-500)]" />
              <p className="text-sm text-muted-foreground">Everything this order needs is in place.</p>
            </div>
          ) : (
            <BlockerList
              orgId={orgId}
              blockers={blockers}
              idPrefix="preflight"
              onFixOrderField={() => {
                if (order) navigate(ROUTES.HIRE_ORDER_EDIT.replace(":id", order.id));
              }}
            />
          )}
        </div>

        <div className="flex items-center gap-2 border-t border-border pt-4">
          <Button disabled={!clean || isIssuing || isLoading} onClick={onConfirm}>
            Issue and send
          </Button>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Keep as draft
          </Button>
        </div>
      </SheetContent>
    </Sheet>
  );
}
