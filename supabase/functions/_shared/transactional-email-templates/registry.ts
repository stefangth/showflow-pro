/// <reference types="npm:@types/react@18.3.1" />
import * as React from 'npm:react@18.3.1'
import type { EmailFamily } from './_shell/emailTheme.ts'

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
