import { createClient } from 'jsr:@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

type Decision = 'approved' | 'rejected';
type Role = 'admin' | 'producer' | 'artist';

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: corsHeaders });

  try {
    const authHeader = req.headers.get('Authorization');
    if (!authHeader?.startsWith('Bearer ')) {
      return json({ error: 'Unauthorized' }, 401);
    }

    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const anonKey = Deno.env.get('SUPABASE_ANON_KEY')!;
    const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;

    const userClient = createClient(supabaseUrl, anonKey, { global: { headers: { Authorization: authHeader } } });
    const token = authHeader.replace('Bearer ', '');
    const { data: claimsData } = await userClient.auth.getClaims(token);
    if (!claimsData?.claims) return json({ error: 'Unauthorized' }, 401);
    const callerId = claimsData.claims.sub as string;

    const admin = createClient(supabaseUrl, serviceKey);

    // Caller must be admin
    const { data: roleCheck } = await admin
      .from('user_roles')
      .select('role')
      .eq('user_id', callerId)
      .eq('role', 'admin')
      .maybeSingle();
    if (!roleCheck) return json({ error: 'Forbidden — admin only' }, 403);

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

    // Update approval row
    const { error: upErr } = await admin
      .from('user_approvals')
      .update({
        status: decision,
        requested_role: decision === 'approved' ? role : undefined,
        decided_by: callerId,
        decided_at: new Date().toISOString(),
        rejection_reason: decision === 'rejected' ? rejection_reason : null,
      })
      .eq('id', approval_id);
    if (upErr) throw upErr;

    if (decision === 'approved') {
      // Insert role (idempotent: unique constraint on user_id+role)
      const { error: roleErr } = await admin
        .from('user_roles')
        .insert({ user_id: approval.user_id, role })
        .select()
        .maybeSingle();
      if (roleErr && !roleErr.message?.includes('duplicate')) {
        console.error('Role insert error', roleErr);
      }
    }

    // Fire notification email (non-blocking)
    try {
      await admin.functions.invoke('send-transactional-email', {
        body: {
          templateName: 'signup-decision',
          recipientEmail: approval.email,
          idempotencyKey: `approval-${approval.id}-${decision}`,
          templateData: {
            decision,
            displayName: approval.display_name || approval.email,
            reason: rejection_reason,
            role: decision === 'approved' ? role : undefined,
          },
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
});

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}
