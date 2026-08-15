import * as React from 'npm:react@18.3.1'
import { renderAsync } from 'npm:@react-email/components@0.0.22'
import { legacyTemplateSubjectOverride, resolveTemplatePresentation, TEMPLATES, type TemplateData } from '../_shared/transactional-email-templates/registry.ts'
import { legacyEmailOverridesToCopy, type EmailCopyOverride } from '../_shared/transactional-email-templates/_shell/emailCopy.ts'
import type { EmailThemeOverride } from '../_shared/transactional-email-templates/_shell/emailTheme.ts'
import { preflight, json } from "../_shared/http.ts";
import { requireRole } from "../_shared/auth.ts";
import { realDeps, type Deps } from "../_shared/deps.ts";
import { coerceLocale, type ServerLocale } from "../_shared/orgLocale.ts";

// Renders registered templates with optional per-template overrides.
// Auth: Supabase JWT — admin or producer role required.

export async function handle(req: Request, deps: Deps): Promise<Response> {
  if (req.method === 'OPTIONS') return preflight();

  const auth = await requireRole(deps, req, ["admin", "producer"]);
  if (!auth.ok) return auth.response;

  // Parse body
  let templateName: string | undefined
  let overrides: TemplateData = {}
  let copyOverride: EmailCopyOverride = {}
  let hasCopyOverride = false
  let themeOverride: EmailThemeOverride = {}
  let highlightRole: unknown
  // Preview language. Explicit and NOT entitlement-gated: this is admin QA, so an
  // admin can preview either language regardless of the org's own setting.
  let locale: ServerLocale = "en"
  // Sample-data override for the requested template. A template that renders one of
  // several variants off its data (org-invitation's four role action lines) is
  // otherwise only previewable in whichever variant its previewData hardcodes.
  let dataOverride: TemplateData = {}
  try {
    if (req.method === 'POST') {
      const body = await req.json().catch(() => ({}))
      templateName = body.templateName || undefined
      if (body.overrides && typeof body.overrides === 'object') {
        overrides = body.overrides
      }
      if (body.copyOverride && typeof body.copyOverride === 'object') {
        copyOverride = body.copyOverride as EmailCopyOverride
        hasCopyOverride = true
      }
      if (body.themeOverride && typeof body.themeOverride === 'object') {
        themeOverride = body.themeOverride as EmailThemeOverride
      }
      highlightRole = body.highlightRole
      locale = coerceLocale(body.locale)
      if (body.dataOverride && typeof body.dataOverride === 'object' && !Array.isArray(body.dataOverride)) {
        dataOverride = body.dataOverride as TemplateData
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
      // `overrides` is the legacy preview payload. Keep it compatible while
      // making the documented flattened copyOverride win on any collision.
      const legacyCopy = legacyEmailOverridesToCopy({ [name]: overrides })
      // Only the explicitly requested template gets the data override: in list mode
      // (no templateName) every template renders its own registered sample data.
      const previewData = name === templateName
        ? { ...entry.previewData, ...dataOverride }
        : entry.previewData
      const presentation = resolveTemplatePresentation(name, previewData, {
        copyOverride: hasCopyOverride ? copyOverride : legacyCopy,
        copyIsExplicit: hasCopyOverride,
        legacySubjectOverride: hasCopyOverride
          ? undefined
          : legacyTemplateSubjectOverride({ [name]: overrides }, name),
        themeOverride,
        highlightRole,
        locale,
      })
      if (!presentation) throw new Error(`Template '${name}' not found during presentation resolution`)

      const html = await renderAsync(
        React.createElement(entry.component, presentation.props)
      )

      results.push({
        templateName: name,
        displayName,
        subject: presentation.subject,
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
