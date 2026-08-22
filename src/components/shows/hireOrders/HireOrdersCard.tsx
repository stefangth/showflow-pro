import { useState } from "react";
import { useTranslation } from "react-i18next";
import { FileText } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { useAuth } from "@/features/auth/AuthContext";
import { useCan } from "@/hooks/useCapabilities";
import { useFeature } from "@/hooks/useEntitlements";
import { useHireOrdersForDate, useHireOrderAction, useMyHireOrders } from "@/hooks/useHireOrders";
import type { HireOrderRow } from "@/data/hireOrders";
import { HireOrderStatusBadge } from "@/components/hireOrders/HireOrderStatusBadge";
import { HireOrderReadyBanner } from "@/components/hireOrders/HireOrderReadyBanner";
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

/**
 * Read-only artist variant: the viewer's own order for this date, if `useMyHireOrders`
 * (Task 11 — issued/countersigned only) has one. No issue/generate controls, ever;
 * download is the only action. Renders nothing without a matching order.
 */
function ArtistHireOrders({ showDateId }: Props) {
  const { t } = useTranslation("hireOrdersPages");
  const { currentOrg } = useAuth();
  const orgId = currentOrg?.id ?? "";
  const { data: myOrders } = useMyHireOrders();
  const action = useHireOrderAction();

  const order = (myOrders ?? []).find((o) =>
    o.show_date_id === showDateId ||
    o.hire_order_dates?.some((date) => date.show_date_id === showDateId)
  );
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
    <Card elevation={2}>
      <CardHeader>
        <CardTitle className="font-display text-lg flex items-center gap-2">
          <FileText className="h-5 w-5" />{t("ordersCard.hireOrder")}
        </CardTitle>
      </CardHeader>
      <CardContent>
        <div className="flex items-center justify-between gap-3 rounded-l border border-border p-3">
          <p className="text-sm font-mono text-muted-foreground">{order.order_no}</p>
          <div className="flex items-center gap-2 shrink-0">
            <HireOrderStatusBadge status={order.status} />
            <Button size="sm" variant="outline" onClick={handleDownload} disabled={action.isPending}>
              {t("common.download")}
            </Button>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

function ProducerHireOrders({ showDateId, showDate, bookings, canManage }: Props) {
  const { t } = useTranslation("hireOrdersPages");
  const { currentOrg } = useAuth();
  const orgId = currentOrg?.id ?? "";
  const producerName = currentOrg?.name ?? "";
  const canGenerate = useCan("generate_hire_orders");

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
  // Name the single confirmed artist in the banner copy; fall back to a generic
  // phrase when several artists are confirmed on the date.
  const confirmedNames = confirmed.map((b) => b.artist?.name).filter((n): n is string => !!n);
  const recipientPhrase = confirmedNames.length === 1 ? confirmedNames[0] : t("ordersCard.recipientPhrase");

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
    <Card elevation={2}>
      <CardHeader>
        <CardTitle className="font-display text-lg flex items-center gap-2">
          <FileText className="h-5 w-5" />{t("ordersCard.hireOrders")}
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        {isError ? (
          <Alert variant="destructive">
            <AlertTitle>{t("ordersCard.loadError")}</AlertTitle>
            <AlertDescription>{(error as Error)?.message ?? t("ordersCard.tryAgain")}</AlertDescription>
          </Alert>
        ) : isLoading ? (
          <div className="space-y-2">
            <Skeleton className="h-16 w-full" />
            <Skeleton className="h-12 w-full" />
          </div>
        ) : (
          <>
            {showBanner && (
              <HireOrderReadyBanner
                title={fullyFilled
                  ? t("ordersCard.bannerFullyFilled")
                  : t("ordersCard.bannerGenerate")}
                description={t("ordersCard.bannerDescription", { recipient: recipientPhrase })}
                ctaLabel={t("ordersCard.generateCta")}
                onCta={handleGenerate}
                disabled={action.isPending || !canGenerate}
                ctaTitle={canGenerate ? undefined : t("ordersCard.noPermissionGenerate")}
              />
            )}

            {(orders ?? []).length > 0 ? (
              <div className="space-y-2">
                {(orders ?? []).map((o) => (
                  <div
                    key={o.id}
                    className="flex items-center justify-between gap-3 rounded-l border border-border p-3"
                  >
                    <div className="min-w-0">
                      <p className="text-sm font-medium text-foreground truncate">
                        {o.artists?.name ?? t("common.unknownArtist")}
                      </p>
                      <p className="text-xs font-mono text-muted-foreground">{o.order_no}</p>
                    </div>
                    <div className="flex items-center gap-2 shrink-0">
                      <HireOrderStatusBadge status={o.status} />
                      {(o.status === "draft" || o.status === "ready") && (
                        <Button size="sm" variant="outline" onClick={() => setDialogOrder(o)}>
                          {t("common.reviewAndIssue")}
                        </Button>
                      )}
                      {(o.status === "issued" || o.status === "countersigned") && (
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() => handleDownload(o.id)}
                          disabled={action.isPending}
                        >
                          {t("common.download")}
                        </Button>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              !showBanner && (
                <p className="text-sm text-muted-foreground">{t("ordersCard.noOrdersYet")}</p>
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
