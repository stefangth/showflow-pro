/// <reference types="npm:@types/react@18.3.1" />
import * as React from 'npm:react@18.3.1'
import {
  Body,
  Container,
  Head,
  Heading,
  Html,
  Preview,
  Section,
  Text,
} from 'npm:@react-email/components@0.0.22'
import type { TemplateEntry } from './registry.ts'
import { digestEmailSubject } from '../scheduleChanges.ts'

const SITE_NAME = 'Showflow Pro'

interface BookingRow { show: string; date: string; city: string }
interface ChangeRow { show: string; date: string; city: string; changes: string }
interface CancelRow { show: string; date: string; city: string; reason?: string | null }

interface Props {
  displayName?: string
  bookings?: BookingRow[]
  scheduleChanges?: ChangeRow[]
  cancellations?: CancelRow[]
  _intro?: string
  _footer?: string
}

const ArtistConfirmationDigest = ({ displayName, bookings = [], scheduleChanges = [], cancellations = [], _intro, _footer }: Props) => {
  const hasUpdates = scheduleChanges.length > 0 || cancellations.length > 0
  const heading = hasUpdates ? 'Your booking updates' : 'Your bookings are confirmed'
  const introText = _intro || (hasUpdates
    ? `Here's what changed on your bookings.`
    : `Here's what just got confirmed. We're excited to have you on stage!`)
  const footerText = _footer || `— The ${SITE_NAME} team`

  return (
    <Html lang="en" dir="ltr">
      <Head />
      <Preview>{heading} — {SITE_NAME}</Preview>
      <Body style={main}>
        <Container style={container}>
          <Heading style={h1}>{heading}</Heading>
          <Text style={text}>{displayName ? `Hi ${displayName},` : 'Hi,'}</Text>
          <Text style={text}>{introText}</Text>

          {cancellations.length > 0 && (
            <Section style={tableSection}>
              <Text style={sectionLabel}>Cancelled</Text>
              <table style={tableStyle} cellPadding={0} cellSpacing={0}>
                <thead>
                  <tr><th style={th}>Show</th><th style={th}>Date</th><th style={th}>City</th><th style={th}>Reason</th></tr>
                </thead>
                <tbody>
                  {cancellations.map((c, i) => (
                    <tr key={i} style={i % 2 === 1 ? trAlt : tr}>
                      <td style={td}>{c.show}</td><td style={td}>{c.date}</td><td style={td}>{c.city}</td><td style={td}>{c.reason || '—'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </Section>
          )}

          {scheduleChanges.length > 0 && (
            <Section style={tableSection}>
              <Text style={sectionLabel}>Schedule changes</Text>
              <table style={tableStyle} cellPadding={0} cellSpacing={0}>
                <thead>
                  <tr><th style={th}>Show</th><th style={th}>Date</th><th style={th}>City</th><th style={th}>Change</th></tr>
                </thead>
                <tbody>
                  {scheduleChanges.map((c, i) => (
                    <tr key={i} style={i % 2 === 1 ? trAlt : tr}>
                      <td style={td}>{c.show}</td><td style={td}>{c.date}</td><td style={td}>{c.city}</td><td style={td}>{c.changes}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </Section>
          )}

          {bookings.length > 0 && (
            <Section style={tableSection}>
              {hasUpdates && <Text style={sectionLabel}>Confirmed</Text>}
              <table style={tableStyle} cellPadding={0} cellSpacing={0}>
                <thead>
                  <tr><th style={th}>Show</th><th style={th}>Date</th><th style={th}>City</th></tr>
                </thead>
                <tbody>
                  {bookings.map((b, i) => (
                    <tr key={i} style={i % 2 === 1 ? trAlt : tr}>
                      <td style={td}>{b.show}</td><td style={td}>{b.date}</td><td style={td}>{b.city}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </Section>
          )}

          {bookings.length === 0 && !hasUpdates && (
            <Text style={{ ...text, color: '#64748b' }}>No confirmed bookings yet.</Text>
          )}

          <Text style={footer}>{footerText}</Text>
        </Container>
      </Body>
    </Html>
  )
}

export const template = {
  component: ArtistConfirmationDigest,
  subject: (data: Record<string, any>) => digestEmailSubject(data),
  displayName: 'Artist confirmation digest',
  previewData: {
    displayName: 'Jane Performer',
    bookings: [{ show: 'Riverdance', date: '2026-06-15', city: 'Berlin' }],
    scheduleChanges: [{ show: 'Riverdance', date: '2026-06-22', city: 'Hamburg', changes: 'Session 1 now 20:00 (was 19:00)' }],
    cancellations: [{ show: 'Riverdance', date: '2026-06-29', city: 'Munich', reason: 'Venue flooded' }],
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
const sectionLabel: React.CSSProperties = { fontSize: '13px', fontWeight: 700, color: '#0f172a', margin: '0 0 8px', textTransform: 'uppercase', letterSpacing: '0.05em' }
const tableStyle: React.CSSProperties = { width: '100%', borderCollapse: 'collapse', fontSize: '14px' }
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
const footer = { fontSize: '13px', color: '#64748b', margin: '32px 0 0' }
