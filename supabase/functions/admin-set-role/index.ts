import { preflight, json } from "../_shared/http.ts";
import { requireOrgRole } from "../_shared/auth.ts";
import { BOOTSTRAP_ORG_ID } from "../_shared/constants.ts";
import { realDeps, type Deps } from "../_shared/deps.ts";

type Body = {
  user_id: string;
  role: 'admin' | 'producer' | 'artist';
  action: 'add' | 'remove';
  /** Target org. Defaults to the bootstrap org during the transition. */
  org_id?: string;
};

export async function handle(req: Request, deps: Deps): Promise<Response> {
  if (req.method === "OPTIONS") return preflight();

  try {
    const body = (await req.json().catch(() => null)) as Body | null;
    if (!body?.user_id || !body?.role || !['add', 'remove'].includes(body.action)) {
      return json({ error: 'Invalid payload' }, 400);
    }
    if (!['admin', 'producer', 'artist'].includes(body.role)) {
      return json({ error: 'Invalid role' }, 400);
    }
    const orgId = body.org_id ?? BOOTSTRAP_ORG_ID;

    // Caller must be an admin OF THE TARGET ORG — prevents an admin of one org
    // from granting roles in another.
    const auth = await requireOrgRole(deps, req, orgId, ["admin"]);
    if (!auth.ok) return auth.response;

    const admin = deps.admin;

    if (body.action === 'add') {
      const { error } = await admin
        .from('org_memberships')
        .insert({ org_id: orgId, user_id: body.user_id, role: body.role });
      // Ignore unique-violation (already a member with this role).
      if (error && !/duplicate|unique/i.test(error.message)) throw error;
    } else {
      // Prevent removing the last admin OF THIS ORG.
      if (body.role === 'admin') {
        const { count, error: countErr } = await admin
          .from('org_memberships')
          .select('*', { count: 'exact', head: true })
          .eq('org_id', orgId)
          .eq('role', 'admin');
        // A null count means the count query errored (network blip, schema cache
        // miss, RLS). Treat it as an explicit error state — not as "0 admins" —
        // so we don't wrongly block every admin removal with a misleading message.
        if (countErr || count === null) {
          return json({ error: 'Could not verify admin count' }, 500);
        }
        if (count <= 1) {
          return json({ error: 'Cannot remove the last admin' }, 400);
        }
      }
      const { error } = await admin
        .from('org_memberships')
        .delete()
        .eq('org_id', orgId)
        .eq('user_id', body.user_id)
        .eq('role', body.role);
      if (error) throw error;
    }

    return json({ ok: true });
  } catch (e) {
    console.error('admin-set-role error', e);
    return json({ error: (e as Error).message }, 500);
  }
}

if (import.meta.main) Deno.serve((req) => handle(req, realDeps()));
