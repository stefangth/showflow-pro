import { useContext } from "react";
import { createPortal } from "react-dom";
import { useTranslation } from "react-i18next";
import { useCan } from "@/hooks/useCapabilities";
import { SkillsTab } from "@/components/settings/skills/SkillsTab";
import { WizardFooterContext } from "@/components/getRunning/v3/WizardFooterContext";
import { Button } from "@/components/ui/button";

/**
 * The v3 `skills` step body (Phase 3): the org skill catalog, reusing the Settings
 * `SkillsTab`. `SkillsTab` self-gates its own writes on the `manage_skills`
 * capability, so this step gates its Continue vs read-only note on the SAME capability
 * (the model's `capability` for this step is also `manage_skills`) — otherwise a producer
 * who can edit skills (manage_skills defaults on) would see an editable catalog with the
 * Continue hidden and a false "you lack the manage skills right" note. Continue simply advances the wizard
 * (`onDone`) — done-ness is derived by the model from the catalog being non-empty,
 * the same "the dialogs persist, the body advances" pattern as `ProductionsStep`.
 *
 * Portals its Continue into `WizardFooterContext`'s slot when `WizardShell` has
 * mounted it, falling back to an inline button when the context is null (e.g. in
 * this file's own tests) — mirrors `SourceStep`.
 */
export function SkillsStep({ orgId, onDone }: { orgId: string | null; onDone: () => void }): JSX.Element {
  const { t } = useTranslation("getRunningV3");
  const footerSlot = useContext(WizardFooterContext);
  const canEdit = useCan("manage_skills");

  const continueButton = (
    <Button type="button" size="sm" onClick={onDone}>
      {t("body.skills.continue")}
    </Button>
  );

  return (
    <div className="space-y-3">
      <div className="space-y-1">
        <div className="text-title-sm font-semibold tracking-[-0.2px] text-foreground">
          {t("body.skills.heading")}
        </div>
        <p className="text-xs text-muted-foreground">{t("body.skills.sub")}</p>
      </div>

      {orgId ? <SkillsTab orgId={orgId} /> : null}

      {canEdit ? (
        footerSlot ? (
          createPortal(continueButton, footerSlot)
        ) : (
          continueButton
        )
      ) : (
        <p className="text-xs text-muted-foreground">{t("body.skills.readOnly")}</p>
      )}
    </div>
  );
}
