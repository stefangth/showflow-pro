import type { Deps } from "./deps.ts";

/**
 * Shared plumbing for the Supabase Analytics / Management API, used by both
 * platform-edge-metrics (the live System Health panel) and health-rollup (the durable daily
 * rollup). Kept here rather than duplicated: a fix to the slug lookup would otherwise have to
 * land twice, and the two would drift the moment one was patched.
 *
 * Timestamp handling lives next door in analyticsTime.ts.
 */

/** Project ref from a SUPABASE_URL, for the Management API path. */
export function deriveRef(url?: string): string | null {
  const m = (url ?? "").match(/https?:\/\/([a-z0-9]+)\.supabase\.co/i);
  return m ? m[1] : null;
}

/**
 * function_id -> slug, from the Management API (GET /v1/projects/{ref}/functions returns a
 * bare array of { id, slug, name, ... }). The Analytics log rows carry only the UUID; there is
 * no function_name column, so this is the only way to label them.
 *
 * Best-effort by design: on any failure it returns an empty map and callers fall back to the
 * raw id, which still yields usable (if ugly) data rather than blanking the panel or dropping
 * a day of the uptime bar over a name-resolution outage.
 */
export async function fetchFnSlugs(deps: Deps, ref: string, token: string): Promise<Map<string, string>> {
  const map = new Map<string, string>();
  try {
    const res = await deps.fetch(`https://api.supabase.com/v1/projects/${ref}/functions`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (!res.ok) return map;
    const parsed = await res.json().catch(() => null);
    const list = Array.isArray(parsed) ? parsed : ((parsed as { functions?: unknown } | null)?.functions ?? []);
    for (const f of list as Array<{ id?: string; slug?: string; name?: string }>) {
      const label = f?.slug ?? f?.name;
      if (f?.id && label) map.set(f.id, label);
    }
  } catch (_e) { /* degrade to id labels */ }
  return map;
}
