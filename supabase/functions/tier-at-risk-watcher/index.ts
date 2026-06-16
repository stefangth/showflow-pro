import { preflight, json } from "../_shared/http.ts";
import { requireCronOrRole } from "../_shared/auth.ts";
import { realDeps, type Deps } from "../_shared/deps.ts";

/**
 * Scans all open offer tiers and emits a `tier_at_risk` notification when a
 * (show_date, tier) becomes mathematically unable to fill before the deadline:
 *   remaining_pending + accepted < required_slots
 *
 * Visual-only (in-app); no email. Idempotent: one notification per (date, tier)
 * — clears when math recovers (by deleting the old row before re-evaluating).
 *
 * Auth: X-Cron-Secret header (pg_cron) or user JWT (admin/producer manual trigger).
 */
export async function handle(req: Request, deps: Deps): Promise<Response> {
  if (req.method === "OPTIONS") return preflight();

  const admin = deps.admin;

  // ── Auth: X-Cron-Secret or user JWT ──────────────────────────────────────
  const auth = await requireCronOrRole(deps, req, ["admin", "producer"]);
  if (!auth.ok) return auth.response;

  // Load all currently-open tiers (closed_at IS NULL)
  const { data: openTiers, error: tiersErr } = await (admin as any)
    .from('show_date_offer_tiers')
    .select('id, show_date_id, tier')
    .is('closed_at', null)

  if (tiersErr) return json({ error: tiersErr.message }, 500)

  // Load existing tier_at_risk notifications so we can:
  //   1. Skip re-creating one that already exists for (tier, user) — preserves read state
  //   2. Delete ones whose tier has since recovered (including tiers that have closed entirely)
  //
  // NOTE: This must happen BEFORE the empty-tiers early-exit so that stale notifications
  // are cleared even when all open tiers have since been closed (closed_at set).
  const { data: existingTierAtRiskNotifs } = await admin
    .from('notifications')
    .select('id, user_id, related_entity_id')
    .eq('type', 'tier_at_risk')

  // If there are no open tiers and no stale notifications, skip all further work.
  if ((!openTiers || openTiers.length === 0) && (existingTierAtRiskNotifs ?? []).length === 0) {
    return json({ at_risk_count: 0, cleared: 0 })
  }

  const existingKeySet = new Set<string>()
  for (const n of (existingTierAtRiskNotifs ?? []) as Array<{ id: string; user_id: string; related_entity_id: string }>) {
    existingKeySet.add(`${n.related_entity_id}::${n.user_id}`)
  }

  const stillAtRiskTierIds = new Set<string>()
  let atRiskCount = 0

  for (const row of openTiers as Array<{ id: string; show_date_id: string; tier: number }>) {
    // Resolve show date + show meta (including slot capacity columns)
    const { data: sd } = await admin
      .from('show_dates')
      .select('id, date, city_id, org_id, show:shows(program, sub_program, main_cast_slots, understudy_slots)')
      .eq('id', row.show_date_id)
      .maybeSingle()
    if (!sd) continue

    const program = (sd as any).show?.program
    const subProgram = (sd as any).show?.sub_program
    const mainCastSlots: number | null = (sd as any).show?.main_cast_slots ?? null
    const understudySlots: number | null = (sd as any).show?.understudy_slots ?? null

    // NULL slot columns = unconfigured show; skip (mirrors old behaviour when the
    // sub_program_slots_defaults JSON had no entry for this program/sub_program).
    if (mainCastSlots === null || understudySlots === null) continue
    const requiredSlots = mainCastSlots + understudySlots
    if (requiredSlots === 0) continue

    // Count for this show_date, this tier
    const { data: bookings } = await admin
      .from('bookings')
      .select('status')
      .eq('show_date_id', row.show_date_id)
      .eq('offer_tier', row.tier)

    const pending = (bookings ?? []).filter((b: any) => b.status === 'suggested').length
    const accepted = (bookings ?? []).filter((b: any) => b.status === 'soft_booked' || b.status === 'confirmed').length

    if (pending + accepted >= requiredSlots) continue // healthy

    atRiskCount += 1
    stillAtRiskTierIds.add(row.id)

    // Resolve producers to notify (admin fallback). Dedupe — resolve_show_assignments
    // can return the same producer multiple times when several scopes match.
    const { data: producers } = await (admin as any).rpc('resolve_show_assignments', {
      p_program: program ?? '',
      p_sub_program: subProgram,
      p_city_id: (sd as any).city_id,
      p_org: (sd as any).org_id,
    })

    let recipientIds = Array.from(new Set((producers ?? []).map((p: any) => p.producer_user_id)))
    if (recipientIds.length === 0) {
      // Fallback: notify admins OF THIS show_date's org (not every org's admins).
      const { data: admins } = await admin.from('org_memberships').select('user_id')
        .eq('org_id', (sd as any).org_id).eq('role', 'admin')
      recipientIds = Array.from(new Set((admins ?? []).map((a: any) => a.user_id)))
    }

    const payloadMessage = `Tier ${row.tier} for ${program ?? 'show'} on ${(sd as any).date} is mathematically unfillable (${pending} pending, ${accepted} accepted, need ${requiredSlots}).`

    // Only insert notifications for (tier, user) pairs that don't already have one
    const newRows = (recipientIds as string[])
      .filter(uid => !existingKeySet.has(`${row.id}::${uid}`))
      .map(uid => ({
        org_id: (sd as any).org_id,
        user_id: uid,
        type: 'tier_at_risk',
        title: 'Tier at risk',
        message: payloadMessage,
        related_entity_type: 'show_date_offer_tier',
        related_entity_id: row.id,
      }))

    if (newRows.length > 0) {
      await admin.from('notifications').insert(newRows)
    }
  }

  // Delete tier_at_risk notifications whose tier is no longer at risk
  const idsToDelete = ((existingTierAtRiskNotifs ?? []) as Array<{ id: string; related_entity_id: string }>)
    .filter(n => !stillAtRiskTierIds.has(n.related_entity_id))
    .map(n => n.id)

  if (idsToDelete.length > 0) {
    await admin.from('notifications').delete().in('id', idsToDelete)
  }

  return json({ at_risk_count: atRiskCount, cleared: idsToDelete.length })
}

if (import.meta.main) Deno.serve((req) => handle(req, realDeps()));
