import { z } from 'zod';

const optionalText = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .nullish()
    .transform((value) => value || null);
const optionalUser = z
  .union([z.uuid(), z.literal('')])
  .nullish()
  .transform((value) => value || null);
const optionalEmail = z
  .union([z.email('Enter a valid email address').max(200), z.literal('')])
  .nullish()
  .transform((value) => value?.toLowerCase() || null);

export const PRIORITIES = ['low', 'normal', 'high', 'urgent'] as const;
export type Priority = (typeof PRIORITIES)[number];
/** `normal` is stored as it always was and called Medium (ADR-069). */
export const PRIORITY_LABELS: Record<Priority, string> = {
  low: 'Low',
  normal: 'Medium',
  high: 'High',
  urgent: 'Urgent',
};
/**
 * Hours within which a first reply is due when a business has no SLA policy. Every business is
 * given one (ADR-069), whose targets then decide; these remain the fallback.
 */
export const RESPONSE_HOURS: Record<Priority, number> = { urgent: 1, high: 4, normal: 24, low: 72 };

export const STATUSES = ['open', 'pending', 'on_hold', 'solved', 'closed'] as const;
export type TicketStatus = (typeof STATUSES)[number];
export const STATUS_LABELS: Record<TicketStatus, string> = {
  open: 'Open',
  /** The resolution clock stands still while a ticket waits on the customer (ADR-069). */
  pending: 'Pending customer',
  on_hold: 'On hold',
  solved: 'Solved',
  closed: 'Closed',
};
export const CATEGORIES = ['Question', 'Problem', 'Complaint', 'Request', 'Billing'];

export function responseDueAt(from: Date, priority: Priority): Date {
  return new Date(from.getTime() + RESPONSE_HOURS[priority] * 60 * 60 * 1000);
}

export const createTicketSchema = z.object({
  subject: z.string().trim().min(3, 'Enter a subject').max(160),
  description: z.string().trim().min(3, 'Describe the request').max(8000),
  requesterName: z.string().trim().min(2, 'Enter the customer’s name').max(120),
  requesterEmail: optionalEmail,
  priority: z.enum(PRIORITIES).default('normal'),
  category: optionalText(60),
  assigneeUserId: optionalUser,
});

export const replySchema = z.object({
  ticketId: z.uuid(),
  body: z.string().trim().min(1, 'Write a message').max(8000),
  /** A private note for staff instead of a reply to the customer. */
  isInternal: z.boolean().default(false),
  /** What the ticket becomes after a reply; ignored for private notes. */
  status: z.enum(STATUSES).optional(),
});

export const updateTicketSchema = z.object({
  id: z.uuid(),
  status: z.enum(STATUSES).optional(),
  priority: z.enum(PRIORITIES).optional(),
  category: optionalText(60).optional(),
  /** Empty string or null unassigns. */
  assigneeUserId: optionalUser.optional(),
});

/** What a customer sends from the public contact form. An email is required so they can be answered. */
export const publicTicketSchema = z.object({
  requesterName: z.string().trim().min(2, 'Enter your name').max(120),
  requesterEmail: z
    .email('Enter a valid email address')
    .max(200)
    .transform((value) => value.toLowerCase()),
  subject: z.string().trim().min(3, 'Enter a subject').max(160),
  description: z.string().trim().min(10, 'Tell us a little more').max(8000),
});
export const publicReplySchema = z.object({
  body: z.string().trim().min(1, 'Write a message').max(8000),
});

export const idSchema = z.object({ id: z.uuid() });
export const formOpenSchema = z.object({ isOpen: z.boolean() });

export const QUEUES = ['open', 'mine', 'unassigned', 'at_risk', 'solved', 'all'] as const;
export type Queue = (typeof QUEUES)[number];
export const helpdeskParamsSchema = z.object({
  queue: z.enum(QUEUES).optional().catch(undefined),
  q: z.string().trim().max(100).optional().catch(undefined),
});

/** Opens a ticket for an inbox conversation (ADR-069). */
export const conversationTicketSchema = z.object({
  conversationId: z.uuid(),
  subject: z.string().trim().min(3, 'Enter a subject').max(160),
  priority: z.enum(PRIORITIES).default('normal'),
  assigneeUserId: optionalUser,
});

/** Links or unlinks one of the customer's opportunities. */
export const ticketOpportunitySchema = z.object({
  ticketId: z.uuid(),
  opportunityId: z.uuid(),
  linked: z.boolean(),
});

export const ticketOrganizationSchema = z.object({
  ticketId: z.uuid(),
  organizationId: z.uuid().nullable(),
});

const hhmm = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'Use a time like 09:00');
const closing = z.string().regex(/^(([01]\d|2[0-3]):[0-5]\d|24:00)$/, 'Use a time like 17:00');
const minuteOfDay = (value: string) => {
  const [hours, minutes] = value.split(':').map(Number);
  return hours! * 60 + minutes!;
};
/** Hours of a target, as a person types them (0.25 = 15 minutes), up to a year. */
const targetHours = z
  .number({ error: 'Enter a number of hours' })
  .min(0.25, 'At least 15 minutes')
  .max(8760, 'At most a year');

const targetSchema = z
  .object({ firstResponseHours: targetHours, resolutionHours: targetHours })
  .refine((target) => target.resolutionHours >= target.firstResponseHours, {
    message: 'Resolution cannot be due before the first response',
    path: ['resolutionHours'],
  });

/** The business's response targets (ADR-069): its default policy and the hours it counts in. */
export const slaSettingsSchema = z
  .object({
    atRiskPercent: z.number().int().min(1).max(99),
    escalateToUserId: optionalUser,
    useBusinessHours: z.boolean(),
    timezone: z.string().trim().min(1).max(64),
    skipPublicHolidays: z.boolean(),
    weekly: z
      .array(z.object({ day: z.number().int().min(0).max(6), opens: hhmm, closes: closing }))
      .max(70),
    targets: z.object({
      low: targetSchema,
      normal: targetSchema,
      high: targetSchema,
      urgent: targetSchema,
    }),
  })
  .superRefine((value, issue) => {
    if (!value.useBusinessHours) return;
    if (value.weekly.length === 0) {
      issue.addIssue({ code: 'custom', message: 'Add the hours you are open', path: ['weekly'] });
    }
    value.weekly.forEach((slot, index) => {
      if (minuteOfDay(slot.opens) >= minuteOfDay(slot.closes)) {
        issue.addIssue({
          code: 'custom',
          message: 'Opening must be before closing',
          path: ['weekly', index, 'closes'],
        });
      }
    });
  });

export type CreateTicketInput = z.output<typeof createTicketSchema>;
export type ConversationTicketInput = z.output<typeof conversationTicketSchema>;
export type SlaSettingsInput = z.output<typeof slaSettingsSchema>;
export type ReplyInput = z.output<typeof replySchema>;
export type UpdateTicketInput = z.output<typeof updateTicketSchema>;
export type PublicTicketInput = z.output<typeof publicTicketSchema>;

/** What became of the email for a reply: `none` when there was no one to send it to. */
export type ReplyEmail = 'sent' | 'not_configured' | 'failed' | 'none';
