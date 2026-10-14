import { z } from 'zod';

const optionalId = z
  .union([z.literal(''), z.uuid()])
  .optional()
  .transform((value) => value || null);

export const sendEmailSchema = z.object({
  contactId: z.uuid(),
  templateId: optionalId,
  subject: z.string().trim().min(1, 'Add a subject').max(200),
  body: z.string().trim().min(1, 'Write the message').max(20000),
});

export const enrollSchema = z.object({
  contactId: z.uuid(),
  sequenceId: z.uuid('Choose a sequence'),
  assignedTo: optionalId,
});

export const enrollmentIdSchema = z.object({ enrollmentId: z.uuid() });
