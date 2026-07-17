import { Download } from "lucide-react";
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetDescription } from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { HireOrderStatusBadge } from "@/components/hireOrders/HireOrderStatusBadge";
import { OrderFactsRail } from "@/components/hireOrders/OrderFactsRail";
import { useAuth } from "@/features/auth/AuthContext";
import { useHireOrder, useHireOrderAction, useMarkCountersigned, useVoidHireOrder } from "@/hooks/useHireOrders";
import { formatMoney } from "@/lib/hireOrders/money";
import { formatDateDMY } from "@/lib/dates";
import type { OrderData } from "@/lib/hireOrders/types";

interface Props {
  orderId: string | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

/** Read a resolved snapshot field as a trimmed string ("" when absent) —
 *  mirrors HireOrderDetailPage's `snap`. */
function snap(data: OrderData, key: keyof OrderData): string {
  const v = data[key]?.value;
  if (v === null || v === undefined) return "";
  return String(v);
}

/**
 * The V4 tracking table's row detail panel: a facts grid, the status badge,
 * and the status-appropriate action (draft/ready -> issue; issued -> download
 * + mark countersigned; countersigned -> download only), plus a destructive
 * Void action (any non-void status) behind a confirmation dialog.
 */
export function OrderSlideOver({ orderId, open, onOpenChange }: Props) {
  const { currentOrg } = useAuth();
  const orgId = currentOrg?.id ?? "";

  const { data: order, isLoading } = useHireOrder(orderId);
  const action = useHireOrderAction();
  const countersign = useMarkCountersigned();
  const voidOrder = useVoidHireOrder();

  const data = (order?.data ?? {}) as OrderData;
  const artistName = order?.artists?.name || snap(data, "artist_name") || "Unknown artist";
  const venue = snap(data, "venue");
  const dateStr = snap(data, "date");
  const durationRaw = snap(data, "duration_min");
  const duration = durationRaw ? `${durationRaw} min` : null;
  const sessions = snap(data, "sessions") || null;
  const fee = order?.fee_amount != null ? formatMoney(order.fee_amount, order.fee_currency) : null;

  function handleIssue() {
    if (!order) return;
    action.mutate({ action: "issue", org_id: orgId, order_ids: [order.id] });
  }

  function handleDownload() {
    if (!order) return;
    void (async () => {
      const res = await action.mutateAsync({ action: "download-url", org_id: orgId, order_id: order.id });
      const url = (res as { url?: string } | null)?.url;
      if (url) window.open(url, "_blank", "noopener,noreferrer");
    })().catch(() => {
      /* useHireOrderAction toasts the failure */
    });
  }

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent className="w-full overflow-y-auto sm:max-w-md">
        {/* Header is always rendered (with a loading fallback) — Radix requires
            a SheetTitle on every DialogContent for a11y, so it can't be
            deferred behind the loading branch the way ArtistProfileSheet
            defers its body-only skeleton. */}
        <SheetHeader>
          <div className="flex items-center gap-2">
            <SheetTitle className="font-mono text-base">{order?.order_no ?? "Hire order"}</SheetTitle>
            {order && <HireOrderStatusBadge status={order.status} />}
          </div>
          <SheetDescription>
            {order
              ? [artistName, venue, dateStr ? formatDateDMY(dateStr) : null].filter(Boolean).join(" · ")
              : "Loading hire order details."}
          </SheetDescription>
        </SheetHeader>

        {isLoading || !order ? (
          <div className="mt-6 space-y-3">
            <Skeleton className="h-24 w-full" />
            <Skeleton className="h-24 w-full" />
          </div>
        ) : (
          <>
            <div className="mt-6 space-y-6">
              <div className="rounded-lg border border-border p-4">
                <OrderFactsRail fee={fee} duration={duration} sessions={sessions} />
              </div>

              <div className="flex flex-wrap items-center gap-2">
                {(order.status === "draft" || order.status === "ready") && (
                  <Button onClick={handleIssue} disabled={action.isPending}>
                    Issue and send
                  </Button>
                )}
                {order.status === "issued" && (
                  <>
                    <Button variant="outline" onClick={handleDownload} disabled={action.isPending}>
                      <Download className="mr-1 h-4 w-4" /> Download
                    </Button>
                    <Button onClick={() => countersign.mutate(order.id)} disabled={countersign.isPending}>
                      Mark countersigned
                    </Button>
                  </>
                )}
                {order.status === "countersigned" && (
                  <Button variant="outline" onClick={handleDownload} disabled={action.isPending}>
                    <Download className="mr-1 h-4 w-4" /> Download
                  </Button>
                )}

                {order.status !== "void" && (
                  <AlertDialog>
                    <AlertDialogTrigger asChild>
                      <Button variant="ghost" className="ml-auto text-destructive hover:text-destructive">
                        Void
                      </Button>
                    </AlertDialogTrigger>
                    <AlertDialogContent>
                      <AlertDialogHeader>
                        <AlertDialogTitle>Void this hire order?</AlertDialogTitle>
                        <AlertDialogDescription>
                          This marks "{order.order_no}" as void. This cannot be undone.
                        </AlertDialogDescription>
                      </AlertDialogHeader>
                      <AlertDialogFooter>
                        <AlertDialogCancel>Cancel</AlertDialogCancel>
                        <AlertDialogAction onClick={() => voidOrder.mutate(order.id)}>Void order</AlertDialogAction>
                      </AlertDialogFooter>
                    </AlertDialogContent>
                  </AlertDialog>
                )}
              </div>
            </div>
          </>
        )}
      </SheetContent>
    </Sheet>
  );
}
