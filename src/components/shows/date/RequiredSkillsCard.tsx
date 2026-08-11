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
  const card = computeRequiredSkillCard({ slots, showSkillIds, dateSkillIds, droppedSkillIds, skills });

  return (
    <Card>
      <CardHeader className="space-y-1.5">
        <CardTitle className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
          Skills required on this date
        </CardTitle>
        <p className="text-sm text-muted-foreground">
          Computed from the {card.slotCount} slots on {show}. Only artists holding all of them can be offered or booked.
        </p>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="flex flex-wrap items-start gap-1.5">
          {card.rows.map((row) => {
            if (row.kind === "dropped") {
              return (
                <Badge key={row.skillId} variant="outline" className="gap-1 border-dashed border-[var(--line-strong)]">
                  <span className="line-through text-[var(--text-faint)]">{row.name}</span>
                  <span className="text-[10px] uppercase text-[var(--text-faint)]">dropped on this date</span>
                </Badge>
              );
            }
            if (row.kind === "added") {
              return (
                <Badge key={row.skillId} variant="hold" className="gap-1">
                  {row.name}
                  <span className="text-[10px] uppercase opacity-80">added on this date</span>
                </Badge>
              );
            }
            return (
              <Badge key={row.skillId} variant="accent" className="gap-1">
                {row.name}
                {row.provenance && (
                  <span className="text-[10px] opacity-80">{row.provenance}</span>
                )}
              </Badge>
            );
          })}
          {card.rows.length === 0 && (
            <p className="text-xs text-muted-foreground">No skills required.</p>
          )}
        </div>

        <div className="flex items-center justify-between gap-3 pt-1">
          <div>
            {card.changeCount > 0 && (
              <p className="text-xs text-muted-foreground">
                {card.changeCount} {card.changeCount === 1 ? "change" : "changes"} from the production default
              </p>
            )}
          </div>
          <div className="flex items-center gap-2 shrink-0">
            {card.changeCount > 0 && (
              <Button type="button" variant="ghost" size="sm" onClick={onReset}>
                Reset to computed
              </Button>
            )}
            <Button type="button" variant="outline" size="sm" onClick={onEdit}>
              Edit
            </Button>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
