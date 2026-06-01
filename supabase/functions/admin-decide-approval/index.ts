import { preflight, json } from "../_shared/http.ts";
import { requireRole } from "../_shared/auth.ts";
import { realDeps, type Deps } from "../_shared/deps.ts";

type Decision = 'approved' | 'rejected';
type Role = 'admin' | 'producer' | 'artist';

export async function handle(req: Request, deps: Deps): Promise<Response> {
  if (req.method === "OPTIONS") return preflight();

  try {
    const auth = await requireRole(deps, req, ["admin"]);
    if (!auth.ok) return auth.response;

    const admin = deps.admin;

    const body = await req.json().catch(() => ({}));
    const approval_id = String(body.approval_id || '');
    const decision = body.decision as Decision;
    const role = (body.role as Role) || 'artist';
    const rejection_reason: string | null = body.rejection_reason || null;

    if (!approval_id || !['approved', 'rejected'].includes(decision)) {
      return json({ error: 'approval_id and valid decision are required' }, 400);
    }
    if (decision === 'approved' && !['admin', 'producer', 'artist'].includes(role)) {
      return json({ error: 'Invalid role' }, 400);
    }

    // Fetch approval row
    const { data: approval, error: aErr } = await admin
      .from('user_approvals')
      .select('id, user_id, email, display_name, status')
      .eq('id', approval_id)
      .maybeSingle();
    if (aErr || !approval) return json({ error: 'Approval not found' }, 404);

    // Atomically update approval + insert role via a single DB transaction
    const { error: rpcErr } = await admin.rpc('decide_user_approval', {
      p_approval_id:      approval_id,
      p_decision:         decision,
      p_role:             role,
      p_rejection_reason: rejection_reason,
      p_decided_by:       auth.userId,
    });
    if (rpcErr) throw rpcErr;

    // Fire notification email (non-blocking)
    try {
      await deps.sendEmail({
        template_name: 'signup-decision',
        recipient_email: approval.email,
        idempotency_key: `approval-${approval.id}-${decision}`,
        templateData: {
          decision,
          displayName: approval.display_name || approval.email,
          reason: rejection_reason,
          role: decision === 'approved' ? role : undefined,
        },
      });
    } catch (e) {
      console.warn('signup-decision email skipped:', (e as Error).message);
    }

    return json({ ok: true });
  } catch (e) {
    console.error('admin-decide-approval error', e);
    return json({ error: (e as Error).message }, 500);
  }
}

if (import.meta.main) Deno.serve((req) => handle(req, realDeps()));
