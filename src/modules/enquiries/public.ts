import 'server-only';

import { gte, sql } from 'drizzle-orm';
import type { z } from 'zod';

import { websiteEnquiries } from '@/db/schema';
import { AppError } from '@/lib/errors';
import { escapeHtml } from '@/lib/html';
import { adminDb } from '@/server/db/admin';
import { sendEmail } from '@/server/email';
import { serverEnv } from '@/server/env';
import { platformOwnerEmails } from '@/server/platform';
import { enforceRateLimit } from '@/server/rate-limit';

import type { submitEnquirySchema } from './schemas';

/*
 * The public "Let's talk" form (no session). Like every public intake: Zod-parsed input, a
 * honeypot, a per-sender limit stored only as a keyed hash, and a ceiling across all senders, so
 * a flood cannot fill the table or the owners' inboxes (ADR-039).
 */
const SENDER_HOURLY_LIMIT = 3;
const FORM_HOURLY_LIMIT = 40;

export async function submitEnquiry(
  input: z.output<typeof submitEnquirySchema>,
  sender: string | null,
): Promise<void> {
  // A filled honeypot is a bot. Answer as if it worked so it learns nothing.
  if (input.website) return;

  await enforceRateLimit(
    { bucket: 'website-enquiry', subject: sender, limit: SENDER_HOURLY_LIMIT, windowSeconds: 3600 },
    'Thanks, we already have your message. Please wait a while before sending another.',
  );
  const db = adminDb();
  const [recent] = await db
    .select({ total: sql<number>`count(*)::int` })
    .from(websiteEnquiries)
    .where(gte(websiteEnquiries.createdAt, new Date(Date.now() - 60 * 60 * 1000)));
  if ((recent?.total ?? 0) >= FORM_HOURLY_LIMIT) {
    throw new AppError(
      'RATE_LIMITED',
      'We are receiving a lot of messages right now. Please try again a little later.',
    );
  }

  const [created] = await db
    .insert(websiteEnquiries)
    .values({
      name: input.name,
      email: input.email,
      phone: input.phone,
      company: input.company,
      businessType: input.businessType,
      teamSize: input.teamSize,
      message: input.message,
    })
    .returning({ id: websiteEnquiries.id });
  if (!created) throw new AppError('INTERNAL', 'Your message could not be saved.');

  // Saved first, so a failed email never loses an enquiry; the console lists it either way.
  await notifyOwners(created.id, input);
}

async function notifyOwners(id: string, input: z.output<typeof submitEnquirySchema>) {
  const owners = platformOwnerEmails();
  if (owners.length === 0) return;
  const link = `${serverEnv().APP_URL}/platform/enquiries#${id}`;
  const rows: [string, string | null][] = [
    ['Name', input.name],
    ['Business', input.company],
    ['What they do', input.businessType],
    ['Team size', input.teamSize],
    ['Email', input.email],
    ['Phone', input.phone],
  ];
  const text = [
    `New enquiry from ${input.company} on the Meroidea website.`,
    '',
    ...rows.filter(([, value]) => value).map(([label, value]) => `${label}: ${value}`),
    '',
    input.message,
    '',
    `Reply to this email to answer ${input.name} directly, or open it in the console: ${link}`,
  ].join('\n');
  const html = `<p>New enquiry from <strong>${escapeHtml(input.company)}</strong> on the Meroidea website.</p>
<table role="presentation" cellpadding="4">${rows
    .filter(([, value]) => value)
    .map(
      ([label, value]) =>
        `<tr><td style="color:#6b7280">${label}</td><td>${escapeHtml(value ?? '')}</td></tr>`,
    )
    .join('')}</table>
<p style="white-space:pre-wrap">${escapeHtml(input.message)}</p>
<p>Reply to this email to answer ${escapeHtml(input.name)} directly, or <a href="${link}">open it in the console</a>.</p>`;

  for (const to of owners) {
    await sendEmail({
      to,
      subject: `New enquiry: ${input.company}`,
      text,
      html,
      replyTo: input.email,
    });
  }
}
