import { preflight, json } from "../_shared/http.ts";
import { realDeps, type Deps } from "../_shared/deps.ts";

export async function handle(req: Request, deps: Deps): Promise<Response> {
  // Handle CORS preflight
  if (req.method === 'OPTIONS') return preflight();

  if (req.method !== 'GET' && req.method !== 'POST') {
    return json({ error: 'Method not allowed' }, 405)
  }

  const supabaseUrl = deps.env('SUPABASE_URL')
  const supabaseServiceKey = deps.env('SUPABASE_SERVICE_ROLE_KEY')

  if (!supabaseUrl || !supabaseServiceKey) {
    return json({ error: 'Server configuration error' }, 500)
  }

  const admin = deps.admin;

  // Extract token from query params (GET) or body (POST)
  const url = new URL(req.url)
  let token: string | null = url.searchParams.get('token')

  if (req.method === 'POST') {
    // Detect RFC 8058 one-click unsubscribe: POST with form-encoded body
    // containing "List-Unsubscribe=One-Click". Email clients (Gmail, Apple Mail,
    // etc.) send this when the user clicks "Unsubscribe" in the mail UI.
    const contentType = req.headers.get('content-type') ?? ''
    if (contentType.includes('application/x-www-form-urlencoded')) {
      const formText = await req.text()
      const params = new URLSearchParams(formText)
      // For one-click, token comes from query param (already set above).
      // Otherwise, token may be in the form body.
      if (!params.get('List-Unsubscribe')) {
        const formToken = params.get('token')
        if (formToken) {
          token = formToken
        }
      }
    } else {
      // JSON body (from the app's unsubscribe page)
      try {
        const body = await req.json()
        if (body.token) {
          token = body.token
        }
      } catch {
        // Fall through — token stays from query param
      }
    }
  }

  if (!token) {
    return json({ error: 'Token is required' }, 400)
  }

  // Look up the token
  const { data: tokenRecord, error: lookupError } = await admin
    .from('email_unsubscribe_tokens')
    .select('*')
    .eq('token', token)
    .maybeSingle()

  if (lookupError || !tokenRecord) {
    return json({ error: 'Invalid or expired token' }, 404)
  }

  // GET: Validate token (the app's unsubscribe page calls this on load)
  if (req.method === 'GET') {
    if (tokenRecord.used_at) {
      return json({ valid: false, reason: 'already_unsubscribed' })
    }
    return json({ valid: true })
  }

  // POST: already-used pre-check (avoids the atomic update round-trip for the common case)
  if (tokenRecord.used_at) {
    return json({ success: false, reason: 'already_unsubscribed' })
  }

  // POST: Process the unsubscribe
  // Atomic check-and-update to avoid TOCTOU race
  const { data: updated, error: updateError } = await admin
    .from('email_unsubscribe_tokens')
    .update({ used_at: deps.now().toISOString() })
    .eq('token', token)
    .is('used_at', null)
    .select()
    .maybeSingle()

  if (updateError) {
    console.error('Failed to mark token as used', { error: updateError, token })
    return json({ error: 'Failed to process unsubscribe' }, 500)
  }

  if (!updated) {
    return json({ success: false, reason: 'already_unsubscribed' })
  }

  // Add email to suppressed list (upsert to handle duplicates)
  const { error: suppressError } = await admin
    .from('suppressed_emails')
    .upsert(
      { email: tokenRecord.email.toLowerCase(), reason: 'unsubscribe' },
      { onConflict: 'email' },
    )

  if (suppressError) {
    console.error('Failed to suppress email', {
      error: suppressError,
      email: tokenRecord.email,
    })
    return json({ error: 'Failed to process unsubscribe' }, 500)
  }

  console.log('Email unsubscribed', { email: tokenRecord.email })

  return json({ success: true })
}

if (import.meta.main) Deno.serve((req) => handle(req, realDeps()));
