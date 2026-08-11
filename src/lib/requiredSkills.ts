import type { SlotDraft } from "@/data/slots";
import { unionSkillIds } from "@/lib/eligibility";

/** A row in the Offers-tab "Skills required on this date" card. */
export interface RequiredSkillCardRow {
  skillId: string;
  name: string;
  kind: "inherited" | "added" | "dropped";
  /** Slot names that require this skill, grouped as "Name ×N" for repeats.
   *  Inherited rows only — a date-added skill has no slot provenance. */
  provenance?: string;
}

export interface RequiredSkillCard {
  /** inherited + added rows first (in showSkillIds/dateSkillIds order), dropped rows last. */
  rows: RequiredSkillCardRow[];
  /** Number of named slot rows on the production (not a headcount sum). */
  slotCount: number;
  /** Count of date-adds + count of drops actually rendered — what the footer's
   *  "N changes from the production default" describes. */
  changeCount: number;
}

export interface ComputeRequiredSkillCardArgs {
  slots: SlotDraft[];
  /** Show-level (inherited) required skill ids — the maintained cache. */
  showSkillIds: string[];
  /** Skill ids added on this date only. */
  dateSkillIds: string[];
  /** Show-level skill ids dropped on this date (show_date_skill_drops). */
  droppedSkillIds: string[];
  skills: { id: string; name: string }[];
}

/** Slot names requiring `skillId`, in first-appearance order, grouped as
 *  "Name" (single) or "Name ×N" (N slot rows sharing that name). */
function slotProvenance(slots: SlotDraft[], skillId: string): string {
  const counts = new Map<string, number>();
  for (const slot of slots) {
    if (!slot.skillIds.includes(skillId)) continue;
    counts.set(slot.name, (counts.get(slot.name) ?? 0) + 1);
  }
  return [...counts.entries()]
    .map(([name, count]) => (count > 1 ? `${name} ×${count}` : name))
    .join(", ");
}

/**
 * Pure view-model builder for the RequiredSkillsCard (design 1e, Offers tab).
 * Mirrors `fetchRequiredSkillIds`'s effective-union math (show ∪ dateAdded) \
 * (dropped ∩ show) — a drop is provenance-aware and only subtracts a
 * show-level skill, so a stale drop for a skill that isn't show-level is
 * inert here too and renders nothing.
 *
 * `slots` (Plan B named production slots) are used for provenance only — the
 * authoritative required-skill set comes from `showSkillIds`/`dateSkillIds`/
 * `droppedSkillIds`, which the sheet reads from `fetchRequiredSkillIds` and
 * `fetchShowDateSkillDrops`.
 */
export function computeRequiredSkillCard(args: ComputeRequiredSkillCardArgs): RequiredSkillCard {
  const { slots, showSkillIds, dateSkillIds, droppedSkillIds, skills } = args;
  const nameById = new Map(skills.map((s) => [s.id, s.name]));
  const nameOf = (id: string) => nameById.get(id) ?? id;

  const showSet = new Set(showSkillIds);
  const droppedSet = new Set(droppedSkillIds);
  const requiredSet = new Set(
    unionSkillIds(showSkillIds, dateSkillIds).filter((id) => !(droppedSet.has(id) && showSet.has(id))),
  );

  const rows: RequiredSkillCardRow[] = [];

  for (const id of showSkillIds) {
    if (!requiredSet.has(id)) continue; // dropped on this date; rendered in the dropped pass below
    rows.push({ skillId: id, name: nameOf(id), kind: "inherited", provenance: slotProvenance(slots, id) });
  }

  for (const id of dateSkillIds) {
    if (showSet.has(id)) continue; // already covered as inherited above
    if (!requiredSet.has(id)) continue; // defensive; date-adds are never subject to drops
    rows.push({ skillId: id, name: nameOf(id), kind: "added" });
  }

  for (const id of droppedSkillIds) {
    // A drop only has visible effect on a show-level skill (provenance-aware
    // subtraction); a stale drop row for a non-show skill is inert.
    if (!showSet.has(id)) continue;
    rows.push({ skillId: id, name: nameOf(id), kind: "dropped" });
  }

  const changeCount = rows.filter((r) => r.kind === "added" || r.kind === "dropped").length;

  return { rows, slotCount: slots.length, changeCount };
}
