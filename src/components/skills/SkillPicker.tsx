import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Check, Plus } from "lucide-react";
import { cn } from "@/lib/utils";

/** Controlled multi-select of skills rendered as toggle chips. Used by the
 *  required-skills editors, the direct-book filter, and the tier-open picker. */
export function SkillPicker({ skills, selectedIds, onToggle, disabled = false, emptyHint, onCreate, canCreate = false }: {
  skills: { id: string; name: string }[];
  selectedIds: string[];
  onToggle: (skillId: string) => void;
  disabled?: boolean;
  emptyHint?: string;
  /** When set, renders a "New skill" affordance that creates a skill and immediately
   *  selects it. Must resolve to the created skill so the caller can select it by id
   *  without waiting for the ['skills'] invalidation to refetch. */
  onCreate?: (name: string) => Promise<{ id: string; name: string }>;
  /** Gate for the create affordance; distinct from `disabled`, which gates selection.
   *  Creation needs `manage_skills`, selection needs the caller's own capability. */
  canCreate?: boolean;
}) {
  const showCreate = canCreate && !!onCreate;

  // No catalog and no way to add to it: the old dead-end hint is still the honest answer.
  if (skills.length === 0 && !showCreate) {
    return emptyHint ? <p className="text-xs text-muted-foreground">{emptyHint}</p> : null;
  }

  const selected = new Set(selectedIds);
  return (
    <div className="flex flex-wrap items-center gap-1.5">
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
              "inline-flex items-center gap-1 rounded-full border px-2.5 py-0.5 text-xs transition-colors",
              on
                ? "border-primary bg-primary/10 text-primary"
                : "border-border bg-background text-muted-foreground hover:text-foreground",
              disabled && "opacity-50 pointer-events-none",
            )}
          >
            {on && <Check aria-hidden="true" data-testid="skill-chip-check" className="h-3 w-3" />}
            {s.name}
          </button>
        );
      })}
      {showCreate && <CreateSkillChip onCreate={onCreate} onCreated={onToggle} />}
    </div>
  );
}

/** The "New skill" chip and the inline form it swaps into. Kept local: it owns only
 *  its own open/pending/name state, which no caller needs to observe. */
function CreateSkillChip({ onCreate, onCreated }: {
  onCreate: (name: string) => Promise<{ id: string; name: string }>;
  onCreated: (skillId: string) => void;
}) {
  const { t } = useTranslation("common");
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [pending, setPending] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    const trimmed = name.trim();
    // Guards the empty/whitespace name and the double submit while a create is in flight.
    if (!trimmed || pending) return;
    setPending(true);
    try {
      const created = await onCreate(trimmed);
      onCreated(created.id);
      setName("");
      setOpen(false);
    } catch {
      // A rejected create (a name collision, a lost connection) must leave the selection
      // untouched and must not escape the picker. The form stays open with the typed name
      // so the producer can amend it. The caller surfaces the reason.
    } finally {
      setPending(false);
    }
  }

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="inline-flex items-center gap-1 rounded-full border border-dashed border-border bg-background px-2.5 py-0.5 text-xs text-muted-foreground transition-colors hover:text-foreground"
      >
        <Plus aria-hidden="true" className="h-3 w-3" />
        {t("skillPicker.newSkill")}
      </button>
    );
  }

  return (
    <form onSubmit={submit} className="inline-flex items-center gap-1 rounded-full border border-dashed border-border bg-background pl-2.5 pr-0.5 py-0.5">
      <input
        autoFocus
        value={name}
        onChange={(e) => setName(e.target.value)}
        onKeyDown={(e) => { if (e.key === "Escape") { setOpen(false); setName(""); } }}
        aria-label={t("skillPicker.nameLabel")}
        placeholder={t("skillPicker.nameLabel")}
        className="w-28 bg-transparent text-xs text-foreground outline-none placeholder:text-muted-foreground"
      />
      <button
        type="submit"
        disabled={pending || !name.trim()}
        aria-label={t("skillPicker.newSkill")}
        className="inline-flex h-5 w-5 items-center justify-center rounded-full text-primary transition-colors hover:bg-primary/10 disabled:opacity-50"
      >
        <Check aria-hidden="true" className="h-3 w-3" />
      </button>
    </form>
  );
}
