/**
 * Identity / contact resolution — the single source of truth for ADR-0011.
 *
 * profiles  = global login-user identity (display_name; login email is auth.users.email)
 * artists   = per-org bookable talent (name = talent label, email = booking contact)
 *
 * A registered artist (artists.user_id set) has both; an unregistered artist
 * (user_id null) has only the artist row. These helpers encode which one wins.
 * Pure + dependency-free so they run unchanged in Deno (edge) and the browser (re-export).
 */

/**
 * The address to reach a person.
 * Registered → login (auth) email wins; the booking email is the fallback.
 * Unregistered → only the booking email exists.
 * Whitespace-only values are treated as absent.
 */
export function resolveContactEmail(opts: {
  authEmail?: string | null;
  bookingEmail?: string | null;
}): string | null {
  const auth = opts.authEmail?.trim();
  const booking = opts.bookingEmail?.trim();
  return auth || booking || null;
}

/**
 * The name to address a person by in account/identity contexts (e.g. a digest greeting).
 * The account display name wins; the talent label is the fallback.
 */
export function resolveAccountDisplayName(opts: {
  displayName?: string | null;
  artistName?: string | null;
}): string {
  return opts.displayName?.trim() || opts.artistName?.trim() || "";
}
