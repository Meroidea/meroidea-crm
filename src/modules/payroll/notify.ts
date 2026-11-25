import { renderEmail } from '@/server/email-template';

const day = (date: string) =>
  new Intl.DateTimeFormat('en-AU', {
    timeZone: 'UTC',
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  }).format(new Date(`${date}T00:00:00Z`));

/**
 * The email someone gets when their payslip is released (ADR-084): that it is ready, for which
 * period and payment date, and a link to it in Meroidea. Pay figures stay behind the sign-in,
 * never in an inbox.
 */
export function payslipEmail(input: {
  workspace: string;
  fullName: string;
  periodStart: string;
  periodEnd: string;
  paymentDate: string;
  url: string;
  color?: string | null;
}): { subject: string; text: string; html: string } {
  const period = `${day(input.periodStart)} to ${day(input.periodEnd)}`;
  const email = renderEmail({
    sender: { kind: 'business', name: input.workspace, color: input.color },
    preheader: `Your payslip for ${period} is ready.`,
    heading: 'Your payslip is ready',
    blocks: [
      { type: 'paragraph', text: `Hi ${input.fullName.split(' ')[0] ?? input.fullName},` },
      {
        type: 'paragraph',
        text: `${input.workspace} has released your payslip for ${period}, paid on ${day(input.paymentDate)}.`,
      },
      { type: 'button', label: 'View your payslip', url: input.url },
      {
        type: 'note',
        text: 'Sign in to see it. For your privacy, the amounts are not included in this email.',
      },
    ],
    reason: `You received this because ${input.workspace} released a payslip for you.`,
  });
  return { subject: `Your payslip for ${period}`, ...email };
}
