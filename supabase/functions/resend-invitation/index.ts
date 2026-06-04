import { preflight, json } from "../_shared/http.ts";
import { requireOrgRole } from "../_shared/auth.ts";
import { realDeps, type Deps } from "../_shared/deps.ts";

type Body = { invitation_id: string };

export async function handle(req: Request, deps: Deps): Promise<Response> {
  if (req.method === "OPTIONS") return preflight();

  try {
    const body = (await req.json().catch(() => null)) as Body | null;
    if (!body?.invitation_id) return json({ error: "Invalid payload" }, 400);

    const { data: invite } = await deps.admin
      .from("org_invitations")
      .select("id, org_id, email, role, token, status")
      .eq("id", body.invitation_id)
      .maybeSingle();

    // Authorize BEFORE disclosing anything. If the invite doesn't exist we cannot
    // org-scope the check, so return the same 403 an unauthorized caller gets — no
    // existence/status signal leaks to non-admins. (requireOrgRole short-circuits for super-admins.)
    if (!invite) return json({ error: "Forbidden" }, 403);
    const auth = await requireOrgRole(deps, req, invite.org_id, ["admin"]);
    if (!auth.ok) return auth.response;

    if (invite.status !== "pending") return json({ error: "Invitation is not pending" }, 409);

    const { data: org } = await deps.admin
      .from("organizations").select("name").eq("id", invite.org_id).maybeSingle();
    await deps.sendEmail({
      template_name: "org-invitation",
      recipient_email: invite.email,
      templateData: { orgName: org?.name ?? undefined, role: invite.role, token: invite.token },
      idempotency_key: `org-invitation-resend-${invite.id}`,
    });

    return json({ ok: true });
  } catch (e) {
    console.error("resend-invitation error", e);
    return json({ error: (e as Error).message }, 500);
  }
}

if (import.meta.main) Deno.serve((req) => handle(req, realDeps()));
