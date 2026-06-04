import { preflight, json } from "../_shared/http.ts";
import { requireSuperAdmin } from "../_shared/auth.ts";
import { realDeps, type Deps } from "../_shared/deps.ts";

type Body = {
  name: string;
  slug: string;
  admin_email: string;
  role?: "admin" | "producer" | "artist";
  app_origin: string;
};

export async function handle(req: Request, deps: Deps): Promise<Response> {
  if (req.method === "OPTIONS") return preflight();

  try {
    const auth = await requireSuperAdmin(deps, req);
    if (!auth.ok) return auth.response;

    const body = (await req.json().catch(() => null)) as Body | null;
    const name = body?.name?.trim();
    const slug = body?.slug?.trim().toLowerCase();
    const email = body?.admin_email?.trim().toLowerCase();
    const role = body?.role ?? "admin";
    const appOrigin = body?.app_origin?.replace(/\/$/, "");
    if (!name || !slug || !email || !appOrigin) return json({ error: "Invalid payload" }, 400);
    if (!["admin", "producer", "artist"].includes(role)) return json({ error: "Invalid role" }, 400);

    // Atomic DB work runs as the caller (auth.uid() = the super-admin) so provision_org's
    // internal is_super_admin check passes; SECURITY DEFINER does the privileged inserts.
    const authHeader = req.headers.get("Authorization")!;
    const { data, error } = await deps.userClient(authHeader)
      .rpc("provision_org", { p_name: name, p_slug: slug, p_admin_email: email, p_role: role });
    if (error) {
      const code = (error as { code?: string }).code;
      if (code === "23505") return json({ error: "That slug is already taken" }, 409);
      return json({ error: (error as Error).message ?? "Could not provision org" }, 500);
    }
    const { org_id, token } = data as { org_id: string; token: string };
    const acceptUrl = `${appOrigin}/accept-invite?token=${token}`;

    // Bootstrap the first admin's account so they can authenticate + accept.
    try {
      let exists = false;
      for (let page = 1; ; page++) {
        const { data: list } = await deps.admin.auth.admin.listUsers({ page, perPage: 200 });
        const users = list?.users ?? [];
        if (users.some((u: { email?: string }) => u.email?.toLowerCase() === email)) { exists = true; break; }
        if (users.length < 200) break;
      }
      if (!exists) {
        // Net-new: Supabase invite email carries a magic link → redirect to accept-invite.
        await deps.admin.auth.admin.inviteUserByEmail(email, { redirectTo: acceptUrl });
      } else {
        // Existing user: send our branded org-invitation email with the accept link.
        const inviter = auth.userId ? await deps.admin.auth.admin.getUserById(auth.userId) : null;
        await deps.sendEmail({
          template_name: "org-invitation",
          recipient_email: email,
          templateData: { orgName: name, role, token, inviterEmail: inviter?.data?.user?.email ?? undefined },
          idempotency_key: `org-invitation-${org_id}`,
        });
      }
    } catch (e) {
      console.error("provision-org: invite delivery failed", (e as Error).message);
    }

    return json({ org_id });
  } catch (e) {
    console.error("provision-org error", e);
    return json({ error: (e as Error).message }, 500);
  }
}

if (import.meta.main) Deno.serve((req) => handle(req, realDeps()));
