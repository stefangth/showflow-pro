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

const SITE_NAME = 'Showflow Pro'
const APP_URL = 'https://showflow.pro'

interface Props {
  decision?: 'approved' | 'rejected'
  displayName?: string
  reason?: string | null
  role?: string
  _intro?: string
  _cta_label?: string
  _footer?: string
}

const SignupDecisionEmail = ({ decision, displayName, reason, role, _intro, _cta_label, _footer }: Props) => {
  const isApproved = decision === 'approved'
  const defaultIntro = isApproved
    ? `Good news — your account has been approved. You can now sign in and start using ${SITE_NAME}${role ? ` as a ${role}.` : '.'}`
    : 'After review, your access request was not approved at this time.'
  const introText = _intro || defaultIntro
  const ctaLabel = _cta_label || `Open ${SITE_NAME}`
  const footerText = _footer || `— The ${SITE_NAME} team`
  return (
    <Html lang="en" dir="ltr">
      <Head />
      <Preview>
        {isApproved
          ? `You're approved on ${SITE_NAME}`
          : `Your ${SITE_NAME} signup request`}
      </Preview>
      <Body style={main}>
        <Container style={container}>
          <Heading style={h1}>
            {isApproved ? `Welcome to ${SITE_NAME}` : 'Signup request update'}
          </Heading>
          <Text style={text}>
            {displayName ? `Hi ${displayName},` : 'Hi,'}
          </Text>
          {isApproved ? (
            <>
              <Text style={text}>{introText}</Text>
              <Section style={{ textAlign: 'center', margin: '32px 0' }}>
                <Button href={APP_URL} style={button}>
                  {ctaLabel}
                </Button>
              </Section>
            </>
          ) : (
            <>
              <Text style={text}>{introText}</Text>
              {reason && (
                <Section style={card}>
                  <Text style={cardLabel}>Reason</Text>
                  <Text style={cardValue}>{reason}</Text>
                </Section>
              )}
              <Text style={text}>
                If you believe this was a mistake, please reply to this email
                and an admin will follow up.
              </Text>
            </>
          )}
          <Text style={footer}>{footerText}</Text>
        </Container>
      </Body>
    </Html>
  )
}

export const template = {
  component: SignupDecisionEmail,
  subject: (data: Record<string, any>) =>
    data?.decision === 'approved'
      ? `You're approved on ${SITE_NAME}`
      : `Your ${SITE_NAME} signup request`,
  displayName: 'Signup decision',
  previewData: {
    decision: 'approved',
    displayName: 'Jane Performer',
    role: 'artist',
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
const text = { fontSize: '15px', color: '#334155', lineHeight: 1.6, margin: '0 0 16px' }
const card = {
  backgroundColor: '#fef2f2',
  borderRadius: '12px',
  padding: '16px 20px',
  margin: '20px 0',
}
const cardLabel = {
  fontSize: '12px',
  textTransform: 'uppercase' as const,
  letterSpacing: '0.05em',
  color: '#991b1b',
  margin: '0 0 4px',
}
const cardValue = { fontSize: '15px', color: '#0f172a', margin: '0' }
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
  fontSize: '13px',
  color: '#64748b',
  margin: '32px 0 0',
}
