/**
 * Customer emails (backend/app/api/email.py): template editing, live preview, test send and the delivery log.
 * Sender name / reply-to / on-off live in business settings (PUT /settings).
 */
import { api } from './client';

export type EmailTemplateKey = 'loyalty_reward' | 'offer_announcement' | 'order_receipt' | 'welcome';
export type EmailLogStatus = 'queued' | 'sent' | 'failed' | 'skipped';

export interface EmailPlaceholder { key: string; description: string }

export interface EmailStatus {
  /** SMTP is set up on the server */
  configured: boolean;
  placeholders: EmailPlaceholder[];
}

/** Editable parts of a template (plain text with {placeholders}; the server escapes everything). */
export interface EmailTemplateFields {
  subject: string;
  heading: string;
  body: string;
  button_text: string | null;
  button_url: string | null;
  accent_color: string | null;
  enabled: boolean;
}

export interface EmailTemplate extends EmailTemplateFields {
  key: EmailTemplateKey;
  label: string;
  description: string;
  /** False = the built-in default text */
  customised: boolean;
}

export interface EmailPreview { subject: string; html: string; text: string }

export interface EmailLogItem {
  id: string;
  to: string;
  template: EmailTemplateKey | string;
  subject: string;
  status: EmailLogStatus;
  error: string | null;
  created_at: string;
  sent_at: string | null;
}

export interface EmailLogs { counts: Partial<Record<EmailLogStatus, number>>; items: EmailLogItem[] }

export const emailApi = {
  status: () => api.get<EmailStatus>('/email/status'),
  templates: () => api.get<EmailTemplate[]>('/email/templates'),
  save: (key: EmailTemplateKey, body: EmailTemplateFields) =>
    api.put<Omit<EmailTemplate, 'label' | 'description'>>(`/email/templates/${key}`, body),
  /** Resets to the built-in text; returns the default fields (without label / description). */
  reset: (key: EmailTemplateKey) =>
    api.delete<Partial<EmailTemplateFields> & { key: EmailTemplateKey; customised: false }>(`/email/templates/${key}`),
  /** Renders with sample values; pass unsaved edits to see them before saving. */
  preview: (key: EmailTemplateKey, body: Partial<EmailTemplateFields>) => api.post<EmailPreview>(`/email/templates/${key}/preview`, body),
  test: (key: EmailTemplateKey, to: string) => api.post<{ status: EmailLogStatus; error: string | null }>(`/email/templates/${key}/test`, { to }),
  logs: (status?: EmailLogStatus | null, limit = 100) => api.get<EmailLogs>('/email/logs', { query: { status: status ?? undefined, limit } }),
};

const PLACEHOLDER = /\{([a-z_]+)\}/g;

/** {placeholders} in the text that the server doesn't know (it rejects them with a 422). */
export function unknownPlaceholders(texts: (string | null | undefined)[], known: string[]): string[] {
  const set = new Set(known);
  const out = new Set<string>();
  for (const t of texts) {
    if (!t) continue;
    for (const m of t.matchAll(PLACEHOLDER)) if (!set.has(m[1])) out.add(m[1]);
  }
  return [...out];
}
