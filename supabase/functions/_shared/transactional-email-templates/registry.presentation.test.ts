import { assertEquals, assertExists } from '../test-asserts.ts'
import { resolveTemplatePresentation } from './registry.ts'

Deno.test('registry presentation: resolves conditional expiry and confirmation subjects from complete copy', () => {
  const expirySingular = resolveTemplatePresentation('offer-expiry-reminder', {
    offers: [{ referenceLabel: 'One offer' }],
  }, {
    copyOverride: {
      'offer-expiry-reminder.subjectSingular': 'Custom last chance',
      'offer-expiry-reminder.subjectPlural': 'Custom {{count}} last chances',
    },
  })
  const expiryPlural = resolveTemplatePresentation('offer-expiry-reminder', {
    offers: [{ referenceLabel: 'First' }, { referenceLabel: 'Second' }],
  }, {
    copyOverride: {
      'offer-expiry-reminder.subjectSingular': 'Custom last chance',
      'offer-expiry-reminder.subjectPlural': 'Custom {{count}} last chances',
    },
  })
  const confirmationUpdates = resolveTemplatePresentation('artist-confirmation-digest', {
    scheduleChanges: [{ show: 'Riverdance' }],
  }, {
    copyOverride: {
      'artist-confirmation-digest.subjectUpdates': 'Custom booking updates',
      'artist-confirmation-digest.subjectConfirmed': 'Custom bookings confirmed',
    },
  })
  const confirmationConfirmed = resolveTemplatePresentation('artist-confirmation-digest', {
    bookings: [{ show: 'Riverdance' }],
  }, {
    copyOverride: {
      'artist-confirmation-digest.subjectUpdates': 'Custom booking updates',
      'artist-confirmation-digest.subjectConfirmed': 'Custom bookings confirmed',
    },
  })

  assertExists(expirySingular)
  assertExists(expiryPlural)
  assertExists(confirmationUpdates)
  assertExists(confirmationConfirmed)
  assertEquals(expirySingular.subject, 'Custom last chance')
  assertEquals(expiryPlural.subject, 'Custom 2 last chances')
  assertEquals(confirmationUpdates.subject, 'Custom booking updates')
  assertEquals(confirmationConfirmed.subject, 'Custom bookings confirmed')
})

Deno.test('registry presentation: uses compliant default confirmation subjects', () => {
  const updates = resolveTemplatePresentation('artist-confirmation-digest', {
    scheduleChanges: [{ show: 'Riverdance' }],
  })
  const confirmed = resolveTemplatePresentation('artist-confirmation-digest', {
    bookings: [{ show: 'Riverdance' }],
  })

  assertExists(updates)
  assertExists(confirmed)
  assertEquals(updates.subject, 'Your booking updates on ShowFlow')
  assertEquals(confirmed.subject, 'Your bookings are confirmed on ShowFlow')
})

Deno.test('registry presentation: keeps legacy generic subjects only as explicit fallback semantics', () => {
  const expiry = resolveTemplatePresentation('offer-expiry-reminder', { offers: [{}] }, {
    legacySubjectOverride: 'Legacy expiry subject',
  })
  const confirmation = resolveTemplatePresentation('artist-confirmation-digest', {
    bookings: [{ show: 'Riverdance' }],
  }, {
    legacySubjectOverride: 'Legacy confirmation subject',
  })
  const flattenedCopyWins = resolveTemplatePresentation('offer-expiry-reminder', {
    offers: [{}],
  }, {
    copyOverride: { 'offer-expiry-reminder.subjectSingular': 'New copy subject' },
    legacySubjectOverride: 'Legacy expiry subject',
  })

  assertExists(expiry)
  assertExists(confirmation)
  assertExists(flattenedCopyWins)
  assertEquals(expiry.subject, 'Legacy expiry subject')
  assertEquals(confirmation.subject, 'Legacy confirmation subject')
  assertEquals(flattenedCopyWins.subject, 'New copy subject')
})

Deno.test('registry presentation: derives subject tokens for digest and snake_case delivery data', () => {
  const digest = resolveTemplatePresentation('artist-offer-digest', {
    offers: [{}, {}],
  }, {
    copyOverride: {
      'artist-offer-digest.subject': 'Digest: {{count}} {{pendingOffer}}',
      'artist-offer-digest.pendingOfferPlural': 'awaiting decisions',
    },
  })
  const issued = resolveTemplatePresentation('hire-order-issued', {
    date_label: '12 August',
    venue: 'Theatre Royal',
  }, {
    copyOverride: {
      'hire-order-issued.subject': 'Order {{dateLabel}} at {{venue}}',
    },
  })
  const countersigned = resolveTemplatePresentation('hire-order-countersigned', {
    date_label: '13 August',
  }, {
    copyOverride: {
      'hire-order-countersigned.subject': 'Countersigned {{dateLabel}}',
    },
  })
  const cron = resolveTemplatePresentation('cron-health-alert', {
    job_name: 'nightly-digest',
    status_code: 503,
  }, {
    copyOverride: {
      'cron-health-alert.subject': 'Cron {{jobName}} returned {{statusCode}}',
    },
  })

  assertExists(digest)
  assertExists(issued)
  assertExists(countersigned)
  assertExists(cron)
  assertEquals(digest.subject, 'Digest: 2 awaiting decisions')
  assertEquals(issued.subject, 'Order 12 August at Theatre Royal')
  assertEquals(countersigned.subject, 'Countersigned 13 August')
  assertEquals(cron.subject, 'Cron nightly-digest returned 503')
})

Deno.test('registry presentation: airtable-sync-held default subject names the org', () => {
  const presentation = resolveTemplatePresentation('airtable-sync-held', {
    orgName: 'Riverdance Co',
    heldCount: 3,
    settingsUrl: 'https://app.showflow.pro/settings?tab=airtable',
  })

  assertExists(presentation)
  assertEquals(presentation.subject, 'Airtable sync needs attention in Riverdance Co')
})

Deno.test('registry presentation: airtable-sync-held subject falls back when orgName is missing', () => {
  const presentation = resolveTemplatePresentation('airtable-sync-held', {
    heldCount: 1,
    settingsUrl: 'https://app.showflow.pro/settings?tab=airtable',
  })

  assertExists(presentation)
  assertEquals(presentation.subject, 'Airtable sync needs attention in your organization')
})

Deno.test('registry presentation: tier-at-risk default subject names the program and date', () => {
  const presentation = resolveTemplatePresentation('tier-at-risk', {
    program: 'Riverdance',
    date: '2026-06-15',
    tier: 1,
    pending: 1,
    accepted: 1,
    required: 4,
    reviewUrl: 'https://app.showflow.pro/bookings',
  })

  assertExists(presentation)
  assertEquals(presentation.subject, 'A tier is running short for Riverdance on 2026-06-15')
})

Deno.test('registry presentation: tier-at-risk subject resolves an org copy override', () => {
  const presentation = resolveTemplatePresentation('tier-at-risk', {
    program: 'Riverdance',
    date: '2026-06-15',
  }, {
    copyOverride: {
      'tier-at-risk.subject': 'Custom short tier for {{program}} on {{date}}',
    },
  })

  assertExists(presentation)
  assertEquals(presentation.subject, 'Custom short tier for Riverdance on 2026-06-15')
})
