import * as React from 'react'
import { render } from '@react-email/components'
import { template } from '@/lib/email-templates/ai-bet-alert'

const data = {
  marketTitle: 'TEST · Lakers vs Celtics — Moneyline',
  sideLabel: 'LAKERS',
  fairProb: 58,
  marketProb: 48,
  edgePts: 10,
  pattern: 'sharp reverse line move',
  kellyHalf: 1.8,
}

const el = React.createElement(template.component, data)
const html = await render(el)
const text = await render(el, { plainText: true })
const subject = typeof template.subject === 'function' ? template.subject(data) : template.subject

const payload = {
  message_id: crypto.randomUUID(),
  to: 'dipeshtamu95@gmail.com',
  from: 'edgegraph <noreply@notify.bettinggraph.app>',
  sender_domain: 'notify.bettinggraph.app',
  subject,
  html,
  text,
  purpose: 'transactional',
  label: 'ai-bet-alert',
  idempotency_key: `test-bet-${Date.now()}`,
  unsubscribe_token: Array.from(crypto.getRandomValues(new Uint8Array(32))).map(b=>b.toString(16).padStart(2,'0')).join(''),
  queued_at: new Date().toISOString(),
}

process.stdout.write(JSON.stringify(payload))
