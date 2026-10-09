import 'server-only';

import { serverEnv } from '@/server/env';

export type EmailResult = { sent: true } | { sent: false; reason: 'not_configured' | 'failed' };

export function isEmailConfigured(): boolean {
  const env = serverEnv();
  return Boolean(env.RESEND_API_KEY && env.EMAIL_FROM);
}

/**
 * Sends one transactional email through Resend's HTTP API (ADR-023). Returns rather than throws:
 * a message that could not be sent must not undo the record it was about, and the caller decides
 * what to tell the person. Nothing about the recipient or the content is logged.
 */
export async function sendEmail(message: {
  to: string;
  subject: string;
  text: string;
  html: string;
  /** Where replies should go, when not to the sending address. */
  replyTo?: string;
}): Promise<EmailResult> {
  const env = serverEnv();
  // Automated tests share a developer's env file; they must never send real mail.
  if (env.NODE_ENV === 'test') return { sent: false, reason: 'not_configured' };
  if (!env.RESEND_API_KEY || !env.EMAIL_FROM) return { sent: false, reason: 'not_configured' };

  try {
    const response = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${env.RESEND_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        from: env.EMAIL_FROM,
        to: message.to,
        subject: message.subject,
        text: message.text,
        html: message.html,
        ...(message.replyTo ? { reply_to: message.replyTo } : {}),
      }),
      signal: AbortSignal.timeout(10_000),
    });
    if (!response.ok) {
      console.error('[email] provider refused the message', { status: response.status });
      return { sent: false, reason: 'failed' };
    }
    return { sent: true };
  } catch (error) {
    console.error('[email] could not reach the provider', {
      name: error instanceof Error ? error.name : typeof error,
    });
    return { sent: false, reason: 'failed' };
  }
}
