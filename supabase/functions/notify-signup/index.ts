import { preflight, json } from "../_shared/http.ts";
import { constantTimeEqual, isServiceRole } from "../_shared/auth.ts";
import { realDeps, type Deps } from "../_shared/deps.ts";

/**
 * Called by a database webhook on user_approvals INSERT.
 * Notifies all admins by sending a transactional email.
 *
 * Auth (fail-closed): accept only when the caller presents the Supabase webhook
 * secret (header `x-supabase-webhook-secret` matching SUPABASE_WEBHOOK_SECRET) OR
 * is the service-role caller (internal edge functions may invoke this). If neither,
 * reject with 401. We never fail open: a missing/empty SUPABASE_WEBHOOK_SECRET that
 * also isn't a service-role caller is rejected and logged as a misconfiguration.
 */
function isAuthorizedCaller(req: Request, deps: Deps): boolean {
  if (isServiceRole(deps, req)) return true;

  const provided = req.headers.get("x-supabase-webhook-secret") ?? "";
  const expected = deps.env("SUPABASE_WEBHOOK_SECRET") ?? "";
  if (expected === "") {
    console.error(
      "notify-signup: SUPABASE_WEBHOOK_SECRET is not set and caller is not service-role — rejecting (fail-closed). Configure the webhook secret.",
    );
    return false;
  }
  return constantTimeEqual(provided, expected);
}

export async function handle(req: Request, deps: Deps): Promise<Response> {
  if (req.method === "OPTIONS") return preflight();

  if (!isAuthorizedCaller(req, deps)) {
    return json({ error: "Unauthorized" }, 401);
  }

  try {
    const admin = deps.admin;

    const payload = await req.json().catch(() => ({}));
    // Webhook payload shape: { type, table, record, old_record, schema }
    const record = payload.record || payload;
    if (!record?.id || !record?.email) {
      return json({ error: 'Missing approval record' }, 400);
    }
    if (record.status && record.status !== 'pending') {
      // Only notify on pending creations (skip bootstrap-approved rows)
      return json({ skipped: 'not pending' });
    }

    // Find admin user IDs
    const { data: adminRoles } = await admin
      .from('user_roles')
      .select('user_id')
      .eq('role', 'admin');

    const adminIds = (adminRoles ?? []).map((r: { user_id: string }) => r.user_id);
    if (adminIds.length === 0) {
      console.warn('notify-signup: no admins configured');
      return json({ ok: true, notified: 0 });
    }

    // Resolve admin emails via service role
    const { data: usersPage } = await admin.auth.admin.listUsers({ page: 1, perPage: 1000 });
    const adminEmails = (usersPage?.users ?? [])
      .filter((u: { id: string; email?: string }) => adminIds.includes(u.id) && u.email)
      .map((u: { id: string; email?: string }) => ({ id: u.id, email: u.email as string }));

    let sent = 0;
    for (const a of adminEmails) {
      try {
        await deps.sendEmail({
          template_name: 'new-signup-admin-notification',
          recipient_email: a.email,
          idempotency_key: `signup-${record.id}-${a.id}`,
          templateData: {
            signupName: record.display_name || record.email,
            signupEmail: record.email,
            requestedRole: record.requested_role || 'artist',
          },
        });
        sent++;
      } catch (e) {
        console.warn(`notify-signup: failed to email admin ${a.email}:`, (e as Error).message);
      }
    }

    return json({ ok: true, notified: sent });
  } catch (e) {
    console.error('notify-signup error', e);
    return json({ error: (e as Error).message }, 500);
  }
}

if (import.meta.main) Deno.serve((req) => handle(req, realDeps()));
