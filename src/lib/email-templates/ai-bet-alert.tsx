import {
  Body, Container, Head, Heading, Html, Preview, Section, Text,
} from '@react-email/components'
import type { TemplateEntry } from './registry'

const SITE_NAME = 'EdgeGraph AI'

interface AiBetAlertProps {
  marketTitle?: string
  sideLabel?: string
  fairProb?: number
  marketProb?: number
  edgePts?: number
  pattern?: string | null
  kellyHalf?: number | null
}

const AiBetAlertEmail = ({
  marketTitle = 'a tracked market',
  sideLabel = 'YES',
  fairProb = 0,
  marketProb = 0,
  edgePts = 0,
  pattern,
  kellyHalf,
}: AiBetAlertProps) => (
  <Html lang="en" dir="ltr">
    <Head />
    <Preview>{`BET ${sideLabel} — +${edgePts.toFixed(1)}pt edge on ${marketTitle}`}</Preview>
    <Body style={main}>
      <Container style={container}>
        <Text style={brand}>{SITE_NAME}</Text>
        <Heading style={h1}>AI Verdict: BET {sideLabel}</Heading>
        <Text style={market}>{marketTitle}</Text>

        <Section style={card}>
          <div style={betBadge}>BET {sideLabel}</div>
          <Text style={reason}>
            Fair {fairProb.toFixed(0)}% vs market {marketProb.toFixed(0)}% → +{edgePts.toFixed(1)}pt edge
            {pattern ? ` · ${pattern}` : ''}
          </Text>

          <div style={statsRow}>
            <div style={statBox}>
              <div style={statLabel}>FAIR</div>
              <div style={statValue}>{fairProb.toFixed(0)}%</div>
            </div>
            <div style={statBox}>
              <div style={statLabel}>MARKET</div>
              <div style={statValue}>{marketProb.toFixed(0)}%</div>
            </div>
            <div style={statBoxEdge}>
              <div style={statLabel}>EDGE</div>
              <div style={statValueEdge}>+{edgePts.toFixed(1)}pt</div>
            </div>
          </div>

          {kellyHalf && kellyHalf > 0 ? (
            <Text style={kelly}>½ Kelly stake: <strong>${kellyHalf}</strong></Text>
          ) : null}
        </Section>

        <Text style={footer}>
          You are receiving this because the AI flagged a high-confidence bet on a market you are tracking in {SITE_NAME}.
        </Text>
      </Container>
    </Body>
  </Html>
)

export const template = {
  component: AiBetAlertEmail,
  subject: (data: Record<string, any>) =>
    `🟢 BET ${data?.sideLabel ?? 'YES'} — +${Number(data?.edgePts ?? 0).toFixed(1)}pt edge`,
  displayName: 'AI Bet Alert',
  previewData: {
    marketTitle: 'Trail Blazers vs Lakers — Will Portland win?',
    sideLabel: 'YES (Portland)',
    fairProb: 62,
    marketProb: 54,
    edgePts: 8,
    pattern: 'Mean Reversion',
    kellyHalf: 35,
  },
} satisfies TemplateEntry

const main = { backgroundColor: '#ffffff', fontFamily: 'JetBrains Mono, ui-monospace, monospace' }
const container = { padding: '32px 24px', maxWidth: '560px', margin: '0 auto' }
const brand = { fontSize: '11px', letterSpacing: '0.2em', color: '#10b981', textTransform: 'uppercase' as const, margin: '0 0 8px' }
const h1 = { fontSize: '24px', fontWeight: 'bold' as const, color: '#0a0a0a', margin: '0 0 6px', letterSpacing: '0.02em' }
const market = { fontSize: '13px', color: '#525252', margin: '0 0 20px' }
const card = { border: '1px solid #10b981', backgroundColor: '#ecfdf5', borderRadius: '6px', padding: '20px' }
const betBadge = { display: 'inline-block', backgroundColor: '#10b981', color: '#ffffff', fontSize: '11px', fontWeight: 'bold' as const, padding: '4px 10px', letterSpacing: '0.15em', borderRadius: '3px' }
const reason = { fontSize: '13px', color: '#064e3b', margin: '12px 0 16px', lineHeight: 1.5 }
const statsRow = { display: 'table', width: '100%', tableLayout: 'fixed' as const, marginTop: '8px' }
const statBox = { display: 'table-cell', textAlign: 'center' as const, padding: '10px', backgroundColor: '#ffffff', border: '1px solid #d1fae5', borderRadius: '4px' }
const statBoxEdge = { ...statBox, backgroundColor: '#10b981', border: '1px solid #10b981' }
const statLabel = { fontSize: '10px', letterSpacing: '0.15em', color: '#6b7280', marginBottom: '4px' }
const statValue = { fontSize: '18px', fontWeight: 'bold' as const, color: '#0a0a0a' }
const statValueEdge = { fontSize: '18px', fontWeight: 'bold' as const, color: '#ffffff' }
const kelly = { fontSize: '13px', color: '#064e3b', margin: '16px 0 0', textAlign: 'center' as const }
const footer = { fontSize: '11px', color: '#9ca3af', margin: '24px 0 0', lineHeight: 1.5 }
