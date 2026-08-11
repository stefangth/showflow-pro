/**
 * Normalize an unknown thrown value to a user-facing message. supabase-js returns a
 * failed .rpc()/query error as a PLAIN object { code, message, details, hint } — NOT an
 * Error instance — so `e instanceof Error` alone silently swallows every DB error into a
 * generic fallback. Read `.message` off either shape.
 */
export function toErrorMessage(e: unknown, fallback = "Something went wrong"): string {
  if (e instanceof Error && e.message) return e.message;
  if (e && typeof e === "object") {
    const m = (e as { message?: unknown }).message;
    if (typeof m === "string" && m) return m;
  }
  return fallback;
}

/** Map known org-membership guard messages to guidance; otherwise the real message. */
export function friendlyError(e: unknown): string {
  const msg = toErrorMessage(e);
  if (/keep at least one admin|last admin of the organization/i.test(msg)) {
    return "This organization needs at least one admin. Make someone else an admin first, then remove this one.";
  }
  return msg;
}
