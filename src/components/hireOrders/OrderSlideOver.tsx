import { useState } from "react";
import { Download, Eye, Pencil, Send } from "lucide-react";
import { useNavigate } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription,
  AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { HireOrderStatusBadge } from "@/components/hireOrders/HireOrderStatusBadge";
import { Token } from "@/components/ui/token";
import { OrderFactsRail } from "@/components/hireOrders/OrderFactsRail";
import { IssuePreflightSheet, type PreflightOrder } from "./IssuePreflightSheet";
import { formatMoney } from "@/lib/hireOrders/money";
import { formatDateDMY, formatTimestampLocal } from "@/lib/dates";
import type { OrderData } from "@/lib/hireOrders/types";
import type { HireOrderListRow } from "@/data/hireOrders";
import { useCan } from "@/hooks/useCapabilities";
import { useHireOrderAction, useMarkCountersigned, useVoidHireOrder, useHireOrderCountersignMode } from "@/hooks/useHireOrders";
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
 *
 * `<Sheet>` stays mounted unconditionally, driven purely by `open` (mirrors
 * ArtistProfileSheet) — it must NOT be gated behind `order` being non-null.
 * HireOrdersPage nulls the selected order in the very same state update that
 * flips `open` to false, so bailing out with `if (!order) return null` before
 * rendering `<Sheet>` unmounted the whole Radix Portal synchronously and ate
 * the slide-out transition. `displayOrder` caches the last non-null order so
 * the panel keeps showing its real content while it animates closed, instead
 * of the content going blank one tick before the panel itself disappears.
 */
export function OrderSlideOver({ order, open, onOpenChange, orgId }: Props) {
  const { t, i18n } = useTranslation("hireOrdersPages");
  const navigate = useNavigate();
  const action = useHireOrderAction();
  const countersign = useMarkCountersigned();
  const voidOrder = useVoidHireOrder();
  const canIssue = useCan("issue_hire_orders");
  const canVoid = useCan("void_hire_orders");
  // Electronic-mode orders complete via the artist's in-app signature, so the
  // manual "Mark countersigned" one-click flip (which would skip the e-sign
  // audit trail) is withheld in that mode. Manual mode keeps it.
  const countersignMode = useHireOrderCountersignMode(orgId);

  const [preflightOpen, setPreflightOpen] = useState(false);

  // Latch the last non-null order so the panel keeps showing real content while it
  // animates closed (HireOrdersPage nulls `order` in the same update that flips
  // `open` to false). React's "adjust state during render" pattern: only advance
  // when a new order arrives, so `displayOrder` retains the previous value once
  // `order` goes null — without a render-time ref write (react-hooks/refs).
  const [displayOrder, setDisplayOrder] = useState<HireOrderListRow | null>(order);
  if (order && order !== displayOrder) setDisplayOrder(order);

  // Follow the mode the order was ISSUED under (frozen in issue_snapshot), not the
  // org's current setting — an electronic-issued order keeps the manual flip withheld
  // even if the org later switched to manual. Legacy/null snapshots fall back to the
  // live setting.
  const orderMode = (displayOrder?.issue_snapshot as { countersign_mode?: string } | null)?.countersign_mode;
  const isElectronic = (orderMode ?? countersignMode.data?.mode) === "electronic";

  const data = (displayOrder?.data ?? {}) as OrderData;
  const artistName = displayOrder?.artists?.name || snap(data, "artist_name") || t("common.unknownArtist");
  const email = snap(data, "recipient_email");
  const venue = displayOrder?.show_dates?.venue || snap(data, "venue");
  const dateStr = displayOrder?.show_dates?.date || snap(data, "date");
  const durationRaw = snap(data, "duration_min");
  const duration = durationRaw ? `${durationRaw} min` : null;
  const sessions = snap(data, "sessions") || null;
  const fee = displayOrder?.fee_amount != null ? formatMoney(displayOrder.fee_amount, displayOrder.fee_currency, i18n.language) : null;

  function handleIssue() {
    if (!displayOrder) return;
    setPreflightOpen(true);
  }

  function performIssue() {
    if (!displayOrder) return;
    action.mutate(
      { action: "issue", org_id: orgId, order_ids: [displayOrder.id] },
      {
        onSuccess: () => {
          setPreflightOpen(false);
          onOpenChange(false);
        },
      },
    );
  }

  async function handleDownload() {
    if (!displayOrder) return;
    try {
      const res = await action.mutateAsync({ action: "download-url", org_id: orgId, order_id: displayOrder.id });
      const url = (res as { url?: string } | null)?.url;
      if (url) window.open(url, "_blank", "noopener,noreferrer");
    } catch {
      // useHireOrderAction already toasts the failure.
    }
  }

  function handleCountersign() {
    if (!displayOrder) return;
    countersign.mutate(displayOrder.id, { onSuccess: () => onOpenChange(false) });
  }

  function handleVoid() {
    if (!displayOrder) return;
    voidOrder.mutate(displayOrder.id, { onSuccess: () => onOpenChange(false) });
  }

  function handleEdit() {
    if (!displayOrder) return;
    onOpenChange(false);
    navigate(ROUTES.HIRE_ORDER_EDIT.replace(":id", displayOrder.id));
  }

  function handleView() {
    if (!displayOrder) return;
    onOpenChange(false);
    navigate(ROUTES.HIRE_ORDER_DETAIL.replace(":id", displayOrder.id));
  }

  function handleResend() {
    if (!displayOrder) return;
    action.mutate({ action: "resend", org_id: orgId, order_id: displayOrder.id });
  }

  return (
    <>
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent className="w-full overflow-y-auto sm:max-w-md">
        {displayOrder && (
          <>
            <SheetHeader>
              <div className="flex items-center gap-2">
                <SheetTitle className="text-base"><Token>{displayOrder.order_no}</Token></SheetTitle>
                <HireOrderStatusBadge status={displayOrder.status} />
              </div>
            </SheetHeader>

            <div className="mt-6 space-y-6">
              <dl className="grid grid-cols-2 gap-4 text-sm">
                <div>
                  {/* eslint-disable-next-line no-restricted-syntax -- dl/dt field label, not a standard eyebrow (12px/tracking-wide, no font-semibold) */}
                  <dt className="text-xs uppercase tracking-wide text-muted-foreground">{t("slideOver.artist")}</dt>
                  <dd className="mt-0.5 text-foreground">{artistName}</dd>
                </div>
                {email && (
                  <div>
                    {/* eslint-disable-next-line no-restricted-syntax -- dl/dt field label, not a standard eyebrow */}
                    <dt className="text-xs uppercase tracking-wide text-muted-foreground">{t("slideOver.email")}</dt>
                    <dd className="mt-0.5 break-words text-foreground">{email}</dd>
                  </div>
                )}
                <div>
                  {/* eslint-disable-next-line no-restricted-syntax -- dl/dt field label, not a standard eyebrow */}
                  <dt className="text-xs uppercase tracking-wide text-muted-foreground">{t("slideOver.venue")}</dt>
                  <dd className="mt-0.5 text-foreground">{venue || t("common.notSet")}</dd>
                </div>
                <div>
                  {/* eslint-disable-next-line no-restricted-syntax -- dl/dt field label, not a standard eyebrow */}
                  <dt className="text-xs uppercase tracking-wide text-muted-foreground">{t("slideOver.date")}</dt>
                  <dd className="mt-0.5 tabular-nums text-foreground">{dateStr ? formatDateDMY(dateStr) : t("common.notSet")}</dd>
                </div>
              </dl>

              <OrderFactsRail fee={fee} duration={duration} sessions={sessions} />

              <div>
                {/* eslint-disable-next-line no-restricted-syntax -- section subheading, not a standard eyebrow (12px/tracking-wide, font-medium not font-semibold) */}
                <h3 className="text-xs font-medium uppercase tracking-wide text-muted-foreground">{t("slideOver.delivery")}</h3>
                <dl className="mt-3 space-y-3 text-sm">
                  <div className="flex items-baseline justify-between gap-3">
                    <dt className="text-muted-foreground">{t("slideOver.created")}</dt>
                    <dd className="text-right text-foreground">
                      {displayOrder.created_at ? formatTimestampLocal(displayOrder.created_at) : t("slideOver.notAvailable")}
                    </dd>
                  </div>
                  <div className="flex items-baseline justify-between gap-3">
                    <dt className="text-muted-foreground">{t("slideOver.lastSent")}</dt>
                    <dd className="text-right text-foreground">
                      {displayOrder.last_sent_at ? formatTimestampLocal(displayOrder.last_sent_at) : t("slideOver.notSentYet")}
                    </dd>
                  </div>
                </dl>
              </div>

              <div className="space-y-2">
                {(displayOrder.status === "draft" || displayOrder.status === "ready") && (
                  <>
                    <Button variant="outline" className="w-full" onClick={handleEdit}>
                      <Pencil className="mr-1 h-4 w-4" /> {t("slideOver.edit")}
                    </Button>
                    <Button className="w-full" onClick={handleIssue} disabled={action.isPending || !canIssue}
                      title={canIssue ? undefined : t("common.noPermissionIssue")}>
                      {t("common.issueAndSend")}
                    </Button>
                  </>
                )}
                {displayOrder.status === "issued" && (
                  <>
                    <Button variant="outline" className="w-full" onClick={handleView}>
                      <Eye className="mr-1 h-4 w-4" /> {t("slideOver.view")}
                    </Button>
                    <Button variant="outline" className="w-full" onClick={handleDownload} disabled={action.isPending}>
                      <Download className="mr-1 h-4 w-4" /> {t("common.download")}
                    </Button>
                    <Button variant="outline" className="w-full" onClick={handleResend} disabled={action.isPending}>
                      <Send className="mr-1 h-4 w-4" /> {t("slideOver.resend")}
                    </Button>
                    {!isElectronic && (
                      <Button className="w-full" onClick={handleCountersign} disabled={countersign.isPending}>
                        {t("common.markCountersigned")}
                      </Button>
                    )}
                  </>
                )}
                {displayOrder.status === "countersigned" && (
                  <>
                    <Button variant="outline" className="w-full" onClick={handleView}>
                      <Eye className="mr-1 h-4 w-4" /> {t("slideOver.view")}
                    </Button>
                    <Button variant="outline" className="w-full" onClick={handleDownload} disabled={action.isPending}>
                      <Download className="mr-1 h-4 w-4" /> {t("common.download")}
                    </Button>
                    <Button variant="outline" className="w-full" onClick={handleResend} disabled={action.isPending}>
                      <Send className="mr-1 h-4 w-4" /> {t("slideOver.resend")}
                    </Button>
                  </>
                )}
                {displayOrder.status !== "void" && (
                  <AlertDialog>
                    <AlertDialogTrigger asChild>
                      <Button variant="outline" className="w-full text-destructive hover:text-destructive" disabled={!canVoid}
                        title={canVoid ? undefined : t("slideOver.noPermissionVoid")}>
                        {t("slideOver.void")}
                      </Button>
                    </AlertDialogTrigger>
                    <AlertDialogContent>
                      <AlertDialogHeader>
                        <AlertDialogTitle>{t("slideOver.voidTitle")}</AlertDialogTitle>
                        <AlertDialogDescription>
                          {t("slideOver.voidDescription")}
                        </AlertDialogDescription>
                      </AlertDialogHeader>
                      <AlertDialogFooter>
                        <AlertDialogCancel>{t("common.cancel")}</AlertDialogCancel>
                        <AlertDialogAction onClick={handleVoid}>{t("slideOver.voidOrder")}</AlertDialogAction>
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
    <IssuePreflightSheet
      open={preflightOpen}
      onOpenChange={setPreflightOpen}
      orgId={orgId}
      order={
        displayOrder
          ? ({
              id: displayOrder.id,
              order_no: displayOrder.order_no,
              artistName,
              data,
              terms_variant: displayOrder.terms_variant,
            } satisfies PreflightOrder)
          : null
      }
      onConfirm={performIssue}
      isIssuing={action.isPending}
    />
    </>
  );
}
