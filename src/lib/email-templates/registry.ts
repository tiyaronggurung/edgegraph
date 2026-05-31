import type { ComponentType } from 'react'
import { template as aiBetAlert } from './ai-bet-alert'
import { template as dailyDigest } from './daily-digest'

export interface TemplateEntry {
  component: ComponentType<any>
  subject: string | ((data: Record<string, any>) => string)
  displayName?: string
  previewData?: Record<string, any>
  /** Fixed recipient — overrides caller-provided recipientEmail when set. */
  to?: string
}

export const TEMPLATES: Record<string, TemplateEntry> = {
  'ai-bet-alert': aiBetAlert,
}
