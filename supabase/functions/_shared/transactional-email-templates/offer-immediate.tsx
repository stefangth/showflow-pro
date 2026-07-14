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
import type { TemplateEntry } from './registry.ts'
import { APP_URL } from '../app-url.ts'

const SITE_NAME = 'ShowFlow'
const AVAILABILITY_URL = `${APP_URL}/availability`

interface Props {
  displayName?: string
  referenceLabel?: string
  date?: string
  city?: string | null
  windowHours?: number
  _intro?: string
  _cta_label?: string
  _footer?: string
}

const OfferImmediate = ({ displayName, referenceLabel, date, city, windowHours, _intro, _cta_label, _footer }: Props) => {
  const label = referenceLabel || 'a show'
  const where = city ? `${date} in ${city}` : date
  const hours = typeof windowHours === 'number' ? windowHours : 48
  const introText = _intro || `You have been offered ${label} on ${where}. You have ${hours} hours to respond before the offer expires.`
  const ctaLabel = _cta_label || 'Respond to this offer'
  const footerText = _footer || `The ${SITE_NAME} team`

  return (
    <Html lang="en" dir="ltr">
      <Head />
      <Preview>{`New offer: ${label} on ${SITE_NAME}`}</Preview>
      <Body style={main}>
        <Container style={container}>
          <Heading style={h1}>You have a new offer</Heading>
          <Text style={text}>{displayName ? `Hi ${displayName},` : 'Hi,'}</Text>
          <Text style={text}>{introText}</Text>

          <Section style={detailSection}>
            <Text style={detailLabel}>Show</Text>
            <Text style={detailValue}>{label}</Text>
            <Text style={detailLabel}>Date</Text>
            <Text style={detailValue}>{where}</Text>
          </Section>

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
  component: OfferImmediate,
  subject: (data: Record<string, any>) => `Offer: ${data.referenceLabel} · ${data.date}`,
  displayName: 'Immediate offer',
  previewData: {
    displayName: 'Jane Performer',
    referenceLabel: 'Candlelight · Strings',
    date: '2026-04-30',
    city: 'Berlin',
    windowHours: 48,
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
const detailSection = {
  margin: '24px 0',
  padding: '16px 20px',
  backgroundColor: '#f8fafc',
  borderRadius: '10px',
}
const detailLabel: React.CSSProperties = {
  fontSize: '12px',
  color: '#64748b',
  textTransform: 'uppercase',
  letterSpacing: '0.05em',
  fontWeight: 600,
  margin: '0 0 2px',
}
const detailValue = { fontSize: '15px', color: '#0f172a', fontWeight: 600, margin: '0 0 12px' }
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
