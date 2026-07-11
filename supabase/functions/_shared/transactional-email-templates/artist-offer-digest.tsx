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

interface OfferRow {
  show: string
  date: string
  city: string
  expires: string
}

interface Props {
  displayName?: string
  offers?: OfferRow[]
  _intro?: string
  _cta_label?: string
  _footer?: string
}

const ArtistOfferDigest = ({ displayName, offers = [], _intro, _cta_label, _footer }: Props) => {
  const n = offers.length
  const introText = _intro || `You have ${n} pending offer${n === 1 ? '' : 's'} waiting for your response. Please review and accept or decline before the deadlines below.`
  const ctaLabel = _cta_label || 'View your offers'
  const footerText = _footer || `— The ${SITE_NAME} team`

  return (
    <Html lang="en" dir="ltr">
      <Head />
      <Preview>{`You have ${n} pending offer${n === 1 ? '' : 's'} on ${SITE_NAME}`}</Preview>
      <Body style={main}>
        <Container style={container}>
          <Heading style={h1}>
            {n} pending offer{n === 1 ? '' : 's'} on {SITE_NAME}
          </Heading>
          <Text style={text}>
            {displayName ? `Hi ${displayName},` : 'Hi,'}
          </Text>
          <Text style={text}>{introText}</Text>

          {offers.length > 0 && (
            <Section style={tableSection}>
              <table style={tableStyle} cellPadding={0} cellSpacing={0}>
                <thead>
                  <tr>
                    <th style={th}>Show</th>
                    <th style={th}>Date</th>
                    <th style={th}>City</th>
                    <th style={th}>Expires</th>
                  </tr>
                </thead>
                <tbody>
                  {offers.map((offer, i) => (
                    <tr key={i} style={i % 2 === 1 ? trAlt : tr}>
                      <td style={td}>{offer.show}</td>
                      <td style={td}>{offer.date}</td>
                      <td style={td}>{offer.city}</td>
                      <td style={{ ...td, color: '#ef4444' }}>{offer.expires}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
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
  component: ArtistOfferDigest,
  subject: (data: Record<string, any>) => {
    const n = (data?.offers ?? []).length
    return `You have ${n} pending offer${n === 1 ? '' : 's'} on ${SITE_NAME}`
  },
  displayName: 'Artist offer digest',
  previewData: {
    displayName: 'Jane Performer',
    offers: [
      { show: 'Riverdance', date: '2026-06-15', city: 'Berlin', expires: '2026-05-17 19:00' },
      { show: 'Riverdance', date: '2026-06-22', city: 'Berlin', expires: '2026-05-17 19:00' },
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
const tableSection = { margin: '24px 0' }
const tableStyle: React.CSSProperties = {
  width: '100%',
  borderCollapse: 'collapse',
  fontSize: '14px',
}
const th: React.CSSProperties = {
  textAlign: 'left',
  padding: '10px 12px',
  borderBottom: '2px solid #e2e8f0',
  color: '#64748b',
  fontSize: '12px',
  textTransform: 'uppercase',
  letterSpacing: '0.05em',
  fontWeight: 600,
}
const tr: React.CSSProperties = {}
const trAlt: React.CSSProperties = { backgroundColor: '#f8fafc' }
const td: React.CSSProperties = {
  padding: '10px 12px',
  borderBottom: '1px solid #e2e8f0',
  color: '#0f172a',
  verticalAlign: 'top',
}
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
