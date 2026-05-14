import { createClient } from 'npm:@supabase/supabase-js@2'

// Resend uses Standard Webhooks (https://www.standardwebhooks.com/)
// The signing secret is base64-encoded; verification uses HMAC-SHA256.
async function verifyResendWebhook(
  req: Request,
  rawBody: string,
  secret: string
): Promise<void> {
  const webhookId = req.headers.get('webhook-id')
  const webhookTimestamp = req.headers.get('webhook-timestamp')
  const webhookSignature = req.headers.get('webhook-signature')

  if (!webhookId || !webhookTimestamp || !webhookSignature) {
    throw Object.assign(new Error('Missing webhook signature headers'), { code: 'missing_headers' })
  }

  const ts = parseInt(webhookTimestamp, 10)
  if (isNaN(ts) || Math.abs(Math.floor(Date.now() / 1000) - ts) > 300) {
    throw Object.assign(new Error('Stale webhook timestamp'), { code: 'stale_timestamp' })
  }

  const toSign = `${webhookId}.${webhookTimestamp}.${rawBody}`
  const secretBytes = Uint8Array.from(atob(secret), (c) => c.charCodeAt(0))

  const key = await crypto.subtle.importKey(
    'raw',
    secretBytes,
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign']
  )
  const sigBytes = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(toSign))
  const computed = btoa(String.fromCharCode(...new Uint8Array(sigBytes)))

  const isValid = webhookSignature.split(' ').some((part) => {
    const [version, sig] = part.split(',')
    return version === 'v1' && sig === computed
  })

  if (!isValid) {
    throw Object.assign(new Error('Invalid webhook signature'), { code: 'invalid_signature' })
  }
}

interface ResendWebhookPayload {
  type: string
  created_at: string
  data: {
    email_id?: string
    to?: string[]
    from?: string
    subject?: string
  }
}

function mapEventToReason(eventType: string): 'bounce' | 'complaint' | null {
  if (eventType === 'email.bounced') return 'bounce'
  if (eventType === 'email.complained') return 'complaint'
  return null
}

function jsonResponse(data: Record<string, unknown>, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })
}

function mapReasonToStatus(reason: string): 'bounced' | 'complained' | 'suppressed' {
  if (reason === 'bounce') return 'bounced'
  if (reason === 'complaint') return 'complained'
  return 'suppressed'
}

function mapReasonToMessage(reason: string): string {
  if (reason === 'bounce') return 'Permanent bounce — email address is invalid or rejected'
  if (reason === 'complaint') return 'Spam complaint — recipient marked email as spam'
  return 'Email suppressed'
}

Deno.serve(async (req) => {
  if (req.method !== 'POST') {
    return jsonResponse({ error: 'Method not allowed' }, 405)
  }

  const webhookSecret = Deno.env.get('RESEND_WEBHOOK_SECRET')
  const supabaseUrl = Deno.env.get('SUPABASE_URL')
  const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')

  if (!webhookSecret || !supabaseUrl || !supabaseServiceKey) {
    console.error('Missing required environment variables')
    return jsonResponse({ error: 'Server configuration error' }, 500)
  }

  const rawBody = await req.text()

  try {
    await verifyResendWebhook(req, rawBody, webhookSecret)
  } catch (err: any) {
    const code = err.code ?? 'verification_failed'
    if (code === 'missing_headers' || code === 'invalid_signature') {
      console.error('Webhook verification failed', { code, message: err.message })
      return jsonResponse({ error: 'Invalid signature' }, 401)
    }
    if (code === 'stale_timestamp') {
      console.error('Stale webhook timestamp')
      return jsonResponse({ error: 'Stale timestamp' }, 401)
    }
    console.error('Unexpected error during webhook verification', { error: err })
    return jsonResponse({ error: 'Internal error' }, 500)
  }

  let payload: ResendWebhookPayload
  try {
    payload = JSON.parse(rawBody)
  } catch {
    return jsonResponse({ error: 'Invalid JSON payload' }, 400)
  }

  const reason = mapEventToReason(payload.type)
  if (!reason) {
    // Not a suppression event — acknowledge and ignore
    return jsonResponse({ success: true, ignored: true })
  }

  // Resend delivers the recipient in data.to[0]
  const recipientEmail = payload.data?.to?.[0]
  if (!recipientEmail) {
    console.error('Missing recipient in Resend webhook payload', { type: payload.type })
    return jsonResponse({ error: 'Missing recipient' }, 400)
  }

  const supabase = createClient(supabaseUrl, supabaseServiceKey)
  const normalizedEmail = recipientEmail.toLowerCase()

  const { error: suppressError } = await supabase
    .from('suppressed_emails')
    .upsert(
      { email: normalizedEmail, reason, metadata: { resend_email_id: payload.data?.email_id } },
      { onConflict: 'email' }
    )

  if (suppressError) {
    console.error('Failed to upsert suppressed email', {
      error: suppressError,
      email_redacted: normalizedEmail[0] + '***@' + normalizedEmail.split('@')[1],
    })
    return jsonResponse({ error: 'Failed to write suppression' }, 500)
  }

  const { error: insertError } = await supabase.from('email_send_log').insert({
    message_id: payload.data?.email_id ?? null,
    template_name: 'system',
    recipient_email: normalizedEmail,
    status: mapReasonToStatus(reason),
    error_message: mapReasonToMessage(reason),
  })

  if (insertError) {
    console.warn('Failed to insert email_send_log', { error: insertError })
  }

  console.log('Suppression processed', {
    email_redacted: normalizedEmail[0] + '***@' + normalizedEmail.split('@')[1],
    reason,
    event_type: payload.type,
  })

  return jsonResponse({ success: true })
})
