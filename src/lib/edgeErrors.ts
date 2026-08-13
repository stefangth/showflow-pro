/**
 * supabase-js throws `Edge Function returned a non-2xx status code` and discards the
 * body, so every server-side reason arrives as the same opaque string. The Response
 * is still reachable on `error.context` — this reads it once and maps our `{ error: code }`
 * convention to copy a user can act on.
 */

const CODE_COPY: Record<string, string> = {
  feature_disabled: "This module is off for this organization. Enable it in Platform, Organizations.",
  invalid_fee: "The fee must be a number.",
  bad_request: "That request was missing required information.",
  unknown_action: "That action is not supported.",
  not_found: "That record no longer exists.",
  forbidden: "You do not have access to that record.",
  no_pdf: "That order has no PDF yet.",
  analytics_unavailable: "Metrics are temporarily unavailable.",
};

export function hasResponseContext(e: unknown): e is { context: Response } {
  return typeof e === "object" && e !== null && "context" in e &&
    (e as { context: unknown }).context instanceof Response;
}

export function edgeResponseContext(error: unknown): Response | null {
  return hasResponseContext(error) ? error.context : null;
}

export async function readEdgeError(error: unknown): Promise<string> {
  const fallback = error instanceof Error ? error.message : "Something went wrong.";
  if (!hasResponseContext(error)) return fallback;
  try {
    const body = await error.context.clone().json() as { error?: unknown };
    const code = typeof body?.error === "string" ? body.error : null;
    if (!code) return fallback;
    return CODE_COPY[code] ?? code;
  } catch {
    return fallback;
  }
}
