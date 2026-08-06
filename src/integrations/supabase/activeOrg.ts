/**
 * The active organization, carried to PostgREST on every request.
 *
 * Why this exists
 * ---------------
 * RLS scopes rows to the orgs a caller MAY read, never to the org they are currently
 * viewing: `is_org_member()` is `is_super_admin(uid) OR exists(membership)`, so it is
 * true for every org for a platform admin and for every org a multi-org member belongs
 * to. Narrowing to the active org is therefore the client's job (ADR-0003), and a single
 * forgotten `.eq("org_id", …)` leaks another org's rows into the UI.
 *
 * `src/data/**` does that filtering and `src/test/orgScoping.test.ts` keeps it honest.
 * This module is the backstop underneath both: the org id travels as an `x-active-org`
 * request header, and the `org_isolation` RLS policy ANDs it in, so a query that forgot
 * its filter still cannot return another org's rows.
 *
 * Safety properties
 * -----------------
 * - It can only ever NARROW. The policy is
 *   `is_org_member(uid, org_id) AND (active_org_id() IS NULL OR org_id = active_org_id())`,
 *   so forging the header buys a caller nothing they could not already read.
 * - No header means today's behavior. Service-role callers bypass RLS entirely, and edge
 *   functions using a user JWT simply never send it. Fail-open is deliberate: this is a
 *   second line of defense, not the primary control.
 *
 * The value is injected through a custom `fetch` rather than by mutating the client's
 * headers, because the shared client is created once at import (recreating it would drop
 * the auth session and realtime subscriptions) and `PostgrestClient.headers` is not a
 * supported mutation surface.
 */

export const ACTIVE_ORG_HEADER = "x-active-org";

let activeOrgId: string | null = null;

/** Set (or clear, with null) the org sent on subsequent requests. */
export function setActiveOrg(orgId: string | null): void {
  const trimmed = orgId?.trim();
  activeOrgId = trimmed ? trimmed : null;
}

export function getActiveOrg(): string | null {
  return activeOrgId;
}

/**
 * Wrap a fetch so every request carries the active org. The value is read per request,
 * not captured at creation, because the client outlives any single org selection.
 */
export function createActiveOrgFetch(base: typeof fetch): typeof fetch {
  return (input, init) => {
    const orgId = getActiveOrg();
    if (!orgId) return base(input, init);
    const headers = new Headers(init?.headers);
    headers.set(ACTIVE_ORG_HEADER, orgId);
    return base(input, { ...init, headers });
  };
}
