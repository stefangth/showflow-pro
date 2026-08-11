import { preflight, json } from "../_shared/http.ts";
import { requireCronOrRole } from "../_shared/auth.ts";
import { realDeps, type Deps } from "../_shared/deps.ts";
import { countAccepted, countPendingNotExpired, isFutureOrToday, requiredPrimarySlots } from "../_shared/tierFill.ts";
import { checkFeature } from "../_shared/entitlements.ts";
import { resolveBookingFlow, type BookingFlow } from "../_shared/bookingFlow.ts";
import { APP_URL } from "../_shared/app-url.ts";
import type { OrgAdminRow, ProducerAssignmentRow, ResolveShowAssignmentsArgs, ShowJoin } from "../_shared/rows.ts";

/** CTA target for the tier-at-risk email — same "review the date" destination the
 *  in-app notification's own remedy points at. */
const REVIEW_URL = `${APP_URL}/bookings`;

/** Mirrors the show_dates select below — unlike expire-offers' ShowDateWithShow,
 *  this select does NOT include show_id (the loop keys on row.show_date_id). */
interface TierShowDateRow {
  id: string
  date: string
  city_id: string | null
  org_id: string
  show: ShowJoin | null
}

/**
 * Scans all open offer tiers and emits a `tier_at_risk` notification when a
 * (show_date, tier) becomes mathematically unable to fill before the deadline:
 *   pending + accepted(all sources) < main_cast_slots
 *
 * Slot math (M2): a primary offer tier fills `main_cast_slots` (understudy slots are
 * filled separately, not by these offers), and "can this still fill" is judged against
 * accepted/confirmed bookings from ALL sources for the date — including manual bookings
 * (`offer_tier IS NULL`) and other tiers — plus this tier's own live pending offers.
 * Past dates are skipped so a closed date never re-alerts.
 *
 * Idempotent: one notification per (date, tier) — clears when math recovers (by
 * deleting the old row before re-evaluating).
 *
 * Also sends a best-effort `tier-at-risk` email to each recipient, but ONLY for
 * (tier, user) pairs whose in-app notification is NEWLY inserted this run — reusing
 * the same existingKeySet the idempotent insert below already computes, so a
 * persistently at-risk tier emails each recipient once, not every 15-minute run.
 * Mirrors expire-offers' cast-escalation-requested send: email failures are logged
 * and swallowed, never allowed to abort the scan or block the notification write.
 *
 * Gated per (show_date's) org on `booking_flow.at_risk_alerts` and `.artist_acceptance`
 * (direct-booking orgs have no offer tiers to be "at risk"). A gated tier is skipped
 * before it's counted at-risk, so it's also never exempted from the recovery pass below
 * — an org that turns at_risk_alerts off has its stale tier_at_risk notifications
 * cleared on the very next run, same as any tier that recovers.
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
  const { data: openTiers, error: tiersErr } = await admin
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
  // Cache resolveBookingFlow per org — multiple open tiers in a single scan can belong
  // to the same org, and the flow doesn't change mid-scan (mirrors expire-offers).
  const flowByOrg = new Map<string, BookingFlow>()
  // Entitlement cache mirroring flowByOrg: several open tiers in one scan can
  // belong to the same org, and entitlement does not change mid-scan.
  const entitledByOrg = new Map<string, boolean>()

  for (const row of openTiers as Array<{ id: string; show_date_id: string; tier: number }>) {
    // Resolve show date + show meta (including slot capacity columns)
    const { data: sd } = await admin
      .from('show_dates')
      .select('id, date, city_id, org_id, show:shows(program, sub_program, main_cast_slots, understudy_slots)')
      .eq('id', row.show_date_id)
      .maybeSingle()
    if (!sd) continue
    const sdRow = sd as unknown as TierShowDateRow

    // Gate on the org's booking flow: an org with at-risk alerts turned off, or in
    // direct-booking mode (no artist_acceptance → no offer tiers to be "at risk"), gets
    // no alerts for this tier. `continue` here (rather than an early return) means the
    // tier is simply never added to `stillAtRiskTierIds` below — the existing recovery
    // pass at the end of handle() then deletes any pre-existing tier_at_risk notification
    // for it exactly as it would for any other skipped tier, so disabling alerts clears
    // stale notifications automatically with no extra code.
    const orgId = sdRow.org_id

    // Module gate: booking_flow must be entitled for this org. Checked BEFORE
    // resolveBookingFlow below, because resolveBookingFlow itself fails open to
    // permissive defaults (at_risk_alerts: true, artist_acceptance: true) on an
    // entitlement-check failure — flow.at_risk_alerts alone is NOT a safe gate for
    // an unentitled org. Cached per org like flowByOrg: several open tiers in one
    // scan can belong to the same org, and entitlement doesn't change mid-scan. An
    // unentitled tier is simply `continue`d before it's added to stillAtRiskTierIds,
    // so the existing recovery pass clears any stale notification for it exactly as
    // it would for a disabled-alerts skip.
    let entitled = entitledByOrg.get(orgId)
    if (entitled === undefined) {
      entitled = await checkFeature(admin, orgId, 'booking_flow')
      entitledByOrg.set(orgId, entitled)
    }
    if (!entitled) continue

    // A per-org booking-flow read failure must not abort the whole scan; that would
    // also skip the stale-clear pass after the loop. Skip just this tier (leaving it out
    // of stillAtRiskTierIds, so the recovery pass clears any stale alert for it, exactly
    // as a disabled-alerts skip does) and do NOT cache, so a later row for the same org
    // can retry the resolve.
    let flow = flowByOrg.get(orgId)
    if (!flow) {
      try {
        flow = await resolveBookingFlow(admin, orgId)
      } catch (e) {
        console.error('tier-at-risk-watcher: booking flow read failed', { org: orgId, showDateId: row.show_date_id, error: (e as Error).message })
        continue
      }
      flowByOrg.set(orgId, flow)
    }
    if (!flow.active || !flow.at_risk_alerts || !flow.artist_acceptance) continue

    const program = sdRow.show?.program
    const subProgram = sdRow.show?.sub_program

    // Past dates can no longer fill — never alert (would re-fire forever otherwise).
    if (!isFutureOrToday(sdRow.date, deps.now())) continue

    // requiredSlots = main_cast_slots (what a primary offer tier fills). NULL = unconfigured → skip.
    const requiredSlots = requiredPrimarySlots({
      main_cast_slots: sdRow.show?.main_cast_slots ?? null,
      understudy_slots: sdRow.show?.understudy_slots ?? null,
    })
    if (requiredSlots === null) continue
    if (requiredSlots === 0) continue

    // Count for this show_date across ALL sources (all tiers + manual offer_tier NULL),
    // NOT just this tier: a date filled via tier-1 or a manual booking is not at risk.
    const { data: bookings } = await admin
      .from('bookings')
      .select('status, offer_expires_at')
      .eq('show_date_id', row.show_date_id)

    const rows = (bookings ?? []) as Array<{ status?: string | null; offer_expires_at?: string | null }>
    // Only live (not-yet-expired) suggested offers count toward "can this still fill".
    // A suggested offer past its offer_expires_at that expire-offers hasn't swept yet is
    // effectively lapsed — counting it as pending would suppress the at-risk alert for up
    // to ~1h (the expire-offers cadence). Mirrors expire-offers' fill math.
    const pending = countPendingNotExpired(rows, deps.now())
    const accepted = countAccepted(rows)

    if (pending + accepted >= requiredSlots) continue // healthy

    atRiskCount += 1
    stillAtRiskTierIds.add(row.id)

    // Resolve producers to notify (admin fallback). Dedupe — resolve_show_assignments
    // can return the same producer multiple times when several scopes match.
    const { data: producers } = await admin.rpc('resolve_show_assignments', {
      p_program: program ?? '',
      p_sub_program: subProgram,
      p_city_id: sdRow.city_id,
      p_org: sdRow.org_id,
      // The SQL function accepts NULL sub_program/city_id; type-gen doesn't model that.
    } as ResolveShowAssignmentsArgs)

    let recipientIds = Array.from(new Set(((producers ?? []) as unknown as ProducerAssignmentRow[]).map((p) => p.producer_user_id)))
    if (recipientIds.length === 0) {
      // Fallback: notify admins OF THIS show_date's org (not every org's admins).
      const { data: admins } = await admin.from('org_memberships').select('user_id')
        .eq('org_id', sdRow.org_id).eq('role', 'admin')
      recipientIds = Array.from(new Set(((admins ?? []) as unknown as OrgAdminRow[]).map((a) => a.user_id)))
    }

    // Softened from the old "is mathematically unfillable" phrasing: states the same
    // math but ends with recovery guidance (open the next tier, or book directly from
    // the eligibility list) instead of just stopping at the numbers.
    const payloadMessage = `Tier ${row.tier} for ${program ?? 'show'} on ${sdRow.date} cannot fill on the current offers (${pending} pending, ${accepted} accepted, need ${requiredSlots}). Open the next tier or book directly from the eligibility list to fill it.`

    // Only insert notifications for (tier, user) pairs that don't already have one —
    // and only EMAIL those same newly-inserted pairs (below), reusing this exact key,
    // so a persistently at-risk tier emails each recipient once, not every run.
    const newRecipientIds = recipientIds.filter(uid => !existingKeySet.has(`${row.id}::${uid}`))
    const newRows = newRecipientIds.map(uid => ({
      org_id: sdRow.org_id,
      user_id: uid,
      type: 'tier_at_risk',
      title: 'Tier at risk',
      message: payloadMessage,
      related_entity_type: 'show_date_offer_tier',
      related_entity_id: row.id,
    }))

    // The insert's error was previously unchecked: a silent write failure (e.g. an RLS
    // or connectivity blip) still fell through to the email loop below, so the producer
    // got emailed for a notification that was never actually written — and since
    // existingKeySet only ever reflects rows that DID land, the same pair would be
    // treated as "new" again next run and re-emailed forever. On error, log it and skip
    // the email for every pair in this batch (never throw — the scan must still finish
    // and move on to the next tier, same failure-swallowing posture as the email send
    // and getUserById lookup below).
    let notificationInsertFailed = false
    if (newRows.length > 0) {
      const { error: insertErr } = await admin.from('notifications').insert(newRows)
      if (insertErr) {
        console.error('tier-at-risk-watcher: notification insert failed', { showDateId: row.show_date_id, tierId: row.id, error: insertErr.message })
        notificationInsertFailed = true
      }
    }

    // Best-effort producer email for each newly at-risk (tier, user) pair, mirroring
    // expire-offers' cast-escalation-requested send. Email lives on auth.users —
    // `profiles` has no email column. The WHOLE per-recipient path (the getUserById
    // lookup AND the send) is inside the try/catch: a lookup failure (auth service
    // outage) must be swallowed exactly like a send failure, never propagate and
    // abort the rest of the scan. The notification write above already happened, so
    // nothing here can undo it either way.
    for (const uid of newRecipientIds) {
      if (notificationInsertFailed) continue // no notification was written for this pair — don't email either
      try {
        const { data: userResp } = await admin.auth.admin.getUserById(uid)
        const recipientEmail = userResp?.user?.email
        if (!recipientEmail) continue
        await deps.sendEmail({
          template_name: 'tier-at-risk',
          recipient_email: recipientEmail,
          org_id: sdRow.org_id,
          templateData: {
            program,
            date: sdRow.date,
            tier: row.tier,
            pending,
            accepted,
            required: requiredSlots,
            reviewUrl: REVIEW_URL,
          },
        })
      } catch (e) {
        console.error('tier-at-risk-watcher: email send failed', { uid, showDateId: row.show_date_id, error: (e as Error).message })
      }
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
