import { preflight, json } from "../_shared/http.ts";
import { isServiceRole, requireRole, requireOrgRole } from "../_shared/auth.ts";
import { requireCapability } from "../_shared/capabilities.ts";
import { requireFeature } from "../_shared/entitlements.ts";
import type { TablesInsert } from "../_shared/database.types.ts";
import { resolveBookingFlow, referenceLabel } from "../_shared/bookingFlow.ts";
import { emailWasSent, realDeps, type Deps } from "../_shared/deps.ts";
import { resolveOrgSetting, BOOKING_ENGINE_DEFAULTS } from "../_shared/settings.ts";
import { resolveContactEmail, resolveAccountDisplayName } from "../_shared/identity.ts";
import {
  resolveTierLadder, ladderCastIdsAtTier, fetchGateArtistIds,
  fetchRequiredSkillIds, filterArtistIdsBySkills,
} from "../_shared/eligibility.ts";

type ExcludedCounts = {
  already_booked: number; blocked: number; inactive: number;
  not_eligible: number; missing_skills: number;
};

export async function handle(req: Request, deps: Deps): Promise<Response> {
  if (req.method === "OPTIONS") return preflight();

  const admin = deps.admin;

  // Coarse gate FIRST: fail unauthenticated / no-role callers before any
  // admin-client DB read, so a valid UUID can't be used as a cross-org
  // existence timing oracle. The org-scoped check happens after the fetch.
  if (!isServiceRole(deps, req)) {
    const preAuth = await requireRole(deps, req, ["admin", "producer"]);
    if (!preAuth.ok) return preAuth.response;
  }

  let show_date_id: string
  let tier: number
  let dryRun = false
  let skillFilterIds: string[] = []
  try {
    const body = await req.json()
    show_date_id = body.show_date_id
    tier = Number(body.tier)
    dryRun = body.dry_run === true
    if (Array.isArray(body.skill_filter_ids)) {
      skillFilterIds = body.skill_filter_ids.filter((v: unknown): v is string => typeof v === "string")
    }
    if (!show_date_id || !tier || tier < 1) {
      return json({ error: 'show_date_id and tier (≥1) are required' }, 400)
    }
  } catch {
    return json({ error: 'Invalid JSON' }, 400)
  }

  // A benign no-op exit. In dry-run mode the preview dialog needs a consistent
  // shape ({ dry_run, candidates, excluded }) so it can render the reason; the
  // normal caller (airtable-poll batch) just wants offers_created:0 + message.
  const benignExit = (message: string, counts?: ExcludedCounts): Response =>
    dryRun
      ? json({
          dry_run: true,
          candidates: [],
          excluded: counts ?? { already_booked: 0, blocked: 0, inactive: 0, not_eligible: 0, missing_skills: 0 },
          message,
        })
      : json({ offers_created: 0, message })

  // Fetch show date (org_id drives the org-scoped auth check below).
  const { data: showDate, error: sdErr } = await admin
    .from('show_dates')
    .select('id, show_id, city_id, date, status, session_1, session_2, session_3, org_id, custom')
    .eq('id', show_date_id)
    .maybeSingle()

  if (sdErr || !showDate) return json({ error: 'Show date not found' }, 404)

  // Org-scoped authorization: an admin/producer may only open offers for a date in
  // their OWN org. Service-role (cron / airtable-poll) bypasses; requireOrgRole also
  // accepts super-admins. Admins bypass the capability gate outright; a producer
  // additionally needs producer_can_run_offer_engine on for this org.
  if (!isServiceRole(deps, req)) {
    const adminAuth = await requireOrgRole(deps, req, showDate.org_id, ["admin"])
    if (!adminAuth.ok) {
      const producerAuth = await requireOrgRole(deps, req, showDate.org_id, ["producer"])
      if (!producerAuth.ok) return producerAuth.response
      const capGate = await requireCapability(deps, showDate.org_id, "producer_can_run_offer_engine")
      if (capGate) return capGate
    }

    // Module gate: booking_flow must be entitled for this org. Placed after the
    // org-scoped auth/capability check succeeds (so the org id is known and the
    // caller is already authorized) and before any booking work below.
    const denied = await requireFeature(deps, showDate.org_id, "booking_flow")
    if (denied) return denied
  }

  // Direct-booking orgs (booking_flow.artist_acceptance = false) skip the offer
  // stage entirely — producers assign artists straight to confirmed. Refuse to
  // open offers so no suggested bookings are created. Placed AFTER org-scoped auth
  // (an unauthorized caller still gets 401/403, not a flow probe) and BEFORE any
  // pipeline work.
  const flow = await resolveBookingFlow(deps.admin, showDate.org_id)
  // Booking flow off: the whole engine is paused, so even a manual "open next tier" is
  // refused until an admin turns the flow back on (the cron auto-open/escalation callers
  // already gate on flow.active before reaching here, so this only blocks manual callers).
  if (!flow.active) {
    return json({ error: 'Booking flow is off for this organization.' }, 409)
  }
  if (!flow.artist_acceptance) {
    return json({ error: 'Direct booking mode: offers are disabled for this organization.' }, 409)
  }

  if (showDate.status === 'cancelled') return json({ error: 'Show date is cancelled' }, 400)

  if (!showDate.session_1 && !showDate.session_2 && !showDate.session_3) {
    // ≥1-session rule: a times-TBD date is not yet bookable. Benign skip (200, not
    // 400) so airtable-poll's batch caller does not log a false "offer-tier failed".
    return benignExit('Show date has no sessions yet — offers not opened')
  }

  // Resolve the effective ladder once: show-scoped priorities win outright for
  // this (show, city); otherwise the org-wide city list (spec: effective ladder).
  let eligibleCastIds: string[]

  if (tier === 99) {
    // Tier 99: ad-hoc casts added via show_date_cast_eligibility that are not
    // already part of the EFFECTIVE ladder for this (show, city).
    const { data: dateCasts } = await admin
      .from('show_date_cast_eligibility')
      .select('cast_id')
      .eq('show_date_id', show_date_id)

    if (!dateCasts || dateCasts.length === 0) {
      return benignExit('No ad-hoc casts for this date')
    }

    const castIds = ((dateCasts ?? []) as unknown as { cast_id: string }[]).map((r) => r.cast_id)
    if (showDate.city_id) {
      const ladder = await resolveTierLadder(admin, showDate.show_id, showDate.city_id)
      const ladderCastIds = new Set(ladder.tiers.map((t) => t.castId))
      eligibleCastIds = castIds.filter((id: string) => !ladderCastIds.has(id))
    } else {
      eligibleCastIds = castIds
    }
  } else {
    if (!showDate.city_id) {
      return benignExit('Show date has no city, cannot resolve priority casts')
    }
    const ladder = await resolveTierLadder(admin, showDate.show_id, showDate.city_id)
    eligibleCastIds = ladderCastIdsAtTier(ladder, tier)
    if (eligibleCastIds.length === 0) {
      return benignExit(`No casts configured at tier ${tier} for this city`)
    }
  }

  if (eligibleCastIds.length === 0) {
    return benignExit('No eligible casts for this tier')
  }

  // Get all active artists in eligible casts
  const { data: castMemberRows } = await admin
    .from('cast_members')
    .select('artist_id')
    .in('cast_id', eligibleCastIds)

  const artistIds = [...new Set(((castMemberRows ?? []) as unknown as { artist_id: string }[]).map((r) => r.artist_id))]
  if (artistIds.length === 0) {
    return benignExit('No artists in eligible casts')
  }

  // Fetch artist active status
  const { data: artistRows } = await admin
    .from('artists')
    .select('id')
    .in('id', artistIds)
    .eq('status', 'active')

  const activeArtistIds = ((artistRows ?? []) as unknown as { id: string }[]).map((r) => r.id)
  // Members that dropped out of the active-status filter (inactive/archived).
  const inactiveCount = artistIds.length - activeArtistIds.length
  if (activeArtistIds.length === 0) {
    return benignExit('No active artists in eligible casts', {
      already_booked: 0, blocked: 0, inactive: inactiveCount, not_eligible: 0, missing_skills: 0,
    })
  }

  // Skip artists with an existing open offer or non-cancelled booking for this date
  const { data: existingBookings } = await admin
    .from('bookings')
    .select('artist_id')
    .eq('show_date_id', show_date_id)
    .neq('status', 'cancelled')

  const alreadyBookedIds = new Set(((existingBookings ?? []) as unknown as { artist_id: string }[]).map((b) => b.artist_id))
  // Active artists already holding a non-cancelled booking for this date.
  const alreadyBookedCount = activeArtistIds.filter((id: string) => alreadyBookedIds.has(id)).length

  // Skip artists with a blocked_dates entry for this date (table added in Task 5)
  let blockedArtistIds = new Set<string>()
  try {
    const { data: blockedRows } = await admin
      .from('blocked_dates')
      .select('artist_id')
      .eq('date', showDate.date)
      .in('artist_id', activeArtistIds)
    blockedArtistIds = new Set(((blockedRows ?? []) as unknown as { artist_id: string }[]).map((r) => r.artist_id))
  } catch {
    // blocked_dates table may not exist yet — skip silently
  }

  const candidateIds = activeArtistIds.filter(
    (id: string) => !alreadyBookedIds.has(id) && !blockedArtistIds.has(id)
  )

  // Active, not-already-booked artists removed solely by the blocked-dates filter.
  const blockedCount = activeArtistIds.filter(
    (id: string) => !alreadyBookedIds.has(id) && blockedArtistIds.has(id)
  ).length

  // Gate (spec: candidates must pass the show eligibility gate when one exists;
  // union of show-level and date-level rows, none at all = unrestricted).
  const gate = await fetchGateArtistIds(admin, {
    showId: showDate.show_id, cityId: showDate.city_id, showDateId: show_date_id,
  })
  const afterBlocked = candidateIds
  const afterGate = gate == null ? afterBlocked : afterBlocked.filter((id: string) => gate.has(id))
  const notEligibleCount = afterBlocked.length - afterGate.length

  // Skills: stored requirements (show ∪ date) unioned with the per-open filter.
  const storedSkillIds = await fetchRequiredSkillIds(admin, {
    showId: showDate.show_id, showDateId: show_date_id,
  })
  const requiredSkillIds = [...new Set([...storedSkillIds, ...skillFilterIds])]
  const afterSkills = await filterArtistIdsBySkills(admin, afterGate, requiredSkillIds)
  const missingSkillsCount = afterGate.length - afterSkills.length

  const finalCandidateIds = afterSkills
  const excluded: ExcludedCounts = {
    already_booked: alreadyBookedCount,
    blocked: blockedCount,
    inactive: inactiveCount,
    not_eligible: notEligibleCount,
    missing_skills: missingSkillsCount,
  }

  if (finalCandidateIds.length === 0) {
    return benignExit('All eligible artists already have offers, are blocked, or do not qualify', excluded)
  }

  // Dry-run: report who WOULD be offered (and why others were excluded) without
  // writing any bookings or tier-tracking rows.
  if (dryRun) {
    let candidates: Array<{ id: string; name: string }> = []
    const { data: names, error: namesErr } = await admin
      .from('artists')
      .select('id, name')
      .in('id', finalCandidateIds)
    if (namesErr) return json({ error: namesErr.message }, 500)
    candidates = (names ?? []) as Array<{ id: string; name: string }>
    return json({ dry_run: true, candidates, excluded })
  }

  const offeredAt = deps.now()

  // Batch insert suggested bookings. Pre-filtering (alreadyBookedIds /
  // blockedArtistIds) handles deduplication — bookings has no UNIQUE
  // (show_date_id, artist_id) constraint, so an ON CONFLICT upsert here
  // would fail Postgres parse-time validation.
  //
  // offer_expires_at is intentionally omitted here: the expiry window
  // starts from when the artist is notified via the offer digest email,
  // not from offer creation. send-offer-digest sets offer_expires_at when
  // it stamps digest_sent_at.
  // org_id is intentionally omitted: the derive_org_id_for_booking BEFORE INSERT
  // trigger derives it from show_date_id — the generated Insert type can't know
  // that, hence the Omit + single cast at the insert below.
  const toInsert = finalCandidateIds.map((artistId: string): Omit<TablesInsert<'bookings'>, 'org_id'> => ({
    show_date_id,
    artist_id: artistId,
    status: 'suggested' as const,
    is_understudy: false,
    offered_at: offeredAt.toISOString(),
    offer_tier: tier,
  }))

  const { data: inserted, error: insErr } = await admin
    .from('bookings')
    .insert(toInsert as TablesInsert<'bookings'>[])
    .select('id, artist_id')

  if (insErr) {
    console.error('open-offer-tier: insert error', insErr)
    return json({ error: insErr.message }, 500)
  }

  // show_date_offer_tiers has a UNIQUE (show_date_id, tier) constraint. A MERGE
  // upsert (no ignoreDuplicates) re-activates a tier that was previously closed:
  // clears closed_at, refreshes opened_at, and resets escalation so the new
  // round can escalate again. (close-offer-tier sets closed_at.)
  const { error: tierErr } = await admin
    .from('show_date_offer_tiers')
    .upsert(
      // org_id omitted: derived by trg_derive_org_id from show_date_id on insert.
      {
        show_date_id,
        tier,
        opened_at: offeredAt.toISOString(),
        closed_at: null,
        escalation_notified_at: null,
      } as TablesInsert<'show_date_offer_tiers'>,
      { onConflict: 'show_date_id,tier' }
    )
  // The tier row is now load-bearing for re-open (it clears closed_at) and is
  // what expire-offers / tier-at-risk-watcher filter on. The bookings were
  // already inserted, so don't fail the request — but if tracking failed, log it
  // AND signal the caller so the producer knows escalation/at-risk may be broken
  // for this round (re-opening the tier recovers it).
  if (tierErr) console.error('open-offer-tier: tier upsert error', tierErr)

  // Immediate delivery: when the org's booking_flow.offer_delivery is "immediate",
  // email each freshly-offered artist right now (instead of waiting for the daily
  // send-offer-digest cron) and start their expiry clock. Only the bookings whose
  // email ACTUALLY sent get stamped with digest_sent_at + offer_expires_at — an
  // unsent one (Resend outage / suppressed / preference-disabled) stays unstamped
  // so the daily digest pass retries it, mirroring send-offer-digest's semantics.
  // The dry-run path returned long before the insert, so this never runs for it.
  if (flow.offer_delivery === 'immediate' && (inserted?.length ?? 0) > 0) {
    try {
      const windowHours = await resolveOrgSetting<number>(
        admin, showDate.org_id, 'offer_response_window_hours',
        BOOKING_ENGINE_DEFAULTS.offer_response_window_hours,
      )
      const expiresAt = new Date(offeredAt.getTime() + windowHours * 60 * 60 * 1000)

      // Resolve the offer's display label (mirrors send-offer-digest / the flow ref field).
      const { data: showRow } = await admin
        .from('shows').select('program, sub_program').eq('id', showDate.show_id).maybeSingle()
      let cityName: string | null = null
      if (showDate.city_id) {
        const { data: cityRow } = await admin
          .from('cities').select('name').eq('id', showDate.city_id).maybeSingle()
        cityName = (cityRow as { name: string } | null)?.name ?? null
      }
      let customFieldKey: string | null = null
      if (flow.reference_field.source === 'custom' && flow.reference_field.custom_field_id) {
        const { data: def } = await admin
          .from('custom_field_definitions').select('key')
          .eq('id', flow.reference_field.custom_field_id).maybeSingle()
        customFieldKey = (def as { key: string } | null)?.key ?? null
      }
      const label = referenceLabel({
        reference: flow.reference_field,
        show: (showRow ?? null) as { program: string | null; sub_program: string | null } | null,
        custom: (showDate.custom ?? null) as Record<string, unknown> | null,
        customFieldKey,
      })

      // Fetch the offered artists' contact rows and resolve login-vs-booking identity
      // exactly like send-offer-digest (ADR-0011): registered artists are addressed at
      // their auth email + account display name; unregistered fall back to booking email.
      const { data: artistRows } = await admin
        .from('artists').select('id, name, email, user_id').in('id', finalCandidateIds)
      const artists = (artistRows ?? []) as Array<{ id: string; name: string | null; email: string | null; user_id: string | null }>

      const userIds = [...new Set(
        artists.map((a) => a.user_id).filter((id): id is string => !!id),
      )]
      const byUser = new Map<string, { email: string | null; display_name: string | null }>()
      if (userIds.length > 0) {
        const { data: contacts, error: contactsErr } = await admin.rpc('resolve_user_contacts', { p_user_ids: userIds })
        if (contactsErr) {
          // Non-fatal: fall back to booking emails for this org's artists.
          console.error('open-offer-tier: resolve_user_contacts failed', { org: showDate.org_id, error: contactsErr.message })
        } else {
          for (const c of (contacts ?? []) as Array<{ user_id: string; email: string | null; display_name: string | null }>) {
            byUser.set(c.user_id, { email: c.email, display_name: c.display_name })
          }
        }
      }

      const bookingByArtist = new Map(
        (inserted as Array<{ id: string; artist_id: string }>).map((r) => [r.artist_id, r.id]),
      )
      const sentBookingIds: string[] = []
      for (const artist of artists) {
        const acct = artist.user_id ? byUser.get(artist.user_id) : undefined
        const recipient = resolveContactEmail({ authEmail: acct?.email, bookingEmail: artist.email })
        if (!recipient) continue
        // Each re-offer inserts a NEW booking row (bookingByArtist), so keying on
        // the booking id rather than show_date_id+artist_id keeps a reopened tier's
        // resend from deduping against a stale send for a prior offer round.
        const bid = bookingByArtist.get(artist.id)
        if (!bid) continue
        const result = await deps.sendEmail({
          template_name: 'offer-immediate',
          recipient_email: recipient,
          org_id: showDate.org_id,
          templateData: {
            displayName: resolveAccountDisplayName({ displayName: acct?.display_name, artistName: artist.name }),
            referenceLabel: label,
            date: showDate.date,
            city: cityName,
            windowHours,
          },
          idempotency_key: `offer-immediate-${bid}`,
        })
        // Only stamp the bookings whose email actually delivered — a failed/skipped
        // send leaves the offer unstamped for the daily digest to retry (see emailWasSent).
        if (emailWasSent(result)) {
          sentBookingIds.push(bid)
        } else {
          console.warn('open-offer-tier: immediate email not sent — leaving offer pending (no stamp)', {
            org: showDate.org_id, artistId: artist.id, error: result.error ?? null,
          })
        }
      }
      if (sentBookingIds.length > 0) {
        const { error: stampErr } = await admin
          .from('bookings')
          .update({ digest_sent_at: offeredAt.toISOString(), offer_expires_at: expiresAt.toISOString() })
          .in('id', sentBookingIds)
        if (stampErr) console.error('open-offer-tier: immediate stamp failed — will re-send via digest', { org: showDate.org_id, error: stampErr.message })
      }
    } catch (e) {
      // Immediate delivery is best-effort: the bookings + tier row are already committed,
      // so a failure here must not fail the open. Unstamped offers fall back to the digest.
      console.error('open-offer-tier: immediate delivery failed', { show_date_id, error: (e as Error).message })
    }
  }

  const offersCreated = inserted?.length ?? 0
  console.log('open-offer-tier complete', { show_date_id, tier, offersCreated, tierTracked: !tierErr })

  return json({ offers_created: offersCreated, ...(tierErr ? { tier_tracking_warning: true } : {}) })
}

if (import.meta.main) Deno.serve((req) => handle(req, realDeps()));
