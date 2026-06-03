import { preflight, json } from "../_shared/http.ts";
import { requireRole } from "../_shared/auth.ts";
import { BOOTSTRAP_ORG_ID } from "../_shared/constants.ts";
import { realDeps, type Deps } from "../_shared/deps.ts";

export async function handle(req: Request, deps: Deps): Promise<Response> {
  if (req.method === "OPTIONS") return preflight();

  try {
    const auth = await requireRole(deps, req, ["admin"]);
    if (!auth.ok) return auth.response;

    const admin = deps.admin;
    // Roles are reported for one org (defaults to the bootstrap org during the
    // transition). The org switcher will pass ?org_id=<active org> in Phase 1C.
    const orgId = new URL(req.url).searchParams.get("org_id") ?? BOOTSTRAP_ORG_ID;

    // List all auth users (paginated; we cap at 1000 for now)
    const { data: usersPage, error: listErr } = await admin.auth.admin.listUsers({ page: 1, perPage: 1000 });
    if (listErr) throw listErr;

    const userIds = usersPage.users.map(u => u.id);

    const [{ data: rolesData }, { data: approvalsData }] = await Promise.all([
      admin.from('org_memberships').select('user_id, role').eq('org_id', orgId).in('user_id', userIds.length ? userIds : ['00000000-0000-0000-0000-000000000000']),
      admin.from('user_approvals').select('user_id, status').in('user_id', userIds.length ? userIds : ['00000000-0000-0000-0000-000000000000']),
    ]);

    const rolesByUser: Record<string, string[]> = {};
    for (const r of rolesData ?? []) {
      (rolesByUser[r.user_id] ??= []).push(r.role);
    }
    const approvalByUser: Record<string, string> = {};
    for (const a of approvalsData ?? []) {
      approvalByUser[a.user_id] = a.status;
    }

    const users = usersPage.users.map(u => ({
      id: u.id,
      email: u.email,
      created_at: u.created_at,
      last_sign_in_at: u.last_sign_in_at,
      roles: rolesByUser[u.id] ?? [],
      approval_status: approvalByUser[u.id] ?? null,
    }));

    return json({ users });
  } catch (e) {
    console.error('admin-list-users error', e);
    return json({ error: (e as Error).message }, 500);
  }
}

if (import.meta.main) Deno.serve((req) => handle(req, realDeps()));
