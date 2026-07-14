/// <reference types="npm:@types/react@18.3.1" />
import * as React from 'npm:react@18.3.1'

export interface TemplateEntry {
  component: React.ComponentType<any>
  subject: string | ((data: Record<string, any>) => string)
  to?: string
  displayName?: string
  previewData?: Record<string, any>
}

import { template as newSignupAdminNotification } from './new-signup-admin-notification.tsx'
import { template as signupDecision } from './signup-decision.tsx'
import { template as castEscalationRequested } from './cast-escalation-requested.tsx'
import { template as artistOfferDigest } from './artist-offer-digest.tsx'
import { template as offerImmediate } from './offer-immediate.tsx'
import { template as artistConfirmationDigest } from './artist-confirmation-digest.tsx'
import { template as orgInvitation } from './org-invitation.tsx'
import { template as cronHealthAlert } from './cron-health-alert.tsx'
import { template as offerExpiryReminder } from './offer-expiry-reminder.tsx'

export const TEMPLATES: Record<string, TemplateEntry> = {
  'new-signup-admin-notification': newSignupAdminNotification,
  'signup-decision': signupDecision,
  'cast-escalation-requested': castEscalationRequested,
  'artist-offer-digest': artistOfferDigest,
  'offer-immediate': offerImmediate,
  'artist-confirmation-digest': artistConfirmationDigest,
  'org-invitation': orgInvitation,
  'cron-health-alert': cronHealthAlert,
  'offer-expiry-reminder': offerExpiryReminder,
}
