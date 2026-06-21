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

const SITE_NAME = 'ShowFlow'
const BOOKINGS_URL = 'https://showflow.pro/bookings'

interface Props {
  program?: string
  date?: string
  tier?: number
  accepted?: number
  required?: number
  _intro?: string
  _cta_label?: string
  _footer?: string
}

const CastEscalationRequested = ({ program, date, tier, accepted, required, _intro, _cta_label, _footer }: Props) => {
  const introText = _intro || `Open the next priority tier to keep this date on track.`
  const ctaLabel = _cta_label || 'Open bookings'
  const footerText = _footer || `— The ${SITE_NAME} team`
  return (
  <Html lang="en" dir="ltr">
    <Head />
    <Preview>{`Cast escalation needed — Tier ${tier ?? '—'} for ${program ?? 'a show'} on ${date ?? '—'}`}</Preview>
    <Body style={main}>
      <Container style={container}>
        <Heading style={h1}>Cast escalation needed</Heading>
        <Text style={text}>
          Tier {tier ?? '—'} for <strong>{program ?? 'a show'}</strong> on{' '}
          <strong>{date ?? '—'}</strong> has expired with only{' '}
          <strong>{accepted ?? 0}/{required ?? '?'}</strong> slots filled.
        </Text>
        <Section style={card}>
          <Text style={cardLabel}>Show</Text>
          <Text style={cardValue}>{program ?? '—'}</Text>
          <Text style={cardLabel}>Date</Text>
          <Text style={cardValue}>{date ?? '—'}</Text>
          <Text style={cardLabel}>Tier</Text>
          <Text style={cardValue}>{tier ?? '—'}</Text>
          <Text style={cardLabel}>Filled</Text>
          <Text style={cardValue}>{accepted ?? 0} / {required ?? '?'} slots</Text>
        </Section>
        <Text style={text}>{introText}</Text>
        <Section style={{ textAlign: 'center', margin: '32px 0' }}>
          <Button href={BOOKINGS_URL} style={button}>
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
  component: CastEscalationRequested,
  subject: (data: Record<string, any>) =>
    `Escalation needed — Tier ${data?.tier ?? '?'} for ${data?.program ?? 'show'} on ${data?.date ?? '?'}`,
  displayName: 'Cast escalation requested',
  previewData: {
    program: 'Riverdance',
    date: '2026-06-15',
    tier: 1,
    accepted: 2,
    required: 5,
  },
} satisfies TemplateEntry

const main = {
  backgroundColor: '#ffffff',
  fontFamily: '"Inter", -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
}
const container = { padding: '32px 24px', maxWidth: '560px', margin: '0 auto' }
const h1 = {
  fontSize: '22px',
  fontWeight: 700,
  color: '#0f172a',
  margin: '0 0 16px',
  fontFamily: '"Space Grotesk", "Inter", -apple-system, BlinkMacSystemFont, sans-serif',
}
const text = { fontSize: '15px', color: '#334155', lineHeight: 1.6, margin: '0 0 16px' }
const card = {
  backgroundColor: '#fff7ed',
  borderRadius: '12px',
  padding: '16px 20px',
  margin: '20px 0',
}
const cardLabel = {
  fontSize: '12px',
  textTransform: 'uppercase' as const,
  letterSpacing: '0.05em',
  color: '#9a3412',
  margin: '12px 0 4px',
}
const cardValue = { fontSize: '15px', color: '#0f172a', margin: '0', fontWeight: 500 }
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
