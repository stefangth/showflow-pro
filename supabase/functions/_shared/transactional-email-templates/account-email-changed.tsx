/// <reference types="npm:@types/react@18.3.1" />
import * as React from 'npm:react@18.3.1'
import {
  Body, Container, Head, Heading, Html, Preview, Section, Text,
} from 'npm:@react-email/components@0.0.22'
import type { TemplateEntry, TemplateData } from './registry.ts'
import { APP_URL } from '../app-url.ts'

const SITE_NAME = 'ShowFlow'

interface Props {
  oldEmail?: string
  newEmail?: string
  appOrigin?: string
  // Template-override support (applied by send-transactional-email).
  _intro?: string
  _footer?: string
}

const AccountEmailChanged = ({ oldEmail, newEmail, appOrigin, _intro, _footer }: Props) => {
  const previousEmail = oldEmail || 'unknown'
  const nextEmail = newEmail || 'unknown'
  const signInUrl = (appOrigin || APP_URL).replace(/\/+$/, '')
  const introText = _intro ||
    `The login email for your ${SITE_NAME} account was changed by an administrator.`
  const footerText = _footer ||
    `If you did not expect this change, contact your administrator right away.`

  return (
    <Html lang="en" dir="ltr">
      <Head />
      <Preview>Your {SITE_NAME} login email was changed</Preview>
      <Body style={main}>
        <Container style={container}>
          <Heading style={h1}>Your login email was changed</Heading>
          <Text style={text}>Hi,</Text>
          <Text style={text}>{introText}</Text>
          <Section style={card}>
            <Text style={cardLabel}>Previous email</Text>
            <Text style={cardValue}>{previousEmail}</Text>
            <Text style={cardLabel}>New email</Text>
            <Text style={cardValue}>{nextEmail}</Text>
          </Section>
          <Text style={text}>Sign in at {signInUrl} using your new email address.</Text>
          <Text style={footer}>{footerText}</Text>
        </Container>
      </Body>
    </Html>
  )
}

export const template = {
  component: AccountEmailChanged as React.ComponentType<TemplateData>,
  subject: `Your ${SITE_NAME} login email was changed`,
  displayName: 'Account email changed',
  previewData: {
    oldEmail: 'old@example.com',
    newEmail: 'new@example.com',
    appOrigin: 'https://app.showflow.pro',
  },
} satisfies TemplateEntry

const main: React.CSSProperties = { backgroundColor: '#ffffff', fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif' }
const container: React.CSSProperties = { padding: '32px 24px', maxWidth: '560px', margin: '0 auto' }
const h1: React.CSSProperties = { fontSize: '22px', fontWeight: 600, color: '#111827', margin: '0 0 16px' }
const text: React.CSSProperties = { fontSize: '15px', lineHeight: '24px', color: '#374151', margin: '0 0 12px' }
const card: React.CSSProperties = { backgroundColor: '#f9fafb', borderRadius: '12px', padding: '16px 20px', margin: '20px 0' }
const cardLabel: React.CSSProperties = { fontSize: '12px', textTransform: 'uppercase', letterSpacing: '0.05em', color: '#6b7280', margin: '12px 0 4px' }
const cardValue: React.CSSProperties = { fontSize: '15px', color: '#111827', margin: '0', fontWeight: 500 }
const footer: React.CSSProperties = { fontSize: '12px', lineHeight: '18px', color: '#9ca3af', margin: '24px 0 0' }
