import * as React from 'npm:react@18.3.1'
import { renderAsync } from 'npm:@react-email/components@0.0.22'
import { createClient } from 'npm:@supabase/supabase-js@2'
import { TEMPLATES } from '../_shared/transactional-email-templates/registry.ts'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, content-type',
}

// Renders registered templates with optional per-template overrides.
// Auth: Supabase JWT — admin or producer role required.

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders })
  }

  const supabaseUrl = Deno.env.get('SUPABASE_URL')
  const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')

  if (!supabaseUrl || !supabaseServiceKey) {
    return new Response(
      JSON.stringify({ error: 'Server configuration error' }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )
  }

  // Verify JWT — admin or producer
  const authHeader = req.headers.get('Authorization')
  if (!authHeader) {
    return new Response(JSON.stringify({ error: 'Unauthorized' }), {
      status: 401,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  }

  const userClient = createClient(supabaseUrl, Deno.env.get('SUPABASE_ANON_KEY') ?? '', {
    global: { headers: { Authorization: authHeader } },
  })

  const { data: { user }, error: authError } = await userClient.auth.getUser()
  if (authError || !user) {
    return new Response(JSON.stringify({ error: 'Unauthorized' }), {
      status: 401,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  }

  const admin = createClient(supabaseUrl, supabaseServiceKey)
  const { data: roleRows } = await admin
    .from('user_roles')
    .select('role')
    .eq('user_id', user.id)
    .in('role', ['admin', 'producer'])

  if (!roleRows || roleRows.length === 0) {
    return new Response(JSON.stringify({ error: 'Forbidden' }), {
      status: 403,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  }

  // Parse body
  let templateName: string | undefined
  let overrides: Record<string, any> = {}
  try {
    if (req.method === 'POST') {
      const body = await req.json().catch(() => ({}))
      templateName = body.templateName || undefined
      if (body.overrides && typeof body.overrides === 'object') {
        overrides = body.overrides
      }
    }
  } catch {
    // ignore
  }

  const templateNames = templateName ? [templateName] : Object.keys(TEMPLATES)
  const results: Array<{
    templateName: string
    displayName: string
    subject: string
    html: string
    status: 'ready' | 'preview_data_required' | 'render_failed'
    errorMessage?: string
  }> = []

  for (const name of templateNames) {
    const entry = TEMPLATES[name]
    if (!entry) {
      results.push({
        templateName: name,
        displayName: name,
        subject: '',
        html: '',
        status: 'render_failed',
        errorMessage: `Template '${name}' not found`,
      })
      continue
    }

    const displayName = entry.displayName || name

    if (!entry.previewData) {
      results.push({
        templateName: name,
        displayName,
        subject: '',
        html: '',
        status: 'preview_data_required',
      })
      continue
    }

    try {
      // Merge overrides into previewData
      const previewData = { ...entry.previewData }
      if (overrides.intro) previewData._intro = overrides.intro
      if (overrides.cta_label) previewData._cta_label = overrides.cta_label
      if (overrides.footer) previewData._footer = overrides.footer

      const html = await renderAsync(
        React.createElement(entry.component, previewData)
      )

      let resolvedSubject = typeof entry.subject === 'function'
        ? entry.subject(previewData)
        : entry.subject
      if (overrides.subject && typeof overrides.subject === 'string' && overrides.subject.trim()) {
        resolvedSubject = overrides.subject.trim()
      }

      results.push({
        templateName: name,
        displayName,
        subject: resolvedSubject,
        html,
        status: 'ready',
      })
    } catch (err) {
      console.error('Failed to render template for preview', {
        template: name,
        error: err,
      })
      results.push({
        templateName: name,
        displayName,
        subject: '',
        html: '',
        status: 'render_failed',
        errorMessage: err instanceof Error ? err.message : String(err),
      })
    }
  }

  return new Response(JSON.stringify({ templates: results }), {
    status: 200,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  })
})
