import { json } from "../_shared/http.ts";
import { constantTimeEqual } from "../_shared/auth.ts";
import { realDeps, type Deps } from "../_shared/deps.ts";
import { redactEmail } from "../_shared/identity.ts";

// Resend uses Standard Webhooks (https://www.standardwebhooks.com/)
// The signing secret is base64-encoded; verification uses HMAC-SHA256.
async function verifyResendWebhook(
  req: Request,
  rawBody: string,
  secret: string,
  nowMs: number
): Promise<void> {
  const webhookId = req.headers.get('webhook-id')
  const webhookTimestamp = req.headers.get('webhook-timestamp')
  const webhookSignature = req.headers.get('webhook-signature')

  if (!webhookId || !webhookTimestamp || !webhookSignature) {
    throw Object.assign(new Error('Missing webhook signature headers'), { code: 'missing_headers' })
  }

  const ts = parseInt(webhookTimestamp, 10)
  if (isNaN(ts) || Math.abs(Math.floor(nowMs / 1000) - ts) > 300) {
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
    // Constant-time compare so a forged signature can't be recovered via a timing attack.
    return version === 'v1' && sig !== undefined && constantTimeEqual(sig, computed)
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

type LogStatus = 'sent' | 'delivered' | 'delivery_delayed' | 'bounced' | 'complained'
const EVENT_TO_STATUS: Record<string, LogStatus> = {
  'email.sent': 'sent',
  'email.delivered': 'delivered',
  'email.delivery_delayed': 'delivery_delayed',
  'email.bounced': 'bounced',
  'email.complained': 'complained',
}
const STATUS_TO_STAMP: Record<LogStatus, string> = {
  sent: 'sent_at', delivered: 'delivered_at', delivery_delayed: 'delayed_at',
  bounced: 'bounced_at', complained: 'complained_at',
}
/**
 * Lifecycle rank, low → high. Resend delivers webhook events out of order, so the update
 * below only ever advances a row to a STRICTLY higher rank — it converges on the
 * highest-rank event seen regardless of arrival order, instead of letting a late
 * `email.sent`/`email.delivery_delayed` regress a row that already reached `delivered`/
 * `bounced`/`complained` (which would silently drop it from the delivered count).
 */
const STATUS_RANK: Record<LogStatus, number> = {
  sent: 1,
  delivery_delayed: 2,
  delivered: 3,
  bounced: 4,
  complained: 5,
}
/** Resend event type → email_send_log status (null = ignore, e.g. email.opened/email.clicked). */
export function mapEventToLogStatus(eventType: string): LogStatus | null {
  return EVENT_TO_STATUS[eventType] ?? null
}

function mapReasonToMessage(reason: string): string {
  if (reason === 'bounce') return 'Permanent bounce — email address is invalid or rejected'
  if (reason === 'complaint') return 'Spam complaint — recipient marked email as spam'
  return 'Email suppressed'
}

export async function handle(req: Request, deps: Deps): Promise<Response> {
  if (req.method !== 'POST') {
    return json({ error: 'Method not allowed' }, 405)
  }

  const webhookSecret = deps.env('RESEND_WEBHOOK_SECRET')
  const supabaseUrl = deps.env('SUPABASE_URL')
  const supabaseServiceKey = deps.env('SUPABASE_SERVICE_ROLE_KEY')

  if (!webhookSecret || !supabaseUrl || !supabaseServiceKey) {
    console.error('Missing required environment variables')
    return json({ error: 'Server configuration error' }, 500)
  }

  const rawBody = await req.text()

  try {
    await verifyResendWebhook(req, rawBody, webhookSecret, deps.now().getTime())
  } catch (err: any) {
    const code = err.code ?? 'verification_failed'
    if (code === 'missing_headers' || code === 'invalid_signature') {
      console.error('Webhook verification failed', { code, message: err.message })
      return json({ error: 'Invalid signature' }, 401)
    }
    if (code === 'stale_timestamp') {
      console.error('Stale webhook timestamp')
      return json({ error: 'Stale timestamp' }, 401)
    }
    console.error('Unexpected error during webhook verification', { error: err })
    return json({ error: 'Internal error' }, 500)
  }

  let payload: ResendWebhookPayload
  try {
    payload = JSON.parse(rawBody)
  } catch {
    return json({ error: 'Invalid JSON payload' }, 400)
  }

  const logStatus = mapEventToLogStatus(payload.type)
  if (!logStatus) {
    // Not a lifecycle event we track — acknowledge and ignore (e.g. email.opened / email.clicked)
    return json({ success: true, ignored: true })
  }

  // Resend delivers the recipient in data.to[0]
  const recipientEmail = payload.data?.to?.[0]?.toLowerCase()
  if (!recipientEmail) {
    console.error('Missing recipient in Resend webhook payload', { type: payload.type })
    return json({ error: 'Missing recipient' }, 400)
  }

  const admin = deps.admin;
  const resendId = payload.data?.email_id ?? null

  // Bounce/complaint → suppress the address (unchanged behavior).
  const reason = mapEventToReason(payload.type)
  if (reason) {
    const { error: suppressError } = await admin
      .from('suppressed_emails')
      .upsert(
        { email: recipientEmail, reason, metadata: { resend_email_id: resendId } },
        { onConflict: 'email' }
      )

    if (suppressError) {
      console.error('Failed to upsert suppressed email', {
        error: suppressError,
        email_redacted: redactEmail(recipientEmail),
      })
      return json({ error: 'Failed to write suppression' }, 500)
    }
  }

  // Update the send row by resend_id; insert a fallback row if the event beat the
  // send-row write or the row was pruned, so deliverability counts stay accurate.
  const patch: Record<string, unknown> = {
    status: logStatus,
    [STATUS_TO_STAMP[logStatus]]: deps.now().toISOString(),
  }
  if (reason) patch.error_message = mapReasonToMessage(reason)

  if (resendId) {
    // Only advance the row when its CURRENT status is strictly lower rank than the
    // incoming event — this is what makes the update order-independent. Block every
    // status at or above the incoming rank (the incoming status itself, to make repeat
    // deliveries of the same event a no-op, plus every higher-rank status).
    const blockedStatuses = (Object.keys(STATUS_RANK) as LogStatus[]).filter(
      (s) => STATUS_RANK[s] >= STATUS_RANK[logStatus]
    )
    const blockedList = `(${blockedStatuses.map((s) => `"${s}"`).join(',')})`

    const { data: updated, error: updateError } = await admin
      .from('email_send_log')
      .update(patch)
      .eq('resend_id', resendId)
      .not('status', 'in', blockedList)
      .select('id')

    if (updateError) {
      console.warn('Failed to update email_send_log', { error: updateError })
    } else if (!updated || (updated as unknown[]).length === 0) {
      // 0 rows matched — either no row exists yet for this resend_id (genuinely missing,
      // e.g. the event beat the send-row write or the row was pruned) or a row exists but
      // the monotonic-rank guard blocked it (a regression/duplicate event arriving out of
      // order). Only the former should insert a fallback row; the latter must be a no-op
      // so we don't clobber the row's already-higher-or-equal-rank status with a fallback.
      const { data: existing, error: existsError } = await admin
        .from('email_send_log')
        .select('id')
        .eq('resend_id', resendId)
        .maybeSingle()

      if (existsError) {
        console.warn('Failed to check existing email_send_log row', { error: existsError })
      } else if (!existing) {
        const { error: insertError } = await admin.from('email_send_log').insert({
          message_id: crypto.randomUUID(),
          resend_id: resendId,
          template_name: 'system',
          recipient_email: recipientEmail,
          ...patch,
        })

        if (insertError) {
          console.warn('Failed to insert fallback email_send_log row', { error: insertError })
        }
      }
      // else: row exists but was blocked by the monotonic guard — skip silently.
    }
  }

  console.log('Deliverability event processed', {
    email_redacted: redactEmail(recipientEmail),
    event_type: payload.type,
    log_status: logStatus,
  })

  return json({ success: true })
}

if (import.meta.main) Deno.serve((req) => handle(req, realDeps()));
