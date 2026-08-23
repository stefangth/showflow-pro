import { useContext } from "react";
import { createPortal } from "react-dom";
import { useTranslation } from "react-i18next";
import { Link } from "react-router-dom";
import { useCan } from "@/hooks/useCapabilities";
import { NumberingCard } from "@/components/settings/hireOrders/NumberingCard";
import { ROUTES } from "@/config/app.config";
import { WizardFooterContext } from "@/components/getRunning/v3/WizardFooterContext";
import { Button } from "@/components/ui/button";

/**
 * The v3 `document` step body (Phase 3): how contract numbers are built (reuse the
 * Settings `NumberingCard`, which owns its own save + `["app-settings"]` invalidation),
 * plus a link to the full document template editor for the rest of the layout. Admin-only
 * in the model (`capability: edit_hire_order_settings`); a viewer without that right sees
 * the card read-only and a "set by an admin" note instead of Continue.
 */
export function DocumentStep({ orgId, onDone }: { orgId: string | null; onDone: () => void }): JSX.Element {
  const { t } = useTranslation("getRunningV3");
  const footerSlot = useContext(WizardFooterContext);
  const canEdit = useCan("edit_hire_order_settings");

  const continueButton = (
    <Button type="button" size="sm" onClick={onDone}>
      {t("body.document.continue")}
    </Button>
  );

  return (
    <div className="space-y-3">
      <div className="space-y-1">
        <div className="text-title-sm font-semibold tracking-[-0.2px] text-foreground">
          {t("body.document.heading")}
        </div>
        <p className="text-xs text-muted-foreground">{t("body.document.sub")}</p>
      </div>

      <NumberingCard orgId={orgId} readOnly={!canEdit} />

      <Link
        to={ROUTES.HIRE_ORDER_TEMPLATE}
        className="text-xs font-medium text-accent-600 underline-offset-2 hover:underline"
      >
        {t("body.document.templateLink")}
      </Link>

      {canEdit ? (
        footerSlot ? (
          createPortal(continueButton, footerSlot)
        ) : (
          continueButton
        )
      ) : (
        <p className="text-xs text-muted-foreground">{t("body.document.readOnly")}</p>
      )}
    </div>
  );
}
