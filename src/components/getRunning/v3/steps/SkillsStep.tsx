import { useTranslation } from "react-i18next";
import { useCan } from "@/hooks/useCapabilities";
import { SkillsTab } from "@/components/settings/skills/SkillsTab";
import { ArtistSkillAssignList } from "@/components/getRunning/v3/steps/ArtistSkillAssignList";
import { WizardFooterAction } from "@/components/getRunning/v3/WizardFooterAction";
import { Button } from "@/components/ui/button";

/**
 * The v3 `skills` step body (Phase 3): the org skill catalog, reusing the Settings
 * `SkillsTab`, above which sits the assign list that actually clears the step's block.
 *
 * The two halves write different tables and are gated on different capabilities:
 * `SkillsTab` writes the CATALOG and self-gates on `manage_skills`; `ArtistSkillAssignList`
 * writes `artist_skills`, which `ArtistProfileSheet` gates on `edit_artists`. Continue is
 * enabled when the viewer holds either, so a producer who can do half the step is not shown
 * a false "you lack the right" note. Continue simply advances the wizard
 * (`onDone`) — done-ness is derived by the model from the catalog being non-empty,
 * the same "the dialogs persist, the body advances" pattern as `ProductionsStep`.
 *
 * Portals its Continue into `WizardFooterContext`'s slot when `WizardShell` has
 * mounted it, falling back to an inline button when the context is null (e.g. in
 * this file's own tests) — mirrors `SourceStep`.
 */
export function SkillsStep({ orgId, onDone }: { orgId: string | null; onDone: () => void }): JSX.Element {
  const { t } = useTranslation("getRunningV3");
  const canEditCatalog = useCan("manage_skills");
  // Writing `artist_skills` is `edit_artists`, NOT `manage_skills`: that is the capability
  // `ArtistProfileSheet` gates the identical write on, and the one an org expects to hold
  // back when it decides producers may not change artists. Gating the assign list on
  // `manage_skills` (which defaults on for producers) let a producer rewrite every artist's
  // skills through this step in an org that had turned `edit_artists` off for them.
  const canAssign = useCan("edit_artists");
  // Either half of this step is enough to have work here, so either enables Continue; the
  // read-only note is only true when neither does.
  const canEdit = canEditCatalog || canAssign;

  const continueButton = (
    <Button type="button" size="sm" onClick={onDone}>
      {t("body.skills.continue")}
    </Button>
  );

  return (
    <div data-testid="step-body-skills" className="space-y-3">
      {/* The step's own block is "a part requires a skill no active artist holds", which the
          catalog manager below cannot clear. The assign list comes FIRST so the blocking
          reason and its fix are what the step opens on; SkillsTab stays mounted beneath for
          catalog work (rename, archive, add). */}
      <ArtistSkillAssignList orgId={orgId} canEdit={canAssign} />

      {orgId ? <SkillsTab orgId={orgId} /> : null}

      {canEdit ? (
        <WizardFooterAction>{continueButton}</WizardFooterAction>
      ) : (
        <p className="text-xs text-muted-foreground">{t("body.skills.readOnly")}</p>
      )}
    </div>
  );
}
