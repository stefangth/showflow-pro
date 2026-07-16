import { cn } from "@/lib/utils";

/** Controlled multi-select of skills rendered as toggle chips. Used by the
 *  required-skills editors, the direct-book filter, and the tier-open picker. */
export function SkillPicker({ skills, selectedIds, onToggle, disabled = false, emptyHint }: {
  skills: { id: string; name: string }[];
  selectedIds: string[];
  onToggle: (skillId: string) => void;
  disabled?: boolean;
  emptyHint?: string;
}) {
  if (skills.length === 0) {
    return emptyHint ? <p className="text-xs text-muted-foreground">{emptyHint}</p> : null;
  }
  const selected = new Set(selectedIds);
  return (
    <div className="flex flex-wrap gap-1.5">
      {skills.map((s) => {
        const on = selected.has(s.id);
        return (
          <button
            key={s.id}
            type="button"
            aria-pressed={on}
            disabled={disabled}
            onClick={() => onToggle(s.id)}
            className={cn(
              "rounded-full border px-2.5 py-0.5 text-xs transition-colors",
              on
                ? "border-primary bg-primary/10 text-primary"
                : "border-border bg-background text-muted-foreground hover:text-foreground",
              disabled && "opacity-50 pointer-events-none",
            )}
          >
            {s.name}
          </button>
        );
      })}
    </div>
  );
}
