/// <reference types="npm:@types/react@18.3.1" />
import * as React from 'npm:react@18.3.1'
import {
  applyEmailTokens,
  resolveEmailCopy,
  type EmailCopy,
  type EmailCopyOverride,
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

function subjectOverride(templateName: string, copyOverride: unknown, data: TemplateData): string | undefined {
  if (!isRecord(copyOverride)) return undefined
  const value = copyOverride[`${templateName}.subject`]
  if (typeof value !== 'string' || value.trim() === '') return undefined
  const tokens: Record<string, string | number> = {}
  for (const [key, candidate] of Object.entries(data)) {
    if (typeof candidate === 'string' || typeof candidate === 'number') tokens[key] = candidate
  }
  return applyEmailTokens(value.trim(), tokens)
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

  return {
    subject: subjectOverride(templateName, options.copyOverride, data) ?? defaultSubject,
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
