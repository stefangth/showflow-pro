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

interface Props {
  job_name?: string
  status_code?: number | string
  error?: string
  last_ok_at?: string
  dashboard_url?: string
  _footer?: string
}

const CronHealthAlert = ({ job_name, status_code, error, last_ok_at, dashboard_url, _footer }: Props) => (
  <Html lang="en" dir="ltr">
    <Head />
    <Preview>{`Cron health alert — ${job_name ?? 'a scheduled job'} is failing`}</Preview>
    <Body style={main}>
      <Container style={container}>
        <Heading style={h1}>Scheduled job failing</Heading>
        <Text style={text}>
          The scheduled job <strong>{job_name ?? '—'}</strong> last returned{' '}
          <strong>{status_code ?? '—'}</strong>. Part of the booking engine may be degraded until it is fixed.
        </Text>
        <Section style={card}>
          <Text style={cardLabel}>Job</Text>
          <Text style={cardValue}>{job_name ?? '—'}</Text>
          <Text style={cardLabel}>Last status</Text>
          <Text style={cardValue}>{status_code ?? '—'}</Text>
          <Text style={cardLabel}>Last error</Text>
          <Text style={cardValue}>{error || '—'}</Text>
          <Text style={cardLabel}>Last healthy</Text>
          <Text style={cardValue}>{last_ok_at ?? 'unknown'}</Text>
        </Section>
        <Section style={{ textAlign: 'center', margin: '32px 0' }}>
          <Button href={dashboard_url || 'https://showflow.pro/platform'} style={button}>
            Open System Health
          </Button>
        </Section>
        <Text style={footer}>{_footer || `— The ${SITE_NAME} team`}</Text>
      </Container>
    </Body>
  </Html>
)

export const template = {
  component: CronHealthAlert,
  subject: (data: Record<string, any>) =>
    `Cron health: ${data?.job_name ?? 'a job'} is failing (${data?.status_code ?? '?'})`,
  displayName: 'Cron health alert',
  previewData: {
    job_name: 'send-offer-digest',
    status_code: 404,
    error: 'Requested function was not found',
    last_ok_at: '2026-06-20T19:00:00Z',
    dashboard_url: 'https://showflow.pro/platform',
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
