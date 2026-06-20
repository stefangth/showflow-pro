import { preflight, json } from "../_shared/http.ts";
import { requireCronOrRole } from "../_shared/auth.ts";
import { realDeps, type Deps } from "../_shared/deps.ts";
import { getActiveOrgs, resolveOrgSetting } from "../_shared/settings.ts";
import { resolveContactEmail, resolveAccountDisplayName } from "../_shared/identity.ts";
import { coalesceChangeRows, describeDateChanges, type ChangeLogRow } from "../_shared/scheduleChanges.ts";

const ACTIVE_BOOKING_STATUSES = ["suggested", "soft_booked", "confirmed"];

/**
 * Daily confirmation digest (hourly cron). For each ACTIVE org whose
 * confirmation_digest_hour_berlin matches the current Berlin hour, send one email
 * per artist that folds BOTH newly-confirmed bookings AND undigested schedule
 * changes (cancellation / per-session add/remove/retime) on dates the artist is
 * booked on, creating in-app schedule_change notifications for registered artists.
 * In-app delivery happens before the (best-effort) email; change-log rows are
 * stamped digested afterwards so they are not re-processed.
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
    console.error('send-confirmation-digest: failed to fetch active orgs', { error: (e as Error).message });
    return json({ error: 'failed to fetch active orgs' }, 500);
  }
  let digestsSent = 0;
  const processedOrgs: string[] = [];

  for (const org of orgs) {
    let targetHour: number;
    try {
      targetHour = await resolveOrgSetting<number>(admin, org.id, 'confirmation_digest_hour_berlin', 20);
    } catch (e) {
      console.error('send-confirmation-digest: settings read failed', { org: org.id, error: (e as Error).message });
      continue;
    }
    if (berlinHour !== targetHour) continue;
    processedOrgs.push(org.id);

    // ── Source 1: newly-confirmed bookings ──
    const { data: confirmedRaw, error: queryErr } = await admin
      .from('bookings')
      .select(`
        id,
        artist_id,
        artists ( id, name, email, user_id ),
        show_dates ( date, shows ( program, sub_program ), cities ( name ) )
      `)
      .eq('org_id', org.id)
      .eq('status', 'confirmed')
      .is('confirmation_digest_sent_at', null);
    if (queryErr) { console.error('send-confirmation-digest: query error', { org: org.id, error: queryErr.message }); continue; }

    // ── Source 2: undigested schedule changes ──
    const { data: changeRaw, error: changeErr } = await admin
      .from('show_date_change_log')
      .select(`
        id, show_date_id, change_type, session_slot, old_value, new_value, created_at,
        show_dates ( date, status, cancellation_reason, shows ( program, sub_program ), cities ( name ) )
      `)
      .eq('org_id', org.id)
      .is('digested_at', null);
    if (changeErr) { console.error('send-confirmation-digest: change-log query error', { org: org.id, error: changeErr.message }); continue; }

    const confirmed = (confirmedRaw ?? []) as any[];
    const changeRows = (changeRaw ?? []) as any[];
    if (confirmed.length === 0 && changeRows.length === 0) continue;

    // Show context per show_date (every row for a date joins to its current row).
    const dateContext = new Map<string, { show: string; date: string; city: string; reason: string | null }>();
    for (const r of changeRows) {
      const sd = r.show_dates;
      const program = sd?.shows?.program;
      const subProgram = sd?.shows?.sub_program;
      const show = program ? (subProgram ? `${program} — ${subProgram}` : program) : 'Unknown show';
      dateContext.set(r.show_date_id, { show, date: sd?.date ?? '—', city: sd?.cities?.name ?? '—', reason: sd?.cancellation_reason ?? null });
    }

    const coalesced = coalesceChangeRows(changeRows.map((r): ChangeLogRow => ({
      id: r.id, show_date_id: r.show_date_id, change_type: r.change_type,
      session_slot: r.session_slot, old_value: r.old_value, new_value: r.new_value, created_at: r.created_at,
    })));

    // Recipients per affected date (one bookings query, partitioned in JS).
    const affectedDateIds = coalesced.map((c) => c.showDateId);
    let changeBookings: any[] = [];
    if (affectedDateIds.length > 0) {
      const { data } = await admin
        .from('bookings')
        .select('id, artist_id, show_date_id, status, cancellation_reason, artists ( id, name, email, user_id )')
        .eq('org_id', org.id)
        .in('show_date_id', affectedDateIds);
      changeBookings = (data ?? []) as any[];
    }
    const bookingsByDate = new Map<string, any[]>();
    for (const b of changeBookings) {
      const list = bookingsByDate.get(b.show_date_id);
      if (list) list.push(b); else bookingsByDate.set(b.show_date_id, [b]);
    }

    // ── ADR-0011: resolve login-first contacts for every artist across BOTH sources ──
    const userIds = [...new Set([
      ...confirmed.map((b) => b.artists?.user_id),
      ...changeBookings.map((b) => b.artists?.user_id),
    ].filter((id: unknown): id is string => !!id))];
    const byUser = new Map<string, { email: string | null; display_name: string | null }>();
    if (userIds.length > 0) {
      const { data: contacts, error: contactsErr } = await admin.rpc('resolve_user_contacts', { p_user_ids: userIds });
      if (contactsErr) console.error('send-confirmation-digest: resolve_user_contacts failed', { org: org.id, error: contactsErr.message });
      else for (const c of (contacts ?? []) as Array<{ user_id: string; email: string | null; display_name: string | null }>) byUser.set(c.user_id, { email: c.email, display_name: c.display_name });
    }

    type GroupedEntry = {
      recipientEmail: string; displayName: string;
      bookingIds: string[];
      bookings: Array<{ show: string; date: string; city: string }>;
      scheduleChanges: Array<{ show: string; date: string; city: string; changes: string }>;
      cancellations: Array<{ show: string; date: string; city: string; reason: string | null }>;
    };
    const grouped = new Map<string, GroupedEntry>();
    const ensureEntry = (artistId: string, artist: any): GroupedEntry | null => {
      const acct = artist?.user_id ? byUser.get(artist.user_id) : undefined;
      const recipientEmail = resolveContactEmail({ authEmail: acct?.email, bookingEmail: artist?.email });
      if (!recipientEmail) return null;
      let entry = grouped.get(artistId);
      if (!entry) {
        entry = {
          recipientEmail,
          displayName: resolveAccountDisplayName({ displayName: acct?.display_name, artistName: artist?.name }),
          bookingIds: [], bookings: [], scheduleChanges: [], cancellations: [],
        };
        grouped.set(artistId, entry);
      }
      return entry;
    };

    // Confirmations
    for (const b of confirmed) {
      const entry = ensureEntry(b.artist_id, b.artists);
      if (!entry) continue;
      const sd = b.show_dates;
      const program = sd?.shows?.program;
      const subProgram = sd?.shows?.sub_program;
      const show = program ? (subProgram ? `${program} — ${subProgram}` : program) : 'Unknown show';
      entry.bookingIds.push(b.id);
      entry.bookings.push({ show, date: sd?.date ?? '—', city: sd?.cities?.name ?? '—' });
    }

    // Schedule changes + in-app notifications
    const notificationRows: any[] = [];
    for (const c of coalesced) {
      const ctx = dateContext.get(c.showDateId) ?? { show: 'Unknown show', date: '—', city: '—', reason: null };
      const dateBookings = bookingsByDate.get(c.showDateId) ?? [];
      const recipients = c.cancelled
        ? dateBookings.filter((b) => b.status === 'cancelled' && b.cancellation_reason === 'date_cancelled')
        : dateBookings.filter((b) => ACTIVE_BOOKING_STATUSES.includes(b.status));
      for (const b of recipients) {
        const entry = ensureEntry(b.artist_id, b.artists);
        if (entry) {
          if (c.cancelled) entry.cancellations.push({ show: ctx.show, date: ctx.date, city: ctx.city, reason: ctx.reason });
          else entry.scheduleChanges.push({ show: ctx.show, date: ctx.date, city: ctx.city, changes: describeDateChanges(c) });
        }
        // In-app for registered artists only (the reliable channel — created before email).
        if (b.artists?.user_id) {
          notificationRows.push({
            org_id: org.id,
            user_id: b.artists.user_id,
            type: 'schedule_change',
            title: c.cancelled ? 'Booking cancelled' : 'Schedule change',
            message: c.cancelled
              ? `Your booking for ${ctx.show} on ${ctx.date} was cancelled.`
              : `${ctx.show} on ${ctx.date}: ${describeDateChanges(c)}`,
            related_entity_type: 'show_date',
            related_entity_id: c.showDateId,
          });
        }
      }
    }
    if (notificationRows.length > 0) {
      const { error: notifErr } = await admin.from('notifications').insert(notificationRows);
      if (notifErr) console.error('send-confirmation-digest: notification insert failed', { org: org.id, error: notifErr.message });
    }

    // One email per artist (confirmations + schedule changes folded). Best-effort.
    for (const [artistId, entry] of grouped) {
      try {
        await deps.sendEmail({
          template_name: 'artist-confirmation-digest',
          recipient_email: entry.recipientEmail,
          org_id: org.id,
          templateData: {
            displayName: entry.displayName,
            bookings: entry.bookings,
            scheduleChanges: entry.scheduleChanges,
            cancellations: entry.cancellations,
          },
          idempotency_key: `confirmation-digest-${org.id}-${artistId}-${now.toISOString().slice(0, 13)}`,
        });
        if (entry.bookingIds.length > 0) {
          const { error: stampErr } = await admin
            .from('bookings')
            .update({ confirmation_digest_sent_at: now.toISOString() })
            .in('id', entry.bookingIds);
          if (stampErr) console.error('send-confirmation-digest: stamp failed', { org: org.id, artistId, error: stampErr.message });
        }
        digestsSent += 1;
      } catch (e) {
        console.error('send-confirmation-digest: email send failed', { org: org.id, artistId, error: (e as Error).message });
      }
    }

    // Stamp every consumed change-log row (incl. net-no-op ones) so they don't linger.
    const consumedChangeIds = changeRows.map((r) => r.id);
    if (consumedChangeIds.length > 0) {
      const { error: digestStampErr } = await admin
        .from('show_date_change_log')
        .update({ digested_at: now.toISOString() })
        .in('id', consumedChangeIds);
      if (digestStampErr) console.error('send-confirmation-digest: change-log stamp failed', { org: org.id, error: digestStampErr.message });
    }
  }

  if (processedOrgs.length === 0) {
    return json({ skipped: true, reason: `No active org has confirmation digest hour ${berlinHour}` });
  }
  return json({ digests_sent: digestsSent });
}

if (import.meta.main) Deno.serve((req) => handle(req, realDeps()));
