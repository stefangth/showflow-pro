import { useEffect, useRef, useState } from "react";
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
  // `disabled` fences creation too, not just selection: a create ends in `onToggle`, so
  // leaving the chip live would hand a caller that gated selection off (often a capability
  // gate, not a transient one) a selection by the side door. The fence lives INSIDE the
  // chip rather than in this mount condition: callers pass a composite flag (a capability
  // AND a transient pending state), and unmounting on the transient half would throw away
  // a half-typed skill name.
  const showCreate = canCreate && !!onCreate;

  // No catalog and no way to add to it: the hint IS the whole answer.
  if (skills.length === 0 && !showCreate) {
    return emptyHint ? <p className="text-xs text-muted-foreground">{emptyHint}</p> : null;
  }

  const selected = new Set(selectedIds);
  return (
    <div className="flex flex-wrap items-center gap-1.5">
      {/* An empty catalog still needs a word of explanation next to the create chip.
          Callers pass copy that matches the state they put the picker in: a hint that
          points at inline creation must only be handed over when the chip is there. */}
      {skills.length === 0 && emptyHint && (
        <p className="text-xs text-muted-foreground">{emptyHint}</p>
      )}
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
      {showCreate && <CreateSkillChip onCreate={onCreate} onCreated={onToggle} disabled={disabled} />}
    </div>
  );
}

/** The "New skill" chip and the inline form it swaps into. Kept local: it owns only
 *  its own open/pending/name state, which no caller needs to observe. */
function CreateSkillChip({ onCreate, onCreated, disabled }: {
  onCreate: (name: string) => Promise<{ id: string; name: string }>;
  onCreated: (skillId: string) => void;
  /** Hard fence, not a mount condition: blocks opening the form and submitting it, and is
   *  re-checked after the create resolves so a gate that closes mid-flight (a capability
   *  refetch revoking `manage_skills`) still cannot land a selection. */
  disabled: boolean;
}) {
  const { t } = useTranslation("common");
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [pending, setPending] = useState(false);
  // Read after the await, where the closed-over `disabled` would be the stale value from
  // the render that started the create.
  const disabledRef = useRef(disabled);
  useEffect(() => { disabledRef.current = disabled; }, [disabled]);

  async function submit() {
    const trimmed = name.trim();
    // Guards the empty/whitespace name, the double submit while a create is in flight,
    // and the disabled fence.
    if (!trimmed || pending || disabledRef.current) return;
    setPending(true);
    try {
      const created = await onCreate(trimmed);
      // The skill now exists, but the caller stopped allowing selection while we waited,
      // so close the field without selecting rather than writing past the gate.
      if (disabledRef.current) { setName(""); setOpen(false); return; }
      onCreated(created.id);
      setName("");
      setOpen(false);
    } catch {
      // A rejected create (a name collision, a lost connection) must leave the selection
      // untouched and must not escape the picker. The field stays open with the typed name
      // so the producer can amend it. The caller surfaces the reason.
    } finally {
      setPending(false);
    }
  }

  if (!open) {
    return (
      <button
        type="button"
        disabled={disabled}
        onClick={() => { if (!disabled) setOpen(true); }}
        className={cn(
          "inline-flex items-center gap-1 rounded-full border border-dashed border-border bg-background px-2.5 py-0.5 text-xs text-muted-foreground transition-colors hover:text-foreground",
          // Reads as unavailable exactly like the sibling skill chips do.
          disabled && "opacity-50 pointer-events-none",
        )}
      >
        <Plus aria-hidden="true" className="h-3 w-3" />
        {t("skillPicker.newSkill")}
      </button>
    );
  }

  return (
    // Deliberately NOT a <form>: this chip renders inside ShowFormDialog's production
    // <form>, and a nested form both breaks HTML nesting and bubbles its submit into the
    // outer one, saving the production behind the producer's back. Enter and the check
    // button call submit() directly instead.
    <div
      role="group"
      aria-label={t("skillPicker.newSkill")}
      className={cn(
        "inline-flex items-center gap-1 rounded-full border border-dashed border-border bg-background pl-2.5 pr-0.5 py-0.5",
        disabled && "opacity-50",
      )}
    >
      <input
        autoFocus
        value={name}
        readOnly={disabled}
        onChange={(e) => setName(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Escape") { setOpen(false); setName(""); }
          // Enter must not reach the enclosing form, which would submit the production.
          if (e.key === "Enter") { e.preventDefault(); void submit(); }
        }}
        aria-label={t("skillPicker.nameLabel")}
        placeholder={t("skillPicker.nameLabel")}
        className="w-28 bg-transparent text-xs text-foreground outline-none placeholder:text-muted-foreground"
      />
      <button
        type="button"
        onClick={() => void submit()}
        disabled={pending || disabled || !name.trim()}
        aria-label={t("skillPicker.create")}
        className="inline-flex h-5 w-5 items-center justify-center rounded-full text-primary transition-colors hover:bg-primary/10 disabled:opacity-50"
      >
        <Check aria-hidden="true" className="h-3 w-3" />
      </button>
    </div>
  );
}
