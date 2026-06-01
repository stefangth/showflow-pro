import { preflight, json } from "../_shared/http.ts";
import { requireCronOrRole } from "../_shared/auth.ts";
import { realDeps, type Deps } from "../_shared/deps.ts";

/**
 * Daily confirmation digest:
 *   Fires hourly (via pg_cron). Checks if Berlin local hour matches
 *   `confirmation_digest_hour_berlin` (default 20). If so, groups all
 *   confirmed bookings without a confirmation_digest_sent_at stamp by artist
 *   and sends one email per artist, then stamps confirmation_digest_sent_at = now()
 *   on the bookings included.
 *
 * Auth: X-Cron-Secret header (pg_cron), or user JWT (admin/producer manual trigger).
 */
export async function handle(req: Request, deps: Deps): Promise<Response> {
  if (req.method === 'OPTIONS') return preflight();

  const admin = deps.admin;

  // ── Auth: X-Cron-Secret or user JWT ──────────────────────────────────────
  const auth = await requireCronOrRole(deps, req, ["admin", "producer"]);
  if (!auth.ok) return auth.response;

  // Capture the clock once so the idempotency key and the digest stamp are
  // derived from a single instant (a run straddling a UTC hour boundary must
  // not produce inconsistent keys/stamps).
  const now = deps.now()

  // ── Berlin hour gate ─────────────────────────────────────────────────────
  const { data: hourSetting } = await admin
    .from('app_settings')
    .select('value')
    .eq('key', 'confirmation_digest_hour_berlin')
    .maybeSingle()
  const targetHour = typeof hourSetting?.value === 'number' ? hourSetting.value : 20

  const berlinHour = parseInt(
    new Intl.DateTimeFormat('en', {
      timeZone: 'Europe/Berlin',
      hour: 'numeric',
      hour12: false,
    }).format(now),
    10,
  )

  if (berlinHour !== targetHour) {
    return json({ skipped: true, reason: `Berlin hour is ${berlinHour}, target is ${targetHour}` })
  }

  const { data: confirmedBookings, error: queryErr } = await admin
    .from('bookings')
    .select(`
      id,
      artist_id,
      artists ( id, name, email ),
      show_dates (
        date,
        shows ( program, sub_program ),
        cities ( name )
      )
    `)
    .eq('status', 'confirmed')
    .is('confirmation_digest_sent_at', null)

  if (queryErr) {
    console.error('send-confirmation-digest: query error', queryErr)
    return json({ error: queryErr.message }, 500)
  }

  if (!confirmedBookings || confirmedBookings.length === 0) {
    return json({ digests_sent: 0 })
  }

  type GroupedEntry = {
    recipientEmail: string
    displayName: string
    bookingIds: string[]
    bookings: Array<{ show: string; date: string; city: string }>
  }

  const grouped = new Map<string, GroupedEntry>()

  for (const b of confirmedBookings as any[]) {
    const artistId = b.artist_id
    const artist = b.artists
    const recipientEmail = artist?.email
    if (!recipientEmail) continue

    const showDate = b.show_dates
    const program = showDate?.shows?.program
    const subProgram = showDate?.shows?.sub_program
    const show = program ? (subProgram ? `${program} — ${subProgram}` : program) : 'Unknown show'
    const date = showDate?.date ?? '—'
    const city = showDate?.cities?.name ?? '—'

    if (!grouped.has(artistId)) {
      grouped.set(artistId, {
        recipientEmail,
        displayName: artist?.name ?? '',
        bookingIds: [],
        bookings: [],
      })
    }
    const entry = grouped.get(artistId)!
    entry.bookingIds.push(b.id)
    entry.bookings.push({ show, date, city })
  }

  let digestsSent = 0

  for (const [artistId, entry] of grouped) {
    try {
      await deps.sendEmail({
        template_name: 'artist-confirmation-digest',
        recipient_email: entry.recipientEmail,
        templateData: {
          displayName: entry.displayName,
          bookings: entry.bookings,
        },
        idempotency_key: `confirmation-digest-${artistId}-${now.toISOString().slice(0, 13)}`,
      })

      const { error: stampErr } = await admin
        .from('bookings')
        .update({ confirmation_digest_sent_at: now.toISOString() })
        .in('id', entry.bookingIds)

      if (stampErr) {
        console.error('send-confirmation-digest: failed to stamp', { artistId, error: stampErr.message })
      }

      digestsSent += 1
    } catch (e) {
      console.error('send-confirmation-digest: email send failed', { artistId, error: (e as Error).message })
    }
  }

  return json({ digests_sent: digestsSent })
}

if (import.meta.main) Deno.serve((req) => handle(req, realDeps()));
