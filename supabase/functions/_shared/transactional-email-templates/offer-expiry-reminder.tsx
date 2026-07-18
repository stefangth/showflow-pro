/// <reference types="npm:@types/react@18.3.1" />
import * as React from 'npm:react@18.3.1'
import {
  Body,
  Button,
  Container,
  Head,
  Heading,
  Html,
  Preview,
  Section,
  Text,
} from 'npm:@react-email/components@0.0.22'
import type { TemplateEntry, TemplateData } from './registry.ts'
import { APP_URL } from '../app-url.ts'

const SITE_NAME = 'ShowFlow'
const AVAILABILITY_URL = `${APP_URL}/availability`

interface OfferRow {
  referenceLabel: string
  date: string
  expiresAt: string
}

interface Props {
  displayName?: string
  offers?: OfferRow[]
  _intro?: string
  _cta_label?: string
  _footer?: string
}

const OfferExpiryReminder = ({ displayName, offers = [], _intro, _cta_label, _footer }: Props) => {
  const n = offers.length
  const heading = n === 1 ? 'Your offer expires soon' : `${n} offers expire soon`
  const introText = _intro ||
    `You have ${n === 1 ? 'an offer' : `${n} offers`} expiring within the next 24 hours. Respond soon to keep the booking.`
  const ctaLabel = _cta_label || (n === 1 ? 'Respond to this offer' : 'Respond to your offers')
  const footerText = _footer || `The ${SITE_NAME} team`

  return (
    <Html lang="en" dir="ltr">
      <Head />
      <Preview>
        {n === 1 ? `Reminder: your offer expires soon on ${SITE_NAME}` : `Reminder: ${n} offers expire soon on ${SITE_NAME}`}
      </Preview>
      <Body style={main}>
        <Container style={container}>
          <Heading style={h1}>{heading}</Heading>
          <Text style={text}>{displayName ? `Hi ${displayName},` : 'Hi,'}</Text>
          <Text style={text}>{introText}</Text>

          {offers.length > 0 && (
            <Section style={listSection}>
              {offers.map((offer, i) => (
                <Text key={i} style={listItem}>
                  {`${offer.referenceLabel} on ${offer.date}: respond by ${offer.expiresAt}`}
                </Text>
              ))}
            </Section>
          )}

          <Section style={{ textAlign: 'center', margin: '32px 0' }}>
            <Button href={AVAILABILITY_URL} style={button}>
              {ctaLabel}
            </Button>
          </Section>

          <Text style={footer}>{footerText}</Text>
        </Container>
      </Body>
    </Html>
  )
}

export const template = {
  component: OfferExpiryReminder as React.ComponentType<TemplateData>,
  subject: (data: TemplateData) => {
    const n = Array.isArray(data?.offers) ? data.offers.length : 0
    return n === 1 ? 'Reminder: your offer expires soon' : `Reminder: ${n} offers expire soon`
  },
  displayName: 'Offer expiry reminder',
  previewData: {
    displayName: 'Jane Performer',
    offers: [
      { referenceLabel: 'Candlelight · Strings', date: '2026-04-30', expiresAt: '30/04/2026 19:00' },
    ],
  },
} satisfies TemplateEntry

const main = {
  backgroundColor: '#ffffff',
  fontFamily: '"Inter", -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
}
const container = { padding: '32px 24px', maxWidth: '600px', margin: '0 auto' }
const h1 = {
  fontSize: '22px',
  fontWeight: 700,
  color: '#0f172a',
  margin: '0 0 16px',
  fontFamily: '"Space Grotesk", "Inter", -apple-system, BlinkMacSystemFont, sans-serif',
}
const text = { fontSize: '15px', color: '#334155', lineHeight: 1.6, margin: '0 0 16px' }
const listSection = {
  margin: '24px 0',
  padding: '16px 20px',
  backgroundColor: '#f8fafc',
  borderRadius: '10px',
}
const listItem = { fontSize: '15px', color: '#0f172a', fontWeight: 600, margin: '0 0 10px' }
const button = {
  backgroundColor: '#7C3AED',
  color: '#ffffff',
  fontSize: '15px',
  fontWeight: 600,
  borderRadius: '10px',
  padding: '12px 24px',
  textDecoration: 'none',
  display: 'inline-block',
}
const footer = { fontSize: '13px', color: '#64748b', margin: '32px 0 0' }
