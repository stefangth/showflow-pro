import { preflight, json } from "../_shared/http.ts";
import { requireCronOrRole } from "../_shared/auth.ts";
import { realDeps, type Deps } from "../_shared/deps.ts";
import { countAccepted, countPendingNotExpired, isFutureOrToday, requiredPrimarySlots } from "../_shared/tierFill.ts";

/**
 * Hourly job:
 *   1. Call expire_soft_bookings() RPC to cancel any expired offers.
 *   2. For each FUTURE show_date with a still-unfilled tier after expiry, write a
 *      cast_escalation_requested notification + send a producer email.
 *   3. Mark show_date_offer_tiers.escalation_notified_at to be idempotent.
 *
 * Slot math (M2): a primary offer tier fills `main_cast_slots`; "still short" is judged
 * against accepted/confirmed bookings from ALL sources for the date (any tier + manual
 * `offer_tier IS NULL`) while this tier's own offers have all lapsed. Past dates are
 * skipped so a closed date never escalates.
 *
 * Auth: X-Cron-Secret header (pg_cron) or user JWT (admin/producer manual trigger).
 */
export async function handle(req: Request, deps: Deps): Promise<Response> {
  if (req.method === "OPTIONS") return preflight();

  const admin = deps.admin;

  // ── Auth: X-Cron-Secret or user JWT ──────────────────────────────────────
  const auth = await requireCronOrRole(deps, req, ["admin", "producer"]);
  if (!auth.ok) return auth.response;

  // 1. Expire stale offers
  const { error: rpcErr } = await admin.rpc('expire_soft_bookings')
  if (rpcErr) return json({ error: `expire_soft_bookings: ${rpcErr.message}` }, 500)

  // 2. Find open tiers that have never been escalated
  const { data: openTiers } = await (admin as any)
    .from('show_date_offer_tiers')
    .select('id, show_date_id, tier, escalation_notified_at')
    .is('closed_at', null)
    .is('escalation_notified_at', null)

  if (!openTiers || openTiers.length === 0) return json({ expired: true, escalations: 0 })

  let escalated = 0

  for (const row of openTiers as Array<{ id: string; show_date_id: string; tier: number }>) {
    const { data: sd } = await admin
      .from('show_dates')
      .select('id, date, city_id, org_id, show:shows(program, sub_program, main_cast_slots, understudy_slots)')
      .eq('id', row.show_date_id)
      .maybeSingle()
    if (!sd) continue

    const program = (sd as any).show?.program
    const subProgram = (sd as any).show?.sub_program

    // Past dates can no longer fill — never escalate (would re-fire forever otherwise).
    if (!isFutureOrToday((sd as any).date, deps.now())) continue

    // requiredSlots = main_cast_slots (what a primary offer tier fills). NULL = unconfigured → skip.
    const requiredSlots = requiredPrimarySlots({
      main_cast_slots: (sd as any).show?.main_cast_slots ?? null,
      understudy_slots: (sd as any).show?.understudy_slots ?? null,
    })
    if (requiredSlots === null) continue

    // Fetch every booking for this date (all tiers + manual offer_tier NULL). `accepted`
    // counts across all sources; the "tier window has closed" check only looks at THIS
    // tier's still-live pending offers.
    const { data: bookings } = await admin
      .from('bookings')
      .select('status, offer_tier, offer_expires_at')
      .eq('show_date_id', row.show_date_id)

    const allRows = (bookings ?? []) as Array<{ status?: string | null; offer_tier?: number | null; offer_expires_at?: string | null }>
    const accepted = countAccepted(allRows)
    const pendingNotExpired = countPendingNotExpired(
      allRows.filter((b) => b.offer_tier === row.tier),
      deps.now(),
    )

    // Only escalate when THIS tier's window has fully closed (no live pending) AND the
    // date is still short of its primary slots (counting all sources).
    if (pendingNotExpired > 0) continue
    if (accepted >= requiredSlots) continue

    // Resolve recipients
    const { data: producers } = await (admin as any).rpc('resolve_show_assignments', {
      p_program: program ?? '',
      p_sub_program: subProgram,
      p_city_id: (sd as any).city_id,
      p_org: (sd as any).org_id,
    })
    let recipientIds = (producers ?? []).map((p: any) => p.producer_user_id)
    if (recipientIds.length === 0) {
      // Fallback: notify admins OF THIS show_date's org (not every org's admins).
      const { data: admins } = await admin.from('org_memberships').select('user_id')
        .eq('org_id', (sd as any).org_id).eq('role', 'admin')
      recipientIds = (admins ?? []).map((a: any) => a.user_id)
    }
    recipientIds = [...new Set(recipientIds)]

    const message = `Tier ${row.tier} for ${program ?? 'show'} on ${(sd as any).date} expired with ${accepted}/${requiredSlots} slots filled — open the next tier.`

    const notifRows = recipientIds.map((uid: string) => ({
      org_id: (sd as any).org_id,
      user_id: uid,
      type: 'cast_escalation_requested',
      title: 'Escalation needed',
      message,
      related_entity_type: 'show_date_offer_tier',
      related_entity_id: row.id,
    }))
    if (notifRows.length > 0) {
      await admin.from('notifications').insert(notifRows)
    }

    // Send producer emails (best-effort, non-blocking on failures).
    // Email lives on auth.users — `profiles` has no email column.
    for (const uid of recipientIds) {
      const { data: userResp } = await admin.auth.admin.getUserById(uid)
      const recipientEmail = userResp?.user?.email
      if (!recipientEmail) continue
      try {
        await deps.sendEmail({ template_name: 'cast-escalation-requested', recipient_email: recipientEmail,
          templateData: { program, date: (sd as any).date, tier: row.tier, accepted, required: requiredSlots } })
      } catch (e) {
        console.error('expire-offers: email send failed', { uid, error: (e as Error).message })
      }
    }

    // Mark idempotent
    await (admin as any)
      .from('show_date_offer_tiers')
      .update({ escalation_notified_at: deps.now().toISOString() })
      .eq('id', row.id)

    escalated += 1
  }

  return json({ expired: true, escalations: escalated })
}

if (import.meta.main) Deno.serve((req) => handle(req, realDeps()));
