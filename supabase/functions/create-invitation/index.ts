import { preflight, json } from "../_shared/http.ts";
import { requireOrgRole } from "../_shared/auth.ts";
import type { TablesInsert } from "../_shared/database.types.ts";
import { realDeps, type Deps } from "../_shared/deps.ts";
import { deliverOrgInvitation } from "../_shared/invitations.ts";

type Body = {
  org_id: string;
  email: string;
  role: 'admin' | 'producer' | 'artist';
  app_origin: string;
  /** Optional: link the invite to an existing catalog artist (forces role 'artist'). */
  artist_id?: string;
};

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export async function handle(req: Request, deps: Deps): Promise<Response> {
  if (req.method === "OPTIONS") return preflight();

  try {
    const body = (await req.json().catch(() => null)) as Body | null;
    const email = body?.email?.trim().toLowerCase();
    const appOrigin = body?.app_origin?.replace(/\/$/, "");
    if (!body?.org_id || !email || !body?.role || !appOrigin) {
      return json({ error: 'Invalid payload' }, 400);
    }
    if (!EMAIL_RE.test(email)) return json({ error: 'Invalid email address' }, 400);
    if (!['admin', 'producer', 'artist'].includes(body.role)) {
      return json({ error: 'Invalid role' }, 400);
    }

    // Caller must be an admin of the target org.
    const auth = await requireOrgRole(deps, req, body.org_id, ["admin"]);
    if (!auth.ok) return auth.response;

    const admin = deps.admin;

    // Optional artist_id: deterministic link from the artist surface. Validate against
    // the service client and force role 'artist' when linking a catalog artist.
    let role: Body["role"] = body.role;
    const artistId = typeof body.artist_id === "string" ? body.artist_id : undefined;
    if (artistId) {
      const { data: artist } = await admin
        .from("artists").select("id, org_id, user_id").eq("id", artistId).maybeSingle();
      const a = artist as { org_id?: string; user_id?: string | null } | null;
      if (!a || a.org_id !== body.org_id) {
        return json({ error: "Artist not found in this organization" }, 400);
      }
      if (a.user_id) {
        return json({ error: "That artist already has an account" }, 400);
      }
      role = "artist";
    }

    const insertRow: TablesInsert<"org_invitations"> = { org_id: body.org_id, email, role, invited_by: auth.userId };
    if (artistId) insertRow.artist_id = artistId;

    // Insert the invitation (token / status / expires_at use DB defaults) and read it back.
    const { data: invite, error: insErr } = await admin
      .from('org_invitations')
      .insert(insertRow)
      .select('id, org_id, email, role, status, token, expires_at, artist_id')
      .single();
    if (insErr || !invite) {
      return json({ error: insErr?.message ?? 'Could not create invitation' }, 500);
    }

    // Best-effort delivery. The invitation already exists, so a send failure does not
    // fail the request — the admin can copy the accept link instead.
    try {
      const { data: org } = await admin
        .from('organizations').select('name').eq('id', body.org_id).maybeSingle();
      const inviter = auth.userId ? await admin.auth.admin.getUserById(auth.userId) : null;
      await deliverOrgInvitation(deps, {
        email: invite.email,
        orgName: (org as { name?: string } | null)?.name ?? undefined,
        role: invite.role,
        token: invite.token,
        inviterEmail: inviter?.data?.user?.email ?? undefined,
        appOrigin,
        idempotencyKey: `org-invitation-${invite.id}`,
        orgId: body.org_id,
      });
    } catch (e) {
      console.error('create-invitation: delivery failed', (e as Error).message);
    }

    return json({ ok: true, invitation: invite });
  } catch (e) {
    console.error('create-invitation error', e);
    return json({ error: (e as Error).message }, 500);
  }
}

if (import.meta.main) Deno.serve((req) => handle(req, realDeps()));
