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
export const PRIORITY_LABELS: Record<Priority, string> = {
  low: 'Low',
  normal: 'Normal',
  high: 'High',
  urgent: 'Urgent',
};
/** Hours within which a first reply is due. Plain clock hours, not business hours. */
export const RESPONSE_HOURS: Record<Priority, number> = { urgent: 1, high: 4, normal: 24, low: 72 };

export const STATUSES = ['open', 'pending', 'on_hold', 'solved', 'closed'] as const;
export type TicketStatus = (typeof STATUSES)[number];
export const STATUS_LABELS: Record<TicketStatus, string> = {
  open: 'Open',
  pending: 'Waiting on customer',
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

export const QUEUES = ['open', 'mine', 'unassigned', 'solved', 'all'] as const;
export type Queue = (typeof QUEUES)[number];
export const helpdeskParamsSchema = z.object({
  queue: z.enum(QUEUES).optional().catch(undefined),
  q: z.string().trim().max(100).optional().catch(undefined),
});

export type CreateTicketInput = z.output<typeof createTicketSchema>;
export type ReplyInput = z.output<typeof replySchema>;
export type UpdateTicketInput = z.output<typeof updateTicketSchema>;
export type PublicTicketInput = z.output<typeof publicTicketSchema>;
