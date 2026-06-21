import { preflight, json } from "../_shared/http.ts";
import { requireOrgRole } from "../_shared/auth.ts";
import { BOOTSTRAP_ORG_ID } from "../_shared/constants.ts";
import { realDeps, type Deps } from "../_shared/deps.ts";

export async function handle(req: Request, deps: Deps): Promise<Response> {
  if (req.method === "OPTIONS") return preflight();

  try {
    const admin = deps.admin;
    // Roster is reported for one org: the caller's active org. It may arrive as a
    // ?org_id query param (the documented contract) or in the POST body
    // (functions.invoke({ body: { org_id } }), the house convention) — query param
    // wins. Defaults to the bootstrap org when neither is supplied.
    let orgId = new URL(req.url).searchParams.get("org_id");
    if (!orgId) {
      orgId = await req.json()
        .then((b) => (b && typeof (b as { org_id?: unknown }).org_id === "string" ? (b as { org_id: string }).org_id : null))
        .catch(() => null);
    }
    const targetOrg = orgId ?? BOOTSTRAP_ORG_ID;

    // Org-scoped authorization: the caller must be an admin OF the org whose
    // roster they are reading (super-admins pass via requireOrgRole). Closes the
    // cross-org read where any org admin could pass ?org_id=<other org> and learn
    // that org's role assignments. Mirrors the open/close-offer-tier fix (#109).
    const auth = await requireOrgRole(deps, req, targetOrg, ["admin"]);
    if (!auth.ok) return auth.response;

    // List all auth users (paginated; we cap at 1000 for now)
    const { data: usersPage, error: listErr } = await admin.auth.admin.listUsers({ page: 1, perPage: 1000 });
    if (listErr) throw listErr;

    const userIds = usersPage.users.map(u => u.id);

    const { data: rolesData } = await admin
      .from('org_memberships').select('user_id, role').eq('org_id', targetOrg)
      .in('user_id', userIds.length ? userIds : ['00000000-0000-0000-0000-000000000000']);

    const rolesByUser: Record<string, string[]> = {};
    for (const r of rolesData ?? []) {
      (rolesByUser[r.user_id] ??= []).push(r.role);
    }

    const users = usersPage.users.map(u => ({
      id: u.id,
      email: u.email,
      created_at: u.created_at,
      last_sign_in_at: u.last_sign_in_at,
      roles: rolesByUser[u.id] ?? [],
    }));

    return json({ users });
  } catch (e) {
    console.error('admin-list-users error', e);
    return json({ error: (e as Error).message }, 500);
  }
}

if (import.meta.main) Deno.serve((req) => handle(req, realDeps()));
