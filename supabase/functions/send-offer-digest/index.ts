import { preflight, json } from "../_shared/http.ts";
import { requireCronOrRole } from "../_shared/auth.ts";
import { emailWasSent, realDeps, type Deps } from "../_shared/deps.ts";
import { getActiveOrgs, resolveOrgSetting, BOOKING_ENGINE_DEFAULTS } from "../_shared/settings.ts";
import { resolveContactEmail, resolveAccountDisplayName } from "../_shared/identity.ts";
import { resolveBookingFlow, referenceLabel } from "../_shared/bookingFlow.ts";

/**
 * Daily offer digest (hourly cron). Digest-mode orgs are processed only when
 * their own offer_digest_hour_berlin matches the current Berlin hour;
 * immediate-delivery orgs are processed on every run with no hour gate, so a
 * suggested booking left unstamped by a switch from digest to immediate mode
 * still gets emailed and stamped promptly instead of waiting on the
 * configured hour. Direct-booking orgs (artist_acceptance false) never create
 * suggested offers, so they are skipped once the flow is resolved. For every
 * org that is processed: group that org's undigested suggested offers by
 * artist, send one email per artist (rendered with the org's email
 * overrides), then stamp digest_sent_at plus offer_expires_at.
 * Auth: X-Cron-Secret (pg_cron) or admin/producer JWT.
 */
export async function handle(req: Request, deps: Deps): Promise<Response> {
  if (req.method === 'OPTIONS') return preflight();
  const admin = deps.admin;

  const auth = await requireCronOrRole(deps, req, ["admin", "producer"]);
  if (!auth.ok) return auth.response;

  const now = deps.now();
  const berlinHour = parseInt(
    new Intl.DateTimeFormat('en', { timeZone: 'Europe/Berlin', hour: 'numeric', hour12: false }).format(now),
    10,
  ) % 24;

  let orgs: Array<{ id: string }>;
  try {
    orgs = await getActiveOrgs(admin);
  } catch (e) {
    console.error('send-offer-digest: failed to fetch active orgs', { error: (e as Error).message });
    return json({ error: 'failed to fetch active orgs' }, 500);
  }
  let digestsSent = 0;
  const processedOrgs: string[] = [];

  for (const org of orgs) {
    // Resolve the booking flow BEFORE the hour gate, because offer_delivery decides
    // whether the hour gate even applies: digest-mode orgs still wait for their own
    // offer_digest_hour_berlin, same as always, while immediate-delivery orgs are
    // not gated on the hour at all. Immediate-delivery orgs already email each
    // freshly-offered artist at open (see open-offer-tier); this cron's only job
    // for them is to flush any suggested booking left unstamped by a mid-flight
    // switch from digest to immediate mode, so it runs on every invocation and the
    // unstamped-bookings query below naturally becomes a no-op once that backlog
    // clears.
    // A per-org booking-flow read failure must not abort the other orgs' digests
    // (mirrors the settings-read guards below).
    let flow: Awaited<ReturnType<typeof resolveBookingFlow>>;
    try {
      flow = await resolveBookingFlow(admin, org.id);
    } catch (e) {
      console.error('send-offer-digest: booking flow read failed', { org: org.id, error: (e as Error).message });
      continue;
    }
    const isImmediate = flow.offer_delivery === 'immediate';

    // A per-org settings read failure must not abort the other orgs' digests.
    let offerWindowHours: number;
    if (!isImmediate) {
      let targetHour: number;
      try {
        targetHour = await resolveOrgSetting<number>(admin, org.id, 'offer_digest_hour_berlin', BOOKING_ENGINE_DEFAULTS.offer_digest_hour_berlin);
      } catch (e) {
        console.error('send-offer-digest: settings read failed', { org: org.id, error: (e as Error).message });
        continue;
      }
      if (berlinHour !== targetHour) continue;
    }
    processedOrgs.push(org.id);

    // Direct-booking orgs (artist_acceptance false) never create suggested offers
    // to begin with, so there is nothing for this cron to send.
    if (!flow.artist_acceptance) continue;

    // Resolve the org's reference-field display once per org (mirrors open-offer-tier).
    let customFieldKey: string | null = null;
    if (flow.reference_field.source === 'custom' && flow.reference_field.custom_field_id) {
      const { data: def } = await admin
        .from('custom_field_definitions').select('key')
        .eq('id', flow.reference_field.custom_field_id).maybeSingle();
      customFieldKey = (def as { key: string } | null)?.key ?? null;
    }

    try {
      offerWindowHours = await resolveOrgSetting<number>(admin, org.id, 'offer_response_window_hours', BOOKING_ENGINE_DEFAULTS.offer_response_window_hours);
    } catch (e) {
      console.error('send-offer-digest: settings read failed', { org: org.id, error: (e as Error).message });
      continue;
    }
    const offerExpiresAt = new Date(now.getTime() + offerWindowHours * 60 * 60 * 1000);
    const expiresDisplay = new Intl.DateTimeFormat('en-GB', {
      timeZone: 'Europe/Berlin', day: '2-digit', month: '2-digit', year: 'numeric',
      hour: '2-digit', minute: '2-digit', hour12: false,
    }).format(offerExpiresAt);

    const { data: pendingBookings, error: queryErr } = await admin
      .from('bookings')
      .select(`
        id,
        artist_id,
        artists ( id, name, email, user_id ),
        show_dates ( date, shows ( program, sub_program ), cities ( name ), custom )
      `)
      .eq('org_id', org.id)
      .eq('status', 'suggested')
      .is('digest_sent_at', null)
      .or(`offer_expires_at.is.null,offer_expires_at.gt.${now.toISOString()}`);

    if (queryErr) { console.error('send-offer-digest: query error', { org: org.id, error: queryErr.message }); continue; }
    if (!pendingBookings || pendingBookings.length === 0) continue;

    // ADR-0011: registered artists are addressed at their login (auth) email; the
    // booking email is the fallback (and the only address an unregistered artist has).
    const userIds = [...new Set(
      (pendingBookings as any[]).map((b) => b.artists?.user_id).filter((id: unknown): id is string => !!id),
    )];
    const byUser = new Map<string, { email: string | null; display_name: string | null }>();
    if (userIds.length > 0) {
      const { data: contacts, error: contactsErr } = await admin.rpc('resolve_user_contacts', { p_user_ids: userIds });
      if (contactsErr) {
        // Non-fatal: fall back to booking emails for this org's artists.
        console.error('send-offer-digest: resolve_user_contacts failed', { org: org.id, error: contactsErr.message });
      } else {
        for (const c of (contacts ?? []) as Array<{ user_id: string; email: string | null; display_name: string | null }>) {
          byUser.set(c.user_id, { email: c.email, display_name: c.display_name });
        }
      }
    }

    type GroupedEntry = { recipientEmail: string; displayName: string; bookingIds: string[]; offers: Array<{ show: string; date: string; city: string; expires: string; label: string }> };
    const grouped = new Map<string, GroupedEntry>();
    for (const b of pendingBookings as any[]) {
      const artist = b.artists;
      const acct = artist?.user_id ? byUser.get(artist.user_id) : undefined;
      const recipientEmail = resolveContactEmail({ authEmail: acct?.email, bookingEmail: artist?.email });
      if (!recipientEmail) continue;
      const sd = b.show_dates;
      const program = sd?.shows?.program;
      const subProgram = sd?.shows?.sub_program;
      const show = program ? (subProgram ? `${program} — ${subProgram}` : program) : 'Unknown show';
      const label = referenceLabel({
        reference: flow.reference_field,
        show: sd?.shows ?? null,
        custom: sd?.custom ?? null,
        customFieldKey,
      });
      if (!grouped.has(b.artist_id)) {
        grouped.set(b.artist_id, { recipientEmail, displayName: resolveAccountDisplayName({ displayName: acct?.display_name, artistName: artist?.name }), bookingIds: [], offers: [] });
      }
      const entry = grouped.get(b.artist_id)!;
      entry.bookingIds.push(b.id);
      entry.offers.push({ show, date: sd?.date ?? '—', city: sd?.cities?.name ?? '—', expires: expiresDisplay, label });
    }

    for (const [artistId, entry] of grouped) {
      try {
        const result = await deps.sendEmail({
          template_name: 'artist-offer-digest',
          recipient_email: entry.recipientEmail,
          org_id: org.id,
          templateData: { displayName: entry.displayName, offers: entry.offers },
          idempotency_key: `offer-digest-${org.id}-${artistId}-${now.toISOString().slice(0, 13)}`,
        });
        // Only stamp digest_sent_at + offer_expires_at when the email ACTUALLY sent.
        // A failed send (Resend outage) or a legitimately-skipped one (suppressed address /
        // preference-disabled) returns success:false — do NOT start the expiry clock, or the
        // offer would be silently cancelled by expire-offers for a mail the artist never got.
        // The offer stays pending (digest_sent_at null) and is retried on the next run; the
        // artist still sees it in the in-app offer list.
        if (!emailWasSent(result)) {
          console.warn('send-offer-digest: email not sent — leaving offer pending (no stamp)', {
            org: org.id, artistId, error: result.error ?? null,
            reason: (result.data as { reason?: unknown } | null)?.reason ?? null,
          });
          continue;
        }
        const { error: stampErr } = await admin
          .from('bookings')
          .update({ digest_sent_at: now.toISOString(), offer_expires_at: offerExpiresAt.toISOString() })
          .in('id', entry.bookingIds);
        if (stampErr) { console.error('send-offer-digest: stamp failed — will re-send next run', { org: org.id, artistId, error: stampErr.message }); continue; }
        digestsSent += 1;
      } catch (e) {
        console.error('send-offer-digest: email send failed', { org: org.id, artistId, error: (e as Error).message });
      }
    }
  }

  if (processedOrgs.length === 0) {
    return json({ skipped: true, reason: `No active org has digest hour ${berlinHour}` });
  }
  return json({ digests_sent: digestsSent });
}

if (import.meta.main) Deno.serve((req) => handle(req, realDeps()));
