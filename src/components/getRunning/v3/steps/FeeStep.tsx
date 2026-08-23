import { useContext } from "react";
import { createPortal } from "react-dom";
import { useTranslation } from "react-i18next";
import { useCan } from "@/hooks/useCapabilities";
import { OrderDefaultsCard } from "@/components/settings/hireOrders/OrderDefaultsCard";
import { WizardFooterContext } from "@/components/getRunning/v3/WizardFooterContext";
import { Eyebrow } from "@/components/ui/eyebrow";
import { Button } from "@/components/ui/button";

/**
 * The v3 `fee` step body (Phase 3): the org's default fee/currency/basis, reusing the
 * Settings `OrderDefaultsCard` (which owns its own save + `["app-settings"]`
 * invalidation).
 *
 * The per-(cast × production) fee list is Phase 4 (it needs the new `cast_production_fees`
 * table), so this step ships a static shell note in its place rather than a fake list.
 * Contract settings are admin-only in the model (`capability: edit_hire_order_settings`);
 * a viewer without that right sees the card read-only and a "set by an admin" note
 * instead of Continue.
 */
export function FeeStep({ orgId, onDone }: { orgId: string | null; onDone: () => void }): JSX.Element {
  const { t } = useTranslation("getRunningV3");
  const footerSlot = useContext(WizardFooterContext);
  const canEdit = useCan("edit_hire_order_settings");

  const continueButton = (
    <Button type="button" size="sm" onClick={onDone}>
      {t("body.fee.continue")}
    </Button>
  );

  return (
    <div className="space-y-3">
      <div className="space-y-1">
        <div className="text-title-sm font-semibold tracking-[-0.2px] text-foreground">
          {t("body.fee.heading")}
        </div>
        <p className="text-xs text-muted-foreground">{t("body.fee.sub")}</p>
      </div>

      <OrderDefaultsCard orgId={orgId} readOnly={!canEdit} />

      <div className="flex flex-col items-start gap-1 rounded-l border border-dashed border-border px-4 py-4">
        <Eyebrow>{t("body.fee.shellTitle")}</Eyebrow>
        <p className="text-xs text-muted-foreground">{t("body.fee.shellBody")}</p>
      </div>

      {canEdit ? (
        footerSlot ? (
          createPortal(continueButton, footerSlot)
        ) : (
          continueButton
        )
      ) : (
        <p className="text-xs text-muted-foreground">{t("body.fee.readOnly")}</p>
      )}
    </div>
  );
}
