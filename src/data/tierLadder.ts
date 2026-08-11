import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/integrations/supabase/types";
import { fetchCastMemberCounts } from "@/data/casts";
import { fetchRequiredSkillIds, fetchSkillEligibleArtistIds } from "@/data/eligibility";
import { fetchBlockedArtistIds } from "@/data/blockedDates";

/**
 * Client-side mirror of the server's tier ladder resolver
 * (`supabase/functions/_shared/eligibility.ts`: `resolveTierLadder` / `ladderCastIdsAtTier`),
 * extended to name the casts at each tier for the Offers cockpit. Show-scoped
 * prioritized `show_cast_eligibility` rows win outright for (show, city);
 * otherwise the org-wide `cast_city_priority` list for the city is the fallback.
 * A tier with multiple cast ids at the same priority yields multiple casts.
 *
 * Cast names are read directly from `casts` filtered by `.in('id', castIds)`
 * rather than via `fetchCasts` (which lists a whole org's casts): the cast ids
 * here already come from show/city-scoped queries, so per ADR-0003 ("a UUID FK
 * needs no org filter — it belongs to exactly one org") no separate org filter
 * is needed to keep this org-safe.
 */

export interface TierCastRef { id: string; name: string }
export interface TierCast { tier: number; casts: TierCastRef[] }

interface PriorityRow { cast_id: string; priority: number }

/** The tier -> cast(s) map for a (show, city), sorted by tier ascending. */
export async function fetchTierCastMap(
  client: SupabaseClient<Database>,
  args: { showId: string; cityId: string | null },
): Promise<TierCast[]> {
  if (!args.cityId) return [];

  const { data: showRows, error: showErr } = await client
    .from("show_cast_eligibility")
    .select("cast_id, priority")
    .eq("show_id", args.showId)
    .eq("city_id", args.cityId)
    .not("priority", "is", null);
  if (showErr) throw showErr;
  const show = (showRows ?? []) as PriorityRow[];

  let rows: PriorityRow[];
  if (show.length > 0) {
    rows = show;
  } else {
    const { data: cityRows, error: cityErr } = await client
      .from("cast_city_priority")
      .select("cast_id, priority")
      .eq("city_id", args.cityId);
    if (cityErr) throw cityErr;
    rows = (cityRows ?? []) as PriorityRow[];
  }

  if (rows.length === 0) return [];

  const castIds = [...new Set(rows.map((r) => r.cast_id))];
  const { data: castRows, error: castErr } = await client
    .from("casts")
    .select("id, name")
    .in("id", castIds);
  if (castErr) throw castErr;
  const names = new Map(((castRows ?? []) as TierCastRef[]).map((c) => [c.id, c.name]));

  const byTier = new Map<number, TierCastRef[]>();
  for (const r of rows) {
    const arr = byTier.get(r.priority) ?? [];
    arr.push({ id: r.cast_id, name: names.get(r.cast_id) ?? "" });
    byTier.set(r.priority, arr);
  }
  return [...byTier.entries()]
    .sort(([a], [b]) => a - b)
    .map(([tier, casts]) => ({ tier, casts }));
}

export interface TierLadderRow extends TierCast {
  /** Raw member-position count across the tier's cast(s) (the "of M" denominator),
   *  from `fetchCastMemberCounts` — independent of artist active status. */
  castTotal: number;
  /** Active members of the tier's cast(s) who hold every required skill, are not
   *  blocked on the date, and do not already have a non-cancelled booking for it. */
  matchCount: number;
  /** Active, not-already-offered, not-blocked members who miss a required skill. */
  missingSkillCount: number;
  /** Active, not-already-offered members with a blocked_dates row for the date. */
  blockedCount: number;
  /** Active members who already hold a non-cancelled booking (any status) for the date. */
  alreadyOfferedCount: number;
}

interface MemberRow { cast_id: string; artist_id: string }
interface ArtistStatusRow { id: string; status: string }
interface BookingArtistRow { artist_id: string }

/**
 * Per-tier headcounts for the show-specific ladder, computed in ONE client-side
 * pass over already-readable tables rather than N per-tier dry-run edge calls
 * (open-offer-tier). Mirrors open-offer-tier's elimination waterfall (already
 * booked/offered -> blocked -> missing skills), minus the show-eligibility gate
 * step: a tier's candidate pool is already exactly its cast(s)' members, and
 * those cast ids come from the same show/date eligibility rows the gate itself
 * reads, so the gate can never eliminate anyone here.
 */
export async function fetchTierLadderCounts(
  client: SupabaseClient<Database>,
  args: { showId: string; showDateId: string; cityId: string | null; orgId: string | null },
): Promise<TierLadderRow[]> {
  const tierMap = await fetchTierCastMap(client, { showId: args.showId, cityId: args.cityId });
  if (tierMap.length === 0) return [];

  const allCastIds = [...new Set(tierMap.flatMap((t) => t.casts.map((c) => c.id)))];

  const memberCounts = await fetchCastMemberCounts(client, args.orgId);

  const { data: memberRows, error: memberErr } = await client
    .from("cast_members")
    .select("cast_id, artist_id")
    .in("cast_id", allCastIds);
  if (memberErr) throw memberErr;
  const members = (memberRows ?? []) as MemberRow[];

  const allArtistIds = [...new Set(members.map((m) => m.artist_id))];

  const { data: artistRows, error: artistErr } = await client
    .from("artists")
    .select("id, status")
    .in("id", allArtistIds);
  if (artistErr) throw artistErr;
  const activeArtistIds = new Set(
    ((artistRows ?? []) as ArtistStatusRow[]).filter((a) => a.status === "active").map((a) => a.id),
  );

  const { data: bookingRows, error: bookingErr } = await client
    .from("bookings")
    .select("artist_id")
    .eq("show_date_id", args.showDateId)
    .neq("status", "cancelled");
  if (bookingErr) throw bookingErr;
  const offeredArtistIds = new Set(((bookingRows ?? []) as BookingArtistRow[]).map((r) => r.artist_id));

  const { data: dateRow, error: dateErr } = await client
    .from("show_dates")
    .select("date")
    .eq("id", args.showDateId)
    .maybeSingle();
  if (dateErr) throw dateErr;
  const date = (dateRow as { date: string } | null)?.date ?? null;
  const blockedArtistIds = date
    ? await fetchBlockedArtistIds(client, { date, orgId: args.orgId })
    : new Set<string>();

  const required = await fetchRequiredSkillIds(client, { showId: args.showId, showDateId: args.showDateId });
  const skillEligible = await fetchSkillEligibleArtistIds(client, { requiredSkillIds: required.all });

  return tierMap.map((t) => {
    const tierCastIds = new Set(t.casts.map((c) => c.id));
    const tierArtistIds = [...new Set(
      members.filter((m) => tierCastIds.has(m.cast_id)).map((m) => m.artist_id),
    )];
    const castTotal = t.casts.reduce((sum, c) => sum + (memberCounts[c.id] ?? 0), 0);

    // Waterfall, mirroring open-offer-tier: active -> not already offered/booked
    // -> not blocked -> holds every required skill. Each artist lands in exactly
    // one bucket, so the counts never double-count.
    const active = tierArtistIds.filter((id) => activeArtistIds.has(id));
    const alreadyOffered = active.filter((id) => offeredArtistIds.has(id));
    const afterOffered = active.filter((id) => !offeredArtistIds.has(id));
    const blocked = afterOffered.filter((id) => blockedArtistIds.has(id));
    const afterBlocked = afterOffered.filter((id) => !blockedArtistIds.has(id));
    const missing = skillEligible == null ? [] : afterBlocked.filter((id) => !skillEligible.has(id));
    const match = skillEligible == null ? afterBlocked : afterBlocked.filter((id) => skillEligible.has(id));

    return {
      tier: t.tier,
      casts: t.casts,
      castTotal,
      matchCount: match.length,
      missingSkillCount: missing.length,
      blockedCount: blocked.length,
      alreadyOfferedCount: alreadyOffered.length,
    };
  });
}
