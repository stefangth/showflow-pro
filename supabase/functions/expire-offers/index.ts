import { preflight, json } from "../_shared/http.ts";
import { requireCronOrRole } from "../_shared/auth.ts";
import { realDeps, emailWasSent, type Deps } from "../_shared/deps.ts";
import { countAccepted, countPendingNotExpired, isFutureOrToday, requiredPrimarySlots } from "../_shared/tierFill.ts";
import { getActiveOrgs } from "../_shared/settings.ts";
import { resolveOrgLocale } from "../_shared/orgLocale.ts";
import { filterEntitledOrgs } from "../_shared/entitlements.ts";
import { resolveBookingFlow, referenceLabel, type BookingFlow } from "../_shared/bookingFlow.ts";
import { resolveContactEmail, resolveAccountDisplayName } from "../_shared/identity.ts";
import { resolveTierLadder, nextTierAfter } from "../_shared/eligibility.ts";
import type { DueBookingRow, OrgAdminRow, ProducerAssignmentRow, ResolveShowAssignmentsArgs, ShowDateWithShow } from "../_shared/rows.ts";

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

  const now = deps.now()

  // Resolved BEFORE the expiry RPC below, because the RPC's own gate is the one
  // guard in this module that lives purely in SQL. Edge functions auto-deploy on
  // merge while migrations are applied by hand, so in any environment where
  // 20260806151909 has not landed yet, expire_soft_bookings() is still the
  // fleet-wide SECURITY DEFINER sweep it used to be and would drain an unentitled
  // org's pending offers irreversibly. Skipping the call when nothing is entitled
  // makes the freeze hold regardless of migration state.
  let remindersSent = 0
  let reminderOrgs: Array<{ id: string }> = []
  try {
    // Module gate: only orgs entitled to booking_flow ever enter the reminder pass.
    // filterEntitledOrgs is a single batched org_entitlements read, not a per-org RPC.
    reminderOrgs = await filterEntitledOrgs(admin, await getActiveOrgs(admin), 'booking_flow')
  } catch (e) {
    console.error('expire-offers: failed to fetch active orgs for reminder pass', { error: (e as Error).message })
  }

  // 1. Expire stale offers
  if (reminderOrgs.length > 0) {
    const { error: rpcErr } = await admin.rpc('expire_soft_bookings')
    if (rpcErr) return json({ error: `expire_soft_bookings: ${rpcErr.message}` }, 500)
  }

  // 1.5. Reminder pass (Milestone C — Task 11): notify artists whose offer expires
  // within the next 24h and haven't already been reminded. Runs before the escalation
  // scan; org-gated on booking_flow.expiry_reminder (and artist_acceptance, since a
  // direct-booking org never creates suggested offers to remind about).

  // Active-AND-entitled org id set, shared by BOTH the reminder pass and the escalation
  // scan below. The escalation scan derives its org from show_dates.org_id, which can
  // include SUSPENDED or unentitled orgs; auto-escalation (which creates bookings +
  // emails artists, via the internal open-offer-tier invoke below) is gated on this set
  // so a suspended OR unentitled org's short tier never auto-escalates. This is one of
  // only two paths (the other is airtable-poll's tier-1 auto-open) where a service-role
  // caller can open a tier without ever going through open-offer-tier's own JWT-only
  // requireFeature gate — LOAD-BEARING for the booking_flow module gate.
  const activeOrgIds = new Set(reminderOrgs.map((o) => o.id))
  // resolveBookingFlow cache shared across both passes; the flow doesn't change mid-run
  // and the same org can appear in the reminder pass and the escalation scan, so this
  // dedups the per-org flow reads.
  const flowByOrg = new Map<string, BookingFlow>()

  for (const org of reminderOrgs) {
    let flow = flowByOrg.get(org.id)
    if (!flow) {
      try {
        flow = await resolveBookingFlow(admin, org.id)
      } catch (e) {
        console.error('expire-offers: booking flow read failed', { org: org.id, error: (e as Error).message })
        continue
      }
      flowByOrg.set(org.id, flow)
    }
    // flow.active gates the reminder pass too (consistent with the auto-escalation gate
    // below): when the booking flow is off, the whole engine is paused, so a pending offer
    // opened before the switch does not get an expiry reminder emailed.
    if (!flow.active || !flow.artist_acceptance || !flow.expiry_reminder) continue

    // Resolve the org's reference-field display once per org (mirrors send-offer-digest).
    let customFieldKey: string | null = null
    if (flow.reference_field.source === 'custom' && flow.reference_field.custom_field_id) {
      const { data: def } = await admin
        .from('custom_field_definitions').select('key')
        .eq('id', flow.reference_field.custom_field_id).maybeSingle()
      customFieldKey = (def as { key: string } | null)?.key ?? null
    }

    const cutoff = new Date(now.getTime() + 24 * 3600 * 1000)
    const { data: due, error: dueErr } = await admin
      .from('bookings')
      .select('id, artist_id, offer_expires_at, artists(id, name, email, user_id), show_dates(date, custom, show_id, city_id, shows(program, sub_program))')
      .eq('org_id', org.id)
      .eq('status', 'suggested')
      .is('reminder_sent_at', null)
      .not('offer_expires_at', 'is', null)
      .gt('offer_expires_at', now.toISOString())
      .lt('offer_expires_at', cutoff.toISOString())
    if (dueErr) { console.error('expire-offers: reminder query failed', { org: org.id, error: dueErr.message }); continue }
    if (!due || due.length === 0) continue
    const dueRows = (due ?? []) as unknown as DueBookingRow[]

    // ADR-0011: registered artists are addressed at their login (auth) email; the
    // booking email is the fallback (mirrors send-offer-digest's identity resolution).
    const userIds = [...new Set(
      dueRows.map((b) => b.artists?.user_id).filter((id): id is string => !!id),
    )]
    const byUser = new Map<string, { email: string | null; display_name: string | null }>()
    if (userIds.length > 0) {
      const { data: contacts, error: contactsErr } = await admin.rpc('resolve_user_contacts', { p_user_ids: userIds })
      if (contactsErr) {
        console.error('expire-offers: resolve_user_contacts failed', { org: org.id, error: contactsErr.message })
      } else {
        for (const c of (contacts ?? []) as Array<{ user_id: string; email: string | null; display_name: string | null }>) {
          byUser.set(c.user_id, { email: c.email, display_name: c.display_name })
        }
      }
    }

    type ReminderGroup = {
      recipientEmail: string
      displayName: string
      userId: string | null
      bookingIds: string[]
      offers: Array<{ referenceLabel: string; date: string; expiresAt: string }>
    }
    const grouped = new Map<string, ReminderGroup>()
    // Per-org locale (entitlement-gated) for the expiry timestamp embedded in the
    // now-German-capable offer-expiry-reminder, so it matches the email language.
    const locale = await resolveOrgLocale(admin, org.id)
    for (const b of dueRows) {
      const artist = b.artists
      const acct = artist?.user_id ? byUser.get(artist.user_id) : undefined
      const recipientEmail = resolveContactEmail({ authEmail: acct?.email, bookingEmail: artist?.email })
      if (!recipientEmail) continue
      const sd = b.show_dates
      const label = referenceLabel({
        reference: flow.reference_field,
        show: sd?.shows ?? null,
        custom: sd?.custom ?? null,
        customFieldKey,
      })
      const expiresAt = new Intl.DateTimeFormat(locale === 'de' ? 'de-DE' : 'en-GB', {
        timeZone: 'Europe/Berlin', day: '2-digit', month: '2-digit', year: 'numeric',
        hour: '2-digit', minute: '2-digit', hour12: false,
      }).format(new Date(b.offer_expires_at!)) // non-null: the query filters offer_expires_at IS NOT NULL
      if (!grouped.has(b.artist_id)) {
        grouped.set(b.artist_id, {
          recipientEmail,
          displayName: resolveAccountDisplayName({ displayName: acct?.display_name, artistName: artist?.name }),
          userId: artist?.user_id ?? null,
          bookingIds: [],
          offers: [],
        })
      }
      const entry = grouped.get(b.artist_id)!
      entry.bookingIds.push(b.id)
      entry.offers.push({ referenceLabel: label, date: sd?.date ?? 'TBD', expiresAt })
    }

    for (const [artistId, entry] of grouped) {
      try {
        const result = await deps.sendEmail({
          template_name: 'offer-expiry-reminder',
          recipient_email: entry.recipientEmail,
          org_id: org.id,
          locale,
          templateData: { displayName: entry.displayName, offers: entry.offers },
          idempotency_key: `offer-reminder-${org.id}-${artistId}-${now.toISOString().slice(0, 10)}`,
        })
        if (!emailWasSent(result)) {
          console.warn('expire-offers: reminder email not sent — leaving unstamped', {
            org: org.id, artistId, error: result.error ?? null,
            reason: (result.data as { reason?: unknown } | null)?.reason ?? null,
          })
          continue
        }
        const { error: stampErr } = await admin
          .from('bookings')
          .update({ reminder_sent_at: now.toISOString() })
          .in('id', entry.bookingIds)
        if (stampErr) { console.error('expire-offers: reminder stamp failed', { org: org.id, artistId, error: stampErr.message }); continue }
        remindersSent += 1
        if (entry.userId) {
          const count = entry.bookingIds.length
          const { error: notifErr } = await admin.from('notifications').insert([{
            org_id: org.id,
            user_id: entry.userId,
            type: 'offer_expiring',
            title: 'Offer expiring soon',
            message: `You have ${count === 1 ? 'an offer' : `${count} offers`} expiring in the next 24 hours.`,
            related_entity_type: 'booking',
            related_entity_id: entry.bookingIds[0],
          }])
          // Best-effort: the reminder email already sent and the booking is already
          // stamped above, so a failed in-app insert must not abort the pass. Log with
          // enough context (org/artist/bookings) to investigate, then continue.
          if (notifErr) {
            console.error('expire-offers: reminder notification insert failed', {
              org: org.id, artistId, userId: entry.userId, bookingIds: entry.bookingIds, error: notifErr.message,
            })
          }
        }
      } catch (e) {
        console.error('expire-offers: reminder email send failed', { org: org.id, artistId, error: (e as Error).message })
      }
    }
  }

  // 2. Find open tiers that have never been escalated
  const { data: openTiers } = await admin
    .from('show_date_offer_tiers')
    .select('id, show_date_id, tier, escalation_notified_at')
    .is('closed_at', null)
    .is('escalation_notified_at', null)

  if (!openTiers || openTiers.length === 0) return json({ expired: true, escalations: 0, reminders_sent: remindersSent })

  let escalated = 0
  let autoEscalated = 0
  // flowByOrg (declared above, shared with the reminder pass) caches resolveBookingFlow
  // per org: multiple open tiers in a single cron run can belong to the same org, and
  // the flow doesn't change mid-scan.

  for (const row of openTiers as Array<{ id: string; show_date_id: string; tier: number }>) {
    const { data: sd } = await admin
      .from('show_dates')
      .select('id, show_id, date, city_id, org_id, show:shows(program, sub_program, main_cast_slots, understudy_slots)')
      .eq('id', row.show_date_id)
      .maybeSingle()
    if (!sd) continue
    const sdRow = sd as unknown as ShowDateWithShow

    const program = sdRow.show?.program
    const subProgram = sdRow.show?.sub_program

    // Past dates can no longer fill — never escalate (would re-fire forever otherwise).
    if (!isFutureOrToday(sdRow.date, deps.now())) continue

    // requiredSlots = main_cast_slots (what a primary offer tier fills). NULL = unconfigured → skip.
    const requiredSlots = requiredPrimarySlots({
      main_cast_slots: sdRow.show?.main_cast_slots ?? null,
      understudy_slots: sdRow.show?.understudy_slots ?? null,
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

    const orgId = sdRow.org_id

    // Resolve the org's booking flow (auto-escalate + direct-mode gate), cached per org.
    // A per-org read failure must not abort the whole escalation scan; skip this row and
    // do NOT cache anything, so a later row for the same org can retry the resolve.
    let flow = flowByOrg.get(orgId)
    if (!flow) {
      try {
        flow = await resolveBookingFlow(admin, orgId)
      } catch (e) {
        console.error('expire-offers: booking flow read failed', { org: orgId, showDateId: row.show_date_id, error: (e as Error).message })
        continue
      }
      flowByOrg.set(orgId, flow)
    }
    if (!flow.artist_acceptance) continue // direct-mode orgs have no offer tiers to escalate

    // Resolve recipients — shared by the auto-escalation notification below and the
    // manual escalation notification/email further down.
    const { data: producers } = await admin.rpc('resolve_show_assignments', {
      p_program: program ?? '',
      p_sub_program: subProgram,
      p_city_id: sdRow.city_id,
      p_org: orgId,
      // The SQL function accepts NULL sub_program/city_id; type-gen doesn't model that.
    } as ResolveShowAssignmentsArgs)
    let recipientIds = ((producers ?? []) as unknown as ProducerAssignmentRow[]).map((p) => p.producer_user_id)
    if (recipientIds.length === 0) {
      // Fallback: notify admins OF THIS show_date's org (not every org's admins).
      const { data: admins } = await admin.from('org_memberships').select('user_id')
        .eq('org_id', orgId).eq('role', 'admin')
      recipientIds = ((admins ?? []) as unknown as OrgAdminRow[]).map((a) => a.user_id)
    }
    recipientIds = [...new Set(recipientIds)]

    // Auto-escalation: when the org opted in and this isn't the ad-hoc tier 99, look
    // for the next tier above this one on the date's EFFECTIVE ladder (show override if
    // present, else the org city list, via resolveTierLadder, same source open-offer-tier
    // used to open this tier). If one exists, close this tier and open the next
    // automatically instead of just asking a human to do it. No next tier (or
    // auto-escalate off) falls through to the manual escalation path below, unchanged.
    // Auto-escalation is gated on the org being ACTIVE (activeOrgIds — org suspension, not
    // the flow's own switch): a suspended org's short tier must NOT auto-open the next tier
    // (which would create suggested bookings + email artists). It is ALSO gated on
    // flow.active, the booking-flow master switch: an admin can turn automation off
    // without disabling the whole booking_flow module, so a flow marked inactive must not
    // auto-open the next tier either. Either gate failing falls through to the manual
    // escalation path below, unchanged: the same behavior it had before auto-escalation
    // existed (the manual path was never active-scoped, so this preserves it).
    if (flow.active && flow.auto_escalate && activeOrgIds.has(orgId) && row.tier !== 99) {
      let nextTier: number | undefined
      if (sdRow.city_id) {
        // Next tier comes from the SAME effective ladder that opened this tier
        // (show override if present, else the org city list). Spec: escalation
        // walks the effective ladder; automation never applies a skill filter.
        const ladder = await resolveTierLadder(admin, sdRow.show_id, sdRow.city_id)
        nextTier = nextTierAfter(ladder, row.tier) ?? undefined
      }

      if (nextTier !== undefined) {
        // Close + stamp escalation_notified_at BEFORE invoking open-offer-tier: this is
        // the idempotency mark for the scan (same property the manual path relies on),
        // so a failed invoke below does not leave the tier open to be re-escalated on
        // every subsequent hourly run.
        await admin
          .from('show_date_offer_tiers')
          .update({ closed_at: now.toISOString(), escalation_notified_at: now.toISOString() })
          .eq('id', row.id)

        const invokeResult = await deps.invokeFunction('open-offer-tier', { show_date_id: row.show_date_id, tier: nextTier })

        if (invokeResult.error) {
          // Mirrors the airtable-poll open-offer-tier error-logging precedent. Do NOT
          // insert the tier_escalated notification or count this as an auto-escalation —
          // that would falsely claim success while the date has no open tier. Fall
          // through (no `continue`) to the manual escalation path below so a human still
          // gets the "escalation needed" notification/email. escalation_notified_at was
          // already stamped above (the idempotency mark); the manual path's own stamp
          // update further down is a harmless no-op re-write of the same value.
          console.error('expire-offers: open-offer-tier invoke failed during auto-escalation', {
            show_date_id: row.show_date_id, attempted_tier: nextTier, error: invokeResult.error,
          })
        } else {
          const autoNotifRows = recipientIds.map((uid: string) => ({
            org_id: orgId,
            user_id: uid,
            type: 'tier_escalated',
            title: 'Tier escalated automatically',
            message: `Tier ${row.tier} closed short · tier ${nextTier} opened automatically.`,
            related_entity_type: 'show_date_offer_tier',
            related_entity_id: row.id,
          }))
          if (autoNotifRows.length > 0) {
            await admin.from('notifications').insert(autoNotifRows)
          }

          autoEscalated += 1
          continue // skip the manual escalation notification/email for this row
        }
      }
    }

    const message = `Tier ${row.tier} for ${program ?? 'show'} on ${sdRow.date} expired with ${accepted}/${requiredSlots} slots filled — open the next tier.`

    const notifRows = recipientIds.map((uid: string) => ({
      org_id: orgId,
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
          // Pass org_id so send-transactional-email can resolve the org's locale
          // (otherwise this producer-facing email can never render in German).
          org_id: orgId,
          templateData: { program, date: sdRow.date, tier: row.tier, accepted, required: requiredSlots } })
      } catch (e) {
        console.error('expire-offers: email send failed', { uid, error: (e as Error).message })
      }
    }

    // Mark idempotent
    await admin
      .from('show_date_offer_tiers')
      .update({ escalation_notified_at: deps.now().toISOString() })
      .eq('id', row.id)

    escalated += 1
  }

  return json({ expired: true, escalations: escalated, auto_escalated: autoEscalated, reminders_sent: remindersSent })
}

if (import.meta.main) Deno.serve((req) => handle(req, realDeps()));
