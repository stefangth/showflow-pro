import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/integrations/supabase/types";

/**
 * Named production slots (design 1g). A production's two bare slot-count
 * fields and its flat required-skills picker are authored as `show_slots`
 * rows (role name, count, main/understudy, per-slot required skills). The
 * `recompute_show_slot_derivations` DB trigger keeps `shows.main_cast_slots`,
 * `shows.understudy_slots`, and `show_required_skills` as maintained caches
 * derived from these rows, so nothing downstream of those caches changes.
 */

export type SlotKind = "main" | "understudy";

export interface SlotDraft {
  id?: string;
  name: string;
  count: number;
  kind: SlotKind;
  skillIds: string[];
}

interface ShowSlotRow {
  id: string;
  name: string;
  slot_count: number;
  kind: string;
  sort_order: number | null;
}

interface SlotSkillRow {
  slot_id: string;
  skill_id: string;
}

/** A production's slot rows, ordered for display, with each slot's required
 *  skill ids attached. Two queries (not a nested embed) so both the shape and
 *  the diffing in `saveShowSlots` stay simple to test. */
export async function fetchShowSlots(
  client: SupabaseClient<Database>,
  showId: string,
): Promise<SlotDraft[]> {
  const { data: slotRows, error: slotErr } = await client
    .from("show_slots")
    .select("id, name, slot_count, kind, sort_order")
    .eq("show_id", showId)
    .order("sort_order", { ascending: true });
  if (slotErr) throw slotErr;
  const rows = (slotRows ?? []) as unknown as ShowSlotRow[];
  if (rows.length === 0) return [];

  const slotIds = rows.map((r) => r.id);
  const { data: skillRows, error: skillErr } = await client
    .from("show_slot_required_skills")
    .select("slot_id, skill_id")
    .in("slot_id", slotIds);
  if (skillErr) throw skillErr;

  const skillIdsBySlot = new Map<string, string[]>();
  for (const r of (skillRows ?? []) as unknown as SlotSkillRow[]) {
    const arr = skillIdsBySlot.get(r.slot_id) ?? [];
    arr.push(r.skill_id);
    skillIdsBySlot.set(r.slot_id, arr);
  }

  return rows.map((r) => ({
    id: r.id,
    name: r.name,
    count: r.slot_count,
    kind: r.kind as SlotKind,
    skillIds: skillIdsBySlot.get(r.id) ?? [],
  }));
}

export interface SaveShowSlotsArgs {
  showId: string;
  orgId: string;
  slots: SlotDraft[];
}

/**
 * Reconciles a production's `show_slots` (and each slot's
 * `show_slot_required_skills`) rows to match `slots`. Diffs against the
 * show's CURRENT rows, read fresh inside this call rather than a caller-held
 * baseline: a slot with an `id` matching a current row is updated only when a
 * tracked field actually changed; a slot without an `id` (or whose `id` no
 * longer matches a current row, e.g. concurrently deleted) is inserted;
 * current rows absent from `slots` are deleted (cascades to their
 * `show_slot_required_skills` rows). Each surviving/created slot's skill set
 * is then diffed the same way `applyRequiredSkillsDiff` diffs a show's
 * required skills in ShowFormDialog, just against a freshly-read baseline
 * instead of a component ref. `slots` order is authoritative for
 * `sort_order` (index-based).
 *
 * Note: because a brand-new slot has no `id` to correlate on, a blind retry
 * of the exact same `slots` array after a partial failure will re-insert any
 * new slots that already landed. Callers that need exactly-once semantics for
 * new rows should re-fetch (`fetchShowSlots`) before retrying, or track the
 * ids assigned on the first attempt.
 */
export async function saveShowSlots(
  client: SupabaseClient<Database>,
  args: SaveShowSlotsArgs,
): Promise<void> {
  const { showId, orgId, slots } = args;

  const { data: currentRows, error: curErr } = await client
    .from("show_slots")
    .select("id, name, slot_count, kind, sort_order")
    .eq("show_id", showId);
  if (curErr) throw curErr;
  const current = (currentRows ?? []) as unknown as ShowSlotRow[];
  const currentById = new Map(current.map((r) => [r.id, r]));

  const keepIds = new Set(slots.map((s) => s.id).filter((id): id is string => !!id));
  for (const row of current) {
    if (keepIds.has(row.id)) continue;
    const { error } = await client.from("show_slots").delete().eq("id", row.id);
    if (error) throw error;
  }

  const resolvedIds: string[] = [];
  for (let i = 0; i < slots.length; i++) {
    const s = slots[i];
    const existing = s.id ? currentById.get(s.id) : undefined;
    if (existing) {
      const changed =
        existing.name !== s.name ||
        existing.slot_count !== s.count ||
        existing.kind !== s.kind ||
        existing.sort_order !== i;
      if (changed) {
        const { error } = await client
          .from("show_slots")
          .update({ name: s.name, slot_count: s.count, kind: s.kind, sort_order: i })
          .eq("id", existing.id);
        if (error) throw error;
      }
      resolvedIds.push(existing.id);
    } else {
      const { data, error } = await client
        .from("show_slots")
        .insert({ show_id: showId, org_id: orgId, name: s.name, slot_count: s.count, kind: s.kind, sort_order: i })
        .select("id")
        .single();
      if (error) throw error;
      resolvedIds.push((data as { id: string }).id);
    }
  }

  if (resolvedIds.length === 0) return;

  const { data: skillRows, error: skillErr } = await client
    .from("show_slot_required_skills")
    .select("slot_id, skill_id")
    .in("slot_id", resolvedIds);
  if (skillErr) throw skillErr;
  const currentSkillsBySlot = new Map<string, Set<string>>();
  for (const r of (skillRows ?? []) as unknown as SlotSkillRow[]) {
    const set = currentSkillsBySlot.get(r.slot_id) ?? new Set<string>();
    set.add(r.skill_id);
    currentSkillsBySlot.set(r.slot_id, set);
  }

  for (let i = 0; i < slots.length; i++) {
    const slotId = resolvedIds[i];
    const desired = new Set(slots[i].skillIds);
    const existingSkills = currentSkillsBySlot.get(slotId) ?? new Set<string>();
    for (const skillId of desired) {
      if (existingSkills.has(skillId)) continue;
      const { error } = await client
        .from("show_slot_required_skills")
        .insert({ slot_id: slotId, skill_id: skillId, org_id: orgId });
      if (error) throw error;
    }
    for (const skillId of existingSkills) {
      if (desired.has(skillId)) continue;
      const { error } = await client
        .from("show_slot_required_skills")
        .delete()
        .eq("slot_id", slotId)
        .eq("skill_id", skillId);
      if (error) throw error;
    }
  }
}
