import { useTranslation } from "react-i18next";
import { Plus, Trash2 } from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Metric } from "@/components/ui/metric";
import { SkillPicker } from "@/components/skills/SkillPicker";

export type SlotKind = "main" | "understudy";

/** A production's named casting-breakdown row: a part (role) name, how many of it are
 *  needed, whether it's a main or understudy part, and the skills it requires. Shared
 *  by `ShowFormDialog` (create/edit a production) and the PartsEditor sheet. Structurally
 *  identical to `SlotDraft` in `src/data/slots.ts`, which is the persistence-layer shape
 *  this feeds into via `saveShowSlots`. */
export interface SlotDraftRow {
  id?: string;
  name: string;
  count: number;
  kind: SlotKind;
  skillIds: string[];
}

export interface SkillOption {
  id: string;
  name: string;
}

export interface CastingBreakdownFieldsProps {
  value: SlotDraftRow[];
  onChange: (rows: SlotDraftRow[]) => void;
  skills: SkillOption[];
  disabled?: boolean;
  /** Creates a skill and resolves to it, so the row can require it straight away. Optional:
   *  a consumer that does not offer creation simply omits it. */
  onCreateSkill?: (name: string) => Promise<SkillOption>;
  /** `manage_skills`, which is a different capability from the `edit_scheduling` behind
   *  `disabled`: you can be allowed to edit the breakdown without being allowed to grow the
   *  org's skill catalog. */
  canCreateSkill?: boolean;
  /** The org skill catalog could NOT be read, as opposed to being empty. Both arrive here as
   *  `skills: []`, and treating them the same made every picker print "No skills yet. Create
   *  the first one here." to an org whose catalog is full, inviting duplicates of skills that
   *  already exist with only the 23505 unique constraint left to catch them. When true the
   *  pickers say the read failed and creation is withheld. */
  skillsUnreadable?: boolean;
}

/**
 * The casting-breakdown editor: one row per part (role name, count, main/understudy
 * toggle, per-part required skills), a live main/understudy total, and the computed
 * required-skills-union callout. Fully controlled (`value`/`onChange`) so both
 * `ShowFormDialog` and the PartsEditor sheet can own the draft state themselves.
 */
export function CastingBreakdownFields({
  value, onChange, skills, disabled = false, onCreateSkill, canCreateSkill = false,
  skillsUnreadable = false,
}: CastingBreakdownFieldsProps) {
  const { t } = useTranslation("productions");

  const updateRow = (i: number, patch: Partial<SlotDraftRow>) =>
    onChange(value.map((row, idx) => (idx === i ? { ...row, ...patch } : row)));
  const toggleRowSkill = (i: number, skillId: string) =>
    onChange(value.map((row, idx) => (idx === i
      ? { ...row, skillIds: row.skillIds.includes(skillId) ? row.skillIds.filter((x) => x !== skillId) : [...row.skillIds, skillId] }
      : row)));
  // Every new row gets a client-minted id so a retry (dialog stays open on save
  // failure) re-submits the same array and saveShowSlots resolves already-landed
  // rows to no-op updates instead of duplicate inserts.
  const addRow = () =>
    onChange([...value, { id: crypto.randomUUID(), name: "", count: 1, kind: "main", skillIds: [] }]);
  const removeRow = (i: number) => onChange(value.filter((_, idx) => idx !== i));

  const skillNameById = new Map(skills.map((s) => [s.id, s.name] as const));
  const unionIds = new Set<string>();
  for (const row of value) for (const id of row.skillIds) unionIds.add(id);
  const unionNames = [...unionIds]
    .map((id) => skillNameById.get(id))
    .filter((n): n is string => !!n)
    .sort((a, b) => a.localeCompare(b));
  const mainTotal = value.filter((row) => row.kind === "main").reduce((a, row) => a + row.count, 0);
  const understudyTotal = value.filter((row) => row.kind === "understudy").reduce((a, row) => a + row.count, 0);
  const calloutText = unionNames.length > 0
    ? t("form.callout.withSkills", { skills: unionNames.join(", ") })
    : t("form.callout.none");

  return (
    <div className="space-y-2.5">
      <div className="flex items-baseline justify-between gap-3">
        <p className="text-sm font-medium">{t("form.slotsHeading")}</p>
        <Metric size="body" className="text-muted-foreground">
          {t("form.slotTotals", { main: mainTotal, understudy: understudyTotal })}
        </Metric>
      </div>
      <p className="text-xs text-muted-foreground">
        {t("form.slotsHelp")}
      </p>
      {skillsUnreadable && (
        <p className="text-xs text-destructive">{t("form.skillsLoadFailed")}</p>
      )}

      <div className="space-y-2">
        {value.map((row, i) => (
          <div
            key={row.id ?? i}
            role="group"
            aria-label={row.name ? t("form.slotGroupNamed", { name: row.name }) : t("form.slotGroupIndex", { index: i + 1 })}
            className="space-y-2 rounded-m border border-border p-2.5"
          >
            <div className="flex items-center gap-2">
              <Input
                aria-label={t("form.roleNameLabel")}
                placeholder={t("form.roleNameLabel")}
                className="h-8 flex-1"
                value={row.name}
                disabled={disabled}
                onChange={(e) => updateRow(i, { name: e.target.value })}
              />
              <Input
                aria-label={t("form.countLabel")}
                inputMode="numeric"
                className="h-8 w-14 text-center"
                value={String(row.count)}
                disabled={disabled}
                onChange={(e) => {
                  const digits = e.target.value.replace(/[^\d]/g, "");
                  updateRow(i, { count: digits === "" ? 0 : parseInt(digits, 10) });
                }}
              />
              <div className="inline-flex overflow-hidden rounded-m border border-border">
                {(["main", "understudy"] as SlotKind[]).map((k) => (
                  <button
                    key={k}
                    type="button"
                    aria-pressed={row.kind === k}
                    disabled={disabled}
                    onClick={() => updateRow(i, { kind: k })}
                    className={cn(
                      "px-2 py-1 text-xs transition-colors",
                      row.kind === k ? "bg-primary/10 text-primary" : "text-muted-foreground hover:text-foreground",
                      disabled && "pointer-events-none opacity-50",
                    )}
                  >
                    {k === "main" ? t("form.kindMain") : t("form.kindUnderstudy")}
                  </button>
                ))}
              </div>
              <Button
                type="button"
                variant="ghost"
                size="icon"
                className="h-8 w-8 shrink-0"
                aria-label={t("form.removeSlot", { name: row.name || t("form.slotFallback") })}
                disabled={disabled}
                onClick={() => removeRow(i)}
              >
                <Trash2 className="h-4 w-4" />
              </Button>
            </div>
            <SkillPicker
              skills={skills}
              selectedIds={row.skillIds}
              onToggle={(id) => toggleRowSkill(i, id)}
              disabled={disabled}
              emptyHint={
                skillsUnreadable
                  ? t("form.skillsLoadFailed")
                  : canCreateSkill && onCreateSkill
                    ? t("form.skillsEmptyHint")
                    : t("form.skillsEmptyHintLocked")
              }
              onCreate={skillsUnreadable ? undefined : onCreateSkill}
              canCreate={canCreateSkill && !skillsUnreadable}
            />
          </div>
        ))}

        <Button type="button" variant="outline" size="sm" disabled={disabled} onClick={addRow}>
          <Plus className="mr-1.5 h-3.5 w-3.5" />{t("form.addSlot")}
        </Button>
      </div>

      {value.length > 0 && (
        <div className="rounded-m border border-primary/20 bg-primary/5 px-3 py-2 text-xs text-primary">
          {calloutText}
        </div>
      )}
    </div>
  );
}
