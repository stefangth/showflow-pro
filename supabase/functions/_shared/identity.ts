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

/**
 * Redact an email for logging so we never write full recipient PII to logs.
 * Keeps the first character of the local part and the full domain
 * (e.g. `alice@example.com` -> `a***@example.com`), matching the inline
 * redaction handle-email-suppression already uses. Non-email / malformed
 * input degrades to a fully-masked placeholder rather than leaking the raw value.
 */
export function redactEmail(email: string | null | undefined): string {
  if (!email) return "(none)";
  const at = email.indexOf("@");
  if (at <= 0) return "***";
  return `${email[0]}***@${email.slice(at + 1)}`;
}

/**
 * Redact every email-shaped substring found anywhere inside free-form text (e.g. a
 * provider error message that echoes the `to` address back verbatim). Unlike
 * `redactEmail`, which redacts a value already known to BE an email, this scans text
 * that may or may not contain one. Returns the input unchanged when null/empty so a
 * caller's `?? fallback` still applies to the null case.
 */
export function redactEmailsInText(text: string | null): string | null {
  if (!text) return text;
  return text.replace(/[\w.+-]+@[\w-]+\.[\w.-]+/g, (match) => redactEmail(match));
}
