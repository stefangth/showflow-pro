import * as React from 'npm:react@18.3.1'
import { renderAsync } from 'npm:@react-email/components@0.0.22'
import { TEMPLATES, type TemplateData } from '../_shared/transactional-email-templates/registry.ts'
import { preflight, json } from "../_shared/http.ts";
import { requireRole } from "../_shared/auth.ts";
import { realDeps, type Deps } from "../_shared/deps.ts";

// Renders registered templates with optional per-template overrides.
// Auth: Supabase JWT — admin or producer role required.

export async function handle(req: Request, deps: Deps): Promise<Response> {
  if (req.method === 'OPTIONS') return preflight();

  const auth = await requireRole(deps, req, ["admin", "producer"]);
  if (!auth.ok) return auth.response;

  // Parse body
  let templateName: string | undefined
  let overrides: TemplateData = {}
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

  return json({ templates: results })
}

if (import.meta.main) Deno.serve((req) => handle(req, realDeps()));
