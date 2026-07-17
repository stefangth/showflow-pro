import { Download, Pencil } from "lucide-react";
import { useNavigate } from "react-router-dom";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription,
  AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { HireOrderStatusBadge } from "@/components/hireOrders/HireOrderStatusBadge";
import { OrderFactsRail } from "@/components/hireOrders/OrderFactsRail";
import { formatMoney } from "@/lib/hireOrders/money";
import { formatDateDMY } from "@/lib/dates";
import type { OrderData } from "@/lib/hireOrders/types";
import type { HireOrderListRow } from "@/data/hireOrders";
import { useHireOrderAction, useMarkCountersigned, useVoidHireOrder } from "@/hooks/useHireOrders";
import { ROUTES } from "@/config/app.config";

/** Read a resolved snapshot field as a trimmed string ("" when absent). */
function snap(data: OrderData, key: keyof OrderData): string {
  const v = data[key]?.value;
  if (v === null || v === undefined) return "";
  return String(v);
}

interface Props {
  order: HireOrderListRow | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  orgId: string;
}

/**
 * The V4 row slide-over: facts grid + status-driven actions.
 *   draft/ready -> "Issue and send"
 *   issued      -> "Download" + "Mark countersigned"
 *   any non-void -> "Void" behind an AlertDialog confirmation
 * Every mutating action closes the sheet on success — the underlying list
 * query re-filters on refetch, and a just-acted-on row can otherwise fall out
 * of the currently active status/search filter mid-view.
 */
export function OrderSlideOver({ order, open, onOpenChange, orgId }: Props) {
  const navigate = useNavigate();
  const action = useHireOrderAction();
  const countersign = useMarkCountersigned();
  const voidOrder = useVoidHireOrder();

  if (!order) return null;

  const data = (order.data ?? {}) as OrderData;
  const artistName = order.artists?.name || snap(data, "artist_name") || "Unknown artist";
  const email = snap(data, "recipient_email");
  const venue = order.show_dates?.venue || snap(data, "venue");
  const dateStr = order.show_dates?.date || snap(data, "date");
  const durationRaw = snap(data, "duration_min");
  const duration = durationRaw ? `${durationRaw} min` : null;
  const sessions = snap(data, "sessions") || null;
  const fee = order.fee_amount != null ? formatMoney(order.fee_amount, order.fee_currency) : null;

  function handleIssue() {
    action.mutate(
      { action: "issue", org_id: orgId, order_ids: [order!.id] },
      { onSuccess: () => onOpenChange(false) },
    );
  }

  async function handleDownload() {
    try {
      const res = await action.mutateAsync({ action: "download-url", org_id: orgId, order_id: order!.id });
      const url = (res as { url?: string } | null)?.url;
      if (url) window.open(url, "_blank", "noopener,noreferrer");
    } catch {
      // useHireOrderAction already toasts the failure.
    }
  }

  function handleCountersign() {
    countersign.mutate(order!.id, { onSuccess: () => onOpenChange(false) });
  }

  function handleVoid() {
    voidOrder.mutate(order!.id, { onSuccess: () => onOpenChange(false) });
  }

  function handleEdit() {
    onOpenChange(false);
    navigate(ROUTES.HIRE_ORDER_EDIT.replace(":id", order!.id));
  }

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent className="w-full overflow-y-auto sm:max-w-md">
        <SheetHeader>
          <div className="flex items-center gap-2">
            <SheetTitle className="font-mono text-base">{order.order_no}</SheetTitle>
            <HireOrderStatusBadge status={order.status} />
          </div>
        </SheetHeader>

        <div className="mt-6 space-y-6">
          <dl className="grid grid-cols-2 gap-4 text-sm">
            <div>
              <dt className="text-xs uppercase tracking-wide text-muted-foreground">Artist</dt>
              <dd className="mt-0.5 text-foreground">{artistName}</dd>
            </div>
            {email && (
              <div>
                <dt className="text-xs uppercase tracking-wide text-muted-foreground">Email</dt>
                <dd className="mt-0.5 break-words text-foreground">{email}</dd>
              </div>
            )}
            <div>
              <dt className="text-xs uppercase tracking-wide text-muted-foreground">Venue</dt>
              <dd className="mt-0.5 text-foreground">{venue || "Not set"}</dd>
            </div>
            <div>
              <dt className="text-xs uppercase tracking-wide text-muted-foreground">Date</dt>
              <dd className="mt-0.5 font-mono text-foreground">{dateStr ? formatDateDMY(dateStr) : "Not set"}</dd>
            </div>
          </dl>

          <OrderFactsRail fee={fee} duration={duration} sessions={sessions} />

          <div className="space-y-2">
            {(order.status === "draft" || order.status === "ready") && (
              <>
                <Button variant="outline" className="w-full" onClick={handleEdit}>
                  <Pencil className="mr-1 h-4 w-4" /> Edit
                </Button>
                <Button className="w-full" onClick={handleIssue} disabled={action.isPending}>
                  Issue and send
                </Button>
              </>
            )}
            {order.status === "issued" && (
              <>
                <Button variant="outline" className="w-full" onClick={handleDownload} disabled={action.isPending}>
                  <Download className="mr-1 h-4 w-4" /> Download
                </Button>
                <Button className="w-full" onClick={handleCountersign} disabled={countersign.isPending}>
                  Mark countersigned
                </Button>
              </>
            )}
            {order.status === "countersigned" && (
              <Button variant="outline" className="w-full" onClick={handleDownload} disabled={action.isPending}>
                <Download className="mr-1 h-4 w-4" /> Download
              </Button>
            )}
            {order.status !== "void" && (
              <AlertDialog>
                <AlertDialogTrigger asChild>
                  <Button variant="outline" className="w-full text-destructive hover:text-destructive">
                    Void
                  </Button>
                </AlertDialogTrigger>
                <AlertDialogContent>
                  <AlertDialogHeader>
                    <AlertDialogTitle>Void this hire order?</AlertDialogTitle>
                    <AlertDialogDescription>
                      This cannot be undone. The order will be marked void and removed from active tracking.
                    </AlertDialogDescription>
                  </AlertDialogHeader>
                  <AlertDialogFooter>
                    <AlertDialogCancel>Cancel</AlertDialogCancel>
                    <AlertDialogAction onClick={handleVoid}>Void order</AlertDialogAction>
                  </AlertDialogFooter>
                </AlertDialogContent>
              </AlertDialog>
            )}
          </div>
        </div>
      </SheetContent>
    </Sheet>
  );
}
