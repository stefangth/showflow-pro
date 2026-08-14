import { useNavigate } from "react-router-dom";
import { useTranslation } from "react-i18next";
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
  const { t } = useTranslation("hireOrdersPages");
  const navigate = useNavigate();
  const { blockers, isLoading, isError } = useOrderBlockers(orgId, order);
  // `!!order` is part of the claim, not a caller's job: with no order there is nothing
  // to check, and useOrderBlockers returns an empty list for it. Without this the sheet
  // would announce "Ready to issue" and enable the button for an order it never saw.
  const clean = !!order && blockers.length === 0 && !isError;

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent className="flex w-full flex-col gap-0 sm:max-w-lg">
        <SheetHeader className="text-left">
          <p className="font-mono text-xs text-muted-foreground">
            {order?.order_no ?? t("preflightSheet.draftFallback")} · {order?.artistName ?? ""}
          </p>
          <SheetTitle className="font-display">
            {isLoading
              ? t("preflightSheet.checking")
              : isError
                ? t("preflightSheet.checkError")
                : clean
                  ? t("preflightSheet.readyToIssue")
                  : blockers.length === 1
                    ? t("preflightSheet.settleOne")
                    : t("preflightSheet.settleMany", { count: blockers.length })}
          </SheetTitle>
          <SheetDescription>
            {isError
              ? t("preflightSheet.descError")
              : clean
                ? t("preflightSheet.descClean")
                : t("preflightSheet.descBlocked")}
          </SheetDescription>
        </SheetHeader>

        <div className="flex-1 overflow-y-auto py-4">
          {isLoading ? (
            <Skeleton className="h-24 w-full" />
          ) : isError ? (
            <div className="flex items-center gap-2.5 rounded-lg border border-border p-3">
              <AlertTriangle className="h-4 w-4 shrink-0 text-[var(--amber-600)]" />
              <p className="text-sm text-muted-foreground">{t("preflightSheet.checkErrorDetail")}</p>
            </div>
          ) : clean ? (
            <div className="flex items-center gap-2.5 rounded-lg border border-border p-3">
              <CheckCircle2 className="h-4 w-4 shrink-0 text-[var(--green-500)]" />
              <p className="text-sm text-muted-foreground">{t("preflightSheet.allInPlace")}</p>
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
            {t("preflightSheet.issueAndSend")}
          </Button>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            {t("preflightSheet.keepAsDraft")}
          </Button>
        </div>
      </SheetContent>
    </Sheet>
  );
}
