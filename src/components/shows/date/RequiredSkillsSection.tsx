import { X, Minus, Undo2 } from "lucide-react";
import { useTranslation } from "react-i18next";
import { Badge } from "@/components/ui/badge";
import { IconTooltip } from "@/components/common/IconTooltip";
import { SkillPicker } from "@/components/skills/SkillPicker";

/** Per-date required skills: inherited show-level chips plus removable date-level
 *  additions and an add picker.
 *
 *  Union semantics are additive-plus-drops: a date adds requirements, and it may
 *  also DROP an inherited show-level skill on this date only (show_date_skill_drops).
 *  An inherited chip carries a "drop on this date" control; a dropped chip renders
 *  struck through with a "dropped on this date" label and a restore control. Date
 *  additions keep their own remove control (removed, not dropped). */
export function RequiredSkillsSection({
  skills, showSkillIds, dateSkillIds, droppedSkillIds, onAdd, onRemove, onDrop, onRestore, pending,
}: {
  skills: { id: string; name: string }[];
  showSkillIds: string[];
  dateSkillIds: string[];
  droppedSkillIds: string[];
  onAdd: (skillId: string) => void;
  onRemove: (skillId: string) => void;
  onDrop: (skillId: string) => void;
  onRestore: (skillId: string) => void;
  pending: boolean;
}) {
  const { t } = useTranslation("showsDetail");
  const byId = new Map(skills.map((s) => [s.id, s.name]));
  const dropped = new Set(droppedSkillIds);
  const required = new Set([...showSkillIds, ...dateSkillIds]);
  const addable = skills.filter((s) => !required.has(s.id));
  return (
    <div className="space-y-2">
      <p className="text-sm font-medium">{t("requiredSkillsSection.requiredSkills")}</p>
      <p className="text-xs text-muted-foreground">
        {t("requiredSkillsSection.mustHaveAll")}
      </p>
      <div className="flex flex-wrap items-center gap-1.5">
        {showSkillIds.map((id) => {
          const name = byId.get(id) ?? id;
          if (dropped.has(id)) {
            return (
              <Badge key={id} variant="outline" className="gap-1 border-dashed border-[var(--line-strong)]">
                <span className="line-through text-[var(--text-faint)]">{name}</span>
                <span className="text-[10px] uppercase text-[var(--text-faint)]">{t("requiredSkillsSection.droppedOnDate")}</span>
                <IconTooltip label={t("requiredSkillsSection.restore", { name })}>
                  <button
                    type="button"
                    aria-label={t("requiredSkillsSection.restore", { name })}
                    disabled={pending}
                    onClick={() => onRestore(id)}
                    className="ml-0.5 text-[var(--text-faint)] hover:text-foreground"
                  >
                    <Undo2 className="h-3 w-3" />
                  </button>
                </IconTooltip>
              </Badge>
            );
          }
          return (
            <Badge key={id} variant="secondary" className="gap-1">
              {name}
              <span className="text-[10px] uppercase text-muted-foreground">{t("requiredSkillsSection.fromShow")}</span>
              <IconTooltip label={t("requiredSkillsSection.dropOnDate", { name })}>
                <button
                  type="button"
                  aria-label={t("requiredSkillsSection.dropOnDate", { name })}
                  disabled={pending}
                  onClick={() => onDrop(id)}
                  className="ml-0.5 hover:text-destructive"
                >
                  <Minus className="h-3 w-3" />
                </button>
              </IconTooltip>
            </Badge>
          );
        })}
        {dateSkillIds.filter((id) => !showSkillIds.includes(id)).map((id) => (
          <Badge key={id} variant="outline" className="gap-1">
            {byId.get(id) ?? id}
            <IconTooltip label={t("requiredSkillsSection.remove", { name: byId.get(id) ?? id })}>
              <button
                type="button"
                aria-label={t("requiredSkillsSection.remove", { name: byId.get(id) ?? id })}
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
          <p className="text-xs text-muted-foreground">{t("requiredSkillsSection.noSkillsRequired")}</p>
        )}
      </div>
      <SkillPicker
        skills={addable}
        selectedIds={[]}
        onToggle={onAdd}
        disabled={pending}
        emptyHint={skills.length === 0 ? t("requiredSkillsSection.emptyHint") : undefined}
      />
    </div>
  );
}
