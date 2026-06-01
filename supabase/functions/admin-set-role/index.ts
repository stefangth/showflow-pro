import { preflight, json } from "../_shared/http.ts";
import { requireRole } from "../_shared/auth.ts";
import { realDeps, type Deps } from "../_shared/deps.ts";

type Body = {
  user_id: string;
  role: 'admin' | 'producer' | 'artist';
  action: 'add' | 'remove';
};

export async function handle(req: Request, deps: Deps): Promise<Response> {
  if (req.method === "OPTIONS") return preflight();

  try {
    const auth = await requireRole(deps, req, ["admin"]);
    if (!auth.ok) return auth.response;

    const admin = deps.admin;

    const body = (await req.json()) as Body;
    if (!body?.user_id || !body?.role || !['add', 'remove'].includes(body.action)) {
      return json({ error: 'Invalid payload' }, 400);
    }
    if (!['admin', 'producer', 'artist'].includes(body.role)) {
      return json({ error: 'Invalid role' }, 400);
    }

    if (body.action === 'add') {
      const { error } = await admin
        .from('user_roles')
        .insert({ user_id: body.user_id, role: body.role });
      // Ignore unique-violation (already has role)
      if (error && !/duplicate|unique/i.test(error.message)) throw error;
    } else {
      // Prevent removing the last admin
      if (body.role === 'admin') {
        const { count } = await admin
          .from('user_roles')
          .select('*', { count: 'exact', head: true })
          .eq('role', 'admin');
        if ((count ?? 0) <= 1) {
          return json({ error: 'Cannot remove the last admin' }, 400);
        }
      }
      const { error } = await admin
        .from('user_roles')
        .delete()
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
