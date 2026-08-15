import * as React from 'npm:react@18.3.1'
import { renderAsync } from 'npm:@react-email/components@0.0.22'
import { legacyTemplateSubjectOverride, resolveTemplatePresentation, TEMPLATES, type TemplateData } from '../_shared/transactional-email-templates/registry.ts'
import { legacyEmailOverridesToCopy, type EmailCopyOverride } from '../_shared/transactional-email-templates/_shell/emailCopy.ts'
import type { EmailThemeOverride } from '../_shared/transactional-email-templates/_shell/emailTheme.ts'
import { preflight, json } from "../_shared/http.ts";
import { realDeps, type Deps, type EmailAttachment } from "../_shared/deps.ts";
import { resolveOrgSetting, BOOKING_ENGINE_DEFAULTS } from "../_shared/settings.ts";
import { coerceLocale, resolveOrgLocale, type ServerLocale } from "../_shared/orgLocale.ts";
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

const MAX_ATTACHMENTS = 2
const MAX_ATTACHMENT_BYTES = 5 * 1024 * 1024 // 5MB

/** Decoded byte size of a base64 string, computed from its length (no actual decode
 * needed): 4 chars encode 3 bytes, minus 1 byte per trailing '=' padding char. */
function base64ByteSize(b64: string): number {
  const len = b64.length
  if (len === 0) return 0
  let padding = 0
  if (b64.endsWith('==')) padding = 2
  else if (b64.endsWith('=')) padding = 1
  return Math.floor((len * 3) / 4) - padding
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
  let templateData: TemplateData = {}
  let orgId: string | null = null
  let attachments: EmailAttachment[] | undefined
  // An explicit locale forces the email language (still entitlement-gated in
  // resolveOrgLocale); undefined means "resolve the org's live org_language".
  let localeOverride: ServerLocale | null = null
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
    if (Array.isArray(body.attachments) && body.attachments.length > 0) {
      attachments = body.attachments as EmailAttachment[]
    }
    if (body.locale != null) {
      localeOverride = coerceLocale(body.locale)
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

  // Attachment limits (checked before any side effect so a rejected request never
  // creates an email_send_log row or reaches Resend).
  if (attachments) {
    if (attachments.length > MAX_ATTACHMENTS) {
      return json({ error: 'attachment_too_large' }, 400)
    }
    for (const att of attachments) {
      if (
        typeof att?.filename !== 'string' || att.filename.length === 0 ||
        typeof att?.content_base64 !== 'string' || att.content_base64.length === 0
      ) {
        return json({ error: 'attachment_invalid' }, 400)
      }
      if (base64ByteSize(att.content_base64) > MAX_ATTACHMENT_BYTES) {
        return json({ error: 'attachment_too_large' }, 400)
      }
    }
  }

  const admin = deps.admin;

  // Record the attempt up front — exactly one row per message, updated in place.
  const { error: pendingErr } = await admin.from('email_send_log').insert({
    message_id: messageId,
    org_id: orgId,
    template_name: templateName,
    recipient_email: effectiveRecipient,
    status: 'pending',
  })
  if (pendingErr) {
    console.error('email_send_log pending insert failed — refusing to send unlogged', pendingErr)
    return json({ error: 'Failed to record email send' }, 500)
  }

  // Transition the pending row to 'failed' before any early-return error path below,
  // so a genuine send failure never leaves an orphaned 'pending' row hiding it from
  // the monitoring.
  const logFailed = async (message: string) => {
    await admin.from('email_send_log').update({
      status: 'failed',
      error_message: message,
    }).eq('message_id', messageId)
  }

  // Check suppression list (fail-closed)
  const { data: suppressed, error: suppressionError } = await admin
    .from('suppressed_emails')
    .select('email')
    .eq('email', effectiveRecipient.toLowerCase())
    .maybeSingle()

  if (suppressionError) {
    console.error('Suppression check failed — refusing to send', { error: suppressionError })
    await logFailed(`Suppression check failed: ${suppressionError.message ?? 'unknown error'}`)
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
    await logFailed(`Unsubscribe token lookup failed: ${tokenLookupError.message ?? 'unknown error'}`)
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
      await logFailed(`Unsubscribe token upsert failed: ${tokenError.message ?? 'unknown error'}`)
      return json({ error: 'Failed to prepare email' }, 500)
    }

    const { data: storedToken, error: reReadError } = await admin
      .from('email_unsubscribe_tokens')
      .select('token')
      .eq('email', normalizedEmail)
      .maybeSingle()

    if (reReadError || !storedToken) {
      console.error('Failed to read back unsubscribe token after upsert', { error: reReadError })
      await logFailed(`Unsubscribe token re-read failed: ${reReadError?.message ?? 'token missing after upsert'}`)
      return json({ error: 'Failed to prepare email' }, 500)
    }
    unsubscribeToken = storedToken.token
  } else {
    // Token used but email not suppressed — safety fallback
    console.warn('Unsubscribe token already used but email not suppressed', { email_redacted: redactEmail(normalizedEmail) })
    await admin.from('email_send_log').update({ status: 'suppressed' }).eq('message_id', messageId)
    return json({ success: false, reason: 'email_suppressed' }, 200)
  }

  // Render + send (including resolving org settings) are wrapped so a THROWN error
  // (a failed app_settings read inside resolveOrgSetting, a renderAsync failure, or a
  // network error from deps.fetch — distinct from the handled `!sendResponse.ok` case
  // below) can't escape and leave the row stuck at 'pending' forever: a stuck 'pending'
  // row counts as an "attempted" send but never a "failed" one, which would mask an
  // outage from monitoring.
  let sendData: { id: string; [key: string]: unknown }
  try {
    // Read from-address and presentation settings for this org (org override ?? platform default).
    const fromAddress = await resolveOrgSetting<string>(
      admin, orgId, 'resend_from_address', BOOKING_ENGINE_DEFAULTS.resend_from_address)

    // `null` distinguishes a missing new copy setting from a deliberately stored
    // empty map, which suppresses the one-release legacy backfill.
    const copySetting = await resolveOrgSetting<EmailCopyOverride | null>(
      admin, orgId, 'email_copy', null)
    const themeSetting = await resolveOrgSetting<EmailThemeOverride>(
      admin, orgId, 'email_theme', {})
    const legacyOverrides = await resolveOrgSetting<unknown>(
      admin, orgId, 'email_template_overrides', {})
    const copyOverride = copySetting ?? legacyEmailOverridesToCopy(legacyOverrides)
    // Per-org language: German only when the org set it AND is entitled to
    // language_packages (resolveOrgLocale double-gates). Org-less sends (null
    // orgId: magic-link, account-email-changed) stay English.
    const locale = await resolveOrgLocale(admin, orgId, localeOverride)
    const presentation = resolveTemplatePresentation(templateName, templateData, {
      copyOverride,
      copyIsExplicit: copySetting !== null,
      legacySubjectOverride: copySetting === null
        ? legacyTemplateSubjectOverride(legacyOverrides, templateName)
        : undefined,
      themeOverride: themeSetting,
      locale,
    })
    if (!presentation) throw new Error(`Template '${templateName}' not found during presentation resolution`)

    // Render template with its resolved presentation props.
    const html = await renderAsync(React.createElement(template.component, presentation.props))
    const plainText = await renderAsync(
      React.createElement(template.component, presentation.props),
      { plainText: true }
    )

    // Build unsubscribe URL pointing at the edge function
    const unsubscribeUrl = `${supabaseUrl}/functions/v1/handle-email-unsubscribe?token=${unsubscribeToken}`

    // Map { filename, content_base64 } -> Resend's { filename, content } shape.
    // Omitted entirely when there are no attachments, so pre-Task-10 sends are byte-for-byte unchanged.
    const resendAttachments = attachments?.map((a) => ({ filename: a.filename, content: a.content_base64 }))

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
        subject: presentation.subject,
        html,
        text: plainText,
        headers: {
          'List-Unsubscribe': `<${unsubscribeUrl}>`,
          'List-Unsubscribe-Post': 'List-Unsubscribe=One-Click',
        },
        ...(resendAttachments ? { attachments: resendAttachments } : {}),
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

    sendData = await sendResponse.json()
  } catch (e) {
    console.error('Unexpected error rendering or sending email', { error: e, templateName })
    await logFailed(`send error: ${(e as Error).message}`)
    return json({ error: 'Failed to send email' }, 500)
  }

  const { error: sentErr } = await admin.from('email_send_log').update({
    status: 'sent',
    resend_id: sendData.id,
    sent_at: deps.now().toISOString(),
    metadata: { resend_id: sendData.id },
  }).eq('message_id', messageId)
  if (sentErr) {
    // The email was already sent to the recipient — do NOT change the response below.
    // But the row is now stuck at 'pending' with no resend_id, which also means a later
    // Resend webhook can't find this row by resend_id and will create a duplicate fallback row.
    console.error('email_send_log sent-transition failed — row stuck pending, resend_id not persisted', sentErr)
  }

  console.log('Email sent via Resend', {
    templateName,
    recipient_redacted: redactEmail(effectiveRecipient),
    resend_id: sendData.id,
  })

  return json({ success: true, message_id: sendData.id }, 200)
}

if (import.meta.main) Deno.serve((req) => handle(req, realDeps()));
