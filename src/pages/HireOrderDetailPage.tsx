import { useEffect, useState } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { useQuery } from "@tanstack/react-query";
import { ArrowLeft, Download, FileText, CheckCircle2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { IconTooltip } from "@/components/common/IconTooltip";
import { Card, CardContent } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { useAuth } from "@/features/auth/AuthContext";
import { useCan } from "@/hooks/useCapabilities";
import {
  useHireOrder,
  useHireOrderAction,
  useMarkCountersigned,
  useHireOrderCountersignMode,
  useMarkHireOrderSeen,
} from "@/hooks/useHireOrders";
import { useMyArtist } from "@/hooks/useMyArtist";
import { canArtistSign } from "@/lib/hireOrders/signing";
import { SignHireOrderDialog } from "@/components/hireOrders/SignHireOrderDialog";
import { invokeHireOrderAction, type HireOrderRow } from "@/data/hireOrders";
import { supabase } from "@/integrations/supabase/client";
import { formatMoney } from "@/lib/hireOrders/money";
import { formatDateDMY } from "@/lib/dates";
import { ROUTES } from "@/config/app.config";
import type { OrderData } from "@/lib/hireOrders/types";
import { OrderTimeline } from "@/components/hireOrders/OrderTimeline";
import { OrderFactsRail } from "@/components/hireOrders/OrderFactsRail";
import { HireOrderStatusBadge } from "@/components/hireOrders/HireOrderStatusBadge";

/** Read a resolved snapshot field as a trimmed string ("" when absent). */
function snap(data: OrderData, key: keyof OrderData): string {
  const v = data[key]?.value;
  if (v === null || v === undefined) return "";
  return String(v);
}

/**
 * Full-page hire-order document viewer at `/hire-orders/:id`. This is where the
 * issued-order email (Task 8) and artist notifications land. Layout follows the
 * V3 design: a header strip, then a `1fr 312px` grid of the embedded PDF (left)
 * and a status rail (right).
 *
 * Access is enforced by RLS: `useHireOrder` fails for an order the caller cannot
 * see (a non-owned order for an artist, a cross-org order), so the destructive
 * Alert IS the access-denied path — there is deliberately no separate
 * client-side ownership check.
 */
export default function HireOrderDetailPage() {
  const { t } = useTranslation("hireOrdersPages");
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { currentOrg, hasRole } = useAuth();
  const orgId = currentOrg?.id ?? "";
  // Gates only the "Mark countersigned" control below -- the broad canManage
  // producer/admin-vs-artist split (Edit visibility, the download fallback) is unchanged.
  const canManageCountersign = useCan("manage_countersign");

  const { data: order, isLoading, isError, error } = useHireOrder(id);
  const action = useHireOrderAction();
  const countersign = useMarkCountersigned();
  const countersignMode = useHireOrderCountersignMode(orgId);
  const { data: myArtist } = useMyArtist();
  const canManage = hasRole("admin") || hasRole("producer");
  // Whether the current viewer is the artist this order is issued to -- shared
  // by the signing gate below and the seen-stamping effect further down.
  const isLinkedArtist = !!myArtist && !!order && myArtist.id === order.artist_id;
  // The signing mode follows the mode the order was ISSUED under (frozen in
  // issue_snapshot), not the org's current setting — so an electronic-issued order
  // keeps showing "Review & sign" to the artist and hiding the manual "Mark
  // countersigned" flip from producers even if the org later switched to manual (which
  // would otherwise strand the order against the DB gate). Legacy/null snapshots fall
  // back to the live org setting.
  const orderMode = (order?.issue_snapshot as { countersign_mode?: string } | null)?.countersign_mode;
  const effectiveMode = orderMode ?? countersignMode.data?.mode ?? "manual";
  const canSign = order
    ? canArtistSign({
        canManage,
        status: order.status,
        mode: effectiveMode,
        isLinkedArtist,
      })
    : false;

  const hasPdf = !!order?.pdf_path;

  // Signed URL for the embedded PDF. Lives 3600s server-side; refresh well
  // before expiry (staleTime 45min). Only fetched once the order is loaded and
  // actually has a rendered PDF (draft orders have none).
  const pdfUrl = useQuery({
    queryKey: ["hire-orders", "pdf-url", id],
    enabled: !!id && hasPdf && !!orgId,
    staleTime: 45 * 60 * 1000,
    queryFn: async () => {
      const res = await invokeHireOrderAction(supabase, {
        action: "download-url",
        org_id: orgId,
        order_id: id,
      });
      return (res as { url?: string } | null)?.url ?? null;
    },
  });

  const markSeen = useMarkHireOrderSeen();
  // Stamp `viewed_at` the first time the linked artist opens an issued or
  // countersigned order. Guarded on all four conditions inside the body, not
  // by the dependency array: once the mutation succeeds it busts the
  // hire-orders domain, `order.viewed_at` comes back non-null on the refetch,
  // and the `viewed_at == null` check is what stops a second fire -- not the
  // deps changing. Never runs for a producer/admin viewer (isLinkedArtist is
  // false for them) or for a draft/ready/void order.
  useEffect(() => {
    if (!order || !isLinkedArtist) return;
    if (order.status !== "issued" && order.status !== "countersigned") return;
    if (order.viewed_at != null) return;
    markSeen.mutate(order.id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [order?.id, order?.status, order?.viewed_at, isLinkedArtist]);

  // The panel must not sit on the Skeleton forever: fold both known failure
  // modes into one flag — a genuine query error (edge 500) AND the permanently
  // -disabled case where a super-admin has no current org selected (org_id
  // resolves to "", so the query never even attempts the fetch and would
  // otherwise never leave isLoading===false / data===undefined).
  const pdfUrlError = pdfUrl.isError || (hasPdf && !orgId);

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

  if (isLoading) {
    return (
      <div className="mx-auto max-w-6xl space-y-6 p-4 sm:p-6">
        <Skeleton className="h-10 w-64" />
        <div className="grid grid-cols-1 gap-6 lg:grid-cols-[1fr_312px]">
          <Skeleton className="h-[600px] w-full" />
          <div className="space-y-4">
            <Skeleton className="h-40 w-full" />
            <Skeleton className="h-28 w-full" />
          </div>
        </div>
      </div>
    );
  }

  if (isError || !order) {
    return (
      <div className="mx-auto max-w-6xl p-4 sm:p-6">
        <Button variant="ghost" size="sm" className="mb-4 -ml-2" onClick={() => navigate(-1)}>
          <ArrowLeft className="mr-1 h-4 w-4" /> {t("common.back")}
        </Button>
        <Alert variant="destructive">
          <AlertTitle>{t("detailPage.loadErrorTitle")}</AlertTitle>
          <AlertDescription>
            {(error as Error)?.message ??
              t("detailPage.loadErrorBody")}
          </AlertDescription>
        </Alert>
      </div>
    );
  }

  // Electronic-mode orders complete via the artist's in-app signature (consent +
  // audit row + signed PDF), so the manual "Mark countersigned" one-click flip is
  // hidden for managers in that mode — it would bypass the whole e-sign trail. Keyed
  // off the order's issue-time mode (see effectiveMode above), not the live setting.
  const isElectronic = effectiveMode === "electronic";

  return <HireOrderDetail order={order} canManage={canManage} canSign={canSign} orgId={orgId}
    canManageCountersign={canManageCountersign}
    isElectronic={isElectronic}
    navigateBack={() => navigate(-1)}
    onEdit={() => navigate(ROUTES.HIRE_ORDER_EDIT.replace(":id", order.id))}
    onDownload={handleDownload}
    downloadBusy={action.isPending}
    onCountersign={() => countersign.mutate(order.id)}
    countersignBusy={countersign.isPending}
    pdfUrl={pdfUrl.data ?? null}
    pdfUrlLoading={pdfUrl.isLoading}
    pdfUrlError={pdfUrlError}
    hasPdf={hasPdf}
  />;
}

interface DetailProps {
  order: HireOrderRow;
  canManage: boolean;
  canManageCountersign: boolean;
  canSign: boolean;
  orgId: string;
  isElectronic: boolean;
  navigateBack: () => void;
  onEdit: () => void;
  onDownload: () => void;
  downloadBusy: boolean;
  onCountersign: () => void;
  countersignBusy: boolean;
  pdfUrl: string | null;
  pdfUrlLoading: boolean;
  pdfUrlError: boolean;
  hasPdf: boolean;
}

/** The loaded-state body — split out so the page shell handles loading/error
 *  and this renders the header + document grid for a known-good order. */
function HireOrderDetail({
  order, canManage, canManageCountersign, canSign, orgId, isElectronic, navigateBack, onEdit, onDownload, downloadBusy,
  onCountersign, countersignBusy, pdfUrl, pdfUrlLoading, pdfUrlError, hasPdf,
}: DetailProps) {
  const { t, i18n } = useTranslation("hireOrdersPages");
  const [signOpen, setSignOpen] = useState(false);
  const data = (order.data ?? {}) as OrderData;
  const artistName = order.artists?.name || snap(data, "artist_name") || t("common.unknownArtist");
  const email = snap(data, "recipient_email");
  const venue = snap(data, "venue");
  const dateStr = snap(data, "date");
  const durationRaw = snap(data, "duration_min");
  const duration = durationRaw ? t("common.minutes", { value: durationRaw }) : null;
  const sessions = snap(data, "sessions") || null;
  const fee = order.fee_amount != null ? formatMoney(order.fee_amount, order.fee_currency, i18n.language) : null;

  const subtitleParts = [
    <span key="no" className="font-mono">{order.order_no}</span>,
    artistName,
    venue,
    dateStr ? <span key="date" className="font-mono">{formatDateDMY(dateStr)}</span> : null,
  ].filter(Boolean);

  return (
    <div className="mx-auto max-w-6xl space-y-6 p-4 sm:p-6">
      {/* Header strip */}
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="flex items-start gap-2 min-w-0">
          <IconTooltip label={t("common.goBack")}>
            <Button variant="ghost" size="icon" className="mt-0.5 shrink-0" onClick={navigateBack} aria-label={t("common.goBack")}>
              <ArrowLeft className="h-5 w-5" />
            </Button>
          </IconTooltip>
          <div className="min-w-0">
            <div className="flex items-center gap-3">
              <h1 className="font-display text-xl text-foreground">{t("detailPage.title")}</h1>
              <HireOrderStatusBadge status={order.status} />
            </div>
            <p className="mt-1 flex flex-wrap items-center gap-x-1.5 text-sm text-muted-foreground">
              {subtitleParts.map((part, i) => (
                <span key={i} className="flex items-center gap-x-1.5">
                  {i > 0 && <span aria-hidden="true">·</span>}
                  {part}
                </span>
              ))}
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          {canManage && (order.status === "draft" || order.status === "ready") && (
            <Button variant="outline" size="sm" onClick={onEdit}>
              {t("detailPage.edit")}
            </Button>
          )}
          <Button variant="outline" size="sm" onClick={onDownload} disabled={!hasPdf || downloadBusy}>
            <Download className="mr-1 h-4 w-4" /> {t("common.download")}
          </Button>
        </div>
      </div>

      {/* Document + rail */}
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-[1fr_312px]">
        {/* LEFT: the embedded PDF on a paper-tinted desk */}
        <div className="rounded-xl border border-border bg-muted p-3 sm:p-4">
          {!hasPdf ? (
            <div className="flex min-h-[480px] flex-col items-center justify-center gap-2 text-center">
              <FileText className="h-8 w-8 text-muted-foreground" />
              <p className="text-sm font-medium text-foreground">{t("detailPage.notIssuedTitle")}</p>
              <p className="max-w-xs text-sm text-muted-foreground">
                {t("detailPage.notIssuedBody")}
              </p>
            </div>
          ) : pdfUrlError ? (
            <div className="flex min-h-[480px] flex-col items-center justify-center gap-2 text-center">
              <FileText className="h-8 w-8 text-muted-foreground" />
              <p className="text-sm font-medium text-foreground">{t("detailPage.previewErrorTitle")}</p>
              <p className="max-w-xs text-sm text-muted-foreground">
                {t("detailPage.previewErrorBody")}
              </p>
            </div>
          ) : pdfUrlLoading || !pdfUrl ? (
            <Skeleton className="h-[600px] w-full rounded-lg" />
          ) : (
            <iframe
              title={t("detailPage.iframeTitle")}
              src={pdfUrl}
              className="h-[600px] w-full rounded-lg border border-border bg-background lg:h-[720px]"
            />
          )}
          {canSign && (
            <div className="mt-3 rounded-lg border border-accent-200 bg-accent-50 p-4">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div className="min-w-0">
                  <p className="text-sm font-semibold text-accent-700">{t("detailPage.needsSignatureTitle")}</p>
                  <p className="mt-0.5 text-sm text-muted-foreground">
                    {t("detailPage.needsSignatureBody")}
                  </p>
                </div>
                <Button className="shrink-0" onClick={() => setSignOpen(true)}>
                  {t("detailPage.countersign")}
                </Button>
              </div>
            </div>
          )}
        </div>

        {/* RIGHT: status rail */}
        <aside className="space-y-4">
          <Card>
            <CardContent className="space-y-4">
              <OrderTimeline
                status={order.status}
                createdAt={order.created_at}
                issuedAt={order.issued_at}
                seenAt={order.viewed_at}
                countersignedAt={order.countersigned_at}
              />
            </CardContent>
          </Card>

          <Card>
            <CardContent className="space-y-1">
              <h3 className="text-xs font-medium uppercase tracking-wide text-muted-foreground">{t("detailPage.recipient")}</h3>
              <p className="text-sm font-medium text-foreground">{artistName}</p>
              {email && <p className="text-sm text-muted-foreground break-words">{email}</p>}
            </CardContent>
          </Card>

          <Card>
            <CardContent className="space-y-5">
              <OrderFactsRail fee={fee} duration={duration} sessions={sessions} />
              <PrimaryAction
                canManage={canManage}
                canManageCountersign={canManageCountersign}
                status={order.status}
                isElectronic={isElectronic}
                hasPdf={hasPdf}
                onDownload={onDownload}
                downloadBusy={downloadBusy}
                onCountersign={onCountersign}
                countersignBusy={countersignBusy}
              />
            </CardContent>
          </Card>
        </aside>
      </div>
      {canSign && (
        <SignHireOrderDialog orderId={order.id} orgId={orgId} open={signOpen} onOpenChange={setSignOpen} />
      )}
    </div>
  );
}

interface ActionProps {
  canManage: boolean;
  canManageCountersign: boolean;
  status: string;
  isElectronic: boolean;
  hasPdf: boolean;
  onDownload: () => void;
  downloadBusy: boolean;
  onCountersign: () => void;
  countersignBusy: boolean;
}

/** The role- and status-driven primary control in the rail. Producers/admins
 *  can mark an issued order countersigned in MANUAL mode (and see a confirmation
 *  once done); in electronic mode that manual flip is withheld — the order must
 *  be completed by the artist's in-app signature, so a manager sees only a hint.
 *  The linked artist's own signing affordance lives in the strip directly under
 *  the document (see `canSign` in `HireOrderDetail`), not here, so a signer never
 *  reaches this component's branches -- it falls through to the plain download
 *  control below like any other non-manager viewer. `canManageCountersign` gates
 *  the Mark-countersigned action itself, on top of the broad producer/admin split. */
function PrimaryAction({
  canManage, canManageCountersign, status, isElectronic, hasPdf, onDownload, downloadBusy, onCountersign, countersignBusy,
}: ActionProps) {
  const { t } = useTranslation("hireOrdersPages");
  if (canManage && status === "issued") {
    // Electronic mode: the artist completes the order in-app; no manual flip.
    if (isElectronic) {
      return <p className="text-sm text-muted-foreground">{t("detailPage.awaitingArtistSignature")}</p>;
    }
    return (
      <Button className="w-full" onClick={onCountersign} disabled={countersignBusy || !canManageCountersign}
        title={canManageCountersign ? undefined : t("detailPage.noPermissionCountersign")}>
        {t("common.markCountersigned")}
      </Button>
    );
  }
  if (canManage && status === "countersigned") {
    return (
      <div className="flex items-center gap-2 rounded-lg border border-[var(--green-600-a30)] bg-[var(--green-100)] px-3 py-2 text-sm font-medium text-[var(--green-600)]">
        <CheckCircle2 className="h-4 w-4 shrink-0" />
        {t("detailPage.countersignedByArtist")}
      </div>
    );
  }
  if (!canManage) {
    return (
      <Button className="w-full" onClick={onDownload} disabled={!hasPdf || downloadBusy}>
        <Download className="mr-1 h-4 w-4" /> {t("detailPage.downloadPdf")}
      </Button>
    );
  }
  // Producer/admin on a draft/ready/void order: no primary action here.
  return null;
}
