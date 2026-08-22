import { useTranslation } from "react-i18next";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import type { SlotDraft } from "@/data/slots";
import { computeRequiredSkillCard } from "@/lib/requiredSkills";

// Produces (consumed by C3.5): RequiredSkillsCardProps { show: string; slots: SlotDraft[];
//   showSkillIds: string[]; dateSkillIds: string[]; droppedSkillIds: string[];
//   skills: {id;name}[]; onReset: () => void; onEdit: () => void; }
export interface RequiredSkillsCardProps {
  /** The production's program name, e.g. "Hamlet" — used in the subtitle. */
  show: string;
  slots: SlotDraft[];
  showSkillIds: string[];
  dateSkillIds: string[];
  droppedSkillIds: string[];
  skills: { id: string; name: string }[];
  /** Removes all date-adds and all drops for this date (sheet-owned mutation). */
  onReset: () => void;
  /** Routes to the Setup tab's date configuration. */
  onEdit: () => void;
}

/**
 * Offers-tab main-column card (design 1e): the date's computed required
 * skills, derived from the production's named slots (Plan B) plus this
 * date's adds/drops. Purely presentational — `computeRequiredSkillCard`
 * (src/lib/requiredSkills.ts) does the set math; this component only renders
 * its output. Wired into ShowDateDetailSheet in Task C3.5.
 */
export function RequiredSkillsCard({
  show, slots, showSkillIds, dateSkillIds, droppedSkillIds, skills, onReset, onEdit,
}: RequiredSkillsCardProps) {
  const { t } = useTranslation("showsDetail");
  const card = computeRequiredSkillCard({ slots, showSkillIds, dateSkillIds, droppedSkillIds, skills });

  return (
    <Card elevation={2}>
      <CardHeader className="space-y-1.5">
        {/* eslint-disable-next-line no-restricted-syntax -- CardTitle label, not a standard 11px/1.6px eyebrow */}
        <CardTitle className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
          {t("requiredSkillsCard.title")}
        </CardTitle>
        <p className="text-sm text-muted-foreground">
          {t("requiredSkillsCard.computedFrom", { count: card.slotCount, show })}
        </p>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="flex flex-wrap items-start gap-1.5">
          {card.rows.map((row) => {
            if (row.kind === "dropped") {
              return (
                <Badge key={row.skillId} variant="outline" className="gap-1 border-dashed border-[var(--line-strong)]">
                  <span className="line-through text-[var(--text-faint)]">{row.name}</span>
                  {/* eslint-disable-next-line no-restricted-syntax -- inline badge suffix, not a block eyebrow */}
                  <span className="text-eyebrow uppercase text-[var(--text-faint)]">{t("requiredSkillsCard.droppedOnDate")}</span>
                </Badge>
              );
            }
            if (row.kind === "added") {
              return (
                <Badge key={row.skillId} variant="hold" className="gap-1">
                  {row.name}
                  {/* eslint-disable-next-line no-restricted-syntax -- inline badge suffix, not a block eyebrow */}
                  <span className="text-eyebrow uppercase opacity-80">{t("requiredSkillsCard.addedOnDate")}</span>
                </Badge>
              );
            }
            return (
              <Badge key={row.skillId} variant="accent" className="gap-1">
                {row.name}
                {row.provenance && (
                  <span className="text-eyebrow opacity-80">{row.provenance}</span>
                )}
              </Badge>
            );
          })}
          {card.rows.length === 0 && (
            <p className="text-xs text-muted-foreground">{t("requiredSkillsCard.noSkillsRequired")}</p>
          )}
        </div>

        <div className="flex items-center justify-between gap-3 pt-1">
          <div>
            {card.changeCount > 0 && (
              <p className="text-xs text-muted-foreground">
                {t("requiredSkillsCard.changeCount", { count: card.changeCount })}
              </p>
            )}
          </div>
          <div className="flex items-center gap-2 shrink-0">
            {card.changeCount > 0 && (
              <Button type="button" variant="secondary" size="sm" onClick={onReset}>
                {t("requiredSkillsCard.resetToComputed")}
              </Button>
            )}
            <Button type="button" variant="outline" size="sm" onClick={onEdit}>
              {t("requiredSkillsCard.edit")}
            </Button>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
