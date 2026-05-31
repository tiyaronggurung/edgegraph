import {
  Body, Container, Head, Heading, Html, Preview, Section, Text,
} from '@react-email/components'
import type { TemplateEntry } from './registry'

const SITE_NAME = 'EdgeGraph AI'

interface DigestItem {
  marketTitle?: string
  sideLabel?: string
  fairProb?: number
  marketProb?: number
  edgePts?: number
  pattern?: string | null
  kellyHalf?: number | null
  sport?: string | null
}

interface DailyDigestProps {
  date?: string
  items?: DigestItem[]
}

const DailyDigestEmail = ({ date = '', items = [] }: DailyDigestProps) => (
  <Html lang="en" dir="ltr">
    <Head />
    <Preview>{`${items.length} BET alert${items.length === 1 ? '' : 's'} — ${date}`}</Preview>
    <Body style={main}>
      <Container style={container}>
        <Text style={brand}>{SITE_NAME}</Text>
        <Heading style={h1}>Daily BET Digest</Heading>
        <Text style={subtitle}>{date} · {items.length} qualifying alert{items.length === 1 ? '' : 's'}</Text>

        {items.length === 0 ? (
          <Section style={card}>
            <Text style={empty}>No qualifying BET alerts in the last 24 hours.</Text>
          </Section>
        ) : (
          items.map((it, i) => (
            <Section key={i} style={card}>
              <div style={betBadge}>BET {it.sideLabel ?? it.sideLabel ?? 'YES'}</div>
              <Text style={market}>{it.marketTitle ?? 'a tracked market'}</Text>
              <Text style={reason}>
                Fair {Number(it.fairProb ?? 0).toFixed(0)}% vs market {Number(it.marketProb ?? 0).toFixed(0)}% → +{Number(it.edgePts ?? 0).toFixed(1)}pt edge
                {it.pattern ? ` · ${it.pattern}` : ''}
                {it.sport ? ` · ${it.sport}` : ''}
              </Text>
              {it.kellyHalf && it.kellyHalf > 0 ? (
                <Text style={kelly}>½ Kelly stake: <strong>${it.kellyHalf}</strong></Text>
              ) : null}
            </Section>
          ))
        )}

        <Text style={footer}>
          You are receiving this daily rollup because your alert frequency is set to Daily Digest in {SITE_NAME}. Change it any time in Settings.
        </Text>
      </Container>
    </Body>
  </Html>
)

export const template = {
  component: DailyDigestEmail,
  subject: (data: Record<string, any>) => {
    const count = Array.isArray(data?.items) ? data.items.length : 0
    return `🟢 Daily BET Digest — ${count} alert${count === 1 ? '' : 's'}`
  },
  displayName: 'Daily BET Digest',
  previewData: {
    date: '2026-05-31',
    items: [
      {
        marketTitle: 'Lakers vs Warriors — Will LAL win?',
        sideLabel: 'YES (Lakers)',
        fairProb: 62,
        marketProb: 54,
        edgePts: 8,
        pattern: 'Mean Reversion',
        kellyHalf: 35,
        sport: 'NBA',
      },
    ],
  },
} satisfies TemplateEntry

const main = { backgroundColor: '#ffffff', fontFamily: 'JetBrains Mono, ui-monospace, monospace' }
const container = { padding: '32px 24px', maxWidth: '560px', margin: '0 auto' }
const brand = { fontSize: '11px', letterSpacing: '0.2em', color: '#10b981', textTransform: 'uppercase' as const, margin: '0 0 8px' }
const h1 = { fontSize: '24px', fontWeight: 'bold' as const, color: '#0a0a0a', margin: '0 0 6px', letterSpacing: '0.02em' }
const subtitle = { fontSize: '12px', color: '#525252', margin: '0 0 20px' }
const card = { border: '1px solid #10b981', backgroundColor: '#ecfdf5', borderRadius: '6px', padding: '16px', marginBottom: '12px' }
const betBadge = { display: 'inline-block', backgroundColor: '#10b981', color: '#ffffff', fontSize: '11px', fontWeight: 'bold' as const, padding: '4px 10px', letterSpacing: '0.15em', borderRadius: '3px' }
const market = { fontSize: '13px', fontWeight: 'bold' as const, color: '#0a0a0a', margin: '10px 0 4px' }
const reason = { fontSize: '12px', color: '#064e3b', margin: '0 0 6px', lineHeight: 1.5 }
const kelly = { fontSize: '12px', color: '#064e3b', margin: '6px 0 0' }
const empty = { fontSize: '13px', color: '#525252', textAlign: 'center' as const, padding: '20px 0' }
const footer = { fontSize: '11px', color: '#9ca3af', margin: '24px 0 0', lineHeight: 1.5 }
