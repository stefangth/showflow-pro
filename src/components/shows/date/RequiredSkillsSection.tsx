import { X } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { IconTooltip } from "@/components/common/IconTooltip";
import { SkillPicker } from "@/components/skills/SkillPicker";

/** Per-date required skills: inherited show-level chips (read-only, labeled
 *  "From show") plus removable date-level additions and an add picker.
 *  Union semantics: a date adds requirements, it never removes show-level ones. */
export function RequiredSkillsSection({ skills, showSkillIds, dateSkillIds, onAdd, onRemove, pending }: {
  skills: { id: string; name: string }[];
  showSkillIds: string[];
  dateSkillIds: string[];
  onAdd: (skillId: string) => void;
  onRemove: (skillId: string) => void;
  pending: boolean;
}) {
  const byId = new Map(skills.map((s) => [s.id, s.name]));
  const required = new Set([...showSkillIds, ...dateSkillIds]);
  const addable = skills.filter((s) => !required.has(s.id));
  return (
    <div className="space-y-2">
      <p className="text-sm font-medium">Required skills</p>
      <p className="text-xs text-muted-foreground">
        Artists must have all of these skills to receive offers or be booked.
      </p>
      <div className="flex flex-wrap items-center gap-1.5">
        {showSkillIds.map((id) => (
          <Badge key={id} variant="secondary" className="gap-1">
            {byId.get(id) ?? id}
            <span className="text-[10px] uppercase text-muted-foreground">From show</span>
          </Badge>
        ))}
        {dateSkillIds.filter((id) => !showSkillIds.includes(id)).map((id) => (
          <Badge key={id} variant="outline" className="gap-1">
            {byId.get(id) ?? id}
            <IconTooltip label={`Remove ${byId.get(id) ?? id}`}>
            <button
              type="button"
              aria-label={`Remove ${byId.get(id) ?? id}`}
              disabled={pending}
              onClick={() => onRemove(id)}
              className="ml-0.5 hover:text-destructive"
            >
              <X className="h-3 w-3" />
            </button>
            </IconTooltip>
          </Badge>
        ))}
        {showSkillIds.length === 0 && dateSkillIds.length === 0 && (
          <p className="text-xs text-muted-foreground">No skills required.</p>
        )}
      </div>
      <SkillPicker
        skills={addable}
        selectedIds={[]}
        onToggle={onAdd}
        disabled={pending}
        emptyHint={skills.length === 0 ? "No skills yet. Add skills on artist profiles first." : undefined}
      />
    </div>
  );
}
