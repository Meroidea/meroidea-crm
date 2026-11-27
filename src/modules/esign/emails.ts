import 'server-only';

import { renderEmail } from '@/server/email-template';

/**
 * Emails about signature requests. None of them carry the document itself or what anyone typed
 * into it: a signer's link opens it, and staff open it in the app.
 */

type Business = { name: string; color: string | null };

const when = (date: Date, timezone: string) =>
  new Intl.DateTimeFormat('en-AU', {
    timeZone: timezone,
    day: 'numeric',
    month: 'long',
    year: 'numeric',
  }).format(date);

export function invitationEmail(input: {
  business: Business;
  senderName: string;
  signerName: string;
  title: string;
  message: string | null;
  link: string;
  expiresAt: Date | null;
  timezone: string;
}) {
  return {
    subject: `${input.senderName} sent you “${input.title}” to sign`,
    ...renderEmail({
      sender: { kind: 'business', name: input.business.name, color: input.business.color },
      preheader: `Review and sign “${input.title}” from ${input.business.name}.`,
      heading: 'Please review and sign',
      blocks: [
        { type: 'paragraph', text: `Hi ${input.signerName},` },
        {
          type: 'paragraph',
          text: `${input.senderName} at ${input.business.name} has asked you to sign “${input.title}”.`,
        },
        ...(input.message ? [{ type: 'message' as const, text: input.message }] : []),
        { type: 'button', label: 'Review and sign', url: input.link },
        {
          type: 'note',
          text:
            'This link is personal to you. Please don’t forward it: anyone with it can open the document.' +
            (input.expiresAt
              ? ` It can be signed until ${when(input.expiresAt, input.timezone)}.`
              : ''),
        },
      ],
      reason: `You received this because ${input.business.name} asked you to sign a document.`,
    }),
  };
}

export function codeEmail(input: { business: Business; code: string; title: string }) {
  return {
    subject: `Your code to open “${input.title}”: ${input.code}`,
    ...renderEmail({
      sender: { kind: 'business', name: input.business.name, color: input.business.color },
      preheader: `Your code is ${input.code}. It works for 10 minutes.`,
      heading: 'Your one-time code',
      blocks: [
        { type: 'paragraph', text: `Enter this code to open “${input.title}”:` },
        { type: 'details', rows: [{ label: 'Code', value: input.code }] },
        {
          type: 'note',
          text: 'It works once, for 10 minutes. If you did not ask for it, you can ignore this email.',
        },
      ],
      reason: `You received this because someone opened your signing link from ${input.business.name}.`,
    }),
  };
}

export function signedNoticeEmail(input: {
  business: Business;
  signerName: string;
  title: string;
  remaining: number;
  link: string;
}) {
  return {
    subject: `${input.signerName} signed “${input.title}”`,
    ...renderEmail({
      sender: { kind: 'platform' },
      preheader: `${input.remaining} still to sign.`,
      heading: `${input.signerName} signed`,
      blocks: [
        {
          type: 'paragraph',
          text: `${input.signerName} has signed “${input.title}”. ${input.remaining} ${
            input.remaining === 1 ? 'person is' : 'people are'
          } still to sign.`,
        },
        { type: 'button', label: 'See the request', url: input.link },
      ],
      reason: `You received this because you sent “${input.title}” for signature from ${input.business.name}.`,
    }),
  };
}

export function completedEmail(input: {
  business: Business;
  title: string;
  link: string;
  forSender: boolean;
}) {
  return {
    subject: `Signed by everyone: “${input.title}”`,
    ...renderEmail({
      sender: input.forSender
        ? { kind: 'platform' }
        : { kind: 'business', name: input.business.name, color: input.business.color },
      preheader: 'Everyone has signed. Download your copy.',
      heading: 'Everyone has signed',
      blocks: [
        {
          type: 'paragraph',
          text: `“${input.title}” has been signed by everyone. The signed copy includes a certificate with the signing history.`,
        },
        { type: 'button', label: 'Download the signed copy', url: input.link },
        ...(input.forSender
          ? []
          : [
              {
                type: 'note' as const,
                text: 'Your link stays open for 30 days so you can download your copy. Keep it somewhere safe.',
              },
            ]),
      ],
      reason: input.forSender
        ? `You received this because you sent “${input.title}” for signature from ${input.business.name}.`
        : `You received this because you signed a document for ${input.business.name}.`,
    }),
  };
}

export function declinedEmail(input: {
  business: Business;
  signerName: string;
  title: string;
  reason: string;
  link: string;
}) {
  return {
    subject: `${input.signerName} declined to sign “${input.title}”`,
    ...renderEmail({
      sender: { kind: 'platform' },
      preheader: 'The request is closed. Nobody else can sign it.',
      heading: `${input.signerName} declined`,
      blocks: [
        {
          type: 'paragraph',
          text: `${input.signerName} declined to sign “${input.title}”, so the request is closed. Their reason:`,
        },
        { type: 'message', text: input.reason },
        { type: 'button', label: 'See the request', url: input.link },
      ],
      reason: `You received this because you sent “${input.title}” for signature from ${input.business.name}.`,
    }),
  };
}

export function voidedEmail(input: {
  business: Business;
  signerName: string;
  title: string;
  reason: string;
}) {
  return {
    subject: `“${input.title}” no longer needs your signature`,
    ...renderEmail({
      sender: { kind: 'business', name: input.business.name, color: input.business.color },
      preheader: `${input.business.name} withdrew this request.`,
      heading: 'Request withdrawn',
      blocks: [
        { type: 'paragraph', text: `Hi ${input.signerName},` },
        {
          type: 'paragraph',
          text: `${input.business.name} has withdrawn “${input.title}”, so there is nothing to sign. Their note:`,
        },
        { type: 'message', text: input.reason },
      ],
      reason: `You received this because ${input.business.name} had asked you to sign a document.`,
    }),
  };
}
