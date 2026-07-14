import { preflight, json } from "../_shared/http.ts";
import { isServiceRole, requireRole, requireOrgRole } from "../_shared/auth.ts";
import { resolveBookingFlow, referenceLabel } from "../_shared/bookingFlow.ts";
import { emailWasSent, realDeps, type Deps } from "../_shared/deps.ts";
import { resolveOrgSetting, BOOKING_ENGINE_DEFAULTS } from "../_shared/settings.ts";
import { resolveContactEmail, resolveAccountDisplayName } from "../_shared/identity.ts";

type ExcludedCounts = { already_booked: number; blocked: number; inactive: number };

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
  try {
    const body = await req.json()
    show_date_id = body.show_date_id
    tier = Number(body.tier)
    dryRun = body.dry_run === true
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
          excluded: counts ?? { already_booked: 0, blocked: 0, inactive: 0 },
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
  // accepts super-admins.
  if (!isServiceRole(deps, req)) {
    const auth = await requireOrgRole(deps, req, showDate.org_id, ["admin", "producer"])
    if (!auth.ok) return auth.response
  }

  // Direct-booking orgs (booking_flow.artist_acceptance = false) skip the offer
  // stage entirely — producers assign artists straight to confirmed. Refuse to
  // open offers so no suggested bookings are created. Placed AFTER org-scoped auth
  // (an unauthorized caller still gets 401/403, not a flow probe) and BEFORE any
  // pipeline work.
  const flow = await resolveBookingFlow(deps.admin, showDate.org_id)
  if (!flow.artist_acceptance) {
    return json({ error: 'Direct booking mode: offers are disabled for this organization.' }, 409)
  }

  if (showDate.status === 'cancelled') return json({ error: 'Show date is cancelled' }, 400)

  if (!showDate.session_1 && !showDate.session_2 && !showDate.session_3) {
    // ≥1-session rule: a times-TBD date is not yet bookable. Benign skip (200, not
    // 400) so airtable-poll's batch caller does not log a false "offer-tier failed".
    return benignExit('Show date has no sessions yet — offers not opened')
  }

  // Resolve eligible cast IDs for this tier
  let eligibleCastIds: string[]

  if (tier === 99) {
    // Tier 99: ad-hoc casts added via show_date_cast_eligibility
    // that have no cast_city_priority entry for this city
    const { data: dateCasts } = await admin
      .from('show_date_cast_eligibility')
      .select('cast_id')
      .eq('show_date_id', show_date_id)

    if (!dateCasts || dateCasts.length === 0) {
      return benignExit('No ad-hoc casts for this date')
    }

    // Filter out casts that are already in the priority system for this city
    if (showDate.city_id) {
      const castIds = dateCasts.map((r: any) => r.cast_id)
      const { data: priorityRows } = await (admin as any)
        .from('cast_city_priority')
        .select('cast_id')
        .eq('city_id', showDate.city_id)
        .in('cast_id', castIds)

      const prioritizedCastIds = new Set((priorityRows ?? []).map((r: any) => r.cast_id))
      eligibleCastIds = castIds.filter((id: string) => !prioritizedCastIds.has(id))
    } else {
      eligibleCastIds = dateCasts.map((r: any) => r.cast_id)
    }
  } else {
    // Tier 1-N: find casts with this priority for the date's city
    if (!showDate.city_id) {
      return benignExit('Show date has no city — cannot resolve priority casts')
    }

    const { data: priorityRows } = await (admin as any)
      .from('cast_city_priority')
      .select('cast_id')
      .eq('city_id', showDate.city_id)
      .eq('priority', tier)

    eligibleCastIds = (priorityRows ?? []).map((r: any) => r.cast_id)

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

  const artistIds = [...new Set((castMemberRows ?? []).map((r: any) => r.artist_id))]
  if (artistIds.length === 0) {
    return benignExit('No artists in eligible casts')
  }

  // Fetch artist active status
  const { data: artistRows } = await admin
    .from('artists')
    .select('id')
    .in('id', artistIds)
    .eq('status', 'active')

  const activeArtistIds = (artistRows ?? []).map((r: any) => r.id)
  // Members that dropped out of the active-status filter (inactive/archived).
  const inactiveCount = artistIds.length - activeArtistIds.length
  if (activeArtistIds.length === 0) {
    return benignExit('No active artists in eligible casts', { already_booked: 0, blocked: 0, inactive: inactiveCount })
  }

  // Skip artists with an existing open offer or non-cancelled booking for this date
  const { data: existingBookings } = await admin
    .from('bookings')
    .select('artist_id')
    .eq('show_date_id', show_date_id)
    .neq('status', 'cancelled')

  const alreadyBookedIds = new Set((existingBookings ?? []).map((b: any) => b.artist_id))
  // Active artists already holding a non-cancelled booking for this date.
  const alreadyBookedCount = activeArtistIds.filter((id: string) => alreadyBookedIds.has(id)).length

  // Skip artists with a blocked_dates entry for this date (table added in Task 5)
  let blockedArtistIds = new Set<string>()
  try {
    const { data: blockedRows } = await (admin as any)
      .from('blocked_dates')
      .select('artist_id')
      .eq('date', showDate.date)
      .in('artist_id', activeArtistIds)
    blockedArtistIds = new Set((blockedRows ?? []).map((r: any) => r.artist_id))
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
  const excluded: ExcludedCounts = {
    already_booked: alreadyBookedCount,
    blocked: blockedCount,
    inactive: inactiveCount,
  }

  if (candidateIds.length === 0) {
    return benignExit('All eligible artists already have offers or are blocked', excluded)
  }

  // Dry-run: report who WOULD be offered (and why others were excluded) without
  // writing any bookings or tier-tracking rows.
  if (dryRun) {
    let candidates: Array<{ id: string; name: string }> = []
    const { data: names, error: namesErr } = await admin
      .from('artists')
      .select('id, name')
      .in('id', candidateIds)
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
  const toInsert = candidateIds.map((artistId: string) => ({
    show_date_id,
    artist_id: artistId,
    status: 'suggested' as const,
    is_understudy: false,
    offered_at: offeredAt.toISOString(),
    offer_tier: tier,
  }))

  const { data: inserted, error: insErr } = await admin
    .from('bookings')
    .insert(toInsert)
    .select('id, artist_id')

  if (insErr) {
    console.error('open-offer-tier: insert error', insErr)
    return json({ error: insErr.message }, 500)
  }

  // show_date_offer_tiers has a UNIQUE (show_date_id, tier) constraint. A MERGE
  // upsert (no ignoreDuplicates) re-activates a tier that was previously closed:
  // clears closed_at, refreshes opened_at, and resets escalation so the new
  // round can escalate again. (close-offer-tier sets closed_at.)
  const { error: tierErr } = await (admin as any)
    .from('show_date_offer_tiers')
    .upsert(
      {
        show_date_id,
        tier,
        opened_at: offeredAt.toISOString(),
        closed_at: null,
        escalation_notified_at: null,
      },
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
        .from('artists').select('id, name, email, user_id').in('id', candidateIds)
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
          idempotency_key: `offer-immediate-${show_date_id}-${artist.id}`,
        })
        // Only stamp the bookings whose email actually delivered — a failed/skipped
        // send leaves the offer unstamped for the daily digest to retry (see emailWasSent).
        if (emailWasSent(result)) {
          const bid = bookingByArtist.get(artist.id)
          if (bid) sentBookingIds.push(bid)
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
