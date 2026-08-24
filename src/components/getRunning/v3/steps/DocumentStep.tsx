import { useTranslation } from "react-i18next";
import { Link } from "react-router-dom";
import { useCan } from "@/hooks/useCapabilities";
import { NumberingCard } from "@/components/settings/hireOrders/NumberingCard";
import { ROUTES } from "@/config/app.config";
import { WizardFooterAction } from "@/components/getRunning/v3/WizardFooterAction";
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
  const canEdit = useCan("edit_hire_order_settings");

  const continueButton = (
    <Button type="button" size="sm" onClick={onDone}>
      {t("body.document.continue")}
    </Button>
  );

  return (
    <div data-testid="step-body-document" className="space-y-3">
      <NumberingCard orgId={orgId} readOnly={!canEdit} />

      <Link
        to={ROUTES.HIRE_ORDER_TEMPLATE}
        className="text-xs font-medium text-accent-600 underline-offset-2 hover:underline"
      >
        {t("body.document.templateLink")}
      </Link>

      {canEdit ? (
        <WizardFooterAction>{continueButton}</WizardFooterAction>
      ) : (
        <p className="text-xs text-muted-foreground">{t("body.document.readOnly")}</p>
      )}
    </div>
  );
}
