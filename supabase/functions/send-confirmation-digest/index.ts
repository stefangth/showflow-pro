import { preflight, json } from "../_shared/http.ts";
import { requireCronOrRole } from "../_shared/auth.ts";
import { realDeps, type Deps } from "../_shared/deps.ts";
import { getActiveOrgs, resolveOrgSetting } from "../_shared/settings.ts";
import { resolveContactEmail, resolveAccountDisplayName } from "../_shared/identity.ts";

/**
 * Daily confirmation digest (hourly cron). For each ACTIVE org whose own
 * confirmation_digest_hour_berlin matches the current Berlin hour: group that
 * org's confirmed bookings without a confirmation_digest_sent_at stamp by artist,
 * send one email per artist (org email overrides), then stamp.
 * Auth: X-Cron-Secret (pg_cron) or admin/producer JWT.
 */
export async function handle(req: Request, deps: Deps): Promise<Response> {
  if (req.method === 'OPTIONS') return preflight();
  const admin = deps.admin;

  const auth = await requireCronOrRole(deps, req, ["admin", "producer"]);
  if (!auth.ok) return auth.response;

  // Capture the clock once so the idempotency key and the digest stamp are
  // derived from a single instant (a run straddling a UTC hour boundary must
  // not produce inconsistent keys/stamps).
  const now = deps.now();

  // `% 24` normalizes the hour: some V8/Deno builds format midnight as '24'
  // (rather than '0'), which would make a configured targetHour of 0 (midnight
  // Berlin) never match and silently suppress the digest.
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
    // A per-org settings read failure must not abort the other orgs' digests.
    let targetHour: number;
    try {
      targetHour = await resolveOrgSetting<number>(admin, org.id, 'confirmation_digest_hour_berlin', 20);
    } catch (e) {
      console.error('send-confirmation-digest: settings read failed', { org: org.id, error: (e as Error).message });
      continue;
    }
    if (berlinHour !== targetHour) continue;
    processedOrgs.push(org.id);

    const { data: confirmedBookings, error: queryErr } = await admin
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
    if (!confirmedBookings || confirmedBookings.length === 0) continue;

    // ADR-0011: registered artists are addressed at their login (auth) email; the
    // booking email is the fallback (and the only address an unregistered artist has).
    const userIds = [...new Set(
      (confirmedBookings as any[]).map((b) => b.artists?.user_id).filter((id: unknown): id is string => !!id),
    )];
    const byUser = new Map<string, { email: string | null; display_name: string | null }>();
    if (userIds.length > 0) {
      const { data: contacts, error: contactsErr } = await admin.rpc('resolve_user_contacts', { p_user_ids: userIds });
      if (contactsErr) {
        // Non-fatal: fall back to booking emails for this org's artists.
        console.error('send-confirmation-digest: resolve_user_contacts failed', { org: org.id, error: contactsErr.message });
      } else {
        for (const c of (contacts ?? []) as Array<{ user_id: string; email: string | null; display_name: string | null }>) {
          byUser.set(c.user_id, { email: c.email, display_name: c.display_name });
        }
      }
    }

    type GroupedEntry = { recipientEmail: string; displayName: string; bookingIds: string[]; bookings: Array<{ show: string; date: string; city: string }> };
    const grouped = new Map<string, GroupedEntry>();
    for (const b of confirmedBookings as any[]) {
      const artist = b.artists;
      const acct = artist?.user_id ? byUser.get(artist.user_id) : undefined;
      const recipientEmail = resolveContactEmail({ authEmail: acct?.email, bookingEmail: artist?.email });
      if (!recipientEmail) continue;
      const sd = b.show_dates;
      const program = sd?.shows?.program;
      const subProgram = sd?.shows?.sub_program;
      const show = program ? (subProgram ? `${program} — ${subProgram}` : program) : 'Unknown show';
      if (!grouped.has(b.artist_id)) {
        grouped.set(b.artist_id, { recipientEmail, displayName: resolveAccountDisplayName({ displayName: acct?.display_name, artistName: artist?.name }), bookingIds: [], bookings: [] });
      }
      const entry = grouped.get(b.artist_id)!;
      entry.bookingIds.push(b.id);
      entry.bookings.push({ show, date: sd?.date ?? '—', city: sd?.cities?.name ?? '—' });
    }

    for (const [artistId, entry] of grouped) {
      try {
        await deps.sendEmail({
          template_name: 'artist-confirmation-digest',
          recipient_email: entry.recipientEmail,
          org_id: org.id,
          templateData: { displayName: entry.displayName, bookings: entry.bookings },
          idempotency_key: `confirmation-digest-${org.id}-${artistId}-${now.toISOString().slice(0, 13)}`,
        });
        const { error: stampErr } = await admin
          .from('bookings')
          .update({ confirmation_digest_sent_at: now.toISOString() })
          .in('id', entry.bookingIds);
        if (stampErr) { console.error('send-confirmation-digest: stamp failed', { org: org.id, artistId, error: stampErr.message }); }
        // NOTE: this preserves send-confirmation-digest's ORIGINAL single-tenant behavior —
        // the email was sent, so the count rises even if the stamp errored. This intentionally
        // differs from send-offer-digest, which `continue`s past the increment on a stamp error.
        // The two have always differed here; aligning them is a behavior change out of scope for
        // the multi-tenancy work (it would alter the digests_sent metric's meaning).
        digestsSent += 1;
      } catch (e) {
        console.error('send-confirmation-digest: email send failed', { org: org.id, artistId, error: (e as Error).message });
      }
    }
  }

  if (processedOrgs.length === 0) {
    return json({ skipped: true, reason: `No active org has confirmation digest hour ${berlinHour}` });
  }
  return json({ digests_sent: digestsSent });
}

if (import.meta.main) Deno.serve((req) => handle(req, realDeps()));
