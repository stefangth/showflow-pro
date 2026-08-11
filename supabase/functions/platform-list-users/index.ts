import { preflight, json } from "../_shared/http.ts";
import { requireSuperAdmin } from "../_shared/auth.ts";
import { realDeps, type Deps } from "../_shared/deps.ts";

interface MembershipRow { org_id: string; user_id: string; role: string }
interface OrgRow { id: string; name: string }
interface ArtistRow { id: string; name: string; user_id: string | null; org_id: string }
interface ProfileRow { user_id: string; display_name: string | null }
interface InvitationRow { org_id: string; email: string; status: string }

export async function handle(req: Request, deps: Deps): Promise<Response> {
  if (req.method === "OPTIONS") return preflight();
  try {
    const auth = await requireSuperAdmin(deps, req);
    if (!auth.ok) return auth.response;
    const admin = deps.admin;

    const { data: page, error: listErr } = await admin.auth.admin.listUsers({ page: 1, perPage: 1000 });
    if (listErr) throw listErr;
    const truncated = page.users.length >= 1000;

    const [{ data: mships }, { data: orgs }, { data: artists }, { data: profiles }, { data: invites }] = await Promise.all([
      admin.from("org_memberships").select("org_id, user_id, role"),
      admin.from("organizations").select("id, name"),
      admin.from("artists").select("id, name, user_id, org_id"),
      admin.from("profiles").select("user_id, display_name"),
      // Bounded: the user page is capped at 1000, so cap the pending-invite scan too rather
      // than reading every pending invitation platform-wide. Only invites matching a user on
      // this page are ever used; 5000 comfortably covers that while keeping the read finite.
      admin.from("org_invitations").select("org_id, email, status").eq("status", "pending").limit(5000),
    ]);
    const M = (mships ?? []) as unknown as MembershipRow[];
    const orgName = new Map(((orgs ?? []) as unknown as OrgRow[]).map((o) => [o.id, o.name]));
    const A = (artists ?? []) as unknown as ArtistRow[];
    const nameByUser = new Map(((profiles ?? []) as unknown as ProfileRow[]).map((p) => [p.user_id, p.display_name]));
    // Pending, not-yet-accepted invitations keyed `org_id|lower(email)`. Membership is created at
    // invite time, so a still-pending invitee already has an org_memberships row and shows in the
    // roster; this set is the only thing that distinguishes them from a fully-onboarded member.
    const pendingInvite = new Set(
      ((invites ?? []) as unknown as InvitationRow[]).map((i) => `${i.org_id}|${(i.email ?? "").toLowerCase()}`),
    );
    const now = deps.now().getTime();

    const users = page.users.map((u) => {
      const byOrg = new Map<string, { org_id: string; org_name: string; roles: string[]; artist: { id: string; name: string } | null; invitePending: boolean }>();
      const emailKey = (u.email ?? "").toLowerCase();
      for (const m of M.filter((x) => x.user_id === u.id)) {
        const e = byOrg.get(m.org_id) ?? { org_id: m.org_id, org_name: orgName.get(m.org_id) ?? "Unknown", roles: [], artist: null, invitePending: false };
        e.roles.push(m.role);
        const art = A.find((a) => a.org_id === m.org_id && a.user_id === u.id);
        e.artist = art ? { id: art.id, name: art.name } : null;
        if (emailKey && pendingInvite.has(`${m.org_id}|${emailKey}`)) e.invitePending = true;
        byOrg.set(m.org_id, e);
      }
      const banned = (u as { banned_until?: string | null }).banned_until ?? null;
      return {
        id: u.id, email: u.email ?? null, display_name: nameByUser.get(u.id) ?? null,
        created_at: u.created_at, last_sign_in_at: u.last_sign_in_at ?? null,
        suspended: !!banned && new Date(banned).getTime() > now,
        memberships: Array.from(byOrg.values()),
      };
    });
    return json({ users, truncated });
  } catch (e) {
    console.error("platform-list-users error", e);
    return json({ error: (e as Error).message }, 500);
  }
}

if (import.meta.main) Deno.serve((req) => handle(req, realDeps()));
