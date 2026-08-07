/// <reference types="npm:@types/react@18.3.1" />
import * as React from 'npm:react@18.3.1'
import {
  applyEmailTokens,
  resolveEmailCopy,
  type EmailCopy,
  type EmailCopyOverride,
  type EmailTemplateKey,
} from './_shell/emailCopy.ts'
import {
  resolveEmailTheme,
  type EmailFamily,
  type EmailRoleKey,
  type EmailTheme,
  type EmailThemeOverride,
} from './_shell/emailTheme.ts'

export type TemplateData = Record<string, unknown>

export interface TemplateEntry {
  component: React.ComponentType<TemplateData>
  subject: string | ((data: TemplateData) => string)
  family?: EmailFamily
  to?: string
  displayName?: string
  previewData?: TemplateData
}

import { template as castEscalationRequested } from './cast-escalation-requested.tsx'
import { template as artistOfferDigest } from './artist-offer-digest.tsx'
import { template as offerImmediate } from './offer-immediate.tsx'
import { template as artistConfirmationDigest } from './artist-confirmation-digest.tsx'
import { template as orgInvitation } from './org-invitation.tsx'
import { template as cronHealthAlert } from './cron-health-alert.tsx'
import { template as offerExpiryReminder } from './offer-expiry-reminder.tsx'
import { template as hireOrderIssued } from './hire-order-issued.tsx'
import { template as hireOrderCountersigned } from './hire-order-countersigned.tsx'
import { template as accountEmailChanged } from './account-email-changed.tsx'

type RegisteredTemplateEntry = TemplateEntry & { family: EmailFamily }

export const TEMPLATES: Record<string, RegisteredTemplateEntry> = {
  'cast-escalation-requested': { ...castEscalationRequested, family: 'ember' },
  'artist-offer-digest': { ...artistOfferDigest, family: 'violet' },
  'offer-immediate': { ...offerImmediate, family: 'violet' },
  'artist-confirmation-digest': { ...artistConfirmationDigest, family: 'violet' },
  'org-invitation': { ...orgInvitation, family: 'violet' },
  'cron-health-alert': { ...cronHealthAlert, family: 'steel' },
  'offer-expiry-reminder': { ...offerExpiryReminder, family: 'violet' },
  'hire-order-issued': { ...hireOrderIssued, family: 'pine' },
  'hire-order-countersigned': { ...hireOrderCountersigned, family: 'steel' },
  'account-email-changed': { ...accountEmailChanged, family: 'steel' },
}

export interface TemplatePresentation {
  subject: string
  props: TemplateData
  copy: EmailCopy
  theme: EmailTheme
  family: EmailFamily
  highlightRole?: EmailRoleKey
}

export interface TemplatePresentationOptions {
  copyOverride?: EmailCopyOverride | string | null
  /** Whether copyOverride came from the flattened setting rather than legacy mapping. */
  copyIsExplicit?: boolean
  /** One-release compatibility input for legacy email_template_overrides.subject. */
  legacySubjectOverride?: unknown
  themeOverride?: EmailThemeOverride | string | null
  highlightRole?: unknown
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function isEmailRoleKey(value: unknown): value is EmailRoleKey {
  return value === 'header' || value === 'heading' || value === 'subheading' ||
    value === 'body' || value === 'dataLabel' || value === 'dataValue' ||
    value === 'button' || value === 'footer'
}

function offerCount(data: TemplateData): number {
  return Array.isArray(data.offers) ? data.offers.length : 0
}

function hasConfirmationUpdates(data: TemplateData): boolean {
  return (Array.isArray(data.scheduleChanges) && data.scheduleChanges.length > 0) ||
    (Array.isArray(data.cancellations) && data.cancellations.length > 0)
}

type SubjectResolver = (data: TemplateData, copy: EmailCopy) => string

const SUBJECT_RESOLVERS = {
  'offer-immediate': (data, copy) => applyEmailTokens(copy['offer-immediate.subject'], {
    referenceLabel: String(data.referenceLabel),
    date: String(data.date),
  }),
  'artist-offer-digest': (data, copy) => {
    const count = offerCount(data)
    const pendingOffer = count === 1
      ? copy['artist-offer-digest.pendingOfferSingular']
      : copy['artist-offer-digest.pendingOfferPlural']
    return applyEmailTokens(copy['artist-offer-digest.subject'], { count, pendingOffer })
  },
  'offer-expiry-reminder': (data, copy) => {
    const count = offerCount(data)
    return count === 1
      ? copy['offer-expiry-reminder.subjectSingular']
      : applyEmailTokens(copy['offer-expiry-reminder.subjectPlural'], { count })
  },
  'artist-confirmation-digest': (data, copy) => hasConfirmationUpdates(data)
    ? copy['artist-confirmation-digest.subjectUpdates']
    : copy['artist-confirmation-digest.subjectConfirmed'],
  'cast-escalation-requested': (data, copy) => applyEmailTokens(copy['cast-escalation-requested.subject'], {
    tier: String(data.tier ?? '?'),
    program: String(data.program ?? 'show'),
    date: String(data.date ?? '?'),
  }),
  'hire-order-issued': (data, copy) => applyEmailTokens(copy['hire-order-issued.subject'], {
    dateLabel: String(data.date_label || 'your date'),
    venue: String(data.venue || 'the venue'),
  }),
  'hire-order-countersigned': (data, copy) => applyEmailTokens(copy['hire-order-countersigned.subject'], {
    dateLabel: String(data.date_label || 'your date'),
  }),
  'org-invitation': (data, copy) => applyEmailTokens(copy['org-invitation.subject'], {
    orgName: String(data.orgName || 'an organization'),
  }),
  'account-email-changed': (_data, copy) => copy['account-email-changed.subject'],
  'cron-health-alert': (data, copy) => applyEmailTokens(copy['cron-health-alert.subject'], {
    jobName: String(data.job_name ?? 'a job'),
    statusCode: String(data.status_code ?? '?'),
  }),
} satisfies Record<EmailTemplateKey, SubjectResolver>

/** Extract the historical generic subject field without extending its lifetime. */
export function legacyTemplateSubjectOverride(overrides: unknown, templateName: string): unknown {
  if (!isRecord(overrides)) return undefined
  const templateOverride = overrides[templateName]
  return isRecord(templateOverride) ? templateOverride.subject : undefined
}

function resolvedSubject(templateName: string, data: TemplateData, copy: EmailCopy, fallback: string): string {
  const resolver = SUBJECT_RESOLVERS[templateName as EmailTemplateKey]
  return resolver ? resolver(data, copy) : fallback
}

function legacySubject(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() !== '' ? value.trim() : undefined
}

/**
 * The sole bridge from registry metadata and editable presentation settings to
 * component props and subject. Both delivery and preview use this path so the
 * editor always renders what the mail pipeline sends.
 */
export function resolveTemplatePresentation(
  templateName: string,
  data: TemplateData,
  options: TemplatePresentationOptions = {},
): TemplatePresentation | null {
  const template = TEMPLATES[templateName]
  if (!template) return null

  const copy = resolveEmailCopy(options.copyOverride)
  const theme = resolveEmailTheme(options.themeOverride)
  const defaultSubject = typeof template.subject === 'function'
    ? template.subject(data)
    : template.subject

  // A supplied flattened copy map is always the authoritative new model, including
  // an intentional empty map. Generic legacy subjects only apply when the caller
  // explicitly selected the one-release compatibility path.
  const copyIsExplicit = options.copyIsExplicit ??
    (options.copyOverride !== undefined && options.copyOverride !== null)
  const subject = resolvedSubject(templateName, data, copy, defaultSubject)

  return {
    subject: copyIsExplicit ? subject : legacySubject(options.legacySubjectOverride) ?? subject,
    props: {
      ...data,
      _emailCopy: copy,
      _emailTheme: theme,
      _emailFamily: template.family,
      ...(isEmailRoleKey(options.highlightRole) ? { _highlightRole: options.highlightRole } : {}),
    },
    copy,
    theme,
    family: template.family,
    ...(isEmailRoleKey(options.highlightRole) ? { highlightRole: options.highlightRole } : {}),
  }
}
