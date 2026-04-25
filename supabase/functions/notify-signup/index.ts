import { createClient } from 'npm:@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

/**
 * Called by a database webhook on user_approvals INSERT.
 * Notifies all admins by sending a transactional email.
 */
Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: corsHeaders });

  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const admin = createClient(supabaseUrl, serviceKey);

    const payload = await req.json().catch(() => ({}));
    // Webhook payload shape: { type, table, record, old_record, schema }
    const record = payload.record || payload;
    if (!record?.id || !record?.email) {
      return new Response(JSON.stringify({ error: 'Missing approval record' }), { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    }
    if (record.status && record.status !== 'pending') {
      // Only notify on pending creations (skip bootstrap-approved rows)
      return new Response(JSON.stringify({ skipped: 'not pending' }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    }

    // Find admin user IDs
    const { data: adminRoles } = await admin
      .from('user_roles')
      .select('user_id')
      .eq('role', 'admin');

    const adminIds = (adminRoles ?? []).map(r => r.user_id);
    if (adminIds.length === 0) {
      console.warn('notify-signup: no admins configured');
      return new Response(JSON.stringify({ ok: true, notified: 0 }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    }

    // Resolve admin emails via service role
    const { data: usersPage } = await admin.auth.admin.listUsers({ page: 1, perPage: 1000 });
    const adminEmails = (usersPage?.users ?? [])
      .filter(u => adminIds.includes(u.id) && u.email)
      .map(u => ({ id: u.id, email: u.email as string }));

    let sent = 0;
    for (const a of adminEmails) {
      try {
        await admin.functions.invoke('send-transactional-email', {
          body: {
            templateName: 'new-signup-admin-notification',
            recipientEmail: a.email,
            idempotencyKey: `signup-${record.id}-${a.id}`,
            templateData: {
              signupName: record.display_name || record.email,
              signupEmail: record.email,
              requestedRole: record.requested_role || 'artist',
            },
          },
        });
        sent++;
      } catch (e) {
        console.warn(`notify-signup: failed to email admin ${a.email}:`, (e as Error).message);
      }
    }

    return new Response(JSON.stringify({ ok: true, notified: sent }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
  } catch (e) {
    console.error('notify-signup error', e);
    return new Response(JSON.stringify({ error: (e as Error).message }), { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
  }
});
