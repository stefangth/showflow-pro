/// <reference types="npm:@types/react@18.3.1" />
import * as React from 'npm:react@18.3.1'
import {
  Body, Button, Container, Head, Heading, Html, Preview, Section, Text,
} from 'npm:@react-email/components@0.0.22'
import type { TemplateEntry, TemplateData } from './registry.ts'
import { APP_URL } from '../app-url.ts'

interface Props {
  artist_name?: string
  order_no?: string
  date_label?: string
  venue?: string
  download_url?: string
  _intro?: string
  _cta_label?: string
  _footer?: string
}

const HireOrderCountersignedEmail = ({
  artist_name, order_no, date_label, venue, download_url, _intro, _cta_label, _footer,
}: Props) => {
  const name = artist_name || 'there'
  const date = date_label || 'your date'
  const place = venue || 'the venue'
  const url = download_url || APP_URL
  const ctaLabel = _cta_label || 'View signed order'
  const introText = _intro ||
    `Your hire order for ${date} at ${place} has been countersigned. A copy of the signed document is attached for your records.`
  const footerText = _footer || 'Questions about this hire order. Reply to this email and we will help.'
  return (
    <Html lang="en" dir="ltr">
      <Head />
      <Preview>Your hire order for {date} has been countersigned</Preview>
      <Body style={main}>
        <Container style={container}>
          <Heading style={h1}>Hire order countersigned</Heading>
          <Text style={text}>Hi {name},</Text>
          <Text style={text}>{introText}</Text>
          <Section style={factsSection}>
            {order_no ? <Text style={factRow}><strong>Order.</strong> {order_no}</Text> : null}
            <Text style={factRow}><strong>Date.</strong> {date}</Text>
            <Text style={factRow}><strong>Venue.</strong> {place}</Text>
          </Section>
          <Section style={section}>
            <Button href={url} style={button}>{ctaLabel}</Button>
          </Section>
          <Text style={footer}>{footerText}</Text>
        </Container>
      </Body>
    </Html>
  )
}

export const template = {
  component: HireOrderCountersignedEmail as React.ComponentType<TemplateData>,
  subject: (data: TemplateData) =>
    `Your hire order for ${data?.date_label || 'your date'} has been countersigned`,
  displayName: 'Hire order countersigned',
  previewData: {
    artist_name: 'Mara Lindqvist',
    order_no: 'HO-2026-0142',
    date_label: 'Sat, Aug 15 2026',
    venue: 'Tempodrom',
    download_url: `${APP_URL}/hire-orders/HO-2026-0142`,
  },
} satisfies TemplateEntry

const main: React.CSSProperties = { backgroundColor: '#ffffff', fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif' }
const container: React.CSSProperties = { padding: '32px 24px', maxWidth: '560px', margin: '0 auto' }
const h1: React.CSSProperties = { fontSize: '22px', fontWeight: 600, color: '#111827', margin: '0 0 16px' }
const text: React.CSSProperties = { fontSize: '15px', lineHeight: '24px', color: '#374151', margin: '0 0 12px' }
const section: React.CSSProperties = { textAlign: 'center', margin: '32px 0' }
const button: React.CSSProperties = { backgroundColor: '#7c3aed', color: '#ffffff', fontSize: '15px', fontWeight: 600, padding: '12px 24px', borderRadius: '8px', textDecoration: 'none' }
const footer: React.CSSProperties = { fontSize: '12px', lineHeight: '18px', color: '#9ca3af', margin: '24px 0 0' }
const factsSection: React.CSSProperties = { margin: '16px 0', padding: '16px', backgroundColor: '#f9fafb', borderRadius: '8px' }
const factRow: React.CSSProperties = { fontSize: '14px', lineHeight: '22px', color: '#374151', margin: '0 0 4px' }
