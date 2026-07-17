import { useState } from "react";
import { Sparkles, FileText } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { useAuth } from "@/features/auth/AuthContext";
import { useFeature } from "@/hooks/useEntitlements";
import { useHireOrdersForDate, useHireOrderAction, useMyHireOrders } from "@/hooks/useHireOrders";
import type { HireOrderRow } from "@/data/hireOrders";
import { GenerateHireOrderDialog } from "./GenerateHireOrderDialog";
import type { HireOrderBooking, HireOrderShowDate } from "./types";

interface Props {
  showDateId: string;
  showDate: HireOrderShowDate;
  bookings: HireOrderBooking[];
  canManage: boolean;
}

/**
 * Hire-orders surface for the show-date detail sheet. Gated on the `hire_orders`
 * entitlement, then split by role: the producer management view lives in
 * `ProducerHireOrders`; the read-only artist view lives in `ArtistHireOrders`.
 * The two stay fully isolated from each other below.
 */
export function HireOrdersCard(props: Props) {
  const enabled = useFeature("hire_orders");
  if (!enabled) return null;
  if (!props.canManage) return <ArtistHireOrders {...props} />;
  return <ProducerHireOrders {...props} />;
}

/** Tone + copy for each order status (kept beside the rows that use it). */
function StatusBadge({ status }: { status: string }) {
  switch (status) {
    case "draft":
      return <Badge variant="secondary">Draft</Badge>;
    case "ready":
      return <Badge variant="accent">Ready</Badge>;
    case "issued":
      return <Badge variant="hold">Awaiting countersign</Badge>;
    case "countersigned":
      return <Badge variant="confirmed">Countersigned</Badge>;
    case "void":
      return <Badge variant="neutral">Void</Badge>;
    default:
      return <Badge variant="neutral">{status}</Badge>;
  }
}

/**
 * Read-only artist variant: the viewer's own order for this date, if `useMyHireOrders`
 * (Task 11 — issued/countersigned only) has one. No issue/generate controls, ever;
 * download is the only action. Renders nothing without a matching order.
 */
function ArtistHireOrders({ showDateId }: Props) {
  const { currentOrg } = useAuth();
  const orgId = currentOrg?.id ?? "";
  const { data: myOrders } = useMyHireOrders();
  const action = useHireOrderAction();

  const order = (myOrders ?? []).find((o) => o.show_date_id === showDateId);
  if (!order) return null;

  function handleDownload() {
    void (async () => {
      const res = await action.mutateAsync({ action: "download-url", org_id: orgId, order_id: order!.id });
      const url = (res as { url?: string } | null)?.url;
      if (url) window.open(url, "_blank", "noopener,noreferrer");
    })().catch(() => {
      /* useHireOrderAction toasts the failure */
    });
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="font-display text-lg flex items-center gap-2">
          <FileText className="h-5 w-5" />Hire order
        </CardTitle>
      </CardHeader>
      <CardContent>
        <div className="flex items-center justify-between gap-3 rounded-lg border border-border p-3">
          <p className="text-sm font-mono text-muted-foreground">{order.order_no}</p>
          <div className="flex items-center gap-2 shrink-0">
            <StatusBadge status={order.status} />
            <Button size="sm" variant="outline" onClick={handleDownload} disabled={action.isPending}>
              Download
            </Button>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

function ProducerHireOrders({ showDateId, showDate, bookings, canManage }: Props) {
  const { currentOrg } = useAuth();
  const orgId = currentOrg?.id ?? "";
  const producerName = currentOrg?.name ?? "";

  const { data: orders, isLoading, isError, error } = useHireOrdersForDate(showDateId);
  const action = useHireOrderAction();
  const [dialogOrder, setDialogOrder] = useState<HireOrderRow | null>(null);

  // An "active" order occupies a booking until it is voided.
  const bookedByActiveOrder = new Set(
    (orders ?? []).filter((o) => o.status !== "void" && o.booking_id).map((o) => o.booking_id),
  );
  const confirmed = bookings.filter((b) => b.status === "confirmed");
  const pendingConfirmed = confirmed.filter((b) => !bookedByActiveOrder.has(b.id));
  const showBanner = pendingConfirmed.length > 0;
  const fullyFilled = showDate.status === "fully_filled";

  function handleGenerate() {
    action.mutate({ action: "draft", org_id: orgId, show_date_id: showDateId });
  }

  function handleDownload(orderId: string) {
    void (async () => {
      const res = await action.mutateAsync({ action: "download-url", org_id: orgId, order_id: orderId });
      const url = (res as { url?: string } | null)?.url;
      if (url) window.open(url, "_blank", "noopener,noreferrer");
    })().catch(() => {
      /* useHireOrderAction toasts the failure */
    });
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="font-display text-lg flex items-center gap-2">
          <FileText className="h-5 w-5" />Hire orders
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        {isError ? (
          <Alert variant="destructive">
            <AlertTitle>Could not load hire orders</AlertTitle>
            <AlertDescription>{(error as Error)?.message ?? "Please try again."}</AlertDescription>
          </Alert>
        ) : isLoading ? (
          <div className="space-y-2">
            <Skeleton className="h-16 w-full" />
            <Skeleton className="h-12 w-full" />
          </div>
        ) : (
          <>
            {showBanner && (
              <div className="rounded-lg border border-accent-200 bg-accent-50 p-4 flex items-start gap-3">
                <Sparkles className="h-5 w-5 text-accent-700 shrink-0 mt-0.5" />
                <div className="flex-1 space-y-2">
                  <p className="text-sm font-medium text-accent-700">
                    {fullyFilled
                      ? "This date is fully filled and ready for hire orders"
                      : "Generate for confirmed artists"}
                  </p>
                  <Button size="sm" onClick={handleGenerate} disabled={action.isPending}>
                    Generate hire orders
                  </Button>
                </div>
              </div>
            )}

            {(orders ?? []).length > 0 ? (
              <div className="space-y-2">
                {(orders ?? []).map((o) => (
                  <div
                    key={o.id}
                    className="flex items-center justify-between gap-3 rounded-lg border border-border p-3"
                  >
                    <div className="min-w-0">
                      <p className="text-sm font-medium text-foreground truncate">
                        {o.artists?.name ?? "Unknown artist"}
                      </p>
                      <p className="text-xs font-mono text-muted-foreground">{o.order_no}</p>
                    </div>
                    <div className="flex items-center gap-2 shrink-0">
                      <StatusBadge status={o.status} />
                      {(o.status === "draft" || o.status === "ready") && (
                        <Button size="sm" variant="outline" onClick={() => setDialogOrder(o)}>
                          Review and issue
                        </Button>
                      )}
                      {(o.status === "issued" || o.status === "countersigned") && (
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() => handleDownload(o.id)}
                          disabled={action.isPending}
                        >
                          Download
                        </Button>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              !showBanner && (
                <p className="text-sm text-muted-foreground">No hire orders yet.</p>
              )
            )}
          </>
        )}
      </CardContent>

      {dialogOrder && canManage && (
        <GenerateHireOrderDialog
          key={dialogOrder.id}
          open={!!dialogOrder}
          onOpenChange={(o) => { if (!o) setDialogOrder(null); }}
          order={dialogOrder}
          showDate={showDate}
          orgId={orgId}
          producerName={producerName}
        />
      )}
    </Card>
  );
}
