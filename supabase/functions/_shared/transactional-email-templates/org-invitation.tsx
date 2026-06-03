/// <reference types="npm:@types/react@18.3.1" />
import * as React from 'npm:react@18.3.1'
import {
  Body, Button, Container, Head, Heading, Html, Preview, Section, Text,
} from 'npm:@react-email/components@0.0.22'
import type { TemplateEntry } from './registry.ts'

const SITE_NAME = 'Showflow Pro'
const APP_URL = 'https://showflow.pro'

interface Props {
  orgName?: string
  role?: string
  inviterEmail?: string
  token?: string
  // Template-override support (applied by send-transactional-email).
  _intro?: string
  _cta_label?: string
  _footer?: string
}

const OrgInvitationEmail = ({ orgName, role, inviterEmail, token, _intro, _cta_label, _footer }: Props) => {
  const org = orgName || 'an organization'
  const acceptUrl = token ? `${APP_URL}/accept-invite?token=${token}` : APP_URL
  const introText = _intro ||
    `You've been invited to join ${org} on ${SITE_NAME}${role ? ` as ${role}` : ''}. ` +
    `Accept the invitation to set up your account and get started.`
  const ctaLabel = _cta_label || 'Accept invitation'
  const footerText = _footer ||
    `This invitation expires in 14 days. If you weren't expecting it, you can safely ignore this email.`

  return (
    <Html lang="en" dir="ltr">
      <Head />
      <Preview>You're invited to join {org} on {SITE_NAME}</Preview>
      <Body style={main}>
        <Container style={container}>
          <Heading style={h1}>Join {org}</Heading>
          <Text style={text}>Hi,</Text>
          <Text style={text}>{introText}</Text>
          {inviterEmail ? <Text style={muted}>Invited by {inviterEmail}.</Text> : null}
          <Section style={section}>
            <Button href={acceptUrl} style={button}>{ctaLabel}</Button>
          </Section>
          <Text style={muted}>Or paste this link into your browser:</Text>
          <Text style={link}>{acceptUrl}</Text>
          <Text style={footer}>{footerText}</Text>
        </Container>
      </Body>
    </Html>
  )
}

export const template = {
  component: OrgInvitationEmail,
  subject: (data: Record<string, any>) =>
    `You're invited to join ${data?.orgName || 'an organization'} on ${SITE_NAME}`,
  displayName: 'Organization invitation',
  previewData: {
    orgName: 'Cirque Lumière',
    role: 'producer',
    inviterEmail: 'admin@cirque.example',
    token: 'previewtoken1234567890abcdef',
  },
} satisfies TemplateEntry

const main: React.CSSProperties = { backgroundColor: '#ffffff', fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif' }
const container: React.CSSProperties = { padding: '32px 24px', maxWidth: '560px', margin: '0 auto' }
const h1: React.CSSProperties = { fontSize: '22px', fontWeight: 600, color: '#111827', margin: '0 0 16px' }
const text: React.CSSProperties = { fontSize: '15px', lineHeight: '24px', color: '#374151', margin: '0 0 12px' }
const muted: React.CSSProperties = { fontSize: '13px', lineHeight: '20px', color: '#6b7280', margin: '0 0 8px' }
const section: React.CSSProperties = { textAlign: 'center', margin: '32px 0' }
const link: React.CSSProperties = { fontSize: '13px', lineHeight: '20px', color: '#7c3aed', wordBreak: 'break-all', margin: '0 0 24px' }
const button: React.CSSProperties = { backgroundColor: '#7c3aed', color: '#ffffff', fontSize: '15px', fontWeight: 600, padding: '12px 24px', borderRadius: '8px', textDecoration: 'none' }
const footer: React.CSSProperties = { fontSize: '12px', lineHeight: '18px', color: '#9ca3af', margin: '24px 0 0' }
