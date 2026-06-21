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
const APPROVALS_URL = 'https://showflow.pro/admin?tab=approvals'

interface Props {
  signupName?: string
  signupEmail?: string
  requestedRole?: string
  _intro?: string
  _cta_label?: string
  _footer?: string
}

const NewSignupAdminNotification = ({
  signupName,
  signupEmail,
  requestedRole,
  _intro,
  _cta_label,
  _footer,
}: Props) => {
  const introText = _intro || `A new user has signed up to ${SITE_NAME} and is waiting for an admin to approve or reject their access.`
  const ctaLabel = _cta_label || 'Review request'
  const footerText = _footer || `You're receiving this email because you're an admin on ${SITE_NAME}.`
  return (
  <Html lang="en" dir="ltr">
    <Head />
    <Preview>New signup awaiting your approval on {SITE_NAME}</Preview>
    <Body style={main}>
      <Container style={container}>
        <Heading style={h1}>New signup pending review</Heading>
        <Text style={text}>{introText}</Text>

        <Section style={card}>
          <Text style={cardLabel}>Name</Text>
          <Text style={cardValue}>{signupName || '—'}</Text>
          <Text style={cardLabel}>Email</Text>
          <Text style={cardValue}>{signupEmail || '—'}</Text>
          <Text style={cardLabel}>Requested role</Text>
          <Text style={cardValue}>{requestedRole || 'artist'}</Text>
        </Section>

        <Section style={{ textAlign: 'center', margin: '32px 0' }}>
          <Button href={APPROVALS_URL} style={button}>
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
  component: NewSignupAdminNotification,
  subject: 'New ShowFlow signup awaiting approval',
  displayName: 'New signup — admin notification',
  previewData: {
    signupName: 'Jane Performer',
    signupEmail: 'jane@example.com',
    requestedRole: 'artist',
  },
} satisfies TemplateEntry

const main = {
  backgroundColor: '#ffffff',
  fontFamily:
    '"Inter", -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
}
const container = { padding: '32px 24px', maxWidth: '560px', margin: '0 auto' }
const h1 = {
  fontSize: '22px',
  fontWeight: 700,
  color: '#0f172a',
  margin: '0 0 16px',
  fontFamily:
    '"Space Grotesk", "Inter", -apple-system, BlinkMacSystemFont, sans-serif',
}
const text = { fontSize: '15px', color: '#334155', lineHeight: 1.6, margin: '0 0 20px' }
const card = {
  backgroundColor: '#f8fafc',
  borderRadius: '12px',
  padding: '20px 24px',
  margin: '24px 0',
}
const cardLabel = {
  fontSize: '12px',
  textTransform: 'uppercase' as const,
  letterSpacing: '0.05em',
  color: '#64748b',
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
const footer = {
  fontSize: '12px',
  color: '#94a3b8',
  margin: '32px 0 0',
  textAlign: 'center' as const,
}
