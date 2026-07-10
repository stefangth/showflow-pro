import * as React from 'npm:react@18.3.1'
import { renderAsync } from 'npm:@react-email/components@0.0.22'
import { TEMPLATES } from '../_shared/transactional-email-templates/registry.ts'
import { preflight, json } from "../_shared/http.ts";
import { realDeps, type Deps } from "../_shared/deps.ts";
import { resolveOrgSetting, BOOKING_ENGINE_DEFAULTS } from "../_shared/settings.ts";
import { categoryForTemplate } from "../_shared/notificationCategories.ts";
import { isServiceRole } from "../_shared/auth.ts";
import { redactEmail } from "../_shared/identity.ts";

function generateToken(): string {
  const bytes = new Uint8Array(32)
  crypto.getRandomValues(bytes)
  return Array.from(bytes)
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('')
}

export async function handle(req: Request, deps: Deps): Promise<Response> {
  if (req.method === 'OPTIONS') return preflight();

  const supabaseUrl = deps.env('SUPABASE_URL')
  const supabaseServiceKey = deps.env('SUPABASE_SERVICE_ROLE_KEY')
  const resendApiKey = deps.env('RESEND_API_KEY')

  if (!supabaseUrl || !supabaseServiceKey || !resendApiKey) {
    console.error('Missing required environment variables')
    return json({ error: 'Server configuration error' }, 500)
  }

  // Caller authentication: this function wields the service-role email pipeline,
  // so only internal service-role callers may invoke it (digests, invitations, the
  // booking engine). A public (anon-key) call must not be able to send arbitrary mail.
  if (!isServiceRole(deps, req)) {
    return json({ error: 'Forbidden' }, 403)
  }

  let templateName: string
  let recipientEmail: string
  let idempotencyKey: string
  let messageId: string
  let templateData: Record<string, any> = {}
  let orgId: string | null = null
  try {
    const body = await req.json()
    templateName = body.templateName || body.template_name
    recipientEmail = body.recipientEmail || body.recipient_email
    messageId = crypto.randomUUID()
    idempotencyKey = body.idempotencyKey || body.idempotency_key || messageId
    orgId = body.org_id ?? body.orgId ?? null
    if (body.templateData && typeof body.templateData === 'object') {
      templateData = body.templateData
    }
  } catch {
    return json({ error: 'Invalid JSON in request body' }, 400)
  }

  if (!templateName) {
    return json({ error: 'templateName is required' }, 400)
  }

  const template = TEMPLATES[templateName]
  if (!template) {
    console.error('Template not found in registry', { templateName })
    return json({
      error: `Template '${templateName}' not found. Available: ${Object.keys(TEMPLATES).join(', ')}`,
    }, 404)
  }

  const effectiveRecipient = template.to || recipientEmail
  if (!effectiveRecipient) {
    return json({
      error: 'recipientEmail is required (unless the template defines a fixed recipient)',
    }, 400)
  }

  const admin = deps.admin;

  // Record the attempt up front — exactly one row per message, updated in place.
  await admin.from('email_send_log').insert({
    message_id: messageId,
    org_id: orgId,
    template_name: templateName,
    recipient_email: effectiveRecipient,
    status: 'pending',
  })

  // Check suppression list (fail-closed)
  const { data: suppressed, error: suppressionError } = await admin
    .from('suppressed_emails')
    .select('id')
    .eq('email', effectiveRecipient.toLowerCase())
    .maybeSingle()

  if (suppressionError) {
    console.error('Suppression check failed — refusing to send', { error: suppressionError })
    return json({ error: 'Failed to verify suppression status' }, 500)
  }

  if (suppressed) {
    await admin.from('email_send_log').update({ status: 'suppressed' }).eq('message_id', messageId)
    return json({ success: false, reason: 'email_suppressed' }, 200)
  }

  // Per-category email preference gate (fail-open). Critical/unmapped templates
  // (invites, password reset) have no category and always send.
  const prefCategory = categoryForTemplate(templateName)
  if (prefCategory) {
    // Resolve the recipient address -> auth user via a service-role-only RPC
    // (case-insensitive, reliable at any scale — replaces a first-page listUsers() scan).
    const { data: recipientUserId, error: lookupErr } = await admin.rpc('get_user_id_by_email', {
      p_email: effectiveRecipient,
    })
    if (lookupErr) {
      // Lookup failed — fail open (send), but log so the gap is visible.
      console.warn('email pref gate: recipient lookup failed, sending unchecked', {
        templateName, category: prefCategory, error: lookupErr.message,
      })
    } else if (recipientUserId) {
      const { data: wants, error: prefErr } = await admin.rpc('should_notify', {
        p_user: recipientUserId, p_category: prefCategory, p_channel: 'email',
      })
      if (!prefErr && wants === false) {
        await admin.from('email_send_log').update({ status: 'pref_disabled' }).eq('message_id', messageId)
        return json({ success: false, reason: 'pref_disabled' }, 200)
      }
    }
    // else: no account for this address (external / booking-contact recipient) — there are
    // no preferences to honor, so it sends.
  }

  // Get or create unsubscribe token
  const normalizedEmail = effectiveRecipient.toLowerCase()
  let unsubscribeToken: string

  const { data: existingToken, error: tokenLookupError } = await admin
    .from('email_unsubscribe_tokens')
    .select('token, used_at')
    .eq('email', normalizedEmail)
    .maybeSingle()

  if (tokenLookupError) {
    console.error('Token lookup failed', { error: tokenLookupError })
    return json({ error: 'Failed to prepare email' }, 500)
  }

  if (existingToken && !existingToken.used_at) {
    unsubscribeToken = existingToken.token
  } else if (!existingToken) {
    unsubscribeToken = generateToken()
    const { error: tokenError } = await admin
      .from('email_unsubscribe_tokens')
      .upsert(
        { token: unsubscribeToken, email: normalizedEmail },
        { onConflict: 'email', ignoreDuplicates: true }
      )

    if (tokenError) {
      console.error('Failed to create unsubscribe token', { error: tokenError })
      return json({ error: 'Failed to prepare email' }, 500)
    }

    const { data: storedToken, error: reReadError } = await admin
      .from('email_unsubscribe_tokens')
      .select('token')
      .eq('email', normalizedEmail)
      .maybeSingle()

    if (reReadError || !storedToken) {
      console.error('Failed to read back unsubscribe token after upsert', { error: reReadError })
      return json({ error: 'Failed to prepare email' }, 500)
    }
    unsubscribeToken = storedToken.token
  } else {
    // Token used but email not suppressed — safety fallback
    console.warn('Unsubscribe token already used but email not suppressed', { email_redacted: redactEmail(normalizedEmail) })
    return json({ success: false, reason: 'email_suppressed' }, 200)
  }

  // Render template (overrides merged below after reading app_settings)
  const resolvedSubject =
    typeof template.subject === 'function'
      ? template.subject(templateData)
      : template.subject

  // Read from-address and template overrides for this org (org override ?? platform default).
  const fromAddress = await resolveOrgSetting<string>(
    admin, orgId, 'resend_from_address', BOOKING_ENGINE_DEFAULTS.resend_from_address)

  const overrides = await resolveOrgSetting<Record<string, any>>(
    admin, orgId, 'email_template_overrides', {})
  const templateOverride = overrides[templateName] ?? {}

  // Apply subject override
  let resolvedSubjectFinal = resolvedSubject
  if (templateOverride.subject && typeof templateOverride.subject === 'string' && templateOverride.subject.trim()) {
    resolvedSubjectFinal = templateOverride.subject.trim()
  }

  // Merge _intro, _cta_label, _footer into templateData (non-null values only)
  const mergedTemplateData = { ...templateData }
  if (templateOverride.intro) mergedTemplateData._intro = templateOverride.intro
  if (templateOverride.cta_label) mergedTemplateData._cta_label = templateOverride.cta_label
  if (templateOverride.footer) mergedTemplateData._footer = templateOverride.footer

  // Render template with merged data
  const html = await renderAsync(React.createElement(template.component, mergedTemplateData))
  const plainText = await renderAsync(
    React.createElement(template.component, mergedTemplateData),
    { plainText: true }
  )

  // Build unsubscribe URL pointing at the edge function
  const unsubscribeUrl = `${supabaseUrl}/functions/v1/handle-email-unsubscribe?token=${unsubscribeToken}`

  // Send via Resend
  const sendResponse = await deps.fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${resendApiKey}`,
      'Content-Type': 'application/json',
      'Idempotency-Key': idempotencyKey,
    },
    body: JSON.stringify({
      from: fromAddress,
      to: [effectiveRecipient],
      subject: resolvedSubjectFinal,
      html,
      text: plainText,
      headers: {
        'List-Unsubscribe': `<${unsubscribeUrl}>`,
        'List-Unsubscribe-Post': 'List-Unsubscribe=One-Click',
      },
    }),
  })

  if (!sendResponse.ok) {
    const errorBody = await sendResponse.text()
    console.error('Resend API error', { status: sendResponse.status, body: errorBody, templateName })

    await admin.from('email_send_log').update({
      status: 'failed',
      error_message: `Resend ${sendResponse.status}: ${errorBody.slice(0, 200)}`,
    }).eq('message_id', messageId)

    return json({ error: 'Failed to send email' }, 500)
  }

  const sendData = await sendResponse.json()

  await admin.from('email_send_log').update({
    status: 'sent',
    resend_id: sendData.id,
    sent_at: deps.now().toISOString(),
    metadata: { resend_id: sendData.id },
  }).eq('message_id', messageId)

  console.log('Email sent via Resend', {
    templateName,
    recipient_redacted: redactEmail(effectiveRecipient),
    resend_id: sendData.id,
  })

  return json({ success: true, message_id: sendData.id }, 200)
}

if (import.meta.main) Deno.serve((req) => handle(req, realDeps()));
